/**
 * Where the kitchen's gestures are on (cookpool-app PW-7, design §5). No
 * React, so the rules are unit-tested: which screens pull to refresh, and
 * where swiping from the left edge goes back. The numbers and the finger
 * itself are `lib/gestures.ts`; the screens' parts are gestures-ui.tsx.
 */

import { staticPageFor } from "@/lib/static-pages.mjs";
import { INSTALLED_DISPLAY_MODES, isIos } from "@/lib/install";
import { backParent } from "./back";

/**
 * The screens that pull to refresh: the lists and the pages you read (Home,
 * Pantry, Groups, a group, People, a person, a dish), by SM-2's page
 * patterns. Not the forms (Use, Bought, Cook, Add a bill, a group's
 * Settings), where a pull would only throw away what was typed, nor You,
 * an item, a join link or `/settle`. Their twin: every read refreshes when
 * the app comes back to the foreground.
 */
export const PULL_PAGES: readonly string[] = [
  "/home",
  "/pantry",
  "/groups",
  "/groups/:orgSlug",
  "/people",
  "/people/:subjectId",
  "/dishes/:dishRef",
  // The new frame's Money (cookpool-recipes RC-2): your people and groups.
  "/money",
];

/** Whether the screen at `pathname` pulls to refresh. */
export function pullsToRefresh(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const page = staticPageFor(pathname);
  return page !== null && PULL_PAGES.includes(page);
}

/** What the edge swipe asks of the device. */
export interface EdgeSwipeEnv {
  userAgent: string;
  /** `navigator.maxTouchPoints`: an iPad asking for desktop sites says "Macintosh". */
  maxTouchPoints: number;
  /** Running as the installed app: a `display-mode` of one, or iOS's `navigator.standalone`. */
  standalone: boolean;
}

/**
 * The device swipes back from the edge only as the installed app on an
 * iPhone (or iPad): it has no back gesture of its own there. Android has the
 * system back gesture, and Safari in the browser has its own swipe.
 */
export function edgeSwipeDevice(env: EdgeSwipeEnv): boolean {
  return env.standalone && isIos(env.userAgent, env.maxTouchPoints);
}

/**
 * Whether a swipe from the left edge goes back on the screen at `pathname`:
 * on such a device, on every screen with a back control (PW-3's
 * `backParent`), never on the tabs — the new frame's five in the new frame
 * (cookpool-recipes RC-2).
 */
export function edgeSwipeBackOn(env: EdgeSwipeEnv, pathname: string | null | undefined, newFrame = false): boolean {
  if (!pathname || !edgeSwipeDevice(env)) return false;
  return backParent(pathname, {}, { newFrame }) !== null;
}

/** The device, as the edge swipe sees it (call it in an effect: the pages are prerendered). */
export function readEdgeSwipeEnv(): EdgeSwipeEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone =
    INSTALLED_DISPLAY_MODES.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches === true) || nav.standalone === true;
  return { userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints ?? 0, standalone };
}
