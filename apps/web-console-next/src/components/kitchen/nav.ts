/**
 * Cookpool's navigation model (CP-5): the bottom tabs below 900px, the
 * sidebar from 900px, and the "+ Add" sheet. Dependency-free (no React, no
 * icons: icons are lucide names the renderer resolves) so the items and the
 * active-tab matching are unit-testable.
 */

export type KitchenTabId = "home" | "pantry" | "add" | "groups" | "people" | "cook" | "money" | "you";

export interface KitchenNavLink {
  id: Exclude<KitchenTabId, "add">;
  kind: "link";
  href: string;
  label: string;
  icon: string;
  /** The new frame's Cook (RC-2): its icon sits in a filled green rounded square. */
  featured?: boolean;
}

/** The centre "+ Add" tab: opens the Add sheet instead of navigating. */
export interface KitchenNavAction {
  id: "add";
  kind: "action";
  label: string;
  icon: string;
}

export type KitchenNavItem = KitchenNavLink | KitchenNavAction;

/** The bottom tab bar, in order: Home · Pantry · + Add · Groups · People. */
export const KITCHEN_TABS: readonly KitchenNavItem[] = [
  { id: "home", kind: "link", href: "/home", label: "Home", icon: "House" },
  { id: "pantry", kind: "link", href: "/pantry", label: "Kitchen", icon: "Refrigerator" },
  { id: "add", kind: "action", label: "Add", icon: "Plus" },
  { id: "groups", kind: "link", href: "/groups", label: "Groups", icon: "UsersRound" },
  { id: "people", kind: "link", href: "/people", label: "People", icon: "HandCoins" },
];

/** The sidebar's links: the tabs without the Add action (the sidebar has its own buttons). */
export const KITCHEN_NAV_LINKS: readonly KitchenNavLink[] = KITCHEN_TABS.filter(
  (t): t is KitchenNavLink => t.kind === "link",
);

// Paths that belong to a tab besides its own: opening a join link is part of
// Groups; settling up is People's since SM-11 (`/settle` opens People).
const EXTRA_PREFIXES: Partial<Record<KitchenNavLink["id"], readonly string[]>> = {
  groups: ["/join"],
  people: ["/settle"],
};

function underPrefix(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The tab a pathname belongs to: a tab's own path or anything under it
 * (`/groups/flat-4b` is Groups, `/pantry/new` is Pantry), never a sibling
 * prefix (`/groupsx`). Pages reached from the Add sheet (`/use`, `/cook`)
 * belong to no tab.
 */
export function activeKitchenTab(pathname: string | null | undefined): KitchenNavLink["id"] | null {
  if (!pathname) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const link of KITCHEN_NAV_LINKS) {
    const prefixes = [link.href, ...(EXTRA_PREFIXES[link.id] ?? [])];
    if (prefixes.some((p) => underPrefix(p, path))) return link.id;
  }
  return null;
}

export function isKitchenTabActive(id: KitchenTabId, pathname: string | null | undefined): boolean {
  return id !== "add" && activeKitchenTab(pathname) === id;
}

// ── The new frame's five tabs (cookpool-recipes RC-2, design §1.2) ─

/**
 * The new frame (`newFrame()`, everywhere but prod): Home · Pantry · Cook ·
 * Money · You, a bottom bar on phones and the sidebar from 900px. Cook sits
 * in the middle with a filled icon; the + tab goes (each tab's main action
 * sits at its top: Bought on Pantry, Bill and Settle up on Money).
 */
export const NEW_FRAME_TABS: readonly KitchenNavLink[] = [
  { id: "home", kind: "link", href: "/home", label: "Home", icon: "House" },
  { id: "pantry", kind: "link", href: "/pantry", label: "Kitchen", icon: "Refrigerator" },
  { id: "cook", kind: "link", href: "/cook", label: "Cook", icon: "CookingPot", featured: true },
  { id: "money", kind: "link", href: "/money", label: "Money", icon: "Wallet" },
  { id: "you", kind: "link", href: "/you", label: "You", icon: "CircleUserRound" },
];

/** The phone's tabs in a frame: today's five (with + Add) or the new frame's. */
export function kitchenTabs(newFrame: boolean): readonly KitchenNavItem[] {
  return newFrame ? NEW_FRAME_TABS : KITCHEN_TABS;
}

// Paths that belong to a new-frame tab besides its own. Use is Home's first
// field; a dish, and the recipe and session screens still to come, are
// cooking; people, settling up and groups are money (design §1.3: money
// lives in Money). Community lives in Cook (cookpool-community CM-5, design
// §4): the feed, people search, Activity, a profile (`/u/…`) and a post (`/p/…`).
const NEW_FRAME_PREFIXES: Partial<Record<KitchenNavLink["id"], readonly string[]>> = {
  home: ["/use"],
  cook: ["/dishes", "/recipes", "/explore", "/r", "/community", "/u", "/p"],
  money: ["/people", "/settle", "/groups", "/join"],
  // The consent page an assistant opens (cookpool-mcp MC-4) is You's, beside Connected assistants.
  you: ["/connect"],
};

/** The new frame's tab a pathname belongs to: a tab's own path or under it, or one of its extra prefixes. */
export function activeNewFrameTab(pathname: string | null | undefined): KitchenNavLink["id"] | null {
  if (!pathname) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const link of NEW_FRAME_TABS) {
    const prefixes = [link.href, ...(NEW_FRAME_PREFIXES[link.id] ?? [])];
    if (prefixes.some((p) => underPrefix(p, path))) return link.id;
  }
  return null;
}

/** Whether a tab is the current page's, in a frame (never + Add). */
export function isTabActiveIn(newFrame: boolean, id: KitchenTabId, pathname: string | null | undefined): boolean {
  if (id === "add") return false;
  return newFrame ? activeNewFrameTab(pathname) === id : isKitchenTabActive(id, pathname);
}

// ── Pushed screens without the tab bar (cookpool-revamp RV-19) ───

/**
 * The new frame's pushed screens that the boards draw without the floating
 * tab bar (RvItem, RvRecipe, RvCookStep, RvCooked, RvGroups): an item's page
 * (`/pantry/<ref>`, not Add item or the shopping run), a recipe's page
 * (`/recipes/<id>`, not New recipe), the cooking session, guided or tick
 * (`/cook/session`), Cooked! (a dish's page with `?cooked=1`, until its Done
 * drops the parameter) and the Groups list (`/groups`). Each has its own Back,
 * and its bottom bar sits at the screen's bottom instead
 * (`--cp-bottom-bar`, globals.css). Today's frame always shows its bar.
 */
const TAB_BAR_HIDDEN: readonly RegExp[] = [
  /^\/pantry\/(?!(?:new|run)$)[^/]+$/,
  /^\/recipes\/(?!new$)[^/]+$/,
  /^\/cook\/session$/,
  /^\/groups$/,
];

/** The query that turns a dish's page into Cooked! (cooked.ts's `COOKED_PARAM`). */
const COOKED_DISH = /^\/dishes\/[^/]+$/;

/** Whether the new frame hides its tab bar on this screen (`search` is the query, with or without "?"). */
export function tabBarHidden(newFrame: boolean, pathname: string | null | undefined, search?: string | null): boolean {
  if (!newFrame || !pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (TAB_BAR_HIDDEN.some((re) => re.test(path))) return true;
  return COOKED_DISH.test(path) && new URLSearchParams(search ?? "").get("cooked") === "1";
}

// ── The sidebar's "Me" (SI-6) ─────────────────────────────────────

/** A sidebar link: the tabs' links, and "Me". */
export interface KitchenSidebarLink {
  id: KitchenNavLink["id"] | "you";
  href: string;
  label: string;
  icon: string;
  /** The new frame's Cook: its icon in a filled green rounded square. */
  featured?: boolean;
}

/**
 * The sidebar's links (from 900px): Home · Pantry · Groups · People, then
 * "Me", which opens You (design §7, the web artboards' "Me"). The phone tab
 * bar is unchanged: there, Home's avatar opens You.
 */
export const KITCHEN_SIDEBAR_LINKS: readonly KitchenSidebarLink[] = [
  ...KITCHEN_NAV_LINKS,
  { id: "you", href: "/you", label: "Me", icon: "CircleUserRound" },
];

/** The sidebar's links in a frame: today's (with "Me"), or the new frame's five tabs. */
export function sidebarLinks(newFrame: boolean): readonly KitchenSidebarLink[] {
  return newFrame ? NEW_FRAME_TABS : KITCHEN_SIDEBAR_LINKS;
}

/** Whether a sidebar link is the current page's: "Me" on /you, the rest as their tabs. */
export function isSidebarLinkActive(id: KitchenSidebarLink["id"], pathname: string | null | undefined): boolean {
  if (id !== "you") return isKitchenTabActive(id, pathname);
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return underPrefix("/you", path);
}

// ── Page width (CP-23) ────────────────────────────────────────────

/**
 * Pages laid out in three columns from 1280px (design §7's web pages): Home
 * (balance · needs you · recent) and Groups (groups · activity · balances).
 * They take the room beside the sidebar; every other page keeps the
 * one-to-two-column width.
 */
const WIDE_PAGES: readonly string[] = ["/home", "/groups"];

export function isWideKitchenPage(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return WIDE_PAGES.includes(path);
}

// ── The "+ Add" sheet ─────────────────────────────────────────────

export interface AddAction {
  id: string;
  /** The tile's one word or two (SM-10, the canvas): "Used", "Paid a bill". */
  label: string;
  /**
   * Where it goes. With `pickGroup`, a template whose `[slug]` is the group
   * the person picks first (`groupActionHref`).
   */
  href: string;
  icon: string;
  /** Pick a group first (in the sheet), then go to `href` for it. */
  pickGroup?: boolean;
}

/** An action's destination for the group `slug` (its `[slug]` filled in). */
export function groupActionHref(action: Pick<AddAction, "href">, slug: string): string {
  return action.href.replace("[slug]", encodeURIComponent(slug));
}

/**
 * The + Add sheet (SM-10): the four things that happen, as big tiles, and
 * nothing else — "Do it again" is Home's row of usuals and Use's recents,
 * paying back is People's, inviting is the group's. Used opens /use (any
 * pantry); Cooked, /cook; Bought, Add an item (it picks the pantry); Paid a
 * bill asks which group, then opens Add a bill there.
 */
export const ADD_TILES: readonly AddAction[] = [
  { id: "use", label: "Used", href: "/use", icon: "Utensils" },
  { id: "cook", label: "Cooked", href: "/cook", icon: "CookingPot" },
  { id: "buy", label: "Bought", href: "/pantry/new", icon: "ShoppingBasket" },
  { id: "bill", label: "Paid a bill", href: "/groups/[slug]/expense", icon: "Receipt", pickGroup: true },
];
