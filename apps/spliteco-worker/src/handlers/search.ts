// Search (cookpool-spliteco SE-6): GET /v1/spliteco/me/search?q=&groupId=&limit=
//
// The caller's current expenses and payments whose title or note holds every
// word of `q` (case-insensitive), newest first — across every group they are
// in, or one (`groupId`, which needs the group's ledger.read). For an
// assistant's search_expenses tool (money.read), and anyone else.

import type { SplitecoSearchResponse } from "@saas/contracts/spliteco";
import type { Uuid } from "@saas/db/ids";
import type { MemberGroup } from "../membership.js";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { notFound, successResponse, unavailable, validationError } from "../http.js";
import { parseOrgPublicId } from "../ids.js";
import { groupLabel, isCurrent, toSummary, withRepo } from "../ledger.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_QUERY = 100;

export async function handleSearch(ctx: RequestContext, url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length > MAX_QUERY) return validationError(ctx.requestId, { q: [`At most ${MAX_QUERY} characters`] });
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return validationError(ctx.requestId, { limit: [`Must be 1 to ${MAX_LIMIT}`] });
  const groupParam = url.searchParams.get("groupId");
  let only: Uuid | null = null;
  if (groupParam) {
    only = parseOrgPublicId(groupParam);
    if (!only) return notFound(ctx.requestId);
    const denied = await requireOrgAction(ctx, only, "spliteco.ledger.read");
    if (denied) return denied;
  }

  return withRepo(ctx, async (repo) => {
    const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
    if (!mine.ok) return unavailable(ctx.requestId);
    const byId = new Map<string, MemberGroup>(mine.groups.map((g) => [g.orgId, g]));
    const scope: string[] = only ? [only] : mine.groups.map((g) => g.orgId);
    const rows = await ctx.timings.measure("db", () => repo.listTxns(scope));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = rows
      .filter((t) => isCurrent(t) && (t.kind === "expense" || t.kind === "settlement" || t.kind === "use" || t.kind === "dish" || t.kind === "waste"))
      .filter((t) => {
        if (words.length === 0) return true;
        const hay = `${t.title} ${t.note ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : b.seq - a.seq));
    const page = matches.slice(0, limit);
    const expenses = page.map((t) => toSummary(t, groupLabel(byId.get(t.orgId)), ctx.actor.subjectId));
    const ids = [...new Set(page.flatMap((t) => [t.createdBy, ...t.splits.map((s) => s.subjectId)]))];
    const names = await ctx.people.names(ids);
    return successResponse<SplitecoSearchResponse>(
      { expenses, people: ids.map((subjectId) => ({ subjectId, name: names.get(subjectId) ?? null })), more: matches.length > limit },
      ctx.requestId,
    );
  });
}
