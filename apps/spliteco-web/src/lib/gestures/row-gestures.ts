/*
 * Copied from Cookpool (spliteco-calm SL1, design §0.4; risk SL-A tracks the
 * duplication): apps/web-console-next/src/lib/row-gestures.ts. Keep it in step with
 * the source; only imports may differ.
 */

/**
 * Gestures on rows and steppers (Cookpool PW-8, design §5): swipe a row left,
 * press and hold a row, hold − or + to repeat. Each has a visible twin (the
 * row's button, its ⋮ or Undo, opening the item, tapping), so a gesture only
 * makes something faster.
 *
 * The rules and the trackers are pure: pointer-like events in, decisions
 * out, time from an injected clock. The tests drive them with synthetic
 * events and a fake clock; the React side (`row-gestures-ui.tsx`) only
 * forwards pointer events and moves the row with a CSS transform. No gesture
 * or animation library.
 */

/** Time, injectable: `performance.now()` and the timers in the app, a fake in the tests. */
export interface GestureClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const REAL_CLOCK: GestureClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What the trackers read of a pointer event (a React `PointerEvent` has all of it). */
export interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  /** "touch", "pen", "mouse". */
  pointerType?: string;
  /** 0 for a touch, a pen tip or the main mouse button. */
  button?: number;
}

/** After a gesture, the click the browser sends on release is swallowed for this long (a swipe or a press is not a tap). */
export const CLICK_GUARD_MS = 400;

// ── Swipe a row left ──────────────────────────────────────────────

export const SWIPE = {
  /** How far the finger moves before it counts as a swipe, a scroll or a drag of someone else's. */
  slopPx: 10,
  /** Past this share of the row's width, letting go fires the row's action. */
  fireFraction: 0.4,
  /** …or a flick: this fast to the left (px per ms) at the end, */
  flickSpeed: 0.6,
  /** …having moved at least this far. */
  flickMinPx: 48,
  /** How far back the speed at release looks. */
  speedWindowMs: 100,
} as const;

export type SwipeIntent = "undecided" | "swipe" | "not-ours";

/**
 * Horizontal intent only (risk PW-D): a drag mostly to the left is the row's
 * swipe; mostly up or down is the list scrolling, as before; to the right
 * is not ours (the back swipe from the edge). Nothing is decided inside the
 * slop.
 */
export function swipeIntent(dx: number, dy: number, slop: number = SWIPE.slopPx): SwipeIntent {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "undecided";
  return dx < 0 && Math.abs(dx) > Math.abs(dy) ? "swipe" : "not-ours";
}

/** Where the row sits under the finger: it follows to the left, never to the right, never past its own width. */
export function swipeOffset(dx: number, width: number): number {
  return Math.max(-Math.max(0, width), Math.min(0, dx));
}

/** Letting go fires the action past ~40% of the row's width, or on a fast flick to the left; otherwise the row springs back. */
export function swipeFires(input: { dx: number; width: number; speed: number }): boolean {
  const { dx, width, speed } = input;
  if (width > 0 && dx <= -width * SWIPE.fireFraction) return true;
  return speed <= -SWIPE.flickSpeed && dx <= -SWIPE.flickMinPx;
}

/** Speed along x (px per ms, negative to the left) over the last `windowMs` of samples. */
export function swipeSpeed(samples: readonly { t: number; x: number }[], windowMs: number = SWIPE.speedWindowMs): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i]!;
    if (last.t - s.t > windowMs) break;
    first = s;
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}

// ── Press and hold a row ──────────────────────────────────────────

export const LONG_PRESS = {
  /** Held this long without moving opens the row's menu. */
  delayMs: 450,
  /** Moving further than this is not a press (a scroll, a swipe). */
  slopPx: 10,
} as const;

/** The finger moved too far for a press. */
export function pressMoved(dx: number, dy: number, slop: number = LONG_PRESS.slopPx): boolean {
  return Math.hypot(dx, dy) > slop;
}

// ── Hold − or + ───────────────────────────────────────────────────

export const HOLD_REPEAT = {
  /** Held this long, the step starts repeating… */
  delayMs: 400,
  /** …every this often… */
  everyMs: 150,
  /** …and once held this long… */
  fastAfterMs: 1000,
  /** …faster. */
  fastEveryMs: 60,
} as const;

/** How long until the next repeated step, given how long the button has been held (0: just pressed). */
export function nextRepeatIn(heldMs: number): number {
  if (heldMs < HOLD_REPEAT.delayMs) return HOLD_REPEAT.delayMs - heldMs;
  return heldMs < HOLD_REPEAT.fastAfterMs ? HOLD_REPEAT.everyMs : HOLD_REPEAT.fastEveryMs;
}

/** When a hold's steps land, in ms after the press, up to `untilMs`: 400, 550, 700, 850, 1000, 1060, 1120… */
export function repeatSchedule(untilMs: number): number[] {
  const out: number[] = [];
  let t = nextRepeatIn(0);
  while (t <= untilMs) {
    out.push(t);
    t += nextRepeatIn(t);
  }
  return out;
}

// ── The row tracker: a swipe or a press, one at a time ───────────

export interface RowGestureHandlers {
  /** The row follows the finger: its offset (≤ 0) and whether letting go now would fire. */
  drag(offset: number, armed: boolean): void;
  /** Let go after a swipe: fire the action, or spring back. The row goes back to 0 either way. */
  release(fired: boolean): void;
  /** Held still long enough: open the row's menu. */
  longPress(): void;
}

type RowPhase = "idle" | "pressing" | "swiping" | "held" | "not-ours";

/**
 * One row's gestures. A touch (or pen) on the row is a press until it moves:
 * held still for `LONG_PRESS.delayMs` it opens the menu; moved left past the
 * slop it is a swipe, which follows the finger and fires or springs back on
 * release; moved any other way it is the list's (a scroll) or someone
 * else's, and the row does nothing more until the next touch. A mouse has
 * the buttons, so it is left alone. After a swipe or a press, the click the
 * browser sends on release is swallowed (`consumeClick`), so the row's link
 * does not open as well.
 */
export class RowGestureTracker {
  private phase: RowPhase = "idle";
  private pointerId = -1;
  private startX = 0;
  private startY = 0;
  private width = 0;
  private dx = 0;
  /** Not moved past the press slop: still a press. */
  private still = true;
  private samples: { t: number; x: number }[] = [];
  private timer: unknown = null;
  private guardUntil = -Infinity;
  private readonly clock: GestureClock;

  constructor(
    private readonly opts: {
      /** The row has a swipe action now. */
      canSwipe: () => boolean;
      /** The row has a menu now. */
      canLongPress: () => boolean;
      handlers: RowGestureHandlers;
      clock?: GestureClock;
    },
  ) {
    this.clock = opts.clock ?? REAL_CLOCK;
  }

  /** Where it is: for the tests and the row's styles. */
  get state(): RowPhase {
    return this.phase;
  }

  /** A finger (or pen) on the row, `width` px wide. Returns whether the row tracks it. */
  down(e: PointerLike, width: number): boolean {
    // A second finger while one is pressing or swiping is ignored; a row left
    // to the list (a scroll) or to its menu starts again.
    if (this.phase === "pressing" || this.phase === "swiping") return false;
    this.reset();
    if (e.pointerType === "mouse" || (e.button ?? 0) !== 0) return false;
    const swipe = this.opts.canSwipe();
    const press = this.opts.canLongPress();
    if (!swipe && !press) return false;
    this.phase = "pressing";
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.width = width;
    this.dx = 0;
    this.still = true;
    this.samples = [{ t: this.clock.now(), x: e.clientX }];
    this.guardUntil = -Infinity;
    if (press) this.timer = this.clock.setTimeout(() => this.hold(), LONG_PRESS.delayMs);
    return true;
  }

  move(e: PointerLike): void {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (this.phase === "pressing") {
      if (pressMoved(dx, dy)) {
        this.still = false;
        this.clearTimer();
      }
      const intent = swipeIntent(dx, dy);
      if (intent === "undecided") return;
      this.clearTimer();
      if (intent === "swipe" && this.opts.canSwipe()) {
        this.phase = "swiping";
      } else {
        this.phase = "not-ours";
        return;
      }
    }
    if (this.phase !== "swiping") return;
    this.dx = dx;
    this.samples.push({ t: this.clock.now(), x: e.clientX });
    if (this.samples.length > 12) this.samples.shift();
    this.opts.handlers.drag(swipeOffset(dx, this.width), this.fires());
  }

  up(e: PointerLike): void {
    if (e.pointerId !== this.pointerId) return;
    if (this.phase === "swiping") {
      this.dx = e.clientX - this.startX;
      this.samples.push({ t: this.clock.now(), x: e.clientX });
      const fired = this.fires();
      this.guard();
      this.reset();
      this.opts.handlers.release(fired);
      return;
    }
    if (this.phase === "held") this.guard();
    this.reset();
  }

  /** The browser took the touch (a scroll began), or the row went away: a swipe springs back, nothing fires. */
  cancel(): void {
    const swiping = this.phase === "swiping";
    if (this.phase === "held") this.guard();
    this.reset();
    if (swiping) this.opts.handlers.release(false);
  }

  /**
   * The phone's own long-press (Android's context menu) arrived. Returns
   * whether to prevent it: a press on a row with a menu opens ours instead,
   * at once; during a swipe or after our press, nothing else may open.
   */
  contextMenu(): boolean {
    if (this.phase === "pressing" && this.opts.canLongPress()) {
      if (this.still) this.hold();
      return true;
    }
    return this.phase === "swiping" || this.phase === "held";
  }

  /** A click arrived: true when it is the release of a swipe or a press, which must not also open the row. */
  consumeClick(): boolean {
    if (this.phase === "held") return true;
    if (this.clock.now() > this.guardUntil) return false;
    this.guardUntil = -Infinity;
    return true;
  }

  private hold(): void {
    this.timer = null;
    if (this.phase !== "pressing" || !this.still) return;
    this.phase = "held";
    this.opts.handlers.longPress();
  }

  private fires(): boolean {
    return swipeFires({ dx: this.dx, width: this.width, speed: swipeSpeed(this.samples) });
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

// ── The stepper tracker: hold to repeat ───────────────────────────

/**
 * Hold − or + to repeat (design §5). A tap is the button's own click, as
 * before. Held `HOLD_REPEAT.delayMs`, the step repeats every `everyMs`, and
 * every `fastEveryMs` once held `fastAfterMs`. It stops on release, on
 * leaving the button, when the browser takes the touch, and as soon as
 * `canStep` says the stepper is at its end (min or max). The click that
 * ends a hold that stepped is swallowed, however long the finger stayed
 * after the end, so a hold never adds a step (nor takes an ingredient out).
 */
export class HoldRepeatTracker {
  private pressed = false;
  private pointerId = -1;
  private startedAt = 0;
  private stepped = 0;
  private timer: unknown = null;
  private guardUntil = -Infinity;
  private readonly clock: GestureClock;

  constructor(
    private readonly opts: {
      step: () => void;
      /** The stepper can still go this way (not at its min or max, not disabled). */
      canStep: () => boolean;
      clock?: GestureClock;
    },
  ) {
    this.clock = opts.clock ?? REAL_CLOCK;
  }

  /** Steps this hold has made. */
  get steps(): number {
    return this.stepped;
  }

  /** Still stepping (held, and not at the end). */
  get repeating(): boolean {
    return this.timer !== null;
  }

  /** The finger (or mouse button) is still down on it. */
  get held(): boolean {
    return this.pressed;
  }

  down(e: PointerLike): void {
    if (this.pressed || (e.button ?? 0) !== 0 || !this.opts.canStep()) return;
    this.pressed = true;
    this.pointerId = e.pointerId;
    this.startedAt = this.clock.now();
    this.stepped = 0;
    this.guardUntil = -Infinity;
    this.schedule(nextRepeatIn(0));
  }

  up(e: PointerLike): void {
    if (e.pointerId === this.pointerId) this.release();
  }

  /** Released, left the button, or taken by the browser: no more steps. */
  release(): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.pointerId = -1;
    this.clearTimer();
    if (this.stepped > 0) this.guardUntil = this.clock.now() + CLICK_GUARD_MS;
  }

  /** A click arrived: true when it ends a hold that stepped (its steps are already in). */
  consumeClick(): boolean {
    if (this.pressed && this.stepped > 0) return true;
    if (this.clock.now() > this.guardUntil) return false;
    this.guardUntil = -Infinity;
    return true;
  }

  private schedule(ms: number): void {
    this.timer = this.clock.setTimeout(() => this.tick(), ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private tick(): void {
    this.timer = null;
    // At the end (min or max): stop stepping, but the finger is still down.
    if (!this.pressed || !this.opts.canStep()) return;
    this.opts.step();
    this.stepped += 1;
    this.schedule(nextRepeatIn(this.clock.now() - this.startedAt));
  }
}
