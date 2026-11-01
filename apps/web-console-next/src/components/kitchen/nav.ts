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

// Paths that belong to a tab besides its own: opening a join link is part of
// Groups.
const EXTRA_PREFIXES: Partial<Record<KitchenNavLink["id"], readonly string[]>> = {
  groups: ["/join"],
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

// ── The "+ Add" sheet ─────────────────────────────────────────────

export interface AddAction {
  id: string;
  label: string;
  hint: string;
  /** Where it goes once the feature exists. */
  href: string;
  icon: string;
  /** False until the feature ships: the tile shows "Soon" and does nothing. */
  live: boolean;
}

/** "What happened?" — the four big tiles. None of their features has shipped yet. */
export const ADD_TILES: readonly AddAction[] = [
  {
    id: "use",
    label: "I used something",
    hint: "From any pantry you share",
    href: "/use",
    icon: "Utensils",
    live: false,
  },
  {
    id: "cook",
    label: "I cooked",
    hint: "Share a dish and its cost",
    href: "/cook",
    icon: "CookingPot",
    live: false,
  },
  {
    id: "buy",
    label: "I bought food",
    hint: "Add it to a pantry",
    href: "/pantry/new",
    icon: "ShoppingBasket",
    live: false,
  },
  {
    id: "bill",
    label: "I paid a bill",
    hint: "Split it in a group",
    href: "/groups?expense=1",
    icon: "Receipt",
    live: false,
  },
];

/** The two secondary actions under the tiles. */
export const ADD_SECONDARY: readonly AddAction[] = [
  {
    id: "payment",
    label: "Record a payment",
    hint: "Someone paid you back",
    href: "/groups?settle=1",
    icon: "Wallet",
    live: false,
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
