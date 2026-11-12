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
// every kitchen write except a timer and (MC-5) a suggestion, and in Spliteco
// (cookpool-spliteco SE-6, design §0.9): payments (settlements), "not
// received", the profile and its UPI ID, group create and settings, the settle
// plan, export, the direct-group route, live split, and the expense create,
// edit and move routes themselves — an assistant adds, edits and moves only
// through a draft (POST /v1/spliteco/drafts, then …/drafts/{drf}/save), so
// nothing saves that the person was not shown. spliteco-worker checks the
// same list again (apps/spliteco-worker/src/delegated.ts).
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
const SPLITECO = "^/v1/spliteco";
const S_ORG = "org_[^/]+";
const S_TXN = "txn_[^/]+";

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

  // money.read — Spliteco's reads (SE-6).
  { name: "spliteco.me.home", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/me/home$`) },
  { name: "spliteco.me.groups", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/me/groups$`) },
  { name: "spliteco.me.activity", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/me/activity$`) },
  { name: "spliteco.me.search", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/me/search$`) },
  { name: "spliteco.me.friend", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/me/friends/usr_[^/]+$`) },
  { name: "spliteco.group", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/groups/${S_ORG}$`) },
  { name: "spliteco.group.activity", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/groups/${S_ORG}/activity$`) },
  { name: "spliteco.expense", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/expenses/${S_TXN}$`) },
  { name: "spliteco.insights", scopes: ["money.read"], methods: ["GET"], pattern: new RegExp(`${SPLITECO}/insights$`) },

  // money.write — Spliteco's expenses from a draft, comments and reminders; never a payment (SE-6).
  { name: "spliteco.drafts", scopes: ["money.write"], methods: ["POST"], pattern: new RegExp(`${SPLITECO}/drafts$`) },
  { name: "spliteco.draft.save", scopes: ["money.write"], methods: ["POST"], pattern: new RegExp(`${SPLITECO}/drafts/drf_[0-9a-f]{32}/save$`) },
  { name: "spliteco.expense.delete", scopes: ["money.write"], methods: ["DELETE"], pattern: new RegExp(`${SPLITECO}/expenses/${S_TXN}$`) },
  { name: "spliteco.expense.restore", scopes: ["money.write"], methods: ["POST"], pattern: new RegExp(`${SPLITECO}/expenses/${S_TXN}/restore$`) },
  { name: "spliteco.expense.comments", scopes: ["money.write"], methods: ["POST"], pattern: new RegExp(`${SPLITECO}/expenses/${S_TXN}/comments$`) },
  { name: "spliteco.reminders", scopes: ["money.write"], methods: ["POST"], pattern: new RegExp(`${SPLITECO}/reminders$`) },
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
