import type { Env } from "./env.js";
import { route } from "./router.js";
import { runUseSoonSweep } from "./sweep.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Emails enqueued after a write commits run past the response (CP-18).
    return route(request, env, { waitUntil: (work) => ctx.waitUntil(work) });
  },

  // The daily use-soon sweep (CP-18), on the wrangler template's cron trigger
  // ("30 2 * * *", 08:00 IST). The day swept is the trigger's scheduled day.
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
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
