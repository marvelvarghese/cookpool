/**
 * A group's activity feed (Cookpool CP-8) as view-models: what each row
 * shows — its kind, title, who logged it and when, and what it did to *your*
 * balance — and what you may do with it (undo, flag). Pure and dependency-free
 * (contract types only), so it is unit-testable.
 */

import type { ActivityPage, KitchenTxn, KitchenTxnKind } from "@saas/contracts/kitchen";
import { formatMinor, formatSignedMinor } from "./money";
import { memberLabel, memberLabelInline, type MemberNames } from "./members";
import { agoText } from "./when";
import { isPendingId } from "@/lib/optimistic";

export type RowTone = "owed" | "owe" | "neutral";
export type KindTone = "green" | "tomato" | "blue" | "neutral";

/** Each kind's glyph (₹ ✓ U D W ↺), its name, and the tint of its bubble. */
export const TXN_KIND_META: Record<KitchenTxnKind, { glyph: string; label: string; tone: KindTone }> = {
  expense: { glyph: "₹", label: "Expense", tone: "blue" },
  settlement: { glyph: "✓", label: "Payment", tone: "green" },
  use: { glyph: "U", label: "Use", tone: "green" },
  dish: { glyph: "D", label: "Dish", tone: "tomato" },
  waste: { glyph: "W", label: "Waste", tone: "neutral" },
  reversal: { glyph: "↺", label: "Undo", tone: "neutral" },
};

/**
 * What a transaction did to your balance: Σ paid − Σ owed over your lines in
 * it (positive: you get money back). Null when it doesn't name you.
 */
export function yourPartMinor(txn: Pick<KitchenTxn, "splits">, meId: string | null | undefined): number | null {
  if (!meId) return null;
  let named = false;
  let net = 0;
  for (const s of txn.splits) {
    if (s.subjectId !== meId) continue;
    named = true;
    net += s.paidMinor - s.owedMinor;
  }
  return named ? net : null;
}

/**
 * When, briefly: "Just now", "5 min ago", "3 h ago", "Yesterday", then a date
 * ("12 Oct", with the year when it isn't this year's) — the app's one
 * timestamp helper (`agoText`, CP-23), in the viewer's local calendar.
 */
export function relativeWhen(iso: string, now: Date): string {
  return agoText(iso, now);
}

export interface ActivityRow {
  id: string;
  kind: KitchenTxnKind;
  glyph: string;
  kindLabel: string;
  kindTone: KindTone;
  title: string;
  /** "You · 3 h ago" */
  whoWhen: string;
  /** Your part (paid − owed); null when it doesn't name you. */
  yourMinor: number | null;
  tone: RowTone;
  /** "+₹40.75", "−₹24.00", "₹0.00" (a payment: the money that moved, + when it came to you); null when it doesn't name you. */
  amountText: string | null;
  /** The same for a screen reader, in words. */
  amountWords: string;
  /** "₹1,200.00" */
  totalText: string;
  /** A reversal has undone it: shown struck through, "Undone". */
  reversed: boolean;
  /** Its creator, or an owner or admin, may undo it (not a reversal, not already undone). */
  canUndo: boolean;
  /** Someone it names may flag it (not once undone, and not a viewer). */
  canFlag: boolean;
  /**
   * Swiping it left undoes it (PW-8): only your own entry whose menu offers
   * Undo, and never a payment or a dish — those stay behind ⋮ (`swipeUndoable`).
   */
  canSwipeUndo: boolean;
}

/**
 * The kinds a swipe may undo (PW-8, design §5): your own use, waste or bill.
 * Never a payment (Paid stays a button) or a dish (finalizing stays a
 * button); their Undo stays behind the row's ⋮, as does an owner's or
 * admin's undo of someone else's entry.
 */
// A bill is left out on purpose: undoing one reverses it for the whole group,
// which is a delete, and deletes stay buttons (cookpool-app README decision 3).
export const SWIPE_UNDO_KINDS: readonly KitchenTxnKind[] = ["use", "waste"];

/** Whether swiping this entry left undoes it: its ⋮ offers Undo, you logged it, and it is a use or a waste (never a bill, a payment or a dish). */
export function swipeUndoable(txn: Pick<KitchenTxn, "kind" | "createdBy">, ctx: { meId: string | null; canUndo: boolean }): boolean {
  return ctx.canUndo && ctx.meId !== null && txn.createdBy === ctx.meId && SWIPE_UNDO_KINDS.includes(txn.kind);
}

export function activityRow(
  txn: KitchenTxn,
  ctx: {
    meId: string | null;
    canReverseAny: boolean;
    now: Date;
    /** Display names (CP-9); people without one read "Member · 3f9a". */
    names?: MemberNames | null;
    /** False for a viewer, who writes nothing: no undo, no flag. Defaults to true. */
    canWrite?: boolean;
  },
): ActivityRow {
  const canWrite = ctx.canWrite ?? true;
  const meta = TXN_KIND_META[txn.kind];
  const yourMinor = yourPartMinor(txn, ctx.meId);
  // A payment shows the money that moved (SM-11, as SM-10 did on Home): "Anu
  // paid you" is +₹400 — money you received — though it takes your "get
  // back" down. Every other entry shows what it did to your balance.
  const cash = txn.kind === "settlement" && yourMinor !== null && yourMinor !== 0;
  const shownMinor = cash ? -yourMinor : yourMinor;
  const tone: RowTone = shownMinor === null || shownMinor === 0 ? "neutral" : shownMinor > 0 ? "owed" : "owe";
  const amount = shownMinor === null ? "" : formatMinor(Math.abs(shownMinor), txn.currency);
  const amountWords =
    shownMinor === null
      ? "Doesn't involve you"
      : cash
        ? shownMinor > 0
          ? `You received ${amount}`
          : `You paid ${amount}`
        : shownMinor > 0
          ? `Adds ${amount} to your balance`
          : shownMinor < 0
            ? `Takes ${amount} off your balance`
            : "No change to your balance";
  const when = relativeWhen(txn.occurredAt, ctx.now);
  const mine = ctx.meId !== null && txn.createdBy === ctx.meId;
  const pending = isPendingId(txn.id);
  // A row the server has not posted yet (SM-5) is undone from its toast, not its menu.
  const canUndo = canWrite && !pending && !txn.reversed && txn.kind !== "reversal" && (mine || ctx.canReverseAny);
  return {
    id: txn.id,
    kind: txn.kind,
    glyph: meta.glyph,
    kindLabel: meta.label,
    kindTone: meta.tone,
    title: txn.kind === "settlement" ? settlementTitle(txn, ctx.meId, ctx.names) : txn.title,
    whoWhen: [memberLabel(txn.createdBy, ctx.meId, ctx.names), when].filter(Boolean).join(" · "),
    yourMinor,
    tone,
    amountText: shownMinor === null ? null : formatSignedMinor(shownMinor, txn.currency),
    amountWords,
    totalText: formatMinor(txn.totalMinor, txn.currency),
    reversed: txn.reversed,
    canUndo,
    canFlag: canWrite && !pending && !txn.reversed && yourMinor !== null,
    canSwipeUndo: swipeUndoable(txn, { meId: ctx.meId, canUndo }),
  };
}

const METHOD_NAMES: Record<string, string> = { upi: "UPI", cash: "cash", bank: "bank", other: "other" };

/**
 * A payment's row title, from its two lines (the payer paid, the payee is
 * owed): "Anu paid you · UPI". The stored title is just "Payment".
 */
export function settlementTitle(
  txn: Pick<KitchenTxn, "title" | "splits" | "method">,
  meId: string | null | undefined,
  names?: MemberNames | null,
): string {
  const from = txn.splits.find((s) => s.paidMinor > 0);
  const to = txn.splits.find((s) => s.owedMinor > 0);
  if (!from || !to) return txn.title;
  const payer = memberLabel(from.subjectId, meId, names);
  const method = txn.method ? ` · ${METHOD_NAMES[txn.method] ?? txn.method}` : "";
  return `${payer} paid ${memberLabelInline(to.subjectId, meId, names)}${method}`;
}

/**
 * The feed with one transaction marked undone — the optimistic step of Undo,
 * before the reversal is posted (and put back if it fails). Returns the same
 * object when the transaction isn't in it. Never mutates the input.
 */
export function withTxnReversed<T extends { pages: readonly ActivityPage[] }>(data: T, txnId: string): T {
  let hit = false;
  const pages = data.pages.map((page) => {
    if (!page.items.some((t) => t.id === txnId)) return page;
    hit = true;
    return { ...page, items: page.items.map((t) => (t.id === txnId ? { ...t, reversed: true } : t)) };
  });
  return hit ? { ...data, pages } : data;
}

/** Every transaction in a paged feed, in order, without duplicates (a page boundary can repeat one). */
export function flattenActivity(pages: readonly ActivityPage[]): KitchenTxn[] {
  const seen = new Set<string>();
  const out: KitchenTxn[] = [];
  for (const page of pages) {
    for (const t of page.items) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}
