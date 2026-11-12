// Open groups (Cookpool CP-2) — the membership-worker side of running as many
// small, independent groups instead of one company with sub-orgs.
//
// Cookpool maps every group (a flat, an office lunch club, a trip) to one
// organization, and a person belongs to many. The baseline's MO2 gate treats a
// person's *earliest* organization as the billing parent of every organization
// they create afterwards, and asks that parent's plan for `feature.multi_org`.
// For friend groups that is wrong twice over: the earliest organization may be
// someone else's group the person joined, and no group should be billed through
// another. So under OPEN_GROUPS an additional group is always created
// standalone, with only a per-person cap as a guard against abuse.
//
// A deploy-time var like SOLO_MODE: "true" turns it on; anything else keeps
// the baseline's billing-parent behaviour.

import type { Env } from "./env.js";

/** The most groups one person may belong to at once (created or joined). */
export const MAX_GROUPS_PER_PERSON = 50;

export function isOpenGroups(env: Env): boolean {
  return env.OPEN_GROUPS === "true";
}

/**
 * The hidden two-person groups friends share expenses in outside any group
 * (cookpool-spliteco, `kind = 'direct'`) are not groups anyone chose to join,
 * so they never count toward the cap (risk SE-H).
 */
export function countsTowardCap(orgs: readonly { kind?: string }[]): number {
  return orgs.filter((org) => org.kind !== "direct").length;
}

/** A direct group is never listed, joined by code or made through the public route. */
export function isDirectGroup(org: { kind?: string }): boolean {
  return org.kind === "direct";
}
