// Push to a subject (Cookpool GC-3): one message to every device of one
// person, for a push they asked for themselves — a timer they set.
//
//   POST /v1/notifications/push-to-subject  { subjectId, message: { kind, title, body, url, tag } }
//     → 200 { devices, sent, gone, failed, skipped? }
//
// Internal only, and narrower than the rest of this worker: the person is
// named in the body, not pinned by the edge, so only a worker in
// PUSH_TO_SUBJECT_INTERNAL_ACTORS (kitchen-worker's timer sweep) may call it —
// any other caller, api-edge included, is 403 — and api-edge's notifications
// facade does not list the path. There is no preference check: the kinds it
// carries (PUSH_TO_SUBJECT_KINDS) are never ones a person turns off.

import {
  PUSH_MESSAGE_MAX_BYTES,
  PUSH_TO_SUBJECT_INTERNAL_ACTORS,
  PUSH_TO_SUBJECT_KINDS,
  PUSH_TO_SUBJECT_LIMITS,
  type PushMessage,
  type PushToSubjectKind,
  type PushToSubjectResponse,
} from "@saas/contracts/notifications";
import type { Env } from "../env.js";
import { errorResponse, successResponse, validationError } from "../http.js";
import { pushToDevices } from "../push/deliver.js";
import { loadVapidKeys } from "../push/vapid.js";
import type { InternalActor } from "../router.js";
import { readBody, withSubscriptions, type PushRouteDeps } from "./push.js";

export interface PushToSubjectDeps extends PushRouteDeps {
  /** The fan-out: pushToDevices unless a test watches what it is handed. */
  push?: typeof pushToDevices;
}

const CALLERS: ReadonlySet<string> = new Set(PUSH_TO_SUBJECT_INTERNAL_ACTORS);

/** A person's public id, as the kitchen keeps it (`usr_…`). */
const SUBJECT_ID_RE = /^[A-Za-z0-9][\w-]{0,127}$/;
/** An app path: one leading "/", no backslash, whitespace or control character. */
const APP_PATH_RE = /^\/(?!\/)[^\s\\\u0000-\u001f\u007f]*$/;

type Checked = { ok: true; subjectId: string; message: PushMessage } | { ok: false; fields: Record<string, string[]> };

function textField(
  fields: Record<string, string[]>,
  name: keyof typeof PUSH_TO_SUBJECT_LIMITS,
  value: unknown,
): string | undefined {
  const max = PUSH_TO_SUBJECT_LIMITS[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    fields[`message.${name}`] = ["Must be non-empty text"];
    return undefined;
  }
  if (value.length > max) {
    fields[`message.${name}`] = [`Must be at most ${max} characters`];
    return undefined;
  }
  return value;
}

/** The body, checked: a subject, and a message of a kind this route carries with every field bounded. */
export function checkPushToSubject(body: Record<string, unknown>): Checked {
  const fields: Record<string, string[]> = {};
  const subjectId = typeof body.subjectId === "string" && SUBJECT_ID_RE.test(body.subjectId) ? body.subjectId : undefined;
  if (!subjectId) fields.subjectId = ["Must be a person's id"];

  const raw = body.message;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fields.message = ["Must be an object with kind, title, body, url and tag"];
    return { ok: false, fields };
  }
  const m = raw as Record<string, unknown>;
  const kind = (PUSH_TO_SUBJECT_KINDS as readonly unknown[]).includes(m.kind) ? (m.kind as PushToSubjectKind) : undefined;
  if (!kind) fields["message.kind"] = [`Must be one of: ${PUSH_TO_SUBJECT_KINDS.join(", ")}`];
  const title = textField(fields, "title", m.title);
  const text = textField(fields, "body", m.body);
  const url = textField(fields, "url", m.url);
  if (url !== undefined && !APP_PATH_RE.test(url)) fields["message.url"] = ["Must be a path in the app, starting with one /"];
  const tag = textField(fields, "tag", m.tag);
  if (!subjectId || !kind || title === undefined || text === undefined || url === undefined || tag === undefined || fields["message.url"]) {
    return { ok: false, fields };
  }

  // Only these five fields travel: nothing else the caller sent reaches a device.
  const message: PushMessage = { kind, title, body: text, url, tag };
  if (new TextEncoder().encode(JSON.stringify(message)).length > PUSH_MESSAGE_MAX_BYTES) {
    return { ok: false, fields: { message: [`Must be at most ${PUSH_MESSAGE_MAX_BYTES} bytes as JSON`] } };
  }
  return { ok: true, subjectId, message };
}

export async function handlePushToSubject(
  request: Request,
  env: Env,
  requestId: string,
  actor: InternalActor,
  deps?: PushToSubjectDeps,
): Promise<Response> {
  if (!CALLERS.has(actor.internalCaller)) {
    return errorResponse("forbidden", "Not a caller of this route", 403, requestId);
  }
  const body = await readBody(request, requestId);
  if (body instanceof Response) return body;
  const checked = checkPushToSubject(body);
  if (!checked.ok) return validationError(requestId, checked.fields);

  return withSubscriptions(env, requestId, deps, async (repo) => {
    const summary = await (deps?.push ?? pushToDevices)(
      {
        subscriptions: repo,
        keys: deps?.keys ?? (() => loadVapidKeys(env)),
        fetch: deps?.fetch ?? ((input, init) => fetch(input, init)),
        now: deps?.now ?? (() => new Date()),
      },
      checked.subjectId,
      checked.message,
    );
    // The devices could not be read: say so, rather than "no devices".
    if (summary.skipped === "unreadable") {
      return errorResponse("internal_error", "The devices could not be read", 503, requestId);
    }
    const response: PushToSubjectResponse = {
      devices: summary.devices,
      sent: summary.sent,
      gone: summary.gone,
      failed: summary.failed,
      ...(summary.skipped ? { skipped: summary.skipped } : {}),
    };
    return successResponse(response, requestId);
  });
}
