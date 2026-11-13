import type { TripecoRepository } from "@saas/db/tripeco";
import type { Env } from "./env.js";

/** Who is calling: set by api-edge from the resolved session. */
export interface ActorContext {
  subjectId: string;
  subjectType: string;
}

export interface TripecoDeps {
  /** The clock every write stamps. */
  now?: () => Date;
}

export interface RequestContext {
  env: Env;
  requestId: string;
  actor: ActorContext;
  repo: TripecoRepository;
  now(): Date;
  /** The headers that make a call to spliteco-worker the caller's own. */
  actorHeaders(): Headers;
}
