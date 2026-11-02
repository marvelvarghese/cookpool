/**
 * Cookpool's navigation model (CP-5): the bottom tabs below 900px, the
 * sidebar from 900px, and the "+ Add" sheet. Dependency-free (no React, no
 * icons: icons are lucide names the renderer resolves) so the items and the
 * active-tab matching are unit-testable.
 */

export type KitchenTabId = "home" | "pantry" | "add" | "groups" | "people";

export interface KitchenNavLink {
  id: Exclude<KitchenTabId, "add">;
  kind: "link";
  href: string;
  label: string;
  icon: string;
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
  { id: "pantry", kind: "link", href: "/pantry", label: "Pantry", icon: "Refrigerator" },
  { id: "add", kind: "action", label: "Add", icon: "Plus" },
  { id: "groups", kind: "link", href: "/groups", label: "Groups", icon: "UsersRound" },
  { id: "people", kind: "link", href: "/people", label: "People", icon: "HandCoins" },
];

/** The sidebar's links: the tabs without the Add action (the sidebar has its own buttons). */
export const KITCHEN_NAV_LINKS: readonly KitchenNavLink[] = KITCHEN_TABS.filter(
  (t): t is KitchenNavLink => t.kind === "link",
);

// Paths that belong to a tab besides its own: opening a join link and settling
// up (a group's money, or every group's) are part of Groups.
const EXTRA_PREFIXES: Partial<Record<KitchenNavLink["id"], readonly string[]>> = {
  groups: ["/join", "/settle"],
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

// ── The sidebar's "Me" (SI-6) ─────────────────────────────────────

/** A sidebar link: the tabs' links, and "Me". */
export interface KitchenSidebarLink {
  id: KitchenNavLink["id"] | "you";
  href: string;
  label: string;
  icon: string;
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
  label: string;
  hint: string;
  /**
   * Where it goes once the feature exists. With `pickGroup`, a template whose
   * `[slug]` is the group the person picks first (`groupActionHref`).
   */
  href: string;
  icon: string;
  /** False until the feature ships: the tile shows "Soon" and does nothing. */
  live: boolean;
  /** Pick a group first (in the sheet), then go to `href` for it. */
  pickGroup?: boolean;
}

/** An action's destination for the group `slug` (its `[slug]` filled in). */
export function groupActionHref(action: Pick<AddAction, "href">, slug: string): string {
  return action.href.replace("[slug]", encodeURIComponent(slug));
}

/**
 * "What happened?" — the four big tiles. "I paid a bill" is live since the
 * ledger screens (CP-8): it asks which group, then opens Add expense there.
 * "I bought food" is live since the pantry screens (CP-12): Add an item picks
 * the pantry itself. "I used something" is live since quick use (CP-13):
 * /use searches every pantry. "I cooked" is live since the dish maker
 * (CP-15): /cook takes from any pantry.
 */
export const ADD_TILES: readonly AddAction[] = [
  {
    id: "use",
    label: "I used something",
    hint: "From any pantry you share",
    href: "/use",
    icon: "Utensils",
    live: true,
  },
  {
    id: "cook",
    label: "I cooked",
    hint: "Share a dish and its cost",
    href: "/cook",
    icon: "CookingPot",
    live: true,
  },
  {
    id: "buy",
    label: "I bought food",
    hint: "Add it to a pantry",
    href: "/pantry/new",
    icon: "ShoppingBasket",
    live: true,
  },
  {
    id: "bill",
    label: "I paid a bill",
    hint: "Split it in a group",
    href: "/groups/[slug]/expense",
    icon: "Receipt",
    live: true,
    pickGroup: true,
  },
];

/** The two secondary actions under the tiles. */
export const ADD_SECONDARY: readonly AddAction[] = [
  {
    id: "payment",
    label: "Record a payment",
    hint: "Someone paid you back",
    href: "/settle",
    icon: "Wallet",
    live: true,
  },
  {
    id: "invite",
    label: "Invite to a group",
    hint: "Share a group's join link",
    href: "/groups",
    icon: "UserPlus",
    live: true,
  },
];
