"use client";

import * as React from "react";
import { SETTLE_EASE, SETTLE_MS, listenForDrags, sheetDragCloses, sheetDragRule } from "@/lib/gestures";

/** After a drag closed the sheet, it must be closing this soon; else its owner kept it open, and it springs back. */
const CLOSING_CHECK_MS = 400;

/** The scrim's darkness at rest (the overlay's `bg-black/50`). */
const SCRIM_ALPHA = 0.5;

export interface SheetDrag {
  /** The sheet's own box (a callback ref). */
  content: (node: HTMLElement | null) => void;
  /** The scrim behind it: it lightens as the sheet goes down. */
  overlay: React.RefObject<HTMLDivElement | null>;
  /** The sheet's ✕: a drag that closes the sheet presses it, so the sheet closes exactly as ✕ closes it. */
  close: React.RefObject<HTMLButtonElement | null>;
}

/**
 * Dragging a bottom sheet down to close it (cookpool-app PW-7, design §5),
 * for every bottom sheet at once: + Add, the pickers, the measure question,
 * the iPhone install steps, Cook's ingredient picker.
 *
 * A drag down that starts on the handle or the header, or on a list that is
 * scrolled to its top, moves the sheet with the finger (the CSS `translate`
 * property, so Radix's own slide-out, a `transform`, carries on from where
 * the finger left it). Let go past 80 px, or flick, and it closes; short of
 * that it springs back. A list scrolled down keeps its scroll, sideways
 * rows keep theirs, and text fields keep their own drags. Touch only; the
 * twins are ✕ and tapping outside. Reduced motion: the global rule makes the
 * spring and the slide instant.
 */
export function useSheetDrag(enabled: boolean): SheetDrag {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const overlay = React.useRef<HTMLDivElement>(null);
  const close = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!enabled || !node) return;
    let check = 0;
    // The sheet's height, read once when a finger lands (not on every move: that would force a layout each frame).
    let height = 1;

    const place = (dy: number, settle: boolean) => {
      const ease = `${SETTLE_MS}ms ${SETTLE_EASE}`;
      node.style.transition = settle ? `translate ${ease}` : "none";
      node.style.translate = dy > 0 ? `0 ${dy}px` : "";
      const scrim = overlay.current;
      if (!scrim) return;
      // The colour, not the opacity: Radix fades the overlay out with an opacity animation.
      const alpha = SCRIM_ALPHA * Math.max(0, 1 - dy / height);
      scrim.style.transition = settle ? `background-color ${ease}` : "none";
      scrim.style.backgroundColor = dy > 0 ? `rgb(0 0 0 / ${alpha.toFixed(3)})` : "";
    };

    const stop = listenForDrags(node, {
      begin(_start, target) {
        if (node.dataset.state === "closed") return null;
        height = Math.max(1, node.offsetHeight);
        return sheetDragRule(target, node);
      },
      move(_dx, dy) {
        place(Math.max(0, dy), false);
      },
      end(drag, cancelled) {
        if (cancelled || !sheetDragCloses(drag.dy, drag.vy)) {
          place(0, true);
          return;
        }
        close.current?.click();
        check = window.setTimeout(() => {
          if (node.isConnected && node.dataset.state !== "closed") place(0, true);
        }, CLOSING_CHECK_MS);
      },
    });
    return () => {
      stop();
      window.clearTimeout(check);
    };
  }, [enabled, node]);

  return { content: setNode, overlay, close };
}
