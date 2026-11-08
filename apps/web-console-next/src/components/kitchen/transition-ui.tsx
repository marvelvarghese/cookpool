"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { newFrame } from "@/lib/features";
import { transitions, type ShareSource, type TransitionKind } from "@/lib/transitions";
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

/**
 * The frame's half of the transitions, mounted once by the kitchen layout in
 * the new frame (after `BackTrailRecorder`, whose counts it reads):
 *  - it hands the Link the router;
 *  - it says when a pathname has rendered (`committed`), which ends the wait
 *    of the step in flight;
 *  - it animates the browser's own back and forward (`popstate`, the system
 *    back on Android), unless the browser animates it itself — and holds the
 *    new page until the old one is captured (`gateFor`), since Next restores
 *    it right after the event.
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

  // The history entry of the page shown: a pop compares its count with the one it lands on.
  const shownState = React.useRef<unknown>(null);
  React.useEffect(() => {
    shownState.current = window.history.state;
    transitions.committed(pathname);
  }, [pathname]);

  React.useEffect(() => {
    // In the capture phase: before Next's own listener restores the screen.
    const onPop = (event: PopStateEvent) => {
      const from = transitions.shown() ?? window.location.pathname;
      const direction = popDirection(shownState.current, event.state);
      transitions.pop({
        kind: transitionKind(from, window.location.pathname, { newFrame: newFrame(), direction }),
        from,
        uaTransition: event.hasUAVisualTransition === true,
      });
    };
    window.addEventListener("popstate", onPop, { capture: true });
    return () => window.removeEventListener("popstate", onPop, { capture: true });
  }, []);

  return null;
}
