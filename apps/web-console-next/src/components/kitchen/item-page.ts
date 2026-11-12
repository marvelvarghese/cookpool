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

import type { KitchenItem, KitchenMeasure, KitchenStockMove, PurchaseLine } from "@saas/contracts/kitchen";
import { fromMilli, isUnit } from "@saas/kitchen-engine/units";
import { leftInMeasure } from "./measures";
import { boughtText, itemRefParam, leftPercent, leftText, pantryChipLabel, type ItemRef } from "./pantry";
import type { SetUsual } from "./pantry-set";
import { LEVEL_COLORS, itemStatus, levelTone, type LevelTone } from "./pantry-list";
import { addDays, shortMoney } from "./from-before";
import { costPerText } from "./item-use";
import { amountUnits, amountView, pickQty, type AmountPick, type PickItem } from "./amount-picker";
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

// ── The revamped page (cookpool-revamp RV-15, the canvas's RvItem) ──

/**
 * The line under the name: "Flat 4B · Meera paid ₹68" ("Me · You paid ₹68"
 * for your own), with the item's state after it once it is no longer in
 * the pantry ("Used up"); just where it is when it cost nothing.
 */
export function itemSubtitle(
  item: Pick<KitchenItem, "pantry" | "paidBy" | "priceMinor" | "currency">,
  ctx: { meId: string | null; names?: MemberNames | null; state?: string | null },
): string {
  const paid = item.priceMinor > 0 ? `${memberLabel(item.paidBy, ctx.meId, ctx.names)} paid ${shortMoney(item.priceMinor, item.currency)}` : null;
  return [pantryChipLabel(item.pantry), paid, ctx.state ?? null].filter(Boolean).join(" · ");
}

/** The ring card's two lines: "1 L of 2 L" and "₹34 left" (null when it cost nothing). */
export function ringLines(item: PageItem): { left: string; worth: string | null } {
  const counted = leftInMeasure(item);
  return {
    left: [`${leftText(item)} of ${boughtText(item)}`, counted].filter(Boolean).join(" · "),
    worth: item.priceMinor > 0 ? `${shortMoney(item.worthMinor, item.currency)} left` : null,
  };
}

export interface QuickPick {
  pick: AmountPick;
  /** "½ glass", "1 glass", "2 glasses", "The rest". */
  label: string;
  /** The suggestion itself (your usual): drawn on the accent. */
  usual: boolean;
}

/**
 * The use row's one-tap amounts (the board's "½ glass · 1 glass · 2
 * glasses"): half the suggestion, the suggestion (on the accent), and twice
 * it, in the suggestion's unit — each only on that unit's grid and under
 * what is left; twice it becomes The rest once it reaches what is left.
 * More opens the full picker for anything else.
 */
export function quickPicks(item: PickItem, start: AmountPick | null): QuickPick[] {
  if (!start || item.qtyLeftMilli <= 0) return [];
  const label = (pick: AmountPick) => (pick.rest ? "The rest" : amountView(item, pick, null, null).words);
  if (start.rest) return [{ pick: start, label: "The rest", usual: true }];
  const unit = amountUnits(item).find((u) => u.id === start.unit);
  if (!unit) return [{ pick: start, label: label(start), usual: true }];
  const onGrid = (n: number) => {
    if (n < unit.min) return false;
    if (unit.kind === "measure" && unit.min < 1) return Number.isInteger(Math.round(n * 2 * 1e6) / 1e6);
    return Number.isInteger(Math.round((n / unit.step) * 1e6) / 1e6);
  };
  const at = (count: number): AmountPick => ({ unit: start.unit, count, rest: false, how: "changed" });
  const out: QuickPick[] = [];
  const half = start.count / 2;
  if (onGrid(half) && pickQty(item, at(half)) < item.qtyLeftMilli) out.push({ pick: at(half), label: label(at(half)), usual: false });
  out.push({ pick: start, label: label(start), usual: true });
  const twice = at(start.count * 2);
  const rest: AmountPick = { unit: start.unit, count: 0, rest: true, how: "rest" };
  out.push(pickQty(item, twice) < item.qtyLeftMilli ? { pick: twice, label: label(twice), usual: false } : { pick: rest, label: "The rest", usual: false });
  return out;
}

/** Whose face starts a history row: who had it (the first named), else who did it; the purchase is whoever added it. */
export function historyFace(move: Pick<KitchenStockMove, "kind" | "actor" | "consumers"> | undefined, item: Pick<KitchenItem, "createdBy">): string {
  if (!move) return item.createdBy;
  if (move.kind === "use" && move.consumers && move.consumers.length > 0) return move.consumers[0]!;
  return move.actor;
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

/** Got more's toast (RV-15: no "Bought" in the words): "Got more Milk · ₹68". */
export function boughtAgainTitle(item: Pick<KitchenItem, "name" | "priceMinor" | "currency">): string {
  return `Got more ${item.name} · ${shortMoney(item.priceMinor, item.currency)}`;
}

/** Why Bought again was refused, in one line. */
export function buyAgainRefusal(
  error: { code?: string; reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined },
  item: Pick<KitchenItem, "pantry">,
): string {
  const where = item.pantry.kind === "group" ? item.pantry.name : "your kitchen";
  if (error.reason === "currency_mismatch") return `${where} counts in ${String(error.details?.["currency"] ?? "another currency")} now.`;
  const fields = error.details?.["fields"];
  if (error.code === "validation_failed" && fields && typeof fields === "object" && "lines[0].pantry" in fields) return `You can't add to ${where} any more.`;
  return error.message;
}
