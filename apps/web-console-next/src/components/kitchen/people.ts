/**
 * People across groups (Cookpool CP-9) as pure view-models over the kitchen's
 * cross-group reads: the people you share a group with, and since SM-11
 * People and Settle as one screen — the money headline per currency and
 * everyone as faces — and a person: their headline per currency, the Why in
 * plain lines (who pays whom directly instead of through whom), what Record
 * payment can post, and the names every screen labels people with.
 * Dependency-free (contract types and the app's pure helpers), so it is
 * unit-testable.
 *
 * Amounts are integer minor units in each group's currency, and nothing is
 * ever added across currencies: a person or a total in two currencies shows
 * one line per currency.
 */

import type {
  CreateSettlementRequest,
  MyBalancesResponse,
  PersonGroupView,
  PersonViewResponse,
  SettlementMethod,
} from "@saas/contracts/kitchen";
import { foldForSearch } from "./groups";
import { formatMinor } from "./money";
import { memberLabel, memberLabelInline, nameInitials, memberTag, type MemberNames } from "./members";
import { homeMoney, moneyLine, type MoneyLine } from "./home";

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

// ── The person view ───────────────────────────────────────────────

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

/** The Why's last line: what the group's plan asks of you two. */
export function planSentence(name: string, g: Pick<PersonGroupView, "planMinor" | "currency" | "name">): string {
  if (g.planMinor === 0) return `Nothing to pay in ${g.name}`;
  return netSentence(name, { currency: g.currency, netMinor: g.planMinor });
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

// ── People and Settle as one screen (SM-11) ───────────────────────

/**
 * People's headline: one line per currency with money open — "You get back
 * ₹62.50", "You owe $25.00", your own currency first (Home's order) — and
 * never a zero cell; "Settled up" when nothing is open anywhere. Filtered to
 * one group (`orgId`): your balance there, in its currency.
 */
export function peopleMoney(data: Pick<MyBalancesResponse, "groups" | "totals">, orgId?: string | null): MoneyLine[] {
  if (orgId) {
    const g = data.groups.find((x) => x.orgId === orgId);
    return [moneyLine({ currency: g?.currency ?? "INR", netMinor: g?.balanceMinor ?? 0 })];
  }
  const money = homeMoney(data);
  return [money.main, ...money.others];
}

/**
 * Everyone you share a group with (or, filtered, everyone in that group), by
 * name: People's faces, each opening that person. Amounts are not repeated
 * here — each debt shows once, in the payments above.
 */
export function everyoneIn(data: Pick<MyBalancesResponse, "people"> | null | undefined, orgId?: string | null): PeopleRow[] {
  return peopleRows(data)
    .filter((r) => !orgId || r.groups.some((g) => g.orgId === orgId))
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }) ||
        (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0),
    );
}

/** The first word of a person's name ("Dev Patel" → "Dev"); "Member · 3f9a" stays whole. */
export function firstName(view: Pick<PersonViewResponse, "subjectId" | "displayName">): string {
  const name = view.displayName?.trim();
  return name ? name.split(/\s+/)[0]! : personName(view);
}

export interface PersonMoneyLine {
  currency: string;
  tone: NetTone;
  /** "Dev pays you", "You pay Dev", "Settled up". */
  label: string;
  /** "₹90.00"; null when settled. */
  amount: string | null;
}

/** A person's headline: one line per currency between you two ("Dev pays you ₹90.00"), no zero cells. */
export function personMoney(view: PersonViewResponse): PersonMoneyLine[] {
  const name = firstName(view);
  return personHeadlines(view).map((h) => ({
    currency: h.currency,
    tone: h.tone,
    label: h.tone === "owed" ? `${name} pays you` : h.tone === "owe" ? `You pay ${name}` : "Settled up",
    amount: h.tone === "settled" ? null : formatMinor(Math.abs(h.netMinor), h.currency),
  }));
}

/**
 * Why a group's plan differs from what you two owe each other, in plain
 * words (it was "Group shortcut"): "Dev pays you directly instead of through
 * Anu"; without one person who explains it, "Dev also pays you ₹40.00 for
 * others". Null when the plan is just what you owe each other.
 */
export function shortcutPlain(
  g: Pick<PersonGroupView, "shortcutMinor" | "shortcutVia" | "currency">,
  ctx: { meId: string | null; otherId: string; otherName: string; names?: MemberNames | null },
): string | null {
  if (g.shortcutMinor === 0) return null;
  const via = g.shortcutVia;
  if (via) {
    const me = (id: string) => !!ctx.meId && id === ctx.meId;
    const name = (id: string, inline: boolean): string => {
      if (me(id)) return inline ? "you" : "You";
      if (id === ctx.otherId) return ctx.otherName;
      const third = via.thirdDisplayName?.trim();
      if (third) return third.split(/\s+/)[0]!;
      return inline ? memberLabelInline(id, ctx.meId, ctx.names) : memberLabel(id, ctx.meId, ctx.names);
    };
    const verb = me(via.fromSubjectId) ? "pay" : "pays";
    return `${name(via.fromSubjectId, false)} ${verb} ${name(via.toSubjectId, true)} directly instead of through ${name(via.viaSubjectId, true)}`;
  }
  const amount = formatMinor(Math.abs(g.shortcutMinor), g.currency);
  return g.shortcutMinor > 0 ? `${ctx.otherName} also pays you ${amount} for others` : `You also pay ${ctx.otherName} ${amount} for others`;
}
