/**
 * Spliteco's gesture rules (spliteco-calm SL1, design §2): the pager, the row
 * that reveals or fires, the hold, the sheet, the edge back and the slider.
 * Pure: pointer-like events in, decisions out, time from an injected clock.
 * Built on Cookpool's two modules copied beside this file (`gestures.ts`,
 * `row-gestures.ts`), whose numbers they reuse: decide after 8 px, a flick is
 * 0.5 px/ms over 24 px, fire past 40% of the width, settle in 200 ms.
 *
 * The React side is `components/gestures/`; it only forwards events here and
 * moves things with CSS transforms. Every gesture has a visible twin.
 */

import {
  DECIDE_PX,
  EDGE_FRACTION,
  EDGE_PX,
  FLICK_MIN_PX,
  FLICK_PX_PER_MS,
  SETTLE_EASE,
  SETTLE_MS,
  SHEET_CLOSE_PX,
  edgeSwipeGoesBack,
  hasOwnDrags,
  isFlick,
  sheetDragCloses,
  type Claims,
} from "./gestures";
import { CLICK_GUARD_MS, REAL_CLOCK, SWIPE, swipeSpeed, type GestureClock, type PointerLike } from "./row-gestures";

export { DECIDE_PX, EDGE_FRACTION, EDGE_PX, FLICK_MIN_PX, FLICK_PX_PER_MS, SETTLE_EASE, SETTLE_MS, SHEET_CLOSE_PX };
export { edgeSwipeGoesBack, isFlick, sheetDragCloses };

/** The transition every gesture settles with (reduced motion: none). */
export const SETTLE_TRANSITION = `transform ${SETTLE_MS}ms ${SETTLE_EASE}`;

// ── The pager: Home ↔ Groups ↔ Activity, Bills ↔ Balances, Itemized ──

export const PAGER = {
  /** Let go past this share of the width and the page beside opens (Cookpool's tab swipe, RV-12)… */
  fraction: 0.35,
  /** …or on a flick toward it (FLICK_PX_PER_MS after FLICK_MIN_PX). */
  flickSpeed: FLICK_PX_PER_MS,
  flickMinPx: FLICK_MIN_PX,
  /** A drag is the pager's when it is this much more sideways than up or down. */
  ratio: 1.6,
  /** Past the first and last pages the track rubber-bands (iOS's constant). */
  rubber: 0.55,
} as const;

/** Sideways enough to be a page swipe: |dx| over 1.6 × |dy|. */
export function isSideways(dx: number, dy: number): boolean {
  return dx !== 0 && Math.abs(dx) > PAGER.ratio * Math.abs(dy);
}

/** Rubber-band resistance: how far the track moves for a finger `dx` px past an end, `width` wide. */
export function rubberBand(dx: number, width: number): number {
  if (!(width > 0) || dx === 0) return 0;
  const d = Math.abs(dx);
  return Math.sign(dx) * (1 - 1 / ((d * PAGER.rubber) / width + 1)) * width;
}

/** The page a swipe `dx` asks for from `index`: left (negative) is the next. Null past either end. */
export function pagerNeighbour(index: number, count: number, dx: number): number | null {
  if (dx === 0) return null;
  const next = dx < 0 ? index + 1 : index - 1;
  return next >= 0 && next < count ? next : null;
}

/** Where the track sits for a finger `dx` px sideways (px, added to −index × width): one to one toward a page, rubber-banded past an end. */
export function pagerOffset(index: number, count: number, dx: number, width: number): number {
  if (dx === 0) return 0;
  if (pagerNeighbour(index, count, dx) === null) return rubberBand(dx, width);
  return Math.max(-width, Math.min(width, dx));
}

/** The fractional page the indicator (the tab pill, the dots) shows mid-drag: 1.5 is halfway from the second to the third. */
export function pagerPosition(index: number, count: number, dx: number, width: number): number {
  if (!(width > 0)) return index;
  const at = index - pagerOffset(index, count, dx, width) / width;
  return Math.max(0, Math.min(Math.max(0, count - 1), at));
}

/**
 * Where letting go goes: from `index` of `count`, the finger `dx` px sideways
 * moving at `vx` px/ms, `width` wide. A flick toward the page beside opens
 * it; a flick back stays, however far; else past PAGER.fraction of the width
 * opens it. Past either end it stays.
 */
export function pagerRelease(input: { index: number; count: number; dx: number; vx: number; width: number }): number {
  const { index, count, dx, vx, width } = input;
  const next = pagerNeighbour(index, count, dx);
  if (next === null) return index;
  const distance = Math.abs(dx);
  const toward = dx < 0 ? -vx : vx;
  if (toward <= -PAGER.flickSpeed) return index;
  const flick = distance >= PAGER.flickMinPx && toward >= PAGER.flickSpeed;
  return flick || distance >= width * PAGER.fraction ? next : index;
}

/** A touch on these is never the pager's: what has its own drags, sliders, sheets, and anything marked `data-no-pager`. */
export const NO_PAGER = ['[data-no-pager]', 'input[type="range"]', '[role="slider"]', '[role="dialog"]'].join(", ");

/** What is a swipe row: there a drag to the left is the row's, to the right the pager's (design §2). */
export const SWIPE_ROW = "[data-swipe-row]";

function closestOf(target: unknown, selector: string): unknown {
  const el = target as { closest?(s: string): unknown } | null;
  return typeof el?.closest === "function" ? el.closest(selector) : null;
}

/**
 * Whether the pager takes a drag starting on `target`: null (leave it) on
 * what has its own drags or refuses; else sideways enough, once past
 * DECIDE_PX (nothing is cancelled before, so vertical scrolling stays the
 * browser's). On a swipe row only a drag to the right (or one on a row
 * already open, which the row closes itself) is the pager's.
 */
export function pagerRule(target: unknown): Claims | null {
  if (hasOwnDrags(target) || closestOf(target, NO_PAGER) != null) return null;
  const onRow = closestOf(target, SWIPE_ROW) != null;
  return (dx, dy) => {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < DECIDE_PX) return false;
    if (!isSideways(dx, dy)) return false;
    return !onRow || dx > 0;
  };
}

/** Whose is a sideways drag on a row: the row's to the left (or when it is open), the pager's to the right. */
export function rowOrPager(dx: number, rowOpen: boolean): "row" | "pager" {
  return dx < 0 || rowOpen ? "row" : "pager";
}

// ── A row swiped left: reveal, or fire ────────────────────────────

export const ROW_SWIPE = {
  /** A short swipe leaves the action showing, this wide (px). */
  revealPx: 96,
  /** Let go past this far left (px) and the row stays open on its action. */
  openPx: 40,
  /** Past this share of the row's width, or on a flick, letting go fires the action (Cookpool's PW-8). */
  fireFraction: SWIPE.fireFraction,
  flickSpeed: SWIPE.flickSpeed,
  flickMinPx: SWIPE.flickMinPx,
} as const;

export type RowRelease = "fire" | "reveal" | "close";

/** Where the row sits: it starts at −revealPx when open, follows the finger left, never right of 0 or past its width. */
export function rowSwipeOffset(dx: number, width: number, open: boolean): number {
  const base = open ? -ROW_SWIPE.revealPx : 0;
  return Math.max(-Math.max(0, width), Math.min(0, base + dx));
}

/**
 * Letting go of a row at `dx` px (from where it touched, `open` if it started
 * open), moving at `speed` px/ms (negative to the left): past 40% of the
 * width or a flick left fires; past `openPx` it stays open on its action; a
 * flick right, or short, closes.
 */
export function rowSwipeRelease(input: { dx: number; width: number; speed: number; open: boolean }): RowRelease {
  const at = rowSwipeOffset(input.dx, input.width, input.open);
  if (input.width > 0 && at <= -input.width * ROW_SWIPE.fireFraction) return "fire";
  if (input.speed <= -ROW_SWIPE.flickSpeed && input.dx <= -ROW_SWIPE.flickMinPx) return "fire";
  if (input.speed >= FLICK_PX_PER_MS) return "close";
  return at <= -ROW_SWIPE.openPx ? "reveal" : "close";
}

// ── Hold ──────────────────────────────────────────────────────────

export const HOLD = {
  /** Held this long without moving: the actions sheet (design §2). */
  delayMs: 480,
  /** Moving further than this (px) is not a hold: a scroll or a swipe. */
  slopPx: 8,
} as const;

/** The finger moved too far for a hold. */
export function holdMoved(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > HOLD.slopPx;
}

/**
 * Press and hold. `down` starts the clock; held still HOLD.delayMs, `onHold`
 * runs; a move past HOLD.slopPx, `up` or `cancel` stops it. After a hold the
 * click the browser sends on release is swallowed (`consumeClick`), so the
 * row's link does not open as well. A mouse is left alone (it has the twin).
 */
export class HoldTracker {
  private pointerId = -1;
  private x0 = 0;
  private y0 = 0;
  private timer: unknown = null;
  private fired = false;
  private guardUntil = -Infinity;
  private readonly clock: GestureClock;

  constructor(private readonly opts: { onHold: () => void; clock?: GestureClock; mouse?: boolean }) {
    this.clock = opts.clock ?? REAL_CLOCK;
  }

  /** Waiting for the hold. */
  get pending(): boolean {
    return this.timer !== null;
  }

  /** The hold happened and the finger is still down. */
  get held(): boolean {
    return this.fired && this.pointerId !== -1;
  }

  down(e: PointerLike): void {
    this.stop();
    if ((e.pointerType === "mouse" && !this.opts.mouse) || (e.button ?? 0) !== 0) return;
    this.pointerId = e.pointerId;
    this.x0 = e.clientX;
    this.y0 = e.clientY;
    this.fired = false;
    this.guardUntil = -Infinity;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.fired = true;
      this.opts.onHold();
    }, HOLD.delayMs);
  }

  move(e: PointerLike): void {
    if (e.pointerId !== this.pointerId || this.timer === null) return;
    if (holdMoved(e.clientX - this.x0, e.clientY - this.y0)) this.stop();
  }

  up(e: PointerLike): void {
    if (e.pointerId !== this.pointerId) return;
    this.cancel();
  }

  cancel(): void {
    if (this.fired) this.guardUntil = this.clock.now() + CLICK_GUARD_MS;
    this.stop();
  }

  consumeClick(): boolean {
    if (this.held) return true;
    if (this.clock.now() > this.guardUntil) return false;
    this.guardUntil = -Infinity;
    return true;
  }

  private stop(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.pointerId = -1;
  }
}

// ── The row tracker: reveal or fire, or hold ──────────────────────

export interface SwipeRowHandlers {
  /** The row follows the finger: its offset (≤ 0) and what letting go now would do. */
  drag(offset: number, release: RowRelease): void;
  /** Let go: fire the action, stay open on it, or close. */
  release(result: RowRelease): void;
  /** Held still HOLD.delayMs (only when `canHold`). */
  hold(): void;
}

type RowPhase = "idle" | "pressing" | "swiping" | "held" | "not-ours";

/**
 * One row's swipe and hold (design §2). A touch is a press until it moves:
 * still for HOLD.delayMs it holds; past DECIDE_PX mostly left (or either way
 * on an open row) it is a swipe, which follows the finger and on release
 * fires, stays open or closes (`rowSwipeRelease`); any other way it is the
 * list's scroll or the pager's, and the row does nothing more. The click
 * after a swipe or a hold is swallowed. `shouldCapture` tells the caller when
 * to take pointer capture: only once the swipe is decided, so a tap on a
 * link inside the row still lands on the link.
 */
export class SwipeRowTracker {
  private phase: RowPhase = "idle";
  private pointerId = -1;
  private x0 = 0;
  private y0 = 0;
  private width = 0;
  private dx = 0;
  private startedOpen = false;
  private samples: { t: number; x: number }[] = [];
  private timer: unknown = null;
  private guardUntil = -Infinity;
  private readonly clock: GestureClock;

  constructor(
    private readonly opts: {
      canSwipe: () => boolean;
      canHold: () => boolean;
      /** Whether the row is open on its action now. */
      isOpen: () => boolean;
      handlers: SwipeRowHandlers;
      clock?: GestureClock;
    },
  ) {
    this.clock = opts.clock ?? REAL_CLOCK;
  }

  get state(): RowPhase {
    return this.phase;
  }

  /** A finger on the row, `width` px wide: whether the row tracks it. */
  down(e: PointerLike, width: number): boolean {
    if (this.phase === "pressing" || this.phase === "swiping") return false;
    this.reset();
    if (e.pointerType === "mouse" || (e.button ?? 0) !== 0) return false;
    const swipe = this.opts.canSwipe();
    const hold = this.opts.canHold();
    if (!swipe && !hold) return false;
    this.phase = "pressing";
    this.pointerId = e.pointerId;
    this.x0 = e.clientX;
    this.y0 = e.clientY;
    this.width = width;
    this.dx = 0;
    this.startedOpen = this.opts.isOpen();
    this.samples = [{ t: this.clock.now(), x: e.clientX }];
    this.guardUntil = -Infinity;
    if (hold) this.timer = this.clock.setTimeout(() => this.onHold(), HOLD.delayMs);
    return true;
  }

  /** Returns true on the move that decided the swipe: take pointer capture now. */
  move(e: PointerLike): boolean {
    if (e.pointerId !== this.pointerId) return false;
    const dx = e.clientX - this.x0;
    const dy = e.clientY - this.y0;
    let decided = false;
    if (this.phase === "pressing") {
      if (holdMoved(dx, dy)) this.clearTimer();
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return false;
      this.clearTimer();
      const sideways = Math.abs(dx) > Math.abs(dy);
      if (sideways && this.opts.canSwipe() && rowOrPager(dx, this.startedOpen) === "row") {
        this.phase = "swiping";
        decided = true;
      } else {
        this.phase = "not-ours";
        return false;
      }
    }
    if (this.phase !== "swiping") return false;
    this.dx = dx;
    this.samples.push({ t: this.clock.now(), x: e.clientX });
    if (this.samples.length > 12) this.samples.shift();
    this.opts.handlers.drag(rowSwipeOffset(dx, this.width, this.startedOpen), this.result());
    return decided;
  }

  up(e: PointerLike): void {
    if (e.pointerId !== this.pointerId) return;
    if (this.phase === "swiping") {
      this.dx = e.clientX - this.x0;
      this.samples.push({ t: this.clock.now(), x: e.clientX });
      const result = this.result();
      this.guard();
      this.reset();
      this.opts.handlers.release(result);
      return;
    }
    if (this.phase === "held") this.guard();
    this.reset();
  }

  /** The browser took the touch: a swipe goes back to where it started. */
  cancel(): void {
    const swiping = this.phase === "swiping";
    const open = this.startedOpen;
    if (this.phase === "held") this.guard();
    this.reset();
    if (swiping) this.opts.handlers.release(open ? "reveal" : "close");
  }

  /** The phone's own long-press menu: prevent it while pressing, swiping or held. */
  contextMenu(): boolean {
    if (this.phase === "pressing" && this.opts.canHold()) {
      this.onHold();
      return true;
    }
    return this.phase === "swiping" || this.phase === "held";
  }

  consumeClick(): boolean {
    if (this.phase === "held") return true;
    if (this.clock.now() > this.guardUntil) return false;
    this.guardUntil = -Infinity;
    return true;
  }

  private result(): RowRelease {
    return rowSwipeRelease({ dx: this.dx, width: this.width, speed: swipeSpeed(this.samples), open: this.startedOpen });
  }

  private onHold(): void {
    this.timer = null;
    if (this.phase !== "pressing") return;
    this.phase = "held";
    this.opts.handlers.hold();
  }

  private guard(): void {
    this.guardUntil = this.clock.now() + CLICK_GUARD_MS;
  }

  private clearTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private reset(): void {
    this.clearTimer();
    this.phase = "idle";
    this.pointerId = -1;
    this.samples = [];
  }
}

// ── Edge back ─────────────────────────────────────────────────────

export interface EdgeBackEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** Running as the installed app. */
  standalone: boolean;
}

export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * The edge swipe back runs only in the installed app on an iPhone or iPad
 * (Cookpool's PW-7): Safari in the browser has its own swipe back, and
 * Android its system back, which ours would fight.
 */
export function edgeBackDevice(env: EdgeBackEnv): boolean {
  return env.standalone && isIos(env.userAgent, env.maxTouchPoints);
}

// ── Slider (Settle) ───────────────────────────────────────────────

/** The knob records the payment once it has travelled this share of the track. */
export const SLIDER_FIRE_FRACTION = 0.85;

/** Where the knob sits for a finger `dx` px along a track with `max` px of travel. */
export function sliderPosition(dx: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(max, dx));
}

/** Whether letting go with the knob at `x` of `max` px fires (else it springs back). */
export function sliderFires(x: number, max: number): boolean {
  return max > 0 && x >= max * SLIDER_FIRE_FRACTION;
}

/** The slider's keyboard twin: Enter or Space on the focused knob fires it. */
export function sliderKeyFires(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}
