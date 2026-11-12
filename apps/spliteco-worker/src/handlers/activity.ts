// Activity (design §2):
//
//   GET /v1/spliteco/groups/{org}/activity   one group's changes, newest first
//   GET /v1/spliteco/me/activity             every group's, newest first
//
// Derived from the ledger rows themselves — nothing is stored twice. A new
// version reads as added, edited (with the total before), restored or moved
// in; a reversal as deleted, moved out or reversed (an edit's reversal is
// shown by its new version, not again). Cookpool's uses, dishes and waste read
// as `cookpool`, settlements as `settled`.

import type { SplitecoActivityAction, SplitecoActivityEntry, SplitecoActivityResponse } from "@saas/contracts/spliteco";
import type { SplitecoTxnRecord } from "@saas/db/spliteco";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { notFound, successResponse, unavailable } from "../http.js";
import { orgPublicId, parseOrgPublicId, txnPublicId } from "../ids.js";
import { groupLabel, withRepo } from "../ledger.js";
import type { MemberGroup } from "../membership.js";

const LIMIT = 200;

function actionOf(t: SplitecoTxnRecord): { action: SplitecoActivityAction; other: string | null } | null {
  if (t.kind === "reversal") {
    if (t.deletedAt) return { action: "deleted", other: null };
    if (t.reversedReplacedBy) return null;
    if (t.reversedMovedToOrg) return { action: "moved_out", other: t.reversedMovedToOrg };
    return { action: "reversed", other: null };
  }
  if (t.kind === "settlement") return { action: "settled", other: null };
  if (t.app === "cookpool") return { action: "cookpool", other: null };
  if (t.movedFrom) return { action: "moved_in", other: t.movedFromOrg };
  if (t.revises) return { action: t.revisedWasDeleted ? "restored" : "edited", other: null };
  return { action: "added", other: null };
}

export function activityEntries(rows: readonly SplitecoTxnRecord[], groups: readonly MemberGroup[], me: string): SplitecoActivityEntry[] {
  const byId = new Map<string, MemberGroup>(groups.map((g) => [g.orgId, g]));
  const inScope = new Set(rows.map((t) => t.orgId));
  const out: (SplitecoActivityEntry & { seq: number })[] = [];
  for (const t of rows) {
    const a = actionOf(t);
    if (!a) continue;
    // A move between two groups in this answer shows once, as moved in.
    if (a.action === "moved_out" && a.other && inScope.has(a.other)) continue;
    const mine = t.splits.find((s) => s.subjectId === me);
    const other = a.other ? byId.get(a.other) : undefined;
    out.push({
      txnId: txnPublicId(t.id),
      expenseId: txnPublicId(t.kind === "reversal" && t.reverses ? t.reverses : t.id),
      action: a.action,
      at: t.createdAt,
      actorId: t.createdBy,
      groupId: orgPublicId(t.orgId),
      groupName: groupLabel(byId.get(t.orgId)),
      title: t.title,
      totalMinor: t.totalMinor,
      currency: t.currency,
      previousTotalMinor: a.action === "edited" ? t.revisedTotalMinor : null,
      otherGroupId: a.other ? orgPublicId(a.other) : null,
      otherGroupName: other ? groupLabel(other) : null,
      myEffectMinor: mine ? mine.paidMinor - mine.owedMinor : 0,
      viaDelegation: t.viaDelegation,
      seq: t.seq,
    });
  }
  return out
    .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : y.seq - x.seq))
    .map(({ seq: _seq, ...entry }) => entry);
}

async function answer(ctx: RequestContext, orgIds: string[]): Promise<Response> {
  return withRepo(ctx, async (repo) => {
    const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
    if (!mine.ok) return unavailable(ctx.requestId);
    const scope = orgIds.length > 0 ? orgIds : mine.groups.map((g) => g.orgId);
    const rows = await ctx.timings.measure("db", () => repo.listTxns(scope, { limit: LIMIT }));
    const entries = activityEntries(rows, mine.groups, ctx.actor.subjectId);
    const ids = [...new Set(entries.map((e) => e.actorId))];
    const names = await ctx.people.names(ids);
    return successResponse<SplitecoActivityResponse>(
      { entries, people: ids.map((subjectId) => ({ subjectId, name: names.get(subjectId) ?? null })) },
      ctx.requestId,
    );
  });
}

export async function handleGroupActivity(ctx: RequestContext, orgParam: string): Promise<Response> {
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const denied = await requireOrgAction(ctx, orgId, "spliteco.ledger.read");
  if (denied) return denied;
  return answer(ctx, [orgId]);
}

export function handleMyActivity(ctx: RequestContext): Promise<Response> {
  return answer(ctx, []);
}
