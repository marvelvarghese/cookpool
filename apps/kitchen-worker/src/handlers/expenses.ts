import {
  CURRENCY_CODE_RE,
  KITCHEN_ERROR_REASONS,
  SPLIT_MODES,
  type SplitMode,
} from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import { requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { LedgerError, buildExpense, type ExpenseInput, type Split } from "@saas/kitchen-engine/ledger";
import { MoneyError, formatMinor } from "@saas/kitchen-engine/money";
import { readJsonObject, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { toPublicId } from "../ids.js";
import { groupCurrency, ledgerAudit, postedTxnResponse } from "../ledger.js";
import { notInGroup } from "../roster-client.js";
import { Fields, decimals, instant, minor, oneOf, subjectId, text, type FieldErrors } from "../validate.js";

// POST /v1/organizations/{org}/kitchen/expenses   kitchen.expense.create
//
// A bill: who paid what, and how it is shared — equally, by exact amounts, by
// percentages or by shares. The engine splits it (largest remainder, so the
// parts add up to the total); everyone named must be in the group, and the
// amount is in the group's currency. One batch writes the transaction, its
// splits and `kitchen.expense.added`.

/** More people than a group can hold (50) is a malformed request, not a big bill. */
const MAX_PEOPLE = 100;

export interface ParsedExpense extends ExpenseInput {
  title: string;
  currency: string | null;
  occurredAt: Date | null;
  note: string | null;
}

type Parsed = { ok: true; value: ParsedExpense } | { ok: false; fields: FieldErrors };

function participantValue(fields: Fields, name: string, mode: SplitMode, value: unknown): number | undefined {
  switch (mode) {
    case "equal":
      return undefined;
    case "exact":
      return minor(fields, name, value);
    case "percent":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100 || decimals(value) > 2) {
        return fields.add(name, "Must be a percentage from 0 to 100, at most two decimals");
      }
      return value;
    case "shares":
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000 || decimals(value) > 6) {
        return fields.add(name, "Must be a share of 0 or more");
      }
      return value;
  }
}

/** Validate a POST body. Unknown fields are ignored, as on every baseline route. */
export function parseExpense(body: Record<string, unknown>): Parsed {
  const fields = new Fields();
  const title = text(fields, "title", body.title, 200);
  const totalMinor = minor(fields, "totalMinor", body.totalMinor, true);
  const note = text(fields, "note", body.note, 500, true);

  let currency: string | null = null;
  if (body.currency !== undefined) {
    if (typeof body.currency === "string" && CURRENCY_CODE_RE.test(body.currency)) currency = body.currency;
    else fields.add("currency", "Must be a three-letter ISO 4217 code in capitals, such as INR");
  }
  const occurredAt = body.occurredAt === undefined ? null : instant(fields, "occurredAt", body.occurredAt) ?? null;
  const mode = oneOf(fields, "mode", body.mode, SPLIT_MODES);

  const payers: { subjectId: string; amountMinor: number }[] = [];
  if (!Array.isArray(body.payers) || body.payers.length === 0 || body.payers.length > MAX_PEOPLE) {
    fields.add("payers", `List who paid: 1 to ${MAX_PEOPLE} people`);
  } else {
    body.payers.forEach((p: unknown, i) => {
      const entry = (p ?? {}) as Record<string, unknown>;
      const id = subjectId(fields, `payers[${i}].subjectId`, entry.subjectId);
      const amount = minor(fields, `payers[${i}].amountMinor`, entry.amountMinor);
      if (id !== undefined && amount !== undefined) payers.push({ subjectId: id, amountMinor: amount });
    });
    if (new Set(payers.map((p) => p.subjectId)).size !== payers.length) fields.add("payers", "Name each person once");
  }

  const participants: { subjectId: string; value?: number }[] = [];
  if (!Array.isArray(body.participants) || body.participants.length === 0 || body.participants.length > MAX_PEOPLE) {
    fields.add("participants", `List who shares it: 1 to ${MAX_PEOPLE} people`);
  } else if (mode !== undefined) {
    body.participants.forEach((p: unknown, i) => {
      const entry = (p ?? {}) as Record<string, unknown>;
      const id = subjectId(fields, `participants[${i}].subjectId`, entry.subjectId);
      const value = participantValue(fields, `participants[${i}].value`, mode, entry.value);
      if (id !== undefined && (mode === "equal" || value !== undefined)) {
        participants.push(mode === "equal" ? { subjectId: id } : { subjectId: id, value: value! });
      }
    });
    if (new Set(participants.map((p) => p.subjectId)).size !== participants.length) {
      fields.add("participants", "Name each person once");
    }
  }

  if (!fields.ok || title === undefined || totalMinor === undefined || mode === undefined || note === undefined) {
    return { ok: false, fields: fields.errors };
  }
  return { ok: true, value: { title, totalMinor, currency, payers, mode, participants, occurredAt, note } };
}

/** Split the expense with the engine; its refusals become field errors. */
export function splitExpense(expense: ExpenseInput): { ok: true; splits: Split[] } | { ok: false; fields: FieldErrors } {
  try {
    return { ok: true, splits: buildExpense(expense) };
  } catch (err) {
    if (err instanceof LedgerError && err.code === "unbalanced") {
      return { ok: false, fields: { payers: [`What was paid must add up to the total (${expense.totalMinor})`] } };
    }
    if (err instanceof MoneyError || err instanceof LedgerError) {
      return { ok: false, fields: { participants: [err.message] } };
    }
    throw err;
  }
}

export async function handleCreateExpense(ctx: OrgContext, request: Request): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.expense.create");
  if (denied) return denied;

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseExpense(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const expense = parsed.value;
  const split = splitExpense(expense);
  if (!split.ok) return validationError(ctx.requestId, split.fields);

  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
  if (!roster.ok) return unavailable(ctx.requestId);
  const outsiders = notInGroup(roster.members, [
    ...expense.payers.map((p) => p.subjectId),
    ...expense.participants.map((p) => p.subjectId),
  ]);
  if (outsiders.length > 0) {
    return unprocessable(ctx.requestId, "Everyone on an expense must be in the group", KITCHEN_ERROR_REASONS.NOT_IN_GROUP, {
      subjectIds: outsiders,
    });
  }

  return withKitchenRepo(ctx, async (repo) => {
    const currency = await groupCurrency(repo, ctx);
    if (!currency) return unavailable(ctx.requestId);
    if (expense.currency !== null && expense.currency !== currency) {
      return unprocessable(ctx.requestId, `The group's ledger counts in ${currency}`, KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH, {
        currency,
      });
    }

    const id = asUuid(crypto.randomUUID());
    const now = ctx.now();
    const actor = ctx.actor.subjectId;
    const result = await ctx.timings.measure("db", () =>
      repo.postTxn({
        txn: {
          id,
          orgId: ctx.orgId,
          kind: "expense",
          title: expense.title,
          totalMinor: expense.totalMinor,
          currency,
          occurredAt: expense.occurredAt ?? now,
          createdBy: actor,
          note: expense.note,
          idemKey: idem.key,
          now,
        },
        splits: split.splits,
        audit: ledgerAudit(ctx, {
          type: "kitchen.expense.added",
          subjectKind: "kitchen_txn",
          subjectId: id,
          idemKey: idem.key,
          description: `Expense ${toPublicId("txn", id)} "${expense.title}" for ${formatMinor(expense.totalMinor, currency)}, split ${expense.mode}`,
          payload: {
            txnId: toPublicId("txn", id),
            title: expense.title,
            totalMinor: expense.totalMinor,
            currency,
            mode: expense.mode,
            subjectIds: split.splits.map((s) => s.subjectId),
          },
        }),
      }),
    );
    return postedTxnResponse(ctx, result, (txn) => txn.kind === "expense" && txn.createdBy === actor);
  });
}
