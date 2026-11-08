/**
 * Restocking in the app (cookpool-pantry PN-6, design §6.1–§6.2) as pure
 * view-models: the Pantry's **Finished this week** — "Bread · Finished Tue ·
 * Flat 4B", or "Went bad Tue" for something wasted — with **Bought again**,
 * which is PN-7's one-line purchase (`useBuyAgain`, item-page.ts's
 * `boughtAgainLine`) started from a restock line's `last` (`boughtAgainItem`);
 * the restock read patched while a purchase is on its way; a purchase's
 * Undo in words; and `/pantry/new?from=<itemRef>` — Bought again's Change —
 * whose prefill (`historyEntryOfItem`) feeds the add form's "Like last time"
 * fill. In today's frame none of this is used. Dependency-free (contracts,
 * the engine and the pure kitchen modules), so it is unit-testable.
 */

import type {
  ItemHistoryEntry,
  KitchenItem,
  PantryRef,
  ReachableItem,
  RestockLine,
  RestockResponse,
  UndoPurchaseResponse,
  WastePolicy,
} from "@saas/contracts/kitchen";
import { dimensionOf, fromMilli, isUnit, pricePerUnit } from "@saas/kitchen-engine/units";
import type { CachePatch } from "@/lib/optimistic";
import { addDays, quantityInput, shortMoney } from "./from-before";
import { matchesQuery, pantryChipLabel, pantryKey, parseItemRef, type ItemRef } from "./pantry";
import { capitalFirst, dayText, localDayOffset } from "./when";
import type { UndoResult } from "./undo";
import type { PantryShow } from "./pantry-list";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** One name in one pantry: how the restock read keys its lines. */
export function restockKey(line: { pantry: PantryRef; nameKey: string }): string {
  return `${pantryKey(line.pantry)}:${line.nameKey}`;
}

/** lower(trim(name)), as the server keys a name. */
export function nameKeyOf(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A moment in the last week, in the viewer's calendar: "today", "yesterday",
 * its weekday ("Tue") within six days, else its date ("28 Oct").
 */
export function weekdayText(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const offset = localDayOffset(at, now);
  if (offset === 0 || offset === -1) return dayText(iso, now);
  if (offset < -1 && offset >= -6) return WEEKDAYS[at.getDay()]!;
  return dayText(iso, now);
}

/** A calendar day (YYYY-MM-DD, a UTC day as the server counts it) from `today`: "today", "yesterday", "Wed" within six days, else "28 Oct". */
export function calendarWeekdayText(isoDay: string, today: string): string {
  const day = Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`);
  const from = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(day) || Number.isNaN(from)) return isoDay;
  const offset = Math.round((day - from) / DAY_MS);
  if (offset === 0) return "today";
  if (offset === -1) return "yesterday";
  if (offset < -1 && offset >= -6) return WEEKDAYS[new Date(day).getUTCDay()]!;
  return new Date(day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// ── Finished this week (design §6.1) ──────────────────────────────

/** The device's fold key for the section (beside the kinds' keys). */
export const FINISHED_FOLD = "finished";

/** "Finished Tue", "Went bad yesterday": how and when it finished. */
export function finishedWhen(line: Extract<RestockLine, { reason: "finished" }>, now: Date): string {
  const when = weekdayText(line.why.finishedAt, now);
  return capitalFirst(`${line.why.how === "wasted" ? "went bad" : "finished"} ${when}`.trim());
}

export interface FinishedRow {
  key: string;
  line: Extract<RestockLine, { reason: "finished" }>;
  name: string;
  /** "Finished Tue · Flat 4B" — under the name. */
  sub: string;
  /** "Bread · finished Tue · Flat 4B" — the row in one line (its name for a screen reader). */
  label: string;
  /** "₹45": last time's price, which Bought again pays. */
  price: string;
  /** Bought again shows only where the caller may add. */
  canAdd: boolean;
}

export function finishedRow(line: Extract<RestockLine, { reason: "finished" }>, now: Date): FinishedRow {
  const when = finishedWhen(line, now);
  const where = pantryChipLabel(line.pantry);
  return {
    key: restockKey(line),
    line,
    name: line.name,
    sub: `${when} · ${where}`,
    label: `${line.name} · ${when.charAt(0).toLowerCase()}${when.slice(1)} · ${where}`,
    price: shortMoney(line.last.priceMinor, line.last.currency),
    canAdd: line.canAdd,
  };
}

/**
 * The section's rows: every finished line on All, that pantry's on a
 * pantry's chip, none under Use soon or Running low (nothing finished is
 * either); narrowed by the search like the rows. Empty hides the section.
 */
export function finishedRows(
  restock: Pick<RestockResponse, "finished"> | null | undefined,
  ctx: { show: PantryShow; query?: string; now: Date },
): FinishedRow[] {
  if (!restock || ctx.show.kind === "soon" || ctx.show.kind === "low") return [];
  const show = ctx.show;
  return restock.finished
    .filter((l) => (show.kind === "pantry" ? pantryKey(l.pantry) === show.key : true))
    .filter((l) => matchesQuery(l, ctx.query ?? ""))
    .map((l) => finishedRow(l, ctx.now));
}

/** Open unless folded on this device; always open while searching. */
export function finishedOpen(folded: ReadonlySet<string>, searching: boolean): boolean {
  return searching || !folded.has(FINISHED_FOLD);
}

/** Fold or unfold Finished this week. Never mutates `folded`. */
export function toggleFinishedFold(folded: ReadonlySet<string>): Set<string> {
  const next = new Set(folded);
  if (next.has(FINISHED_FOLD)) next.delete(FINISHED_FOLD);
  else next.add(FINISHED_FOLD);
  return next;
}

// ── Bought again (design §6.2) ────────────────────────────────────

/** What Bought again buys like: a name in a pantry and its latest purchase (a restock line). */
export type BoughtAgainSource = Pick<RestockLine, "name" | "category" | "pantry" | "last">;

/** A quantity in thousandths as a purchase line sends it: a decimal in its unit, three places at most. */
export function purchaseQuantity(qtyMilli: number, unit: string): string {
  return isUnit(unit) ? quantityInput(fromMilli(qtyMilli, unit)) : quantityInput(qtyMilli / 1000);
}

/**
 * A restock line's latest purchase as the item Bought again buys like —
 * PN-7's `useBuyAgain` (buy-again-data.ts) starts from an item, so Finished
 * this week and the More… sheet hand it this one: the same id (the line's
 * `fromItemId`, and Change's `?from=`), name, kind, pantry, amount in its
 * unit, price and currency, as bought today with a use-by as many days on
 * as last time's (none when it had none), and its waste rule (the group's
 * when it follows the group). Nothing of it has been used.
 */
export function boughtAgainItem(source: BoughtAgainSource, ctx: { today: string; groupWastePolicy?: WastePolicy | null | undefined }): KitchenItem {
  const { last } = source;
  const group = source.pantry.kind === "group";
  const known = isUnit(last.unit);
  const qty = known ? fromMilli(last.quantityMilli, last.unit) : last.quantityMilli / 1000;
  const days = last.expiresAfterDays === null ? null : Math.max(0, last.expiresAfterDays);
  const at = `${ctx.today}T00:00:00.000Z`;
  return {
    id: last.itemId,
    pantry: source.pantry,
    name: source.name,
    category: source.category,
    dimension: known ? dimensionOf(last.unit) : "count",
    displayUnit: last.unit,
    qtyBought: qty,
    qtyLeft: qty,
    qtyBoughtMilli: last.quantityMilli,
    qtyLeftMilli: last.quantityMilli,
    priceMinor: last.priceMinor,
    currency: last.currency,
    unitPriceMinor: known ? pricePerUnit(last.priceMinor, last.quantityMilli, last.unit) : last.priceMinor,
    worthMinor: last.priceMinor,
    paidBy: last.paidBy,
    boughtOn: ctx.today,
    expiresOn: days === null ? null : addDays(ctx.today, days),
    daysToUseBy: days,
    wastePolicy: group ? (last.wastePolicy ?? ctx.groupWastePolicy ?? "split_equally") : null,
    wastePolicyOverride: group ? last.wastePolicy : null,
    state: "active",
    version: 1,
    createdBy: last.paidBy,
    createdAt: at,
    updatedAt: at,
  };
}

/** Days from buying to the use-by (UTC days, 0 or more), or null without one. */
function useByDays(item: Pick<KitchenItem, "boughtOn" | "expiresOn">): number | null {
  if (!item.expiresOn) return null;
  const days = Math.round((Date.parse(`${item.expiresOn.slice(0, 10)}T00:00:00Z`) - Date.parse(`${item.boughtOn.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

/** Why a purchase was refused, in one line. */
export function purchaseRefusal(
  error: { code?: string; reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined },
  where: string | null,
): string {
  if (error.reason === "currency_mismatch") return `${where ?? "That group"} counts in ${String(error.details?.["currency"] ?? "another currency")} now. Reload and try again.`;
  const fields = error.details?.["fields"];
  if (fields && typeof fields === "object") {
    const keys = Object.keys(fields as Record<string, unknown>);
    if (keys.some((k) => /^lines\[\d+\]\.pantry$/.test(k))) return where ? `You can't add to ${where} any more.` : "You can't add to one of those pantries any more.";
    for (const v of Object.values(fields as Record<string, unknown>)) if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }
  return error.message;
}

/**
 * What an Undo of a purchase came to: everything off the list ("Bread is off
 * the list.", "3 things are off the list."), or — when someone used some
 * since — that it stays ("Someone already used some · Milk stays in the
 * pantry", with what did go).
 */
export function undoPurchaseResult(res: Pick<UndoPurchaseResponse, "removed" | "kept">): UndoResult {
  const gone = res.removed.length;
  if (res.kept.length === 0) return { ok: true, description: gone === 1 ? `${res.removed[0]!.name} is off the list.` : `${gone} things are off the list.` };
  const kept = res.kept.map((i) => i.name);
  const stays = kept.length === 1 ? `${kept[0]} stays in the pantry` : `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]} stay in their pantries`;
  return { ok: false, kind: "warning", title: "Someone already used some", description: gone > 0 ? `${stays} · ${gone} taken off.` : `${stays}.` };
}

// ── The restock read, patched while a purchase is on its way ──────

/** Lines bought now leave every group of the restock read (a newer active item of the name is in the pantry). */
export function restockWithout(data: RestockResponse, keys: ReadonlySet<string>): RestockResponse {
  const keep = <T extends RestockLine>(lines: T[]) => lines.filter((l) => !keys.has(restockKey(l)));
  const finished = keep(data.finished);
  const runningLow = keep(data.runningLow);
  const usual = keep(data.usual);
  if (finished.length === data.finished.length && runningLow.length === data.runningLow.length && usual.length === data.usual.length) return data;
  return { finished, runningLow, usual };
}

/** The patch: the restock read without those names. */
export function restockBoughtPatch(keys: readonly string[]): CachePatch {
  const set = new Set(keys);
  return { prefix: ["kitchenPantry", "restock"], update: (d) => restockWithout(d as RestockResponse, set) };
}

/** The restock key of a pending or bought item (its name in its pantry). */
export function itemRestockKey(item: Pick<ReachableItem, "name" | "pantry">): string {
  return restockKey({ pantry: item.pantry, nameKey: nameKeyOf(item.name) });
}

// ── /pantry/new?from= (design §6.2's Change) ──────────────────────

/** `?from=me:itm_…`: the item to fill the add form from, or null. */
export function parseFromParam(raw: string | null | undefined): ItemRef | null {
  return parseItemRef(raw);
}

/** The item the add form fills from: `?from=`'s, in the new frame only (today's frame ignores it). */
export function addFormFrom(raw: string | null | undefined, isNewFrame: boolean): ItemRef | null {
  return isNewFrame ? parseFromParam(raw) : null;
}

/**
 * An item as a "From before" entry, so the add form fills from it the way
 * "Like last time" does (`historyFill`): its name, kind, amount in its unit,
 * price, pantry, waste rule and use-by gap. The payer is you — Change is you
 * buying it again — unless who you are isn't known yet.
 */
export function historyEntryOfItem(
  item: Pick<KitchenItem, "name" | "category" | "dimension" | "displayUnit" | "qtyBought" | "qtyBoughtMilli" | "priceMinor" | "currency" | "pantry" | "paidBy" | "wastePolicyOverride" | "boughtOn" | "expiresOn">,
  meId: string | null,
): ItemHistoryEntry {
  return {
    name: item.name,
    category: item.category,
    dimension: item.dimension,
    unit: item.displayUnit,
    quantity: isUnit(item.displayUnit) ? Number(quantityInput(fromMilli(item.qtyBoughtMilli, item.displayUnit))) : item.qtyBought,
    qtyMilli: item.qtyBoughtMilli,
    priceMinor: item.priceMinor,
    currency: item.currency,
    pantry: item.pantry.kind === "personal" ? { kind: "personal", orgId: null, name: item.pantry.name } : { kind: "group", orgId: item.pantry.orgId, name: item.pantry.name },
    paidBy: meId ?? item.paidBy,
    wastePolicy: item.wastePolicyOverride,
    useByDays: useByDays(item),
    times: 1,
    lastBoughtOn: item.boughtOn,
  };
}
