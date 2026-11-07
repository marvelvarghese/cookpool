import type { Env } from "../env.js";
import type { InternalActor } from "../router.js";
import {
  NOTIFICATION_EVENT_TYPES,
  isNotificationKind,
  type NotificationCategoryPreferences,
  type NotificationKindPreferences,
  type NotificationPreferenceChannel,
  type NotificationSubjectKind,
  type UpdateNotificationPreferencesResponse,
} from "@saas/contracts/notifications";
import { createSqlExecutor } from "@saas/db/d1";
import { createNotificationsRepository, type NotificationsRepository } from "@saas/db/notifications";
import type { Uuid } from "@saas/db/ids";
import { successResponse, errorResponse, validationError, logUnexpected } from "../http.js";
import { emitEvent } from "../events-client.js";
import { CHANNEL_MESSAGE, PREFERENCE_CHANNELS, preferenceOrg, toPreference } from "./preference-shape.js";

const ALLOWED_KIND = new Set(["user", "organization"]);
const ALLOWED_CATEGORIES = new Set(["invitation", "billing", "security", "support", "product"]);

export interface PutPreferencesDeps {
  repo?: NotificationsRepository;
  now?: () => Date;
  generateUuid?: () => string;
  emit?: typeof emitEvent;
}

interface ValidPreferenceUpdate {
  org: Uuid;
  subjectKind: NotificationSubjectKind;
  subjectId: string;
  channel: NotificationPreferenceChannel;
  /** Replaces what is stored ({} for push, which has none). */
  categories: NotificationCategoryPreferences;
  /** Merged into what is stored; left out, unchanged. */
  kinds?: NotificationKindPreferences;
}

function toggles(
  value: unknown,
  field: string,
  known: (key: string) => boolean,
  unknownMessage: string,
  errors: Record<string, string[]>,
): Record<string, boolean | null> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors[field] = ["Must be an object"];
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!known(k)) errors[`${field}.${k}`] = [unknownMessage];
    else if (v !== null && typeof v !== "boolean") errors[`${field}.${k}`] = ["Must be boolean or null"];
  }
  return value as Record<string, boolean | null>;
}

/**
 * Email (as before): `orgId` and `categories` required; `kinds` optional.
 * Push (PW-5): no `orgId` (the system organization), no categories, `kinds`
 * required, and only for a user.
 */
function validate(body: unknown): { ok: true; value: ValidPreferenceUpdate } | { ok: false; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, errors: { _root: ["Body must be a JSON object"] } };
  const b = body as Record<string, unknown>;
  const channel = typeof b.channel === "string" && PREFERENCE_CHANNELS.has(b.channel) ? (b.channel as NotificationPreferenceChannel) : null;
  if (!channel) errors.channel = [CHANNEL_MESSAGE];
  const org = preferenceOrg(channel, b.orgId);
  if (!org.ok) errors.orgId = [org.message];
  if (typeof b.subjectKind !== "string" || !ALLOWED_KIND.has(b.subjectKind)) errors.subjectKind = ['Must be "user" or "organization"'];
  else if (channel === "push" && b.subjectKind !== "user") errors.subjectKind = ['Push is a person\'s: must be "user"'];
  if (typeof b.subjectId !== "string" || !b.subjectId) errors.subjectId = ["Required"];

  let categories: Record<string, boolean | null> | null = {};
  if (channel === "push") {
    if (b.categories !== undefined) errors.categories = ["Push has no categories: use kinds"];
  } else {
    categories = toggles(b.categories, "categories", (k) => ALLOWED_CATEGORIES.has(k), "Unknown category", errors);
  }
  let kinds: Record<string, boolean | null> | null | undefined;
  if (b.kinds !== undefined || channel === "push") {
    kinds = toggles(b.kinds, "kinds", isNotificationKind, "Unknown kind", errors);
  }

  if (Object.keys(errors).length > 0 || !channel || !org.ok || !categories || kinds === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      org: org.org,
      subjectKind: b.subjectKind as NotificationSubjectKind,
      subjectId: b.subjectId as string,
      channel,
      categories: categories as NotificationCategoryPreferences,
      ...(kinds ? { kinds: kinds as NotificationKindPreferences } : {}),
    },
  };
}

export async function handlePutPreferences(
  request: Request,
  env: Env,
  requestId: string,
  actor: InternalActor,
  deps?: PutPreferencesDeps,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
  }
  const validated = validate(body);
  if (!validated.ok) return validationError(requestId, validated.errors);
  const input = validated.value;

  if (!deps?.repo && !env.PLATFORM_DB) {
    return errorResponse("internal_error", "Database not configured", 503, requestId);
  }
  const executor = deps?.repo ? null : createSqlExecutor(env.PLATFORM_DB!);
  try {
    const repo = deps?.repo ?? createNotificationsRepository(executor!);
    const now = deps?.now ? deps.now() : new Date();
    const genUuid = deps?.generateUuid ?? (() => crypto.randomUUID());
    const emit = deps?.emit ?? emitEvent;

    const upsert = await repo.upsertPreference({
      id: genUuid(),
      orgId: input.org,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      channel: input.channel,
      categories: input.categories as Record<string, boolean | null>,
      ...(input.kinds ? { kinds: input.kinds as Record<string, boolean | null> } : {}),
      updatedAt: now,
    });
    if (!upsert.ok) {
      return errorResponse("internal_error", "Failed to update preferences", 500, requestId);
    }

    await emit(env, {
      type: NOTIFICATION_EVENT_TYPES.PREFERENCE_UPDATED,
      notificationId: upsert.value.id,
      orgId: input.org,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      actorType: actor.subjectType,
      actorId: actor.subjectId,
      requestId,
      category: "notifications",
      description: `Notification preferences updated for ${input.subjectKind}:${input.subjectId}`,
      payload: {
        orgId: input.org,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        channel: input.channel,
        categories: input.categories,
        ...(input.kinds ? { kinds: input.kinds } : {}),
      },
      occurredAt: now,
    });

    const response: UpdateNotificationPreferencesResponse = { preference: toPreference(upsert.value) };
    return successResponse(response, requestId);
  } catch (err) {
    logUnexpected("put-preferences", requestId, err);
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    if (executor) await executor.dispose();
  }
}
