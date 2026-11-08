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
    const row = groupListRow(g, balances.get(g.id));
    return { id: g.id, slug: g.slug, name: row.name, people: row.people, money: row.money, href: `/groups/${encodeURIComponent(g.slug)}` };
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
