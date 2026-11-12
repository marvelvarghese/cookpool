// The hidden two-person group of two friends (cookpool-spliteco SE1, design
// §0.5).
//
//   POST /v1/internal/membership/direct-groups
//     { subjects: [{ id, type }, { id, type }] }
//     → 201 { organization, created: true } | 200 { organization, created: false }
//
// Service-internal: spliteco-worker calls it, over a service binding only,
// after checking that the two share a group. An expense between friends
// outside any group still lives in a group: this one, `kind = 'direct'`,
// `made_in = 'spliteco'`, with both as owners. The same pair always gets the
// same organization: its slug is `direct-` and a hash of the two ids, and the
// public route refuses every `direct-` slug (create-organization.ts). It is
// never listed (list-organizations.ts, the default internal view), never
// joinable by code (join.ts) and never counted toward the open-groups cap.
//
// Find or make: the organization and its first owner land in one batch
// (bootstrapOrganization), the second owner in a join; a retry after a
// half-made pair finds the organization and adds whoever is missing.

import type { Env } from "../env.js";
import type { DirectGroupRequest, DirectGroupResponse } from "@saas/contracts/membership";
import { createSqlExecutor } from "@saas/db/d1";
import { createMembershipRepository, type MembershipRepository, type Organization } from "@saas/db/membership";
import { asUuid } from "@saas/db/ids";
import { errorResponse, successResponse, validationError } from "../http.js";
import { orgPublicId } from "../ids.js";

export const DIRECT_GROUPS_PATH = "/v1/internal/membership/direct-groups";

const SUBJECT_ID_RE = /^[A-Za-z0-9][\w-]{0,127}$/;

/** The pair's slug: `direct-` and the first 40 hex of SHA-256 over the two ids, sorted. */
export async function directSlug(a: string, b: string): Promise<string> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${lo}|${hi}`));
  const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `direct-${hex.slice(0, 40)}`;
}

type Repo = Pick<
  MembershipRepository,
  "getOrganizationBySlug" | "bootstrapOrganization" | "getActiveMemberBySubject" | "joinOrganization"
>;

function body(org: Organization, created: boolean): DirectGroupResponse {
  return {
    organization: {
      orgId: orgPublicId(org.id),
      slug: org.slug,
      name: org.name,
      madeIn: org.madeIn ?? "spliteco",
      kind: org.kind ?? "direct",
    },
    created,
  };
}

export async function handleDirectGroup(
  request: Request,
  env: Env,
  requestId: string,
  deps?: { repo: Repo; now?: () => Date },
): Promise<Response> {
  let input: DirectGroupRequest;
  try {
    input = (await request.json()) as DirectGroupRequest;
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
  }
  const subjects = Array.isArray(input?.subjects) ? input.subjects : [];
  const valid =
    subjects.length === 2 &&
    subjects.every((s) => s && typeof s.id === "string" && SUBJECT_ID_RE.test(s.id) && typeof s.type === "string" && s.type.length > 0);
  if (!valid || subjects[0]!.id === subjects[1]!.id) {
    return validationError(requestId, { subjects: ["Two different people"] });
  }
  if (!deps && !env.PLATFORM_DB) return errorResponse("internal_error", "Service unavailable", 503, requestId);

  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo: Repo = deps ? deps.repo : createMembershipRepository(executor!);
    const now = deps?.now ? deps.now() : new Date();
    const [first, second] = subjects as [{ id: string; type: string }, { id: string; type: string }];
    const slug = await directSlug(first.id, second.id);

    let org: Organization;
    let created = false;
    const found = await repo.getOrganizationBySlug(slug);
    if (found.ok) {
      org = found.value;
      // A squatted slug (the public route refuses them, but belt and braces).
      if (org.kind !== "direct" || org.status !== "active") {
        return errorResponse("conflict", "Direct group unavailable", 409, requestId, { reason: "direct_slug_taken" });
      }
    } else if (found.error.kind === "not_found") {
      const orgId = asUuid(crypto.randomUUID());
      const made = await repo.bootstrapOrganization({
        org: { id: orgId, name: "Outside groups", slug, slugLower: slug, parentOrgId: null, madeIn: "spliteco", kind: "direct", createdAt: now },
        member: { id: crypto.randomUUID(), orgId, subjectId: first.id, subjectType: first.type, createdAt: now },
        roleAssignment: {
          id: crypto.randomUUID(),
          orgId,
          subjectId: first.id,
          subjectType: first.type,
          role: "owner",
          scopeKind: "organization",
          scopeRef: null,
          createdAt: now,
        },
      });
      if (!made.ok) {
        // Made by a concurrent call: read it back.
        const again = await repo.getOrganizationBySlug(slug);
        if (!again.ok) return errorResponse("internal_error", "Service unavailable", 503, requestId);
        org = again.value;
      } else {
        org = made.value.org;
        created = true;
      }
    } else {
      return errorResponse("internal_error", "Service unavailable", 503, requestId);
    }

    // Both are owners; add whoever is missing (a first call that stopped half-way).
    for (const subject of [first, second]) {
      const member = await repo.getActiveMemberBySubject(asUuid(org.id), subject.id);
      if (member.ok) continue;
      if (member.error.kind !== "not_found") return errorResponse("internal_error", "Service unavailable", 503, requestId);
      const joined = await repo.joinOrganization({
        orgId: asUuid(org.id),
        memberId: crypto.randomUUID(),
        roleAssignmentId: crypto.randomUUID(),
        subjectId: subject.id,
        subjectType: subject.type,
        role: "owner",
        joinedAt: new Date(now.getTime() + 1),
      });
      if (!joined.ok && joined.error.kind !== "conflict") {
        return errorResponse("internal_error", "Service unavailable", 503, requestId);
      }
    }
    return successResponse(body(org, created), requestId, created ? 201 : 200);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}
