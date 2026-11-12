/*
 * Copied from Cookpool (spliteco-calm SL1, design §0.4; risk SL-A tracks the
 * duplication): apps/web-console-next/src/lib/gestures.ts. Keep it in step with
 * the source; only imports may differ.
 */

/**
 * Gestures (cookpool-app PW-7, design §5): the numbers, and following one
 * finger. Pull to refresh, the edge swipe back and dragging a sheet away are
 * each a few lines on top of this: a rule that says whether a drag is theirs,
 * and what to do while it moves and when it ends. No gesture or animation
 * library: the screens move with CSS transforms.
 *
 * Why touch events, not pointer events: a gesture that starts in the middle
 * of what the browser would scroll (a pull at the top of the page, a sheet's
 * list at its top) has to stop the browser at the first move. Only a
 * `touchmove` can be cancelled; once the browser starts to pan, pointer
 * events end in `pointercancel`, and `touch-action` cannot be decided
 * mid-gesture. So the listener is on `touchmove`, not passive, and it
 * cancels only the moves of a drag the gesture takes (or is about to take).
 * Mouse and pen are left alone: these are phone gestures, and each has a
 * visible twin.
 *
 * Pure apart from `listenForDrags` and the element helpers, which take
 * whatever looks like the DOM, so all of it is unit-testable in node.
 */

// ── The numbers ───────────────────────────────────────────────────

/** How far a finger moves before a gesture decides whether the drag is its own (px). */
export const DECIDE_PX = 8;
/** A release this fast (px/ms) in the gesture's direction is a flick… */
export const FLICK_PX_PER_MS = 0.5;
/** …once the finger has travelled at least this far (px). */
export const FLICK_MIN_PX = 24;
/** The speed at release is measured over the last this many ms. */
export const VELOCITY_WINDOW_MS = 100;

/** Pull to refresh: the spinner moves half as far as the finger… */
export const PULL_RESISTANCE = 0.5;
/** …and a release once it is this far down refreshes (px, after resistance). */
export const PULL_THRESHOLD_PX = 64;
/** It goes no further than this (px). */
export const PULL_MAX_PX = 96;
/** Where the spinner waits while the screen reads again (px). */
export const PULL_HOLD_PX = 56;

/** The edge swipe starts within this many px of the left edge… */
export const EDGE_PX = 20;
/** …and goes back once past this share of the width (or on a flick). */
export const EDGE_FRACTION = 0.3;

/** A sheet dragged down this far (px), or flicked, closes. */
export const SHEET_CLOSE_PX = 80;

/** How long a spring back or a slide away takes (ms; reduced motion makes it instant). */
export const SETTLE_MS = 200;
/** The easing of the sheets (tailwind's `slide-*` animations). */
export const SETTLE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

// ── The rules ─────────────────────────────────────────────────────

/** How far the pull shows for a finger `dy` px down: half of it, never above the top, at most PULL_MAX_PX. */
export function pullDistance(dy: number): number {
  if (!(dy > 0)) return 0;
  return Math.min(PULL_MAX_PX, dy * PULL_RESISTANCE);
}

/** Whether letting go of a pull this far down refreshes (else it springs back). */
export function pullRefreshes(distance: number): boolean {
  return distance >= PULL_THRESHOLD_PX;
}

/** A release at `velocity` px/ms after `distance` px, both in the gesture's direction. */
export function isFlick(distance: number, velocity: number): boolean {
  return distance >= FLICK_MIN_PX && velocity >= FLICK_PX_PER_MS;
}

/** Whether an edge swipe let go at `dx` px (moving at `vx` px/ms) on a screen `width` px wide goes back. */
export function edgeSwipeGoesBack(dx: number, width: number, vx: number): boolean {
  if (!(dx > 0)) return false;
  return dx >= width * EDGE_FRACTION || isFlick(dx, vx);
}

/** Whether a sheet let go at `dy` px down (moving at `vy` px/ms) closes (else it springs back). */
export function sheetDragCloses(dy: number, vy: number): boolean {
  if (!(dy > 0)) return false;
  return dy >= SHEET_CLOSE_PX || isFlick(dy, vy);
}

/** Down, and more down than sideways: a pull, or a sheet's drag. */
export function isDownward(dx: number, dy: number): boolean {
  return dy > 0 && Math.abs(dy) > Math.abs(dx);
}

/** Right, and more right than up or down: the edge swipe. */
export function isRightward(dx: number, dy: number): boolean {
  return dx > 0 && Math.abs(dx) > Math.abs(dy);
}

// ── Following one finger ──────────────────────────────────────────

export interface DragPoint {
  x: number;
  y: number;
  /** ms, any clock. */
  t: number;
}

/**
 * - `deciding`: the finger has moved less than DECIDE_PX; nothing is decided.
 * - `dragging`: the gesture took the drag; the browser does nothing with it.
 * - `ignored`: the drag is the browser's (a scroll) or another gesture's.
 */
export type DragPhase = "deciding" | "dragging" | "ignored";

export interface DragMove {
  phase: DragPhase;
  dx: number;
  dy: number;
  /** Cancel this move: the gesture has the drag, or will have it if it goes on like this. */
  prevent: boolean;
}

export interface DragEnd {
  phase: DragPhase;
  dx: number;
  dy: number;
  /** px/ms at release, over the last VELOCITY_WINDOW_MS. */
  vx: number;
  vy: number;
}

export interface Drag {
  move(point: DragPoint): DragMove;
  end(point?: DragPoint): DragEnd;
}

/**
 * One finger from `start`. `claims(dx, dy)` says whether the drag is the
 * gesture's; it is asked on every move until the finger has gone DECIDE_PX,
 * and its answer then is final. Moves it would claim are cancelled even
 * before that, so the browser never starts a scroll the gesture then takes.
 */
export function createDrag(start: DragPoint, claims: Claims): Drag {
  let phase: DragPhase = "deciding";
  let points: DragPoint[] = [start];
  let last = start;

  const track = (point: DragPoint) => {
    last = point;
    points.push(point);
    const since = point.t - VELOCITY_WINDOW_MS;
    // Keep one point at or before the window, so the speed spans all of it.
    while (points.length > 2 && points[1]!.t <= since) points = points.slice(1);
  };

  const velocity = (): { vx: number; vy: number } => {
    const first = points[0]!;
    const dt = last.t - first.t;
    if (!(dt > 0)) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  };

  return {
    move(point) {
      track(point);
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      if (phase === "deciding") {
        const wants = claims(dx, dy);
        if (Math.max(Math.abs(dx), Math.abs(dy)) >= DECIDE_PX) phase = wants ? "dragging" : "ignored";
        else return { phase, dx, dy, prevent: wants };
      }
      return { phase, dx, dy, prevent: phase === "dragging" };
    },
    end(point) {
      if (point) track(point);
      return { phase, dx: last.x - start.x, dy: last.y - start.y, ...velocity() };
    },
  };
}

// ── Listening ─────────────────────────────────────────────────────

export interface DragGesture {
  /**
   * A finger touched `target` at `start`: the rule that says whether its
   * drag is this gesture's (`createDrag`'s `claims`), or null to leave this
   * touch alone.
   */
  begin(start: DragPoint, target: EventTarget | null): Claims | null;
  /** The finger moved while the gesture has the drag (px from where it touched). */
  move(dx: number, dy: number): void;
  /** The finger lifted, or the touch was taken away (`cancelled`: a second finger, the browser). */
  end(drag: DragEnd, cancelled: boolean): void;
}

/** The little of a touch the listener reads. */
interface TouchLike {
  identifier: number;
  clientX: number;
  clientY: number;
}

interface TouchListLike {
  readonly length: number;
  [index: number]: TouchLike | undefined;
}

interface TouchEventLike {
  readonly touches: TouchListLike;
  readonly changedTouches: TouchListLike;
  readonly target: EventTarget | null;
  readonly cancelable: boolean;
  preventDefault(): void;
}

function find(list: TouchListLike, id: number): TouchLike | null {
  for (let i = 0; i < list.length; i++) {
    const touch = list[i];
    if (touch && touch.identifier === id) return touch;
  }
  return null;
}

/**
 * Follows one finger at a time on `el` for `gesture`, and returns how to
 * stop. `touchmove` is not passive, so a move of a drag the gesture takes is
 * cancelled (the page does not scroll or bounce under it). A second finger
 * ends the drag as cancelled. `now` is the clock (ms).
 */
export function listenForDrags(el: EventTarget, gesture: DragGesture, now: () => number = () => performance.now()): () => void {
  let drag: Drag | null = null;
  let id = -1;

  const point = (touch: TouchLike): DragPoint => ({ x: touch.clientX, y: touch.clientY, t: now() });

  const cancel = () => {
    const was = drag;
    drag = null;
    if (!was) return;
    const end = was.end();
    if (end.phase === "dragging") gesture.end(end, true);
  };

  const onStart = (event: Event) => {
    const e = event as unknown as TouchEventLike;
    // A second finger ends the drag (no gesture here is a pinch); so does a
    // touch whose end never came.
    if (drag) cancel();
    if (e.touches.length !== 1) return;
    const touch = e.changedTouches[0] ?? e.touches[0];
    if (!touch) return;
    const start = point(touch);
    const claims = gesture.begin(start, e.target);
    if (!claims) return;
    drag = createDrag(start, claims);
    id = touch.identifier;
  };

  const onMove = (event: Event) => {
    const e = event as unknown as TouchEventLike;
    if (!drag) return;
    if (e.touches.length > 1) {
      cancel();
      return;
    }
    const touch = find(e.changedTouches, id) ?? find(e.touches, id);
    if (!touch) return;
    const m = drag.move(point(touch));
    if (m.prevent && e.cancelable) e.preventDefault();
    if (m.phase === "dragging") gesture.move(m.dx, m.dy);
    else if (m.phase === "ignored") drag = null;
  };

  const onEnd = (event: Event) => {
    const e = event as unknown as TouchEventLike;
    if (!drag) return;
    const touch = find(e.changedTouches, id);
    if (!touch) return;
    const was = drag;
    drag = null;
    const end = was.end(point(touch));
    if (end.phase === "dragging") gesture.end(end, false);
  };

  const passive = { passive: true } as AddEventListenerOptions;
  const active = { passive: false } as AddEventListenerOptions;
  el.addEventListener("touchstart", onStart, passive);
  el.addEventListener("touchmove", onMove, active);
  el.addEventListener("touchend", onEnd, passive);
  el.addEventListener("touchcancel", cancel, passive);
  return () => {
    cancel();
    el.removeEventListener("touchstart", onStart, passive);
    el.removeEventListener("touchmove", onMove, active);
    el.removeEventListener("touchend", onEnd, passive);
    el.removeEventListener("touchcancel", cancel, passive);
  };
}

// ── What is under the finger ──────────────────────────────────────

/** The little of an element the helpers read (a real Element, or a fake in tests). */
export interface ElementLike {
  readonly parentElement: ElementLike | null;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  readonly clientHeight: number;
  readonly clientWidth: number;
  closest?(selector: string): unknown;
}

export type StyleOf = (el: ElementLike) => { overflowX: string; overflowY: string };

const browserStyle: StyleOf = (el) => getComputedStyle(el as unknown as Element);

/** Things with drags of their own (selecting text, a slider), and anything marked `data-gestures="off"`. */
export const OWN_DRAGS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-gestures="off"]';

/** Whether a touch on `target` belongs to the thing under it, not to a gesture. */
export function hasOwnDrags(target: unknown): boolean {
  const el = target as ElementLike | null;
  return typeof el?.closest === "function" && el.closest(OWN_DRAGS) != null;
}

/** Whether `el` scrolls along `axis` (its overflow lets it, and there is more than fits). */
export function scrolls(el: ElementLike, axis: "x" | "y", styleOf: StyleOf = browserStyle): boolean {
  const style = styleOf(el);
  const overflow = axis === "y" ? style.overflowY : style.overflowX;
  if (overflow !== "auto" && overflow !== "scroll") return false;
  return axis === "y" ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
}

/** The elements from `from` up to `root` (both included) that scroll along `axis`; none when `from` is outside `root`. */
export function scrollersBetween(from: unknown, root: ElementLike, axis: "x" | "y", styleOf: StyleOf = browserStyle): ElementLike[] {
  const found: ElementLike[] = [];
  let el = (from as ElementLike | null) ?? null;
  while (el) {
    if (scrolls(el, axis, styleOf)) found.push(el);
    if (el === root) return found;
    el = el.parentElement;
  }
  return [];
}

/** Scrolled all the way up (or left): a drag down (or right) has nothing to scroll back. */
export function atStart(el: ElementLike, axis: "x" | "y"): boolean {
  return (axis === "y" ? el.scrollTop : el.scrollLeft) <= 0;
}

// ── Whose drag is it ──────────────────────────────────────────────

/** Whether a drag `dx`, `dy` px from where it touched is the gesture's (`createDrag`'s `claims`). */
export type Claims = (dx: number, dy: number) => boolean;

/**
 * A pull to refresh, on `surface`: only from the very top of the page
 * (`pageTop()` at 0) and of any list the finger is on, down and mostly
 * vertical. Text fields keep their drags.
 */
export function pullRule(target: unknown, surface: ElementLike, pageTop: () => number, styleOf: StyleOf = browserStyle): Claims | null {
  if (hasOwnDrags(target) || pageTop() > 0) return null;
  const lists = scrollersBetween(target, surface, "y", styleOf);
  return (dx, dy) => isDownward(dx, dy) && pageTop() <= 0 && lists.every((list) => atStart(list, "y"));
}

/**
 * The edge swipe, on `frame`: only from within EDGE_PX of the left edge,
 * to the right and mostly sideways. A row that scrolls sideways (the
 * usuals, chips) keeps its drags; so do text fields.
 */
export function edgeSwipeRule(start: DragPoint, target: unknown, frame: ElementLike, styleOf: StyleOf = browserStyle): Claims | null {
  if (start.x > EDGE_PX || hasOwnDrags(target)) return null;
  if (scrollersBetween(target, frame, "x", styleOf).length > 0) return null;
  return isRightward;
}

/**
 * A bottom sheet's drag: down and mostly vertical, from the handle or the
 * header, or from a list (the sheet itself, when it scrolls) that is at its
 * top. A list scrolled down keeps its scroll; text fields keep their drags.
 */
export function sheetDragRule(target: unknown, sheet: ElementLike, styleOf: StyleOf = browserStyle): Claims | null {
  if (hasOwnDrags(target)) return null;
  const lists = scrollersBetween(target, sheet, "y", styleOf);
  return (dx, dy) => isDownward(dx, dy) && lists.every((list) => atStart(list, "y"));
}

/** The person asked for less motion: nothing slides, the gesture still works. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}
