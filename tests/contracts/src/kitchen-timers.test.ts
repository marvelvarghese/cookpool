// Timers that find you in the contract (Cookpool GC-3, cookpool-guided
// design §4): the bounds a timer is set within, the app paths its push may
// open, its push kind — the one kind notifications-worker pushes to a subject,
// never a preference kind — and the shapes of the routes.

import {
  KITCHEN_TIMERS_MAX_ACTIVE,
  KITCHEN_TIMER_BODY_MAX,
  KITCHEN_TIMER_DEFAULT_BODY,
  KITCHEN_TIMER_DEFAULT_URL,
  KITCHEN_TIMER_ERROR_REASONS,
  KITCHEN_TIMER_LABEL_MAX,
  KITCHEN_TIMER_MAX_SECONDS,
  KITCHEN_TIMER_MIN_SECONDS,
  KITCHEN_TIMER_PUSH_KIND,
  KITCHEN_TIMER_URL_MAX,
  KITCHEN_ERROR_REASONS,
  isKitchenTimerUrl,
  type CreateKitchenTimerRequest,
  type KitchenTimer,
  type KitchenTimerResponse,
  type KitchenTimersResponse,
} from "@saas/contracts/kitchen";
import * as timers from "@saas/contracts/kitchen-timers";
import {
  NOTIFICATION_KINDS,
  PUSH_MESSAGE_MAX_BYTES,
  PUSH_TO_SUBJECT_INTERNAL_ACTORS,
  PUSH_TO_SUBJECT_KINDS,
  PUSH_TO_SUBJECT_LIMITS,
  PUSH_TO_SUBJECT_PATH,
  NOTIFICATIONS_INTERNAL_ACTOR_VALUES,
  isNotificationKind,
  type PushMessage,
  type PushToSubjectRequest,
  type PushToSubjectResponse,
} from "@saas/contracts/notifications";

describe("a timer's bounds", () => {
  it("are a 60-character label, a 120-character body, 30 s to 24 h ahead, and ten active a person", () => {
    expect(KITCHEN_TIMER_LABEL_MAX).toBe(60);
    expect(KITCHEN_TIMER_BODY_MAX).toBe(120);
    expect(KITCHEN_TIMER_URL_MAX).toBe(200);
    expect(KITCHEN_TIMER_MIN_SECONDS).toBe(30);
    expect(KITCHEN_TIMER_MAX_SECONDS).toBe(86_400);
    expect(KITCHEN_TIMERS_MAX_ACTIVE).toBe(10);
  });

  it("open the cooking session and say time's up when the timer names neither", () => {
    expect(KITCHEN_TIMER_DEFAULT_URL).toBe("/cook/session");
    expect(isKitchenTimerUrl(KITCHEN_TIMER_DEFAULT_URL)).toBe(true);
    expect(KITCHEN_TIMER_DEFAULT_BODY).toBe("Time's up");
    expect(KITCHEN_TIMER_DEFAULT_BODY.length).toBeLessThanOrEqual(KITCHEN_TIMER_BODY_MAX);
  });

  it("refuse too many with a reason of their own, not one of the kitchen's", () => {
    expect(KITCHEN_TIMER_ERROR_REASONS).toEqual({ TOO_MANY_TIMERS: "too_many_timers" });
    expect(Object.values(KITCHEN_ERROR_REASONS)).not.toContain("too_many_timers");
  });
});

describe("isKitchenTimerUrl", () => {
  it.each(["/cook/session", "/recipes/rcp_1/plan?f=1500", "/cook/session#step-7", `/${"x".repeat(199)}`])("takes the app path %s", (url) => {
    expect(isKitchenTimerUrl(url)).toBe(true);
  });

  it.each([
    ["another host", "https://evil.example/cook"],
    ["a protocol-relative host", "//evil.example/cook"],
    ["a backslash some browsers read as a slash", "/\\evil.example"],
    ["a relative path", "cook/session"],
    ["whitespace", "/cook session"],
    ["a control character", "/cook\u0000"],
    ["a path over 200 characters", `/${"x".repeat(200)}`],
    ["the empty string", ""],
    ["not a string", 7],
  ])("refuses %s", (_why, url) => {
    expect(isKitchenTimerUrl(url)).toBe(false);
  });
});

describe("a timer's push", () => {
  it("is kitchen.timer, the one kind pushed to a subject — never a kind a preference turns off", () => {
    expect(KITCHEN_TIMER_PUSH_KIND).toBe("kitchen.timer");
    expect(PUSH_TO_SUBJECT_KINDS).toEqual([KITCHEN_TIMER_PUSH_KIND]);
    expect(isNotificationKind(KITCHEN_TIMER_PUSH_KIND)).toBe(false);
    expect(NOTIFICATION_KINDS as readonly string[]).not.toContain(KITCHEN_TIMER_PUSH_KIND);
  });

  it("goes over an internal route only kitchen-worker may call", () => {
    expect(PUSH_TO_SUBJECT_PATH).toBe("/v1/notifications/push-to-subject");
    expect(PUSH_TO_SUBJECT_INTERNAL_ACTORS).toEqual(["kitchen-worker"]);
    for (const actor of PUSH_TO_SUBJECT_INTERNAL_ACTORS) expect(NOTIFICATIONS_INTERNAL_ACTOR_VALUES).toContain(actor);
    expect(PUSH_TO_SUBJECT_INTERNAL_ACTORS as readonly string[]).not.toContain("api-edge");
  });

  it("fits a push message at its longest, and a timer's own fields fit the route's limits", () => {
    expect(KITCHEN_TIMER_LABEL_MAX).toBeLessThanOrEqual(PUSH_TO_SUBJECT_LIMITS.title);
    expect(KITCHEN_TIMER_BODY_MAX).toBeLessThanOrEqual(PUSH_TO_SUBJECT_LIMITS.body);
    expect(KITCHEN_TIMER_URL_MAX).toBeLessThanOrEqual(PUSH_TO_SUBJECT_LIMITS.url);
    const message: PushMessage = {
      kind: "kitchen.timer",
      title: "x".repeat(PUSH_TO_SUBJECT_LIMITS.title),
      body: "x".repeat(PUSH_TO_SUBJECT_LIMITS.body),
      url: `/${"x".repeat(PUSH_TO_SUBJECT_LIMITS.url - 1)}`,
      tag: "x".repeat(PUSH_TO_SUBJECT_LIMITS.tag),
    };
    // A UTF-16 unit is at most 3 bytes of UTF-8 (a 4-byte character is two units), so any text this long fits.
    expect(JSON.stringify(message).length * 3).toBeLessThan(PUSH_MESSAGE_MAX_BYTES);
    const request: PushToSubjectRequest = { subjectId: "usr_dev", message: { ...message, kind: "kitchen.timer" } };
    const response: PushToSubjectResponse = { devices: 0, sent: 0, gone: 0, failed: 0, skipped: "no_devices" };
    expect(request.message.kind).toBe(KITCHEN_TIMER_PUSH_KIND);
    expect(response.skipped).toBe("no_devices");
  });
});

describe("the routes' shapes", () => {
  it("carry a timer with its id, push fields, end and state", () => {
    const create: CreateKitchenTimerRequest = { label: "Simmer · step 7", endsAt: "2026-11-08T12:10:00.000Z" };
    const timer: KitchenTimer = {
      id: "tmr_00000000000040008000000000000001",
      label: create.label,
      body: null,
      url: KITCHEN_TIMER_DEFAULT_URL,
      endsAt: create.endsAt,
      createdAt: "2026-11-08T12:00:00.000Z",
      sentAt: null,
      canceledAt: null,
    };
    const one: KitchenTimerResponse = { timer };
    const list: KitchenTimersResponse = { timers: [timer] };
    expect(list.timers[0]).toBe(one.timer);
  });

  it("are exported from @saas/contracts/kitchen and @saas/contracts/kitchen-timers alike", () => {
    expect(timers.KITCHEN_TIMERS_MAX_ACTIVE).toBe(KITCHEN_TIMERS_MAX_ACTIVE);
    expect(timers.isKitchenTimerUrl).toBe(isKitchenTimerUrl);
  });
});
