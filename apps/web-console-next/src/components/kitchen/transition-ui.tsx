"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { POPSTATE_HOOK } from "@/lib/app-shell";
import { newFrame } from "@/lib/features";
import { normalizePath, transitions, type ShareSource, type TransitionKind } from "@/lib/transitions";
import { trailStamp } from "./back";
import { popDirection, transitionKind, type Direction } from "./transitions";

/**
 * Page transitions in the frame (cookpool-recipes RC-11, design §1.6): the
 * one way the kitchen navigates — the kitchen `Link` (link.tsx),
 * `useKitchenRouter()` for the pushes after a save, and the Back controls —
 * and `PageTransitions`, which the kitchen layout mounts in the new frame
 * only. The kind of a step is transitions.ts's; the animation is
 * lib/transitions.ts's and globals.css's.
 */

type AppRouter = ReturnType<typeof useRouter>;

// The frame's router while `PageTransitions` is up (the new frame): the Link
// needs it to navigate on its own. Null otherwise, and the Link is next/link.
let frameRouter: AppRouter | null = null;

/** Whether the frame's transitions are up: the new frame's layout is mounted. */
export function transitionsReady(): boolean {
  return frameRouter !== null;
}

export interface NavigateOptions {
  /** Replace the history entry instead of pushing one. */
  replace?: boolean | undefined;
  /** Scroll to the top on arrival (the router's own default, true). */
  scroll?: boolean | undefined;
  /** The step's kind, when the caller knows better than the route model. */
  kind?: TransitionKind | null | undefined;
  /** The known direction: a Back control's "replace with the parent" is back. */
  direction?: Direction | undefined;
  /** The tapped card's parts that travel (the Link's `share`). */
  share?: ShareSource | null | undefined;
}

function go(router: AppRouter, href: string, opts: NavigateOptions): void {
  const from = window.location.pathname;
  const kind = opts.kind !== undefined ? opts.kind : transitionKind(from, href, { newFrame: newFrame(), direction: opts.direction });
  const scroll = opts.scroll === undefined ? undefined : { scroll: opts.scroll };
  transitions.navigate({
    kind,
    from,
    share: opts.share,
    run: () => (opts.replace ? router.replace(href, scroll) : router.push(href, scroll)),
  });
}

/**
 * Navigates to `href` with its transition, by the frame's router (the
 * kitchen Link's way). False, and nothing done, while the frame's
 * transitions are not up.
 */
export function navigate(href: string, opts: NavigateOptions = {}): boolean {
  if (!frameRouter) return false;
  go(frameRouter, href, opts);
  return true;
}

/** What a kitchen screen navigates with: next/navigation's router, each step with its transition. */
export interface KitchenRouter {
  push(href: string, opts?: Omit<NavigateOptions, "replace">): void;
  replace(href: string, opts?: Omit<NavigateOptions, "replace">): void;
  /** The history's back: back, or down out of the cooking session. */
  back(): void;
  forward(): void;
  refresh(): void;
  prefetch: AppRouter["prefetch"];
}

/**
 * `useRouter()`, with every push, replace and back through the transitions:
 * in the new frame each one animates by its kind; anywhere else (or with
 * nothing to animate, as a query that changes) it is exactly the router's.
 */
export function useKitchenRouter(): KitchenRouter {
  const router = useRouter();
  return React.useMemo<KitchenRouter>(
    () => ({
      push: (href, opts = {}) => go(router, href, { ...opts, replace: false }),
      replace: (href, opts = {}) => go(router, href, { ...opts, replace: true }),
      back() {
        const from = window.location.pathname;
        transitions.navigate({ kind: transitionKind(from, null, { newFrame: newFrame() }), from, pops: true, run: () => router.back() });
      },
      forward: () => router.forward(),
      refresh: () => router.refresh(),
      prefetch: router.prefetch,
    }),
    [router],
  );
}

// ── The browser's back and forward ────────────────────────────────

// Where each history entry this page load has shown was scrolled to. While
// the frame animates the browser's back and forward, their scroll is the
// frame's (`scrollRestoration` "manual"): the browser would restore it right
// after the event, onto the old page, before the old page is captured.
const scrolls = new Map<string, number>();
let entryKey: string | null = null;
let popped = false;
let ownScroll = false;

/** An entry, as the scroll memory keys it: the trail's count and the address. */
function entryKeyOf(state: unknown): string {
  return `${trailStamp(state) ?? "-"} ${window.location.pathname}${window.location.search}`;
}

/**
 * The frame's half of the transitions, mounted once by the kitchen layout in
 * the new frame (after `BackTrailRecorder`, whose counts it reads):
 *  - it hands the Link the router;
 *  - it says when a pathname has rendered (`committed`), which ends the wait
 *    of the step in flight;
 *  - it animates the browser's own back and forward (`popstate`: the system
 *    back on Android, a browser's back button), unless the browser animates
 *    it itself. It sees the event first (the shell script's listener, before
 *    Next's), and holds the new page until the old one is captured
 *    (`gateFor`), since React renders Next's restore inside the event;
 *  - where it animates them, it restores their scroll itself, before the new
 *    page is captured; elsewhere (iOS in a tab) the browser's stays.
 */
export function PageTransitions() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  // A back or forward of the browser's: render the new page only once the old one is captured.
  const gate = transitions.gateFor(pathname);
  if (gate) React.use(gate);

  React.useEffect(() => {
    frameRouter = router;
    return () => {
      if (frameRouter === router) frameRouter = null;
    };
  }, [router]);

  // The entry shown, and after a back or forward its scroll, before anything paints it.
  React.useLayoutEffect(() => {
    entryKey = entryKeyOf(window.history.state);
    if (!popped) return;
    popped = false;
    if (ownScroll) window.scrollTo(0, scrolls.get(entryKey) ?? 0);
  }, [pathname]);

  // The history entry of the page shown: a pop compares its count with the one it lands on.
  const shownState = React.useRef<unknown>(null);
  React.useEffect(() => {
    shownState.current = window.history.state;
    transitions.committed(pathname);
  }, [pathname]);

  React.useEffect(() => {
    const hooks = window as unknown as Record<string, unknown>;
    const onPop = (event: PopStateEvent) => {
      const from = transitions.shown() ?? window.location.pathname;
      popped = normalizePath(from) !== normalizePath(window.location.pathname);
      const direction = popDirection(shownState.current, event.state);
      transitions.pop({
        kind: transitionKind(from, window.location.pathname, { newFrame: newFrame(), direction }),
        from,
        uaTransition: event.hasUAVisualTransition === true,
      });
    };
    hooks[POPSTATE_HOOK] = onPop;

    const remember = () => {
      if (entryKey !== null) scrolls.set(entryKey, window.scrollY);
    };
    window.addEventListener("scroll", remember, { passive: true });
    const manual = () => {
      window.history.scrollRestoration = "manual";
    };
    const auto = () => {
      window.history.scrollRestoration = "auto";
    };
    ownScroll = transitions.ownsTraversals();
    if (ownScroll) {
      manual();
      // A reload or a page from the back-forward cache keeps the browser's own.
      window.addEventListener("pagehide", auto);
      window.addEventListener("pageshow", manual);
    }
    return () => {
      if (hooks[POPSTATE_HOOK] === onPop) delete hooks[POPSTATE_HOOK];
      window.removeEventListener("scroll", remember);
      if (ownScroll) {
        auto();
        window.removeEventListener("pagehide", auto);
        window.removeEventListener("pageshow", manual);
      }
      ownScroll = false;
    };
  }, []);

  return null;
}
