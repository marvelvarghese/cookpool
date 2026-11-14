// Money-native MY-22: one set of timings. The ExpandButton (MY-3) set the
// product's motion language; this file is where every page and primitive reads
// it, so a screen cannot invent a duration. Geometry and slides take .45s on
// the ExpandButton's curve, fades .25s, small state changes (a press, a tint)
// .15s, the dim .3s. Under reduced motion a transform becomes no change at all
// and an opacity change a plain .15s fade.

export const MOTION = Object.freeze({
  /** Geometry, slides, the pill: the ExpandButton's curve. */
  ease: "cubic-bezier(.2,.8,.2,1)",
  geometryMs: 450,
  /** Fades and cross-fades. */
  fadeMs: 250,
  /** The content of the ExpandButton fades in this long after the box starts to grow. */
  fadeDelayMs: 300,
  /** Pressed states, tints, a switch knob's colour. */
  smallMs: 150,
  /** The dim over a page. */
  dimMs: 300,
  /** Under prefers-reduced-motion every change is instant or this plain fade. */
  reducedMs: 150,
  /** The Groups | People page drifts this far (px) in the direction of the move. */
  driftPx: 10,
  /** The page underneath a page that slides in shifts this far (% of its width). */
  shiftPct: 20,
  /** A pressed row or button scales to this. */
  pressScale: 0.98,
  /** The dim over a page that has another page sliding over it: softer than the sheet's. */
  pageDim: "rgba(27,36,32,.2)",
});

export type MotionKind = "geometry" | "fade" | "small";

const MS: Record<MotionKind, number> = { geometry: MOTION.geometryMs, fade: MOTION.fadeMs, small: MOTION.smallMs };

/** How long a change of this kind takes (ms); reduced motion makes everything the plain fade. */
export function durationOf(kind: MotionKind, reduced = false): number {
  return reduced ? MOTION.reducedMs : MS[kind];
}

/**
 * A CSS `transition` value for properties of one kind: geometry on the product's curve, fades and small
 * changes on `ease`. Reduced motion keeps only opacity and colours (a .15s fade) and drops the rest.
 */
export function transitionOf(kind: MotionKind, properties: readonly string[], reduced = false): string {
  const fadeable = properties.filter((p) => p === "opacity" || p === "background-color" || p === "color");
  const list = reduced ? fadeable : properties;
  if (list.length === 0) return "none";
  const curve = kind === "geometry" && !reduced ? MOTION.ease : "ease";
  return list.map((p) => `${p} ${durationOf(kind, reduced)}ms ${curve}`).join(", ");
}

/** The side a page opens from, as a direction: +1 moves forward (the new page comes from the right), -1 back. */
export type MotionDirection = 1 | -1;

const SIDE_ORDER = ["groups", "people"] as const;

/** Groups to People is forward (the page drifts left); People to Groups is back (it drifts right). Same side: forward. */
export function sideDirection(from: string, to: string): MotionDirection {
  const a = SIDE_ORDER.indexOf(from as (typeof SIDE_ORDER)[number]);
  const b = SIDE_ORDER.indexOf(to as (typeof SIDE_ORDER)[number]);
  return a > b && b !== -1 ? -1 : 1;
}

/** Where the open pill sits behind the Groups | People switch: 0 on the first side, `offset` on the second. */
export function pillOffset(side: string, offset: number): number {
  return side === "people" ? offset : 0;
}

/** Where a page starts when it enters, in the units of its transform. */
export function enterTransform(mode: "drift" | "slide" | "rise", dir: MotionDirection): string {
  if (mode === "drift") return `translate3d(${dir * MOTION.driftPx}px,0,0)`;
  if (mode === "rise") return "translate3d(0,100%,0)";
  return dir > 0 ? "translate3d(100%,0,0)" : `translate3d(-${MOTION.shiftPct}%,0,0)`;
}

/** Where a page goes when it leaves. */
export function leaveTransform(mode: "drift" | "slide" | "rise", dir: MotionDirection): string {
  if (mode === "drift") return `translate3d(${-dir * MOTION.driftPx}px,0,0)`;
  if (mode === "rise") return "translate3d(0,100%,0)";
  return dir > 0 ? `translate3d(-${MOTION.shiftPct}%,0,0)` : "translate3d(100%,0,0)";
}

/** A number on its way from `from` to `to` after fraction `t` (0..1) of the geometry time, eased out. */
export function tween(from: number, to: number, t: number): number {
  const c = Math.min(1, Math.max(0, t));
  const eased = 1 - (1 - c) ** 3;
  return Math.round(from + (to - from) * eased);
}

/**
 * The CSS the pages share, drawn once by LookScope: a pressed row or button scales to .98 for .15s; under
 * reduced motion the scale is dropped and a tint stands in for it.
 */
export const MOTION_CSS =
  `[data-look] :where(button,a,[data-press]):where(:not(:disabled)){transition:transform ${MOTION.smallMs}ms ease,background-color ${MOTION.smallMs}ms ease,opacity ${MOTION.smallMs}ms ease}` +
  `[data-look] :where(button,a,[data-press]):where(:not(:disabled)):active{transform:scale(${MOTION.pressScale})}` +
  `@media (prefers-reduced-motion: reduce){` +
  `[data-look] :where(button,a,[data-press]):where(:not(:disabled)){transition:opacity ${MOTION.reducedMs}ms ease}` +
  `[data-look] :where(button,a,[data-press]):where(:not(:disabled)):active{transform:none;opacity:.7}}`;
