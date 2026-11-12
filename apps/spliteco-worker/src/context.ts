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
}

/** Test seams the router threads into every request. */
export interface SplitecoDeps {
  /** The clock every write stamps. */
  now?: () => Date;
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
}
