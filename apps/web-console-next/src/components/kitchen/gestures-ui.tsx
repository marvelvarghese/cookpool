"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { OFFLINE_BANNER_TEXT, isOffline } from "@/lib/connection";
import { newFrame } from "@/lib/features";
import { transitions } from "@/lib/transitions";
import {
  EDGE_FRACTION,
  PULL_HOLD_PX,
  SETTLE_EASE,
  SETTLE_MS,
  edgeSwipeGoesBack,
  edgeSwipeRule,
  listenForDrags,
  prefersReducedMotion,
  pullDistance,
  pullRefreshes,
  pullRule,
} from "@/lib/gestures";
import { edgeSwipeBackOn, pullsToRefresh, readEdgeSwipeEnv, type EdgeSwipeEnv } from "./gestures";
import { shownBackAction, useBack } from "./back-ui";

/**
 * The kitchen frame's gestures (cookpool-app PW-7, design §5), mounted once
 * by the kitchen layout: pull to refresh on the lists, and the installed
 * iPhone's swipe from the left edge to go back. The rules are gestures.ts;
 * following the finger is lib/gestures.ts. Bottom sheets drag away in the
 * shared sheet itself (components/ui/sheet.tsx).
 */

/** The spinner shows at least this long, so a quick answer still reads as "refreshed". */
const REFRESH_MIN_MS = 600;
/** How long a pull while offline shows the offline line. */
const OFFLINE_LINE_MS = 1800;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** The page's own scroll: a pull starts only at its very top. */
function pageScrollTop(): number {
  return document.scrollingElement?.scrollTop ?? window.scrollY;
}

type PullState = "idle" | "refreshing" | "offline";

/**
 * Pull to refresh, on the screens of `PULL_PAGES`: a drag down that starts
 * at the very top of the page (and of any list it starts in) pulls the
 * screen down at half the finger's speed, with a spinner in the gap. Let go
 * past 64 px and the screen's reads — the active queries, the ones it
 * already uses — are read again, the spinner turning until they settle;
 * short of it the screen springs back. Offline, the gap shows the offline
 * line instead, while the network is tried quietly. Touch only.
 */
export function PullToRefresh({
  surface,
  enabled,
  children,
}: {
  /** Where a pull may start (the kitchen's `<main>`). */
  surface: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const on = enabled && pullsToRefresh(pathname);
  const qc = useQueryClient();
  const content = React.useRef<HTMLDivElement>(null);
  const mark = React.useRef<HTMLDivElement>(null);
  const spinner = React.useRef<SVGSVGElement>(null);
  const [state, setState] = React.useState<PullState>("idle");
  // Refreshing or showing the offline line: no new pull. `round` drops a
  // refresh whose screen was left before it settled.
  const busy = React.useRef(false);
  const round = React.useRef(0);

  // The screen moved `d` px down: it follows the finger (`settle` false) or eases there.
  const paint = React.useCallback((d: number, settle: boolean) => {
    const el = content.current;
    const m = mark.current;
    if (!el || !m) return;
    const ease = `${SETTLE_MS}ms ${SETTLE_EASE}`;
    el.style.transition = settle ? `transform ${ease}` : "none";
    // No transform at rest: a transformed box would hold the page's fixed parts.
    el.style.transform = d > 0 ? `translate3d(0, ${d}px, 0)` : "";
    m.style.transition = settle ? `transform ${ease}, opacity ${ease}` : "none";
    m.style.transform = `translate3d(0, ${(d - PULL_HOLD_PX) / 2}px, 0)`;
    m.style.opacity = String(Math.min(1, d / PULL_HOLD_PX));
    if (spinner.current) spinner.current.style.transform = `rotate(${Math.round(d * 4)}deg)`;
  }, []);

  const release = React.useCallback(
    async (d: number) => {
      if (!pullRefreshes(d)) {
        paint(0, true);
        return;
      }
      const mine = ++round.current;
      busy.current = true;
      paint(PULL_HOLD_PX, true);
      if (isOffline()) {
        setState("offline");
        // As the offline banner's own retry does: an answer from the network ends it.
        void qc.invalidateQueries({ refetchType: "active" });
        await wait(OFFLINE_LINE_MS);
      } else {
        setState("refreshing");
        await Promise.all([qc.refetchQueries({ type: "active" }), wait(REFRESH_MIN_MS)]);
      }
      if (mine !== round.current) return;
      busy.current = false;
      paint(0, true);
      setState("idle");
    },
    [paint, qc],
  );

  // Another screen, or pulls switched off: nothing stays pulled.
  React.useEffect(() => {
    round.current++;
    busy.current = false;
    paint(0, false);
    setState("idle");
  }, [pathname, on, paint]);

  React.useEffect(() => {
    const el = surface.current;
    if (!on || !el) return;
    return listenForDrags(el, {
      begin(_start, target) {
        return busy.current ? null : pullRule(target, el, pageScrollTop);
      },
      move(_dx, dy) {
        paint(pullDistance(dy), false);
      },
      end(drag, cancelled) {
        void release(cancelled ? 0 : pullDistance(drag.dy));
      },
    });
  }, [on, surface, paint, release]);

  return (
    <div className="relative">
      <div
        ref={mark}
        role="status"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-center opacity-0"
      >
        {state === "offline" ? (
          <span className="rounded-full bg-[#3F4842] px-3.5 py-2 text-[13px] font-bold leading-tight text-white">{OFFLINE_BANNER_TEXT}</span>
        ) : (
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full border bg-card shadow-sm">
            <RotateCw ref={spinner} className={cn("h-5 w-5 text-primary", state === "refreshing" && "animate-spin")} strokeWidth={2.4} />
          </span>
        )}
        <span className="sr-only">{state === "refreshing" ? "Refreshing" : ""}</span>
      </div>
      <div ref={content}>{children}</div>
    </div>
  );
}

/**
 * Swipe from the left edge to go back, on the installed iPhone only (it has
 * no back gesture of its own there) and never on a tab. A drag that starts
 * within 20 px of the left edge and goes right takes the page with it; let
 * go past 30% of the width, or flick, and the page slides away and Back runs
 * — the back control's own action on this screen (PW-3), so a dish goes to
 * its group just as the chevron does. Short of that it springs back. A drag
 * that turns vertical scrolls; one that starts on a row that scrolls
 * sideways (the usuals, chips) is the row's. With reduced motion the page
 * stays put: a chevron at the edge shows the swipe, and Back still runs.
 */
export function EdgeSwipeBack({
  frame,
  page,
}: {
  /** Where a swipe may start (the kitchen frame: not sheets or dialogs, which sit outside it). */
  frame: React.RefObject<HTMLElement | null>;
  /** What slides (the kitchen's `<main>`). */
  page: React.RefObject<HTMLElement | null>;
}) {
  const pathname = usePathname();
  const [env, setEnv] = React.useState<EdgeSwipeEnv | null>(null);
  React.useEffect(() => setEnv(readEdgeSwipeEnv()), []);
  const on = env !== null && edgeSwipeBackOn(env, pathname, newFrame());

  // The screen's back control's action; the address's rule while none is shown (loading).
  const addressBack = useBack();
  const fallback = React.useRef(addressBack);
  React.useEffect(() => {
    fallback.current = addressBack;
  }, [addressBack]);

  const mark = React.useRef<HTMLDivElement>(null);
  const leaving = React.useRef<number | null>(null);

  const showMark = React.useCallback((progress: number, y?: number) => {
    const m = mark.current;
    if (!m) return;
    if (y !== undefined) m.style.top = `${Math.max(8, y - 22)}px`;
    m.style.opacity = String(Math.max(0, Math.min(1, progress)));
  }, []);

  // Put the page back where it belongs: on a new screen, or when the swipe is off.
  const reset = React.useCallback(() => {
    if (leaving.current !== null) window.clearTimeout(leaving.current);
    leaving.current = null;
    const main = page.current;
    if (main) {
      main.style.transition = "";
      main.style.transform = "";
      main.style.boxShadow = "";
    }
    showMark(0);
  }, [page, showMark]);

  React.useEffect(() => reset, [reset]);
  React.useEffect(() => {
    reset();
  }, [pathname, on, reset]);

  React.useEffect(() => {
    const root = frame.current;
    const main = page.current;
    if (!on || !root || !main) return;
    let startY = 0;
    let still = false;

    const slide = (x: number, settle: boolean) => {
      main.style.transition = settle ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}` : "none";
      main.style.transform = x > 0 ? `translate3d(${x}px, 0, 0)` : "";
      main.style.boxShadow = x > 0 ? "-16px 0 24px -16px rgb(0 0 0 / 0.25)" : "";
    };

    const goBack = () => {
      // The page has slid away with the finger already: Back's page transition
      // (RC-11) only fades the new screen in, so nothing slides twice.
      transitions.swiped(() => (shownBackAction() ?? fallback.current)());
      // The new screen resets the page; if none comes, put it back anyway.
      leaving.current = window.setTimeout(reset, 1500);
    };

    return listenForDrags(root, {
      begin(start, target) {
        const rule = leaving.current === null ? edgeSwipeRule(start, target, root) : null;
        startY = start.y;
        still = prefersReducedMotion();
        return rule;
      },
      move(dx) {
        const x = Math.max(0, dx);
        if (still) showMark(x / (window.innerWidth * EDGE_FRACTION), startY);
        else slide(x, false);
      },
      end(drag, cancelled) {
        if (cancelled || !edgeSwipeGoesBack(drag.dx, window.innerWidth, drag.vx)) {
          if (still) showMark(0);
          else slide(0, true);
          return;
        }
        if (still) {
          showMark(0);
          goBack();
          return;
        }
        slide(window.innerWidth, true);
        leaving.current = window.setTimeout(goBack, SETTLE_MS);
      },
    });
  }, [on, frame, page, reset, showMark]);

  return (
    <div
      ref={mark}
      aria-hidden
      className="pointer-events-none fixed left-2 top-1/2 z-40 grid h-11 w-11 place-items-center rounded-full border bg-card text-foreground opacity-0 shadow-md transition-opacity"
    >
      <ChevronLeft className="h-6 w-6" />
    </div>
  );
}
