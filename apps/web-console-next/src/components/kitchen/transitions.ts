/**
 * The kind of each step between screens (cookpool-recipes RC-11, design
 * §1.6), from the route model the frame already has: the five tabs
 * (`nav.ts`), the cooking session's path, and how deep a screen sits under
 * its tab (PW-3's `backParent`). No React, so every rule is unit-tested; the
 * mechanics are `lib/transitions.ts`, the frame's parts transition-ui.tsx.
 *
 *  - **tab**: between two of the five tabs, or from a screen of one tab to
 *    another tab's root (the tab bar). Tabs are peers: a quick cross-fade.
 *  - **forward**: deeper (a list → a recipe, a recipe → its plan or edit), or
 *    across at the same depth. The new screen slides in from the right.
 *  - **back**: the reverse — a Back control, `router.back()`, the system's
 *    back on Android, a save that returns to its parent, a tab's own root
 *    from a screen under it.
 *  - **up**: into the cooking session (`/cook/session`): it rises like a sheet.
 *  - **down**: out of it (minimize, Finish, Discard): it slides down.
 *
 * Only in the new frame, and only between the app's own screens: with
 * `newFrame()` false, or to sign-in, the admin console or the same screen
 * (a query that changes), there is none, and the navigation is today's.
 */

import { NEW_FRAME_TABS, activeNewFrameTab } from "./nav";
import { NEW_FRAME_TAB_PAGES, SCREENS_WITH_PARENT, backParent, trailStamp } from "./back";
import { SESSION_PATH } from "./cook-session";
import { normalizePath, type TransitionKind } from "@/lib/transitions";
import { staticPageFor } from "@/lib/static-pages.mjs";

/** Which way the history moved, when it is known (a Back control: back; the trail's counts on a pop). */
export type Direction = "back" | "forward";

/** The five tabs' roots (`nav.ts`): `/home`, `/pantry`, `/cook`, `/money`, `/you`. */
export const TAB_ROOTS: readonly string[] = NEW_FRAME_TABS.map((t) => t.href);

/** Whether a pathname is one of the five tabs' roots. */
export function isTabRoot(pathname: string): boolean {
  return TAB_ROOTS.includes(normalizePath(pathname));
}

/** One of the app's own screens in the new frame: a tab, or a screen with a parent. */
export function isAppScreen(pathname: string): boolean {
  const page = staticPageFor(normalizePath(pathname));
  return page !== null && (NEW_FRAME_TAB_PAGES.includes(page) || SCREENS_WITH_PARENT.includes(page));
}

/**
 * How deep a screen sits under its tab: how many Backs to reach a tab's root,
 * by the parent map (`backParent`, the new frame's). A tab is 0, a recipe 1
 * (Cook), its plan or edit 2, a group's Add a bill 2 (the group, Money).
 */
export function routeDepth(pathname: string): number {
  let path = normalizePath(pathname);
  for (let depth = 0; depth < 8; depth++) {
    const parent = backParent(path, {}, { newFrame: true });
    if (parent === null) return depth;
    path = normalizePath(parent);
  }
  return 8;
}

/**
 * The kind of a step from the screen at `from` to the one at `to` (null: the
 * history's back, wherever it lands). Null when nothing should animate:
 * another frame, the same screen, or a page outside the app.
 *
 * In order: the cooking session rises (up) and falls (down); two tabs are
 * peers (tab); a known direction is that direction (a Back control, the
 * trail's counts on a pop); a tab's root from a screen of another tab is a
 * tab switch (the tab bar); otherwise deeper is forward and shallower back,
 * and the same depth (a recipe from Explore) forward.
 */
export function transitionKind(
  from: string,
  to: string | null,
  opts: { newFrame: boolean; direction?: Direction | undefined },
): TransitionKind | null {
  if (!opts.newFrame || !isAppScreen(from)) return null;
  const a = normalizePath(from);
  if (to === null) return a === SESSION_PATH ? "down" : "back";
  if (!isAppScreen(to)) return null;
  const b = normalizePath(to);
  if (a === b) return null;
  if (b === SESSION_PATH) return "up";
  if (a === SESSION_PATH) return "down";
  const aTab = isTabRoot(a);
  const bTab = isTabRoot(b);
  if (aTab && bTab) return "tab";
  if (opts.direction) return opts.direction;
  if (bTab && activeNewFrameTab(a) !== activeNewFrameTab(b)) return "tab";
  return routeDepth(b) < routeDepth(a) ? "back" : "forward";
}

/**
 * Which way a `popstate` went, from the trail's counts (PW-3's `cookpoolBack`
 * on each entry): fewer screens behind the one it lands on is back, more is
 * forward. Unknown when either entry carries none.
 */
export function popDirection(leftState: unknown, landedState: unknown): Direction | undefined {
  const left = trailStamp(leftState);
  const landed = trailStamp(landedState);
  if (left === null || landed === null || left === landed) return undefined;
  return landed < left ? "back" : "forward";
}

// ── The kitchen Link's click ──────────────────────────────────────

/** The part of a click the Link reads (React's `MouseEvent`, or a fake in tests). */
export interface LinkClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  currentTarget: { getAttribute(name: string): string | null };
  nativeEvent?: { which?: number | undefined } | undefined;
}

export interface LinkClickContext {
  /** `newFrame()`. */
  newFrame: boolean;
  /** The frame's transitions are up (`PageTransitions` has the router). */
  ready: boolean;
  /** The browser has `startViewTransition`. */
  supported: boolean;
  /** Where the page is now. */
  location: { href: string; origin: string; pathname: string };
}

/**
 * Whether a click on a kitchen Link becomes a transition: only a plain
 * primary click on a link to one of the app's other screens, in the new
 * frame, where the browser can animate. Otherwise (null) next/link does as it
 * always does: a modifier or middle click, `target`, `download`, another
 * origin or a link Next would not handle stays the browser's; the same
 * screen, another frame or no API navigates at once.
 */
export function linkTransition(click: LinkClick, href: unknown, ctx: LinkClickContext): { href: string; kind: TransitionKind } | null {
  if (click.defaultPrevented || !ctx.newFrame || !ctx.ready || !ctx.supported) return null;
  if (typeof href !== "string") return null;
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (click.nativeEvent?.which === 2) return null;
  const target = click.currentTarget.getAttribute("target");
  if (target && target !== "_self") return null;
  if (click.currentTarget.getAttribute("download") !== null) return null;
  let url: URL;
  try {
    url = new URL(href, ctx.location.href);
  } catch {
    return null;
  }
  if (url.origin !== ctx.location.origin) return null;
  const kind = transitionKind(ctx.location.pathname, url.pathname, { newFrame: ctx.newFrame });
  return kind ? { href, kind } : null;
}
