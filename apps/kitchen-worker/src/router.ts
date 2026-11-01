import { createTimings } from "@saas/contracts/timing";
import { resolveActor } from "./authz.js";
import type { KitchenDeps, OrgContext, RequestContext } from "./context.js";
import type { Env } from "./env.js";
import { handleActivity } from "./handlers/activity.js";
import { handleBalances, handleSettlePlan } from "./handlers/balances.js";
import { handleCreateExpense } from "./handlers/expenses.js";
import {
  handleCreateGroupItem,
  handleGetGroupItem,
  handleListGroupItems,
  handleRemoveGroupItem,
  handleUpdateGroupItem,
} from "./handlers/group-items.js";
import { handleHealth } from "./handlers/health.js";
import { handleCreateMyItem, handleGetMyItem, handleRemoveMyItem, handleUpdateMyItem } from "./handlers/my-items.js";
import { handleMyItems, handleMyPantries, handleSearch } from "./handlers/pantries.js";
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
import { createGroups } from "./groups-client.js";
import { generateRequestId, parseOrgPublicId } from "./ids.js";
import { createRoster } from "./roster-client.js";
import { createPeople } from "./identity-client.js";
import { handleGroupMembers, handleMyBalances, handlePerson } from "./handlers/people.js";

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

/**
 * A handler for one of the caller's own routes (/v1/kitchen/me/…). `params`
 * are the path's captures, in order, still in their public form.
 */
export type MeHandler = (ctx: RequestContext, request: Request, params: readonly string[]) => Promise<Response>;

interface MeRoute {
  name: string;
  /** Matches the whole path. */
  pattern: RegExp;
  methods: Readonly<Partial<Record<Method, MeHandler>>>;
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
  // The group pantry (CP-10).
  {
    name: "kitchen.items",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/items$/,
    methods: { GET: handleListGroupItems, POST: handleCreateGroupItem },
  },
  {
    name: "kitchen.item",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/items\/([^/]+)$/,
    methods: { GET: handleGetGroupItem, PATCH: handleUpdateGroupItem, DELETE: handleRemoveGroupItem },
  },
  // Who is in the group, by name (CP-9).
  {
    name: "kitchen.members",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/members$/,
    methods: { GET: handleGroupMembers },
  },
];

// The caller's own routes, /v1/kitchen/me/…: their personal pantry, and every
// pantry they can reach read as one. They take a RequestContext with no group.
// A personal item is checked against the caller's subject, not the policy
// engine (design.md §6); a route that writes to a group authorizes in that
// group (requireOrgAction). Same order as a group route: 405, then 401.
const ME_ROUTES: readonly MeRoute[] = [
  {
    name: "kitchen.me.pantries",
    pattern: /^\/v1\/kitchen\/me\/pantries$/,
    methods: { GET: handleMyPantries },
  },
  {
    name: "kitchen.me.items",
    pattern: /^\/v1\/kitchen\/me\/items$/,
    methods: { GET: handleMyItems, POST: handleCreateMyItem },
  },
  {
    name: "kitchen.me.item",
    pattern: /^\/v1\/kitchen\/me\/items\/([^/]+)$/,
    methods: { GET: handleGetMyItem, PATCH: handleUpdateMyItem, DELETE: handleRemoveMyItem },
  },
  {
    name: "kitchen.me.search",
    pattern: /^\/v1\/kitchen\/me\/search$/,
    methods: { GET: handleSearch },
  },
  // Balances across groups, and the "why" for one person (CP-9).
  {
    name: "kitchen.me.balances",
    pattern: /^\/v1\/kitchen\/me\/balances$/,
    methods: { GET: handleMyBalances },
  },
  {
    name: "kitchen.me.person",
    pattern: /^\/v1\/kitchen\/me\/people\/([^/]+)$/,
    methods: { GET: handlePerson },
  },
];

function requestContext(env: Env, requestId: string, actor: RequestContext["actor"], deps: KitchenDeps): RequestContext {
  return {
    env,
    requestId,
    actor,
    timings: createTimings(),
    now: deps.now ?? (() => new Date()),
    roster: createRoster(env.MEMBERSHIP_WORKER, requestId),
    groups: createGroups(env.MEMBERSHIP_WORKER, requestId),
    people: createPeople(env.IDENTITY_WORKER, requestId),
  };
}

function handlerFor<H>(methods: Readonly<Partial<Record<Method, H>>>, method: string): H | undefined {
  return Object.hasOwn(methods, method) ? methods[method as Method] : undefined;
}

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

      const handler = handlerFor(r.methods, request.method);
      if (!handler) return methodNotAllowed(requestId);

      const actor = resolveActor(request);
      if (!actor) return unauthenticated(requestId);

      const orgId = parseOrgPublicId(match[1]!);
      if (!orgId) return notFound(requestId);

      const ctx: OrgContext = { ...requestContext(env, requestId, actor, deps), orgId };
      const endTotal = ctx.timings.start("total");
      const response = await handler(ctx, request, match.slice(2));
      endTotal();
      return withTimings(response, requestId, `${r.name}.${request.method.toLowerCase()}`, ctx.timings);
    }

    for (const r of ME_ROUTES) {
      const match = url.pathname.match(r.pattern);
      if (!match) continue;

      const handler = handlerFor(r.methods, request.method);
      if (!handler) return methodNotAllowed(requestId);

      const actor = resolveActor(request);
      if (!actor) return unauthenticated(requestId);

      const ctx = requestContext(env, requestId, actor, deps);
      const endTotal = ctx.timings.start("total");
      const response = await handler(ctx, request, match.slice(1));
      endTotal();
      return withTimings(response, requestId, `${r.name}.${request.method.toLowerCase()}`, ctx.timings);
    }

    return routeNotFound(requestId, url.pathname);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
