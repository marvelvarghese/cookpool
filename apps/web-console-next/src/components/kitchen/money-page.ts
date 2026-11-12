/**
 * Money (cookpool-recipes RC-2, design §1.4, the canvas's `Money`), the new
 * frame's tab, as pure view-models: your money — one figure per currency, you
 * get back or you owe —, then People | Groups. A person shows their face,
 * name, a group you share and the amount between you two with its direction;
 * it opens their page. A group shows its tile, name, how many are in it and
 * your balance there; it opens the group's page. Settle up and Bill are the
 * screen's two actions, Settle up the main one.
 *
 * Built only from the reads People and Groups already make (the cross-group
 * balances, the groups list). Dependency-free, so it is unit-testable; amounts
 * are never added across currencies.
 */

import type { MyBalancesResponse, MyGroupBalance } from "@saas/contracts/kitchen";
import { moneyLine, type MoneyLine } from "./home";
import { formatMinor } from "./money";
import { peopleMoney, peopleRows, type NetTone } from "./people";
import { groupListRow } from "./group-page";
import { sortGroups, type GroupLike } from "./groups";
import { agoText } from "./when";

/** Money's two lists. */
export const MONEY_LISTS = ["people", "groups"] as const;
export type MoneyList = (typeof MONEY_LISTS)[number];

/** The list `?list=` names; People when it names none. */
export function moneyListFrom(param: string | null | undefined): MoneyList {
  return param === "groups" ? "groups" : "people";
}

/** Money's address for a list: People is the bare `/money`. */
export function moneyHref(list: MoneyList): string {
  return list === "groups" ? "/money?list=groups" : "/money";
}

/**
 * Your money at the top: one figure per currency with money open, your own
 * currency first ("You get back ₹62.50", "You owe $25.00"); "Settled up"
 * when nothing is open anywhere. People's headline, the same numbers.
 */
export function moneyTotals(data: Pick<MyBalancesResponse, "groups" | "totals">): MoneyLine[] {
  return peopleMoney(data);
}

/** One currency between you and a person, with its direction. */
export interface MoneyPersonAmount {
  currency: string;
  tone: NetTone;
  /** "you get back", "you owe", "settled". */
  words: string;
  /** "₹40.00"; null when settled. */
  amount: string | null;
}

export interface MoneyPersonRow {
  subjectId: string;
  /** Their name, or "Member · 3f9a". */
  label: string;
  /** "Flat 4B", or "Flat 4B +2" when you share more groups. */
  group: string | null;
  amounts: MoneyPersonAmount[];
  /** Their page (design §1.3: a person's page holds what is between you two). */
  href: string;
}

function personAmount(net: { currency: string; netMinor: number }): MoneyPersonAmount {
  if (net.netMinor > 0) return { currency: net.currency, tone: "owed", words: "you get back", amount: formatMinor(net.netMinor, net.currency) };
  if (net.netMinor < 0) return { currency: net.currency, tone: "owe", words: "you owe", amount: formatMinor(-net.netMinor, net.currency) };
  return { currency: net.currency, tone: "settled", words: "settled", amount: null };
}

/** "Flat 4B", "Flat 4B +2". */
export function sharedGroupText(groups: readonly { name: string }[]): string | null {
  const first = groups[0]?.name;
  if (!first) return null;
  return groups.length > 1 ? `${first} +${groups.length - 1}` : first;
}

/**
 * Money's People: everyone you share a group with, the largest amount first
 * (whichever way it goes), then by name — one amount per currency, nothing
 * added across them.
 */
export function moneyPeople(data: Pick<MyBalancesResponse, "people"> | null | undefined): MoneyPersonRow[] {
  return peopleRows(data).map((r) => ({
    subjectId: r.subjectId,
    label: r.label,
    group: sharedGroupText(r.groups),
    amounts: r.nets.map(personAmount),
    href: `/people/${encodeURIComponent(r.subjectId)}`,
  }));
}

export interface MoneyGroupRow {
  id: string;
  slug: string;
  name: string;
  /** "5 people"; null before the cross-group read has the group. */
  people: string | null;
  /** "You get back ₹86.50"; null when settled (no zero cells). */
  money: MoneyLine | null;
  /** The revamp's signed amount: "+₹87.00", "−₹25.00", "Settled"; null before the read has the group. */
  fact: GroupFact | null;
  /** Today's group page. */
  href: string;
}

/**
 * Money's Groups: your groups, the ones you opened last first, each with how
 * many are in it and your balance there (Groups' own rows).
 */
export function moneyGroups<T extends GroupLike>(
  groups: readonly T[],
  balances: ReadonlyMap<string, Pick<MyGroupBalance, "balanceMinor" | "currency" | "memberCount">>,
  recentSlugs: readonly string[] = [],
): MoneyGroupRow[] {
  return sortGroups(groups, "recent", recentSlugs).map((g) => {
    const kitchen = balances.get(g.id);
    const row = groupListRow(g, kitchen);
    return { id: g.id, slug: g.slug, name: row.name, people: row.people, money: row.money, fact: groupFact(kitchen), href: `/groups/${encodeURIComponent(g.slug)}` };
  });
}

/** Where Settle up goes: today's settle screen, People (since SM-11 `/settle` only leads there). */
export const SETTLE_UP_HREF = "/people";

/**
 * A person's page in the new frame (RC-2): what is between you two, in your
 * words — "You get back ₹40.00", "You owe $12.00" — one line per currency
 * with money open; "Settled up" when none is.
 */
export function personBalance(view: { totals: readonly { currency: string; netMinor: number }[] }): MoneyLine[] {
  const open = view.totals.filter((t) => t.netMinor !== 0);
  const lines = open.length > 0 ? open : [{ currency: view.totals[0]?.currency ?? "INR", netMinor: 0 }];
  return lines.map(moneyLine);
}

// ── The revamp (RV-5, the canvas's RvMoney / RvGroups / RvGroup) ─────

/** People rows Money shows before "See all". */
export const MONEY_PEOPLE_ROWS = 3;

/** An amount with its direction as a sign: "+₹87.00", "−₹25.00", "₹0.00". */
export function signedMoney(netMinor: number, currency: string): string {
  const amount = formatMinor(Math.abs(netMinor), currency);
  return netMinor > 0 ? `+${amount}` : netMinor < 0 ? `−${amount}` : amount;
}

/** Money's big figure: "You get back" / "You owe" / "All settled", and the signed amount. */
export interface MoneyNet {
  currency: string;
  tone: NetTone;
  label: string;
  /** "+₹27.50", "−₹12.50", "₹0.00". */
  figure: string;
}

/** The big figure, one per currency as `moneyTotals` gives them — the same numbers, said shorter. */
export function moneyNets(data: Pick<MyBalancesResponse, "groups" | "totals">): MoneyNet[] {
  return moneyTotals(data).map((l) => {
    const total = data.totals.find((t) => t.currency === l.currency);
    const minor = total?.netMinor ?? 0;
    return { currency: l.currency, tone: l.tone, label: l.tone === "settled" ? "All settled" : l.label, figure: signedMoney(l.tone === "settled" ? 0 : minor, l.currency) };
  });
}

/**
 * A person row's one line: "Owes you ₹54.00", "You owe ₹25.00", "Settled";
 * one part per currency with money open, joined by " · ".
 */
export function personLine(row: Pick<MoneyPersonRow, "amounts">): string {
  const open = row.amounts.filter((a) => a.amount);
  if (open.length === 0) return "Settled";
  return open.map((a) => (a.tone === "owed" ? `Owes you ${a.amount}` : `You owe ${a.amount}`)).join(" · ");
}

/** The line's colour: the direction when every open currency goes one way, muted otherwise. */
export function personTone(row: Pick<MoneyPersonRow, "amounts">): NetTone {
  const tones = new Set(row.amounts.filter((a) => a.amount).map((a) => a.tone));
  return tones.size === 1 ? [...tones][0]! : "settled";
}

/** A person row's one button: Pay when you owe them anything, Remind when they owe you, none when settled. */
export function personAction(row: Pick<MoneyPersonRow, "amounts">): "pay" | "remind" | null {
  if (row.amounts.some((a) => a.amount && a.tone === "owe")) return "pay";
  if (row.amounts.some((a) => a.amount && a.tone === "owed")) return "remind";
  return null;
}

/** What Remind shares: a short note in your words, the amounts they owe you. */
export function remindText(name: string, row: Pick<MoneyPersonRow, "amounts">): string {
  const owed = row.amounts.filter((a) => a.amount && a.tone === "owed").map((a) => a.amount);
  const first = name.split(" ")[0] || name;
  return `Hi ${first}, a reminder from Cookpool: you owe me ${owed.join(" and ")}.`;
}

/** A group's balance as Money and Groups show it: "+₹87.00", "−₹25.00", "Settled". */
export interface GroupFact {
  tone: NetTone;
  text: string;
}

export function groupFact(kitchen: Pick<MyGroupBalance, "balanceMinor" | "currency"> | null | undefined): GroupFact | null {
  if (!kitchen) return null;
  if (kitchen.balanceMinor === 0) return { tone: "settled", text: "Settled" };
  return { tone: kitchen.balanceMinor > 0 ? "owed" : "owe", text: signedMoney(kitchen.balanceMinor, kitchen.currency) };
}

/** Groups' one meta line: "4 people · +₹87", "3 people · settled"; null before the cross-group read has it. */
export function groupMeta(kitchen: Pick<MyGroupBalance, "balanceMinor" | "currency" | "memberCount"> | null | undefined): { people: string; fact: GroupFact } | null {
  if (!kitchen) return null;
  // Whole rupees where whole, as RvGroups writes them (RV-17): "+₹87".
  const fact = groupFactWhole(kitchen)!;
  return {
    people: `${kitchen.memberCount} ${kitchen.memberCount === 1 ? "person" : "people"}`,
    fact: fact.tone === "settled" ? { tone: "settled", text: "settled" } : fact,
  };
}

// ── The approved boards (RV-17: RvMoney, RvMoneyGroup) ───────────────

/** Whole rupees where the amount is whole, as the boards write them: "₹54", "₹62.50", "₹1,200". */
export function wholeMoney(minor: number, currency: string): string {
  const text = formatMinor(Math.abs(minor), currency);
  return minor % 100 === 0 ? text.replace(/\.00$/, "") : text;
}

/** Signed, whole where whole: "+₹87", "−₹25", "₹0". */
export function signedWhole(minor: number, currency: string): string {
  const amount = wholeMoney(minor, currency);
  return minor > 0 ? `+${amount}` : minor < 0 ? `−${amount}` : amount;
}

/** Money's net, one per currency, in the boards' words: "You get back" +₹62, "You owe" −₹25, "All settled" ₹0. */
export function moneyNetsWhole(data: Pick<MyBalancesResponse, "groups" | "totals">): MoneyNet[] {
  return moneyNets(data).map((n) => {
    const minor = n.tone === "settled" ? 0 : (data.totals.find((t) => t.currency === n.currency)?.netMinor ?? 0);
    return { ...n, figure: signedWhole(minor, n.currency) };
  });
}

/** A Money person row's fact after the name: "owes you ₹54", "you owe ₹25", "square"; one part per currency. */
export function personFact(row: Pick<MoneyPersonRow, "amounts">): string {
  const open = row.amounts.filter((a) => a.amount);
  if (open.length === 0) return "square";
  return open.map((a) => (a.tone === "owed" ? "owes you " : "you owe ") + wholeAmount(a.amount!)).join(" · ");
}

/** "₹54.00" → "₹54"; "₹62.50" stays. */
function wholeAmount(text: string): string {
  return text.replace(/\.00$/, "");
}

/** A group row's balance from your view: "+₹87" when you get back, "−₹25" when you owe, "Square" at zero. */
export function groupFactWhole(kitchen: Pick<MyGroupBalance, "balanceMinor" | "currency"> | null | undefined): GroupFact | null {
  if (!kitchen) return null;
  if (kitchen.balanceMinor === 0) return { tone: "settled", text: "Square" };
  return { tone: kitchen.balanceMinor > 0 ? "owed" : "owe", text: signedWhole(kitchen.balanceMinor, kitchen.currency) };
}

/** Spliteco's one quiet line on Money (RvMoney): what it adds that a kitchen doesn't need. */
export const SPLITECO_LINE = "Trips, insights, live split\u2026";

/** Groups shown on Money before All (the Groups page). */
export const MONEY_GROUP_ROWS = 3;

/**
 * The one way to settle (RV-17): Cookpool's Settle up on spliteco-worker —
 * `/money/settle?group=&to=` — which pays the Kitchen balance only and never
 * more than it, the payer confirming (UPI opens the UPI app first). `back`
 * is where Back and Done return; only Money's, a person's or a group's page.
 */
export function settleHref(orgId: string, to: string, back?: string | null): string {
  const q = new URLSearchParams({ group: orgId, to });
  const safe = safeSettleBack(back);
  if (safe) q.set("back", safe);
  return `/money/settle?${q.toString()}`;
}

/** Where Settle up may go back to: Money (any view), a person's page or a group's page; null for anything else. */
export function safeSettleBack(back: string | null | undefined): string | null {
  if (!back || back.startsWith("//") || back.includes("\\")) return null;
  return /^\/(money(\?[^#]*)?|people\/[^/?#]+(\?[^#]*)?|groups\/[^/?#]+(\?[^#]*)?)$/.test(back) ? back : null;
}

/** One group's balance and its why, on Money: `/money?group=org_…`. */
export function moneyGroupHref(orgId: string): string {
  return `/money?group=${encodeURIComponent(orgId)}`;
}

/** One payment the Settle up sheet lists: you pay them (−) or they pay you (+), in one group. */
export interface SettleSheetRow {
  key: string;
  orgId: string;
  groupName: string;
  subjectId: string;
  label: string;
  /** Positive: they pay you; negative: you pay them. */
  minor: number;
  currency: string;
}

/**
 * Settle up's rows, from the cross-group read (each person's net in each
 * group is that group's plan): what you pay first, then what you get, the
 * largest first in each. Viewers' groups are left out (nothing to record).
 */
export function settleSheetRows(data: Pick<MyBalancesResponse, "groups" | "people"> | null | undefined): SettleSheetRow[] {
  if (!data) return [];
  const viewing = new Set(data.groups.filter((g) => g.role === "viewer").map((g) => g.orgId));
  const labels = new Map(moneyPeople(data).map((r) => [r.subjectId, r.label] as const));
  const rows: SettleSheetRow[] = [];
  for (const p of data.people) {
    for (const n of p.groups) {
      if (n.netMinor === 0 || viewing.has(n.orgId)) continue;
      rows.push({ key: `${n.orgId}:${p.subjectId}`, orgId: n.orgId, groupName: n.name, subjectId: p.subjectId, label: labels.get(p.subjectId) ?? "Someone", minor: n.netMinor, currency: n.currency });
    }
  }
  return rows.sort((a, b) => (a.minor < 0 ? 0 : 1) - (b.minor < 0 ? 0 : 1) || Math.abs(b.minor) - Math.abs(a.minor) || a.label.localeCompare(b.label));
}

/** "You pay Dev", "Anu pays you" (first names, as the boards). */
export function settleLine(row: Pick<SettleSheetRow, "label" | "minor">): string {
  const first = row.label.split(" ")[0] || row.label;
  return row.minor < 0 ? `You pay ${first}` : `${first} pays you`;
}

/** Money's Pay on a person: straight to Settle up when you owe them in exactly one group; otherwise null (the sheet). */
export function directPay(rows: readonly SettleSheetRow[], subjectId: string): SettleSheetRow | null {
  const mine = rows.filter((r) => r.subjectId === subjectId && r.minor < 0);
  return mine.length === 1 ? mine[0]! : null;
}

/** What Remind shares for amounts they owe you (whole where whole). */
export function remindFor(name: string, owed: readonly { minor: number; currency: string }[]): string {
  const first = name.split(" ")[0] || name;
  return `Hi ${first}, a reminder from Cookpool: you owe me ${owed.map((o) => wholeMoney(o.minor, o.currency)).join(" and ")}.`;
}

/** The kinds a why row can be, each with its icon on the page. */
export type WhyKind = "bill" | "dish" | "use" | "waste" | "paid" | "undo";

/** One row behind a balance: what it was, one fact, and what it did from your view (+ back, − owe). */
export interface MoneyWhyRow {
  id: string;
  kind: WhyKind;
  title: string;
  /** "Bill · Flat 4B · Yesterday". */
  fact: string;
  minor: number;
  currency: string;
  /** Undone later: shown struck through. */
  reversed: boolean;
}

/** Why rows shown before See all. */
export const WHY_ROWS = 3;

const KIND_OF: Record<string, WhyKind> = { expense: "bill", dish: "dish", use: "use", waste: "waste", settlement: "paid", reversal: "undo" };
const KIND_WORD: Record<WhyKind, string> = { bill: "Bill", dish: "Dish", use: "Use", waste: "Waste", paid: "Payment", undo: "Undone" };

/**
 * A person's why (`/people/[id]`): every line between you two in every group
 * you share, newest first, one fact each ("Bill · Flat 4B · Yesterday"; the
 * group named only when you share more than one).
 */
export function personWhyRows(
  view: { groups: readonly { orgId: string; name: string; currency: string; lines: readonly { txnId: string; kind: string; title: string; occurredAt: string; signedMinor: number; reversed: boolean }[] }[] },
  now: Date,
): MoneyWhyRow[] {
  const many = view.groups.length > 1;
  const rows = view.groups.flatMap((g) =>
    g.lines.map((l) => {
      const kind = KIND_OF[l.kind] ?? "bill";
      return {
        id: `${g.orgId}:${l.txnId}:${l.signedMinor}`,
        kind,
        title: l.title,
        fact: [KIND_WORD[kind], many ? g.name : null, agoText(l.occurredAt, now)].filter(Boolean).join(" · "),
        minor: l.signedMinor,
        currency: g.currency,
        reversed: l.reversed,
        at: l.occurredAt,
      };
    }),
  );
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).map(({ at: _at, ...r }) => r);
}

/** A group's why (Money's group view), from its Kitchen-only read: whyRows' title and detail, with the kind and when. */
export function groupWhyRows(
  rows: readonly { id: string; title: string; detail: string; netMinor: number; currency: string; occurredAt: string }[],
  kinds: ReadonlyMap<string, string>,
  now: Date,
): MoneyWhyRow[] {
  return rows.map((r) => {
    const kind = KIND_OF[kinds.get(r.id) ?? "expense"] ?? "bill";
    return { id: r.id, kind, title: r.title, fact: [r.detail, agoText(r.occurredAt, now)].filter(Boolean).join(" · "), minor: r.netMinor, currency: r.currency, reversed: false };
  });
}

/** A person's open money per group, from their read: what Settle up lists on their page (viewers' groups left out). */
export function personSettleRows(
  view: { subjectId: string; displayName: string | null; groups: readonly { orgId: string; name: string; currency: string; role: string; planMinor: number }[] },
): SettleSheetRow[] {
  const label = view.displayName?.trim() || "Them";
  return view.groups
    .filter((g) => g.planMinor !== 0 && g.role !== "viewer")
    .map((g) => ({ key: `${g.orgId}:${view.subjectId}`, orgId: g.orgId, groupName: g.name, subjectId: view.subjectId, label, minor: g.planMinor, currency: g.currency }))
    .sort((a, b) => (a.minor < 0 ? 0 : 1) - (b.minor < 0 ? 0 : 1) || Math.abs(b.minor) - Math.abs(a.minor));
}

/** A balance's headline from your view: "You get back" / "You owe" / "All square". */
export function balanceLabel(minor: number): string {
  return minor > 0 ? "You get back" : minor < 0 ? "You owe" : "All square";
}
