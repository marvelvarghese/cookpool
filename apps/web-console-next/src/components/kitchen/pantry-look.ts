/**
 * The revamped Pantry's words (cookpool-revamp RV-3, the canvas's
 * `RvPantry`), as data: the "Use soon" strip of three tiles, each its name
 * and one fact ("Expired", "Tomorrow", "Tue"); and each section's three rows
 * before "See all N".
 *
 * Dependency-free (contract types only), so it is unit-testable.
 */

import type { KitchenItem, KitchenUsual } from "@saas/contracts/kitchen";
import { useByDay, type ItemStatus, type PantryShow } from "./pantry-list";
import { SEE_ALL_AFTER } from "./new-home-look";

/** The strip holds this many. */
export const USE_SOON_TILES = 3;

export interface UseSoonTile {
  id: string;
  name: string;
  /** "Expired", "Today", "Tomorrow", "Tue". */
  fact: string;
  tone: "expired" | "soon";
  href: string;
}

const capital = (s: string) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s);

/**
 * "Use soon": on All with no search, up to three items past their date or
 * close to it — expired first, then the soonest — each opening its page.
 * Empty otherwise.
 */
export function useSoonTiles(
  rows: readonly { id: string; href: string; item: Pick<KitchenItem, "name" | "daysToUseBy" | "expiresOn" | "pantry">; status: ItemStatus; canUse: boolean }[],
  ctx: { show: PantryShow; query?: string },
): UseSoonTile[] {
  if (ctx.show.kind !== "all" || (ctx.query ?? "").trim() !== "") return [];
  return rows
    .filter((r) => r.canUse && (r.status.expired || r.status.soon))
    .sort((a, b) => Number(b.status.expired) - Number(a.status.expired) || (a.item.daysToUseBy ?? 0) - (b.item.daysToUseBy ?? 0) || a.item.name.localeCompare(b.item.name, "en", { sensitivity: "base" }))
    .slice(0, USE_SOON_TILES)
    .map((r) => ({
      id: r.id,
      name: r.item.name,
      fact: r.status.expired ? "Expired" : capital(useByDay(r.item)),
      tone: r.status.expired ? "expired" : "soon",
      href: r.href,
    }));
}

/**
 * A section's rows: the first three, unless it is opened to all, a search is
 * on, or the opened row (`?open=`) is further down.
 */
export function sectionRows<T extends { id: string }>(rows: readonly T[], ctx: { all: boolean; searching: boolean; openId: string | null }): { rows: T[]; more: boolean; label: string } {
  const more = rows.length > SEE_ALL_AFTER && !ctx.searching;
  const openFar = ctx.openId !== null && rows.findIndex((r) => r.id === ctx.openId) >= SEE_ALL_AFTER;
  const all = ctx.all || ctx.searching || openFar;
  return {
    rows: all ? [...rows] : rows.slice(0, SEE_ALL_AFTER),
    more,
    label: all ? "Show less" : `See all ${rows.length}`,
  };
}

/** Usual now holds at most this many (RV-10). */
export const USUAL_NOW_MAX = 6;

/**
 * "Usual now · Morning" (RV-10, the canvas's RvKitchen): the listed items you
 * may use whose food has a usual for this part of the day (PN-2's `now`),
 * most uses in it first, then most uses; at most USUAL_NOW_MAX. Empty while
 * searching or on a chip other than All, and without usuals.
 */
export function usualNowRows<T extends { id: string; canUse: boolean; pending: boolean }>(
  rows: readonly T[],
  usuals: readonly Pick<KitchenUsual, "itemId" | "now" | "usedCount">[] | null | undefined,
  ctx: { show: PantryShow; query?: string },
): T[] {
  if (ctx.show.kind !== "all" || (ctx.query ?? "").trim() !== "") return [];
  const byId = new Map(rows.filter((r) => r.canUse && !r.pending).map((r) => [r.id, r] as const));
  return (usuals ?? [])
    .filter((u) => u.now && u.now.count > 0 && byId.has(u.itemId))
    .sort((a, b) => (b.now?.count ?? 0) - (a.now?.count ?? 0) || b.usedCount - a.usedCount)
    .slice(0, USUAL_NOW_MAX)
    .map((u) => byId.get(u.itemId)!);
}
