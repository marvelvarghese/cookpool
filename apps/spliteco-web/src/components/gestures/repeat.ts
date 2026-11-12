"use client";

import * as React from "react";
import { useLatest } from "./motion";

/** Held this long, a − / + starts repeating… */
export const REPEAT_DELAY_MS = 400;
/** …once every this many ms (design §2: Shares, Itemized ₹). */
export const REPEAT_EVERY_MS = 140;

/**
 * A − / + that repeats while held (design §2). The press steps once at
 * once; held past REPEAT_DELAY_MS it keeps stepping until the finger lifts,
 * leaves or the touch is taken for a scroll. The twin is tapping — a
 * keyboard's Enter or Space is a click and steps once. Spread the props on a
 * button.
 */
export function useRepeat(step: () => void, every = REPEAT_EVERY_MS): {
  onPointerDown: React.PointerEventHandler;
  onPointerUp: React.PointerEventHandler;
  onPointerLeave: React.PointerEventHandler;
  onPointerCancel: React.PointerEventHandler;
  onClick: React.MouseEventHandler;
  onContextMenu: React.MouseEventHandler;
} {
  const live = useLatest(step);
  const timers = React.useRef<{ wait: number | null; tick: number | null }>({ wait: null, tick: null });
  const pressed = React.useRef(false);
  const stop = React.useCallback(() => {
    const t = timers.current;
    if (t.wait !== null) window.clearTimeout(t.wait);
    if (t.tick !== null) window.clearInterval(t.tick);
    t.wait = t.tick = null;
  }, []);
  React.useEffect(() => stop, [stop]);
  return {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      pressed.current = true;
      stop();
      live.current();
      timers.current.wait = window.setTimeout(() => {
        timers.current.tick = window.setInterval(() => live.current(), every);
      }, REPEAT_DELAY_MS);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (e) => {
      // The pointer already stepped; a click with no pointer before it (Enter, Space) steps once.
      if (pressed.current) {
        pressed.current = false;
        return;
      }
      e.preventDefault();
      live.current();
    },
    onContextMenu: (e) => e.preventDefault(),
  };
}
