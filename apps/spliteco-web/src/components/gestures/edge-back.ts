"use client";

import * as React from "react";
import { edgeSwipeGoesBack, edgeSwipeRule, listenForDrags, prefersReducedMotion } from "@/lib/gestures/gestures";
import { SETTLE_MS, edgeBackDevice, type EdgeBackEnv } from "@/lib/gestures/rules";
import { place, useLatest } from "./motion";

/** The device, as the edge swipe sees it (read in an effect: the pages are prerendered). */
export function readEdgeBackEnv(): EdgeBackEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = ["standalone", "fullscreen", "minimal-ui"].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches === true) || nav.standalone === true;
  return { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints ?? 0, standalone };
}

/**
 * From the left edge, back (design §2; Cookpool's EdgeSwipeBack): a drag that
 * starts within 20 px of the left edge and goes right takes the `page` with
 * it; past 30% of the width or on a flick it slides away and `onBack` runs,
 * else it springs back. Only in the installed app on an iPhone
 * (`edgeBackDevice`): Safari and Android have their own back swipe. A row
 * that scrolls sideways keeps its drags. Reduced motion: the page stays put
 * and Back still runs. The twin is the screen's ← button.
 *
 * Put `frame` on where a swipe may start and `page` on what slides.
 */
export function useEdgeBack(onBack: () => void, enabled = true): {
  frame: (el: HTMLElement | null) => void;
  page: (el: HTMLElement | null) => void;
} {
  const [frame, setFrame] = React.useState<HTMLElement | null>(null);
  const [page, setPage] = React.useState<HTMLElement | null>(null);
  const [device, setDevice] = React.useState(false);
  React.useEffect(() => setDevice(edgeBackDevice(readEdgeBackEnv())), []);
  const back = useLatest(onBack);
  const on = enabled && device;

  React.useEffect(() => {
    if (!on || !frame || !page) return;
    let still = false;
    let leaving: number | null = null;
    const stop = listenForDrags(frame, {
      begin(start, target) {
        if (leaving !== null) return null;
        still = prefersReducedMotion();
        return edgeSwipeRule(start, target, frame);
      },
      move(dx) {
        if (!still) place(page, Math.max(0, dx), 0, false);
      },
      end(drag, cancelled) {
        const width = window.innerWidth;
        if (cancelled || !edgeSwipeGoesBack(drag.dx, width, drag.vx)) {
          place(page, 0, 0, true);
          return;
        }
        if (still) {
          back.current();
          return;
        }
        place(page, width, 0, true);
        leaving = window.setTimeout(() => {
          back.current();
          // If no new screen comes, put the page back anyway.
          leaving = window.setTimeout(() => {
            leaving = null;
            place(page, 0, 0, false);
          }, 1500);
        }, SETTLE_MS);
      },
    });
    return () => {
      stop();
      if (leaving !== null) window.clearTimeout(leaving);
      place(page, 0, 0, false);
    };
  }, [on, frame, page, back]);

  return { frame: setFrame, page: setPage };
}
