export interface Env {
  PLATFORM_DB?: D1Database;
  IDENTITY_WORKER?: Fetcher;
  MEMBERSHIP_WORKER?: Fetcher;
  PROJECTS_WORKER?: Fetcher;
  EVENTS_WORKER?: Fetcher;
  CONFIG_WORKER?: Fetcher;
  WEBHOOKS_WORKER?: Fetcher;
  METERING_WORKER?: Fetcher;
  BILLING_WORKER?: Fetcher;
  NOTIFICATIONS_WORKER?: Fetcher;
  INTEGRATIONS_WORKER?: Fetcher;
  // Cookpool's kitchen bounded context (CP-4): /v1/kitchen/… and
  // /v1/organizations/{org}/kitchen/… (./kitchen-facade.ts).
  KITCHEN_WORKER?: Fetcher;
  // Spliteco (cookpool-spliteco SE1): /v1/spliteco/… (./spliteco-facade.ts).
  SPLITECO_WORKER?: Fetcher;
  // Tripeco (tripeco TR-2): /v1/tripeco/… (./tripeco-facade.ts).
  TRIPECO_WORKER?: Fetcher;
  // Optional KV binding backing the Stripe-style idempotency replay store
  // (Task 0095). Absent on `dev` (no live worker) and absent on the older
  // verify-only stages. When unbound, `replayOrExecute` degrades to a
  // direct downstream forward — never 5xx.
  IDEMPOTENCY_KV?: KVNamespace;
  // Durable Object namespace backing the per-(scope,key) rate-limit counters
  // (PERF5 Stage B). Each bucket key maps to one DO instance for an atomic,
  // race-free token bucket without a KV write on the hot path. Absent on
  // dev/local, where the limiter falls back to the KV path (then fail-open).
  RATE_LIMITER_DO?: DurableObjectNamespace;
  ENVIRONMENT: string;
  CONSOLE_CUSTOM_DOMAIN?: string;
  // M0 / Solo profile switch. "true" runs the single-user B2C profile (see
  // ./solo-mode.ts); absent or any other value keeps the full multi-tenant
  // baseline. Deploy-time wrangler var, not a secret.
  SOLO_MODE?: string;
}
