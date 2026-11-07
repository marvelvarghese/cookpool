"use client";

import * as React from "react";
import { Check, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { HoldRepeatTracker, RowGestureTracker } from "@/lib/row-gestures";

/**
 * The React side of PW-8's gestures (design §5): a row that swipes left and
 * presses and holds (`SwipeRow`), and a stepper button that repeats while
 * held (`RepeatButton`). The decisions are `lib/row-gestures.ts`'s; this
 * forwards pointer events to it and moves the row with a CSS transform.
 * Every gesture has a visible twin, which stays: the row's own button, its
 * ⋮ or Undo, opening the item, tapping − or +.
 */

/** The latest value, for callbacks a tracker made once calls later. */
function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A short buzz on Android at a completed swipe; iPhones give web apps none, and nothing depends on it. */
function buzz(): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(10);
  } catch {
    // Not allowed here: fine.
  }
}

/** What swiping a row left does: the same as its button ("Use 2 onions") or its menu's Undo. */
export interface SwipeAction {
  /** What the revealed action says: "Use 2 onions", "Use", "Undo". */
  label: string;
  /** Green with a tick for a use; dark with the undo arrow for Undo. */
  tone: "use" | "undo";
  run: () => void;
}

const SPRING = "transform 180ms ease";
/** A press that starts on one of the row's own controls is that control's, not the row's. */
const OWN_CONTROLS = "button, [role='button'], input, select, textarea, label";

/**
 * A list row that swipes left to its `action` and, with `onLongPress`,
 * opens its menu when held still (~450 ms). The row follows the finger,
 * revealing the action behind it; let go past ~40% of its width (or with a
 * flick) and the action runs, else it springs back. A vertical drag
 * scrolls the list as before, and a tap still opens what the row opens.
 * Touch and pen only: a mouse has the row's buttons. The phone's own
 * long-press callout, text selection and context menu don't appear on it.
 */
export function SwipeRow({
  as: Tag = "li",
  action,
  onLongPress,
  className,
  frontClassName,
  children,
  ...rest
}: {
  as?: "li" | "div";
  /** Null: the row doesn't swipe (nothing it may do, or a payment's row). */
  action: SwipeAction | null;
  onLongPress?: (() => void) | undefined;
  /** The row's own classes (its place in the list). */
  className?: string;
  /** The moving layer's classes: the row's layout and its background (opaque, so the action hides behind it). */
  frontClassName?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  const rootRef = React.useRef<HTMLElement | null>(null);
  const frontRef = React.useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = React.useState<SwipeAction | null>(null);
  const [armed, setArmed] = React.useState(false);
  const actionRef = useLatest(action);
  const pressRef = useLatest(onLongPress);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = React.useCallback((offset: number, spring: boolean) => {
    const el = frontRef.current;
    if (!el) return;
    el.style.transition = spring && !reducedMotion() ? SPRING : "none";
    el.style.transform = offset === 0 ? "" : `translate3d(${offset}px, 0, 0)`;
  }, []);

  const tracker = React.useMemo(
    () =>
      new RowGestureTracker({
        canSwipe: () => actionRef.current !== null,
        canLongPress: () => pressRef.current !== undefined,
        handlers: {
          drag: (offset, nowArmed) => {
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = null;
            setShown(actionRef.current);
            setArmed(nowArmed);
            place(offset, false);
          },
          release: (fired) => {
            place(0, true);
            setArmed(false);
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(() => setShown(null), reducedMotion() ? 0 : 200);
            if (fired) {
              buzz();
              actionRef.current?.run();
            }
          },
          longPress: () => pressRef.current?.(),
        },
      }),
    [actionRef, pressRef, place],
  );

  React.useEffect(
    () => () => {
      tracker.cancel();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [tracker],
  );

  const swipes = action !== null || onLongPress !== undefined;
  const Icon = shown?.tone === "undo" ? Undo2 : Check;
  return (
    <Tag
      {...rest}
      ref={(el: HTMLElement | null) => {
        rootRef.current = el;
      }}
      data-swipe-row={swipes ? "" : undefined}
      className={cn("relative overflow-hidden", swipes && "select-none [-webkit-touch-callout:none] [&_a]:[-webkit-user-drag:none]", className)}
      style={swipes ? { touchAction: "pan-y", ...rest.style } : rest.style}
      onPointerDown={(e: React.PointerEvent<HTMLElement>) => {
        rest.onPointerDown?.(e);
        if (!swipes || (e.target as Element).closest?.(OWN_CONTROLS)) return;
        tracker.down(e, rootRef.current?.getBoundingClientRect().width ?? 0);
      }}
      onPointerMove={(e: React.PointerEvent<HTMLElement>) => {
        rest.onPointerMove?.(e);
        tracker.move(e);
      }}
      onPointerUp={(e: React.PointerEvent<HTMLElement>) => {
        rest.onPointerUp?.(e);
        tracker.up(e);
      }}
      onPointerCancel={(e: React.PointerEvent<HTMLElement>) => {
        rest.onPointerCancel?.(e);
        tracker.cancel();
      }}
      onContextMenu={(e: React.MouseEvent<HTMLElement>) => {
        rest.onContextMenu?.(e);
        if (tracker.contextMenu()) e.preventDefault();
      }}
      onClickCapture={(e: React.MouseEvent<HTMLElement>) => {
        if (!tracker.consumeClick()) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragStart={(e: React.DragEvent<HTMLElement>) => {
        // A press on the row's link is a press, not the start of dragging the link away.
        if (swipes) e.preventDefault();
      }}
    >
      {shown ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-end gap-2 pr-5 text-[15px] font-extrabold",
            shown.tone === "undo" ? "bg-foreground text-background" : "bg-primary text-primary-foreground",
          )}
        >
          <span className={cn("transition-opacity motion-reduce:transition-none", armed ? "opacity-100" : "opacity-75")}>{shown.label}</span>
          <Icon className={cn("h-5 w-5 shrink-0", armed ? "opacity-100" : "opacity-75")} strokeWidth={2.4} />
        </div>
      ) : null}
      <div ref={frontRef} className={cn("relative bg-card", frontClassName)}>
        {children}
      </div>
    </Tag>
  );
}

/** How far outside the button a held finger may drift before the hold stops ("leaving the button"). */
const HOLD_SLACK_PX = 12;

/**
 * A stepper's − or +: a tap steps once (its click, as before); held, it
 * repeats after ~400 ms every ~150 ms, faster (~60 ms) after a second
 * (`HoldRepeatTracker`). It stops on release, on leaving the button, and at
 * the stepper's end: `disabled` there, or `canRepeat={false}` where one more
 * tap does something a hold should not (the step that takes an ingredient
 * out). Each repeated step is the same `onStep` a tap calls, so the writes
 * it starts keep SM-5's burst (one toast for a burst).
 */
export const RepeatButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type"> & {
    onStep: () => void;
    /** False stops a hold here while a tap still works. */
    canRepeat?: boolean;
  }
>(function RepeatButton({ onStep, canRepeat = true, disabled, onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, onPointerMove, onContextMenu, ...rest }, ref) {
  const stepRef = useLatest(onStep);
  const canRef = useLatest(!disabled && canRepeat);
  const tracker = React.useMemo(() => new HoldRepeatTracker({ step: () => stepRef.current(), canStep: () => canRef.current }), [stepRef, canRef]);
  React.useEffect(() => () => tracker.release(), [tracker]);
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      {...rest}
      onClick={() => {
        if (tracker.consumeClick()) return;
        onStep();
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        tracker.down(e);
      }}
      onPointerUp={(e) => {
        onPointerUp?.(e);
        tracker.up(e);
      }}
      onPointerCancel={(e) => {
        onPointerCancel?.(e);
        tracker.release();
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        tracker.release();
      }}
      onPointerMove={(e) => {
        onPointerMove?.(e);
        // A touch stays captured by the button, so leaving it is seen here, not as a pointerleave.
        if (!tracker.held) return;
        const r = e.currentTarget.getBoundingClientRect();
        const out =
          e.clientX < r.left - HOLD_SLACK_PX || e.clientX > r.right + HOLD_SLACK_PX || e.clientY < r.top - HOLD_SLACK_PX || e.clientY > r.bottom + HOLD_SLACK_PX;
        if (out) tracker.release();
      }}
      onContextMenu={(e) => {
        onContextMenu?.(e);
        // A held stepper is not a long-press on the page.
        if (tracker.held) e.preventDefault();
      }}
    />
  );
});
