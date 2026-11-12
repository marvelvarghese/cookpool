// Web Push in the contract (Cookpool PW-5): the three kinds are the kitchen
// templates' keys, push preferences live under the system organization, and
// the limits the server keeps are the ones the app can count on.

import { KITCHEN_EMAILS } from "@saas/contracts/kitchen";
import { SPLITECO_EMAILS } from "@saas/contracts/spliteco";
import {
  NOTIFICATION_KINDS,
  PUSH_ONLY_KINDS,
  isPushOnlyKind,
  NOTIFICATION_PREFERENCE_CHANNELS,
  PUSH_ENDPOINT_MAX_LENGTH,
  PUSH_MESSAGE_MAX_BYTES,
  PUSH_PREFERENCES_ORG_ID,
  PUSH_SUBSCRIPTIONS_MAX_PER_PERSON,
  isNotificationKind,
  type NotificationKindPreferences,
  type NotificationPreference,
  type PushMessage,
  type PushSubscriptionRequest,
  type UpdateNotificationPreferencesRequest,
} from "@saas/contracts/notifications";

describe("push kinds", () => {
  it("are someone set my portion, a dish to claim, someone paid me, (CM-3) the five social kinds and (SE-3) Spliteco's two — the templates' own keys", () => {
    expect(NOTIFICATION_KINDS).toEqual([
      KITCHEN_EMAILS.PORTION_SET,
      KITCHEN_EMAILS.DISH_POSTED,
      KITCHEN_EMAILS.PAID_YOU,
      KITCHEN_EMAILS.FOLLOWED,
      KITCHEN_EMAILS.FOLLOW_REQUEST,
      KITCHEN_EMAILS.COMMENTED,
      KITCHEN_EMAILS.YUM,
      KITCHEN_EMAILS.COOKED_YOURS,
      SPLITECO_EMAILS.REMINDER,
      SPLITECO_EMAILS.PAID_YOU,
    ]);
    expect(NOTIFICATION_KINDS).toEqual([
      "kitchen.portion_set",
      "kitchen.dish_posted",
      "kitchen.paid_you",
      "kitchen.followed",
      "kitchen.follow_request",
      "kitchen.commented",
      "kitchen.yum",
      "kitchen.cooked_yours",
      "spliteco.reminder",
      "spliteco.paid_you",
    ]);
    for (const kind of NOTIFICATION_KINDS) expect(isNotificationKind(kind)).toBe(true);
    for (const other of [KITCHEN_EMAILS.USE_SOON, KITCHEN_EMAILS.LOGGED_FOR_YOU, "invitation.created", "", null, 3]) {
      expect(isNotificationKind(other)).toBe(false);
    }
  });

  it("never email the five social kinds (CM-3): they are push only", () => {
    expect(PUSH_ONLY_KINDS).toEqual(["kitchen.followed", "kitchen.follow_request", "kitchen.commented", "kitchen.yum", "kitchen.cooked_yours"]);
    for (const kind of PUSH_ONLY_KINDS) {
      expect(isNotificationKind(kind)).toBe(true);
      expect(isPushOnlyKind(kind)).toBe(true);
    }
    for (const kind of [KITCHEN_EMAILS.PORTION_SET, KITCHEN_EMAILS.DISH_POSTED, KITCHEN_EMAILS.PAID_YOU, KITCHEN_EMAILS.USE_SOON, "", null]) {
      expect(isPushOnlyKind(kind)).toBe(false);
    }
  });

  it("are toggled per channel; push lives under the system organization", () => {
    expect(NOTIFICATION_PREFERENCE_CHANNELS).toEqual(["email", "push"]);
    expect(PUSH_PREFERENCES_ORG_ID).toBe("00000000-0000-0000-0000-000000000000");
    const kinds: NotificationKindPreferences = { "kitchen.portion_set": true, "kitchen.paid_you": null };
    const push: UpdateNotificationPreferencesRequest = { channel: "push", kinds };
    const row: NotificationPreference = {
      subjectKind: "user", subjectId: "usr_dev", orgId: PUSH_PREFERENCES_ORG_ID, channel: "push", categories: {}, kinds, updatedAt: "2026-11-07T00:00:00.000Z",
    };
    expect(push.kinds).toBe(row.kinds);
  });
});

describe("push limits", () => {
  it("are ten devices a person, a 2048-character endpoint and a 3 KB message", () => {
    expect(PUSH_SUBSCRIPTIONS_MAX_PER_PERSON).toBe(10);
    expect(PUSH_ENDPOINT_MAX_LENGTH).toBe(2048);
    expect(PUSH_MESSAGE_MAX_BYTES).toBe(3072);
  });

  it("take a browser's subscription as toJSON() gives it, and say what the service worker shows", () => {
    const subscription: PushSubscriptionRequest = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      expirationTime: null,
      keys: { p256dh: "B…", auth: "…" },
    };
    const message: PushMessage = {
      kind: "kitchen.portion_set",
      title: "Cookpool",
      body: "Anu said you had 1 portion of Egg fried rice",
      url: "/dishes/dsh_1",
      tag: "kitchen.portion_set:dsh_1:usr_dev",
    };
    expect(subscription.keys.p256dh).toBeTruthy();
    // A message is a few hundred characters, far under the bound (bytes ≤ 4 × UTF-16 units).
    expect(JSON.stringify(message).length * 4).toBeLessThan(PUSH_MESSAGE_MAX_BYTES);
  });
});
