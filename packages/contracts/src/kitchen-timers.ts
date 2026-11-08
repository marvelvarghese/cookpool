// Timers that find you (Cookpool, epic cookpool-guided: GC-3, design §4, §7).
//
// Guided mode sets a server timer whenever it starts one (a simmer, a rest)
// and cancels it on Pause, Done early or when the step is ticked. When it
// ends, kitchen-worker's per-minute cron asks notifications-worker to push it
// to every device the person has subscribed — no preference toggle: a timer
// is something they asked for. The push reaches a locked phone within a
// minute of the end; in the app, the page rings on time itself and cancels
// the server timer just before, so the phone is not pinged twice.
//
//   POST   /v1/kitchen/me/timers        self: set one   { label, body?, url?, endsAt } → 201 { timer }
//   GET    /v1/kitchen/me/timers        self: the active ones (not sent, not cancelled), soonest first
//   DELETE /v1/kitchen/me/timers/{tmr}  self: cancel it → 200 { timer }; a repeat answers the same;
//                                       anyone else's timer, or none, is the opaque 404
//
// Served by `apps/kitchen-worker` behind api-edge's kitchen facade, with the
// kitchen's envelopes (`{ data, meta }`; 422 `validation_failed` with field
// errors). This module is re-exported from `kitchen.ts`, so
// `@saas/contracts/kitchen` carries it too.

/** A label is the push's title: "Simmer · step 7". */
export const KITCHEN_TIMER_LABEL_MAX = 60;
/** A body is the push's text: "The oil shows at the edges". */
export const KITCHEN_TIMER_BODY_MAX = 120;
/** The app path a push opens is at most this long. */
export const KITCHEN_TIMER_URL_MAX = 200;
/** The soonest a timer may end: 30 seconds after it is set (the sweep runs once a minute). */
export const KITCHEN_TIMER_MIN_SECONDS = 30;
/** The latest a timer may end: a day after it is set (soaking rajma overnight fits). */
export const KITCHEN_TIMER_MAX_SECONDS = 24 * 60 * 60;
/** A person has at most this many active timers; one more is 422 `too_many_timers`. */
export const KITCHEN_TIMERS_MAX_ACTIVE = 10;
/** Where a timer's push opens when it names no path: the cooking session. */
export const KITCHEN_TIMER_DEFAULT_URL = "/cook/session";
/** A timer's push text when it has no body. */
export const KITCHEN_TIMER_DEFAULT_BODY = "Time's up";
/** The kind its push carries (`PushMessage.kind`); notifications-worker's PUSH_TO_SUBJECT_KINDS has it. */
export const KITCHEN_TIMER_PUSH_KIND = "kitchen.timer";

/** `details.reason` of a refused timer (422 `validation_failed`). */
export const KITCHEN_TIMER_ERROR_REASONS = {
  /** The person already has KITCHEN_TIMERS_MAX_ACTIVE active timers (`details.max`). Cancel one first. */
  TOO_MANY_TIMERS: "too_many_timers",
} as const;

export type KitchenTimerErrorReason = (typeof KITCHEN_TIMER_ERROR_REASONS)[keyof typeof KITCHEN_TIMER_ERROR_REASONS];

/**
 * An app path a push may open: one leading "/", never "//" (another host),
 * no backslash, whitespace or control character, at most
 * KITCHEN_TIMER_URL_MAX characters.
 */
export function isKitchenTimerUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= KITCHEN_TIMER_URL_MAX &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\s\\\u0000-\u001f\u007f]/.test(value)
  );
}

/** One timer. `tmr_…` is its id. */
export interface KitchenTimer {
  id: string;
  /** The push's title. */
  label: string;
  /** The push's text; null when it uses KITCHEN_TIMER_DEFAULT_BODY. */
  body: string | null;
  /** The app path its push opens. */
  url: string;
  /** ISO 8601. */
  endsAt: string;
  createdAt: string;
  /** When the server pushed it (or tried to); null until it ends. */
  sentAt: string | null;
  /** When it was cancelled; null while it is not. */
  canceledAt: string | null;
}

/**
 * POST /v1/kitchen/me/timers. `endsAt` is an ISO 8601 instant
 * KITCHEN_TIMER_MIN_SECONDS to KITCHEN_TIMER_MAX_SECONDS ahead of now;
 * `label` 1–60 characters, `body` 1–120 (trimmed), `url` an app path
 * (KITCHEN_TIMER_DEFAULT_URL when left out).
 */
export interface CreateKitchenTimerRequest {
  label: string;
  body?: string | null;
  url?: string | null;
  endsAt: string;
}

/** POST (201) and DELETE (200) /v1/kitchen/me/timers… → `data`. */
export interface KitchenTimerResponse {
  timer: KitchenTimer;
}

/** GET /v1/kitchen/me/timers → `data`: the active timers, soonest first. */
export interface KitchenTimersResponse {
  timers: KitchenTimer[];
}
