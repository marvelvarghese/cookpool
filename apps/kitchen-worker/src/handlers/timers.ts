import {
  KITCHEN_TIMERS_MAX_ACTIVE,
  KITCHEN_TIMER_ERROR_REASONS,
  type KitchenTimerResponse,
  type KitchenTimersResponse,
} from "@saas/contracts/kitchen";
import type { RequestContext } from "../context.js";
import { notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { parsePublicId } from "../ids.js";
import { parseTimer, toKitchenTimer, withTimersRepo } from "../timers.js";

// Timers that find you (GC-3, cookpool-guided design §4):
//
//   POST   /v1/kitchen/me/timers        self: set one → 201 { timer }
//   GET    /v1/kitchen/me/timers        self: the active ones, soonest first
//   DELETE /v1/kitchen/me/timers/{tmr}  self: cancel it → 200 { timer }
//
// A timer is the caller's own, like their personal pantry: checked against
// their subject, never the policy engine. Anyone else's timer — or a
// malformed id, or one purged — is the opaque 404. A cancel is idempotent:
// a repeat answers the timer as the first cancel left it, and a timer the
// sweep already pushed comes back with `sentAt` set and is not cancelled.
// At most KITCHEN_TIMERS_MAX_ACTIVE are active at once: one more is 422
// `too_many_timers` (the request is well formed; the caller's state refuses
// it — not 429, which says "try again later" and which clients retry).

/** More than a person can have active, so the list is never cut short. */
const LIST_LIMIT = KITCHEN_TIMERS_MAX_ACTIVE * 5;

export async function handleCreateTimer(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const now = ctx.now();
  const parsed = parseTimer(body, now);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);

  return withTimersRepo(ctx, async (repo) => {
    const made = await ctx.timings.measure("db", () =>
      repo.createTimer({
        id: crypto.randomUUID(),
        userId: ctx.actor.subjectId,
        ...parsed.value,
        now,
        maxActive: KITCHEN_TIMERS_MAX_ACTIVE,
      }),
    );
    if (!made.ok) {
      if (made.error.kind === "invalid") return validationError(ctx.requestId, { body: ["A field is out of range"] });
      return unavailable(ctx.requestId);
    }
    if (!made.value) {
      return unprocessable(
        ctx.requestId,
        `You have ${KITCHEN_TIMERS_MAX_ACTIVE} timers running: cancel one first`,
        KITCHEN_TIMER_ERROR_REASONS.TOO_MANY_TIMERS,
        { max: KITCHEN_TIMERS_MAX_ACTIVE },
      );
    }
    return successResponse<KitchenTimerResponse>({ timer: toKitchenTimer(made.value) }, ctx.requestId, 201);
  });
}

export async function handleListTimers(ctx: RequestContext): Promise<Response> {
  return withTimersRepo(ctx, async (repo) => {
    const listed = await ctx.timings.measure("db", () => repo.listActiveTimers(ctx.actor.subjectId, LIST_LIMIT));
    if (!listed.ok) return unavailable(ctx.requestId);
    return successResponse<KitchenTimersResponse>({ timers: listed.value.map(toKitchenTimer) }, ctx.requestId);
  });
}

export async function handleCancelTimer(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const id = parsePublicId("tmr", params[0]!);
  if (!id) return notFound(ctx.requestId);
  return withTimersRepo(ctx, async (repo) => {
    const cancelled = await ctx.timings.measure("db", () =>
      repo.cancelTimer({ id, userId: ctx.actor.subjectId, now: ctx.now() }),
    );
    if (!cancelled.ok) return unavailable(ctx.requestId);
    if (!cancelled.value) return notFound(ctx.requestId);
    return successResponse<KitchenTimerResponse>({ timer: toKitchenTimer(cancelled.value) }, ctx.requestId);
  });
}
