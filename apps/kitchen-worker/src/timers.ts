// Timers that find you (GC-3, cookpool-guided design §4): what a timer's
// routes and its sweep share — reading a new timer, the API's shape of one,
// the push it becomes, and the timers repository over the request's D1.

import {
  KITCHEN_TIMER_BODY_MAX,
  KITCHEN_TIMER_DEFAULT_BODY,
  KITCHEN_TIMER_DEFAULT_URL,
  KITCHEN_TIMER_LABEL_MAX,
  KITCHEN_TIMER_MAX_SECONDS,
  KITCHEN_TIMER_MIN_SECONDS,
  KITCHEN_TIMER_PUSH_KIND,
  isKitchenTimerUrl,
  type KitchenTimer,
} from "@saas/contracts/kitchen";
import type { PushToSubjectRequest } from "@saas/contracts/notifications";
import { createSqlExecutor } from "@saas/db/d1";
import { createTimersRepository, type KitchenTimerRecord, type TimersRepository } from "@saas/db/kitchen";
import type { RequestContext } from "./context.js";
import { unavailable } from "./http.js";
import { toPublicId } from "./ids.js";
import { Fields, instant, text, type FieldErrors } from "./validate.js";

/** A new timer, read and checked: what the insert takes. */
export interface TimerInput {
  label: string;
  body: string | null;
  url: string;
  endsAt: Date;
}

/**
 * The body of POST /v1/kitchen/me/timers: `label` (1–60), `body` (1–120,
 * optional), `url` (an app path, the cooking session when left out) and
 * `endsAt`, 30 s to 24 h after `now`. Every field that fails is named.
 */
export function parseTimer(
  body: Record<string, unknown>,
  now: Date,
): { ok: true; value: TimerInput } | { ok: false; fields: FieldErrors } {
  const fields = new Fields();
  const label = text(fields, "label", body.label, KITCHEN_TIMER_LABEL_MAX);
  // A blank body is no body, as a blank item note is (RC-3): the push says "Time's up".
  const blank = typeof body.body === "string" && body.body.trim() === "";
  const note = blank ? null : text(fields, "body", body.body, KITCHEN_TIMER_BODY_MAX, true);
  let url: string | undefined = KITCHEN_TIMER_DEFAULT_URL;
  if (body.url !== undefined && body.url !== null) {
    url = isKitchenTimerUrl(body.url) ? body.url : fields.add("url", "Must be a path in the app, starting with one /");
  }
  const endsAt = instant(fields, "endsAt", body.endsAt);
  if (endsAt) {
    const ahead = (endsAt.getTime() - now.getTime()) / 1000;
    if (ahead < KITCHEN_TIMER_MIN_SECONDS) fields.add("endsAt", `Must be at least ${KITCHEN_TIMER_MIN_SECONDS} seconds from now`);
    else if (ahead > KITCHEN_TIMER_MAX_SECONDS) fields.add("endsAt", "Must be at most 24 hours from now");
  }
  if (!fields.ok || label === undefined || note === undefined || url === undefined || !endsAt) {
    return { ok: false, fields: fields.errors };
  }
  return { ok: true, value: { label, body: note, url, endsAt } };
}

/** A timer as the API sends it. */
export function toKitchenTimer(record: KitchenTimerRecord): KitchenTimer {
  return {
    id: toPublicId("tmr", record.id),
    label: record.label,
    body: record.body,
    url: record.url,
    endsAt: record.endsAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    sentAt: record.sentAt ? record.sentAt.toISOString() : null,
    canceledAt: record.canceledAt ? record.canceledAt.toISOString() : null,
  };
}

/**
 * The push a timer becomes when it ends: its label as the title, its body
 * (or "Time's up"), the path it opens, tagged with its id so a repeat
 * replaces the notification shown rather than stacking.
 */
export function timerPush(record: KitchenTimerRecord): PushToSubjectRequest {
  return {
    subjectId: record.userId,
    message: {
      kind: KITCHEN_TIMER_PUSH_KIND,
      title: record.label,
      body: record.body ?? KITCHEN_TIMER_DEFAULT_BODY,
      url: record.url,
      tag: toPublicId("tmr", record.id),
    },
  };
}

/**
 * Run `fn` with the timers repository over the request's D1 binding. A
 * missing binding or anything `fn` throws is a 503; the executor is always
 * disposed.
 */
export async function withTimersRepo(
  ctx: Pick<RequestContext, "env" | "requestId">,
  fn: (repo: TimersRepository) => Promise<Response>,
): Promise<Response> {
  if (!ctx.env.PLATFORM_DB) return unavailable(ctx.requestId);
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB);
  try {
    return await fn(createTimersRepository(executor));
  } catch {
    return unavailable(ctx.requestId);
  } finally {
    await executor.dispose();
  }
}
