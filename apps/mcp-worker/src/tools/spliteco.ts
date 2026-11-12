// Spliteco's tools (cookpool-spliteco SE-6, design §0.9, §0.10, risk SE-F).
//
// Reads (money.read): find_people, list_groups, get_balances,
// search_expenses, get_activity, get_insights, and settle_up — which reads
// nothing and only answers a link into the app.
//
// Writes (money.write), never a payment:
//   - draft_expense, edit_expense and move_expense DRAFT: they answer the
//     split as it would save and a draft token, and save nothing;
//   - save_expense takes only a draft token, so nothing saves that the person
//     was not shown first (spliteco-worker refuses an assistant's direct add,
//     edit and move with `draft_required`, and api-edge never routes them);
//   - delete_expense (soft: restorable for 30 days) and restore_expense;
//   - add_comment and send_reminder (one per person per day).
//
// No tool here calls a payment route: settling up happens in the app
// (settle_up answers https://cookpool-spliteco-web-<env>…/settle?…), and
// api-edge and spliteco-worker refuse an assistant's payment anyway.

import { z } from "zod";
import {
  SPLITECO_ADJUSTMENT_KINDS,
  SPLITECO_CATEGORIES,
  SPLITECO_DRAFT_MINUTES,
  SPLITECO_ITEM_SHARE_MODES,
  SPLITECO_LIMITS,
  SPLITECO_RESTORE_DAYS,
  type SplitecoActivityResponse,
  type SplitecoCommentResponse,
  type SplitecoDraft,
  type SplitecoDraftResponse,
  type SplitecoExpenseSummary,
  type SplitecoFriendResponse,
  type SplitecoGroupResponse,
  type SplitecoGroupsResponse,
  type SplitecoHomeResponse,
  type SplitecoInsightsResponse,
  type SplitecoPerson,
  type SplitecoReminderResponse,
  type SplitecoSearchResponse,
  type SplitecoWriteResponse,
} from "@saas/contracts/spliteco";
import type { Env } from "../env.js";
import type { EdgeError } from "../edge.js";
import { listNames, money, plural } from "../format.js";
import { defineTool, edge, type ToolContext } from "./types.js";

const ORG_RE = /^org_[0-9a-f]{32}$/;
const TXN_RE = /^txn_[0-9a-f]{32}$/;
const USR_RE = /^usr_[A-Za-z0-9]{1,64}$/;
const DRAFT_RE = /^drf_[0-9a-f]{32}$/;

const groupId = () => z.string().regex(ORG_RE).describe("A group's id (org_…) from list_groups");
const expenseId = () => z.string().regex(TXN_RE).describe("An expense's id (txn_…) from search_expenses or get_activity");
const personId = () => z.string().regex(USR_RE).describe("A person's id (usr_…) from find_people");
const minor = (what: string) =>
  z.number().int().min(0).describe(`${what}, in minor units of the group's currency (paise for INR: ₹3,200 is 320000)`);

// ── The expense, as the API takes it (six splits, several payers) ──

const splitSchema = z
  .discriminatedUnion("method", [
    z.object({ method: z.literal("equal"), participants: z.array(personId()).min(1).max(SPLITECO_LIMITS.people) }),
    z.object({
      method: z.literal("exact"),
      participants: z.array(z.object({ subjectId: personId(), amountMinor: minor("Their share") })).min(1).max(SPLITECO_LIMITS.people),
    }),
    z.object({
      method: z.literal("pct"),
      participants: z
        .array(z.object({ subjectId: personId(), basisPoints: z.number().int().min(0).max(10000).describe("Percent ×100: 25% is 2500") }))
        .min(1)
        .max(SPLITECO_LIMITS.people),
    }),
    z.object({
      method: z.literal("shares"),
      participants: z.array(z.object({ subjectId: personId(), shares: z.number().int().min(0).max(1000) })).min(1).max(SPLITECO_LIMITS.people),
    }),
    z.object({
      method: z.literal("adjust"),
      participants: z
        .array(z.object({ subjectId: personId(), adjustMinor: z.number().int().describe("Added to (or, negative, taken off) an equal share, in minor units") }))
        .min(1)
        .max(SPLITECO_LIMITS.people),
    }),
    z.object({
      method: z.literal("items"),
      items: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(SPLITECO_LIMITS.itemName),
            qty: z.number().positive().max(10000).optional(),
            unitMinor: minor("The price of one").nullable().optional(),
            totalMinor: minor("The item's total"),
            shares: z
              .array(
                z.object({
                  subjectId: personId(),
                  mode: z.enum(SPLITECO_ITEM_SHARE_MODES).describe("portion (value ×1000: 1 portion is 1000), pct (basis points) or exact (minor units)"),
                  value: z.number().int().min(0),
                }),
              )
              .max(SPLITECO_LIMITS.people),
          }),
        )
        .min(1)
        .max(SPLITECO_LIMITS.items),
      adjustments: z
        .array(z.object({ kind: z.enum(SPLITECO_ADJUSTMENT_KINDS), label: z.string().trim().min(1).max(SPLITECO_LIMITS.itemName), amountMinor: minor("Always positive; a discount is taken off") }))
        .max(SPLITECO_LIMITS.adjustments),
    }),
  ])
  .describe("How it is split: equal, exact, pct, shares, adjust (equal ± amounts) or items (itemized, with tax, service and discount)");

const expenseSchema = z
  .object({
    title: z.string().trim().min(1).max(SPLITECO_LIMITS.title).describe('What it was: "Sunset cruise"'),
    totalMinor: minor("The total"),
    category: z.enum(SPLITECO_CATEGORIES).nullable().optional(),
    occurredAt: z.string().max(40).optional().describe("ISO 8601; now when left out"),
    note: z.string().trim().max(SPLITECO_LIMITS.note).nullable().optional(),
    payers: z
      .array(z.object({ subjectId: personId(), amountMinor: minor("What they paid") }))
      .min(1)
      .max(SPLITECO_LIMITS.people)
      .describe("Who paid, adding up to the total (one or several)"),
    split: splitSchema,
  })
  .describe("The expense, as Spliteco saves it");

// ── Words ──────────────────────────────────────────────────

/** Where the app is, for links: SPLITECO_ORIGIN, else the mcp-worker host's sibling. */
export function splitecoOrigin(env: Pick<Env, "SPLITECO_ORIGIN" | "MCP_PUBLIC_ORIGIN">): string | null {
  const set = (env.SPLITECO_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//.test(set)) return set;
  const m = /^https:\/\/cookpool-mcp-worker-([a-z0-9-]+)\.cookpool\.workers\.dev\/?$/.exec(env.MCP_PUBLIC_ORIGIN ?? "");
  return m ? `https://cookpool-spliteco-web-${m[1]}.cookpool.workers.dev` : null;
}

function names(people: readonly SplitecoPerson[]): Map<string, string> {
  return new Map(people.map((p) => [p.subjectId, p.name ?? "Someone"]));
}

function expenseRow(e: SplitecoExpenseSummary, who: Map<string, string>) {
  return {
    id: e.id,
    group: e.groupName,
    groupId: e.groupId,
    title: e.title,
    kind: e.kind,
    total: money(e.totalMinor, e.currency),
    on: e.occurredAt,
    paidBy: e.payers.map((p) => who.get(p.subjectId) ?? "Someone"),
    you: e.myNetMinor === 0 ? "not involved / even" : e.myNetMinor > 0 ? `lent ${money(e.myNetMinor, e.currency)}` : `borrowed ${money(-e.myNetMinor, e.currency)}`,
    canChange: !e.locked,
    ...(e.viaAssistant ? { via: e.viaAssistant } : {}),
  };
}

function draftAnswer(d: SplitecoDraft): { summary: string; data: unknown } {
  const shares = d.shares.map((s) => ({
    name: s.name ?? "Someone",
    id: s.subjectId,
    share: money(s.owedMinor, d.currency),
    ...(s.paidMinor > 0 ? { paid: money(s.paidMinor, d.currency) } : {}),
  }));
  const what =
    d.action === "add" ? `Add "${d.title}" to ${d.groupName}` : d.action === "edit" ? `Change "${d.title}" in ${d.groupName}` : `Move "${d.title}" to ${d.groupName}`;
  const payers = d.shares.filter((s) => s.paidMinor > 0).map((s) => s.name ?? "Someone");
  const summary =
    `DRAFT — nothing is saved yet. ${what}: ${money(d.totalMinor, d.currency)}, ${listNames(payers)} paid` +
    (d.method ? `, split ${d.method === "pct" ? "by %" : d.method === "items" ? `by ${plural(d.itemCount, "item")}` : d.method}` : "") +
    `. Show this to the person; call save_expense with the token only after they say yes (it lapses in ${SPLITECO_DRAFT_MINUTES} minutes).`;
  return {
    summary,
    data: {
      draft: true,
      token: d.token,
      action: d.action,
      expiresAt: d.expiresAt,
      group: d.groupName,
      groupId: d.groupId,
      ...(d.expenseId ? { expenseId: d.expenseId } : {}),
      title: d.title,
      total: money(d.totalMinor, d.currency),
      category: d.category,
      shares,
      addsUpTo: money(d.shares.reduce((n, s) => n + s.owedMinor, 0), d.currency),
      ...(d.before
        ? {
            before: {
              group: d.before.groupName,
              title: d.before.title,
              total: money(d.before.totalMinor, d.currency),
              shares: d.before.shares.map((s) => ({ name: s.name ?? "Someone", share: money(s.owedMinor, d.currency) })),
            },
          }
        : {}),
    },
  };
}

/** Spliteco's refusals, in plain words; null for the generic wording. */
export function splitecoErrorText(err: EdgeError): string | null {
  const reason = err.reason;
  if (err.status === 403 && reason === "scope") {
    return "This assistant isn't allowed to do that in Spliteco. The person can change it in Spliteco under You → AI assistants (Add & edit), then reconnect if asked.";
  }
  if (err.status === 403 && reason === "not_from_an_assistant") return "Payments are made in the Spliteco app, never by an assistant. Use settle_up for a link.";
  if (err.status === 403 && reason === "draft_required") return "Draft it first with draft_expense, edit_expense or move_expense, show the person, then save_expense.";
  if (err.status === 409) {
    switch (reason) {
      case "draft_expired":
        return `That draft lapsed (they last ${SPLITECO_DRAFT_MINUTES} minutes). Draft it again and show it before saving.`;
      case "owned_by_cookpool":
        return "Cookpool posted this one; it can only be changed in Cookpool.";
      case "not_current": {
        const current = typeof err.details.currentId === "string" ? ` The current one is ${err.details.currentId}.` : "";
        return `This expense was changed since.${current} Look it up again and draft from that.`;
      }
      case "not_members":
        return "Not everyone on it is in that group, so it can't move there.";
      case "same_group":
        return "It is already in that group.";
      case "not_deleted":
        return "Only a deleted expense can be restored.";
      case "restore_expired":
        return `It was deleted more than ${SPLITECO_RESTORE_DAYS} days ago and can't come back.`;
      case "not_an_expense":
        return "Only expenses can be changed; payments are changed in the app.";
      case "reminded_recently":
        return "They were already reminded in the last 24 hours.";
      case "nothing_owed":
        return "They don't owe the person anything there, so there's nothing to remind them of.";
      default:
        return null;
    }
  }
  if (err.status === 422 && reason === "does_not_add_up") {
    const problems = Array.isArray(err.details.problems) ? (err.details.problems as unknown[]).map((p) => (typeof p === "string" ? p : JSON.stringify(p))) : [];
    return `The split doesn't add up to the total${problems.length > 0 ? `: ${problems.join("; ")}` : ""}. Fix it and draft again.`;
  }
  if (err.status === 422 && reason === "not_in_group") {
    return "Someone named isn't in that group. Use find_people with the group's id to see who is.";
  }
  if (err.status === 422 && reason === "currency_mismatch") {
    return `That group counts in ${typeof err.details.currency === "string" ? err.details.currency : "another currency"}.`;
  }
  return null;
}

const S = "/v1/spliteco";

function read<T>(ctx: ToolContext, path: string, query?: Record<string, string | number | undefined>) {
  return edge<T>(ctx, { method: "GET", path, ...(query ? { query } : {}) });
}

// ── money.read ─────────────────────────────────────────────

export const findPeople = defineTool({
  name: "find_people",
  scope: "money.read",
  title: "Find people",
  description:
    "The people the person splits with in Spliteco (everyone they share a group with), with ids for drafting, and their own id. " +
    "With a groupId, that group's members.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: {
    query: z.string().trim().max(80).optional().describe("Name contains this"),
    groupId: groupId().optional(),
  },
  async run(args, ctx) {
    const home = await read<SplitecoHomeResponse>(ctx, `${S}/me/home`);
    if (!home.ok) return home;
    const me = { id: home.data.me.subjectId, name: home.data.me.name ?? "You", you: true };
    let people: { id: string; name: string; groups?: string[]; role?: string }[];
    if (args.groupId) {
      const g = await read<SplitecoGroupResponse>(ctx, `${S}/groups/${args.groupId}`);
      if (!g.ok) return g;
      people = g.data.members.filter((m) => m.subjectId !== me.id).map((m) => ({ id: m.subjectId, name: m.name ?? "Someone", role: m.role }));
    } else {
      const all = await read<SplitecoGroupsResponse>(ctx, `${S}/me/groups`);
      if (!all.ok) return all;
      people = all.data.friends.filter((f) => f.subjectId !== me.id).map((f) => ({ id: f.subjectId, name: f.name ?? "Someone", groups: f.groupNames }));
    }
    const q = (args.query ?? "").toLowerCase();
    const found = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
    const summary = found.length === 0 ? "Nobody matches." : `${plural(found.length, "person", "people")}: ${listNames(found.map((p) => p.name), 8)}.`;
    return { summary, data: { you: me, people: found } };
  },
});

export const listGroups = defineTool({
  name: "list_groups",
  scope: "money.read",
  title: "List groups",
  description: "The person's Spliteco groups (trips, homes, Cookpool kitchens) with ids, currency, member count and their balance in each.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: {},
  async run(_args, ctx) {
    const res = await read<SplitecoGroupsResponse>(ctx, `${S}/me/groups`);
    if (!res.ok) return res;
    const groups = res.data.groups.map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      madeIn: g.madeIn,
      currency: g.currency,
      members: g.memberCount,
      yourBalance: money(g.myBalanceMinor, g.currency),
      getsBack: g.myBalanceMinor > 0,
      canAdd: g.role !== "viewer",
    }));
    return { summary: groups.length === 0 ? "No groups yet." : `${plural(groups.length, "group")}: ${listNames(groups.map((g) => g.name), 8)}.`, data: { groups } };
  },
});

export const getBalances = defineTool({
  name: "get_balances",
  scope: "money.read",
  title: "Spliteco balances",
  description:
    "Who owes whom in Spliteco: across everything, in one group (groupId, with the fewest payments that settle it), or with one person (personId). Read only.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: { groupId: groupId().optional(), personId: personId().optional() },
  async run(args, ctx) {
    if (args.groupId) {
      const res = await read<SplitecoGroupResponse>(ctx, `${S}/groups/${args.groupId}`);
      if (!res.ok) return res;
      const cur = res.data.group.currency;
      const who = names([...res.data.members, ...res.data.people]);
      const balances = res.data.balances.filter((b) => b.balanceMinor !== 0).map((b) => ({ name: who.get(b.subjectId) ?? "Someone", id: b.subjectId, balance: money(b.balanceMinor, cur), getsBack: b.balanceMinor > 0 }));
      const plan = res.data.plan.map((p) => ({ from: who.get(p.fromSubjectId) ?? "Someone", to: who.get(p.toSubjectId) ?? "Someone", amount: money(p.amountMinor, cur) }));
      const mine = res.data.group.myBalanceMinor;
      const summary = `${res.data.group.name}: ${mine === 0 ? "you're settled" : mine > 0 ? `you get back ${money(mine, cur)}` : `you owe ${money(-mine, cur)}`}; ${plural(plan.length, "payment")} would settle it.`;
      return { summary, data: { group: res.data.group.name, groupId: res.data.group.id, balances, plan } };
    }
    if (args.personId) {
      const res = await read<SplitecoFriendResponse>(ctx, `${S}/me/friends/${args.personId}`);
      if (!res.ok) return res;
      const name = res.data.friend.name ?? "They";
      const totals = res.data.balances.map((b) => (b.amountMinor === 0 ? `even in ${b.currency}` : b.amountMinor > 0 ? `${name} owes you ${money(b.amountMinor, b.currency)}` : `you owe ${name} ${money(-b.amountMinor, b.currency)}`));
      const byGroup = res.data.byGroup.filter((g) => g.amountMinor !== 0).map((g) => ({ group: g.groupName, groupId: g.groupId, theyOweYou: g.amountMinor > 0, amount: money(Math.abs(g.amountMinor), g.currency) }));
      return { summary: totals.length === 0 ? `You and ${name} are settled.` : `${totals.join("; ")}.`, data: { person: name, id: res.data.friend.subjectId, byGroup } };
    }
    const res = await read<SplitecoHomeResponse>(ctx, `${S}/me/home`);
    if (!res.ok) return res;
    const totals = res.data.totals.map((t) => ({ currency: t.currency, owedToYou: money(t.owedToYouMinor, t.currency), youOwe: money(t.youOweMinor, t.currency), net: money(t.netMinor, t.currency) }));
    const people = res.data.people.map((p) => ({ name: p.name ?? "Someone", id: p.subjectId, balances: p.balances.filter((b) => b.amountMinor !== 0).map((b) => (b.amountMinor > 0 ? `owes you ${money(b.amountMinor, b.currency)}` : `you owe ${money(-b.amountMinor, b.currency)}`)) })).filter((p) => p.balances.length > 0);
    const owed = res.data.totals.filter((t) => t.owedToYouMinor > 0).map((t) => money(t.owedToYouMinor, t.currency));
    const owe = res.data.totals.filter((t) => t.youOweMinor > 0).map((t) => money(t.youOweMinor, t.currency));
    const summary =
      owed.length === 0 && owe.length === 0
        ? "All settled up in Spliteco."
        : [owed.length > 0 ? `You're owed ${owed.join(" + ")}` : "", owe.length > 0 ? `you owe ${owe.join(" + ")}` : ""].filter(Boolean).join(" and ").replace(/^you/, "You") + ".";
    return { summary, data: { totals, people } };
  },
});

export const searchExpenses = defineTool({
  name: "search_expenses",
  scope: "money.read",
  title: "Search expenses",
  description: "Finds the person's current Spliteco expenses by words in the title or note, newest first, in every group or one. Gives the ids to edit, move or delete.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: {
    query: z.string().trim().max(100).optional().describe('Words in the title or note: "cab"'),
    groupId: groupId().optional(),
    limit: z.number().int().min(1).max(50).optional().describe("At most this many (default 20)"),
  },
  async run(args, ctx) {
    const res = await read<SplitecoSearchResponse>(ctx, `${S}/me/search`, { q: args.query, groupId: args.groupId, limit: args.limit ?? 20 });
    if (!res.ok) return res;
    const who = names(res.data.people);
    const expenses = res.data.expenses.map((e) => expenseRow(e, who));
    const summary = expenses.length === 0 ? "No expenses match." : `${plural(expenses.length, "expense")}${res.data.more ? " (more not shown)" : ""}: ${listNames(expenses.map((e) => `${e.title} ${e.total}`))}.`;
    return { summary, data: { expenses, more: res.data.more } };
  },
});

export const getActivity = defineTool({
  name: "get_activity",
  scope: "money.read",
  title: "Recent activity",
  description: "What changed lately in the person's Spliteco groups (added, edited, deleted, moved, settled), newest first, with who did it and what it did to them.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: { groupId: groupId().optional(), limit: z.number().int().min(1).max(50).optional().describe("At most this many (default 20)") },
  async run(args, ctx) {
    const res = await read<SplitecoActivityResponse>(ctx, args.groupId ? `${S}/groups/${args.groupId}/activity` : `${S}/me/activity`);
    if (!res.ok) return res;
    const who = names(res.data.people);
    const entries = res.data.entries.slice(0, args.limit ?? 20).map((e) => ({
      action: e.action,
      at: e.at,
      by: who.get(e.actorId) ?? "Someone",
      ...(e.viaAssistant ? { via: e.viaAssistant } : {}),
      group: e.groupName,
      title: e.title,
      total: money(e.totalMinor, e.currency),
      ...(e.previousTotalMinor !== null ? { before: money(e.previousTotalMinor, e.currency) } : {}),
      expenseId: e.expenseId,
      forYou: e.myEffectMinor === 0 ? "no change" : e.myEffectMinor > 0 ? `you get back ${money(e.myEffectMinor, e.currency)}` : `you owe ${money(-e.myEffectMinor, e.currency)}`,
    }));
    return { summary: entries.length === 0 ? "Nothing has happened yet." : `${plural(entries.length, "change")}, newest first.`, data: { entries } };
  },
});

export const getInsights = defineTool({
  name: "get_insights",
  scope: "money.read",
  title: "Spending insights",
  description: "The person's share of spending for a month (this month by default): by category, who paid, the last six months and the biggest expenses.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: {
    groupId: groupId().optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("YYYY-MM"),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  },
  async run(args, ctx) {
    const res = await read<SplitecoInsightsResponse>(ctx, `${S}/insights`, { groupId: args.groupId, month: args.month, currency: args.currency });
    if (!res.ok) return res;
    const d = res.data;
    const who = names(d.people);
    const data = {
      month: d.month,
      currency: d.currency,
      yourShare: money(d.myShareMinor, d.currency),
      youPaid: money(d.myPaidMinor, d.currency),
      expenses: d.expenseCount,
      lastMonth: money(d.previousMonthShareMinor, d.currency),
      byCategory: d.byCategory.map((c) => ({ category: c.category, amount: money(c.amountMinor, d.currency) })),
      byPayer: d.byPayer.map((p) => ({ name: who.get(p.subjectId) ?? "Someone", amount: money(p.amountMinor, d.currency) })),
      byMonth: d.byMonth.map((m) => ({ month: m.month, amount: money(m.amountMinor, d.currency) })),
      biggest: d.biggest.map((b) => ({ title: b.expense.title, id: b.expense.id, yourShare: money(b.myShareMinor, d.currency) })),
    };
    return { summary: `${d.month}: your share ${data.yourShare} over ${plural(d.expenseCount, "expense")} (last month ${data.lastMonth}).`, data };
  },
});

export const settleUp = defineTool({
  name: "settle_up",
  scope: "money.read",
  title: "Settle up (opens the app)",
  description:
    "Gives a link that opens Spliteco on its Settle up screen. Assistants can't record payments: the person pays and confirms in the app. Records nothing.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: { groupId: groupId().optional(), personId: personId().optional().describe("Who they want to pay (usr_…)") },
  async run(args, ctx) {
    // Never a payment route, and no call at all: only a link.
    const origin = splitecoOrigin(ctx.env);
    const path =
      args.groupId && args.personId
        ? `/settle?group=${encodeURIComponent(args.groupId)}&to=${encodeURIComponent(args.personId)}`
        : args.groupId
          ? `/settle?group=${encodeURIComponent(args.groupId)}`
          : args.personId
            ? `/friend?id=${encodeURIComponent(args.personId)}`
            : "/settle";
    const url = origin ? `${origin}${path}` : null;
    return {
      summary:
        "Settling up happens in the Spliteco app, so nothing gets marked paid by mistake: I can't record payments. " +
        (url ? `This opens it on that screen: ${url}` : "Open Spliteco and tap Settle up."),
      data: { url, recordsPayment: false },
    };
  },
});

// ── money.write ────────────────────────────────────────────

export const draftExpense = defineTool({
  name: "draft_expense",
  scope: "money.write",
  title: "Draft an expense",
  description:
    "Works out an expense's split (equal, exact, %, shares, adjust or itemized; one or several payers) and answers a draft. Saves nothing: show it, then save_expense.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: { groupId: groupId(), expense: expenseSchema },
  async run(args, ctx) {
    const res = await edge<SplitecoDraftResponse>(ctx, { method: "POST", path: `${S}/drafts`, body: { action: "add", groupId: args.groupId, expense: args.expense } });
    if (!res.ok) return res;
    return draftAnswer(res.data.draft);
  },
});

export const editExpense = defineTool({
  name: "edit_expense",
  scope: "money.write",
  title: "Draft a change to an expense",
  description:
    "Drafts a change to an expense: the full expense as it should read (any split, any payers), with before and after. Saves nothing: show it, then save_expense.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: { expenseId: expenseId(), expense: expenseSchema },
  async run(args, ctx) {
    const res = await edge<SplitecoDraftResponse>(ctx, { method: "POST", path: `${S}/drafts`, body: { action: "edit", expenseId: args.expenseId, expense: args.expense } });
    if (!res.ok) return res;
    return draftAnswer(res.data.draft);
  },
});

export const moveExpense = defineTool({
  name: "move_expense",
  scope: "money.write",
  title: "Draft moving an expense",
  description: "Drafts moving an expense to another group (everyone on it must be a member there). Saves nothing: show it, then save_expense.",
  readOnly: true,
  explain: splitecoErrorText,
  inputSchema: { expenseId: expenseId(), toGroupId: groupId().describe("The group it goes to (org_…)") },
  async run(args, ctx) {
    const res = await edge<SplitecoDraftResponse>(ctx, { method: "POST", path: `${S}/drafts`, body: { action: "move", expenseId: args.expenseId, toGroupId: args.toGroupId } });
    if (!res.ok) return res;
    return draftAnswer(res.data.draft);
  },
});

export const saveExpense = defineTool({
  name: "save_expense",
  scope: "money.write",
  title: "Save a draft",
  description:
    "Saves a draft from draft_expense, edit_expense or move_expense, exactly as shown. Only after the person said yes to that draft. Saving twice saves once.",
  readOnly: false,
  explain: splitecoErrorText,
  inputSchema: { token: z.string().regex(DRAFT_RE).describe("The draft's token (drf_…)") },
  async run(args, ctx) {
    const res = await edge<SplitecoWriteResponse>(ctx, { method: "POST", path: `${S}/drafts/${args.token}/save` });
    if (!res.ok) return res;
    const e = res.data.expense;
    const origin = splitecoOrigin(ctx.env);
    return {
      summary: `Saved "${e.title}" in ${e.groupName}: ${money(e.totalMinor, e.currency)}. It shows as via this assistant in Spliteco's activity.`,
      data: {
        saved: true,
        id: e.id,
        group: e.groupName,
        title: e.title,
        total: money(e.totalMinor, e.currency),
        you: e.myNetMinor > 0 ? `lent ${money(e.myNetMinor, e.currency)}` : e.myNetMinor < 0 ? `borrowed ${money(-e.myNetMinor, e.currency)}` : "even",
        ...(origin ? { open: `${origin}/expense?id=${encodeURIComponent(e.id)}` } : {}),
      },
    };
  },
});

export const deleteExpense = defineTool({
  name: "delete_expense",
  scope: "money.write",
  title: "Delete an expense",
  description: `Deletes an expense the person asked to delete. It can be restored for ${SPLITECO_RESTORE_DAYS} days (restore_expense, or in the app).`,
  readOnly: false,
  explain: splitecoErrorText,
  inputSchema: { expenseId: expenseId() },
  async run(args, ctx) {
    const res = await edge<SplitecoWriteResponse>(ctx, { method: "DELETE", path: `${S}/expenses/${args.expenseId}` });
    if (!res.ok) return res;
    const e = res.data.expense;
    return {
      summary: `Deleted "${e.title}" (${money(e.totalMinor, e.currency)}) from ${e.groupName}. It can be restored for ${SPLITECO_RESTORE_DAYS} days.`,
      data: { deleted: true, id: args.expenseId, title: e.title, group: e.groupName },
    };
  },
});

export const restoreExpense = defineTool({
  name: "restore_expense",
  scope: "money.write",
  title: "Restore a deleted expense",
  description: `Brings back an expense deleted in the last ${SPLITECO_RESTORE_DAYS} days, exactly as it was.`,
  readOnly: false,
  explain: splitecoErrorText,
  inputSchema: { expenseId: expenseId() },
  async run(args, ctx) {
    const res = await edge<SplitecoWriteResponse>(ctx, { method: "POST", path: `${S}/expenses/${args.expenseId}/restore` });
    if (!res.ok) return res;
    const e = res.data.expense;
    return { summary: `Restored "${e.title}" in ${e.groupName}.`, data: { restored: true, id: e.id, title: e.title, group: e.groupName } };
  },
});

export const addComment = defineTool({
  name: "add_comment",
  scope: "money.write",
  title: "Comment on an expense",
  description: "Adds a comment to an expense, as the person, for everyone in the group to see.",
  readOnly: false,
  explain: splitecoErrorText,
  inputSchema: { expenseId: expenseId(), body: z.string().trim().min(1).max(SPLITECO_LIMITS.comment) },
  async run(args, ctx) {
    const res = await edge<SplitecoCommentResponse>(ctx, { method: "POST", path: `${S}/expenses/${args.expenseId}/comments`, body: { body: args.body } });
    if (!res.ok) return res;
    return { summary: "Comment added.", data: { id: res.data.comment.id, expenseId: args.expenseId } };
  },
});

export const sendReminder = defineTool({
  name: "send_reminder",
  scope: "money.write",
  title: "Remind someone who owes",
  description: "Sends a friendly reminder to someone who owes the person (at most once a day each). It asks them to pay in the app; it records no payment.",
  readOnly: false,
  explain: splitecoErrorText,
  inputSchema: { personId: personId(), groupId: groupId().optional().describe("The group it is about; the one they owe most in when left out") },
  async run(args, ctx) {
    const res = await edge<SplitecoReminderResponse>(ctx, { method: "POST", path: `${S}/reminders`, body: { to: args.personId, ...(args.groupId ? { groupId: args.groupId } : {}) } });
    if (!res.ok) return res;
    const r = res.data.reminder;
    return {
      summary: `Reminder sent for ${money(r.amountMinor, r.currency)}${res.data.delivered ? "" : " (they may not get an email: no address on file)"}. The next one is possible after ${r.nextAllowedAt}.`,
      data: { sent: true, delivered: res.data.delivered, amount: money(r.amountMinor, r.currency), groupId: r.groupId, nextAllowedAt: r.nextAllowedAt },
    };
  },
});

export const SPLITECO_READ_TOOLS = [findPeople, listGroups, getBalances, searchExpenses, getActivity, getInsights, settleUp];
export const SPLITECO_WRITE_TOOLS = [draftExpense, saveExpense, editExpense, moveExpense, deleteExpense, restoreExpense, addComment, sendReminder];
