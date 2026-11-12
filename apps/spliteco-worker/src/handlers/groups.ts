// Groups, friends and Home (design §2):
//
//   GET  /v1/spliteco/me/home                 totals per currency, everyone you have money with
//   GET  /v1/spliteco/me/groups               every group you're in (kitchens too) and your friends
//   POST /v1/spliteco/groups                  make a group in Spliteco (made_in = spliteco)
//   GET  /v1/spliteco/groups/{org}            balances, the simplified plan, the expenses
//   GET  /v1/spliteco/me/friends/{usr}        the balance across every group you share
//   POST /v1/spliteco/me/friends/{usr}/direct the two-person group outside any group, made on first use
//
// Every balance is the kitchen engine's over every row of the group's ledger,
// as kitchen-worker computes it, so the two apps agree to the paisa. Money is
// never summed across currencies.

import {
  SPLITECO_CREATE_KINDS,
  SPLITECO_ERROR_REASONS,
  SPLITECO_LIMITS,
  type SplitecoCreateGroupResponse,
  type SplitecoDirectGroupResponse,
  type SplitecoFriendBalance,
  type SplitecoFriendResponse,
  type SplitecoGroupResponse,
  type SplitecoGroupSummary,
  type SplitecoGroupsResponse,
  type SplitecoHomeResponse,
  type SplitecoMoney,
} from "@saas/contracts/spliteco";
import type { SplitecoTxnRecord } from "@saas/db/spliteco";
import { pairLines } from "@saas/kitchen-engine/ledger";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { forbidden, notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { orgPublicId, parseOrgPublicId } from "../ids.js";
import {
  BUCKETS,
  bucketPlan,
  bucketRows,
  bucketedPlan,
  byGroup,
  currencyOf,
  engineTxns,
  groupBalances,
  groupLabel,
  isCurrent,
  myPlan,
  peopleOn,
  kitchenView,
  toSummary,
  withRepo,
} from "../ledger.js";
import { WRITE_ROLES, createOrganization, directGroup, type MemberGroup } from "../membership.js";
import { Fields, oneOf, text } from "../validate.js";

const SUBJECT_RE = /^[A-Za-z0-9][\w-]{0,127}$/;

export function groupSummary(group: MemberGroup, rows: readonly SplitecoTxnRecord[], currency: string, me: string, simplify = true): SplitecoGroupSummary {
  return {
    id: group.publicId,
    name: groupLabel(group),
    kind: group.kind,
    madeIn: group.madeIn,
    role: group.role,
    currency,
    memberCount: group.members.length,
    myBalanceMinor: groupBalances(rows).get(me) ?? 0,
    myPlan: myPlan(rows, me, simplify),
    myBuckets:
      group.madeIn === "cookpool"
        ? {
            kitchen: groupBalances(bucketRows(rows, "kitchen")).get(me) ?? 0,
            other: groupBalances(bucketRows(rows, "other")).get(me) ?? 0,
          }
        : null,
  };
}

/** What each other person owes me (+) or I owe them (−), per group, from the pairwise lines. */
function pairwise(rows: readonly SplitecoTxnRecord[], me: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of pairLines(engineTxns(rows))) {
    if (line.creditorId === me) out.set(line.debtorId, (out.get(line.debtorId) ?? 0) + line.amountMinor);
    else if (line.debtorId === me) out.set(line.creditorId, (out.get(line.creditorId) ?? 0) - line.amountMinor);
  }
  return out;
}

function addMoney(list: SplitecoMoney[], currency: string, amount: number): void {
  const at = list.find((m) => m.currency === currency);
  if (at) at.amountMinor += amount;
  else list.push({ currency, amountMinor: amount });
}

/** Everyone the caller has money with or shares a group with, with names, largest first. */
async function friendsOf(
  ctx: RequestContext,
  groups: readonly MemberGroup[],
  rowsByOrg: Map<string, SplitecoTxnRecord[]>,
  currencies: Map<string, string>,
  { includeZero }: { includeZero: boolean },
): Promise<SplitecoFriendBalance[]> {
  const me = ctx.actor.subjectId;
  const friends = new Map<string, { balances: SplitecoMoney[]; groupNames: Set<string>; outside: boolean }>();
  const entry = (id: string) => {
    let f = friends.get(id);
    if (!f) {
      f = { balances: [], groupNames: new Set(), outside: false };
      friends.set(id, f);
    }
    return f;
  };
  for (const group of groups) {
    const rows = rowsByOrg.get(group.orgId) ?? [];
    const currency = currencyOf(currencies, group.orgId);
    if (includeZero) {
      for (const m of group.members) {
        if (m.subjectId === me) continue;
        const f = entry(m.subjectId);
        if (group.kind === "direct") f.outside = true;
        else f.groupNames.add(group.name);
      }
    }
    for (const [other, amount] of pairwise(rows, me)) {
      if (amount === 0) continue;
      const f = entry(other);
      addMoney(f.balances, currency, amount);
      if (group.kind === "direct") f.outside = true;
      else f.groupNames.add(group.name);
    }
  }
  const names = await ctx.people.names([...friends.keys()]);
  return [...friends.entries()]
    .map(([subjectId, f]) => ({
      subjectId,
      name: names.get(subjectId) ?? null,
      balances: f.balances.filter((b) => b.amountMinor !== 0),
      groupNames: [...f.groupNames].sort(),
      outsideGroups: f.outside,
    }))
    .filter((f) => includeZero || f.balances.length > 0)
    .sort((a, b) => {
      const size = (f: SplitecoFriendBalance) => Math.max(0, ...f.balances.map((x) => Math.abs(x.amountMinor)));
      return size(b) - size(a) || (a.name ?? a.subjectId).localeCompare(b.name ?? b.subjectId);
    });
}

type Everything =
  | {
      ok: true;
      groups: MemberGroup[];
      rowsByOrg: Map<string, SplitecoTxnRecord[]>;
      currencies: Map<string, string>;
      /** Whether each group simplifies debts (SE2). */
      simplify: Map<string, boolean>;
    }
  | { ok: false; response: Response };

async function loadEverything(ctx: RequestContext, repo: Parameters<Parameters<typeof withRepo>[1]>[0]): Promise<Everything> {
  const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
  if (!mine.ok) return { ok: false, response: unavailable(ctx.requestId) };
  const orgIds = mine.groups.map((g) => g.orgId);
  const [rows, currencies, settings] = await ctx.timings.measure("db", () =>
    Promise.all([repo.listTxns(orgIds), repo.currencies(orgIds), repo.groupSettings(orgIds)]),
  );
  const simplify = new Map([...settings].map(([orgId, s]) => [orgId, s.simplifyDebts]));
  return { ok: true, groups: mine.groups, rowsByOrg: byGroup(rows), currencies, simplify };
}

export function handleHome(ctx: RequestContext): Promise<Response> {
  return withRepo(ctx, async (repo) => {
    const all = await loadEverything(ctx, repo);
    if (!all.ok) return all.response;
    const me = ctx.actor.subjectId;
    const people = await friendsOf(ctx, all.groups, all.rowsByOrg, all.currencies, { includeZero: false });
    // As Splitwise reads it, and as the people listed below add up: what each
    // person owes you (+) or you owe them (−), summed per currency. The net is
    // also the sum of your group balances.
    const totals = new Map<string, { owedToYouMinor: number; youOweMinor: number }>();
    for (const group of all.groups) {
      const currency = currencyOf(all.currencies, group.orgId);
      if (!totals.has(currency)) totals.set(currency, { owedToYouMinor: 0, youOweMinor: 0 });
    }
    for (const person of people) {
      for (const b of person.balances) {
        const t = totals.get(b.currency) ?? { owedToYouMinor: 0, youOweMinor: 0 };
        if (b.amountMinor > 0) t.owedToYouMinor += b.amountMinor;
        else t.youOweMinor -= b.amountMinor;
        totals.set(b.currency, t);
      }
    }
    const name = (await ctx.people.names([me])).get(me) ?? null;
    return successResponse<SplitecoHomeResponse>(
      {
        me: { subjectId: me, name },
        totals: [...totals.entries()]
          .map(([currency, t]) => ({ currency, ...t, netMinor: t.owedToYouMinor - t.youOweMinor }))
          .filter((t) => t.owedToYouMinor !== 0 || t.youOweMinor !== 0 || totals.size === 1),
        people,
      },
      ctx.requestId,
    );
  });
}

export function handleGroups(ctx: RequestContext): Promise<Response> {
  return withRepo(ctx, async (repo) => {
    const all = await loadEverything(ctx, repo);
    if (!all.ok) return all.response;
    const me = ctx.actor.subjectId;
    const groups = all.groups
      .filter((g) => g.kind !== "direct")
      .map((g) => groupSummary(g, all.rowsByOrg.get(g.orgId) ?? [], currencyOf(all.currencies, g.orgId), me, all.simplify.get(g.orgId) ?? true))
      .sort((a, b) => a.name.localeCompare(b.name));
    const friends = await friendsOf(ctx, all.groups, all.rowsByOrg, all.currencies, { includeZero: true });
    return successResponse<SplitecoGroupsResponse>({ groups, friends }, ctx.requestId);
  });
}

export async function handleCreateGroup(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const name = text(fields, "name", body.name, SPLITECO_LIMITS.groupName);
  const kind = oneOf(fields, "kind", body.kind, SPLITECO_CREATE_KINDS);
  if (!fields.ok || name === undefined || !kind) return validationError(ctx.requestId, fields.errors);
  if (!ctx.env.MEMBERSHIP_WORKER) return unavailable(ctx.requestId);
  const made = await ctx.timings.measure("membership", () =>
    createOrganization(ctx.env.MEMBERSHIP_WORKER!, ctx.actor, ctx.requestId, { name, kind }),
  );
  if (!made.ok) {
    // Membership's own refusals (the per-person cap) reach the app as they are.
    if (made.status >= 400 && made.status < 500 && made.body && typeof made.body === "object") {
      return Response.json(made.body, { status: made.status });
    }
    return unavailable(ctx.requestId);
  }
  const orgId = parseOrgPublicId(made.orgPublicId);
  if (!orgId) return unavailable(ctx.requestId);
  return successResponse<SplitecoCreateGroupResponse>(
    {
      group: {
        id: made.orgPublicId,
        name: made.name,
        kind,
        madeIn: "spliteco",
        role: "owner",
        currency: "INR",
        memberCount: 1,
        myBalanceMinor: 0,
        myPlan: [],
        myBuckets: null,
      },
    },
    ctx.requestId,
    201,
  );
}

/**
 * GET /v1/spliteco/groups/{org}. With `?bucket=kitchen` (Cookpool's Money
 * tab, SE3) it is the group as Cookpool shows it: the Kitchen balance's rows
 * only — balances, plan, expenses and totals — and one bucket; a group made
 * in Spliteco is not found.
 */
export async function handleGroup(ctx: RequestContext, orgParam: string, url?: URL): Promise<Response> {
  const orgId = parseOrgPublicId(orgParam);
  if (!orgId) return notFound(ctx.requestId);
  const denied = await requireOrgAction(ctx, orgId, "spliteco.ledger.read");
  if (denied) return denied;
  return withRepo(ctx, async (repo) => {
    const mine = await ctx.timings.measure("membership", () => ctx.groups.of(ctx.actor.subjectId));
    if (!mine.ok) return unavailable(ctx.requestId);
    const group = mine.groups.find((g) => g.orgId === orgId);
    if (!group) return notFound(ctx.requestId);
    const kitchen = kitchenView(url);
    if (kitchen && group.madeIn !== "cookpool") return notFound(ctx.requestId);
    const memberIdList = group.members.map((m) => m.subjectId);
    const me = ctx.actor.subjectId;
    const [all, currencies, settings, profiles, reminders] = await ctx.timings.measure("db", () =>
      Promise.all([
        repo.listTxns([orgId]),
        repo.currencies([orgId]),
        repo.groupSettings([orgId]),
        repo.profiles(memberIdList),
        repo.lastReminders(me, memberIdList.filter((id) => id !== me)),
      ]),
    );
    const rows = kitchen ? bucketRows(all, "kitchen") : all;
    const simplify = settings.get(orgId)?.simplifyDebts ?? true;
    const currency = currencyOf(currencies, orgId);
    const label = groupLabel(group);

    // Every member at zero if they have no rows, and anyone no longer in the
    // group whose balance is not zero — as kitchen-worker's balances answer.
    const byPerson = new Map<string, number>(group.members.map((m) => [m.subjectId, 0]));
    for (const [subjectId, amount] of groupBalances(rows)) {
      if (amount !== 0 || byPerson.has(subjectId)) byPerson.set(subjectId, amount);
    }
    const current = rows.filter(isCurrent);
    const memberIds = new Set(group.members.map((m) => m.subjectId));
    const others = peopleOn(current).filter((id) => !memberIds.has(id));
    const names = await ctx.people.names([...memberIds, ...others]);
    return successResponse<SplitecoGroupResponse>(
      {
        group: groupSummary(group, rows, currency, me, simplify),
        members: group.members.map((m) => ({ subjectId: m.subjectId, name: names.get(m.subjectId) ?? null, role: m.role })),
        balances: [...byPerson.entries()]
          .map(([subjectId, balanceMinor]) => ({ subjectId, balanceMinor }))
          .sort((a, b) => b.balanceMinor - a.balanceMinor || (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0)),
        plan: bucketedPlan(rows, simplify).map((p) => ({ fromSubjectId: p.fromId, toSubjectId: p.toId, amountMinor: p.amountMinor })),
        buckets:
          group.madeIn === "cookpool"
            ? (kitchen ? (["kitchen"] as const) : BUCKETS).map((bucket) => {
                const own = bucketRows(rows, bucket);
                const bal = groupBalances(own);
                return {
                  bucket,
                  balances: [...new Set([...group.members.map((m) => m.subjectId), ...bal.keys()])]
                    .map((subjectId) => ({ subjectId, balanceMinor: bal.get(subjectId) ?? 0 }))
                    .filter((b) => b.balanceMinor !== 0 || memberIds.has(b.subjectId))
                    .sort((a, b) => b.balanceMinor - a.balanceMinor || (a.subjectId < b.subjectId ? -1 : 1)),
                  plan: bucketPlan(rows, bucket, simplify).map((p) => ({ fromSubjectId: p.fromId, toSubjectId: p.toId, amountMinor: p.amountMinor })),
                  myBalanceMinor: bal.get(me) ?? 0,
                };
              })
            : null,
        totalSpentMinor: current.filter((t) => t.kind !== "settlement").reduce((s, t) => s + t.totalMinor, 0),
        expenses: [...current].reverse().map((t) => toSummary(t, label, me)),
        people: others.map((subjectId) => ({ subjectId, name: names.get(subjectId) ?? null })),
        canWrite: WRITE_ROLES.has(group.role),
        settings: { simplifyDebts: simplify },
        upi: memberIdList.flatMap((subjectId) => {
          const vpa = profiles.get(subjectId)?.upiVpa;
          return vpa ? [{ subjectId, upiVpa: vpa }] : [];
        }),
        reminded: [...reminders.values()].map((r) => ({ subjectId: r.toSubject, sentAt: r.sentAt })),
      },
      ctx.requestId,
    );
  });
}

export function handleFriend(ctx: RequestContext, usrParam: string): Promise<Response> {
  return withRepo(ctx, async (repo) => {
    let friendId: string;
    try {
      friendId = decodeURIComponent(usrParam);
    } catch {
      return notFound(ctx.requestId);
    }
    const me = ctx.actor.subjectId;
    if (!SUBJECT_RE.test(friendId) || friendId === me) return notFound(ctx.requestId);
    const all = await loadEverything(ctx, repo);
    if (!all.ok) return all.response;
    const shared = all.groups.filter((g) => {
      const rows = all.rowsByOrg.get(g.orgId) ?? [];
      return g.members.some((m) => m.subjectId === friendId) || rows.some((t) => t.splits.some((s) => s.subjectId === friendId));
    });
    if (shared.length === 0) return notFound(ctx.requestId);

    const balances: SplitecoMoney[] = [];
    const byGroupLines: SplitecoFriendResponse["byGroup"] = [];
    const expenses: SplitecoFriendResponse["expenses"] = [];
    const plans: SplitecoFriendResponse["plans"] = [];
    for (const group of shared) {
      const rows = all.rowsByOrg.get(group.orgId) ?? [];
      const currency = currencyOf(all.currencies, group.orgId);
      const amount = pairwise(rows, me).get(friendId) ?? 0;
      addMoney(balances, currency, amount);
      byGroupLines.push({ groupId: group.publicId, groupName: groupLabel(group), kind: group.kind, currency, amountMinor: amount });
      for (const p of bucketedPlan(rows, all.simplify.get(group.orgId) ?? true)) {
        if ((p.fromId === me && p.toId === friendId) || (p.fromId === friendId && p.toId === me)) {
          plans.push({ groupId: group.publicId, groupName: groupLabel(group), currency, fromSubjectId: p.fromId, toSubjectId: p.toId, amountMinor: p.amountMinor });
        }
      }
      for (const t of rows) {
        if (!isCurrent(t)) continue;
        const ids = new Set(t.splits.map((s) => s.subjectId));
        if (ids.has(me) && ids.has(friendId)) expenses.push(toSummary(t, groupLabel(group), me));
      }
    }
    expenses.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
    const direct = shared.find((g) => g.kind === "direct");
    // Their UPI ID only while the two still share a group (SE2).
    const sharesNow = shared.some((g) => g.members.some((m) => m.subjectId === friendId));
    const [name, profiles, reminders] = await Promise.all([
      ctx.people.names([friendId]).then((n) => n.get(friendId) ?? null),
      sharesNow ? repo.profiles([friendId]) : Promise.resolve(new Map<string, { upiVpa: string | null }>()),
      repo.lastReminders(me, [friendId]),
    ]);
    return successResponse<SplitecoFriendResponse>(
      {
        friend: { subjectId: friendId, name },
        balances: balances.filter((b) => b.amountMinor !== 0),
        byGroup: byGroupLines,
        directGroupId: direct ? direct.publicId : null,
        expenses,
        upiVpa: profiles.get(friendId)?.upiVpa ?? null,
        lastRemindedAt: reminders.get(friendId)?.sentAt ?? null,
        plans: plans.sort((a, b) => b.amountMinor - a.amountMinor),
      },
      ctx.requestId,
    );
  });
}

export function handleDirectGroup(ctx: RequestContext, usrParam: string): Promise<Response> {
  return withRepo(ctx, async (repo) => {
    let friendId: string;
    try {
      friendId = decodeURIComponent(usrParam);
    } catch {
      return notFound(ctx.requestId);
    }
    const me = ctx.actor.subjectId;
    if (!SUBJECT_RE.test(friendId) || friendId === me) return notFound(ctx.requestId);
    if (!ctx.env.MEMBERSHIP_WORKER) return unavailable(ctx.requestId);
    const mine = await ctx.timings.measure("membership", () => ctx.groups.of(me));
    if (!mine.ok) return unavailable(ctx.requestId);
    const sharesOne = mine.groups.some((g) => g.members.some((m) => m.subjectId === friendId));
    if (!sharesOne) {
      return forbidden(ctx.requestId, "You can split outside groups only with someone you share a group with", SPLITECO_ERROR_REASONS.NO_SHARED_GROUP);
    }
    const made = await ctx.timings.measure("membership", () =>
      directGroup(ctx.env.MEMBERSHIP_WORKER!, ctx.requestId, { id: me, type: ctx.actor.subjectType }, { id: friendId, type: "user" }),
    );
    if (!made) return unavailable(ctx.requestId);
    const orgId = parseOrgPublicId(made.organization.orgId);
    if (!orgId) return unavailable(ctx.requestId);
    const [rows, currencies, settings] = await Promise.all([repo.listTxns([orgId]), repo.currencies([orgId]), repo.groupSettings([orgId])]);
    const group: MemberGroup = {
      orgId,
      publicId: orgPublicId(orgId),
      name: made.organization.name,
      slug: made.organization.slug,
      role: "owner",
      madeIn: "spliteco",
      kind: "direct",
      members: [
        { subjectId: me, role: "owner" },
        { subjectId: friendId, role: "owner" },
      ],
    };
    return successResponse<SplitecoDirectGroupResponse>(
      { group: groupSummary(group, rows, currencyOf(currencies, orgId), me, settings.get(orgId)?.simplifyDebts ?? true) },
      ctx.requestId,
      made.created ? 201 : 200,
    );
  });
}

