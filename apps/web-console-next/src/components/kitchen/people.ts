/**
 * People across groups (Cookpool CP-9) as pure view-models over the kitchen's
 * cross-group reads: the People list (search, largest amount first, per
 * currency), the totals Home and People show, the person view ("You and
 * Dev": its headline, the Why filters, the group shortcut in words, what
 * Record payment can post) and the names every screen labels people with.
 * Dependency-free (contract types only), so it is unit-testable.
 *
 * Amounts are integer minor units in each group's currency, and nothing is
 * ever added across currencies: a person or a total in two currencies shows
 * one line per currency.
 */

import type {
  CreateSettlementRequest,
  CurrencyTotal,
  KitchenTxnKind,
  MyBalancesResponse,
  PersonGroupView,
  PersonLine,
  PersonViewResponse,
  SettlementMethod,
} from "@saas/contracts/kitchen";
import { foldForSearch } from "./groups";
import { formatMinor } from "./money";
import { memberLabel, memberLabelInline, nameInitials, memberTag, type MemberNames } from "./members";

// ── Names ─────────────────────────────────────────────────────────

/** Everyone the cross-group read names, by id (people without a name are left out). */
export function namesFromBalances(data: Pick<MyBalancesResponse, "people"> | null | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const p of data?.people ?? []) {
    const name = p.displayName?.trim();
    if (name) names.set(p.subjectId, name);
  }
  return names;
}

/** `base` with `more` laid over it (later names win). */
export function mergeNames(base: MemberNames, more: Iterable<readonly [string, string | null | undefined]>): Map<string, string | null | undefined> {
  const out = new Map(base);
  for (const [id, name] of more) if (name?.trim()) out.set(id, name);
  return out;
}

// ── Amounts in words ──────────────────────────────────────────────

export type NetTone = "owed" | "owe" | "settled";

export function netTone(minor: number): NetTone {
  return minor > 0 ? "owed" : minor < 0 ? "owe" : "settled";
}

/** One currency's amount between you and someone: positive, they pay you. */
export interface CurrencyNet {
  currency: string;
  netMinor: number;
}

/** "Anu pays you ₹40.75", "You pay Anu ₹24.00", "Settled". */
export function netSentence(name: string, net: CurrencyNet): string {
  if (net.netMinor > 0) return `${name} pays you ${formatMinor(net.netMinor, net.currency)}`;
  if (net.netMinor < 0) return `You pay ${name} ${formatMinor(-net.netMinor, net.currency)}`;
  return "Settled";
}

/** Short words for a list row: "pays you", "you pay", "settled". */
export function netWords(minor: number): string {
  return minor > 0 ? "pays you" : minor < 0 ? "you pay" : "settled";
}

// ── The People list ───────────────────────────────────────────────

export interface PeopleRow {
  subjectId: string;
  /** Their name, or "Member · 3f9a". */
  label: string;
  /** The avatar's letter(s). */
  initial: string;
  /** The groups you share (and any where money is still open between you), by name. */
  groups: { orgId: string; slug: string; name: string }[];
  /** Per currency, in the order the groups use them; zero amounts dropped unless every one is zero. */
  nets: CurrencyNet[];
  /** Nothing to pay either way, in any group. */
  settled: boolean;
  /** The largest amount in any currency, for sorting. */
  largestMinor: number;
}

/** A person's nets added up per currency (never across). */
export function netsByCurrency(groups: readonly { currency: string; netMinor: number }[]): CurrencyNet[] {
  const out: CurrencyNet[] = [];
  for (const g of groups) {
    const t = out.find((x) => x.currency === g.currency);
    if (t) t.netMinor += g.netMinor;
    else out.push({ currency: g.currency, netMinor: g.netMinor });
  }
  const open = out.filter((n) => n.netMinor !== 0);
  return open.length > 0 ? open : out.slice(0, 1).map((n) => ({ ...n, netMinor: 0 }));
}

/**
 * Everyone you share a group with, matching `query` (every word, in their
 * name or a shared group's name), largest amount first — whichever way it
 * goes — then by name.
 */
export function peopleRows(data: Pick<MyBalancesResponse, "people"> | null | undefined, query = ""): PeopleRow[] {
  const words = foldForSearch(query).split(" ").filter(Boolean);
  const rows: PeopleRow[] = (data?.people ?? []).map((p) => {
    const name = p.displayName?.trim() || null;
    const nets = netsByCurrency(p.groups);
    return {
      subjectId: p.subjectId,
      label: name ?? `Member · ${memberTag(p.subjectId)}`,
      initial: name ? nameInitials(name) : memberTag(p.subjectId).slice(0, 2).toUpperCase(),
      groups: p.groups.map((g) => ({ orgId: g.orgId, slug: g.slug, name: g.name })),
      nets,
      settled: nets.every((n) => n.netMinor === 0),
      largestMinor: Math.max(0, ...nets.map((n) => Math.abs(n.netMinor))),
    };
  });
  const shown =
    words.length === 0
      ? rows
      : rows.filter((r) => {
          const hay = foldForSearch([r.label, ...r.groups.map((g) => g.name)].join(" "));
          return words.every((w) => hay.includes(w));
        });
  return shown.sort(
    (a, b) =>
      b.largestMinor - a.largestMinor ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }) ||
      (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0),
  );
}

// ── Totals (Home and People) ──────────────────────────────────────

export interface TotalLine extends CurrencyTotal {
  tone: NetTone;
  /** "You're owed ₹1,600.00", "You owe ₹24.00", "You're settled up". */
  headline: string;
  /** "₹1,624.00 to you · ₹24.00 from you" */
  detail: string;
}

export function totalLine(t: CurrencyTotal): TotalLine {
  const tone = netTone(t.netMinor);
  const headline =
    tone === "owed"
      ? `You're owed ${formatMinor(t.netMinor, t.currency)}`
      : tone === "owe"
        ? `You owe ${formatMinor(-t.netMinor, t.currency)}`
        : "You're settled up";
  return {
    ...t,
    tone,
    headline,
    detail: `${formatMinor(t.owedToYouMinor, t.currency)} to you · ${formatMinor(t.youOweMinor, t.currency)} from you`,
  };
}

/** "Across 3 groups" */
export function acrossGroups(count: number): string {
  return `Across ${count} ${count === 1 ? "group" : "groups"}`;
}

export interface HomeBalance {
  /** "Across 3 groups" */
  across: string;
  /** One line per currency your groups count in. */
  totals: TotalLine[];
  /** People with money open between you, largest first (at most `limit`). */
  people: PeopleRow[];
  /** How many more have money open. */
  morePeople: number;
  /** Some payment involves you: offer Settle up. */
  settleUp: boolean;
}

/** Home's balance card, from the one cross-group read. */
export function homeBalance(data: MyBalancesResponse, limit = 4): HomeBalance {
  const open = peopleRows(data).filter((r) => !r.settled);
  return {
    across: acrossGroups(data.groups.length),
    totals: data.totals.map(totalLine),
    people: open.slice(0, limit),
    morePeople: Math.max(0, open.length - limit),
    settleUp: data.totals.some((t) => t.owedToYouMinor > 0 || t.youOweMinor > 0),
  };
}

// ── The person view ───────────────────────────────────────────────

export type LineFilter = "all" | "dishes" | "used" | "bills";

/** The Why card's chips, in order. */
export const LINE_FILTERS: readonly { id: LineFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "dishes", label: "Dishes" },
  { id: "used", label: "Items used" },
  { id: "bills", label: "Bills" },
];

const FILTER_OF: Record<KitchenTxnKind, LineFilter | null> = {
  dish: "dishes",
  use: "used",
  waste: "used",
  expense: "bills",
  settlement: null,
  reversal: null,
};

/**
 * The lines a chip shows. An undo goes with what it undoes (a reversed bill
 * is under Bills along with its undo); payments only under Everything.
 */
export function filterLines(lines: readonly PersonLine[], filter: LineFilter): PersonLine[] {
  if (filter === "all") return [...lines];
  const kindOf = new Map(lines.map((l) => [l.txnId, l.kind] as const));
  return lines.filter((l) => {
    const kind = l.kind === "reversal" && l.reverses ? (kindOf.get(l.reverses) ?? l.kind) : l.kind;
    return FILTER_OF[kind] === filter;
  });
}

/** The person's name as the view uses it: their name, else "Member · 3f9a". */
export function personName(view: Pick<PersonViewResponse, "subjectId" | "displayName">): string {
  return view.displayName?.trim() || `Member · ${memberTag(view.subjectId)}`;
}

export interface PersonHeadline extends CurrencyNet {
  tone: NetTone;
  /** "Dev pays you ₹90.00", "You pay Dev ₹24.00", "Settled". */
  text: string;
}

/** The big number: what the plans ask between you two, one line per currency. */
export function personHeadlines(view: PersonViewResponse): PersonHeadline[] {
  const name = personName(view);
  const open = view.totals.filter((t) => t.netMinor !== 0);
  const lines = open.length > 0 ? open : [{ currency: view.totals[0]?.currency ?? "INR", netMinor: 0 }];
  return lines.map((t) => ({ ...t, tone: netTone(t.netMinor), text: netSentence(name, t) }));
}

/** "Between you two": what you owe each other directly in a group. */
export function betweenSentence(name: string, g: Pick<PersonGroupView, "pairwiseMinor" | "currency">): string {
  if (g.pairwiseMinor > 0) return `${name} owes you ${formatMinor(g.pairwiseMinor, g.currency)}`;
  if (g.pairwiseMinor < 0) return `You owe ${name} ${formatMinor(-g.pairwiseMinor, g.currency)}`;
  return "Nothing either way";
}

/** The Why card's last line: what the group's plan asks of you two. */
export function planSentence(name: string, g: Pick<PersonGroupView, "planMinor" | "currency" | "name">): string {
  if (g.planMinor === 0) return `Nothing to pay in ${g.name}`;
  return netSentence(name, { currency: g.currency, netMinor: g.planMinor });
}

/**
 * The group shortcut in words, or null when there is none. With a step
 * ("Dev owes Anu ₹90.00 and Anu owes you, so Dev pays you directly"), else
 * what it does in general.
 */
export function shortcutSentence(
  g: Pick<PersonGroupView, "shortcutMinor" | "shortcutVia" | "currency">,
  ctx: { meId: string | null; otherId: string; otherName: string; names?: MemberNames | null },
): string | null {
  if (g.shortcutMinor === 0) return null;
  const via = g.shortcutVia;
  if (via) {
    const name = (id: string, inline: boolean): string => {
      if (ctx.meId && id === ctx.meId) return inline ? "you" : "You";
      if (id === ctx.otherId) return ctx.otherName;
      const third = via.thirdDisplayName?.trim();
      if (third) return third;
      return inline ? memberLabelInline(id, ctx.meId, ctx.names) : memberLabel(id, ctx.meId, ctx.names);
    };
    const you = (id: string) => !!ctx.meId && id === ctx.meId;
    const from = name(via.fromSubjectId, false);
    const fromInline = name(via.fromSubjectId, true);
    const mid = name(via.viaSubjectId, true);
    const midSubject = name(via.viaSubjectId, false);
    const to = name(via.toSubjectId, true);
    return (
      `${from} ${you(via.fromSubjectId) ? "owe" : "owes"} ${mid} ${formatMinor(via.amountMinor, g.currency)} ` +
      `and ${you(via.viaSubjectId) ? "you" : midSubject} ${you(via.viaSubjectId) ? "owe" : "owes"} ${to}, ` +
      `so ${fromInline} ${you(via.fromSubjectId) ? "pay" : "pays"} ${to} directly`
    );
  }
  const amount = formatMinor(Math.abs(g.shortcutMinor), g.currency);
  return g.shortcutMinor > 0
    ? `The group's plan routes ${amount} of other debts through ${ctx.otherName} to you, so everyone makes fewer payments`
    : `The group's plan routes ${amount} of other debts through you to ${ctx.otherName}, so everyone makes fewer payments`;
}

// ── Record payment ────────────────────────────────────────────────

export interface RecordOption {
  orgId: string;
  slug: string;
  groupName: string;
  currency: string;
  fromSubjectId: string;
  toSubjectId: string;
  amountMinor: number;
}

/**
 * What Record payment can post: in every group whose plan has a payment
 * between you two, that payment — unless you only view the group.
 */
export function recordOptions(view: PersonViewResponse, meId: string | null): RecordOption[] {
  if (!meId) return [];
  return view.groups
    .filter((g) => g.planMinor !== 0 && g.role !== "viewer")
    .map((g) => ({
      orgId: g.orgId,
      slug: g.slug,
      groupName: g.name,
      currency: g.currency,
      fromSubjectId: g.planMinor > 0 ? view.subjectId : meId,
      toSubjectId: g.planMinor > 0 ? meId : view.subjectId,
      amountMinor: Math.abs(g.planMinor),
    }));
}

/** The settlement Record posts for an option, paid by `method`. */
export function recordRequest(o: RecordOption, method: SettlementMethod): CreateSettlementRequest {
  return { fromSubjectId: o.fromSubjectId, toSubjectId: o.toSubjectId, amountMinor: o.amountMinor, method };
}

/** "Dev pays you ₹90.00 in Flat 4B" — a Record option in words. */
export function recordOptionSentence(o: RecordOption, name: string, meId: string | null): string {
  const net = o.toSubjectId === meId ? o.amountMinor : -o.amountMinor;
  return `${netSentence(name, { currency: o.currency, netMinor: net })} in ${o.groupName}`;
}
