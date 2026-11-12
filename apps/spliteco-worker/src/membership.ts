import {
  SUBJECT_ORGANIZATIONS_SPLITECO_VIEW,
  type DirectGroupResponse,
  type SubjectOrganization,
} from "@saas/contracts/membership";
import type { SplitecoGroupKind, SplitecoMadeIn } from "@saas/contracts/spliteco";
import type { Uuid } from "@saas/db/ids";
import type { ActorContext } from "./context.js";
import { parseOrgPublicId } from "./ids.js";

// Everything Spliteco asks membership-worker, over its service binding:
//   - a person's groups with their members (`?view=spliteco`, one call per
//     person per request, cached): Home, Groups, Friend, Insights and the
//     member checks on every write read from it;
//   - make a Spliteco group (the public POST /v1/organizations, as the caller);
//   - find or make the hidden two-person group of two friends.

/** The roles that make someone part of a group (billing_admin is not one), as in kitchen-worker. */
export const GROUP_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "builder", "viewer"]);

/**
 * The roles whose grant holds `spliteco.expense.write` — every group role but
 * viewer. Reads across groups use this to say `canWrite` without a policy hop
 * per group; every write still asks the policy engine. tests/spliteco-worker
 * pins it against the engine's grants.
 */
export const WRITE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "builder"]);

export interface MemberGroup {
  orgId: Uuid;
  publicId: string;
  name: string;
  slug: string;
  role: string;
  madeIn: SplitecoMadeIn;
  kind: SplitecoGroupKind;
  /** Members holding a group role. */
  members: { subjectId: string; role: string }[];
}

export type GroupsResult = { ok: true; groups: MemberGroup[] } | { ok: false };

export interface Groups {
  of(subjectId: string): Promise<GroupsResult>;
}

function toGroup(org: SubjectOrganization): MemberGroup | null {
  if (org.role === null || !GROUP_ROLES.has(org.role)) return null;
  const orgId = parseOrgPublicId(org.orgId);
  if (!orgId) return null;
  return {
    orgId,
    publicId: org.orgId,
    name: org.name,
    slug: org.slug,
    role: org.role,
    madeIn: (org.madeIn === "spliteco" ? "spliteco" : "cookpool") as SplitecoMadeIn,
    kind: (org.kind ?? "kitchen") as SplitecoGroupKind,
    members: (org.members ?? [])
      .filter((m): m is { subjectId: string; subjectType: string; role: string } => m.role !== null && GROUP_ROLES.has(m.role))
      .map((m) => ({ subjectId: m.subjectId, role: m.role })),
  };
}

async function fetchGroups(membership: Fetcher, subjectId: string, requestId: string): Promise<GroupsResult> {
  try {
    const response = await membership.fetch(
      `http://membership-worker/v1/internal/membership/subjects/${encodeURIComponent(subjectId)}/organizations?view=${SUBJECT_ORGANIZATIONS_SPLITECO_VIEW}`,
      { method: "GET", headers: { "x-request-id": requestId } },
    );
    if (!response.ok) return { ok: false };
    const parsed = (await response.json()) as { data?: { organizations?: unknown } } | null;
    const organizations = parsed?.data?.organizations;
    if (!Array.isArray(organizations)) return { ok: false };
    const groups: MemberGroup[] = [];
    for (const org of organizations as SubjectOrganization[]) {
      if (!org || typeof org.orgId !== "string" || typeof org.name !== "string") continue;
      const group = toGroup(org);
      if (group) groups.push(group);
    }
    return { ok: true, groups };
  } catch {
    return { ok: false };
  }
}

export function createGroups(membership: Fetcher | undefined, requestId: string): Groups {
  const cache = new Map<string, Promise<GroupsResult>>();
  return {
    of(subjectId) {
      let pending = cache.get(subjectId);
      if (!pending) {
        pending = membership ? fetchGroups(membership, subjectId, requestId) : Promise.resolve({ ok: false });
        cache.set(subjectId, pending);
      }
      return pending;
    },
  };
}

export type CreateOrgResult =
  | { ok: true; orgPublicId: string; name: string }
  | { ok: false; status: number; body: unknown };

/** POST /v1/organizations as the caller, made in Spliteco. Membership's refusals (the cap) pass through. */
export async function createOrganization(
  membership: Fetcher,
  actor: ActorContext,
  requestId: string,
  input: { name: string; kind: string },
): Promise<CreateOrgResult> {
  const response = await membership.fetch("http://membership-worker/v1/organizations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-actor-subject-id": actor.subjectId,
      "x-actor-subject-type": actor.subjectType,
    },
    body: JSON.stringify({ name: input.name, madeIn: "spliteco", kind: input.kind }),
  });
  const body = (await response.json().catch(() => null)) as { data?: { organization?: { id?: string; name?: string } } } | null;
  const org = body?.data?.organization;
  if (!response.ok || !org?.id) return { ok: false, status: response.status, body };
  return { ok: true, orgPublicId: org.id, name: org.name ?? input.name };
}

/** Find or make the two friends' hidden group. Null on any failure. */
export async function directGroup(
  membership: Fetcher,
  requestId: string,
  a: { id: string; type: string },
  b: { id: string; type: string },
): Promise<DirectGroupResponse | null> {
  try {
    const response = await membership.fetch("http://membership-worker/v1/internal/membership/direct-groups", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify({ subjects: [a, b] }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: DirectGroupResponse };
    return body.data?.organization?.orgId ? body.data : null;
  } catch {
    return null;
  }
}
