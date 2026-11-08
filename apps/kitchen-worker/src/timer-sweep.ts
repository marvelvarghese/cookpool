// The per-minute timer sweep (GC-3, cookpool-guided design §4):
// scheduled() on the "* * * * *" trigger, beside the daily use-soon sweep.
//
// Each run:
//   1. purges every timer that ended more than TIMER_RETENTION_MS ago,
//      whatever its state — first, so one the sweep never reached (the
//      trigger was down for a day) is dropped rather than pushed a day late.
//   2. claims the timers that are due — ends_at at or before now, not sent,
//      not cancelled — at most TIMER_SWEEP_MAX, soonest first, in ONE
//      UPDATE … RETURNING that sets their sent_at. A run pushes only what it
//      claimed, so two overlapping runs never push one timer twice.
//   3. asks notifications-worker to push each one to every device of the
//      person who set it (push-client.ts), a few at a time. A push that
//      fails is logged by the client and stays claimed — "tried" — so the
//      sweep never loops on it: at most once, never twice.
//
// A cancelled timer is never claimed, so never pushed. One that is cancelled
// after its run claimed it (seconds) is pushed anyway; guided mode cancels a
// timer before its end, so that is a race at the very end only.

import { createSqlExecutor } from "@saas/db/d1";
import { createTimersRepository } from "@saas/db/kitchen";
import type { Env } from "./env.js";
import { generateRequestId } from "./ids.js";
import { pushToSubject, type PushOrigin } from "./push-client.js";
import { timerPush } from "./timers.js";

/** The trigger scheduled() runs this sweep on (wrangler.template.jsonc). */
export const TIMER_SWEEP_CRON = "* * * * *";

/** The most timers one run claims: a bound on one invocation's service-binding calls. */
export const TIMER_SWEEP_MAX = 200;

/** Timers that ended longer ago than this are purged. */
export const TIMER_RETENTION_MS = 24 * 60 * 60 * 1000;

/** How many pushes are in flight at once. */
const PUSH_CONCURRENCY = 6;

/** Who the sweep's pushes are from. */
const SWEEP_ACTOR = { subjectType: "system", subjectId: "kitchen-worker" } as const;

export interface TimerSweepOptions {
  /** The clock: what is due, and what is old enough to purge. */
  now?: () => Date;
  requestId?: string;
  /** At most this many claimed (TIMER_SWEEP_MAX by default). */
  limit?: number;
}

export interface TimerSweepOutcome {
  /** Timers due and claimed by this run. */
  due: number;
  /** Of those, the pushes notifications-worker answered for. */
  pushed: number;
  /** Devices tried, across every push. */
  devices: number;
  /** Devices whose push service accepted it. */
  sent: number;
  /** Pushes answered with no device to send to (none subscribed, or push off there). */
  unheard: number;
  /** Pushes that could not be asked for (notifications-worker unreachable or refusing): tried, not retried. */
  failed: number;
  /** Timers purged; null when the purge failed (the next run purges them). */
  purged: number | null;
}

/** The sweep's one log line. */
export function timerSweepLine(o: TimerSweepOutcome): string {
  return `[scheduled] timer sweep: due=${o.due} pushed=${o.pushed} devices=${o.devices} sent=${o.sent} unheard=${o.unheard} failed=${o.failed} purged=${o.purged ?? "failed"}`;
}

/**
 * Push every due timer once, and purge the old ones. Returns what it did, or
 * null when the due timers could not be read (no database, or the claim
 * failed) — scheduled() then fails the invocation. Never throws for a push.
 */
export async function runTimerSweep(env: Env, options: TimerSweepOptions = {}): Promise<TimerSweepOutcome | null> {
  if (!env.PLATFORM_DB) return null;
  const clock = options.now ?? (() => new Date());
  const origin: PushOrigin = { requestId: options.requestId ?? generateRequestId(), actor: SWEEP_ACTOR };
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    const repo = createTimersRepository(executor);
    const now = clock();
    const purged = await repo.purgeTimers(new Date(now.getTime() - TIMER_RETENTION_MS));
    const claimed = await repo.claimDueTimers({ now, limit: options.limit ?? TIMER_SWEEP_MAX });
    if (!claimed.ok) return null;
    const due = claimed.value;

    const outcome: TimerSweepOutcome = {
      due: due.length,
      pushed: 0,
      devices: 0,
      sent: 0,
      unheard: 0,
      failed: 0,
      purged: purged.ok ? purged.value : null,
    };
    let next = 0;
    async function worker(): Promise<void> {
      while (next < due.length) {
        const timer = due[next++]!;
        const result = await pushToSubject(env, origin, timerPush(timer));
        if (!result.ok) {
          outcome.failed += 1;
          continue;
        }
        outcome.pushed += 1;
        outcome.devices += result.summary.devices;
        outcome.sent += result.summary.sent;
        if (result.summary.devices === 0) outcome.unheard += 1;
      }
    }
    await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, due.length) }, worker));
    return outcome;
  } finally {
    await executor.dispose();
  }
}
