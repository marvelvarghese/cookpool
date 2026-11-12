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
import { navigate } from "./transition-ui";
import { neighbourTab, springFrame, tabSwipeDirection, tabSwipeOffset, tabSwipeOn, tabSwipeRelease, tabSwipeRule } from "./tab-swipe";
import { rememberTab, rememberWhenIdle, tabSnapshot } from "./tab-preview";
import { NEW_FRAME_TABS } from "./nav";
import { K_TITLE } from "./kit";
import { Skeleton } from "@/components/ui/skeleton";
import type { TabSwipeDirection } from "@/lib/transitions";

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

/** Whether a sheet or dialog is open: a tab swipe never starts under one. */
function sheetOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

// Before paint where there is a DOM (the arrival resets the page in the frame it shows); a no-op prerendered.
const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

const translate = (x: number) => (x !== 0 ? `translate3d(${x}px, 0, 0)` : "");

/**
 * Swiping between the tabs (cookpool-revamp RV-9, made native in RV-12), on
 * the five tabs' roots in the new frame, on a phone. A drag on the page that
 * turns out sideways (`tabSwipeRule`: more than 1.6× as sideways as up or
 * down, known by the first moves) takes the page with the finger, one to
 * one, and the tab beside it comes in alongside: a copy of how it last looked
 * (tab-preview.ts), or its title over a skeleton. Moves are coalesced to one
 * paint per frame, by `translate3d` only, with `will-change` while it drags.
 *
 * Let go past 35% of the width or flick (0.5 px/ms) and the page springs the
 * rest of the way (a critically damped spring, about 300 ms, starting at the
 * finger's speed), then the tab opens (`router.push`, no second animation);
 * short of that, or on a flick back, it springs back. Past the first and
 * last tabs the page rubber-bands. A drag that turns vertical is the
 * browser's scroll, untouched. Touches on what scrolls sideways, swipe rows,
 * fields, sliders, sheets and the bars, or within 24 px of either side, are
 * never taken. With reduced motion nothing moves: the tab just opens.
 */
export function TabSwipe({ page }: { /** Where a swipe may start, and what moves (the kitchen's `<main>`). */ page: React.RefObject<HTMLElement | null> }) {
  const pathname = usePathname() ?? "";
  const [width, setWidth] = React.useState<number | null>(null);
  React.useEffect(() => {
    const read = () => setWidth(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const on = width !== null && tabSwipeOn(pathname, { newFrame: newFrame(), width });

  const layer = React.useRef<HTMLDivElement>(null);
  const host = React.useRef<HTMLDivElement>(null);
  const skeleton = React.useRef<HTMLDivElement>(null);
  const title = React.useRef<HTMLHeadingElement>(null);
  // Settling or opening the tab: no new swipe until the page is back or gone.
  const busy = React.useRef(false);
  const leaving = React.useRef<number | null>(null);
  const frame = React.useRef<number | null>(null);

  const hidePreview = React.useCallback(() => {
    const l = layer.current;
    if (!l) return;
    l.style.display = "none";
    l.style.transform = "";
    l.style.willChange = "";
    l.dataset.tab = "";
    host.current?.replaceChildren();
  }, []);

  const reset = React.useCallback(() => {
    if (leaving.current !== null) window.clearTimeout(leaving.current);
    leaving.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    busy.current = false;
    const main = page.current;
    if (main) {
      main.style.transition = "";
      main.style.transform = "";
      main.style.willChange = "";
    }
    hidePreview();
  }, [page, hidePreview]);

  React.useEffect(() => reset, [reset]);
  useIsoLayoutEffect(() => {
    reset();
  }, [pathname, on, reset]);
  // Each tab is copied once the person has been on it a moment, for the swipe back to show.
  React.useEffect(() => (on ? rememberWhenIdle(pathname) : undefined), [on, pathname]);

  React.useEffect(() => {
    const main = page.current;
    const l = layer.current;
    if (!on || !main || !l) return;
    let still = false;
    let started = false;
    let w = 0;
    let dxNow = 0;
    // Which side the preview is on: +1 the next tab (to the right), −1 the previous.
    let side = 0;

    // The tab beside, that way, into the preview (its copy, or its title over a skeleton); false if there is none.
    const showNeighbour = (direction: TabSwipeDirection | null): boolean => {
      const href = direction ? neighbourTab(pathname, direction) : null;
      if (!href || !direction) {
        if (side !== 0) hidePreview();
        side = 0;
        return false;
      }
      side = direction === "next" ? 1 : -1;
      if (l.dataset.tab === href) return true;
      const copy = tabSnapshot(href);
      host.current?.replaceChildren(...(copy ? [copy] : []));
      if (skeleton.current) skeleton.current.style.display = copy ? "none" : "";
      if (title.current) title.current.textContent = NEW_FRAME_TABS.find((t) => t.href === href)?.label ?? "";
      const rect = main.getBoundingClientRect();
      l.style.left = `${rect.left}px`;
      l.style.width = `${rect.width}px`;
      l.style.willChange = "transform";
      l.style.display = "block";
      l.dataset.tab = href;
      return true;
    };

    // The page at `x`, and the tab beside one width away from it.
    const place = (x: number) => {
      main.style.transform = translate(x);
      if (side !== 0) l.style.transform = `translate3d(${x + side * w}px, 0, 0)`;
    };

    const paintDrag = () => {
      frame.current = null;
      const x = tabSwipeOffset(pathname, dxNow, w);
      showNeighbour(tabSwipeDirection(x));
      place(x);
    };

    const settle = (from: number, to: number, v0: number, done: () => void) => {
      const d0 = from - to;
      const t0 = performance.now();
      const step = (now: number) => {
        const f = springFrame(d0, v0, now - t0);
        place(to + f.d);
        if (f.done) {
          frame.current = null;
          done();
        } else frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    };

    const open = (href: string, direction: TabSwipeDirection, animated: boolean) => {
      // The new screen resets the page; if none comes, put it back anyway.
      leaving.current = window.setTimeout(reset, 1500);
      // This tab as it looks now, for the swipe back.
      rememberTab(pathname);
      const go = () => {
        if (!navigate(href, { kind: animated ? null : "tab" })) window.location.assign(href);
      };
      // Animated: the page is there already, nothing more plays. Reduced: the tab step's own (a short fade).
      if (animated) go();
      else transitions.tabSwiped(direction, go);
    };

    return listenForDrags(main, {
      begin(start, target) {
        if (busy.current) return null;
        still = prefersReducedMotion();
        started = false;
        return tabSwipeRule(start, target, main, { pathname, width: window.innerWidth, sheetOpen: sheetOpen() });
      },
      move(dx) {
        if (still) return;
        if (!started) {
          started = true;
          w = window.innerWidth;
          main.style.transition = "none";
          main.style.willChange = "transform";
        }
        dxNow = dx;
        frame.current ??= requestAnimationFrame(paintDrag);
      },
      end(drag, cancelled) {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        const width = still || !started ? window.innerWidth : w;
        const to = cancelled ? null : tabSwipeRelease(pathname, drag.dx, drag.vx, width);
        if (still || !started) {
          if (to) open(to.href, to.direction, false);
          return;
        }
        busy.current = true;
        const from = tabSwipeOffset(pathname, drag.dx, w);
        if (to) {
          showNeighbour(to.direction);
          settle(from, to.direction === "next" ? -w : w, drag.vx, () => open(to.href, to.direction, true));
          return;
        }
        // Back: at the finger's speed when it was following one to one; a rubber band just eases home.
        const following = tabSwipeDirection(from) !== null && neighbourTab(pathname, tabSwipeDirection(from)!) !== null;
        settle(from, 0, following ? drag.vx : 0, () => {
          main.style.willChange = "";
          hidePreview();
          side = 0;
          busy.current = false;
        });
      },
    });
  }, [on, page, pathname, reset, hidePreview]);

  return (
    <div
      ref={layer}
      aria-hidden
      // The tab beside, while a swipe drags (RV-12): under the bars, over nothing else.
      className="pointer-events-none fixed top-0 z-30 h-dvh overflow-hidden bg-background"
      style={{ display: "none" }}
    >
      <div ref={skeleton} className="space-y-5 px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <h1 ref={title} className={K_TITLE} />
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-36 w-full rounded-[20px]" />
        <Skeleton className="h-28 w-full rounded-[20px]" />
      </div>
      <div ref={host} />
    </div>
  );
}
