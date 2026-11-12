"use client";

import * as React from "react";
import { PULL_HOLD_PX, PULL_THRESHOLD_PX, listenForDrags, pullDistance, pullRefreshes, pullRule } from "@/lib/gestures/gestures";
import { place, useLatest } from "./motion";

/**
 * Pull to refresh (design §2): at the very top of the page, a finger pulled
 * down moves the content with resistance (`pullDistance`: half the finger,
 * at most PULL_MAX_PX) and turns the spinner; let go past PULL_THRESHOLD_PX
 * and the content holds at PULL_HOLD_PX while `onRefresh` re-reads, then
 * settles back. Touch only (`listenForDrags`): a mouse never pulls. The twin
 * is the screen re-reading when it comes back into view.
 *
 * Usage: `surface` on the element that hears the finger and moves (no
 * transform at rest, so sheets inside stay fixed), `spinner` on the
 * indicator above it.
 */
export function usePull(onRefresh: () => Promise<unknown>): {
  surface: (el: HTMLElement | null) => void;
  spinner: (el: HTMLElement | null) => void;
  refreshing: boolean;
} {
  const [surface, setSurface] = React.useState<HTMLElement | null>(null);
  const [spinner, setSpinner] = React.useState<HTMLElement | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const live = useLatest({ onRefresh, refreshing });

  React.useEffect(() => {
    if (!surface) return;
    let frame: number | null = null;
    let distance = 0;
    const show = (d: number, settle: boolean) => {
      place(surface, 0, d, settle);
      if (spinner) {
        spinner.style.opacity = String(Math.min(1, d / PULL_THRESHOLD_PX));
        spinner.style.transform = `translateY(${d - 40}px) rotate(${d * 5}deg)`;
        spinner.style.transition = settle ? "transform 200ms, opacity 200ms" : "none";
      }
    };
    const stop = listenForDrags(surface, {
      begin(_start, target) {
        if (live.current.refreshing) return null;
        return pullRule(target, surface, () => window.scrollY);
      },
      move(_dx, dy) {
        distance = pullDistance(dy);
        frame ??= requestAnimationFrame(() => {
          frame = null;
          show(distance, false);
        });
      },
      end(_drag, cancelled) {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        const go = !cancelled && pullRefreshes(distance);
        distance = 0;
        if (!go) {
          show(0, true);
          return;
        }
        show(PULL_HOLD_PX, true);
        setRefreshing(true);
        void live.current
          .onRefresh()
          .catch(() => undefined)
          .finally(() => {
            setRefreshing(false);
            show(0, true);
          });
      },
    });
    return () => {
      stop();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [surface, spinner, live]);

  return { surface: setSurface, spinner: setSpinner, refreshing };
}
