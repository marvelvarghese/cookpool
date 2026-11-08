// A push to one person (GC-3), as kitchen-worker asks for it: a timer that
// ended. Beside the email client (emails.ts → @saas/notifications-client),
// over the same NOTIFICATIONS_WORKER binding, to notifications-worker's
// internal POST /v1/notifications/push-to-subject — a route that takes only
// kitchen-worker, named in x-internal-actor.
//
// Best-effort, like the emails: it never throws. A failure is logged here,
// once, with the bounded reason and the push's tag (the timer's id — never an
// endpoint or a key), and comes back as `ok: false`; the sweep has already
// marked the timer as tried, so it never loops on one.

import {
  PUSH_TO_SUBJECT_PATH,
  type PushToSubjectRequest,
  type PushToSubjectResponse,
} from "@saas/contracts/notifications";
import type { ActorContext } from "./context.js";
import type { Env } from "./env.js";

export const PUSH_TO_SUBJECT_URL = `https://notifications.internal${PUSH_TO_SUBJECT_PATH}`;

/** Who asked for a push: forwarded as the call's actor, with kitchen-worker as the internal caller. */
export interface PushOrigin {
  requestId: string;
  actor: ActorContext;
}

export type PushToSubjectFailure = "no_binding" | "non_2xx" | "network_error" | "bad_response";

export type PushToSubjectResult =
  | { ok: true; summary: PushToSubjectResponse }
  | { ok: false; reason: PushToSubjectFailure; status: number | null };

const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function failed(reason: PushToSubjectFailure, status: number | null, tag: string): PushToSubjectResult {
  console.warn(`[kitchen-worker] push-to-subject ${tag}: ${reason}${status === null ? "" : ` ${status}`}`);
  return { ok: false, reason, status };
}

/** Ask notifications-worker to push `request.message` to every device of `request.subjectId`. Never throws. */
export async function pushToSubject(
  env: Pick<Env, "NOTIFICATIONS_WORKER">,
  origin: PushOrigin,
  request: PushToSubjectRequest,
): Promise<PushToSubjectResult> {
  const tag = request.message.tag;
  if (!env.NOTIFICATIONS_WORKER) return failed("no_binding", null, tag);

  let response: Response;
  try {
    response = await env.NOTIFICATIONS_WORKER.fetch(PUSH_TO_SUBJECT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": origin.requestId,
        "x-internal-actor": "kitchen-worker",
        "x-actor-subject-type": origin.actor.subjectType,
        "x-actor-subject-id": origin.actor.subjectId,
      },
      body: JSON.stringify(request),
    });
  } catch {
    return failed("network_error", null, tag);
  }
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // Already consumed or closed.
    }
    return failed("non_2xx", response.status, tag);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return failed("bad_response", response.status, tag);
  }
  const data = parsed && typeof parsed === "object" ? (parsed as { data?: unknown }).data : undefined;
  const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!d || !count(d.devices) || !count(d.sent) || !count(d.gone) || !count(d.failed)) {
    return failed("bad_response", response.status, tag);
  }
  const summary: PushToSubjectResponse = { devices: d.devices, sent: d.sent, gone: d.gone, failed: d.failed };
  if (d.skipped === "push_off" || d.skipped === "no_devices") summary.skipped = d.skipped;
  return { ok: true, summary };
}
