"use client";

import * as React from "react";
import { prefersReducedMotion } from "../gestures";
import { SETTLE_TRANSITION } from "../rules";

/**
 * What every gesture helper shares (spliteco-calm SL1): the latest value for
 * callbacks a tracker made once, the settle transition (instant under
 * reduced motion), and the light buzz on Android.
 */

export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

/** The transition to settle with: 200 ms `cubic-bezier(0.32,0.72,0,1)`, none under reduced motion or while following a finger. */
export function settleTransition(settle: boolean): string {
  return settle && !prefersReducedMotion() ? SETTLE_TRANSITION : "none";
}

/** Move `el` to `x`, `y` (px) with a transform; no transform at rest, so a fixed child is not held by it. */
export function place(el: HTMLElement | null, x: number, y: number, settle: boolean): void {
  if (!el) return;
  el.style.transition = settleTransition(settle);
  el.style.transform = x === 0 && y === 0 ? "" : `translate3d(${x}px, ${y}px, 0)`;
}

/** A short buzz where the phone allows it (Android); nothing depends on it. */
export function buzz(ms = 8): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(ms);
  } catch {
    // Not allowed here: fine.
  }
}

/** How long a settle takes here (ms): 0 under reduced motion. */
export function settleMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}
