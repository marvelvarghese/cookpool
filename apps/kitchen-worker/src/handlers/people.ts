import {
  DEFAULT_KITCHEN_CURRENCY,
  type GroupMembersResponse,
  type KitchenGroupRole,
  type MyBalancesResponse,
  type PersonGroupView,
  type PersonViewResponse,
} from "@saas/contracts/kitchen";
import type { KitchenRepository } from "@saas/db/kitchen";
import { requireGroupAction } from "../authz.js";
import type { OrgContext, RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import type { MemberGroup } from "../groups-client.js";
import { notFound, successResponse, unavailable } from "../http.js";
import { KITCHEN_ONLY, toEngineTxns } from "../ledger.js";
import { myBalances, peopleIn, personGroupView, planTotals, type GroupLedger } from "../people.js";

// People across groups (CP-9):
//
//   GET /v1/kitchen/me/balances               per group, per person, and totals per currency
//   GET /v1/kitchen/me/people/{usr}           the "why" between the caller and one person
//   GET /v1/organizations/{org}/kitchen/members    who is in a group, by name (kitchen.pantry.read)
//
// The personal reads cover every group membership says the caller is in with
// a group role — each of which holds kitchen.ledger.read (design.md §6) — so,
// like the all-pantries view, the role membership returns is the check rather
// than one policy hop per group. Each group's balances and plan are derived
// from its whole ledger by the money engine, the same way …/balances and
// …/settle-plan derive them, so the numbers here match Settle up. v1 reads
// every group's ledger on each call (risks CP-S): fine for a few small groups.

/** A public subject id as the edge forwards it (`usr_…`). */
const SUBJECT_ID_RE = /^[A-Za-z0-9][\w-]{0,127}$/;

/** The caller's groups by name; null when membership could not be read. */
async function myGroups(ctx: RequestContext): Promise<MemberGroup[] | null> {
  const result = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  if (!result.ok) return null;
  return [...result.groups].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

/**
 * Every group's members, currency and ledger, side by side. Null when any of
 * them could not be read: a total that silently left a group out would be wrong.
 */
async function loadLedgers(
  ctx: RequestContext,
  repo: KitchenRepository,
  groups: readonly MemberGroup[],
): Promise<GroupLedger[] | null> {
  const [rosters, [settings, splits]] = await Promise.all([
    ctx.timings.measure("roster", () => Promise.all(groups.map((g) => ctx.roster.members(g.orgId)))),
    ctx.timings.measure("db", () =>
      Promise.all([
        repo.listGroupSettings(groups.map((g) => g.orgId)),
        Promise.all(groups.map((g) => repo.listSplitsForGroup(g.orgId, KITCHEN_ONLY))),
      ]),
    ),
  ]);
  if (!settings.ok) return null;
  const currencies = new Map(settings.value.map((s) => [s.orgId, s.currency] as const));
  const ledgers: GroupLedger[] = [];
  for (const [i, group] of groups.entries()) {
    const roster = rosters[i]!;
    const ledger = splits[i]!;
    if (!roster.ok || !ledger.ok) return null;
    ledgers.push({
      group,
      currency: currencies.get(group.orgId) ?? DEFAULT_KITCHEN_CURRENCY,
      members: roster.members.map((m) => m.subjectId),
      txns: toEngineTxns(ledger.value),
    });
  }
  return ledgers;
}

export async function handleMyBalances(ctx: RequestContext): Promise<Response> {
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  if (groups.length === 0) {
    return successResponse<MyBalancesResponse>({ groups: [], people: [], totals: [] }, ctx.requestId);
  }

  return withKitchenRepo(ctx, async (repo) => {
    const ledgers = await loadLedgers(ctx, repo, groups);
    if (!ledgers) return unavailable(ctx.requestId);
    const me = ctx.actor.subjectId;
    const names = await ctx.timings.measure("identity", () => ctx.people.names(peopleIn(me, ledgers)));
    return successResponse<MyBalancesResponse>(myBalances(me, ledgers, names), ctx.requestId);
  });
}

export async function handlePerson(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  let otherId: string;
  try {
    otherId = decodeURIComponent(params[0] ?? "");
  } catch {
    return notFound(ctx.requestId);
  }
  const me = ctx.actor.subjectId;
  // Yourself, or an id that cannot be a person, is nobody you share a group with.
  if (!SUBJECT_ID_RE.test(otherId) || otherId === me) return notFound(ctx.requestId);

  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  if (groups.length === 0) return notFound(ctx.requestId);

  return withKitchenRepo(ctx, async (repo) => {
    const ledgers = await loadLedgers(ctx, repo, groups);
    if (!ledgers) return unavailable(ctx.requestId);

    const views = ledgers.flatMap((ledger) => {
      const view = personGroupView(me, otherId, ledger);
      return view ? [view] : [];
    });
    // Not in any of your groups, and no money with you in them: the same 404
    // as someone who does not exist.
    if (views.length === 0) return notFound(ctx.requestId);

    const thirds = views.flatMap((v) => (v.shortcut ? [v.shortcut.thirdId] : []));
    const names = await ctx.timings.measure("identity", () => ctx.people.names([otherId, ...thirds]));
    const groupsOut: PersonGroupView[] = views.map(({ shortcut, ...view }) => ({
      ...view,
      shortcutVia: shortcut
        ? {
            fromSubjectId: shortcut.fromSubjectId,
            viaSubjectId: shortcut.viaSubjectId,
            toSubjectId: shortcut.toSubjectId,
            amountMinor: shortcut.amountMinor,
            thirdDisplayName: names.get(shortcut.thirdId) ?? null,
          }
        : null,
    }));
    return successResponse<PersonViewResponse>(
      { subjectId: otherId, displayName: names.get(otherId) ?? null, groups: groupsOut, totals: planTotals(groupsOut) },
      ctx.requestId,
    );
  });
}

export async function handleGroupMembers(ctx: OrgContext): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
  if (denied) return denied;

  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
  if (!roster.ok) return unavailable(ctx.requestId);
  const names = await ctx.timings.measure("identity", () =>
    ctx.people.names(roster.members.map((m) => m.subjectId)),
  );
  return successResponse<GroupMembersResponse>(
    {
      members: roster.members.map((m) => ({
        subjectId: m.subjectId,
        displayName: names.get(m.subjectId) ?? null,
        role: m.role as KitchenGroupRole,
        // A membership-worker older than CP-9 does not send these yet.
        memberId: typeof m.memberId === "string" ? m.memberId : null,
        joinedAt: typeof m.joinedAt === "string" ? m.joinedAt : null,
      })),
    },
    ctx.requestId,
  );
}
