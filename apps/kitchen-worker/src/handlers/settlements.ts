import { KITCHEN_ERROR_REASONS, SETTLEMENT_METHODS, type SettlementMethod } from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import { groupAllows, requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { LedgerError, buildSettlement, type Split } from "@saas/kitchen-engine/ledger";
import { formatMinor } from "@saas/kitchen-engine/money";
import { forbidden, readJsonObject, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { toPublicId } from "../ids.js";
import { groupCurrency, ledgerAudit, postedTxnResponse } from "../ledger.js";
import { notInGroup } from "../roster-client.js";
import { Fields, minor, oneOf, subjectId, text, type FieldErrors } from "../validate.js";

// POST /v1/organizations/{org}/kitchen/settlements   kitchen.settlement.create
//
// A payment between two people in the group: `from` paid `to`, so from's
// balance goes up and to's goes down. Either of the two records it, or an
// owner or admin (the people who hold kitchen.txn.reverse_any, the grant to
// correct anyone's entries). One batch writes it with
// `kitchen.settlement.recorded`.

export interface ParsedSettlement {
  fromSubjectId: string;
  toSubjectId: string;
  amountMinor: number;
  method: SettlementMethod | null;
  note: string | null;
}

type Parsed = { ok: true; value: ParsedSettlement; splits: Split[] } | { ok: false; fields: FieldErrors };

export function parseSettlement(body: Record<string, unknown>): Parsed {
  const fields = new Fields();
  const fromSubjectId = subjectId(fields, "fromSubjectId", body.fromSubjectId);
  const toSubjectId = subjectId(fields, "toSubjectId", body.toSubjectId);
  const amountMinor = minor(fields, "amountMinor", body.amountMinor, true);
  const method = body.method === undefined ? null : oneOf(fields, "method", body.method, SETTLEMENT_METHODS);
  const note = text(fields, "note", body.note, 500, true);
  if (
    !fields.ok || fromSubjectId === undefined || toSubjectId === undefined || amountMinor === undefined ||
    method === undefined || note === undefined
  ) {
    return { ok: false, fields: fields.errors };
  }
  try {
    const splits = buildSettlement({ fromId: fromSubjectId, toId: toSubjectId, amountMinor });
    return { ok: true, value: { fromSubjectId, toSubjectId, amountMinor, method, note }, splits };
  } catch (err) {
    if (err instanceof LedgerError && err.code === "same_person") {
      return { ok: false, fields: { toSubjectId: ["A payment needs two different people"] } };
    }
    throw err;
  }
}

export async function handleCreateSettlement(ctx: OrgContext, request: Request): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.settlement.create");
  if (denied) return denied;

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseSettlement(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const payment = parsed.value;

  const actor = ctx.actor.subjectId;
  if (actor !== payment.fromSubjectId && actor !== payment.toSubjectId && !(await groupAllows(ctx, "kitchen.txn.reverse_any"))) {
    return forbidden(
      ctx.requestId,
      "Only the two people a payment is between, or an owner or admin, can record it",
      KITCHEN_ERROR_REASONS.NOT_A_PARTY,
    );
  }

  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
  if (!roster.ok) return unavailable(ctx.requestId);
  const outsiders = notInGroup(roster.members, [payment.fromSubjectId, payment.toSubjectId]);
  if (outsiders.length > 0) {
    return unprocessable(ctx.requestId, "Both people must be in the group", KITCHEN_ERROR_REASONS.NOT_IN_GROUP, {
      subjectIds: outsiders,
    });
  }

  return withKitchenRepo(ctx, async (repo) => {
    const currency = await groupCurrency(repo, ctx);
    if (!currency) return unavailable(ctx.requestId);

    const id = asUuid(crypto.randomUUID());
    const now = ctx.now();
    const result = await ctx.timings.measure("db", () =>
      repo.postTxn({
        txn: {
          id,
          orgId: ctx.orgId,
          kind: "settlement",
          title: "Payment",
          totalMinor: payment.amountMinor,
          currency,
          occurredAt: now,
          createdBy: actor,
          method: payment.method,
          note: payment.note,
          idemKey: idem.key,
          now,
        },
        splits: parsed.splits,
        audit: ledgerAudit(ctx, {
          type: "kitchen.settlement.recorded",
          subjectKind: "kitchen_txn",
          subjectId: id,
          idemKey: idem.key,
          description: `Payment ${toPublicId("txn", id)}: ${payment.fromSubjectId} paid ${payment.toSubjectId} ${formatMinor(payment.amountMinor, currency)}`,
          payload: {
            txnId: toPublicId("txn", id),
            fromSubjectId: payment.fromSubjectId,
            toSubjectId: payment.toSubjectId,
            amountMinor: payment.amountMinor,
            currency,
            method: payment.method,
          },
        }),
      }),
    );
    return postedTxnResponse(ctx, result, (txn) => txn.kind === "settlement" && txn.createdBy === actor);
  });
}
