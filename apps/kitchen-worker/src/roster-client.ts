import type { RosterMember } from "@saas/contracts/membership";
import type { Uuid } from "@saas/db/ids";

// Who is in a group, from membership-worker's service-internal roster
// (GET /v1/internal/membership/organizations/:orgId/members). Money can only
// name people in the group: an expense's payers and participants, both sides
// of a payment. One fetch per group per request: the roster is cached on the
// request's context, so a handler can ask as often as it reads clearly.

/** The roles that make someone part of a group's kitchen. billing_admin is not one (design.md §6). */
export const GROUP_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "builder", "viewer"]);

export type RosterResult = { ok: true; members: RosterMember[] } | { ok: false };

export interface Roster {
  /** The group's active members holding a group role, oldest first. */
  members(orgId: Uuid): Promise<RosterResult>;
}

async function fetchRoster(membershipWorker: Fetcher, orgId: Uuid, requestId: string): Promise<RosterResult> {
  let response: Response;
  try {
    response = await membershipWorker.fetch(
      `http://membership-worker/v1/internal/membership/organizations/${orgId}/members`,
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
  const members = (parsed as { data?: { members?: unknown } } | null)?.data?.members;
  if (!Array.isArray(members)) return { ok: false };

  const valid = members.filter(
    (m): m is RosterMember =>
      !!m && typeof m === "object" && typeof (m as RosterMember).subjectId === "string" &&
      typeof (m as RosterMember).subjectType === "string",
  );
  return { ok: true, members: valid.filter((m) => m.role !== null && GROUP_ROLES.has(m.role)) };
}

/** A roster reader for one request; a missing binding reads as a failed fetch. */
export function createRoster(membershipWorker: Fetcher | undefined, requestId: string): Roster {
  const cache = new Map<string, Promise<RosterResult>>();
  return {
    members(orgId) {
      let pending = cache.get(orgId);
      if (!pending) {
        pending = membershipWorker ? fetchRoster(membershipWorker, orgId, requestId) : Promise.resolve({ ok: false });
        cache.set(orgId, pending);
      }
      return pending;
    },
  };
}

/** The subject ids in `named` that are not in the group, each once, in the order named. */
export function notInGroup(members: readonly RosterMember[], named: readonly string[]): string[] {
  const inGroup = new Set(members.map((m) => m.subjectId));
  return [...new Set(named)].filter((id) => !inGroup.has(id));
}
