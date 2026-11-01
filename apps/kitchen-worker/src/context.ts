import type { Timings } from "@saas/contracts/timing";
import type { Uuid } from "@saas/db/ids";
import type { Env } from "./env.js";
import type { Groups } from "./groups-client.js";
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
}

/** A request under `/v1/organizations/{org}/kitchen/…`: one group. */
export interface OrgContext extends RequestContext {
  /** The group, decoded from the path's `org_…` id. */
  orgId: Uuid;
}
