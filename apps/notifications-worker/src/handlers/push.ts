// Web Push routes (Cookpool PW-5), internal like the rest of this worker;
// api-edge exposes them with the subject pinned to the session.
//
//   POST   /v1/notifications/push-subscriptions  { endpoint, keys: { p256dh, auth } }
//   DELETE /v1/notifications/push-subscriptions  { endpoint }
//   GET    /v1/notifications/push-key            → { publicKey }
//   POST   /v1/notifications/push-test           [{ endpoint }]
//
// The person is the actor (`x-actor-subject-id`, a user), never a body
// field: whoever calls adds, renews and removes only their own devices.

import type { Env } from "../env.js";
import type { InternalActor } from "../router.js";
import {
  PUSH_ENDPOINT_MAX_LENGTH,
  PUSH_SUBSCRIPTIONS_MAX_PER_PERSON,
  type PushDevice,
  type PushKeyResponse,
  type PushSubscriptionResponse,
  type PushTestResponse,
  type UnsubscribePushResponse,
} from "@saas/contracts/notifications";
import { createSqlExecutor } from "@saas/db/d1";
import {
  createPushSubscriptionsRepository,
  type PushSubscriptionsRepository,
  type StoredPushSubscription,
} from "@saas/db/notifications";
import { errorResponse, successResponse, validationError, logUnexpected } from "../http.js";
import { base64urlDecode, importP256PublicKey, isUncompressedP256 } from "../push/crypto.js";
import { pushToDevices } from "../push/deliver.js";
import { loadVapidKeys, logPushOff, type VapidLoad } from "../push/vapid.js";
import { testPushMessage } from "../templates/push.js";
import { deviceLabel } from "../push/device-label.js";

export interface PushRouteDeps {
  subscriptions?: PushSubscriptionsRepository;
  keys?: () => Promise<VapidLoad>;
  fetch?: typeof fetch;
  now?: () => Date;
  generateUuid?: () => string;
}

/** Push subscriptions are a person's own: the caller must be a user. */
function personOf(actor: InternalActor, requestId: string): string | Response {
  if (actor.subjectType !== "user" || !actor.subjectId) {
    return errorResponse("forbidden", "Push subscriptions belong to a signed-in person", 403, requestId);
  }
  return actor.subjectId;
}

async function readBody(request: Request, requestId: string): Promise<Record<string, unknown> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return validationError(requestId, { _root: ["Body must be a JSON object"] });
  }
  return body as Record<string, unknown>;
}

/** An endpoint we will POST to: https, no credentials in it, of a sane length. */
export function endpointProblem(value: unknown): string | null {
  if (typeof value !== "string" || !value) return "Required";
  if (value.length > PUSH_ENDPOINT_MAX_LENGTH) return `At most ${PUSH_ENDPOINT_MAX_LENGTH} characters`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Must be a URL";
  }
  if (url.protocol !== "https:") return "Must be an https: URL";
  if (url.username || url.password) return "Must not carry credentials";
  return null;
}

/** The subscription's keys, decoded and checked: p256dh a P-256 point, auth 16 bytes. */
async function keysProblems(keys: unknown): Promise<Record<string, string[]>> {
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) return { keys: ["Must be an object with p256dh and auth"] };
  const { p256dh, auth } = keys as Record<string, unknown>;
  const errors: Record<string, string[]> = {};
  const point = typeof p256dh === "string" ? base64urlDecode(p256dh) : null;
  let validPoint = isUncompressedP256(point);
  if (validPoint) {
    try {
      await importP256PublicKey(point!, "ecdh");
    } catch {
      validPoint = false;
    }
  }
  if (!validPoint) errors["keys.p256dh"] = ["Must be base64url of an uncompressed P-256 key (65 bytes)"];
  const secret = typeof auth === "string" ? base64urlDecode(auth) : null;
  if (!secret || secret.length !== 16) errors["keys.auth"] = ["Must be base64url of 16 bytes"];
  return errors;
}

function toDevice(s: StoredPushSubscription): PushDevice {
  return {
    endpoint: s.endpoint,
    label: s.userAgent,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    lastSuccessAt: s.lastSuccessAt ? s.lastSuccessAt.toISOString() : null,
    lastFailureAt: s.lastFailureAt ? s.lastFailureAt.toISOString() : null,
  };
}

/** Run `fn` with the subscriptions repository: the injected one, or D1's. */
async function withSubscriptions(
  env: Env,
  requestId: string,
  deps: PushRouteDeps | undefined,
  fn: (repo: PushSubscriptionsRepository) => Promise<Response>,
): Promise<Response> {
  if (deps?.subscriptions) return fn(deps.subscriptions);
  if (!env.PLATFORM_DB) return errorResponse("internal_error", "Database not configured", 503, requestId);
  const executor = createSqlExecutor(env.PLATFORM_DB);
  try {
    return await fn(createPushSubscriptionsRepository(executor));
  } catch (err) {
    logUnexpected("push", requestId, err);
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  } finally {
    await executor.dispose();
  }
}

export async function handleSubscribePush(
  request: Request,
  env: Env,
  requestId: string,
  actor: InternalActor,
  deps?: PushRouteDeps,
): Promise<Response> {
  const person = personOf(actor, requestId);
  if (typeof person !== "string") return person;
  const body = await readBody(request, requestId);
  if (body instanceof Response) return body;

  const errors: Record<string, string[]> = {};
  const endpoint = endpointProblem(body.endpoint);
  if (endpoint) errors.endpoint = [endpoint];
  Object.assign(errors, await keysProblems(body.keys));
  if (Object.keys(errors).length > 0) return validationError(requestId, errors);
  const keys = body.keys as { p256dh: string; auth: string };

  return withSubscriptions(env, requestId, deps, async (repo) => {
    const upserted = await repo.upsert({
      id: (deps?.generateUuid ?? (() => crypto.randomUUID()))(),
      subjectId: person,
      endpoint: body.endpoint as string,
      p256dh: keys.p256dh.replace(/=+$/, ""),
      auth: keys.auth.replace(/=+$/, ""),
      userAgent: deviceLabel(request.headers.get("user-agent")),
      now: (deps?.now ?? (() => new Date()))(),
      maxPerSubject: PUSH_SUBSCRIPTIONS_MAX_PER_PERSON,
    });
    if (!upserted.ok) return errorResponse("internal_error", "Failed to save the subscription", 500, requestId);
    const response: PushSubscriptionResponse = { subscription: toDevice(upserted.value.subscription) };
    return successResponse(response, requestId);
  });
}

export async function handleUnsubscribePush(
  request: Request,
  env: Env,
  requestId: string,
  actor: InternalActor,
  deps?: PushRouteDeps,
): Promise<Response> {
  const person = personOf(actor, requestId);
  if (typeof person !== "string") return person;
  const body = await readBody(request, requestId);
  if (body instanceof Response) return body;
  if (typeof body.endpoint !== "string" || !body.endpoint || body.endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) {
    return validationError(requestId, { endpoint: ["Required"] });
  }
  const endpoint = body.endpoint;

  return withSubscriptions(env, requestId, deps, async (repo) => {
    const removed = await repo.deleteForSubject(person, endpoint);
    if (!removed.ok) return errorResponse("internal_error", "Failed to remove the subscription", 500, requestId);
    const response: UnsubscribePushResponse = { removed: removed.value };
    return successResponse(response, requestId);
  });
}

/** The public key the app subscribes with — null while push is off here. */
export async function handleGetPushKey(env: Env, requestId: string, deps?: PushRouteDeps): Promise<Response> {
  const loaded = await (deps?.keys ?? (() => loadVapidKeys(env)))();
  if (!loaded.ok) logPushOff(loaded.problem);
  const response: PushKeyResponse = { publicKey: loaded.ok ? loaded.keys.publicKey : null };
  return successResponse(response, requestId);
}

/** "Send me a test": a push to the caller's own devices, or one of them. */
export async function handlePushTest(
  request: Request,
  env: Env,
  requestId: string,
  actor: InternalActor,
  deps?: PushRouteDeps,
): Promise<Response> {
  const person = personOf(actor, requestId);
  if (typeof person !== "string") return person;
  let endpoint: string | undefined;
  const text = await request.text();
  if (text.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return errorResponse("bad_request", "Invalid JSON body", 400, requestId);
    }
    const value = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).endpoint : undefined;
    if (value !== undefined) {
      if (typeof value !== "string" || !value) return validationError(requestId, { endpoint: ["Must be a string"] });
      endpoint = value;
    }
  }

  const keys = deps?.keys ?? (() => loadVapidKeys(env));
  const loaded = await keys();
  if (!loaded.ok) {
    logPushOff(loaded.problem);
    return errorResponse("unsupported", "Push notifications are not set up here", 503, requestId);
  }
  return withSubscriptions(env, requestId, deps, async (repo) => {
    const summary = await pushToDevices(
      {
        subscriptions: repo,
        keys: async () => loaded,
        fetch: deps?.fetch ?? ((input, init) => fetch(input, init)),
        now: deps?.now ?? (() => new Date()),
      },
      person,
      testPushMessage(person),
      endpoint,
    );
    const response: PushTestResponse = {
      devices: summary.devices,
      sent: summary.sent,
      gone: summary.gone,
      failed: summary.failed,
    };
    return successResponse(response, requestId);
  });
}
