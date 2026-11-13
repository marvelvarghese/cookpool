import { createSqlExecutor } from "@saas/db/d1";
import { createTripecoRepository } from "@saas/db/tripeco";
import { ACTOR_DELEGATION_ID_HEADER } from "@saas/contracts/delegations";
import type { ActorContext, RequestContext, TripecoDeps } from "./context.js";
import type { Env } from "./env.js";
import {
  handleArchiveVehicle,
  handleCreateVehicle,
  handleDeleteFuel,
  handleDeleteRide,
  handleListRides,
  handleListVehicles,
  handleLogFuel,
  handleMe,
  handlePatchRide,
  handlePatchVehicle,
  handlePhoto,
  handlePutPhoto,
  handleRide,
  handleStartRide,
  handleVehicle,
} from "./handlers/drive.js";
import { errorResponse, methodNotAllowed, routeNotFound, successResponse, unauthenticated, unavailable } from "./http.js";
import { generateRequestId } from "./ids.js";

// Every route under /v1/tripeco/… (design §3), as api-edge's tripeco facade
// forwards it: the path and method unchanged, the actor in headers.

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Handler = (ctx: RequestContext, request: Request, params: string[], url: URL) => Promise<Response>;

interface Route {
  name: string;
  pattern: RegExp;
  methods: Partial<Record<Method, Handler>>;
}

const P = "^/v1/tripeco";
const ID = "([^/]+)";

export const ROUTES: Route[] = [
  { name: "tripeco.me", pattern: new RegExp(`${P}/me$`), methods: { GET: (ctx) => handleMe(ctx) } },
  {
    name: "tripeco.vehicles",
    pattern: new RegExp(`${P}/vehicles$`),
    methods: { GET: (ctx) => handleListVehicles(ctx), POST: (ctx, r) => handleCreateVehicle(ctx, r) },
  },
  {
    name: "tripeco.vehicle.fuel",
    pattern: new RegExp(`${P}/vehicles/${ID}/fuel$`),
    methods: { POST: (ctx, r, [veh]) => handleLogFuel(ctx, r, veh!) },
  },
  {
    name: "tripeco.vehicle",
    pattern: new RegExp(`${P}/vehicles/${ID}$`),
    methods: {
      GET: (ctx, _r, [veh]) => handleVehicle(ctx, veh!),
      PATCH: (ctx, r, [veh]) => handlePatchVehicle(ctx, r, veh!),
      DELETE: (ctx, _r, [veh]) => handleArchiveVehicle(ctx, veh!),
    },
  },
  { name: "tripeco.fuel", pattern: new RegExp(`${P}/fuel/${ID}$`), methods: { DELETE: (ctx, _r, [ful]) => handleDeleteFuel(ctx, ful!) } },
  {
    name: "tripeco.rides",
    pattern: new RegExp(`${P}/rides$`),
    methods: { GET: (ctx) => handleListRides(ctx), POST: (ctx, r) => handleStartRide(ctx, r) },
  },
  {
    name: "tripeco.ride.photos",
    pattern: new RegExp(`${P}/rides/${ID}/photos$`),
    methods: { POST: (ctx, r, [trp]) => handlePutPhoto(ctx, r, trp!) },
  },
  {
    name: "tripeco.ride",
    pattern: new RegExp(`${P}/rides/${ID}$`),
    methods: {
      GET: (ctx, _r, [trp]) => handleRide(ctx, trp!),
      PATCH: (ctx, r, [trp]) => handlePatchRide(ctx, r, trp!),
      DELETE: (ctx, _r, [trp]) => handleDeleteRide(ctx, trp!),
    },
  },
  { name: "tripeco.photo", pattern: new RegExp(`${P}/photos/${ID}$`), methods: { GET: (ctx, _r, [pho]) => handlePhoto(ctx, pho!) } },
];

const REQUEST_ID_RE = /^[\w-]{1,128}$/;

function resolveRequestId(request: Request): string {
  const header = request.headers.get("x-request-id");
  return header && REQUEST_ID_RE.test(header) ? header : generateRequestId();
}

/** The caller from api-edge's headers; null without them (401). */
export function resolveActor(request: Request): ActorContext | null {
  const subjectId = request.headers.get("x-actor-subject-id");
  const subjectType = request.headers.get("x-actor-subject-type");
  if (!subjectId || !subjectType) return null;
  return { subjectId, subjectType };
}

export async function route(request: Request, env: Env, deps: TripecoDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const requestId = resolveRequestId(request);
  try {
    if (url.pathname === "/health") {
      if (request.method !== "GET") return methodNotAllowed(requestId);
      return successResponse(
        {
          status: "ok",
          service: "tripeco-worker",
          environment: env.ENVIRONMENT ?? "local",
          timestamp: new Date().toISOString(),
          checks: { database: { configured: !!env.PLATFORM_DB }, spliteco: { configured: !!env.SPLITECO_WORKER } },
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
      // No assistant reaches Tripeco (api-edge lists no scope for it); refused here too.
      if (request.headers.get(ACTOR_DELEGATION_ID_HEADER)) {
        return errorResponse("forbidden", "Not available to an assistant", 403, requestId, { reason: "scope" });
      }
      if (!env.PLATFORM_DB) return unavailable(requestId);
      const email = request.headers.get("x-actor-email");
      const ctx: RequestContext = {
        env,
        requestId,
        actor,
        repo: createTripecoRepository(createSqlExecutor(env.PLATFORM_DB)),
        now: deps.now ?? (() => new Date()),
        actorHeaders() {
          const h = new Headers({ "x-request-id": requestId, "x-actor-subject-id": actor.subjectId, "x-actor-subject-type": actor.subjectType });
          if (email) h.set("x-actor-email", email);
          return h;
        },
      };
      return await handler(ctx, request, match.slice(1), url);
    }
    return routeNotFound(requestId, url.pathname);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
