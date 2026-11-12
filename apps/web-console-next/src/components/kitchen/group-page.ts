/**
 * Groups and one group's page under the seven rules (Cookpool SM-11), as
 * pure view-models: a Groups row (your balance there as a number, no role
 * words), the group page's money line and its Settle up, the Balances
 * section's short lines, and the plain role words Settings uses.
 * Dependency-free apart from the app's pure helpers, so it is unit-testable.
 */

import type { BalancesResponse, KitchenTxn, MyGroupBalance } from "@saas/contracts/kitchen";
import { settlementTitle, yourPartMinor } from "./activity";
import type { GroupRole } from "./groups";
import { moneyLine, type MoneyLine } from "./home";
import { memberLabel, type MemberNames } from "./members";
import { formatMinor } from "./money";

/** Groups shows its search only from this many groups (past 8). */
export const GROUP_SEARCH_FROM = 9;

export function showGroupSearch(count: number): boolean {
  return count >= GROUP_SEARCH_FROM;
}

/** Activity rows a group's page shows before "See all". */
export const GROUP_ACTIVITY_ROWS = 5;
/** Dishes a group's page shows before "See all". */
export const GROUP_DISH_ROWS = 3;

export interface GroupListRow {
  name: string;
  /** "5 people"; null before the cross-group read has the group. */
  people: string | null;
  /** "You get back ₹86.50" / "You owe $25.00"; null when settled (no zero cells). */
  money: MoneyLine | null;
}

/** One row of Groups: its name, how many are in it and your balance there — no role words. */
export function groupListRow(
  group: { name: string },
  kitchen: Pick<MyGroupBalance, "balanceMinor" | "currency" | "memberCount"> | null | undefined,
): GroupListRow {
  return {
    name: group.name,
    people: kitchen ? `${kitchen.memberCount} ${kitchen.memberCount === 1 ? "person" : "people"}` : null,
    money: kitchen && kitchen.balanceMinor !== 0 ? moneyLine({ currency: kitchen.currency, netMinor: kitchen.balanceMinor }) : null,
  };
}

export interface GroupMoney {
  /** "You get back ₹62.50", "You owe ₹24.00", "Settled up". */
  line: MoneyLine;
  /** Settle up is offered only when you owe or are owed. */
  settleUp: boolean;
}

/** The group page's header money: your balance in the group, in its currency. */
export function groupMoney(data: Pick<BalancesResponse, "currency" | "balances">, meId: string | null): GroupMoney {
  const minor = meId ? (data.balances.find((b) => b.subjectId === meId)?.balanceMinor ?? 0) : 0;
  return { line: moneyLine({ currency: data.currency, netMinor: minor }), settleUp: minor !== 0 };
}

export interface GroupBalanceRow {
  subjectId: string;
  you: boolean;
  /** "You", "Dev Patel". */
  label: string;
  tone: "owed" | "owe";
  /** "gets back", "owes" ("get back", "owe" for you). */
  words: string;
  /** "₹86.50" */
  amount: string;
}

/**
 * The group page's Balances section: one short line for everyone else with
 * money open, the largest first — nobody at zero, and not you (your money is
 * the page's header: each amount shows once).
 */
export function groupBalanceRows(
  data: Pick<BalancesResponse, "currency" | "balances">,
  meId: string | null,
  names?: MemberNames | null,
): GroupBalanceRow[] {
  return data.balances
    .filter((b) => b.balanceMinor !== 0 && b.subjectId !== meId)
    .sort(
      (a, b) =>
        Math.abs(b.balanceMinor) - Math.abs(a.balanceMinor) ||
        (a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0),
    )
    .map((b) => {
      const you = meId !== null && b.subjectId === meId;
      const owed = b.balanceMinor > 0;
      return {
        subjectId: b.subjectId,
        you,
        label: memberLabel(b.subjectId, meId, names),
        tone: owed ? "owed" : "owe",
        words: owed ? (you ? "get back" : "gets back") : you ? "owe" : "owes",
        amount: formatMinor(Math.abs(b.balanceMinor), data.currency),
      };
    });
}

/** A role in Settings, in plain words ("Can only view", not "Viewer"); null for a member, the usual case. */
export function roleWords(role: GroupRole | null): string | null {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "viewer") return "Can only view";
  return null;
}

/** Where a group's Settle up goes: People, filtered to the group (`/settle?group=` still leads there). */
export function groupSettleHref(slug: string): string {
  return `/people?group=${encodeURIComponent(slug)}`;
}

// ── The revamp (RV-5, the canvas's RvGroup) ─────────────────────────

/** The group page's three tabs, in order; Activity when the address names none. */
export const GROUP_TABS = [
  { id: "activity", label: "Activity" },
  { id: "pantry", label: "Pantry" },
  { id: "money", label: "Money" },
] as const;
export type GroupTab = (typeof GROUP_TABS)[number]["id"];

export function groupTabFrom(param: string | null | undefined): GroupTab {
  return param === "pantry" || param === "money" ? param : "activity";
}

/** A tab's address: Activity is the bare page. */
export function groupTabHref(slug: string, tab: GroupTab): string {
  const base = `/groups/${encodeURIComponent(slug)}`;
  return tab === "activity" ? base : `${base}?tab=${tab}`;
}

/** Rows each tab shows before "See all". */
export const GROUP_TAB_ROWS = 3;

/** Faces in the header's stack before "+N". */
export const GROUP_FACES = 4;

/** The header's faces: you first, then everyone else in the list's order, at most `max`, and how many more. */
export function groupFaces(subjectIds: readonly string[], meId: string | null, max = GROUP_FACES): { shown: string[]; more: number } {
  const ordered = meId && subjectIds.includes(meId) ? [meId, ...subjectIds.filter((s) => s !== meId)] : [...subjectIds];
  return { shown: ordered.slice(0, max), more: Math.max(0, ordered.length - max) };
}

/** The header's balance pill: "+₹842", "−₹24.50", "Square" at zero (the boards' word, RV-23). */
export function groupPill(data: Pick<BalancesResponse, "currency" | "balances">, meId: string | null): { tone: "owed" | "owe" | "settled"; text: string } {
  const minor = meId ? (data.balances.find((b) => b.subjectId === meId)?.balanceMinor ?? 0) : 0;
  if (minor === 0) return { tone: "settled", text: "Square" };
  // Whole rupees where whole, as RvGroup writes it (RV-17): "+₹842".
  const amount = whole(minor, data.currency);
  return minor > 0 ? { tone: "owed", text: `+${amount}` } : { tone: "owe", text: `−${amount}` };
}

/** A Balances row's amount, signed by which way it goes for them: "+₹610.00" gets back, "−₹24.00" owes. */
export function balanceFact(row: Pick<GroupBalanceRow, "tone" | "amount">): string {
  return row.tone === "owed" ? `+${row.amount}` : `−${row.amount}`;
}

/** Add, the group's one main button: what it offers, each a link for this group. */
export function groupAddChoices(group: { slug: string; id: string }): { id: string; label: string; href: string }[] {
  return [
    { id: "expense", label: "Expense", href: `/groups/${encodeURIComponent(group.slug)}/expense` },
    { id: "item", label: "Pantry item", href: `/pantry/new?pantry=${encodeURIComponent(group.id)}` },
    { id: "cook", label: "Dish I cooked", href: "/cook" },
  ];
}

// ── The approved board (RV-17, RvGroup) ─────────────────────────────

/** A group's balance and its why, on Money (the pill, the Money tab's See all). */
export function groupMoneyHref(orgId: string): string {
  return `/money?group=${encodeURIComponent(orgId)}`;
}

function firstWord(label: string): string {
  return label.split(" ")[0] || label;
}

function whole(minor: number, currency: string): string {
  const text = formatMinor(Math.abs(minor), currency);
  return minor % 100 === 0 ? text.replace(/\.00$/, "") : text;
}

/**
 * A Latest row's one line (RvGroup): who did what, first names — "Meera
 * cooked Egg fried rice", "Dev used Oil", "You paid Gas cylinder", "Spinach
 * went to waste", "Anu paid you · UPI".
 */
export function latestTitle(
  txn: Pick<KitchenTxn, "kind" | "title" | "createdBy" | "splits" | "method">,
  meId: string | null,
  names?: MemberNames | null,
): string {
  const who = (id: string) => firstWord(memberLabel(id, meId, names));
  switch (txn.kind) {
    case "expense": {
      const payer = txn.splits.find((s) => s.paidMinor > 0)?.subjectId ?? txn.createdBy;
      return `${who(payer)} paid ${txn.title}`;
    }
    case "dish":
      return `${who(txn.createdBy)} cooked ${txn.title}`;
    case "use": {
      // Your item, used by someone else, is "your oil" (RvGroup): you are the one paid for it.
      const owner = txn.splits.find((s) => s.paidMinor > 0)?.subjectId ?? null;
      const yours = meId !== null && owner === meId && txn.createdBy !== meId;
      return yours ? `${who(txn.createdBy)} used your ${lowerFirst(txn.title)}` : `${who(txn.createdBy)} used ${txn.title}`;
    }
    case "waste":
      return `${txn.title} went to waste`;
    case "settlement":
      return settlementTitle(txn, meId, names);
    default:
      return txn.title;
  }
}

/** "Oil" → "oil" for "your oil"; a name that starts with capitals ("UPI", "MTR mix") stays. */
function lowerFirst(title: string): string {
  return /^[A-Z][a-z]/.test(title) ? title[0]!.toLowerCase() + title.slice(1) : title;
}

/** A Latest fact's colour: money back, money you owe, waste (red), or muted. */
export type LatestTone = "owed" | "owe" | "waste" | "settled";

/**
 * A Latest row's one coloured fact, from your view (RvGroup, RV-23):
 * - what came back to you, "+₹92" (blue);
 * - your share of something, "₹38 you" (orange), or of waste, "₹8 you" (red);
 * - a payment, the money that moved, muted: "₹500";
 * - a dish you weren't in, what a portion cost, muted: "₹31 a portion";
 * - anything else that doesn't name you, its total, muted.
 */
export function latestFact(txn: Pick<KitchenTxn, "kind" | "splits" | "totalMinor" | "currency">, meId: string | null): { text: string; tone: LatestTone } {
  const mine = yourPartMinor(txn, meId);
  if (txn.kind === "settlement") return { text: whole(mine ? mine : txn.totalMinor, txn.currency), tone: "settled" };
  if (mine === null) {
    if (txn.kind === "dish") {
      const portion = Math.min(...txn.splits.map((s) => s.owedMinor).filter((m) => m > 0));
      if (Number.isFinite(portion)) return { text: `${whole(portion, txn.currency)} a portion`, tone: "settled" };
    }
    return { text: whole(txn.totalMinor, txn.currency), tone: "settled" };
  }
  if (mine === 0) return { text: whole(0, txn.currency), tone: "settled" };
  if (mine > 0) return { text: `+${whole(mine, txn.currency)}`, tone: "owed" };
  return { text: `${whole(mine, txn.currency)} you`, tone: txn.kind === "waste" ? "waste" : "owe" };
}

/** The Money tab's rows from your view (spliteco-worker's Kitchen plan): "+₹610" they owe you, "−₹24" you owe them, "Square" at zero. */
export function balanceFromYou(minor: number, currency: string): { text: string; tone: "owed" | "owe" | "settled" } {
  if (minor === 0) return { text: "Square", tone: "settled" };
  return { text: `${minor > 0 ? "+" : "−"}${whole(minor, currency)}`, tone: minor > 0 ? "owed" : "owe" };
}

/** A Pantry tab fact: "1 L · Tomorrow"; the expired colour only for "Expired". */
export function pantryFactTone(chip: { tone: string } | null): "expired" | "muted" {
  return chip?.tone === "expired" ? "expired" : "muted";
}
