import { createTimings } from "@saas/contracts/timing";
import { resolveActor } from "./authz.js";
import type { KitchenDeps, OrgContext } from "./context.js";
import type { Env } from "./env.js";
import { handleActivity } from "./handlers/activity.js";
import { handleBalances, handleSettlePlan } from "./handlers/balances.js";
import { handleCreateExpense } from "./handlers/expenses.js";
import { handleHealth } from "./handlers/health.js";
import { handleCreateSettlement } from "./handlers/settlements.js";
import { handleGetSettings, handleUpdateSettings } from "./handlers/settings.js";
import { handleFlagTxn, handleReverseTxn } from "./handlers/txns.js";
import {
  errorResponse,
  methodNotAllowed,
  notFound,
  routeNotFound,
  unauthenticated,
  withTimings,
} from "./http.js";
import { generateRequestId, parseOrgPublicId } from "./ids.js";
import { createRoster } from "./roster-client.js";

const REQUEST_ID_RE = /^[\w-]{1,128}$/;

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * A handler for one group's route. `params` are the path's captures after the
 * org id, in order (e.g. an item's `itm_…` id), still in their public form.
 */
export type OrgHandler = (ctx: OrgContext, request: Request, params: readonly string[]) => Promise<Response>;

interface OrgRoute {
  /** Timing-log name; the method is appended (`kitchen.settings.get`). */
  name: string;
  /** Matches the whole path. Capture 1 is the group's `org_…` id. */
  pattern: RegExp;
  methods: Readonly<Partial<Record<Method, OrgHandler>>>;
}

// Every route under /v1/organizations/{org}/kitchen/…, one entry per path.
// A route here gets, in order: 405 for a method it does not list, 401 without
// an actor, the opaque 404 for a malformed org id, then its handler, which
// authorizes (requireGroupAction) before it reads or writes anything.
const ORG_ROUTES: readonly OrgRoute[] = [
  {
    name: "kitchen.settings",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/settings$/,
    methods: { GET: handleGetSettings, PATCH: handleUpdateSettings },
  },
  // The ledger (CP-7).
  {
    name: "kitchen.expenses",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/expenses$/,
    methods: { POST: handleCreateExpense },
  },
  {
    name: "kitchen.settlements",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/settlements$/,
    methods: { POST: handleCreateSettlement },
  },
  {
    name: "kitchen.txns.reverse",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/txns\/([^/]+)\/reverse$/,
    methods: { POST: handleReverseTxn },
  },
  {
    name: "kitchen.txns.flags",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/txns\/([^/]+)\/flags$/,
    methods: { POST: handleFlagTxn },
  },
  {
    name: "kitchen.activity",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/activity$/,
    methods: { GET: handleActivity },
  },
  {
    name: "kitchen.balances",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/balances$/,
    methods: { GET: handleBalances },
  },
  {
    name: "kitchen.settle_plan",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/settle-plan$/,
    methods: { GET: handleSettlePlan },
  },
];

// The caller's own routes (/v1/kitchen/me/…) arrive with the pantries; they
// take a RequestContext with no group and authorize per group they touch
// (requireOrgAction).

function resolveRequestId(request: Request): string {
  const header = request.headers.get("x-request-id");
  return header && REQUEST_ID_RE.test(header) ? header : generateRequestId();
}

export async function route(request: Request, env: Env, deps: KitchenDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const requestId = resolveRequestId(request);

  try {
    if (url.pathname === "/health") {
      return request.method === "GET" ? handleHealth(env, requestId) : methodNotAllowed(requestId);
    }

    for (const r of ORG_ROUTES) {
      const match = url.pathname.match(r.pattern);
      if (!match) continue;

      const handler = Object.hasOwn(r.methods, request.method) ? r.methods[request.method as Method] : undefined;
      if (!handler) return methodNotAllowed(requestId);

      const actor = resolveActor(request);
      if (!actor) return unauthenticated(requestId);

      const orgId = parseOrgPublicId(match[1]!);
      if (!orgId) return notFound(requestId);

      const timings = createTimings();
      const endTotal = timings.start("total");
      const ctx: OrgContext = {
        env,
        requestId,
        actor,
        timings,
        now: deps.now ?? (() => new Date()),
        roster: createRoster(env.MEMBERSHIP_WORKER, requestId),
        orgId,
      };
      const response = await handler(ctx, request, match.slice(2));
      endTotal();
      return withTimings(response, requestId, `${r.name}.${request.method.toLowerCase()}`, timings);
    }

    return routeNotFound(requestId, url.pathname);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
