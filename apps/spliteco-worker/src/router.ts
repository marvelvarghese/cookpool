import { createTimings } from "@saas/contracts/timing";
import { resolveActor } from "./authz.js";
import type { RequestContext, SplitecoDeps } from "./context.js";
import type { Env } from "./env.js";
import { handleGroupActivity, handleMyActivity } from "./handlers/activity.js";
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
  {
    name: "spliteco.me.friend.direct",
    pattern: new RegExp(`${P}/me/friends/${ID}/direct$`),
    methods: { POST: (ctx, _r, [usr]) => handleDirectGroup(ctx, usr!) },
  },
  { name: "spliteco.me.friend", pattern: new RegExp(`${P}/me/friends/${ID}$`), methods: { GET: (ctx, _r, [usr]) => handleFriend(ctx, usr!) } },
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
  { name: "spliteco.group", pattern: new RegExp(`${P}/groups/${ID}$`), methods: { GET: (ctx, _r, [org]) => handleGroup(ctx, org!) } },
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
      const ctx: RequestContext = {
        env,
        requestId,
        actor,
        timings: createTimings(),
        now: deps.now ?? (() => new Date()),
        groups: createGroups(env.MEMBERSHIP_WORKER, requestId),
        people: createPeople(env.IDENTITY_WORKER, requestId),
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
