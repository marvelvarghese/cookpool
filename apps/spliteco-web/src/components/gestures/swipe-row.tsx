"use client";

import * as React from "react";
import { ROW_SWIPE, SwipeRowTracker, type RowRelease } from "@/lib/gestures/rules";
import { buzz, place, settleMs, useLatest } from "./motion";

/** A press that starts on one of the row's own controls is that control's (a link is not: the row is the link). */
const OWN_CONTROLS = "button, [role='button'], input, select, textarea, label";

/**
 * A row that swipes left (design §2): a short swipe reveals the `action`
 * (about 96 px of it) and leaves it showing; past 40% of the width or a
 * flick, `onFire` runs. With `onHold`, holding the row still 480 ms runs it
 * (the actions sheet). A swipe to the right is the pager's; up or down is
 * the list's scroll. Tapping the row while it is open closes it.
 *
 * Cookpool's lessons, kept: pointer events with `touch-action: pan-y` (the
 * browser keeps vertical scrolling), pointer capture only once the swipe is
 * decided (a tap on the row's link still lands on the link), the click after
 * a swipe or a hold is swallowed, and a mouse is left alone. The twins are
 * the revealed action itself, the hold sheet, and the page the row opens.
 */
export function SwipeRow({
  action,
  actionTone = "cobalt",
  onFire,
  onHold,
  className,
  children,
}: {
  /** What is revealed: a button or link, the twin of `onFire`. Null: the row doesn't swipe. */
  action: React.ReactNode | null;
  actionTone?: "cobalt" | "gold" | "coral" | "red";
  onFire?: (() => void) | undefined;
  onHold?: (() => void) | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  const root = React.useRef<HTMLDivElement | null>(null);
  const front = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [shown, setShown] = React.useState(false);
  const openRef = useLatest(open);
  const live = useLatest({ action, onFire, onHold });

  const tracker = React.useMemo(
    () =>
      new SwipeRowTracker({
        canSwipe: () => live.current.action != null,
        canHold: () => live.current.onHold !== undefined,
        isOpen: () => openRef.current,
        handlers: {
          drag: (offset) => {
            setShown(true);
            place(front.current, offset, 0, false);
          },
          release: (result: RowRelease) => {
            if (result === "reveal") {
              place(front.current, -ROW_SWIPE.revealPx, 0, true);
              setOpen(true);
              return;
            }
            place(front.current, 0, 0, true);
            setOpen(false);
            window.setTimeout(() => setShown(false), settleMs(200));
            if (result === "fire") {
              buzz(10);
              live.current.onFire?.();
            }
          },
          hold: () => {
            buzz();
            live.current.onHold?.();
          },
        },
      }),
    [live, openRef],
  );

  React.useEffect(() => () => tracker.cancel(), [tracker]);

  const close = () => {
    place(front.current, 0, 0, true);
    setOpen(false);
    window.setTimeout(() => setShown(false), settleMs(200));
  };

  const swipes = action != null || onHold !== undefined;
  return (
    <div
      ref={root}
      className={`swipe-row ${className ?? ""}`}
      data-swipe-row={swipes ? "" : undefined}
      onPointerDown={(e) => {
        // The row's own buttons, and the revealed action, keep their taps.
        if (!swipes || (e.target as Element).closest?.(OWN_CONTROLS)) return;
        tracker.down(e, root.current?.getBoundingClientRect().width ?? 0);
      }}
      onPointerMove={(e) => {
        if (tracker.move(e)) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // The pointer is gone already: fine.
          }
        }
      }}
      onPointerUp={(e) => tracker.up(e)}
      onPointerCancel={() => tracker.cancel()}
      onContextMenu={(e) => {
        if (tracker.contextMenu()) e.preventDefault();
      }}
      onClickCapture={(e) => {
        if (tracker.consumeClick()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Open: a tap on the row closes it rather than opening the row.
        if (open && front.current?.contains(e.target as Node)) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
      onDragStart={(e) => {
        if (swipes) e.preventDefault();
      }}
    >
      {shown || open ? (
        <div className={`swipe-action ${actionTone}`}>
          {action}
        </div>
      ) : null}
      <div ref={front} className="swipe-front">
        {children}
      </div>
    </div>
  );
}
