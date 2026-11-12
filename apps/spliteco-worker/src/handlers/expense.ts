// One expense, as its breakdown screen reads it:
//
//   GET  /v1/spliteco/expenses/{txn}            the breakdown, items, adjustments, comments and history
//   POST /v1/spliteco/expenses/{txn}/comments   add a comment
//
// Any version can be read (an old one says what replaced it; a deleted one
// says until when it can be restored). A reversal's id reads as the version it
// reversed. Comments on every version of an expense show together.

import {
  SPLITECO_LIMITS,
  splitecoRestorableUntil,
  type SplitecoAdjustment,
  type SplitecoCommentResponse,
  type SplitecoExpenseDetail,
  type SplitecoExpenseResponse,
  type SplitecoExpenseState,
  type SplitecoHistoryEntry,
  type SplitecoItem,
} from "@saas/contracts/spliteco";
import { asUuid } from "@saas/db/ids";
import type { SplitecoRepository, SplitecoTxnRecord } from "@saas/db/spliteco";
import { buildSplitecoSplits } from "@saas/kitchen-engine/splits";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { specOf } from "../expense-input.js";
import { notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { newCommentId, orgPublicId, parseTxnPublicId, txnPublicId } from "../ids.js";
import { groupLabel, inputOf, isCurrent, isLocked, peopleOn, toSummary, withRepo } from "../ledger.js";
import { WRITE_ROLES } from "../membership.js";
import { Fields, text } from "../validate.js";

/** Load `txnParam` (a reversal reads as what it reversed); null when absent. */
async function load(repo: SplitecoRepository, txnParam: string): Promise<SplitecoTxnRecord | null> {
  const id = parseTxnPublicId(txnParam);
  if (!id) return null;
  const txn = await repo.getTxn(id);
  if (!txn) return null;
  if (txn.kind === "reversal" && txn.reverses) return repo.getTxn(txn.reverses);
  return txn;
}

/** Every version of the expense, oldest first. */
async function lineage(repo: SplitecoRepository, txn: SplitecoTxnRecord): Promise<SplitecoTxnRecord[]> {
  const back: SplitecoTxnRecord[] = [];
  let at: SplitecoTxnRecord | null = txn;
  for (let i = 0; i < 50 && at; i++) {
    const prev: string | null = at.revises ?? at.movedFrom;
    if (!prev) break;
    at = await repo.getTxn(prev);
    if (at) back.unshift(at);
  }
  const forward: SplitecoTxnRecord[] = [];
  at = txn;
  for (let i = 0; i < 50 && at; i++) {
    const next: string | null = at.replacedBy ?? at.movedTo;
    if (!next) break;
    at = await repo.getTxn(next);
    if (at) forward.push(at);
  }
  return [...back, txn, ...forward];
}

function stateOf(t: SplitecoTxnRecord): SplitecoExpenseState {
  if (t.replacedBy || t.movedTo) return "replaced";
  if (t.reversalDeletedAt) return "deleted";
  if (t.reversedBy) return "reversed";
  return "current";
}

async function history(repo: SplitecoRepository, versions: readonly SplitecoTxnRecord[]): Promise<SplitecoHistoryEntry[]> {
  const out: SplitecoHistoryEntry[] = [];
  for (const [i, v] of versions.entries()) {
    const action = i === 0 ? "added" : v.movedFrom ? "moved" : v.revisedWasDeleted ? "restored" : "edited";
    out.push({ action, at: v.createdAt, by: v.createdBy, txnId: txnPublicId(v.id), groupId: orgPublicId(v.orgId), totalMinor: v.totalMinor });
    if (v.reversalDeletedAt && v.reversedBy) {
      const reversal = await repo.getTxn(v.reversedBy);
      out.push({
        action: "deleted",
        at: v.reversalDeletedAt,
        by: reversal?.createdBy ?? v.createdBy,
        txnId: txnPublicId(v.reversedBy),
        groupId: orgPublicId(v.orgId),
        totalMinor: v.totalMinor,
      });
    }
  }
  return out;
}

export async function handleExpense(ctx: RequestContext, txnParam: string): Promise<Response> {
  return withRepo(ctx, async (repo) => {
    const txn = await ctx.timings.measure("db", () => load(repo, txnParam));
    if (!txn) return notFound(ctx.requestId);
    const denied = await requireOrgAction(ctx, asUuid(txn.orgId), "spliteco.ledger.read");
    if (denied) return denied;
    const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
    if (!mine.ok) return unavailable(ctx.requestId);
    const group = mine.groups.find((g) => g.orgId === txn.orgId);

    const versions = await ctx.timings.measure("db", () => lineage(repo, txn));
    const [details, comments, steps] = await Promise.all([
      repo.items([txn.id]),
      repo.comments(versions.map((v) => v.id)),
      history(repo, versions),
    ]);
    const input = inputOf(txn);
    const state = stateOf(txn);
    const last = versions[versions.length - 1]!;

    // The per-person breakdown and each item's shares, re-derived by the
    // engine from what was saved (the same numbers the splits hold).
    const built = input ? buildSplitecoSplits(input.totalMinor, input.payers, specOf(input.split)) : null;
    const paid = new Map(txn.splits.map((s) => [s.subjectId, s.paidMinor]));
    const breakdown: SplitecoExpenseDetail["breakdown"] =
      built && built.ok
        ? built.result.breakdown.map((b) => ({ ...b, paidMinor: paid.get(b.subjectId) ?? 0 }))
        : txn.splits.map((s) => ({ subjectId: s.subjectId, itemsMinor: s.owedMinor, adjustmentsMinor: 0, owedMinor: s.owedMinor, paidMinor: s.paidMinor }));
    for (const s of txn.splits) {
      if (!breakdown.some((b) => b.subjectId === s.subjectId)) {
        breakdown.push({ subjectId: s.subjectId, itemsMinor: 0, adjustmentsMinor: 0, owedMinor: 0, paidMinor: s.paidMinor });
      }
    }
    const items: SplitecoItem[] = details.items.map((item, i) => {
      const amounts = built && built.ok ? built.result.items[i]?.amounts ?? [] : [];
      return {
        position: item.position,
        name: item.name,
        qty: item.qty,
        unitMinor: item.unitMinor,
        totalMinor: item.totalMinor,
        shares: details.shares
          .filter((s) => s.itemPosition === item.position)
          .map((s) => ({
            subjectId: s.subjectId,
            mode: s.mode,
            value: s.value,
            // Cookpool's item rows (SE3) carry exact amounts and no request to re-derive them from.
            amountMinor: amounts.find((a) => a.subjectId === s.subjectId)?.amountMinor ?? (s.mode === "exact" ? s.value : 0),
          })),
      };
    });
    const adjustments: SplitecoAdjustment[] = details.adjustments.map((a) => ({ kind: a.kind, label: a.label, amountMinor: a.amountMinor }));

    const ids = new Set([...peopleOn([txn]), ...comments.map((c) => c.subjectId), ...steps.map((s) => s.by)]);
    const names = await ctx.people.names([...ids]);
    const expense: SplitecoExpenseDetail = {
      ...toSummary(txn, groupLabel(group), ctx.actor.subjectId),
      note: txn.note,
      state,
      deletedAt: state === "deleted" ? txn.reversalDeletedAt : null,
      restorableUntil: state === "deleted" && txn.reversalDeletedAt ? splitecoRestorableUntil(txn.reversalDeletedAt) : null,
      currentId: state === "replaced" && isCurrent(last) ? txnPublicId(last.id) : null,
      breakdown,
      input,
      items,
      adjustments,
    };
    return successResponse<SplitecoExpenseResponse>(
      {
        expense,
        comments: comments.map((c) => ({ id: c.id, txnId: txnPublicId(c.txnId), subjectId: c.subjectId, body: c.body, createdAt: c.createdAt })),
        history: steps,
        people: [...ids].map((subjectId) => ({ subjectId, name: names.get(subjectId) ?? null })),
        canWrite: !!group && WRITE_ROLES.has(group.role) && !isLocked(txn),
      },
      ctx.requestId,
    );
  });
}

export async function handleAddComment(ctx: RequestContext, request: Request, txnParam: string): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const text_ = text(fields, "body", body.body, SPLITECO_LIMITS.comment);
  if (!fields.ok || text_ === undefined) return validationError(ctx.requestId, fields.errors);
  return withRepo(ctx, async (repo) => {
    const txn = await load(repo, txnParam);
    if (!txn) return notFound(ctx.requestId);
    const denied = await requireOrgAction(ctx, asUuid(txn.orgId), "spliteco.expense.write");
    if (denied) return denied;
    const comment = await ctx.timings.measure("db", () =>
      repo.addComment({
        id: newCommentId(),
        txnId: txn.id,
        orgId: txn.orgId,
        subjectId: ctx.actor.subjectId,
        body: text_,
        createdAt: ctx.now().toISOString(),
      }),
    );
    return successResponse<SplitecoCommentResponse>(
      { comment: { id: comment.id, txnId: txnPublicId(comment.txnId), subjectId: comment.subjectId, body: comment.body, createdAt: comment.createdAt } },
      ctx.requestId,
      201,
    );
  });
}
