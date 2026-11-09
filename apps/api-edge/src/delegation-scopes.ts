import {
  DELEGATION_ERROR_REASONS,
  DELEGATION_TOKEN_PREFIX,
  type DelegationScope,
} from "@saas/contracts/delegations";
import { errorResponse } from "./http";

// What a delegated token may do (cookpool-mcp MC-2, design §1). This is the
// security boundary for assistants: an allowlist by method and whole path,
// and anything else is 403 `forbidden` with `details.reason: "scope"`.
//
// Enforced twice, both before any facade forwards:
//   1. index.ts — a `sps_dlg_` bearer on a method and path no scope allows is
//      refused before dispatch, with no identity call; one that some scope
//      allows is resolved there, so (2) runs before idempotency replay;
//   2. resolveActor — every actor identity resolves with a `delegation` is
//      held to its own scopes, whichever facade asked.
//
// Never allowed, by having no entry: /v1/auth/… (the delegation routes
// included), organizations, members, invitations, join codes, API keys,
// billing, config, webhooks, integrations, notifications, usage, audit, admin,
// and every kitchen write except a timer and (MC-5) a suggestion.
//
// Paths are matched whole (anchored), as kitchen-worker matches them. An id
// segment is matched by its prefix (`itm_…`, `rcp_…`, `usr_…`, `tmr_…`), so a
// fixed word kitchen-worker routes in its place (`/me/items/history`) is not
// taken for an id.

interface AllowEntry {
  /** Every one of these is needed. */
  scopes: readonly DelegationScope[];
  methods: readonly string[];
  pattern: RegExp;
  /** For tests and the status file. */
  name: string;
}

const ORG = "[^/]+";

export const DELEGATION_ALLOWLIST: readonly AllowEntry[] = [
  // kitchen.read — the pantry, recipes and what to buy.
  { name: "me.pantries", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/pantries$/ },
  { name: "me.items", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/items$/ },
  { name: "me.item", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/items\/itm_[^/]+$/ },
  { name: "me.search", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/search$/ },
  { name: "me.restock", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/restock$/ },
  { name: "me.cook_now", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/cook-now$/ },
  { name: "me.recipes", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/recipes$/ },
  {
    name: "me.recipe.match",
    scopes: ["kitchen.read"],
    methods: ["GET"],
    pattern: /^\/v1\/kitchen\/me\/recipes\/rcp_[^/]+\/match$/,
  },
  { name: "recipes", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/recipes$/ },
  { name: "recipe", scopes: ["kitchen.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/recipes\/[^/]+$/ },
  {
    name: "group.items",
    scopes: ["kitchen.read"],
    methods: ["GET"],
    pattern: new RegExp(`^/v1/organizations/${ORG}/kitchen/items$`),
  },
  // Home's inbox carries payments the caller owes, so it needs money.read as
  // well (a departure from design §1's table, recorded in the status file).
  { name: "me.inbox", scopes: ["kitchen.read", "money.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/inbox$/ },

  // money.read — balances, read only.
  { name: "me.balances", scopes: ["money.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/balances$/ },
  { name: "me.person", scopes: ["money.read"], methods: ["GET"], pattern: /^\/v1\/kitchen\/me\/people\/usr_[^/]+$/ },
  {
    name: "group.balances",
    scopes: ["money.read"],
    methods: ["GET"],
    pattern: new RegExp(`^/v1/organizations/${ORG}/kitchen/balances$`),
  },

  // timers.write — the caller's own timers.
  { name: "me.timers", scopes: ["timers.write"], methods: ["GET", "POST"], pattern: /^\/v1\/kitchen\/me\/timers$/ },
  { name: "me.timer", scopes: ["timers.write"], methods: ["DELETE"], pattern: /^\/v1\/kitchen\/me\/timers\/tmr_[^/]+$/ },

  // suggest.write — a suggestion the person confirms on Home (the route is MC-5's).
  { name: "me.suggestions", scopes: ["suggest.write"], methods: ["POST"], pattern: /^\/v1\/kitchen\/me\/suggestions$/ },
];

function entryFor(method: string, pathname: string): AllowEntry | null {
  for (const entry of DELEGATION_ALLOWLIST) {
    if (entry.methods.includes(method) && entry.pattern.test(pathname)) return entry;
  }
  return null;
}

/** Does any scope allow this method and path? (The pre-dispatch gate, before the token is resolved.) */
export function isDelegationRoute(method: string, pathname: string): boolean {
  return entryFor(method, pathname) !== null;
}

/** Do these scopes allow this method and path? */
export function isDelegationAllowed(method: string, pathname: string, scopes: readonly string[]): boolean {
  const entry = entryFor(method, pathname);
  return entry !== null && entry.scopes.every((s) => scopes.includes(s));
}

/**
 * Does this request carry a delegated token? Any Authorization header that
 * mentions the prefix counts, however it is spelled around it, so no variant
 * of the header slips past the gate to a facade that forwards it raw.
 */
export function hasDelegatedBearer(request: Request): boolean {
  const header = request.headers.get("authorization");
  return header !== null && header.includes(DELEGATION_TOKEN_PREFIX);
}

/** Is this bearer token a delegated one? */
export function isDelegatedToken(token: string | null): boolean {
  return token !== null && token.startsWith(DELEGATION_TOKEN_PREFIX);
}

export function scopeRefused(requestId: string): Response {
  return errorResponse("forbidden", "This assistant's access does not allow that", 403, requestId, {
    reason: DELEGATION_ERROR_REASONS.SCOPE,
  });
}
