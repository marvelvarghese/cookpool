/**
 * Home's inbox (Cookpool CP-23) as a view-model: one thing that needs you per
 * row, from `GET /v1/kitchen/me/inbox` (CP-19), each with the one action that
 * settles it where you are —
 *
 *   claim_dish     how much you had: 0 · ½ · 1 · 1½ · 2 (Undo sets it back)
 *   finalize_dish  your dish: Finalize, in one tap (an open dish, or one just
 *                  for you), or Set everyone's portions on its page (an
 *                  assigned dish)
 *   use_soon       your usual amount (else the first kitchen measure) for
 *                  just you, in one tap with Undo
 *   payment_due    Paid (records it, with Undo), when you may record it
 *   flag           someone flagged an entry you logged: open it
 *
 * `inboxCard` holds what each item is and does; since SM-10 Home shows it as
 * a compact row (`homeTodo`: a word or two and one line of numbers, no
 * captions), three at most (`homeTodos`). The rows keep the server's order
 * (most urgent first), each thing once; nobody is shown by id. Pure and
 * dependency-free (contract types and the engine), so it is unit-testable.
 */

import type { InboxDish, InboxItem, InboxResponse, KitchenTxnKind } from "@saas/contracts/kitchen";
import { dimensionOf, formatQuantity, isUnit, type Dimension } from "@saas/kitchen-engine/units";
import { formatMinor } from "./money";
import { memberLabel, memberLabelInline, type MemberNames } from "./members";
import { TXN_KIND_META } from "./activity";
import { dishHref, halfText } from "./dish";
import { cookHref } from "./dish-maker";
import { amountPresets, defaultPreset } from "./quick-use";
import { itemHref, itemRefOf, parseItemRef, type ItemRef } from "./pantry";
import { agoText, calendarDayText, dayText } from "./when";

export type InboxCardKind = InboxItem["kind"];

/** The card's mark: tomato for food past its date and dishes, amber for food due soon, blue for money, neutral for a flag. */
export type InboxTone = "expired" | "soon" | "dish" | "money" | "flag";

export type InboxAction =
  /** The claim buttons (they read the dish for what a claim costs). */
  | { kind: "claim"; dishId: string; orgId: string }
  /** Finalize here, after a preview of who owes what. */
  | { kind: "finalize"; dishId: string; groupName: string | null }
  /** Set everyone's portions on the dish page (an assigned dish). */
  | { kind: "split"; href: string; label: string }
  /** One-tap use of `qtyMilli` for just you, and Cook with it. */
  | {
      kind: "use";
      ref: ItemRef;
      qtyMilli: number;
      /** "I had a glass", "I used 2 pcs". */
      label: string;
      /** For the toast: "1 glass". */
      words: string;
      /** It is your usual amount. */
      usual: boolean;
      cookHref: string;
    }
  /** I paid: record the plan's payment (when `canRecord`). */
  | {
      kind: "pay";
      orgId: string;
      toSubjectId: string;
      /** Who it goes to, inside a sentence: "Dev", "Member · 3f9a". */
      toLabel: string;
      amountMinor: number;
      currency: string;
      canRecord: boolean;
      groupName: string;
    }
  /** Open the flagged entry. */
  | { kind: "open"; href: string; label: string };

export interface InboxCard {
  /** Unique and stable: the kind and the thing's id. */
  key: string;
  kind: InboxCardKind;
  tone: InboxTone;
  /** "Meera made Egg fried rice", "Milk", "You owe Dev ₹45.75". */
  title: string;
  /** One line under it: where, how much, when. */
  meta: string;
  /** A third line: what the flag says, in quotes. */
  note: string | null;
  /** Where the title goes: the dish, the item, Settle up, the entry. */
  href: string;
  action: InboxAction;
}

export interface InboxView {
  cards: InboxCard[];
  /** "Needs you · 3 to do"; just "Needs you" when nothing does. */
  heading: string;
  /** Nothing needs you: show All clear. */
  empty: boolean;
}

export interface InboxContext {
  meId: string | null;
  names?: MemberNames | null;
  now: Date;
}

/** "Needs you · 3 to do". */
export function inboxHeading(count: number): string {
  return count > 0 ? `Needs you · ${count} to do` : "Needs you";
}

/** The one-tap use's button: "I had a glass", "I had ½ cup", "I used 2 pcs". */
export function useButtonLabel(words: string, dimension: Dimension): string {
  const said = words.replace(/^1 (glass|cup)\b/, "a $1");
  return dimension === "count" || dimension === "pack" ? `I used ${said}` : `I had ${said}`;
}

/** "use by today", "use by 4 Nov", "expired yesterday". */
export function useByText(item: { expiresOn: string; daysToUseBy: number }): string {
  const day = calendarDayText(item.expiresOn, item.daysToUseBy);
  return item.daysToUseBy < 0 ? `expired ${day}` : `use by ${day}`;
}

/** "Flat 4B", or "Just for you" for a dish in no group. */
function dishWhere(dish: Pick<InboxDish, "orgId" | "groupName">): string {
  return dish.orgId ? (dish.groupName ?? "another group") : "Just for you";
}

/** "1½ portions" — with "portion" for up to one. */
function portionsWord(half: number): string {
  return half > 0 && half <= 2 ? "portion" : "portions";
}

function cookName(dish: Pick<InboxDish, "cook" | "cookName">, ctx: InboxContext): string {
  return dish.cookName ?? memberLabel(dish.cook, ctx.meId, ctx.names);
}

function claimCard(dish: InboxDish, ctx: InboxContext): InboxCard {
  const left = `${halfText(dish.unclaimedHalf)} of ${halfText(dish.portionsHalf)} ${portionsWord(dish.portionsHalf)} left`;
  return {
    key: `claim_dish:${dish.id}`,
    kind: "claim_dish",
    tone: "dish",
    title: `${cookName(dish, ctx)} made ${dish.name}`,
    meta: [dishWhere(dish), left, `${formatMinor(dish.perPortionMinor, dish.currency)} a portion`, `cooked ${dayText(dish.cookedAt, ctx.now)}`]
      .filter(Boolean)
      .join(" · "),
    note: null,
    href: dishHref(dish.id),
    action: { kind: "claim", dishId: dish.id, orgId: dish.orgId ?? "" },
  };
}

function finalizeCard(dish: InboxDish, ctx: InboxContext): InboxCard {
  const cooked = `cooked ${dayText(dish.cookedAt, ctx.now)}`;
  const total = formatMinor(dish.totalMinor, dish.currency);
  // An assigned dish in a group waits for its cook to say who had how much: that is the dish page's.
  if (dish.orgId && dish.state === "draft") {
    return {
      key: `finalize_dish:${dish.id}`,
      kind: "finalize_dish",
      tone: "dish",
      title: `Split your ${dish.name}`,
      meta: [dishWhere(dish), "say who had how much", total, cooked].join(" · "),
      note: null,
      href: dishHref(dish.id),
      action: { kind: "split", href: dishHref(dish.id), label: "Set portions" },
    };
  }
  const claimed = dish.orgId
    ? `${halfText(dish.claimedHalf)} of ${halfText(dish.portionsHalf)} ${portionsWord(dish.portionsHalf)} claimed`
    : null;
  return {
    key: `finalize_dish:${dish.id}`,
    kind: "finalize_dish",
    tone: "dish",
    title: `Finalize your ${dish.name}`,
    meta: [dishWhere(dish), claimed, total, cooked].filter(Boolean).join(" · "),
    note: null,
    href: dishHref(dish.id),
    action: { kind: "finalize", dishId: dish.id, groupName: dish.orgId ? dish.groupName : null },
  };
}

function useSoonCard(entry: Extract<InboxItem, { kind: "use_soon" }>): InboxCard | null {
  const { item, usual } = entry;
  if (!isUnit(item.unit)) return null;
  const dimension = dimensionOf(item.unit);
  const ref: ItemRef = parseItemRef(item.ref) ?? itemRefOf({ id: item.id, pantry: item.pantry });
  const preset = defaultPreset(amountPresets({ dimension, qtyLeftMilli: item.qtyLeftMilli }, usual?.qtyMilli ?? null));
  const where = item.pantry.kind === "personal" ? "Personal" : item.pantry.name;
  const left = `${formatQuantity(item.qtyLeftMilli, dimension, item.unit)} left`;
  return {
    key: `use_soon:${item.id}`,
    kind: "use_soon",
    tone: item.daysToUseBy < 0 ? "expired" : "soon",
    title: item.name,
    meta: [where, left, useByText(item)].join(" · "),
    note: null,
    href: itemHref(ref),
    action: preset
      ? {
          kind: "use",
          ref,
          qtyMilli: preset.qtyMilli,
          label: useButtonLabel(preset.words, dimension),
          words: preset.words,
          usual: preset.usual,
          cookHref: cookHref(ref),
        }
      : { kind: "open", href: itemHref(ref), label: "Open it" },
  };
}

function paymentCard(entry: Extract<InboxItem, { kind: "payment_due" }>, ctx: InboxContext): InboxCard {
  const to = entry.toName ?? memberLabelInline(entry.toSubjectId, ctx.meId, ctx.names);
  return {
    key: `payment_due:${entry.orgId}:${entry.toSubjectId}`,
    kind: "payment_due",
    tone: "money",
    title: `You owe ${to} ${formatMinor(entry.amountMinor, entry.currency)}`,
    meta: entry.groupName,
    note: null,
    // People, filtered to the group: where settling up lives since SM-11 (`/settle` only redirects there).
    href: `/people?group=${encodeURIComponent(entry.groupSlug)}`,
    action: {
      kind: "pay",
      orgId: entry.orgId,
      toSubjectId: entry.toSubjectId,
      toLabel: to,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      canRecord: entry.canRecord,
      groupName: entry.groupName,
    },
  };
}

/** The flagged entry: a dish's charge opens the dish (it is corrected there); anything else, the entry in its group's activity. */
export function flaggedEntryHref(entry: { dishId: string | null; groupSlug: string; txnId: string }): string {
  return entry.dishId ? dishHref(entry.dishId) : `/groups/${encodeURIComponent(entry.groupSlug)}?txn=${encodeURIComponent(entry.txnId)}`;
}

function kindLabel(kind: KitchenTxnKind): string {
  return TXN_KIND_META[kind]?.label ?? "Entry";
}

function flagCard(entry: Extract<InboxItem, { kind: "flag" }>, ctx: InboxContext): InboxCard {
  const who = entry.flaggedByName ?? memberLabel(entry.flaggedBy, ctx.meId, ctx.names);
  const href = flaggedEntryHref(entry);
  return {
    key: `flag:${entry.flagId}`,
    kind: "flag",
    tone: "flag",
    title: `${who} flagged “${entry.title}”`,
    meta: [entry.groupName, kindLabel(entry.txnKind), formatMinor(entry.totalMinor, entry.currency), agoText(entry.flaggedAt, ctx.now)].join(" · "),
    note: entry.reason.trim() ? `“${entry.reason.trim()}”` : null,
    href,
    action: { kind: "open", href, label: entry.dishId ? "Open the dish" : "See the entry" },
  };
}

/** One card for one inbox item; null for a kind this app does not know (a newer server). */
export function inboxCard(item: InboxItem, ctx: InboxContext): InboxCard | null {
  switch (item.kind) {
    case "claim_dish":
      return claimCard(item.dish, ctx);
    case "finalize_dish":
      return finalizeCard(item.dish, ctx);
    case "use_soon":
      return useSoonCard(item);
    case "payment_due":
      return paymentCard(item, ctx);
    case "flag":
      return flagCard(item, ctx);
    default:
      return null;
  }
}

/** Every card, in the server's order (most urgent first), each once. */
export function inboxView(res: Pick<InboxResponse, "items">, ctx: InboxContext): InboxView {
  const seen = new Set<string>();
  const cards: InboxCard[] = [];
  for (const item of res.items) {
    const card = inboxCard(item, ctx);
    if (!card || seen.has(card.key)) continue;
    seen.add(card.key);
    cards.push(card);
  }
  return { cards, heading: inboxHeading(cards.length), empty: cards.length === 0 };
}

// ── Home's to-do list (SM-10) ─────────────────────────────────────

/** How many to-dos Home shows before "See all". */
export const HOME_TODOS = 3;

/** The colour of a to-do's second line: grey, or what it warns of. */
export type TodoSubTone = "muted" | "expired" | "soon" | "owe";

/**
 * One to-do as a single compact row (SM-10, the canvas's "To do"): what it is
 * in a word or two ("Egg fried rice", "Greek yogurt", "Pay Dev"), one short
 * line of numbers under it ("Meera · ₹31.20 each", "Expired", "2 of 4 had",
 * "$25.00"), and the card's one action. No captions: the action says it.
 */
export interface HomeTodo {
  key: string;
  kind: InboxCardKind;
  tone: InboxTone;
  title: string;
  sub: string;
  subTone: TodoSubTone;
  /** Where the row's title goes (the card's). */
  href: string;
  action: InboxAction;
  /** A payment shows the face of who you pay; everything else an icon. */
  faceId: string | null;
}

/** "Expired", "Today", "Tomorrow", "3 days" — when food is due, in a word or two. */
export function dueWord(daysToUseBy: number): string {
  if (daysToUseBy < 0) return "Expired";
  if (daysToUseBy === 0) return "Today";
  if (daysToUseBy === 1) return "Tomorrow";
  return `${daysToUseBy} days`;
}

/** One inbox item as Home's compact row; null for a kind this app does not know. */
export function homeTodo(item: InboxItem, ctx: InboxContext): HomeTodo | null {
  const card = inboxCard(item, ctx);
  if (!card) return null;
  const row = { key: card.key, kind: card.kind, tone: card.tone, href: card.href, action: card.action, faceId: null };
  switch (item.kind) {
    case "claim_dish": {
      const d = item.dish;
      return { ...row, title: d.name, sub: `${cookName(d, ctx)} · ${formatMinor(d.perPortionMinor, d.currency)} each`, subTone: "muted" };
    }
    case "finalize_dish": {
      const d = item.dish;
      const sub = d.orgId ? `${halfText(d.claimedHalf)} of ${halfText(d.portionsHalf)} had` : "Just for you";
      return { ...row, title: d.name, sub, subTone: "muted" };
    }
    case "use_soon": {
      const days = item.item.daysToUseBy;
      return { ...row, title: item.item.name, sub: dueWord(days), subTone: days < 0 ? "expired" : "soon" };
    }
    case "payment_due": {
      const to = item.toName ?? memberLabel(item.toSubjectId, ctx.meId, ctx.names);
      return { ...row, title: `Pay ${to}`, sub: formatMinor(item.amountMinor, item.currency), subTone: "owe", faceId: item.toSubjectId };
    }
    case "flag": {
      const who = item.flaggedByName ?? memberLabel(item.flaggedBy, ctx.meId, ctx.names);
      return { ...row, title: `${who} flagged ${item.title}`, sub: card.note ?? formatMinor(item.totalMinor, item.currency), subTone: "muted" };
    }
    default:
      return null;
  }
}

export interface HomeTodos {
  /** The first `limit` to-dos (all of them with `all`), in the server's order (most urgent first), each once. */
  rows: HomeTodo[];
  /** How many there are in all. */
  total: number;
  /** How many "See all" adds. */
  more: number;
}

/** Home's to-dos: at most `limit` (three), each thing once, and how many more "See all" shows. */
export function homeTodos(res: Pick<InboxResponse, "items">, ctx: InboxContext, opts: { limit?: number; all?: boolean } = {}): HomeTodos {
  const limit = opts.limit ?? HOME_TODOS;
  const seen = new Set<string>();
  const all: HomeTodo[] = [];
  for (const item of res.items) {
    const row = homeTodo(item, ctx);
    if (!row || seen.has(row.key)) continue;
    seen.add(row.key);
    all.push(row);
  }
  const rows = opts.all ? all : all.slice(0, limit);
  return { rows, total: all.length, more: all.length - rows.length };
}
