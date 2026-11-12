// The expense writes (design §2, §0.6). Append-only, each ONE batch with its
// audit event:
//
//   POST   /v1/spliteco/groups/{org}/expenses   add          spliteco.expense.added
//   PUT    /v1/spliteco/expenses/{txn}          edit         reversal + new version (revises)      spliteco.expense.edited
//   DELETE /v1/spliteco/expenses/{txn}          delete       reversal stamped deleted_at           spliteco.expense.deleted
//   POST   /v1/spliteco/expenses/{txn}/restore  restore      new version (revises), within 30 days spliteco.expense.restored
//   POST   /v1/spliteco/expenses/{txn}/move     move         reversal in A + new version in B (moved_from)  spliteco.expense.moved
//
// Cookpool's rows (app = 'cookpool') and anything that is not an expense
// answer 409 `owned_by_cookpool` / `not_an_expense`. Only the version in
// effect can be changed (409 `not_current`, with the current one's id). A
// retry with the same Idempotency-Key answers what the first one wrote.

import {
  SPLITECO_ERROR_REASONS,
  SPLITECO_RESTORE_DAYS,
  type SplitecoExpenseRequest,
  type SplitecoWriteResponse,
} from "@saas/contracts/spliteco";
import { asUuid, type Uuid } from "@saas/db/ids";
import type { NewSplitecoTxn, SplitecoRepository, SplitecoTxnRecord, SplitecoWriteResult } from "@saas/db/spliteco";
import { reverseSplits } from "@saas/kitchen-engine/ledger";
import { formatMinor } from "@saas/kitchen-engine/money";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { itemRows, parseExpense, peopleNamed, splitExpense } from "../expense-input.js";
import { conflict, errorResponse, notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parseOrgPublicId, parseTxnPublicId, txnPublicId } from "../ids.js";
import { currencyOf, groupLabel, isCurrent, splitecoAudit, toSummary, withRepo } from "../ledger.js";
import type { MemberGroup } from "../membership.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Who writes the row. kitchen_txns.created_by holds the actor's public id
 * (`usr_…`), as kitchen-worker stores it (migration 220), not a UUID.
 */
function actorOf(ctx: RequestContext): string {
  const { actor } = ctx;
  return actor.subjectId;
}

/** The caller's group `orgId` (with its members), or null. */
export async function myGroup(ctx: RequestContext, orgId: string): Promise<MemberGroup | null | "unavailable"> {
  const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
  if (!mine.ok) return "unavailable";
  return mine.groups.find((g) => g.orgId === orgId) ?? null;
}

export function notInGroup(group: MemberGroup, named: readonly string[]): string[] {
  const inGroup = new Set(group.members.map((m) => m.subjectId));
  return [...new Set(named)].filter((id) => !inGroup.has(id));
}

function written(ctx: RequestContext, t: SplitecoTxnRecord, group: MemberGroup | undefined, status = 201): Response {
  return successResponse<SplitecoWriteResponse>({ expense: toSummary(t, groupLabel(group), ctx.actor.subjectId) }, ctx.requestId, status);
}

/** The answer to a failed or replayed write. `null` when it simply posted. */
export function writeOutcome(ctx: RequestContext, result: SplitecoWriteResult, sameRequest: (t: SplitecoTxnRecord) => boolean): Response | "posted" | SplitecoTxnRecord {
  if (result.ok) {
    if (!result.replayed) return "posted";
    if (!sameRequest(result.existing)) {
      return conflict(ctx.requestId, "This Idempotency-Key was already used for a different request", SPLITECO_ERROR_REASONS.IDEMPOTENCY_KEY_REUSED);
    }
    return result.existing;
  }
  switch (result.error.kind) {
    case "conflict":
      return conflict(ctx.requestId, "This expense changed meanwhile; open it again", SPLITECO_ERROR_REASONS.NOT_CURRENT);
    case "currency_mismatch":
      return unprocessable(
        ctx.requestId,
        `The group's ledger counts in ${result.error.currency ?? "another currency"}`,
        SPLITECO_ERROR_REASONS.CURRENCY_MISMATCH,
        { currency: result.error.currency },
      );
    case "invalid":
      return errorResponse("internal_error", "The expense did not add up", 500, ctx.requestId, { reason: result.error.reason });
    default:
      return unavailable(ctx.requestId);
  }
}

/** The new version of an expense, from a validated request. */
export function versionOf(
  ctx: RequestContext,
  input: {
    orgId: string;
    request: SplitecoExpenseRequest;
    occurredAt: string;
    currency: string;
    splits: NewSplitecoTxn["splits"];
    idemKey: string;
    revises?: string | null;
    movedFrom?: string | null;
  },
): NewSplitecoTxn {
  return {
    id: asUuid(crypto.randomUUID()),
    orgId: input.orgId,
    kind: "expense",
    title: input.request.title,
    totalMinor: input.request.totalMinor,
    currency: input.currency,
    occurredAt: input.occurredAt,
    createdBy: actorOf(ctx),
    createdAt: ctx.now().toISOString(),
    note: input.request.note ?? null,
    idemKey: input.idemKey,
    app: "spliteco",
    // Anything added through Spliteco counts toward Other (design §0.11).
    bucket: "other",
    category: input.request.category ?? null,
    revises: input.revises ?? null,
    movedFrom: input.movedFrom ?? null,
    viaDelegation: ctx.actor.delegationId,
    viaClient: ctx.actor.clientName,
    splitSpec: JSON.stringify(input.request),
    splits: input.splits,
    ...itemRows(input.request),
  };
}

/** The reversal of `original` (a delete when `deleted`). */
function reversalOf(ctx: RequestContext, original: SplitecoTxnRecord, idemKey: string, deleted: boolean): NewSplitecoTxn {
  const now = ctx.now().toISOString();
  return {
    id: asUuid(crypto.randomUUID()),
    orgId: original.orgId,
    kind: "reversal",
    title: original.title,
    totalMinor: original.totalMinor,
    currency: original.currency,
    occurredAt: now,
    createdBy: actorOf(ctx),
    createdAt: now,
    note: null,
    idemKey,
    app: "spliteco",
    bucket: original.bucket,
    category: original.category,
    reverses: original.id,
    deletedAt: deleted ? now : null,
    viaDelegation: ctx.actor.delegationId,
    viaClient: ctx.actor.clientName,
    splits: reverseSplits(original.splits),
  };
}

export type ReadExpense =
  | { ok: true; parsed: ReturnType<typeof parseExpense> & { ok: true }; splits: NewSplitecoTxn["splits"] }
  | { ok: false; response: Response };

/** Parse, split and member-check a request for group `group`. */
async function readRequest(ctx: RequestContext, request: Request, group: MemberGroup): Promise<ReadExpense> {
  const body = await readJsonObject(request);
  if (!body) return { ok: false, response: validationError(ctx.requestId, { body: ["Must be a JSON object"] }) };
  return readExpenseBody(ctx, body, group);
}

/** Parse, split and member-check an expense request body for group `group` (also an assistant's draft, SE5). */
export function readExpenseBody(ctx: RequestContext, body: Record<string, unknown>, group: MemberGroup): ReadExpense {
  const parsed = parseExpense(body);
  if (!parsed.ok) return { ok: false, response: validationError(ctx.requestId, parsed.fields) };
  const split = splitExpense(parsed.value);
  if (!split.ok) {
    return {
      ok: false,
      response: unprocessable(ctx.requestId, "The split does not add up", SPLITECO_ERROR_REASONS.DOES_NOT_ADD_UP, { problems: split.problems }),
    };
  }
  const outsiders = notInGroup(group, peopleNamed(parsed.value.request));
  if (outsiders.length > 0) {
    return {
      ok: false,
      response: unprocessable(ctx.requestId, "Everyone on an expense must be in the group", SPLITECO_ERROR_REASONS.NOT_IN_GROUP, {
        subjectIds: outsiders,
      }),
    };
  }
  return { ok: true, parsed, splits: split.splits };
}

export function currencyRefused(ctx: RequestContext, requested: string | undefined, currency: string): Response | null {
  if (requested !== undefined && requested !== currency) {
    return unprocessable(ctx.requestId, `The group's ledger counts in ${currency}`, SPLITECO_ERROR_REASONS.CURRENCY_MISMATCH, { currency });
  }
  return null;
}

export async function handleCreateExpense(ctx: RequestContext, request: Request, orgParam: string): Promise<Response> {
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const denied = await requireOrgAction(ctx, orgId, "spliteco.expense.write");
  if (denied) return denied;
  const group = await myGroup(ctx, orgId);
  if (group === "unavailable") return unavailable(ctx.requestId);
  if (!group) return notFound(ctx.requestId);

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const read = await readRequest(ctx, request, group);
  if (!read.ok) return read.response;
  const { request: body, occurredAt } = read.parsed.value;

  return withRepo(ctx, async (repo) => {
    const currency = currencyOf(await repo.currencies([orgId]), orgId);
    const refused = currencyRefused(ctx, body.currency, currency);
    if (refused) return refused;
    const txn = versionOf(ctx, {
      orgId,
      request: body,
      occurredAt: (occurredAt ?? ctx.now()).toISOString(),
      currency,
      splits: read.splits,
      idemKey: idem.key,
    });
    const result = await ctx.timings.measure("db", () =>
      repo.write(
        [txn],
        splitecoAudit(ctx, {
          type: "spliteco.expense.added",
          orgId,
          txnId: txn.id,
          idemKey: idem.key,
          description: `Expense ${txnPublicId(txn.id)} "${body.title}" for ${formatMinor(body.totalMinor, currency)}, split ${body.split.method}`,
          payload: { title: body.title, totalMinor: body.totalMinor, currency, method: body.split.method, subjectIds: txn.splits.map((s) => s.subjectId) },
        }),
      ),
    );
    const outcome = writeOutcome(ctx, result, (t) => t.kind === "expense" && t.app === "spliteco" && t.createdBy === ctx.actor.subjectId);
    if (outcome instanceof Response) return outcome;
    const stored = outcome === "posted" ? await repo.getTxn(txn.id) : outcome;
    return stored ? written(ctx, stored, group) : unavailable(ctx.requestId);
  });
}

/** The current version an old one was replaced by, following the chain. */
async function currentOf(repo: SplitecoRepository, t: SplitecoTxnRecord): Promise<SplitecoTxnRecord> {
  let at = t;
  for (let i = 0; i < 50; i++) {
    const next = at.replacedBy ?? at.movedTo;
    if (!next) break;
    const row = await repo.getTxn(next);
    if (!row) break;
    at = row;
  }
  return at;
}

export type Loaded = { ok: true; txn: SplitecoTxnRecord; group: MemberGroup } | { ok: false; response: Response };

/** Load an expense the caller may write, refusing Cookpool's rows and old versions. */
export async function loadWritable(ctx: RequestContext, repo: SplitecoRepository, txnParam: string, { needCurrent = true } = {}): Promise<Loaded> {
  const id = parseTxnPublicId(txnParam);
  if (!id) return { ok: false, response: notFound(ctx.requestId) };
  const txn = await repo.getTxn(id);
  if (!txn) return { ok: false, response: notFound(ctx.requestId) };
  const denied = await requireOrgAction(ctx, asUuid(txn.orgId), "spliteco.expense.write");
  if (denied) return { ok: false, response: denied };
  const group = await myGroup(ctx, txn.orgId);
  if (group === "unavailable") return { ok: false, response: unavailable(ctx.requestId) };
  if (!group) return { ok: false, response: notFound(ctx.requestId) };
  if (txn.app !== "spliteco") {
    return {
      ok: false,
      response: conflict(ctx.requestId, "Cookpool posted this; change it in Cookpool", SPLITECO_ERROR_REASONS.OWNED_BY_COOKPOOL),
    };
  }
  if (txn.kind !== "expense") {
    return { ok: false, response: conflict(ctx.requestId, "Only expenses can be changed here", SPLITECO_ERROR_REASONS.NOT_AN_EXPENSE) };
  }
  if (needCurrent && !isCurrent(txn)) {
    const current = await currentOf(repo, txn);
    return {
      ok: false,
      response: conflict(ctx.requestId, "This version was changed since; open the current one", SPLITECO_ERROR_REASONS.NOT_CURRENT, {
        currentId: isCurrent(current) ? txnPublicId(current.id) : null,
      }),
    };
  }
  return { ok: true, txn, group };
}

export async function handleEditExpense(ctx: RequestContext, request: Request, txnParam: string): Promise<Response> {
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  return withRepo(ctx, async (repo) => {
    const loaded = await loadWritable(ctx, repo, txnParam, { needCurrent: false });
    if (!loaded.ok) return loaded.response;
    const { txn: original, group } = loaded;
    // A retry of an edit that already landed answers what it wrote.
    const replay = await repo.findByIdemKey(original.orgId, idem.key);
    if (replay) {
      return replay.revises === original.id && replay.createdBy === ctx.actor.subjectId
        ? written(ctx, replay, group, 200)
        : conflict(ctx.requestId, "This Idempotency-Key was already used for a different request", SPLITECO_ERROR_REASONS.IDEMPOTENCY_KEY_REUSED);
    }
    if (!isCurrent(original)) {
      const again = await loadWritable(ctx, repo, txnParam);
      return again.ok ? unavailable(ctx.requestId) : again.response;
    }

    const read = await readRequest(ctx, request, group);
    if (!read.ok) return read.response;
    const { request: body, occurredAt } = read.parsed.value;
    const refused = currencyRefused(ctx, body.currency, original.currency);
    if (refused) return refused;

    const next = versionOf(ctx, {
      orgId: original.orgId,
      request: body,
      occurredAt: (occurredAt ?? new Date(original.occurredAt)).toISOString(),
      currency: original.currency,
      splits: read.splits,
      idemKey: idem.key,
      revises: original.id,
    });
    const reversal = reversalOf(ctx, original, `${idem.key}:rev`, false);
    const result = await ctx.timings.measure("db", () =>
      repo.write(
        [next, reversal],
        splitecoAudit(ctx, {
          type: "spliteco.expense.edited",
          orgId: original.orgId,
          txnId: next.id,
          idemKey: idem.key,
          description: `Expense ${txnPublicId(original.id)} edited as ${txnPublicId(next.id)}: ${formatMinor(original.totalMinor, original.currency)} → ${formatMinor(body.totalMinor, original.currency)}`,
          payload: {
            revises: txnPublicId(original.id),
            reversal: txnPublicId(reversal.id),
            title: body.title,
            totalMinor: body.totalMinor,
            previousTotalMinor: original.totalMinor,
            method: body.split.method,
          },
        }),
      ),
    );
    const outcome = writeOutcome(ctx, result, (t) => t.revises === original.id && t.createdBy === ctx.actor.subjectId);
    if (outcome instanceof Response) return outcome;
    const stored = outcome === "posted" ? await repo.getTxn(next.id) : outcome;
    return stored ? written(ctx, stored, group, 200) : unavailable(ctx.requestId);
  });
}

export async function handleDeleteExpense(ctx: RequestContext, request: Request, txnParam: string): Promise<Response> {
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  return withRepo(ctx, async (repo) => {
    const loaded = await loadWritable(ctx, repo, txnParam, { needCurrent: false });
    if (!loaded.ok) return loaded.response;
    const { txn: original, group } = loaded;
    if (!isCurrent(original)) {
      // Deleting what is already deleted answers the same.
      if (original.reversalDeletedAt !== null && original.replacedBy === null) return written(ctx, original, group, 200);
      const again = await loadWritable(ctx, repo, txnParam);
      return again.ok ? unavailable(ctx.requestId) : again.response;
    }
    const reversal = reversalOf(ctx, original, idem.key, true);
    const result = await ctx.timings.measure("db", () =>
      repo.write(
        [reversal],
        splitecoAudit(ctx, {
          type: "spliteco.expense.deleted",
          orgId: original.orgId,
          txnId: original.id,
          idemKey: idem.key,
          description: `Expense ${txnPublicId(original.id)} "${original.title}" deleted (restorable for ${SPLITECO_RESTORE_DAYS} days)`,
          payload: { reversal: txnPublicId(reversal.id), title: original.title, totalMinor: original.totalMinor },
        }),
      ),
    );
    const outcome = writeOutcome(ctx, result, (t) => t.reverses === original.id);
    if (outcome instanceof Response) return outcome;
    const stored = await repo.getTxn(original.id);
    return stored ? written(ctx, stored, group, 200) : unavailable(ctx.requestId);
  });
}

export async function handleRestoreExpense(ctx: RequestContext, request: Request, txnParam: string): Promise<Response> {
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  return withRepo(ctx, async (repo) => {
    const loaded = await loadWritable(ctx, repo, txnParam, { needCurrent: false });
    if (!loaded.ok) return loaded.response;
    const { txn: original, group } = loaded;
    const replay = await repo.findByIdemKey(original.orgId, idem.key);
    if (replay) {
      return replay.revises === original.id
        ? written(ctx, replay, group, 200)
        : conflict(ctx.requestId, "This Idempotency-Key was already used for a different request", SPLITECO_ERROR_REASONS.IDEMPOTENCY_KEY_REUSED);
    }
    if (original.reversalDeletedAt === null || original.replacedBy !== null || original.movedTo !== null) {
      if (original.replacedBy !== null) {
        const current = await currentOf(repo, original);
        return conflict(ctx.requestId, "This expense was restored or changed since", SPLITECO_ERROR_REASONS.NOT_CURRENT, {
          currentId: isCurrent(current) ? txnPublicId(current.id) : null,
        });
      }
      return conflict(ctx.requestId, "Only a deleted expense can be restored", SPLITECO_ERROR_REASONS.NOT_DELETED);
    }
    if (ctx.now().getTime() - new Date(original.reversalDeletedAt).getTime() > SPLITECO_RESTORE_DAYS * DAY_MS) {
      return conflict(ctx.requestId, `It was deleted more than ${SPLITECO_RESTORE_DAYS} days ago`, SPLITECO_ERROR_REASONS.RESTORE_EXPIRED);
    }
    const outsiders = notInGroup(group, original.splits.map((s) => s.subjectId));
    if (outsiders.length > 0) {
      return unprocessable(ctx.requestId, "Everyone on an expense must be in the group", SPLITECO_ERROR_REASONS.NOT_IN_GROUP, { subjectIds: outsiders });
    }
    const next = await copyOf(ctx, repo, original, { orgId: original.orgId, idemKey: idem.key, revises: original.id });
    const result = await ctx.timings.measure("db", () =>
      repo.write(
        [next],
        splitecoAudit(ctx, {
          type: "spliteco.expense.restored",
          orgId: original.orgId,
          txnId: next.id,
          idemKey: idem.key,
          description: `Expense ${txnPublicId(original.id)} "${original.title}" restored as ${txnPublicId(next.id)}`,
          payload: { revises: txnPublicId(original.id), title: original.title, totalMinor: original.totalMinor },
        }),
      ),
    );
    const outcome = writeOutcome(ctx, result, (t) => t.revises === original.id);
    if (outcome instanceof Response) return outcome;
    const stored = outcome === "posted" ? await repo.getTxn(next.id) : outcome;
    return stored ? written(ctx, stored, group) : unavailable(ctx.requestId);
  });
}

/** A new version that repeats `original` exactly (its splits, items and request), for a restore or a move. */
async function copyOf(
  ctx: RequestContext,
  repo: SplitecoRepository,
  original: SplitecoTxnRecord,
  at: { orgId: string; idemKey: string; revises?: string; movedFrom?: string },
): Promise<NewSplitecoTxn> {
  const details = await repo.items([original.id]);
  const now = ctx.now().toISOString();
  return {
    id: asUuid(crypto.randomUUID()),
    orgId: at.orgId,
    kind: "expense",
    title: original.title,
    totalMinor: original.totalMinor,
    currency: original.currency,
    occurredAt: original.occurredAt,
    createdBy: actorOf(ctx),
    createdAt: now,
    note: original.note,
    idemKey: at.idemKey,
    app: "spliteco",
    bucket: "other",
    category: original.category,
    revises: at.revises ?? null,
    movedFrom: at.movedFrom ?? null,
    viaDelegation: ctx.actor.delegationId,
    viaClient: ctx.actor.clientName,
    splitSpec: original.splitSpec,
    splits: original.splits,
    items: details.items.map(({ txnId: _t, ...rest }) => rest),
    shares: details.shares.map(({ txnId: _t, ...rest }) => rest),
    adjustments: details.adjustments.map(({ txnId: _t, ...rest }) => rest),
  };
}

export async function handleMoveExpense(ctx: RequestContext, request: Request, txnParam: string): Promise<Response> {
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const toOrg: Uuid | null = typeof body.toGroupId === "string" ? parseOrgPublicId(body.toGroupId) : null;
  if (!toOrg) return validationError(ctx.requestId, { toGroupId: ["Must be a group id (org_…)"] });

  return withRepo(ctx, async (repo) => {
    const loaded = await loadWritable(ctx, repo, txnParam, { needCurrent: false });
    if (!loaded.ok) return loaded.response;
    const { txn: original } = loaded;
    const target = await myGroup(ctx, toOrg);
    if (target === "unavailable") return unavailable(ctx.requestId);
    if (!target) return notFound(ctx.requestId);
    const replay = await repo.findByIdemKey(toOrg, idem.key);
    if (replay) {
      return replay.movedFrom === original.id
        ? written(ctx, replay, target, 200)
        : conflict(ctx.requestId, "This Idempotency-Key was already used for a different request", SPLITECO_ERROR_REASONS.IDEMPOTENCY_KEY_REUSED);
    }
    if (!isCurrent(original)) {
      const again = await loadWritable(ctx, repo, txnParam);
      return again.ok ? unavailable(ctx.requestId) : again.response;
    }
    if (toOrg === original.orgId) return conflict(ctx.requestId, "It is already in that group", SPLITECO_ERROR_REASONS.SAME_GROUP);
    const denied = await requireOrgAction(ctx, toOrg, "spliteco.expense.write");
    if (denied) return denied;
    const outsiders = notInGroup(target, original.splits.map((s) => s.subjectId));
    if (outsiders.length > 0) {
      return conflict(ctx.requestId, "Everyone on it must be a member of that group", SPLITECO_ERROR_REASONS.NOT_MEMBERS, { subjectIds: outsiders });
    }
    const currency = currencyOf(await repo.currencies([toOrg]), toOrg);
    if (currency !== original.currency) {
      return unprocessable(ctx.requestId, `That group's ledger counts in ${currency}`, SPLITECO_ERROR_REASONS.CURRENCY_MISMATCH, { currency });
    }

    const next = await copyOf(ctx, repo, original, { orgId: toOrg, idemKey: idem.key, movedFrom: original.id });
    const reversal = reversalOf(ctx, original, `${idem.key}:rev`, false);
    const result = await ctx.timings.measure("db", () =>
      repo.write(
        [next, reversal],
        splitecoAudit(ctx, {
          type: "spliteco.expense.moved",
          orgId: original.orgId,
          txnId: next.id,
          idemKey: idem.key,
          description: `Expense ${txnPublicId(original.id)} "${original.title}" moved to ${body.toGroupId as string} as ${txnPublicId(next.id)}`,
          payload: {
            movedFrom: txnPublicId(original.id),
            reversal: txnPublicId(reversal.id),
            toOrgId: body.toGroupId,
            title: original.title,
            totalMinor: original.totalMinor,
          },
        }),
      ),
    );
    const outcome = writeOutcome(ctx, result, (t) => t.movedFrom === original.id);
    if (outcome instanceof Response) return outcome;
    const stored = outcome === "posted" ? await repo.getTxn(next.id) : outcome;
    return stored ? written(ctx, stored, target) : unavailable(ctx.requestId);
  });
}
