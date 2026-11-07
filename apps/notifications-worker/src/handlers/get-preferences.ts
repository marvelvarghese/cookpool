import type { Env } from "../env.js";
import type { GetNotificationPreferencesResponse } from "@saas/contracts/notifications";
import { createSqlExecutor } from "@saas/db/d1";
import { createNotificationsRepository, type NotificationsRepository } from "@saas/db/notifications";
import { successResponse, errorResponse, validationError, logUnexpected } from "../http.js";
import { CHANNEL_MESSAGE, PREFERENCE_CHANNELS, preferenceOrg, toPreference } from "./preference-shape.js";

export interface GetPreferencesDeps {
  repo?: NotificationsRepository;
}

const ALLOWED_KIND = new Set(["user", "organization"]);

/**
 * GET /v1/notifications/preferences?orgId&subjectKind&subjectId[&channel]
 *
 * Email rows are per organization (`orgId` required); push rows (PW-5) are the
 * person's own, under the system organization, so `channel=push` leaves
 * `orgId` out. Without a channel, the organization's rows of every channel.
 */
export async function handleGetPreferences(
  env: Env,
  requestId: string,
  url: URL,
  deps?: GetPreferencesDeps,
): Promise<Response> {
  const orgId = url.searchParams.get("orgId");
  const subjectKind = url.searchParams.get("subjectKind");
  const subjectId = url.searchParams.get("subjectId");
  const channel = url.searchParams.get("channel");

  const errors: Record<string, string[]> = {};
  // notification_preferences.org_id is a UUID column; the public `org_<hex>`
  // form (or a bare UUID) is decoded before querying.
  const org = preferenceOrg(channel, orgId);
  if (!org.ok) errors.orgId = [org.message];
  if (!subjectKind || !ALLOWED_KIND.has(subjectKind)) errors.subjectKind = ['Must be "user" or "organization"'];
  if (!subjectId) errors.subjectId = ["Required"];
  if (channel && !PREFERENCE_CHANNELS.has(channel)) errors.channel = [CHANNEL_MESSAGE];
  if (Object.keys(errors).length > 0 || !org.ok) return validationError(requestId, errors);

  if (!deps?.repo && !env.PLATFORM_DB) {
    return errorResponse("internal_error", "Database not configured", 503, requestId);
  }
  const executor = deps?.repo ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo = deps?.repo ?? createNotificationsRepository(executor!);
    const list = await repo.listPreferences(org.org, subjectKind!, subjectId!, channel);
    if (!list.ok) {
      return errorResponse("internal_error", "Failed to list preferences", 500, requestId);
    }
    const response: GetNotificationPreferencesResponse = {
      preferences: list.value.map(toPreference),
    };
    return successResponse(response, requestId);
  } catch (err) {
    logUnexpected("get-preferences", requestId, err);
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}
