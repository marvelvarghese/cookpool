import type { Env } from "./env.js";
import { route } from "./router.js";
import { runUseSoonSweep } from "./sweep.js";
import { TIMER_SWEEP_CRON, runTimerSweep, timerSweepLine } from "./timer-sweep.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Emails enqueued after a write commits run past the response (CP-18).
    return route(request, env, { waitUntil: (work) => ctx.waitUntil(work) });
  },

  // Two jobs, one per cron trigger in the wrangler template, picked by
  // controller.cron:
  //   "* * * * *"   the timer sweep (GC-3): every due timer pushed once, old ones purged
  //   "30 2 * * *"  the daily use-soon sweep (CP-18), 08:00 IST, for the
  //                 trigger's scheduled day — and any other trigger, as before
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (controller.cron === TIMER_SWEEP_CRON) {
      const timers = await runTimerSweep(env);
      if (!timers) {
        // Thrown so the invocation reads as failed in the worker's cron events.
        throw new Error("[scheduled] timer sweep: the due timers could not be read");
      }
      console.warn(timerSweepLine(timers));
      return;
    }

    const outcome = await runUseSoonSweep(env, { day: new Date(controller.scheduledTime) });
    if (!outcome) {
      // Thrown so the invocation reads as failed in the worker's cron events.
      throw new Error("[scheduled] kitchen sweep: the items could not be read");
    }
    console.warn(
      `[scheduled] kitchen sweep ${outcome.date}: items=${outcome.items} people=${outcome.people} sent=${outcome.sent} failed=${outcome.failed}`,
    );
  },
} satisfies ExportedHandler<Env>;
