"use client";

import * as React from "react";
import { listenForDrags } from "@/lib/gestures/gestures";
import { CLICK_GUARD_MS } from "@/lib/gestures/row-gestures";
import { pagerOffset, pagerPosition, pagerRelease, pagerRule } from "@/lib/gestures/rules";
import { settleTransition, useLatest } from "./motion";

/**
 * Swiping sideways between pages (design §2): Home ↔ Groups ↔ Activity,
 * Bills ↔ Balances, Itemized's items. The rules are `lib/gestures/rules.ts`
 * (`pagerRule`, `pagerOffset`, `pagerRelease`); this follows the finger with
 * touch events (`listenForDrags`: only a `touchmove` can stop the browser's
 * own pan once the drag is known to be sideways) and moves the track with a
 * transform. Vertical drags stay the browser's scroll. The twin is whatever
 * sets `index` by tapping: the tab, the segment, the dots.
 *
 * Usage: put `viewport` on the clipping element (class `pager`) and `track`
 * on its only child (class `pager-track`), one child per page; `position` is
 * the fractional page for an indicator (the tab bar's `position` prop).
 */
export function usePager({ index, count, onChange }: { index: number; count: number; onChange: (index: number) => void }): {
  viewport: (el: HTMLElement | null) => void;
  track: (el: HTMLElement | null) => void;
  /** The page the indicator shows: `index` at rest, fractional while a finger drags. */
  position: number;
  dragging: boolean;
} {
  const [viewport, setViewport] = React.useState<HTMLElement | null>(null);
  const [track, setTrack] = React.useState<HTMLElement | null>(null);
  const [position, setPosition] = React.useState(index);
  const [dragging, setDragging] = React.useState(false);
  const live = useLatest({ index, count, onChange });

  // At rest (and after each change), the track sits on its page; the first
  // placement is instant, so a deep link opens on its page without sliding there.
  const placed = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!track) return;
    track.style.transition = settleTransition(placed.current === track);
    placed.current = track;
    track.style.transform = `translate3d(${-index * 100}%, 0, 0)`;
    setPosition(index);
  }, [track, index]);

  React.useEffect(() => {
    if (!viewport || !track) return;
    let width = 1;
    let frame: number | null = null;
    let dxNow = 0;
    let guardUntil = -Infinity;

    const paint = () => {
      frame = null;
      const { index: i, count: n } = live.current;
      track.style.transition = "none";
      track.style.transform = `translate3d(${-i * width + pagerOffset(i, n, dxNow, width)}px, 0, 0)`;
      setPosition(pagerPosition(i, n, dxNow, width));
    };

    const stop = listenForDrags(viewport, {
      begin(_start, target) {
        width = Math.max(1, viewport.getBoundingClientRect().width);
        return pagerRule(target);
      },
      move(dx) {
        if (dxNow === 0) setDragging(true);
        dxNow = dx;
        frame ??= requestAnimationFrame(paint);
      },
      end(drag, cancelled) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        dxNow = 0;
        setDragging(false);
        guardUntil = performance.now() + CLICK_GUARD_MS;
        const { index: i, count: n, onChange: change } = live.current;
        const next = cancelled ? i : pagerRelease({ index: i, count: n, dx: drag.dx, vx: drag.vx, width });
        track.style.transition = settleTransition(true);
        track.style.transform = `translate3d(${-next * 100}%, 0, 0)`;
        setPosition(next);
        if (next !== i) change(next);
      },
    });

    // A swipe is not a tap: the click its release sends is swallowed.
    const onClick = (e: Event) => {
      if (performance.now() > guardUntil) return;
      guardUntil = -Infinity;
      e.preventDefault();
      e.stopPropagation();
    };
    viewport.addEventListener("click", onClick, true);
    return () => {
      stop();
      if (frame !== null) cancelAnimationFrame(frame);
      viewport.removeEventListener("click", onClick, true);
    };
  }, [viewport, track, live]);

  return { viewport: setViewport, track: setTrack, position, dragging };
}
