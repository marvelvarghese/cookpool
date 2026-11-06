// Console-side glue for `@saas/sdk` (Task 0104).
//
// The hand-rolled fetch/decode/envelope client that used to live here was
// deleted; all wire I/O now goes through the typed `Cookpool` resource
// clients in `@saas/sdk`. This file keeps only what is intrinsically a
// console concern:
//
//   - `ApiTarget` / `apiTargets` / `deployEnv` / `isLocked` — the multi-target
//     switcher the console exposes for stage/prod parity testing. The SDK
//     deliberately doesn't carry "which environment am I pointed at",
//     because that's a deployment-shape decision.
//   - `createClient` — constructs a `Cookpool` against a target, wired
//     to a bearer token (or none).
//   - `ApiResult<T>` / `ApiErrorBody` / `wrap` — the result-envelope shape
//     `useAsync` and the precondition-failed UX consume. `wrap` adapts a
//     `Promise<T>` + thrown `CookpoolError` into the same shape the
//     old hand-rolled client produced, so call-site ergonomics are
//     unchanged. NO route strings, NO header building, NO JSON decoding
//     happens here — that all comes from the SDK.

import { Cookpool, CookpoolError, type ClientOptions } from "@saas/sdk";
import { OfflineError, connection, watchedFetch } from "./connection";
import {
  DEPLOY_ENVIRONMENTS,
  apiEdgeWorkersDevUrl,
  appConfig,
  environmentFromHost,
  type AppConfig,
} from "./app-config";

export type ApiClient = Cookpool;

export interface ApiTarget {
  name: string;
  /** Where the app sends its API calls (see {@link sameOriginTarget}). */
  url: string;
  /**
   * api-edge's own address, the environment's workers.dev API. OAuth sign-in
   * starts there: the provider returns to it, and the start's state cookie is
   * that host's (Cookpool SM-4).
   */
  directUrl: string;
}

/**
 * Where the console Worker answers the API on the app's own address
 * (Cookpool SM-4): it forwards `/api/*` to api-edge over a service binding
 * (src/worker/api-forward.mjs).
 */
export const SAME_ORIGIN_API_PATH = "/api";

/** Every API target this console can talk to, under the config in force: the workers.dev APIs. */
export function allTargets(config: AppConfig = appConfig()): ApiTarget[] {
  return DEPLOY_ENVIRONMENTS.map((name) => {
    const url = apiEdgeWorkersDevUrl(name, config);
    return { name, url, directUrl: url };
  });
}

/** The single environment this deploy serves, when it is locked to one. */
export function deployEnv(config: AppConfig = appConfig()): string | undefined {
  return config.deployEnv;
}

/** This page's origin, in a browser. */
function pageOrigin(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location?.origin;
}

/**
 * `target` as a page on `origin` reaches it. A host that one environment's
 * console Worker serves names that environment itself (its custom domain, or
 * its `-<env>` workers.dev host), and that Worker answers the API on the
 * page's own origin, `/api`: same origin, so no request ever waits for a CORS
 * preflight (Cookpool SM-4). Anywhere else (localhost, a dev server, a host
 * that names no environment or another one) there is no such Worker, and the
 * calls go to the environment's workers.dev API, as before. Pure.
 */
export function sameOriginTarget(target: ApiTarget, config: AppConfig, origin: string | undefined): ApiTarget {
  if (!origin) return target;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return target;
  }
  if (environmentFromHost(host, config.customDomains) !== target.name) return target;
  return { ...target, url: `${origin}${SAME_ORIGIN_API_PATH}` };
}

/**
 * The targets the user may pick: only the deploy's own when it is locked,
 * reached on the page's own origin when its host serves it (`origin`, the
 * page's by default).
 */
export function apiTargets(config: AppConfig = appConfig(), origin: string | undefined = pageOrigin()): ApiTarget[] {
  const env = deployEnv(config);
  const all = allTargets(config);
  return env ? all.filter((t) => t.name === env).map((t) => sameOriginTarget(t, config, origin)) : all;
}

/** True when this deploy serves exactly one environment (no target switcher). */
export function isLocked(config: AppConfig = appConfig()): boolean {
  return apiTargets(config).length === 1 && !!deployEnv(config);
}

export interface ApiErrorBody {
  code: string;
  message: string;
  reason?: string | undefined;
  details?: Record<string, unknown> | undefined;
  requestId?: string | undefined;
}

export type ApiResult<T> =
  | { ok: true; data: T; meta: { requestId: string; cursor: string | null } }
  | { ok: false; error: ApiErrorBody; status: number };

/**
 * A `Cookpool` client for `target`, sending `token` when there is one.
 * `onUnauthorized` (Cookpool SI-5) is told when the API answers 401 to a
 * request that carried the token — the session has ended (expired, revoked).
 * Requests sent without a credential (the signed-out join preview) never
 * report.
 *
 * Every client's calls go through the connection (Cookpool PW-4,
 * `lib/connection.ts`): while offline a write is refused before anything is
 * sent (it comes back as a `network_error` with `reason: "offline"`), and
 * each call's outcome — answered by the network, by the service worker's
 * cache, or not at all — drives the offline banner.
 */
export function createClient(
  target: ApiTarget,
  token: string | null,
  onUnauthorized?: () => void,
): Cookpool {
  // OAuth's start stays on api-edge's own host, where its callback lands.
  const report = token && onUnauthorized ? onUnauthorized : null;
  const opts: ClientOptions = {
    baseUrl: target.url,
    oauthBaseUrl: target.directUrl,
    fetch: watchedFetch(connection, (response, init) => {
      if (report && response.status === 401 && new Headers(init?.headers).has("authorization")) report();
    }),
  };
  if (token) opts.auth = { kind: "bearer", token };
  return new Cookpool(opts);
}

/**
 * Adapt an SDK promise into the `ApiResult<T>` envelope. Typed
 * `CookpoolError` subclasses surface as `{ ok: false }` carrying the
 * same `code`/`message`/`reason`/`details`/`requestId` fields the
 * precondition-failed insight UX depends on. Network errors collapse to
 * `code: "network_error"` to match the old shape.
 */
export async function wrap<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, meta: { requestId: "", cursor: null } };
  } catch (e) {
    if (e instanceof CookpoolError) {
      const body: ApiErrorBody = {
        code: e.code,
        message: e.message,
        details: e.details,
        requestId: e.requestId,
      };
      const reason = e.details["reason"];
      if (typeof reason === "string") body.reason = reason;
      return { ok: false, status: e.status, error: body };
    }
    // A write held back offline (PW-4) says so in its one line.
    if (e instanceof OfflineError) {
      return { ok: false, status: 0, error: { code: "network_error", reason: "offline", message: e.message } };
    }
    return {
      ok: false,
      status: 0,
      error: {
        code: "network_error",
        message: (e as Error).message ?? "network unreachable",
      },
    };
  }
}
