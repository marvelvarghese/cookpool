import type { SubjectOrganization } from "@saas/contracts/membership";
import type { Uuid } from "@saas/db/ids";
import { parseOrgPublicId } from "./ids.js";
import { GROUP_ROLES } from "./roster-client.js";

// Every group a person is in, from membership-worker's service-internal
// route (GET /v1/internal/membership/subjects/:subjectId/organizations).
// The all-pantries view and search read every pantry the caller can reach:
// their own, and each group's. One fetch per person per request: the answer
// is cached on the request's context, like the roster.

/** One group someone is in, holding a group role. */
export interface MemberGroup {
  /** The stored UUID (kitchen rows are keyed by it). */
  orgId: Uuid;
  /** The `org_…` id the API uses. */
  publicId: string;
  slug: string;
  name: string;
  /** owner | admin | builder | viewer. */
  role: string;
}

export type GroupsResult = { ok: true; groups: MemberGroup[] } | { ok: false };

/**
 * The group roles whose grant holds `kitchen.item.use` (design.md §6): every
 * role but viewer. The cross-pantry reads say from this which items the
 * caller may use (`canUse`, `usable=1`) without a policy hop per group; every
 * write still asks the policy engine. tests/kitchen-worker pins it against the
 * engine's grants.
 */
export const USE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "builder"]);

/** May someone with this membership use the group's items? */
export function canUseIn(group: Pick<MemberGroup, "role">): boolean {
  return USE_ROLES.has(group.role);
}

export interface Groups {
  /** The groups `subjectId` is an active member of with a group role, by name. */
  of(subjectId: string): Promise<GroupsResult>;
}

function isSubjectOrganization(value: unknown): value is SubjectOrganization {
  if (!value || typeof value !== "object") return false;
  const org = value as Record<string, unknown>;
  return (
    typeof org.orgId === "string" && typeof org.slug === "string" && typeof org.name === "string" &&
    (org.role === null || typeof org.role === "string")
  );
}

async function fetchGroups(membershipWorker: Fetcher, subjectId: string, requestId: string): Promise<GroupsResult> {
  let response: Response;
  try {
    response = await membershipWorker.fetch(
      `http://membership-worker/v1/internal/membership/subjects/${encodeURIComponent(subjectId)}/organizations`,
      { method: "GET", headers: { "x-request-id": requestId } },
    );
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false };
  }
  const organizations = (parsed as { data?: { organizations?: unknown } } | null)?.data?.organizations;
  if (!Array.isArray(organizations)) return { ok: false };

  const groups: MemberGroup[] = [];
  for (const org of organizations) {
    // billing_admin, or no organization role at all, is not part of a group's kitchen (design.md §6).
    if (!isSubjectOrganization(org) || org.role === null || !GROUP_ROLES.has(org.role)) continue;
    const orgId = parseOrgPublicId(org.orgId);
    if (!orgId) continue;
    groups.push({ orgId, publicId: org.orgId, slug: org.slug, name: org.name, role: org.role });
  }
  return { ok: true, groups };
}

/** A groups reader for one request; a missing binding reads as a failed fetch. */
export function createGroups(membershipWorker: Fetcher | undefined, requestId: string): Groups {
  const cache = new Map<string, Promise<GroupsResult>>();
  return {
    of(subjectId) {
      let pending = cache.get(subjectId);
      if (!pending) {
        pending = membershipWorker ? fetchGroups(membershipWorker, subjectId, requestId) : Promise.resolve({ ok: false });
        cache.set(subjectId, pending);
      }
      return pending;
    },
  };
}
