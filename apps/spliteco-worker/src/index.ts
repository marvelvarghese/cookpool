import type { Env } from "./env.js";
import { route } from "./router.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return route(request, env, { waitUntil: (work) => ctx.waitUntil(work) });
  },
} satisfies ExportedHandler<Env>;
