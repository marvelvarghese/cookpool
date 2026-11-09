/**
 * Back, everywhere (cookpool-app PW-3, design §2 "Without browser chrome").
 * An installed app has no browser back button, so every screen that is not a
 * tab has one back control in its header (`BackButton`, back-ui.tsx). It goes
 * back when the app has history of its own behind the screen, and otherwise
 * replaces the screen with its parent: a screen opened straight from a link,
 * a home-screen shortcut, a join link, an email or a notification has nothing
 * to go back to, and `history.back()` would leave the app (or do nothing,
 * installed). No React here, so both rules — the parent map and "has the app
 * history of its own" — are unit-tested.
 */

import { STATIC_PAGES, matchPage, staticPageFor } from "@/lib/static-pages.mjs";
import { PERSONAL_PANTRY, parseItemRef } from "./pantry";

// ── The parent map ────────────────────────────────────────────────

/** The tabs (+ Add is a sheet): they have no back control and no parent. */
export const TAB_PAGES: readonly string[] = ["/home", "/pantry", "/groups", "/people"];

/** The new frame's tabs (cookpool-recipes RC-2): Home · Pantry · Cook · Money · You. */
export const NEW_FRAME_TAB_PAGES: readonly string[] = ["/home", "/pantry", "/cook", "/money", "/you"];

/** Where a screen's parent is when nothing on its address says (an unknown screen). */
export const DEFAULT_PARENT = "/home";

/** What a screen knows once it has loaded, that its address does not say. */
export interface BackKnown {
  /** A dish's group (its slug), when the dish is shared and the group is known. */
  groupSlug?: string | null;
}

type ParentRule = (params: Record<string, string>, known: BackKnown) => string;

/**
 * Every non-tab screen's parent, by page (static-pages.mjs's patterns; the
 * params are as the address spells them, still percent-encoded).
 */
const PARENTS: Readonly<Record<string, ParentRule>> = {
  // From the + Add sheet and the home-screen shortcuts: Home.
  "/use": () => "/home",
  "/cook": () => "/home",
  "/pantry/new": () => "/home",
  // The shopping run (cookpool-pantry PN-6): the Pantry's + Bought opens it.
  "/pantry/run": () => "/pantry",
  // Home's avatar opens You.
  "/you": () => "/home",
  // You → Notifications (PW-6): You.
  "/you/notifications": () => "/you",
  // The new frame's pages (RC-2), for a visitor of today's frame: Money sends them Home; settings is You's.
  "/money": () => "/home",
  "/you/settings": () => "/you",
  // The cooking session (RC-6): minimize goes to the Cook tab when nothing of the app's is behind it.
  "/cook/session": () => "/cook",
  // The recipe screens (RC-5): a recipe and a new one are Cook's; editing one goes back to it.
  "/recipes/new": () => "/cook",
  "/recipes/:recipeId": () => "/cook",
  "/recipes/:recipeId/edit": ({ recipeId }) => `/recipes/${recipeId}`,
  // The plan (cookpool-guided GC-6): the recipe it is the plan of.
  "/recipes/:recipeId/plan": ({ recipeId }) => `/recipes/${recipeId}`,
  // Recipes travel (RC-8): Explore and a recipe's link page are Cook's.
  "/explore": () => "/cook",
  "/r/:code": () => "/cook",
  // Community (cookpool-community CM-5): the feed is Cook's; search,
  // Activity, a profile and a post go back to it. HandleSetup and blocked
  // people are You's; blocked people go back to HandleSetup, its link.
  "/community": () => "/cook",
  "/community/search": () => "/community",
  "/community/activity": () => "/community",
  "/u/:handle": () => "/community",
  "/p/:postId": () => "/community",
  "/you/profile": () => "/you",
  "/you/blocked": () => "/you/profile",
  // Your assistant, connected (cookpool-mcp MC-4): both are You's.
  "/connect": () => "/you",
  "/you/assistants": () => "/you",
  // You → Cookpool AI (cookpool-ai AI-7): Settings, its row.
  "/you/ai": () => "/you/settings",
  // An item: Pantry, on the item's own pantry.
  "/pantry/:itemRef": ({ itemRef }) => itemParent(itemRef),
  // Its stock check (cookpool-pantry PN-7): the item.
  "/pantry/:itemRef/check": ({ itemRef }) => `/pantry/${itemRef}`,
  // A dish: its group when it is shared (and the group is known), else Home.
  "/dishes/:dishRef": (_, known) => (known.groupSlug ? `/groups/${encodeURIComponent(known.groupSlug)}` : "/home"),
  // A group: Groups; its Settings and Add a bill: the group.
  "/groups/:orgSlug": () => "/groups",
  "/groups/:orgSlug/settings": ({ orgSlug }) => `/groups/${orgSlug}`,
  "/groups/:orgSlug/expense": ({ orgSlug }) => `/groups/${orgSlug}`,
  // A join link: Groups.
  "/join/:code": () => "/groups",
  // A person: People. (`/settle` only opens People.)
  "/people/:subjectId": () => "/people",
  "/settle": () => "/people",
};

/**
 * The new frame's parents where they differ (RC-2): Groups and People are
 * reached from Money (money lives in Money), settings from You's gear.
 */
const NEW_FRAME_PARENTS: Readonly<Record<string, ParentRule>> = {
  "/groups": () => "/money",
  "/groups/:orgSlug": () => "/money",
  "/join/:code": () => "/money",
  "/people": () => "/money",
  "/people/:subjectId": () => "/money",
  "/settle": () => "/money",
  "/you/notifications": () => "/you/settings",
};

/** The Cookpool screens that have a parent (every page of the app that is not a tab). */
export const SCREENS_WITH_PARENT: readonly string[] = Object.keys(PARENTS);

/** Pages of STATIC_PAGES outside the app's frame: sign-in, the OAuth return and the entry page. */
export const OUTSIDE_THE_APP: readonly string[] = STATIC_PAGES.filter(
  (p) => !TAB_PAGES.includes(p) && !SCREENS_WITH_PARENT.includes(p),
);

function itemParent(raw: string | undefined): string {
  const ref = parseItemRef(raw);
  if (!ref) return "/pantry";
  const pantry = ref.kind === "personal" ? PERSONAL_PANTRY : ref.orgId;
  return `/pantry?pantry=${encodeURIComponent(pantry)}`;
}

/**
 * The screen a back control replaces this one with when the app has no
 * history of its own behind it: a dish → its group if shared, else Home; an
 * item → Pantry; a group's Settings and Add a bill → the group; a group and a
 * join link → Groups; a person → People; Use, Bought, Cook and You → Home.
 * Null for a tab (it has no back control); Home for an address it does not
 * know.
 *
 * In the new frame (`frame.newFrame`, RC-2) the tabs are the new five, and
 * Groups, People and a person go back to Money.
 */
export function backParent(
  pathname: string | null | undefined,
  known: BackKnown = {},
  frame: { newFrame?: boolean } = {},
): string | null {
  if (!pathname) return DEFAULT_PARENT;
  const page = staticPageFor(pathname);
  const tabs = frame.newFrame ? NEW_FRAME_TAB_PAGES : TAB_PAGES;
  if (page && tabs.includes(page)) return null;
  const rule = page ? ((frame.newFrame ? NEW_FRAME_PARENTS[page] : undefined) ?? PARENTS[page]) : undefined;
  if (!page || !rule) return DEFAULT_PARENT;
  return rule(matchPage(page, pathname) ?? {}, known);
}

// ── Has the app history of its own? ───────────────────────────────

/**
 * How many of the app's own screens are behind this one in the tab's
 * history: the count Back reads (`hasAppHistory`). Kept by the app's frame
 * (back-ui.tsx) from the router's own steps, and written on each history
 * entry (`stampedState`) so a back, a forward or a reload onto it knows its
 * count again:
 *  - `open`: the frame shows its first screen — opened from outside (a link,
 *    a shortcut, a notification, after sign-in), so nothing is behind it, or
 *    a reload of a screen whose entry carries its count;
 *  - `push`: one more screen behind the next one;
 *  - `replace`: the same count (Back's own "replace with the parent" is one,
 *    so the parent is no more "in the app's history" than the screen was);
 *  - `pop`: the browser's back or forward landed on an entry: its count, or 0
 *    when it carries none.
 * When in doubt the count is lower, never higher: too low only sends Back to
 * the parent (still in the app); too high would send `history.back()` out of it.
 */
export type TrailStep =
  | { kind: "open"; stamp: number | null }
  | { kind: "push" }
  | { kind: "replace" }
  | { kind: "pop"; stamp: number | null };

export function followTrail(depth: number, step: TrailStep): number {
  switch (step.kind) {
    case "open":
    case "pop":
      return step.stamp ?? 0;
    case "push":
      return depth + 1;
    case "replace":
      return depth;
  }
}

/** Whether Back goes back (one of the app's own screens is behind this one) or to the parent. */
export function hasAppHistory(depth: number): boolean {
  return depth > 0;
}

/** The key the count is kept under in a history entry's state (beside Next's own). */
export const TRAIL_STAMP_KEY = "cookpoolBack";

/** The count a history entry's state carries, or null. */
export function trailStamp(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[TRAIL_STAMP_KEY];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A history entry's state with the count added, everything else (Next's tree) kept. */
export function stampedState(state: unknown, depth: number): Record<string, unknown> {
  const base = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  return { ...base, [TRAIL_STAMP_KEY]: depth };
}

/** The part of `window.history` the trail keeps (a fake in tests). */
export interface TrailHistory {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface Trail {
  /** The app's frame is up: count from the screen it shows first. */
  start(): void;
  /** The frame is gone (sign-in, the admin console): stop counting. */
  stop(): void;
  /** The browser's back or forward landed on an entry with this state. */
  pop(state: unknown): void;
  /** Whether Back goes back (`hasAppHistory`) rather than to the parent. */
  canGoBack(): boolean;
}

/**
 * The trail of one page load. Next's router writes every navigation with
 * `history.pushState` or `history.replaceState`, so the trail wraps the two
 * (once, passing everything through, as Next itself wraps them): while the
 * frame is up, a push counts one more and a replace keeps the count, and the
 * entry written carries its count beside Next's state. Nothing else changes:
 * with the frame down, the calls pass through untouched.
 */
export function createTrail(history: TrailHistory): Trail {
  let depth = 0;
  let active = false;
  let wrapped = false;

  const wrap = () => {
    if (wrapped) return;
    wrapped = true;
    const push = history.pushState;
    const replace = history.replaceState;
    history.pushState = (data, unused, url) => {
      if (active) {
        depth = followTrail(depth, { kind: "push" });
        data = stampedState(data, depth);
      }
      push.call(history, data, unused, url);
    };
    history.replaceState = (data, unused, url) => {
      if (active) {
        depth = followTrail(depth, { kind: "replace" });
        data = stampedState(data, depth);
      }
      replace.call(history, data, unused, url);
    };
  };

  return {
    start() {
      wrap();
      active = true;
      depth = followTrail(depth, { kind: "open", stamp: trailStamp(history.state) });
      // Stamp the first screen too, so a back or forward onto it knows it.
      try {
        history.replaceState(history.state, "");
      } catch {
        // Too many history calls (Safari's limit): the count is kept, the stamp is not.
      }
    },
    stop() {
      active = false;
    },
    pop(state) {
      if (active) depth = followTrail(depth, { kind: "pop", stamp: trailStamp(state) });
    },
    canGoBack() {
      return active && hasAppHistory(depth);
    },
  };
}
