import type { Timings } from "@saas/contracts/timing";
import type { AiProvider } from "./ai/provider.js";
import type { Uuid } from "@saas/db/ids";
import type { Env } from "./env.js";
import type { Groups } from "./groups-client.js";
import type { People } from "./identity-client.js";
import type { Roster } from "./roster-client.js";

/** Who is calling: set by api-edge from the resolved session or API key. */
export interface ActorContext {
  subjectId: string;
  subjectType: string;
}

/** Test seams the router threads into every request. */
export interface KitchenDeps {
  /** The clock every write stamps (`updated_at`, `occurred_at`, …). */
  now?: () => Date;
  /**
   * Keeps the invocation alive for work that runs after the response: the
   * runtime's `ExecutionContext.waitUntil` (index.ts passes it). Without one
   * (tests, a caller with no context), deferred work runs before the
   * response instead — never dropped.
   */
  waitUntil?: (work: Promise<unknown>) => void;
  /**
   * Cookpool AI (AI-2): the model provider, in place of the Anthropic client
   * the API key builds — tests stub it, so no test reaches the network.
   */
  aiProvider?: AiProvider;
}

/** One authenticated request, as every handler sees it. */
export interface RequestContext {
  env: Env;
  requestId: string;
  actor: ActorContext;
  /** Phases (`authz`, `db`, …) land in the response's Server-Timing header. */
  timings: Timings;
  now(): Date;
  /** Who is in a group: fetched from membership-worker once per group per request. */
  roster: Roster;
  /** Which groups someone is in: fetched from membership-worker once per person per request. */
  groups: Groups;
  /** What people are called: fetched from identity-worker once per person per request (CP-9). */
  people: People;
  /**
   * Run `work` after the response, best-effort (CP-18's emails, enqueued once
   * a write has committed): it must never fail the request or hold it up.
   * Anything it throws is swallowed. Resolves when the work is handed off —
   * at once with a `waitUntil`, after the work without one.
   */
  defer(work: () => Promise<unknown>): Promise<void>;
  /** The model provider a test put in place (KitchenDeps.aiProvider); unset in production. */
  aiProvider?: AiProvider;
}

/** A request under `/v1/organizations/{org}/kitchen/…`: one group. */
export interface OrgContext extends RequestContext {
  /** The group, decoded from the path's `org_…` id. */
  orgId: Uuid;
}
