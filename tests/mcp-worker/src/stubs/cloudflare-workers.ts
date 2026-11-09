// The `cloudflare:workers` module, outside workerd: only what
// @cloudflare/workers-oauth-provider imports from it.
export class WorkerEntrypoint {
  protected ctx: unknown;
  protected env: unknown;
  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}
