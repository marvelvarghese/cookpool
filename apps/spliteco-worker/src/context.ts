import type { Timings } from "@saas/contracts/timing";
import type { Env } from "./env.js";
import type { People } from "./identity-client.js";
import type { Groups } from "./membership.js";

/** Who is calling: set by api-edge from the resolved session. */
export interface ActorContext {
  subjectId: string;
  subjectType: string;
  /** The delegation (assistant) the call came through, when one did (SE5). */
  delegationId: string | null;
  /** That delegation's scopes, as api-edge resolved them (empty for a person's own session). */
  scopes: string[];
  /** The assistant's name as the person connected it ("Claude"); null without a delegation. */
  clientName: string | null;
  /**
   * The Tripeco ride (`trp_…`) this write is for, when tripeco-worker sent it
   * (`x-tripeco-ride`, tripeco TR-3). api-edge never forwards the header, so
   * only tripeco-worker's binding can set it. Optional: absent is none.
   */
  tripecoRide?: string | null;
}

/** Test seams the router threads into every request. */
export interface SplitecoDeps {
  /** The clock every write stamps. */
  now?: () => Date;
  /**
   * Keeps the invocation alive for work after the response (the runtime's
   * `ExecutionContext.waitUntil`, which index.ts passes). Without one (tests),
   * deferred work runs before the response instead — never dropped.
   */
  waitUntil?: (work: Promise<unknown>) => void;
}

export interface RequestContext {
  env: Env;
  requestId: string;
  actor: ActorContext;
  timings: Timings;
  now(): Date;
  /** The caller's groups with their members, fetched once per request. */
  groups: Groups;
  /** What people are called. */
  people: People;
  /**
   * Run `work` after the response, best-effort (SE2's reminder and paid-you
   * sends, once the write has committed). It never fails the request;
   * anything it throws is swallowed.
   */
  defer(work: () => Promise<unknown>): Promise<void>;
}
