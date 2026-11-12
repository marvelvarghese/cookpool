/**
 * Swiping between the tabs (cookpool-revamp RV-9, RV-12). No React, so every
 * rule is unit-tested: where the swipe is on, which tab is next, the numbers,
 * the spring, the tab bar's finger, and the touches it never takes.
 * Following the finger is lib/gestures.ts's (`listenForDrags`, `createDrag`);
 * the frame's part is gestures-ui.tsx's `TabSwipe` (the page and the
 * neighbour's preview, tab-preview.ts) and tab-bar.tsx's sliding highlight.
 *
 * On the five tabs' roots only (Home · Pantry · Cook · Money · You, in
 * `nav.ts`'s order), in the new frame, on a phone: a deliberate sideways
 * swipe on the page drags it with the finger, one to one, with the tab beside
 * it coming in alongside (RV-12, like a native pager); let go past 35% of the
 * width, or flick, and that tab opens. Past either end the page only
 * rubber-bands.
 */

import { DECIDE_PX, FLICK_MIN_PX, FLICK_PX_PER_MS, hasOwnDrags, scrollersBetween, type Claims, type DragPoint, type ElementLike, type StyleOf } from "@/lib/gestures";
import { WIDE_MIN_PX, normalizePath, type TabSwipeDirection } from "@/lib/transitions";
import { NEW_FRAME_TABS } from "./nav";

// ── The numbers ───────────────────────────────────────────────────

/** A swipe goes to the tab beside once the page has moved this share of the width (RV-12; RV-9's was 64 px)… */
export const TAB_SWIPE_FRACTION = 0.35;
/** …or on a flick: this fast (px/ms) toward it, after FLICK_MIN_PX (PW-7's flick). */
export const TAB_SWIPE_FLICK_PX_PER_MS = FLICK_PX_PER_MS;
/** …and only when it is this much more sideways than up or down (|dx| > 1.6 × |dy|). */
export const TAB_SWIPE_RATIO = 1.6;
/** It never starts this close to either side of the screen (px): iOS's back swipe is there. */
export const TAB_SWIPE_EDGE_PX = 24;
/** Past the first and last tabs the page rubber-bands: iOS's constant (offset = (1 − 1 / (|dx| × c / w + 1)) × w). */
export const TAB_SWIPE_RUBBER = 0.55;
/**
 * The settle is a critically damped spring of this natural frequency (per ms):
 * from rest, a full width (390 px) is within half a pixel in about 300 ms.
 */
export const TAB_SPRING_OMEGA = 0.028;
/** The spring is done once within this many px of where it goes, and slower than TAB_SPRING_REST_V px/ms. */
export const TAB_SPRING_REST_PX = 0.5;
export const TAB_SPRING_REST_V = 0.05;
/** …and never runs longer than this (ms). */
export const TAB_SPRING_MAX_MS = 450;

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
 * vertical scrolling stays the browser's; then sideways enough, on a tab's
 * root. Toward an end with no tab there it is still taken (RV-12): the page
 * rubber-bands and springs back.
 */
export function tabSwipeClaims(pathname: string, dx: number, dy: number): boolean {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return false;
  return isSideways(dx, dy) && TAB_SWIPE_ORDER.includes(normalizePath(pathname));
}

/** Rubber-band resistance: how far the page moves for a finger `dx` px toward an end, on a screen `width` wide. */
export function rubberBand(dx: number, width: number): number {
  if (!(width > 0) || dx === 0) return 0;
  const d = Math.abs(dx);
  return Math.sign(dx) * (1 - 1 / ((d * TAB_SWIPE_RUBBER) / width + 1)) * width;
}

/**
 * Where the page is for a finger `dx` px sideways (RV-12): with it, one to
 * one, toward a tab that is there (never past a full width); toward an end,
 * rubber-banded.
 */
export function tabSwipeOffset(pathname: string, dx: number, width: number): number {
  if (dx === 0) return 0;
  if (tabSwipeTarget(pathname, dx) === null) return rubberBand(dx, width);
  return Math.max(-width, Math.min(width, dx));
}

/**
 * Where letting go goes (RV-12): the page at `dx` px, the finger moving at
 * `vx` px/ms, on a screen `width` wide. A flick toward the tab beside (at
 * least TAB_SWIPE_FLICK_PX_PER_MS, after FLICK_MIN_PX) opens it; a flick
 * back cancels, however far; else past TAB_SWIPE_FRACTION of the width
 * opens it. Nowhere (it springs back) toward an end, or short.
 */
export function tabSwipeRelease(
  pathname: string,
  dx: number,
  vx: number,
  width: number,
): { href: string; direction: TabSwipeDirection } | null {
  const direction = tabSwipeDirection(dx);
  const href = direction ? neighbourTab(pathname, direction) : null;
  if (!href || !direction) return null;
  const distance = Math.abs(dx);
  // The speed toward the tab beside: a swipe left (next) goes toward negative x.
  const toward = direction === "next" ? -vx : vx;
  if (toward <= -TAB_SWIPE_FLICK_PX_PER_MS) return null;
  const flick = distance >= FLICK_MIN_PX && toward >= TAB_SWIPE_FLICK_PX_PER_MS;
  return flick || distance >= width * TAB_SWIPE_FRACTION ? { href, direction } : null;
}

// ── The spring ────────────────────────────────────────────────────

/**
 * A critically damped spring (no bounce), in closed form: `d0` px from where
 * it goes, moving at `v0` px/ms, after `t` ms. d(t) = (d0 + (v0 + ω·d0)·t)·e^(−ωt).
 */
export function springAt(d0: number, v0: number, t: number, omega: number = TAB_SPRING_OMEGA): { d: number; v: number } {
  const e = Math.exp(-omega * t);
  const b = v0 + omega * d0;
  return { d: (d0 + b * t) * e, v: (v0 - omega * b * t) * e };
}

/**
 * The spring's next frame, `t` ms in: where it is and whether it is done —
 * at rest (TAB_SPRING_REST_PX, TAB_SPRING_REST_V), past TAB_SPRING_MAX_MS, or
 * about to pass where it goes (a fast flick never overshoots: the page would
 * show the gap beyond the tab).
 */
export function springFrame(d0: number, v0: number, t: number, omega: number = TAB_SPRING_OMEGA): { d: number; done: boolean } {
  const { d, v } = springAt(d0, v0, t, omega);
  const passed = d0 !== 0 && Math.sign(d) !== Math.sign(d0);
  if (passed || t >= TAB_SPRING_MAX_MS || (Math.abs(d) < TAB_SPRING_REST_PX && Math.abs(v) < TAB_SPRING_REST_V)) return { d: 0, done: true };
  return { d, done: false };
}

// ── The tab bar's finger ──────────────────────────────────────────

/**
 * Which of the bar's `count` tabs is under a finger at `x` (RV-12): the bar
 * spans `left`…`left + width` with `pad` px inside each end, the tabs in
 * equal cells; beyond either end it is the end's tab.
 */
export function barTabAt(x: number, bar: { left: number; width: number }, count: number, pad = 0): number {
  if (!(count > 0)) return -1;
  const inner = bar.width - 2 * pad;
  if (!(inner > 0)) return 0;
  const at = Math.floor(((x - bar.left - pad) / inner) * count);
  return Math.max(0, Math.min(count - 1, at));
}

/** Which way the page moves for a step from tab `from` to tab `to` (the bar's slide). */
export function barDirection(from: number, to: number): TabSwipeDirection | null {
  if (from < 0 || to === from) return null;
  return to > from ? "next" : "prev";
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
