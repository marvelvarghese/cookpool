"use client";

import * as React from "react";
import { HoldTracker } from "@/lib/gestures/rules";
import { buzz, useLatest } from "./motion";

/**
 * Press and hold (design §2): held still 480 ms, `onHold` runs (with a light
 * buzz where the phone allows); moving more than 8 px first is a scroll or a
 * swipe and cancels it. Spread the returned props on the element. The click
 * after a hold is swallowed, so the element's own tap (its twin: opening the
 * page with the same actions) does not run as well. Touch and pen only
 * unless `mouse`.
 */
export function useHold(onHold: (() => void) | undefined, opts: { mouse?: boolean } = {}): {
  onPointerDown: React.PointerEventHandler;
  onPointerMove: React.PointerEventHandler;
  onPointerUp: React.PointerEventHandler;
  onPointerCancel: React.PointerEventHandler;
  onPointerLeave: React.PointerEventHandler;
  onContextMenu: React.MouseEventHandler;
  onClickCapture: React.MouseEventHandler;
} {
  const live = useLatest(onHold);
  const mouse = opts.mouse === true;
  const tracker = React.useMemo(
    () =>
      new HoldTracker({
        mouse,
        onHold: () => {
          buzz();
          live.current?.();
        },
      }),
    [live, mouse],
  );
  React.useEffect(() => () => tracker.cancel(), [tracker]);
  return {
    onPointerDown: (e) => {
      if (live.current) tracker.down(e);
    },
    onPointerMove: (e) => tracker.move(e),
    onPointerUp: (e) => tracker.up(e),
    onPointerCancel: () => tracker.cancel(),
    onPointerLeave: () => tracker.cancel(),
    onContextMenu: (e) => {
      // The phone's own long-press menu never opens over ours.
      if (tracker.pending || tracker.held) e.preventDefault();
    },
    onClickCapture: (e) => {
      if (!tracker.consumeClick()) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
