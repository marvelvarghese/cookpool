// The preferences model's shared pieces (GET and PUT): the public shape of a
// row, and how the request's organization is read per channel (PW-5).

import {
  NOTIFICATION_KINDS,
  PUSH_PREFERENCES_ORG_ID,
  type NotificationKindPreferences,
  type NotificationPreference,
} from "@saas/contracts/notifications";
import type { StoredNotificationPreference } from "@saas/db/notifications";
import { asUuid, type Uuid } from "@saas/db/ids";
import { parseOrgIdInput } from "../ids.js";

export const PREFERENCE_CHANNELS = new Set(["email", "push"]);
export const CHANNEL_MESSAGE = 'Must be "email" or "push"';

/** Only the kinds the contract names, whatever the stored map holds. */
export function knownKinds(kinds: Record<string, boolean | null>): NotificationKindPreferences {
  const out: NotificationKindPreferences = {};
  for (const kind of NOTIFICATION_KINDS) {
    const v = kinds[kind];
    if (v === true || v === false || v === null) out[kind] = v;
  }
  return out;
}

export function toPreference(p: StoredNotificationPreference): NotificationPreference {
  return {
    subjectKind: p.subjectKind as NotificationPreference["subjectKind"],
    subjectId: p.subjectId,
    orgId: p.orgId,
    channel: p.channel as NotificationPreference["channel"],
    categories: p.categories as NotificationPreference["categories"],
    kinds: knownKinds(p.kinds ?? {}),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const PUSH_ORG = asUuid(PUSH_PREFERENCES_ORG_ID);

/**
 * The organization a preference read or write is for. Email: the given org
 * (required, `org_…` or a UUID). Push: the system organization — a person's
 * push preferences are theirs in every group, so `orgId` is left out (the
 * system organization's own id is accepted too).
 */
export function preferenceOrg(
  channel: string | null | undefined,
  orgId: unknown,
): { ok: true; org: Uuid } | { ok: false; message: string } {
  if (channel === "push") {
    if (orgId === undefined || orgId === null || orgId === "") return { ok: true, org: PUSH_ORG };
    const parsed = typeof orgId === "string" ? parseOrgIdInput(orgId) : null;
    if (parsed === PUSH_ORG) return { ok: true, org: PUSH_ORG };
    return { ok: false, message: "Push preferences are a person's own, in every group: leave orgId out" };
  }
  if (typeof orgId !== "string" || !orgId) return { ok: false, message: "Required" };
  const parsed = parseOrgIdInput(orgId);
  return parsed ? { ok: true, org: parsed } : { ok: false, message: "Invalid org id" };
}
