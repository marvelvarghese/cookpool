/**
 * The neighbour tab's preview while a tab swipe drags (cookpool-revamp RV-12).
 *
 * Why a snapshot, not the live page: the five tabs are static pages that the
 * router renders one at a time. Mounting a second live tab under the finger
 * means mounting its whole React tree (its queries, effects and layout) in
 * the first frames of the drag, which is exactly where a mid-range phone
 * drops frames; navigating early would do the same, plus a view transition
 * and a scroll reset mid-gesture. A snapshot is a detached copy of the tab's
 * `<main>`, taken when the person was last on it at an idle moment (and as
 * they leave it), so during the drag the browser only moves two composited
 * layers. Once the settle finishes, the real tab opens (`router.push`) and
 * replaces the copy in the same frame. A tab not seen yet this visit shows
 * its title over the frame's skeleton instead.
 *
 * Browser-only, and kept small: the rules are tab-swipe.ts's.
 */

import { normalizePath } from "@/lib/transitions";
import { TAB_SWIPE_ORDER } from "./tab-swipe";

/** The kitchen's `<main>` (the layout's `id`). */
export const KITCHEN_MAIN_ID = "kitchen-main";

const snapshots = new Map<string, HTMLElement>();

/** The tab root at `pathname`, or null when it is not one of the five. */
function tabOf(pathname: string): string | null {
  const p = normalizePath(pathname);
  return TAB_SWIPE_ORDER.includes(p) ? p : null;
}

/**
 * Copies `<main>` as the tab at `pathname` looks now, for a later swipe to
 * show. Ids are dropped (the copy sits beside the page) and so are the
 * swipe's own inline styles. Nothing off the tabs' roots.
 */
export function rememberTab(pathname: string | null | undefined): void {
  if (typeof document === "undefined" || !pathname) return;
  const tab = tabOf(pathname);
  const main = document.getElementById(KITCHEN_MAIN_ID);
  if (!tab || !main || main.childElementCount === 0) return;
  const copy = main.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  copy.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    el.style.viewTransitionName = "";
  });
  copy.style.cssText = "margin:0;width:100%;max-width:none;";
  copy.setAttribute("aria-hidden", "true");
  snapshots.set(tab, copy);
}

/** The copy of `tab`'s page, if it has been seen this visit. */
export function tabSnapshot(tab: string): HTMLElement | null {
  return snapshots.get(normalizePath(tab)) ?? null;
}

/** Remembers the shown tab once the page is idle (after `delayMs`); returns how to stop. */
export function rememberWhenIdle(pathname: string, delayMs = 900): () => void {
  if (typeof window === "undefined" || !tabOf(pathname)) return () => undefined;
  let idle: number | null = null;
  const timer = window.setTimeout(() => {
    const run = () => rememberTab(pathname);
    if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run, { timeout: 1500 });
    else run();
  }, delayMs);
  return () => {
    window.clearTimeout(timer);
    if (idle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
  };
}
