/**
 * The Groups model (Cookpool CP-5): searching, sorting and "recent" for the
 * person's groups, roles, and the new-group form's options. Pure and
 * dependency-free (types only) so it is unit-testable.
 *
 * A group is a baseline organization; the list API returns id, name, slug and
 * createdAt, so those are what sorting can use. Your role and the member count
 * come from the kitchen's cross-group read (`myBalances`, CP-9).
 * "Recent" is the order the person last opened groups on this device.
 */

import type { WastePolicy } from "@saas/contracts/kitchen";
import { formatMinor } from "./money";

export interface GroupLike {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export type GroupSort = "recent" | "az";

export const GROUP_SORTS: readonly { id: GroupSort; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "az", label: "A–Z" },
];

/** Lower-case, accents stripped, whitespace collapsed: the form names are matched in. */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Groups whose name contains every word of `query`, in any order and case
 * ("4b flat" finds "Flat 4B"). An empty query keeps every group. The input
 * order is preserved.
 */
export function filterGroups<T extends GroupLike>(groups: readonly T[], query: string): T[] {
  const words = foldForSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...groups];
  return groups.filter((g) => {
    const name = foldForSearch(g.name);
    return words.every((w) => name.includes(w));
  });
}

/**
 * Sort groups. `az`: by name (case- and accent-insensitive, numbers in
 * numeric order), then slug. `recent`: the groups in `recentSlugs` first, in
 * that order, then the rest newest first. Never mutates the input.
 */
export function sortGroups<T extends GroupLike>(
  groups: readonly T[],
  sort: GroupSort,
  recentSlugs: readonly string[] = [],
): T[] {
  const byName = (a: T, b: T): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) ||
    a.slug.localeCompare(b.slug);

  if (sort === "az") return [...groups].sort(byName);

  const rank = new Map(recentSlugs.map((slug, i) => [slug, i] as const));
  return [...groups].sort((a, b) => {
    const ra = rank.get(a.slug);
    const rb = rank.get(b.slug);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return b.createdAt.localeCompare(a.createdAt) || byName(a, b);
  });
}

/** The sidebar's "Recent groups": the first `limit` in recent order. */
export function recentGroups<T extends GroupLike>(
  groups: readonly T[],
  recentSlugs: readonly string[],
  limit = 4,
): T[] {
  return sortGroups(groups, "recent", recentSlugs).slice(0, limit);
}

/** Record a visit: `slug` moves to the front, duplicates drop, at most `max` kept. */
export function pushRecentSlug(list: readonly string[], slug: string, max = 12): string[] {
  if (!slug) return [...list].slice(0, max);
  return [slug, ...list.filter((s) => s !== slug)].slice(0, max);
}

/** Two letters for a group's avatar: "Flat 4B" → "F4", "lunch" → "LU". */
export function groupInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

// ── Roles ──────────────────────────────────────────────────────────

/** A person's role in a group as the app names it ("member" is the baseline's `builder`). */
export type GroupRole = "owner" | "admin" | "member" | "viewer";

const ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, builder: 2, viewer: 1 };
const ROLE_OF: Record<string, GroupRole> = {
  owner: "owner",
  admin: "admin",
  builder: "member",
  viewer: "viewer",
};

/**
 * The strongest organization-scope role in a member's assignments
 * (`PublicMember.roles`), or null when there is none the app knows.
 */
export function roleFromAssignments(
  roles: readonly { role: string; scopeKind: string }[],
): GroupRole | null {
  let best: string | null = null;
  for (const r of roles) {
    if (r.scopeKind !== "organization" || !(r.role in ROLE_RANK)) continue;
    if (best === null || ROLE_RANK[r.role]! > ROLE_RANK[best]!) best = r.role;
  }
  return best ? ROLE_OF[best]! : null;
}

/**
 * A role as the kitchen API names it (`owner`, `admin`, `builder`, `viewer`:
 * `myBalances().groups[].role`, a group's members) in the app's words; null
 * for anything else.
 */
export function roleFromKitchen(role: string | null | undefined): GroupRole | null {
  return role && Object.hasOwn(ROLE_OF, role) ? ROLE_OF[role]! : null;
}

/** Viewers read a group but write nothing in it: no expenses, payments, undo or flags. */
export function canWriteInGroup(role: GroupRole | null): boolean {
  return role !== null && role !== "viewer";
}

export function roleLabel(role: GroupRole): string {
  return { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" }[role];
}

/** Owners and admins manage the join link and the group's rules. */
export function canManageGroup(role: GroupRole | null): boolean {
  return role === "owner" || role === "admin";
}

// ── Leaving with a balance (CP-23) ─────────────────────────────────

export interface LeaveBalance {
  /** "You owe ₹45.75 in Flat 4B", "Flat 4B owes you ₹86.50", "Your balance in Flat 4B isn't zero". */
  title: string;
  /** What to do about it, in one sentence. */
  body: string;
  /** Settle up, on this group. */
  settleHref: string;
}

/**
 * Leaving is refused while your balance in the group isn't zero (CP-19's 409
 * `balance_not_settled`, with `balanceMinor` — positive: you are owed — and
 * `currency`). Says how much and which way, from the refusal's details (or,
 * before trying, from the balance the page has); without an amount, just
 * that it isn't zero.
 */
export function leaveBalance(
  group: { name: string; slug: string },
  balance: { balanceMinor?: unknown; currency?: unknown } | null | undefined,
): LeaveBalance {
  const settleHref = `/settle?group=${encodeURIComponent(group.slug)}`;
  const minor = typeof balance?.balanceMinor === "number" && Number.isInteger(balance.balanceMinor) ? balance.balanceMinor : null;
  const currency = typeof balance?.currency === "string" && balance.currency ? balance.currency : "INR";
  if (minor === null || minor === 0) {
    return {
      title: `Your balance in ${group.name} isn't zero`,
      body: "Settle up first: you can leave once nobody owes anybody between you and the group.",
      settleHref,
    };
  }
  const amount = formatMinor(Math.abs(minor), currency);
  return minor < 0
    ? { title: `You owe ${amount} in ${group.name}`, body: "Settle up first: once it's paid and recorded, you can leave.", settleHref }
    : {
        title: `${group.name} owes you ${amount}`,
        body: "Settle up first: once you're paid back (or undo what you logged), you can leave.",
        settleHref,
      };
}

// ── New group ──────────────────────────────────────────────────────

export const GROUP_NAME_MAX = 60;

/** An error for the name field, or null when the (trimmed) name is fine. */
export function validateGroupName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Give the group a name";
  if (name.length > GROUP_NAME_MAX) return `Keep it under ${GROUP_NAME_MAX} characters`;
  return null;
}

/**
 * The slug a new group is created with. Slugs are unique across everyone's
 * groups and "Flat 4B" is a common name, so a random suffix is always added
 * (`flat-4b-k3x9`); a name with no Latin letters or digits becomes `group-…`.
 * Fits the server's rule: 2–63 characters of [a-z0-9-], alphanumeric ends.
 */
export function groupSlug(name: string, suffix: string): string {
  const tail = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x";
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "group";
  return `${base}-${tail}`;
}

/** Currencies offered for a new group; INR first and the default. */
export const GROUP_CURRENCIES: readonly { code: string; label: string }[] = [
  { code: "INR", label: "Indian rupee (INR)" },
  { code: "USD", label: "US dollar (USD)" },
  { code: "EUR", label: "Euro (EUR)" },
  { code: "GBP", label: "British pound (GBP)" },
  { code: "AED", label: "UAE dirham (AED)" },
  { code: "SGD", label: "Singapore dollar (SGD)" },
  { code: "AUD", label: "Australian dollar (AUD)" },
  { code: "CAD", label: "Canadian dollar (CAD)" },
];

export const WASTE_RULES: readonly { id: WastePolicy; label: string; hint: string }[] = [
  {
    id: "split_equally",
    label: "Split equally",
    hint: "Food that goes off is shared by everyone in the group.",
  },
  {
    id: "buyer_absorbs",
    label: "The buyer absorbs it",
    hint: "Whoever bought it pays for what goes to waste.",
  },
];

export function wasteRuleLabel(policy: WastePolicy): string {
  return WASTE_RULES.find((r) => r.id === policy)?.label ?? policy;
}
