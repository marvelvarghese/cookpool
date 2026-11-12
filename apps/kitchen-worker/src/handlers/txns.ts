import { KITCHEN_ERROR_REASONS } from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import { groupAllows, requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { reverseSplits } from "@saas/kitchen-engine/ledger";
import { conflict, forbidden, notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { KITCHEN_ONLY, idempotencyKeyReused, ledgerAudit, postedTxnResponse, toKitchenFlag } from "../ledger.js";
import { Fields, text } from "../validate.js";
import { approvedBy } from "./uses.js";

// One transaction of the group's ledger:
//
// POST …/kitchen/txns/{txn}/reverse   its creator, or kitchen.txn.reverse_any (owner, admin) — and,
//                                     for a use an approved ask posted (PN-8), whoever approved it
//   Posts a `reversal` whose splits swap the original's paid and owed, so the
//   two cancel to the paisa. A transaction is reversed once: the second try is
//   409 `already_reversed`. Corrections are always reversals; nothing in the
//   ledger is edited or deleted.
//   Reversing a use or waste puts its stock back in the same batch (a
//   `reversal` stock move; the item's quantity and cost come back, and a
//   used-up or wasted item is active again). Such a reversal cannot itself be
//   reversed: 409 `not_reversible`.
//
// POST …/kitchen/txns/{txn}/flags     kitchen.txn.flag, and named in the transaction
//   "This looks wrong": a flag on the transaction for its logger and the
//   group's admins to see (the notifications arrive with the emails).
//
// Both start from kitchen.ledger.read-level access to the group (the opaque
// 404 outside it); a member who may see the transaction but not do this gets
// a 403 with the reason.

export async function handleReverseTxn(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.ledger.read");
  if (denied) return denied;
  const txnId = parsePublicId("txn", params[0]!);
  if (!txnId) return notFound(ctx.requestId);

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request, { optional: true });
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object, or empty"] });
  const fields = new Fields();
  const note = text(fields, "note", body.note, 500, true);
  if (note === undefined) return validationError(ctx.requestId, fields.errors);

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getTxn(ctx.orgId, txnId, KITCHEN_ONLY));
    if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    const original = found.value;
    // A payment made in Spliteco (SE3) may pay both balances in two rows; it
    // is undone there ("not received"), never one row from here.
    if (original.app === "spliteco") {
      return conflict(
        ctx.requestId,
        "This was recorded in Spliteco; correct it there",
        KITCHEN_ERROR_REASONS.OWNED_BY_SPLITECO,
      );
    }

    const actor = ctx.actor.subjectId;
    // A use an approved ask posted (PN-8) is the asker's: whoever approved it may reverse it too.
    const approver = async () =>
      original.kind === "use" && original.sourceKind === "item" && original.sourceId !== null &&
      (await approvedBy(ctx, repo, { itemId: original.sourceId, txnId: original.id }, actor));
    if (original.createdBy !== actor && !(await approver()) && !(await groupAllows(ctx, "kitchen.txn.reverse_any"))) {
      return forbidden(
        ctx.requestId,
        "Only whoever logged a transaction, or an owner or admin, can reverse it",
        KITCHEN_ERROR_REASONS.NOT_CREATOR,
      );
    }
    // A dish's charges come and go with the dish (CP-14): cancelling it
    // reverses them and puts its stock back, together.
    if (original.sourceKind === "dish") {
      return conflict(ctx.requestId, "This came from a dish: cancel the dish instead", KITCHEN_ERROR_REASONS.NOT_REVERSIBLE, {
        dishId: original.sourceId ? toPublicId("dsh", original.sourceId) : null,
      });
    }

    const id = asUuid(crypto.randomUUID());
    const now = ctx.now();
    const result = await ctx.timings.measure("db", () =>
      repo.reverseTxn({
        original,
        reversal: { id, title: `Reversal: ${original.title}`, occurredAt: now, createdBy: actor, note, idemKey: idem.key, now },
        splits: reverseSplits(original.splits),
        audit: ledgerAudit(ctx, {
          type: "kitchen.txn.reversed",
          subjectKind: "kitchen_txn",
          subjectId: id,
          idemKey: idem.key,
          description: `Reversal ${toPublicId("txn", id)} of ${original.kind} ${toPublicId("txn", original.id)} "${original.title}"`,
          payload: {
            txnId: toPublicId("txn", id),
            reverses: toPublicId("txn", original.id),
            kind: original.kind,
            totalMinor: original.totalMinor,
            currency: original.currency,
          },
        }),
      }),
    );
    return postedTxnResponse(
      ctx,
      result,
      (txn) => txn.kind === "reversal" && txn.reverses === original.id && txn.createdBy === actor,
    );
  });
}

export async function handleFlagTxn(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.txn.flag");
  if (denied) return denied;
  const txnId = parsePublicId("txn", params[0]!);
  if (!txnId) return notFound(ctx.requestId);

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const reason = text(fields, "reason", body.reason, 500);
  if (reason === undefined) return validationError(ctx.requestId, fields.errors);

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getTxn(ctx.orgId, txnId, KITCHEN_ONLY));
    if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    const txn = found.value;

    const actor = ctx.actor.subjectId;
    if (!txn.splits.some((s) => s.subjectId === actor)) {
      return forbidden(ctx.requestId, "Only someone a transaction names can flag it", KITCHEN_ERROR_REASONS.NOT_A_PARTY);
    }

    const id = asUuid(crypto.randomUUID());
    const result = await ctx.timings.measure("db", () =>
      repo.createFlag({
        id,
        txnId,
        orgId: ctx.orgId,
        subjectId: actor,
        reason,
        idemKey: idem.key,
        now: ctx.now(),
        audit: ledgerAudit(ctx, {
          type: "kitchen.txn.flagged",
          subjectKind: "kitchen_flag",
          subjectId: id,
          idemKey: idem.key,
          description: `Flag ${toPublicId("flg", id)} on ${txn.kind} ${toPublicId("txn", txn.id)} "${txn.title}"`,
          payload: {
            flagId: toPublicId("flg", id),
            txnId: toPublicId("txn", txn.id),
            createdBy: txn.createdBy,
            reason,
          },
        }),
      }),
    );
    if (!result.ok) return unavailable(ctx.requestId);
    const { flag, replayed } = result.value;
    if (replayed && (flag.txnId !== txn.id || flag.subjectId !== actor)) return idempotencyKeyReused(ctx.requestId);
    return successResponse({ flag: toKitchenFlag(flag) }, ctx.requestId, 201);
  });
}
