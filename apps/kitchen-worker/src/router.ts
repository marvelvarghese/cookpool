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
import { handleItemHistory, handleRecipes } from "./handlers/from-before.js";
import { handleSetGroupMeasures, handleSetMyMeasures } from "./handlers/measures.js";
import { handleCreateMyItem, handleGetMyItem, handleRemoveMyItem, handleUpdateMyItem } from "./handlers/my-items.js";
import {
  handleMyItemMoves,
  handleTransferMyItem,
  handleUndoMyMove,
  handleUseMyItem,
  handleUsuals,
  handleWasteMyItem,
} from "./handlers/my-uses.js";
import { handleMyItems, handleMyPantries, handleSearch } from "./handlers/pantries.js";
import { handleCreateSettlement } from "./handlers/settlements.js";
import { handleGetSettings, handleUpdateSettings } from "./handlers/settings.js";
import { handleFlagTxn, handleReverseTxn } from "./handlers/txns.js";
import { handleGroupItemMoves, handleUndoGroupMove, handleUseGroupItem, handleWasteGroupItem } from "./handlers/uses.js";
import {
  handleCancelDish,
  handleCookDish,
  handleGetMyDish,
  handleGroupDishes,
  handleMyDishes,
} from "./handlers/dishes.js";
import {
  handleClaimDish,
  handleCorrectDish,
  handleFinalizeDish,
  handleFinalizeMyDish,
  handleSetDishShares,
  handleSetPortion,
} from "./handlers/dish-split.js";
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
import { handleInbox } from "./handlers/inbox.js";
import { handleSubjectBalance, isInternalCaller } from "./handlers/internal.js";
import { handleFoods, handleGetAlwaysHave, handleSetAlwaysHave, handleSetFoodAnswer } from "./handlers/foods.js";
import {
  handleCookNow,
  handleCopyRecipe,
  handleCreateRecipe,
  handleCreateRecipeLink,
  handleDeleteRecipe,
  handleDeleteRecipeLink,
  handleExploreRecipes,
  handleGetRecipe,
  handleMyRecipes,
  handlePersonRecipes,
  handleRecipeByLink,
  handleRecipeMatch,
  handleUpdateRecipe,
  handleUpdateStepTimes,
} from "./handlers/recipes.js";
// Timers that find you (GC-3).
import { handleCancelTimer, handleCreateTimer, handleListTimers } from "./handlers/timers.js";
// The stock check (PN-4).
import { handleCheckGroupItem, handleCheckMyItem } from "./handlers/stock-check.js";

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
  // Using things (CP-11).
  {
    name: "kitchen.item.uses",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/items\/([^/]+)\/uses$/,
    methods: { POST: handleUseGroupItem },
  },
  {
    name: "kitchen.item.waste",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/items\/([^/]+)\/waste$/,
    methods: { POST: handleWasteGroupItem },
  },
  {
    name: "kitchen.item.moves",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/items\/([^/]+)\/moves$/,
    methods: { GET: handleGroupItemMoves },
  },
  // The stock check (PN-4): set what is really left, and say where the rest went.
  {
    name: "kitchen.item.check",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/items\/([^/]+)\/check$/,
    methods: { POST: handleCheckGroupItem },
  },
  // Your measures (SM-13).
  {
    name: "kitchen.item.measures",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/items\/([^/]+)\/measures$/,
    methods: { PUT: handleSetGroupMeasures },
  },
  {
    name: "kitchen.move.undo",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/moves\/([^/]+)\/undo$/,
    methods: { POST: handleUndoGroupMove },
  },
  // Dishes (CP-14).
  {
    name: "kitchen.dishes",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/dishes$/,
    methods: { GET: handleGroupDishes },
  },
  // Splitting a dish (CP-16).
  {
    name: "kitchen.dish.claim",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/dishes\/([^/]+)\/claims\/me$/,
    methods: { PUT: handleClaimDish },
  },
  {
    name: "kitchen.dish.shares",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/dishes\/([^/]+)\/shares$/,
    methods: { PUT: handleSetDishShares },
  },
  {
    name: "kitchen.dish.finalize",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/dishes\/([^/]+)\/finalize$/,
    methods: { POST: handleFinalizeDish },
  },
  {
    name: "kitchen.dish.correct",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/dishes\/([^/]+)\/correct$/,
    methods: { POST: handleCorrectDish },
  },
  // Anyone's portion (SM-6). After kitchen.dish.claim, so `claims/me` is
  // still matched there first (the caller's shorthand, one route).
  {
    name: "kitchen.dish.portion",
    pattern: /^\/v1\/organizations\/([^/]+)\/kitchen\/dishes\/([^/]+)\/claims\/([^/]+)$/,
    methods: { PUT: handleSetPortion },
  },
];

// The caller's own routes, /v1/kitchen/me/…: their personal pantry, and every
// pantry they can reach read as one — and the signed-in reads with no group in
// their path (/v1/kitchen/foods, …/recipes, …/recipe-links, …/people/{usr}/
// recipes, RC-4). They take a RequestContext with no group.
// A personal item is checked against the caller's subject, not the policy
// engine (design.md §6); a route that writes to a group authorizes in that
// group (requireOrgAction). Same order as a group route: 405, then 401.
const ME_ROUTES: readonly MeRoute[] = [
  {
    name: "kitchen.me.pantries",
    pattern: /^\/v1\/kitchen\/me\/pantries$/,
    methods: { GET: handleMyPantries },
  },
  // From before (SM-8). Listed ahead of the item and dish routes: their
  // `{itm}` / `{dsh}` capture would otherwise take "history" and "recipes".
  {
    name: "kitchen.me.items.history",
    pattern: /^\/v1\/kitchen\/me\/items\/history$/,
    methods: { GET: handleItemHistory },
  },
  {
    name: "kitchen.me.dishes.recipes",
    pattern: /^\/v1\/kitchen\/me\/dishes\/recipes$/,
    methods: { GET: handleRecipes },
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
  // Using things (CP-11).
  {
    name: "kitchen.me.item.uses",
    pattern: /^\/v1\/kitchen\/me\/items\/([^/]+)\/uses$/,
    methods: { POST: handleUseMyItem },
  },
  {
    name: "kitchen.me.item.waste",
    pattern: /^\/v1\/kitchen\/me\/items\/([^/]+)\/waste$/,
    methods: { POST: handleWasteMyItem },
  },
  {
    name: "kitchen.me.item.transfer",
    pattern: /^\/v1\/kitchen\/me\/items\/([^/]+)\/transfer$/,
    methods: { POST: handleTransferMyItem },
  },
  {
    name: "kitchen.me.item.moves",
    pattern: /^\/v1\/kitchen\/me\/items\/([^/]+)\/moves$/,
    methods: { GET: handleMyItemMoves },
  },
  // The stock check (PN-4), for the caller's own item.
  {
    name: "kitchen.me.item.check",
    pattern: /^\/v1\/kitchen\/me\/items\/([^/]+)\/check$/,
    methods: { POST: handleCheckMyItem },
  },
  // Your measures (SM-13).
  {
    name: "kitchen.me.item.measures",
    pattern: /^\/v1\/kitchen\/me\/items\/([^/]+)\/measures$/,
    methods: { PUT: handleSetMyMeasures },
  },
  {
    name: "kitchen.me.move.undo",
    pattern: /^\/v1\/kitchen\/me\/moves\/([^/]+)\/undo$/,
    methods: { POST: handleUndoMyMove },
  },
  {
    name: "kitchen.me.usuals",
    pattern: /^\/v1\/kitchen\/me\/usuals$/,
    methods: { GET: handleUsuals },
  },
  // Dishes (CP-14).
  {
    name: "kitchen.me.dishes",
    pattern: /^\/v1\/kitchen\/me\/dishes$/,
    methods: { GET: handleMyDishes, POST: handleCookDish },
  },
  {
    name: "kitchen.me.dish",
    pattern: /^\/v1\/kitchen\/me\/dishes\/([^/]+)$/,
    methods: { GET: handleGetMyDish },
  },
  {
    name: "kitchen.me.dish.cancel",
    pattern: /^\/v1\/kitchen\/me\/dishes\/([^/]+)\/cancel$/,
    methods: { POST: handleCancelDish },
  },
  // Finalizing one's own dish, shared or just for them (CP-16).
  {
    name: "kitchen.me.dish.finalize",
    pattern: /^\/v1\/kitchen\/me\/dishes\/([^/]+)\/finalize$/,
    methods: { POST: handleFinalizeMyDish },
  },
  // Home's inbox (CP-19).
  {
    name: "kitchen.me.inbox",
    pattern: /^\/v1\/kitchen\/me\/inbox$/,
    methods: { GET: handleInbox },
  },
  // The food list, answers and Always have (RC-4).
  {
    name: "kitchen.foods",
    pattern: /^\/v1\/kitchen\/foods$/,
    methods: { GET: handleFoods },
  },
  {
    name: "kitchen.me.food_answers",
    pattern: /^\/v1\/kitchen\/me\/food-answers$/,
    methods: { PUT: handleSetFoodAnswer },
  },
  {
    name: "kitchen.me.always_have",
    pattern: /^\/v1\/kitchen\/me\/always-have$/,
    methods: { GET: handleGetAlwaysHave, PUT: handleSetAlwaysHave },
  },
  // Recipes (RC-4). Copies are listed ahead of one recipe: its `{rcp}`
  // capture would otherwise take "copies".
  {
    name: "kitchen.me.recipes",
    pattern: /^\/v1\/kitchen\/me\/recipes$/,
    methods: { GET: handleMyRecipes, POST: handleCreateRecipe },
  },
  {
    name: "kitchen.me.recipes.copies",
    pattern: /^\/v1\/kitchen\/me\/recipes\/copies$/,
    methods: { POST: handleCopyRecipe },
  },
  {
    name: "kitchen.me.recipe",
    pattern: /^\/v1\/kitchen\/me\/recipes\/([^/]+)$/,
    methods: { PATCH: handleUpdateRecipe, DELETE: handleDeleteRecipe },
  },
  {
    name: "kitchen.me.recipe.match",
    pattern: /^\/v1\/kitchen\/me\/recipes\/([^/]+)\/match$/,
    methods: { GET: handleRecipeMatch },
  },
  {
    name: "kitchen.me.recipe.link",
    pattern: /^\/v1\/kitchen\/me\/recipes\/([^/]+)\/link$/,
    methods: { POST: handleCreateRecipeLink, DELETE: handleDeleteRecipeLink },
  },
  // Use today's times (GC-2).
  {
    name: "kitchen.me.recipe.step_times",
    pattern: /^\/v1\/kitchen\/me\/recipes\/([^/]+)\/step-times$/,
    methods: { PATCH: handleUpdateStepTimes },
  },
  {
    name: "kitchen.me.cook_now",
    pattern: /^\/v1\/kitchen\/me\/cook-now$/,
    methods: { GET: handleCookNow },
  },
  {
    name: "kitchen.recipes",
    pattern: /^\/v1\/kitchen\/recipes$/,
    methods: { GET: handleExploreRecipes },
  },
  {
    name: "kitchen.recipe",
    pattern: /^\/v1\/kitchen\/recipes\/([^/]+)$/,
    methods: { GET: handleGetRecipe },
  },
  {
    name: "kitchen.recipe_link",
    pattern: /^\/v1\/kitchen\/recipe-links\/([^/]+)$/,
    methods: { GET: handleRecipeByLink },
  },
  {
    name: "kitchen.person.recipes",
    pattern: /^\/v1\/kitchen\/people\/([^/]+)\/recipes$/,
    methods: { GET: handlePersonRecipes },
  },
  // Timers that find you (GC-3): the caller's own; the per-minute sweep pushes them.
  {
    name: "kitchen.me.timers",
    pattern: /^\/v1\/kitchen\/me\/timers$/,
    methods: { GET: handleListTimers, POST: handleCreateTimer },
  },
  {
    name: "kitchen.me.timer",
    pattern: /^\/v1\/kitchen\/me\/timers\/([^/]+)$/,
    methods: { DELETE: handleCancelTimer },
  },
];

// Service-internal: a person's balance in a group, for membership-worker's
// leave (CP-19). Only a caller naming itself in x-internal-actor gets past
// the plain 404 — before the method is even looked at — so nothing about
// the route shows to anyone else (see handlers/internal.ts).
const INTERNAL_BALANCE_RE = /^\/v1\/internal\/kitchen\/organizations\/([^/]+)\/subjects\/([^/]+)\/balance$/;

/** Work after the response: handed to `waitUntil` when there is one, else run before the response. Never throws. */
export function deferrer(deps: Pick<KitchenDeps, "waitUntil">): RequestContext["defer"] {
  return async (work) => {
    const run = (async () => {
      try {
        await work();
      } catch {
        // Best-effort by contract: what runs after a committed write never fails it.
      }
    })();
    if (deps.waitUntil) deps.waitUntil(run);
    else await run;
  };
}

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
    defer: deferrer(deps),
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
      return request.method === "GET" ? await handleHealth(env, requestId) : methodNotAllowed(requestId);
    }

    const internal = url.pathname.match(INTERNAL_BALANCE_RE);
    if (internal) {
      if (!isInternalCaller(request)) return routeNotFound(requestId, url.pathname);
      if (request.method !== "GET") return methodNotAllowed(requestId);
      const timings = createTimings();
      const endTotal = timings.start("total");
      const response = await handleSubjectBalance({ env, requestId, timings }, internal.slice(1));
      endTotal();
      return withTimings(response, requestId, "kitchen.internal.balance.get", timings);
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
