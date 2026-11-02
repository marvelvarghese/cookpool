/**
 * Home's inbox (Cookpool CP-23) as a view-model: one card per thing that
 * needs you, from `GET /v1/kitchen/me/inbox` (CP-19), each with the one
 * action that settles it where you are —
 *
 *   claim_dish     How much did you have? None · ½ · 1 · 1½ · 2 (CP-17's
 *                  claimer, Undo sets it back)
 *   finalize_dish  your dish: finalize it here with a preview of who owes
 *                  what (an open dish, or one just for you), or set
 *                  everyone's portions on its page (an assigned dish)
 *   use_soon       "I had a glass" — your usual amount (else the first
 *                  kitchen measure) for just you, in one tap with Undo —
 *                  or Cook with it
 *   payment_due    I paid (records it, with Undo), when you may record it
 *   flag           someone flagged an entry you logged: open it
 *
 * The cards keep the server's order (most urgent first). Every amount says
 * what it is ("₹52.75 a portion"); nobody is shown by id. Pure and
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
    meta: `${entry.groupName} · the fewest-payments plan`,
    note: null,
    href: `/settle?group=${encodeURIComponent(entry.groupSlug)}`,
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

/** The items the inbox already lists (Home's Use soon strip leaves them out). */
export function inboxItemIds(res: Pick<InboxResponse, "items"> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const i of res?.items ?? []) if (i.kind === "use_soon") out.add(i.item.id);
  return out;
}

/** What finalizing an open dish here will post, before it does: "Anu ₹52.75 · Dev ₹52.75". */
export interface FinalizePreview {
  /** Each eater but the cook, with what they will owe you. */
  lines: { subjectId: string; label: string; amountMinor: number }[];
  /** "Nobody else has had some yet." / "Just for you: nothing to split." */
  empty: string | null;
}

export function finalizePreview(
  dish: { orgId: string | null; cook: string; amounts: readonly { subjectId: string; owedMinor: number }[] },
  ctx: Pick<InboxContext, "meId" | "names">,
): FinalizePreview {
  if (!dish.orgId) return { lines: [], empty: "Just for you: nothing to split." };
  const lines = dish.amounts
    .filter((a) => a.subjectId !== dish.cook && a.owedMinor > 0)
    .map((a) => ({ subjectId: a.subjectId, label: memberLabel(a.subjectId, ctx.meId, ctx.names), amountMinor: a.owedMinor }));
  return { lines, empty: lines.length === 0 ? "Nobody else has had some yet, so you keep it all." : null };
}
