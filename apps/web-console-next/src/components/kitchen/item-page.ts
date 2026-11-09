/**
 * The new frame's item page (cookpool-pantry PN-7, design §5, the canvas's
 * ItemPage) as pure view-models: the **level ring** — what is left of what
 * was bought, and what that is worth — in the level colours (§2.3); the
 * amount to use is PN-11's `AmountPicker` (`amount-picker.ts`), from the
 * §2.2 suggestion; and **Bought again** — a one-line
 * shopping run like last time (`kitchen.buy`), its toast and its Change.
 * Who had it and "At this rate" are `item-use.ts`'s (`whoHadIt`,
 * `runOutEstimate`): they read the item's moves, as its history does.
 * Dependency-free (contracts, the engine and other pure kitchen modules), so
 * it is unit-testable.
 */

import type { KitchenItem, KitchenMeasure, PurchaseLine } from "@saas/contracts/kitchen";
import { fromMilli, isUnit } from "@saas/kitchen-engine/units";
import { leftInMeasure } from "./measures";
import { boughtText, itemRefParam, leftPercent, leftText, type ItemRef } from "./pantry";
import type { SetUsual } from "./pantry-set";
import { LEVEL_COLORS, itemStatus, levelTone, type LevelTone } from "./pantry-list";
import { addDays, shortMoney } from "./from-before";
import { costPerText } from "./item-use";
import { memberLabel, type MemberNames } from "./members";

/** What the item page reads of an item. */
export type PageItem = Pick<
  KitchenItem,
  | "dimension"
  | "qtyLeftMilli"
  | "qtyBoughtMilli"
  | "priceMinor"
  | "worthMinor"
  | "currency"
  | "displayUnit"
  | "daysToUseBy"
> & { measures?: readonly KitchenMeasure[] | undefined };

/** The usual fields the page reads (a `KitchenUsual`, PN-2's `now` included): the Pantry's set row's. */
export type PageUsual = SetUsual;

// ── The level ring ────────────────────────────────────────────────

export type RingTone = LevelTone;

/** The level colours (design §2.3): herb green, amber when running low or use soon, red once expired — the Pantry's bar's. */
export const RING_COLORS: Readonly<Record<RingTone, string>> = LEVEL_COLORS;

export interface LevelRing {
  /** How much is left, 0–100 (a sliver while anything is). */
  percent: number;
  /** The big number: "1 L". */
  left: string;
  /** Beside it: "of 2 L", "of 1 kg · ≈ 4 onions". */
  of: string;
  /** "₹34 left of ₹68"; null when it cost nothing. */
  worth: string | null;
  /** "₹3.40 per 100 ml · Meera paid": its price once, and who paid in a group. */
  detail: string;
  tone: RingTone;
  /** For a screen reader: "50% left: 1 L of 2 L". */
  label: string;
}

export function ringTone(
  item: Pick<KitchenItem, "qtyLeftMilli" | "qtyBoughtMilli" | "daysToUseBy">,
  usual?: PageUsual | null,
): RingTone {
  // The Pantry's level bar's rule (PN-5's `itemStatus`), for something left.
  return item.qtyLeftMilli > 0 ? levelTone(itemStatus(item, usual ?? null)) : "ok";
}

/** The ring: what is left of what was bought, and what that is worth, in the level's colour. */
export function levelRing(
  item: PageItem & Pick<KitchenItem, "paidBy" | "pantry">,
  ctx: { usual?: PageUsual | null; meId: string | null; names?: MemberNames | null },
): LevelRing {
  const percent = leftPercent(item);
  const left = leftText(item);
  const counted = leftInMeasure(item);
  const of = [`of ${boughtText(item)}`, counted].filter(Boolean).join(" · ");
  const worth = item.priceMinor > 0 ? `${shortMoney(item.worthMinor, item.currency)} left of ${shortMoney(item.priceMinor, item.currency)}` : null;
  const detail = [costPerText(item), item.pantry.kind === "group" ? `${memberLabel(item.paidBy, ctx.meId, ctx.names)} paid` : null].filter(Boolean).join(" · ");
  return { percent, left, of, worth, detail, tone: ringTone(item, ctx.usual), label: `${percent}% left: ${left} of ${boughtText(item)}` };
}

/** The ring's stroke for `percent` on a circle of radius `r`: "drawn gap", as an SVG `stroke-dasharray`. */
export function ringDash(percent: number, r: number): string {
  const c = 2 * Math.PI * r;
  const drawn = (c * Math.max(0, Math.min(100, percent))) / 100;
  return `${drawn.toFixed(1)} ${c.toFixed(1)}`;
}

// ── Where the page's actions go ───────────────────────────────────

/** The stock check (design §7): `/pantry/me:itm_…/check`. */
export function checkHref(ref: ItemRef): string {
  return `/pantry/${itemRefParam(ref)}/check`;
}

/** Bought again's Change: the add form, filled from this item (`?from=`, PN-6). */
export function buyLikeHref(ref: ItemRef): string {
  return `/pantry/new?from=${encodeURIComponent(itemRefParam(ref))}`;
}

/** Bought again needs a pantry you add to: your own, or a group where you are not a viewer. */
export function canBuyAgain(item: Pick<KitchenItem, "state">, canWrite: boolean): boolean {
  return canWrite && item.state !== "removed";
}

/** Fix how much is left: anyone who may use it, on an item still in the pantry or finished (a check can wake it). */
export function canCheck(item: Pick<KitchenItem, "state">, canWrite: boolean): boolean {
  return canWrite && item.state !== "removed";
}

// ── Bought again (design §6.2) ────────────────────────────────────

/**
 * The one line Bought again buys (a shopping run of one, `kitchen.buy`):
 * the same name, kind, amount, unit and price, in the same pantry, with a
 * use-by as far from today as it was from the day it was bought, and the
 * item as `fromItemId` (the server copies its waste rule into its own group).
 * Paid by you, today.
 */
export function boughtAgainLine(
  item: Pick<KitchenItem, "id" | "pantry" | "name" | "category" | "qtyBoughtMilli" | "displayUnit" | "priceMinor" | "currency" | "boughtOn" | "expiresOn">,
  today: string,
): PurchaseLine {
  // What was bought, in the unit it was bought in, by the engine (three decimals at most).
  const quantity = isUnit(item.displayUnit) ? String(Math.round(fromMilli(item.qtyBoughtMilli, item.displayUnit) * 1000) / 1000) : String(item.qtyBoughtMilli / 1000);
  const line: PurchaseLine = {
    pantry: item.pantry.kind === "personal" ? "personal" : item.pantry.orgId,
    name: item.name,
    category: item.category,
    quantity,
    unit: item.displayUnit,
    priceMinor: item.priceMinor,
    currency: item.currency,
    fromItemId: item.id,
  };
  if (item.expiresOn) {
    const days = Math.round((Date.parse(`${item.expiresOn}T00:00:00Z`) - Date.parse(`${item.boughtOn}T00:00:00Z`)) / 86_400_000);
    if (Number.isFinite(days)) line.expiresOn = addDays(today, Math.max(0, days));
  }
  return line;
}

/** Bought again's toast: "Bought Milk · ₹68". */
export function boughtAgainTitle(item: Pick<KitchenItem, "name" | "priceMinor" | "currency">): string {
  return `Bought ${item.name} · ${shortMoney(item.priceMinor, item.currency)}`;
}

/** Why Bought again was refused, in one line. */
export function buyAgainRefusal(
  error: { code?: string; reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined },
  item: Pick<KitchenItem, "pantry">,
): string {
  const where = item.pantry.kind === "group" ? item.pantry.name : "your pantry";
  if (error.reason === "currency_mismatch") return `${where} counts in ${String(error.details?.["currency"] ?? "another currency")} now.`;
  const fields = error.details?.["fields"];
  if (error.code === "validation_failed" && fields && typeof fields === "object" && "lines[0].pantry" in fields) return `You can't add to ${where} any more.`;
  return error.message;
}
