/**
 * Swiping between the tabs (cookpool-revamp RV-9). No React, so every rule
 * is unit-tested: where the swipe is on, which tab is next, the numbers, and
 * the touches it never takes. Following the finger is lib/gestures.ts's
 * (`listenForDrags`, `createDrag`); the frame's part is gestures-ui.tsx's
 * `TabSwipe`; the slide is lib/transitions.ts's `swipe-next`/`swipe-prev`.
 *
 * On the five tabs' roots only (Home · Pantry · Cook · Money · You, in
 * `nav.ts`'s order), in the new frame, on a phone: a deliberate sideways
 * swipe on the page goes to the tab beside it — left to the next, right to
 * the previous — and nothing happens past either end.
 */

import { DECIDE_PX, hasOwnDrags, scrollersBetween, type Claims, type DragPoint, type ElementLike, type StyleOf } from "@/lib/gestures";
import { WIDE_MIN_PX, normalizePath, type TabSwipeDirection } from "@/lib/transitions";
import { NEW_FRAME_TABS } from "./nav";

// ── The numbers ───────────────────────────────────────────────────

/** A swipe goes to the next tab once the finger has moved this far sideways (px). */
export const TAB_SWIPE_PX = 64;
/** …and only when it is this much more sideways than up or down (|dx| > 1.6 × |dy|). */
export const TAB_SWIPE_RATIO = 1.6;
/** It never starts this close to either side of the screen (px): iOS's back swipe is there. */
export const TAB_SWIPE_EDGE_PX = 24;
/** While dragging, the page follows the finger at this share of its travel… */
export const TAB_SWIPE_RESISTANCE = 0.3;
/** …and no further than this (px). */
export const TAB_SWIPE_MAX_PX = 72;

/**
 * What never starts a tab swipe: what has drags of its own (text fields,
 * sliders, a swipe row), a sheet or dialog, the tabs and the cooking
 * session's bar, a tab strip, and anything marked `data-no-tab-swipe`.
 */
export const NO_TAB_SWIPE = [
  "[data-no-tab-swipe]",
  "[data-swipe-row]",
  'input[type="range"]',
  '[role="slider"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="tablist"]',
  "[data-vt-keep]",
].join(", ");

// ── Where, and to which tab ───────────────────────────────────────

/** The tabs' roots in order (`nav.ts`): `/home`, `/pantry`, `/cook`, `/money`, `/you`. */
export const TAB_SWIPE_ORDER: readonly string[] = NEW_FRAME_TABS.map((t) => t.href);

/** Whether the screen swipes between tabs: a tab's root (not a page under it), in the new frame, below 900 px. */
export function tabSwipeOn(pathname: string | null | undefined, ctx: { newFrame: boolean; width: number }): boolean {
  if (!pathname || !ctx.newFrame || !(ctx.width < WIDE_MIN_PX)) return false;
  return TAB_SWIPE_ORDER.includes(normalizePath(pathname));
}

/** Which tab a swipe `dx` px sideways asks for: left (negative) is the next, right the previous. */
export function tabSwipeDirection(dx: number): TabSwipeDirection | null {
  if (dx < 0) return "next";
  if (dx > 0) return "prev";
  return null;
}

/** The tab beside the one at `pathname`, that way; null past either end, or off the tabs. */
export function neighbourTab(pathname: string, direction: TabSwipeDirection): string | null {
  const at = TAB_SWIPE_ORDER.indexOf(normalizePath(pathname));
  if (at < 0) return null;
  const next = direction === "next" ? at + 1 : at - 1;
  return TAB_SWIPE_ORDER[next] ?? null;
}

/** Where a swipe `dx` px sideways from the tab at `pathname` goes, if anywhere. */
export function tabSwipeTarget(pathname: string, dx: number): string | null {
  const direction = tabSwipeDirection(dx);
  return direction ? neighbourTab(pathname, direction) : null;
}

// ── The finger ────────────────────────────────────────────────────

/** Sideways enough: |dx| over 1.6 × |dy|. */
export function isSideways(dx: number, dy: number): boolean {
  return dx !== 0 && Math.abs(dx) > TAB_SWIPE_RATIO * Math.abs(dy);
}

/**
 * Whether a drag `dx`, `dy` px from where it touched is a tab swipe, on the
 * tab at `pathname`. Undecided (false) until the finger has gone DECIDE_PX,
 * so no move is cancelled before the swipe is known to be sideways and
 * vertical scrolling stays the browser's; then sideways enough, toward a tab
 * that is there.
 */
export function tabSwipeClaims(pathname: string, dx: number, dy: number): boolean {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return false;
  return isSideways(dx, dy) && tabSwipeTarget(pathname, dx) !== null;
}

/** How far the page moves for a finger `dx` px sideways: a share of it, at most TAB_SWIPE_MAX_PX, and not toward an end. */
export function tabSwipeOffset(pathname: string, dx: number): number {
  if (tabSwipeTarget(pathname, dx) === null) return 0;
  return Math.sign(dx) * Math.min(TAB_SWIPE_MAX_PX, Math.abs(dx) * TAB_SWIPE_RESISTANCE);
}

/** Where letting go at `dx` px sideways goes: the tab beside, once past TAB_SWIPE_PX; else nowhere (it snaps back). */
export function tabSwipeRelease(pathname: string, dx: number): { href: string; direction: TabSwipeDirection } | null {
  if (!(Math.abs(dx) >= TAB_SWIPE_PX)) return null;
  const direction = tabSwipeDirection(dx);
  const href = direction ? neighbourTab(pathname, direction) : null;
  return href && direction ? { href, direction } : null;
}

/** Whether a touch on `target` must be left alone: its own drags, or one of NO_TAB_SWIPE. */
export function refusesTabSwipe(target: unknown): boolean {
  if (hasOwnDrags(target)) return true;
  const el = target as ElementLike | null;
  return typeof el?.closest === "function" && el.closest(NO_TAB_SWIPE) != null;
}

/**
 * A tab swipe, on `page` (the kitchen's `<main>`), for the tab at
 * `pathname`, `width` px wide: null (leave this touch alone) while a sheet
 * or dialog is open, within TAB_SWIPE_EDGE_PX of either side, on what has its
 * own drags or refuses (NO_TAB_SWIPE), or on anything that scrolls sideways
 * (Cook now's cards, a row of chips). Else the rule `createDrag` asks.
 */
export function tabSwipeRule(
  start: DragPoint,
  target: unknown,
  page: ElementLike,
  ctx: { pathname: string; width: number; sheetOpen: boolean },
  styleOf?: StyleOf,
): Claims | null {
  if (ctx.sheetOpen) return null;
  if (start.x < TAB_SWIPE_EDGE_PX || start.x > ctx.width - TAB_SWIPE_EDGE_PX) return null;
  if (refusesTabSwipe(target)) return null;
  if (scrollersBetween(target, page, "x", styleOf).length > 0) return null;
  return (dx, dy) => tabSwipeClaims(ctx.pathname, dx, dy);
}
