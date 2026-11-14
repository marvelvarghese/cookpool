// Money-native MY-5: People and a person's page, as pure view-models. Both read
// MY-15's one response (`spliteco.balances()`); nothing here joins reads on the
// client. Amounts stay per currency: a rupee and a dollar are never summed.

import type { SplitecoBalancesResponse, SplitecoPersonBalance, SplitecoPersonGroupBalance } from "@saas/contracts/spliteco";
import { formatShort } from "./money.js";
import { signedShort, toneOf, type MoneyTone } from "./money-tab.js";

/** What a People row offers: Pay when you owe, Got it when they owe, nothing when settled. */
export type PersonAction = "pay" | "got" | "settled";

export interface PersonAmount {
  currency: string;
  /** Positive: they owe you. */
  minor: number;
  tone: MoneyTone;
  /** "+₹520", "−₹1,500". */
  text: string;
}

/** The person's open amounts, one per currency (zeroes dropped), the first being the one the row leads with. */
export function personAmounts(person: Pick<SplitecoPersonBalance, "balances">): PersonAmount[] {
  return person.balances
    .filter((b) => b.amountMinor !== 0)
    .map((b) => ({ currency: b.currency, minor: b.amountMinor, tone: toneOf(b.amountMinor), text: signedShort(b.amountMinor, b.currency) }));
}

/**
 * The row's button. Pay as soon as you owe in any currency (what you owe comes
 * first); Got it when they owe you in all of theirs; none when settled.
 */
export function personAction(person: Pick<SplitecoPersonBalance, "balances">): PersonAction {
  const open = personAmounts(person);
  if (open.length === 0) return "settled";
  return open.some((a) => a.minor < 0) ? "pay" : "got";
}

/** Kitchen groups first, then by name; stable, whatever order the read came in. */
export function kitchenGroupsFirst<T extends Pick<SplitecoPersonGroupBalance, "kind" | "groupName">>(groups: readonly T[]): T[] {
  return [...groups].sort((a, b) => {
    const ka = a.kind === "kitchen" ? 0 : 1;
    const kb = b.kind === "kitchen" ? 0 : 1;
    return ka - kb || a.groupName.localeCompare(b.groupName);
  });
}

/** "Kitchen · Flat 4B" for a Kitchen group, the plain name otherwise. */
export function groupLabel(g: Pick<SplitecoPersonGroupBalance, "kind" | "groupName">): string {
  if (g.kind !== "kitchen") return g.groupName;
  return /^kitchen\b/i.test(g.groupName) ? g.groupName : `Kitchen · ${g.groupName}`;
}

export interface PersonRowView {
  subjectId: string;
  name: string;
  initial: string;
  /** The groups behind the net, Kitchen first: "Flat 4B · Goa trip". Everything shared when settled. */
  groupsText: string;
  amounts: PersonAmount[];
  action: PersonAction;
}

const nameOf = (p: Pick<SplitecoPersonBalance, "name">) => p.name?.trim() || "Someone";

export function personRow(person: SplitecoPersonBalance): PersonRowView {
  const name = nameOf(person);
  const amounts = personAmounts(person);
  const shown = amounts.length === 0 ? person.groups : person.groups.filter((g) => g.amountMinor !== 0);
  return {
    subjectId: person.subjectId,
    name,
    initial: name.slice(0, 1).toUpperCase(),
    groupsText: kitchenGroupsFirst(shown).map((g) => g.groupName).join(" · "),
    amounts,
    action: personAction(person),
  };
}

/** People narrowed by what was typed (name, case-insensitive); the read's order is kept. */
export function searchPeople<T extends Pick<SplitecoPersonBalance, "name">>(people: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q === "" ? [...people] : people.filter((p) => nameOf(p).toLowerCase().includes(q));
}

export interface PersonGroupRowView {
  groupId: string;
  label: string;
  currency: string;
  /** "₹300", unsigned; "Settled" at zero. */
  text: string;
  tone: MoneyTone;
}

export interface PersonPageView {
  subjectId: string;
  name: string;
  initial: string;
  /** One headline per currency; one "all settled" when there is none. */
  nets: Array<PersonAmount & { words: string }>;
  settled: boolean;
  groups: PersonGroupRowView[];
}

/** A person's page: the net, then a row per group, the Kitchen first. */
export function personPage(person: SplitecoPersonBalance): PersonPageView {
  const name = nameOf(person);
  const nets = personAmounts(person).map((a) => ({
    ...a,
    text: formatShort(Math.abs(a.minor), a.currency),
    words: a.minor < 0 ? `you owe ${name}` : `${name} owes you`,
  }));
  return {
    subjectId: person.subjectId,
    name,
    initial: name.slice(0, 1).toUpperCase(),
    nets,
    settled: nets.length === 0,
    groups: kitchenGroupsFirst(person.groups).map((g) => ({
      groupId: g.groupId,
      label: groupLabel(g),
      currency: g.currency,
      text: g.amountMinor === 0 ? "Settled" : formatShort(Math.abs(g.amountMinor), g.currency),
      tone: toneOf(g.amountMinor),
    })),
  };
}

/** The person with this id in a read, or null. */
export function findPerson(data: SplitecoBalancesResponse | null, subjectId: string): SplitecoPersonBalance | null {
  return data?.people.find((p) => p.subjectId === subjectId) ?? null;
}
