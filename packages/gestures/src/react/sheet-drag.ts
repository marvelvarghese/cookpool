"use client";

import * as React from "react";
import { listenForDrags, sheetDragCloses, sheetDragRule } from "../gestures";
import { SETTLE_MS } from "../rules";
import { place, settleMs, settleTransition, useLatest } from "./motion";

/**
 * Dragging a sheet down closes it (design §2; Cookpool's sheet-drag.ts). A
 * drag down from the grabber or the header, or from a list scrolled to its
 * top, moves the sheet with the finger and lightens the scrim; past 80 px or
 * on a flick it slides away and `onClose` runs; short of that it springs
 * back. A list scrolled down keeps its scroll and text fields keep their
 * drags. Touch only (`listenForDrags`: a `touchmove` is the only thing that
 * can stop the page scrolling under it). The twins: ✕, Escape, the scrim.
 */
export function useSheetDrag(onClose: () => void): {
  sheet: (el: HTMLElement | null) => void;
  scrim: (el: HTMLElement | null) => void;
} {
  const [sheet, setSheet] = React.useState<HTMLElement | null>(null);
  const [scrim, setScrim] = React.useState<HTMLElement | null>(null);
  const close = useLatest(onClose);

  React.useEffect(() => {
    if (!sheet) return;
    let height = 1;
    let leaving: number | null = null;
    const fade = (dy: number, settle: boolean) => {
      if (!scrim) return;
      scrim.style.transition = settle ? settleTransition(true).replace("transform", "opacity") : "none";
      scrim.style.opacity = dy > 0 ? String(Math.max(0, 1 - dy / height)) : "";
    };
    const stop = listenForDrags(sheet, {
      begin(_start, target) {
        if (leaving !== null) return null;
        height = Math.max(1, sheet.offsetHeight);
        return sheetDragRule(target, sheet);
      },
      move(_dx, dy) {
        place(sheet, 0, Math.max(0, dy), false);
        fade(Math.max(0, dy), false);
      },
      end(drag, cancelled) {
        if (cancelled || !sheetDragCloses(drag.dy, drag.vy)) {
          place(sheet, 0, 0, true);
          fade(0, true);
          return;
        }
        place(sheet, 0, height, true);
        fade(height, true);
        leaving = window.setTimeout(() => close.current(), settleMs(SETTLE_MS));
      },
    });
    return () => {
      stop();
      if (leaving !== null) window.clearTimeout(leaving);
    };
  }, [sheet, scrim, close]);

  return { sheet: setSheet, scrim: setScrim };
}
