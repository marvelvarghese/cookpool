import { createTimings } from "@saas/contracts/timing";
import { resolveActor } from "./authz.js";
import type { RequestContext, SplitecoDeps } from "./context.js";
import type { Env } from "./env.js";
import { handleGroupActivity, handleMyActivity } from "./handlers/activity.js";
import { handleCreateDraft, handleSaveDraft } from "./handlers/drafts.js";
import { handleSearch } from "./handlers/search.js";
import { delegatedRefusal } from "./delegated.js";
import { handleAddComment, handleExpense } from "./handlers/expense.js";
import {
  handleCreateExpense,
  handleDeleteExpense,
  handleEditExpense,
  handleMoveExpense,
  handleRestoreExpense,
} from "./handlers/expenses.js";
import { handleCreateGroup, handleDirectGroup, handleFriend, handleGroup, handleGroups, handleHome } from "./handlers/groups.js";
import { handleExport, handleInsights } from "./handlers/insights.js";
import { handleGetProfile, handlePutProfile, handleSendReminder } from "./handlers/reminders.js";
import { handleLive, handleLiveClaim, handleLiveLock, handleOpenLive } from "./handlers/live.js";
import { handleCreateSettlement, handleGroupSettings, handleNotReceived, handleSettlePlan } from "./handlers/settle.js";
import { errorResponse, methodNotAllowed, routeNotFound, successResponse, unauthenticated, withTimings } from "./http.js";
import { createPeople } from "./identity-client.js";
import { generateRequestId } from "./ids.js";
import { createGroups } from "./membership.js";

// Every route under /v1/spliteco/… (design §2), as api-edge's spliteco facade
// forwards it: the path and method unchanged, the actor in headers.

type Method = "GET" | "POST" | "PUT" | "DELETE";
type Handler = (ctx: RequestContext, request: Request, params: string[], url: URL) => Promise<Response>;

interface Route {
  name: string;
  pattern: RegExp;
  methods: Partial<Record<Method, Handler>>;
}

const P = "^/v1/spliteco";
const ID = "([^/]+)";

const ROUTES: Route[] = [
  { name: "spliteco.me.home", pattern: new RegExp(`${P}/me/home$`), methods: { GET: (ctx) => handleHome(ctx) } },
  { name: "spliteco.me.groups", pattern: new RegExp(`${P}/me/groups$`), methods: { GET: (ctx) => handleGroups(ctx) } },
  { name: "spliteco.me.activity", pattern: new RegExp(`${P}/me/activity$`), methods: { GET: (ctx) => handleMyActivity(ctx) } },
  // SE5: search, and an assistant's drafts.
  { name: "spliteco.me.search", pattern: new RegExp(`${P}/me/search$`), methods: { GET: (ctx, _r, _p, url) => handleSearch(ctx, url) } },
  { name: "spliteco.drafts", pattern: new RegExp(`${P}/drafts$`), methods: { POST: (ctx, r) => handleCreateDraft(ctx, r) } },
  {
    name: "spliteco.draft.save",
    pattern: new RegExp(`${P}/drafts/${ID}/save$`),
    methods: { POST: (ctx, r, [drf]) => handleSaveDraft(ctx, r, drf!) },
  },
  {
    name: "spliteco.me.friend.direct",
    pattern: new RegExp(`${P}/me/friends/${ID}/direct$`),
    methods: { POST: (ctx, _r, [usr]) => handleDirectGroup(ctx, usr!) },
  },
  { name: "spliteco.me.friend", pattern: new RegExp(`${P}/me/friends/${ID}$`), methods: { GET: (ctx, _r, [usr]) => handleFriend(ctx, usr!) } },
  {
    name: "spliteco.me.profile",
    pattern: new RegExp(`${P}/me/profile$`),
    methods: { GET: (ctx) => handleGetProfile(ctx), PUT: (ctx, r) => handlePutProfile(ctx, r) },
  },
  // SE2: settle up, the plan, the simplify switch, not received, reminders.
  {
    name: "spliteco.group.settlements",
    pattern: new RegExp(`${P}/groups/${ID}/settlements$`),
    methods: { POST: (ctx, r, [org]) => handleCreateSettlement(ctx, r, org!) },
  },
  {
    name: "spliteco.group.settle_plan",
    pattern: new RegExp(`${P}/groups/${ID}/settle-plan$`),
    methods: { GET: (ctx, _r, [org], url) => handleSettlePlan(ctx, org!, url) },
  },
  {
    name: "spliteco.group.settings",
    pattern: new RegExp(`${P}/groups/${ID}/settings$`),
    methods: { PUT: (ctx, r, [org]) => handleGroupSettings(ctx, r, org!) },
  },
  {
    name: "spliteco.settlement.not_received",
    pattern: new RegExp(`${P}/settlements/${ID}/not-received$`),
    methods: { POST: (ctx, r, [txn]) => handleNotReceived(ctx, r, txn!) },
  },
  { name: "spliteco.reminders", pattern: new RegExp(`${P}/reminders$`), methods: { POST: (ctx, r) => handleSendReminder(ctx, r) } },
  // SE4: live split.
  {
    name: "spliteco.group.live",
    pattern: new RegExp(`${P}/groups/${ID}/live$`),
    methods: { POST: (ctx, r, [org]) => handleOpenLive(ctx, r, org!) },
  },
  {
    name: "spliteco.live.claims",
    pattern: new RegExp(`${P}/live/${ID}/claims$`),
    methods: { POST: (ctx, r, [code]) => handleLiveClaim(ctx, r, code!) },
  },
  {
    name: "spliteco.live.lock",
    pattern: new RegExp(`${P}/live/${ID}/lock$`),
    methods: { POST: (ctx, _r, [code]) => handleLiveLock(ctx, code!) },
  },
  { name: "spliteco.live", pattern: new RegExp(`${P}/live/${ID}$`), methods: { GET: (ctx, _r, [code]) => handleLive(ctx, code!) } },
  { name: "spliteco.groups", pattern: new RegExp(`${P}/groups$`), methods: { POST: (ctx, r) => handleCreateGroup(ctx, r) } },
  {
    name: "spliteco.group.expenses",
    pattern: new RegExp(`${P}/groups/${ID}/expenses$`),
    methods: { POST: (ctx, r, [org]) => handleCreateExpense(ctx, r, org!) },
  },
  {
    name: "spliteco.group.activity",
    pattern: new RegExp(`${P}/groups/${ID}/activity$`),
    methods: { GET: (ctx, _r, [org]) => handleGroupActivity(ctx, org!) },
  },
  {
    name: "spliteco.group.export",
    pattern: new RegExp(`${P}/groups/${ID}/export\\.(csv|json)$`),
    methods: { GET: (ctx, _r, [org, format]) => handleExport(ctx, org!, format as "csv" | "json") },
  },
  { name: "spliteco.group", pattern: new RegExp(`${P}/groups/${ID}$`), methods: { GET: (ctx, _r, [org], url) => handleGroup(ctx, org!, url) } },
  {
    name: "spliteco.expense.restore",
    pattern: new RegExp(`${P}/expenses/${ID}/restore$`),
    methods: { POST: (ctx, r, [txn]) => handleRestoreExpense(ctx, r, txn!) },
  },
  {
    name: "spliteco.expense.move",
    pattern: new RegExp(`${P}/expenses/${ID}/move$`),
    methods: { POST: (ctx, r, [txn]) => handleMoveExpense(ctx, r, txn!) },
  },
  {
    name: "spliteco.expense.comments",
    pattern: new RegExp(`${P}/expenses/${ID}/comments$`),
    methods: { POST: (ctx, r, [txn]) => handleAddComment(ctx, r, txn!) },
  },
  {
    name: "spliteco.expense",
    pattern: new RegExp(`${P}/expenses/${ID}$`),
    methods: {
      GET: (ctx, _r, [txn]) => handleExpense(ctx, txn!),
      PUT: (ctx, r, [txn]) => handleEditExpense(ctx, r, txn!),
      DELETE: (ctx, r, [txn]) => handleDeleteExpense(ctx, r, txn!),
    },
  },
  { name: "spliteco.insights", pattern: new RegExp(`${P}/insights$`), methods: { GET: (ctx, _r, _p, url) => handleInsights(ctx, url) } },
];

/** Work after the response: handed to `waitUntil` when there is one, else run before the response. Never throws. */
export function deferrer(deps: Pick<SplitecoDeps, "waitUntil">): RequestContext["defer"] {
  return async (work) => {
    const run = (async () => {
      try {
        await work();
      } catch {
        /* best-effort */
      }
    })();
    if (deps.waitUntil) deps.waitUntil(run);
    else await run;
  };
}

const REQUEST_ID_RE = /^[\w-]{1,128}$/;

function resolveRequestId(request: Request): string {
  const header = request.headers.get("x-request-id");
  return header && REQUEST_ID_RE.test(header) ? header : generateRequestId();
}

export async function route(request: Request, env: Env, deps: SplitecoDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const requestId = resolveRequestId(request);
  try {
    if (url.pathname === "/health") {
      if (request.method !== "GET") return methodNotAllowed(requestId);
      return successResponse(
        {
          status: "ok",
          service: "spliteco-worker",
          environment: env.ENVIRONMENT ?? "local",
          timestamp: new Date().toISOString(),
          checks: {
            database: { configured: !!env.PLATFORM_DB },
            membership: { configured: !!env.MEMBERSHIP_WORKER },
            policy: { configured: !!env.POLICY_WORKER },
            identity: { configured: !!env.IDENTITY_WORKER },
            notifications: { configured: !!env.NOTIFICATIONS_WORKER },
          },
        },
        requestId,
      );
    }
    for (const r of ROUTES) {
      const match = url.pathname.match(r.pattern);
      if (!match) continue;
      const handler = Object.hasOwn(r.methods, request.method) ? r.methods[request.method as Method] : undefined;
      if (!handler) return methodNotAllowed(requestId);
      const actor = resolveActor(request);
      if (!actor) return unauthenticated(requestId);
      // SE-6: an assistant reaches only what its scopes allow here, whatever api-edge let through.
      const refused = delegatedRefusal(actor, `${r.name}.${request.method.toLowerCase()}`, requestId);
      if (refused) return refused;
      const ctx: RequestContext = {
        env,
        requestId,
        actor,
        timings: createTimings(),
        now: deps.now ?? (() => new Date()),
        groups: createGroups(env.MEMBERSHIP_WORKER, requestId),
        people: createPeople(env.IDENTITY_WORKER, requestId),
        defer: deferrer(deps),
      };
      const endTotal = ctx.timings.start("total");
      const response = await handler(ctx, request, match.slice(1), url);
      endTotal();
      return withTimings(response, requestId, `${r.name}.${request.method.toLowerCase()}`, ctx.timings);
    }
    return routeNotFound(requestId, url.pathname);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
