/**
 * Home's Needs you (cookpool-revamp RV-15, the canvas's `HomeRevamp`), as
 * pure view-models: every kind of row in one list, in the board's order —
 * asks you answer, open dishes, people to pay, food to use, splits (your
 * dishes to split or finalize, and the split reminders), your own asks that
 * wait, then flags — each a title, one line under it and one button; the
 * line a row says once it is done here ("You had 1 · ₹31.20", "Paid ₹25 ·
 * UPI", "Used · 1 cup", "Allowed · Anu owes you ₹12"), dimmed with Undo; and
 * the count beside the heading ("· 3", "· all done"). Whole amounts drop
 * their ".00" (₹25, ₹31.20).
 *
 * Today's frame keeps `inbox.ts`'s To do words; nothing here changes them.
 * Dependency-free (contracts and the pure kitchen modules), so it is
 * unit-testable.
 */

import type { InboxItem, KitchenAsk } from "@saas/contracts/kitchen";
import { memberLabel } from "./members";
import { halfText } from "./dish";
import { shortMoney } from "./from-before";
import { dueWord, inboxCard, type InboxAction, type InboxContext } from "./inbox";
import { askLeftText, askerWords, approvedText, declinedText, forWords, type AnsweredAsk } from "./ask-card";
import { askAnswererWords, itemWords, lapsesIn } from "./ask-before-use";

// ── The kinds, in the board's order ───────────────────────────────

export type NeedsKind = "ask" | "claim" | "pay" | "food" | "split" | "mine" | "flag";

/** Asks first, then dishes, money, food, splits, your own asks, flags (the board). */
export const NEEDS_RANK: Readonly<Record<NeedsKind, number>> = { ask: 0, claim: 1, pay: 2, food: 3, split: 4, mine: 5, flag: 6 };

/** The colour of a row's second line. */
export type NeedsTone = "muted" | "owe" | "owed" | "soon" | "expired";

export interface NeedsText {
  title: string;
  meta: string;
  tone: NeedsTone;
}

/** A row's place: its kind's rank, then where it came in its own list. */
export interface NeedsPlace {
  key: string;
  rank: number;
  seq: number;
}

/** Rows in the board's order: by kind, then each list's own order (the server's, most urgent first). */
export function orderNeeds<T extends NeedsPlace>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.rank - b.rank || a.seq - b.seq);
}

/**
 * "· 3" for the rows still to do, "· all done" once every row shown is done
 * here; null when there are no rows (the section hides).
 */
export function needsCount(rows: readonly { done: boolean }[]): string | null {
  if (rows.length === 0) return null;
  const left = rows.filter((r) => !r.done).length;
  return left === 0 ? "· all done" : `· ${left}`;
}

// ── The inbox's items ─────────────────────────────────────────────

export interface NeedsTodo extends NeedsText {
  key: string;
  kind: NeedsKind;
  /** Where the title goes. */
  href: string;
  action: InboxAction;
  /** The face beside it (a dish's cook, who you pay); null for an icon. */
  faceId: string | null;
  /** The badge's icon when there is no face. */
  icon: "expired" | "soon" | "split" | "flag" | "dish";
  /** An open dish's price of one portion, for "You had 1 · ₹31.20" once you pick. */
  perPortion: { minor: number; currency: string } | null;
}

/**
 * One inbox item as a Needs you row: "Egg fried rice" over "Meera cooked ·
 * ₹31 a portion"; "Pay Dev" over "₹25 you owe"; "Greek yogurt" over
 * "Expired"; "Split your Dal tadka" over "Who had how much · ₹180"; "Dev
 * flagged Groceries" over "“Charged twice” · ₹420". Null for a kind this app
 * does not know.
 */
export function needsTodo(item: InboxItem, ctx: InboxContext): NeedsTodo | null {
  const card = inboxCard(item, ctx);
  if (!card) return null;
  const base = { key: card.key, href: card.href, action: card.action, perPortion: null };
  switch (item.kind) {
    case "claim_dish": {
      const d = item.dish;
      const cook = d.cookName ?? memberLabel(d.cook, ctx.meId, ctx.names);
      return { ...base, perPortion: { minor: d.perPortionMinor, currency: d.currency }, kind: "claim", title: d.name, meta: `${cook} cooked · ${shortMoney(d.perPortionMinor, d.currency)} a portion`, tone: "muted", faceId: d.cook, icon: "dish" };
    }
    case "finalize_dish": {
      const d = item.dish;
      const total = shortMoney(d.totalMinor, d.currency);
      if (card.action.kind === "split") {
        return { ...base, kind: "split", title: `Split your ${d.name}`, meta: `Who had how much · ${total}`, tone: "muted", faceId: null, icon: "split" };
      }
      const had = d.orgId ? `${halfText(d.claimedHalf)} of ${halfText(d.portionsHalf)} had` : "Just for you";
      return { ...base, kind: "split", title: d.name, meta: `${had} · ${total}`, tone: "muted", faceId: null, icon: "split" };
    }
    case "use_soon": {
      const days = item.item.daysToUseBy;
      return { ...base, kind: "food", title: item.item.name, meta: dueWord(days), tone: days < 0 ? "expired" : "soon", faceId: null, icon: days < 0 ? "expired" : "soon" };
    }
    case "payment_due": {
      const to = item.toName ?? memberLabel(item.toSubjectId, ctx.meId, ctx.names);
      return { ...base, kind: "pay", title: `Pay ${to}`, meta: `${shortMoney(item.amountMinor, item.currency)} you owe`, tone: "owe", faceId: item.toSubjectId, icon: "dish" };
    }
    case "flag": {
      const who = item.flaggedByName ?? memberLabel(item.flaggedBy, ctx.meId, ctx.names);
      const meta = [card.note, shortMoney(item.totalMinor, item.currency)].filter(Boolean).join(" · ");
      return { ...base, kind: "flag", title: `${who} flagged ${item.title}`, meta, tone: "muted", faceId: null, icon: "flag" };
    }
    default:
      return null;
  }
}

/** Every inbox item as a row, each once, in the server's order. */
export function needsTodos(items: readonly InboxItem[], ctx: InboxContext): NeedsTodo[] {
  const seen = new Set<string>();
  const out: NeedsTodo[] = [];
  for (const item of items) {
    const row = needsTodo(item, ctx);
    if (!row || seen.has(row.key)) continue;
    seen.add(row.key);
    out.push(row);
  }
  return out;
}

/** Food's button: "Used" for food past its date, else the amount it logs ("1 glass"). */
export function foodButton(tone: NeedsTone, words: string): string {
  return tone === "expired" ? "Used" : words;
}

// ── What a row says once it is done here ──────────────────────────

/** "You had 1 · ₹31.20": a portion picked, and what it costs you. */
export function claimedMeta(perPortionMinor: number, currency: string, half: number): string {
  return `You had ${halfText(half)} · ${shortMoney(Math.round((perPortionMinor * half) / 2), currency)}`;
}

/** "Paid ₹25 · UPI". */
export function paidMeta(amountMinor: number, currency: string, method: string): string {
  return `Paid ${shortMoney(amountMinor, currency)} · ${method}`;
}

/** "Used · 1 cup". */
export function usedMeta(words: string): string {
  return `Used · ${words}`;
}

// ── Asks ──────────────────────────────────────────────────────────

export interface AskRowText extends NeedsText {
  /** "Allow", or "Allow what's left" when less is left than was asked. */
  allow: string;
  /** "Always let Anu use milk" (the switch under the row). */
  always: string;
}

/**
 * An ask you answer, as a row: "Anu asks for Milk" over "1 glass · ₹12 back
 * to you" ("1 glass for Anu and Dev · …" when it is for more than the
 * asker; "Only 0.4 g left" when less is left), No and Allow.
 */
export function askRowText(ask: KitchenAsk, ctx: { meId: string | null; names?: InboxContext["names"] }): AskRowText {
  const asker = askerWords(ask, ctx.names);
  const forOthers = ask.consumers.length === 1 && ask.consumers[0] === ask.asker ? "" : ` for ${forWords(ask, { meId: ctx.meId, names: ctx.names ?? null })}`;
  const back = ask.backMinor > 0 ? `${shortMoney(ask.backMinor, ask.currency)} back to you` : "No money moves";
  const always = `Always let ${asker} use ${itemWords(ask.item.name)}`;
  if (!ask.enough) {
    const short = ask.item.qtyLeftMilli > 0 ? `Only ${askLeftText(ask.item)} left` : "None left";
    return { title: `${asker} asks for ${ask.item.name}`, meta: `${ask.amount}${forOthers} · ${short}`, tone: "soon", allow: "Allow what's left", always };
  }
  return { title: `${asker} asks for ${ask.item.name}`, meta: `${ask.amount}${forOthers} · ${back}`, tone: ask.backMinor > 0 ? "owed" : "muted", allow: "Allow", always };
}

/** An answered ask's line: "Allowed · Anu owes you ₹12", "Said no · Anu was told". */
export function askAnsweredMeta(a: AnsweredAsk, ctx: { meId: string | null; names?: InboxContext["names"] }): string {
  if (a.answer === "approved") return approvedText(a.ask, { meId: ctx.meId, names: ctx.names ?? null, always: a.always }).title.replace(/^Approved\b/, "Allowed");
  return declinedText(a.ask, { names: ctx.names ?? null }).title.replace(/^Declined\b/, "Said no");
}

/** Your own ask while it waits: "Asked Meera for saffron" over "1 pinch · waiting · 24 h left". */
export function mineRowText(ask: KitchenAsk, ctx: { names?: InboxContext["names"]; now: Date }): NeedsText {
  const who = askAnswererWords(ask, ctx.names);
  return { title: `Asked ${who} for ${itemWords(ask.item.name)}`, meta: `${ask.amount} · waiting · ${lapsesIn(ask.expiresAt, ctx.now)} left`, tone: "soon" };
}

/** Your own ask, cancelled here: "Cancelled · Meera was told". */
export function cancelledMeta(ask: Pick<KitchenAsk, "answerer" | "answererName">, names?: InboxContext["names"]): string {
  const who = askAnswererWords(ask, names);
  return `Cancelled · ${who.charAt(0).toUpperCase()}${who.slice(1)} was told`;
}

/** Your asks Needs you lists: the ones that still wait, newest first (the server's order). */
export function waitingMine(mine: readonly KitchenAsk[] | null | undefined): KitchenAsk[] {
  return (mine ?? []).filter((a) => a.state === "pending" && !a.id.startsWith("pending_"));
}
