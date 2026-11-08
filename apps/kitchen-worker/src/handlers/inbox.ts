import {
  DEFAULT_KITCHEN_CURRENCY,
  INBOX_EXPIRED_DAYS,
  INBOX_USE_SOON_DAYS,
  INBOX_USE_SOON_MAX,
  USUALS_DAYS,
  type InboxItem,
  type InboxResponse,
} from "@saas/contracts/kitchen";
import type { KitchenUsualRecord } from "@saas/db/kitchen";
import { settlePlan, type Payment } from "@saas/kitchen-engine/ledger";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { CLAIM_ROLES } from "../emails.js";
import { canUseIn, type MemberGroup } from "../groups-client.js";
import type { DisplayName } from "../identity-client.js";
import { successResponse, unavailable } from "../http.js";
import {
  INBOX_DISHES_LIMIT,
  INBOX_FLAGS_LIMIT,
  INBOX_USUALS_LIMIT,
  claimDishItem,
  countsOf,
  finalizeDishItem,
  flagItem,
  inOrder,
  isClaimable,
  isFinalizable,
  paymentsDue,
  useSoonItem,
} from "../inbox.js";
import { toEngineTxns } from "../ledger.js";
import { addDays, isoDay } from "../pantry.js";
import { readMyAsks } from "./asks.js";

// GET /v1/kitchen/me/inbox — Home's inbox (CP-19): dishes to claim or
// finalize, items to use soon, payments the caller owes and open flags on
// their entries, most urgent first (InboxResponse in @saas/contracts/kitchen).
//
// Like the other cross-group reads, "the caller's groups" is membership's
// answer, and the role it gives decides what they may act on (claim, use,
// finalize, record) instead of one policy hop per group; every action the
// cards lead to still goes through the policy engine. Nothing outside those
// groups is read: the dish, item and flag reads are scoped to them (and to
// the caller's own pantry and dishes), and only groups whose role allows it
// are offered for claiming, using and finalizing.
//
// A bounded number of reads, however many items, dishes or flags there are
// (risks CP-S, CP-T): one membership hop for the groups; on D1, two dish
// lists (three queries each: the dishes, their ingredients, their shares),
// the use-soon items, the usuals, the groups' settings, one ledger per group
// (`listSplitsForGroup`, the read balances already take), and the flags
// (`listOpenFlagsOnTxnsBy`) —
// 10 + one per group, side by side; then one identity lookup per 100 people
// for names. Server-Timing phases: groups, dishes, items, ledger, flags,
// identity.
//
// Ask before use (PN-8): the pending asks the caller answers ride in `asks`,
// for the top of To do — one more statement beside the rest (and the roster
// of a group where an owner or admin answers for a buyer who has left).

const DAY_MS = 86_400_000;

export async function handleInbox(ctx: RequestContext): Promise<Response> {
  const read = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  if (!read.ok) return unavailable(ctx.requestId);
  // By name, so payments due in different groups but of equal amounts read in a stable order.
  const groups = [...read.groups].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  const byOrg = new Map<string, MemberGroup>(groups.map((g) => [g.orgId, g]));
  const claimGroups = new Set<string>(groups.filter((g) => CLAIM_ROLES.has(g.role)).map((g) => g.orgId));
  const useGroups = groups.filter(canUseIn).map((g) => g.orgId);
  const me = ctx.actor.subjectId;
  const now = ctx.now();
  const today = isoDay(now);

  return withKitchenRepo(ctx, async (repo) => {
    const [[open, drafts], [soon, usuals], [settings, ledgers], flags, asks] = await Promise.all([
      ctx.timings.measure("dishes", () =>
        Promise.all([
          // The caller's own open dishes, and those open for claims where they may claim.
          repo.listDishes({ cook: me, orgIds: [...claimGroups], state: "open", cursor: null, limit: INBOX_DISHES_LIMIT }),
          repo.listDishes({ cook: me, orgIds: [], state: "draft", cursor: null, limit: INBOX_DISHES_LIMIT }),
        ]),
      ),
      ctx.timings.measure("items", () =>
        Promise.all([
          // Active items in the pantries the caller may use, soonest use-by first.
          repo.listItems({
            ownerSubjectId: me,
            orgIds: useGroups,
            q: null,
            expires: { from: addDays(today, -INBOX_EXPIRED_DAYS), to: addDays(today, INBOX_USE_SOON_DAYS) },
            cursor: null,
            limit: INBOX_USE_SOON_MAX,
          }),
          repo.usuals({
            subjectId: me,
            ownerSubjectId: me,
            orgIds: useGroups,
            since: new Date(now.getTime() - USUALS_DAYS * DAY_MS),
            limit: INBOX_USUALS_LIMIT,
          }),
        ]),
      ),
      ctx.timings.measure("ledger", () =>
        Promise.all([
          repo.listGroupSettings(groups.map((g) => g.orgId)),
          Promise.all(groups.map((g) => repo.listSplitsForGroup(g.orgId))),
        ]),
      ),
      ctx.timings.measure("flags", () =>
        repo.listOpenFlagsOnTxnsBy({ createdBy: me, orgIds: groups.map((g) => g.orgId), limit: INBOX_FLAGS_LIMIT }),
      ),
      // The asks the caller answers (PN-8), for the top of To do.
      readMyAsks(ctx, repo, groups, { mine: false }),
    ]);
    // A list that silently left something out would be wrong: any failed read is a 503.
    if (!open.ok || !drafts.ok || !soon.ok || !usuals.ok || !settings.ok || !flags.ok) return unavailable(ctx.requestId);
    if (ledgers.some((l) => !l.ok) || !asks) return unavailable(ctx.requestId);

    const claims = open.value.dishes.filter((d) => isClaimable(d, me, claimGroups));
    const mine = [...open.value.dishes, ...drafts.value.dishes].filter((d) => isFinalizable(d, me, byOrg));
    const currencies = new Map(settings.value.map((s) => [s.orgId, s.currency] as const));
    const plans: Array<{ group: MemberGroup; payments: Payment[] }> = groups.map((group, i) => {
      const ledger = ledgers[i]!;
      return { group, payments: ledger.ok ? settlePlan(toEngineTxns(ledger.value)).payments : [] };
    });
    const openFlags = flags.value.filter((f) => byOrg.has(f.orgId));

    // Everyone the cards name, in one lookup. Names are a nicety: a failed lookup names nobody.
    const named = [
      ...claims.map((d) => d.cook),
      ...(mine.length > 0 ? [me] : []),
      ...plans.flatMap(({ payments }) => payments.filter((p) => p.fromId === me).map((p) => p.toId)),
      ...openFlags.map((f) => f.flaggedBy),
    ];
    const names: ReadonlyMap<string, DisplayName> =
      named.length > 0 ? await ctx.timings.measure("identity", () => ctx.people.names(named)) : new Map();

    const usualOf = new Map<string, KitchenUsualRecord>(usuals.value.map((u) => [u.item.id, u]));
    const items: InboxItem[] = [
      ...soon.value.items.flatMap((record) => {
        // Only pantries the caller may use were read; an item somewhere else is never listed.
        const group = record.orgId ? byOrg.get(record.orgId) : undefined;
        if (record.orgId && (!group || !canUseIn(group))) return [];
        if (record.qtyLeftMilli <= 0 || !record.expiresOn) return [];
        return [useSoonItem(record, group ?? null, usualOf.get(record.id), today)];
      }),
      ...claims.map((d) => claimDishItem(d, byOrg, names)),
      ...mine.map((d) => finalizeDishItem(d, byOrg, names)),
      ...plans.flatMap(({ group, payments }) =>
        paymentsDue(me, group, currencies.get(group.orgId) ?? DEFAULT_KITCHEN_CURRENCY, payments, names),
      ),
      ...openFlags.map((f) => flagItem(f, byOrg.get(f.orgId)!, names)),
    ];

    const ordered = inOrder(items, today);
    return successResponse<InboxResponse>(
      { items: ordered, counts: countsOf(ordered), asks: asks.toAnswer.map((ask) => ({ kind: "ask", ask })) },
      ctx.requestId,
    );
  });
}
