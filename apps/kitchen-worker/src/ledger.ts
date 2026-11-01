// What every ledger handler shares: the public shapes of transactions and
// flags, the group's currency, the audit event a money write carries, and how
// a posting's outcome becomes a response.

import {
  DEFAULT_KITCHEN_CURRENCY,
  KITCHEN_ERROR_REASONS,
  type KitchenFlag,
  type KitchenTxn,
} from "@saas/contracts/kitchen";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import type {
  KitchenFlagRecord,
  KitchenLedgerTxn,
  KitchenRepository,
  KitchenResult,
  KitchenTxnRecord,
  PostedTxn,
} from "@saas/db/kitchen";
import type { OrgContext } from "./context.js";
import type { Txn } from "@saas/kitchen-engine/ledger";
import { conflict, errorResponse, successResponse, unavailable, unprocessable } from "./http.js";
import { toPublicId, type KitchenIdPrefix } from "./ids.js";

const SOURCE_PREFIX: Readonly<Record<string, KitchenIdPrefix>> = { item: "itm", dish: "dsh", expense: "txn" };

export function toKitchenTxn(record: KitchenTxnRecord): KitchenTxn {
  const sourcePrefix = record.sourceKind ? SOURCE_PREFIX[record.sourceKind] : undefined;
  return {
    id: toPublicId("txn", record.id),
    orgId: toPublicId("org", record.orgId),
    kind: record.kind,
    title: record.title,
    totalMinor: record.totalMinor,
    currency: record.currency,
    occurredAt: record.occurredAt.toISOString(),
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    sourceKind: record.sourceKind,
    sourceId: record.sourceId && sourcePrefix ? toPublicId(sourcePrefix, record.sourceId) : record.sourceId,
    reverses: record.reverses ? toPublicId("txn", record.reverses) : null,
    reversed: record.reversedBy !== null,
    reversedBy: record.reversedBy ? toPublicId("txn", record.reversedBy) : null,
    method: record.method,
    note: record.note,
    splits: record.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor })),
  };
}

export function toKitchenFlag(record: KitchenFlagRecord): KitchenFlag {
  return {
    id: toPublicId("flg", record.id),
    txnId: toPublicId("txn", record.txnId),
    orgId: toPublicId("org", record.orgId),
    subjectId: record.subjectId,
    reason: record.reason,
    state: record.state,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/** Stored transactions as the money engine reads them. */
export function toEngineTxns(txns: readonly KitchenLedgerTxn[]): Txn[] {
  return txns.map((t) => ({
    id: t.id,
    kind: t.kind,
    title: t.title,
    totalMinor: t.totalMinor,
    occurredAt: t.occurredAt.toISOString(),
    reverses: t.reverses,
    splits: t.splits,
  }));
}

/** The currency the group's ledger counts in (INR until its settings are first saved). Null on a read failure. */
export async function groupCurrency(repo: KitchenRepository, ctx: OrgContext): Promise<string | null> {
  const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(ctx.orgId));
  if (!settings.ok) return null;
  return settings.value?.currency ?? DEFAULT_KITCHEN_CURRENCY;
}

/** A fresh event or audit-entry id (32 hex, as the baseline's events use). */
function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * The audit event a group write carries, written in the same batch as the
 * write itself: `kitchen.expense.added`, `kitchen.settlement.recorded`,
 * `kitchen.txn.reversed`, `kitchen.txn.flagged`, `kitchen.item.added`.
 */
export function ledgerAudit(
  ctx: OrgContext,
  input: {
    type: string;
    subjectKind: "kitchen_txn" | "kitchen_flag" | "kitchen_item";
    subjectId: string;
    idemKey: string;
    description: string;
    payload: Record<string, unknown>;
  },
): AppendEventWithAuditInput {
  return {
    event: {
      id: eventId(),
      type: input.type,
      version: 1,
      source: "kitchen-worker",
      occurredAt: ctx.now(),
      actorType: ctx.actor.subjectType,
      actorId: ctx.actor.subjectId,
      orgId: ctx.orgId,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      requestId: ctx.requestId,
      idempotencyKey: input.idemKey,
      payload: { orgId: toPublicId("org", ctx.orgId), ...input.payload },
    },
    audit: { id: eventId(), category: "kitchen", description: input.description },
  };
}

/** The 409 for a key that already posted something else in this group. */
export function idempotencyKeyReused(requestId: string): Response {
  return conflict(
    requestId,
    "This Idempotency-Key was already used for a different request in this group",
    KITCHEN_ERROR_REASONS.IDEMPOTENCY_KEY_REUSED,
  );
}

/**
 * The response to posting a transaction. 201 `{ txn }` when it posted, and the
 * same when the key had already posted this very request (`isSameRequest`
 * says whether the stored transaction is one this request would have made);
 * a key reused for something else is a 409.
 */
export function postedTxnResponse(
  ctx: OrgContext,
  result: KitchenResult<PostedTxn>,
  isSameRequest: (txn: KitchenTxnRecord) => boolean,
): Response {
  if (result.ok) {
    if (result.value.replayed && !isSameRequest(result.value.txn)) return idempotencyKeyReused(ctx.requestId);
    return successResponse({ txn: toKitchenTxn(result.value.txn) }, ctx.requestId, 201);
  }
  const error = result.error;
  switch (error.kind) {
    case "currency_mismatch":
      return unprocessable(
        ctx.requestId,
        `The group's ledger counts in ${error.currency}`,
        KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH,
        { currency: error.currency },
      );
    case "already_reversed":
      return conflict(ctx.requestId, "This transaction has already been reversed", KITCHEN_ERROR_REASONS.ALREADY_REVERSED, {
        reversedBy: toPublicId("txn", error.reversedBy),
      });
    case "invalid":
      // The engine builds splits that add up, so this is a bug, not a bad request.
      return errorResponse("internal_error", "The transaction did not add up", 500, ctx.requestId, { reason: error.reason });
    default:
      return unavailable(ctx.requestId);
  }
}
