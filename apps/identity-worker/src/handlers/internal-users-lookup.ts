// People by id, for sibling workers (Cookpool CP-9).
//
//   POST /v1/internal/identity/users/lookup   { subjectIds: ["usr_…", …] }
//     → { users: [{ subjectId, displayName, email }] }
//
// Service-internal, like membership-worker's /v1/internal/membership/… routes:
// reached over a service binding only — api-edge routes nothing under
// /v1/internal/, and forwards only its listed /v1/auth/… paths here. The
// caller has already decided who may see these people (kitchen-worker asks
// only for members of groups the asking person is in); this answers "what are
// they called". Ids that are malformed or unknown are left out, so a caller
// shows its own fallback for them. A POST, not a GET: a group's ids do not fit
// a URL comfortably, and the body keeps them out of access logs.

import type { Env } from "../env.js";
import type { IdentityRepository } from "@saas/db/identity";
import { USERS_LOOKUP_MAX, type UserSummary, type UsersLookupResponse } from "@saas/contracts/auth";
import { createSqlExecutor } from "@saas/db/d1";
import { createIdentityRepository } from "@saas/db/identity";
import { createTimings } from "@saas/contracts/timing";
import { errorResponse, successResponse, validationError, withTimings } from "../http.js";
import { parseUserPublicId } from "../ids.js";

export interface UsersLookupDeps {
  repo: Pick<IdentityRepository, "getUserById">;
}

/** The ids to read, deduplicated in the order given; a string of field errors when the body is wrong. */
function parseSubjectIds(body: unknown): string[] | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Must be a JSON object";
  const raw = (body as { subjectIds?: unknown }).subjectIds;
  if (!Array.isArray(raw) || raw.length === 0) return "Must be a non-empty array of user ids";
  if (raw.some((id) => typeof id !== "string")) return "Every id must be a string";
  const unique = [...new Set(raw as string[])];
  if (unique.length > USERS_LOOKUP_MAX) return `At most ${USERS_LOOKUP_MAX} ids`;
  return unique;
}

export async function handleInternalUsersLookup(
  request: Request,
  env: Env,
  requestId: string,
  deps?: UsersLookupDeps,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return validationError(requestId, { body: ["Must be a valid JSON object"] });
  }
  const subjectIds = parseSubjectIds(body);
  if (typeof subjectIds === "string") return validationError(requestId, { subjectIds: [subjectIds] });

  if (!deps && !env.PLATFORM_DB) return errorResponse("internal_error", "Service unavailable", 503, requestId);
  const executor = deps ? null : createSqlExecutor(env.PLATFORM_DB!);
  const timings = createTimings();
  const endTotal = timings.start("total");
  try {
    const repo = deps ? deps.repo : createIdentityRepository(executor!);
    // One primary-key read per person, side by side: a group is tens of
    // people, and a read that fails reads as an unknown person.
    const found = await timings.measure("db", () =>
      Promise.all(
        subjectIds.map(async (subjectId): Promise<UserSummary | null> => {
          const uuid = parseUserPublicId(subjectId);
          if (!uuid) return null;
          const user = await repo.getUserById(uuid.toLowerCase());
          if (!user.ok) return null;
          return { subjectId, displayName: user.value.displayName, email: user.value.email };
        }),
      ),
    );
    endTotal();
    const users = found.filter((u): u is UserSummary => u !== null);
    return withTimings(
      successResponse<UsersLookupResponse>({ users }, requestId),
      requestId,
      "identity.internal.users_lookup.post",
      timings,
    );
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}
