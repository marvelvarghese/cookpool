import type { InboxItem, InboxResponse } from "@saas/contracts/kitchen";
import type { NotificationKindPreferences, NotificationPreference, PushSubscriptionRequest } from "@saas/contracts/notifications";
import {
  BADGE_ROW,
  BLOCKED_LINE,
  INSTALL_FIRST_LINE,
  NOT_YET_LINE,
  PUSH_ROWS,
  pushRows,
  TEST_FAILED,
  TEST_SENT,
  badgeAction,
  badgeAsksPermission,
  badgeRowShown,
  base64UrlBytes,
  forgetPush,
  kindsOn,
  notifyDevice,
  pushView,
  sameServerKey,
  shownOn,
  testOutcome,
  turnKindOff,
  turnKindOn,
  withPushRow,
  type DevicePort,
  type NotifyEnv,
  type PushServerPort,
} from "@web-console-next/lib/push";
import { isWebKit } from "@web-console-next/lib/push-device";
import { isInAppBrowser, isIos } from "@web-console-next/lib/install";
import { homeTodoCount } from "@web-console-next/components/kitchen/inbox";
import { qk } from "@web-console-next/lib/query-keys";

// Cookpool PW-6 (cookpool-app design §4): You → Notifications — where push
// can work, the ask after a choice, the switches, and the icon badge.

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0",
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

/** The env `readNotifyEnv` builds, from a user agent and what the browser has. */
function env(ua: string, has: { standalone?: boolean; pushApi?: boolean; worker?: boolean; badgeApi?: boolean; touch?: number } = {}): NotifyEnv {
  const touch = has.touch ?? (/iPhone|Android/.test(ua) ? 5 : 0);
  return {
    ios: isIos(ua, touch),
    inAppBrowser: isInAppBrowser(ua),
    standalone: has.standalone ?? false,
    pushApi: has.pushApi ?? true,
    worker: has.worker ?? true,
    badgeApi: has.badgeApi ?? false,
    webkit: isWebKit(ua, touch),
  };
}

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

describe("where push can work", () => {
  it("an iPhone in Safari installs first: the switches are replaced by one line", () => {
    const iphone = env(UA.iphoneSafari, { pushApi: false });
    expect(notifyDevice(iphone)).toBe("install-first");
    expect(pushView(notifyDevice(iphone), { publicKey: KEY })).toBe("install-first");
    expect(INSTALL_FIRST_LINE).toBe("Add Cookpool to your Home Screen to get notifications");
    // Its badge needs the installed app too.
    expect(badgeRowShown({ ...iphone, badgeApi: true })).toBe(false);
    // An iPad asking for desktop sites is an iPad.
    expect(notifyDevice(env(UA.ipadDesktop, { pushApi: false, touch: 5 }))).toBe("install-first");
  });

  it("an iPhone app's own web view can't install, so it can't either", () => {
    expect(notifyDevice(env(UA.iphoneInstagram, { pushApi: false }))).toBe("no-push");
  });

  it("the installed iPhone app gets the switches (iOS 16.4+), and its badge asks for permission", () => {
    const installed = env(UA.iphoneSafari, { standalone: true, badgeApi: true });
    expect(notifyDevice(installed)).toBe("push");
    expect(pushView("push", { publicKey: KEY })).toBe("switches");
    expect(badgeRowShown(installed)).toBe(true);
    expect(badgeAsksPermission(installed)).toBe(true);
    // Installed before iOS 16.4: no Web Push at all.
    expect(notifyDevice(env(UA.iphoneSafari, { standalone: true, pushApi: false }))).toBe("no-push");
  });

  it("Android and desktop Chrome get the switches, in the browser or installed", () => {
    expect(notifyDevice(env(UA.androidChrome))).toBe("push");
    expect(notifyDevice(env(UA.androidChrome, { standalone: true }))).toBe("push");
    expect(notifyDevice(env(UA.macChrome, { badgeApi: true }))).toBe("push");
    expect(badgeAsksPermission(env(UA.macChrome))).toBe(false);
    expect(badgeAsksPermission(env(UA.androidChrome))).toBe(false);
    expect(badgeAsksPermission(env(UA.macSafari))).toBe(true);
  });

  it("a browser without PushManager says it can't, and keeps a badge switch if it can badge", () => {
    const old = env(UA.macChrome, { pushApi: false, badgeApi: true });
    expect(notifyDevice(old)).toBe("no-push");
    expect(pushView("no-push", { publicKey: KEY })).toBe("no-push");
    expect(badgeRowShown(old)).toBe(true);
    expect(badgeRowShown({ ...old, badgeApi: false })).toBe(false);
  });

  it("no key on the server (publicKey: null) hides the three switches, with one quiet line; the badge switch stays", () => {
    const android = env(UA.androidChrome, { badgeApi: true });
    expect(pushView(notifyDevice(android), { publicKey: null })).toBe("not-yet");
    expect(NOT_YET_LINE).toBe("Notifications aren't available yet.");
    expect(badgeRowShown(android)).toBe(true);
  });

  it("waits for the key, says when it could not be read, and has none without the service worker", () => {
    expect(pushView("push", {})).toBe("loading");
    expect(pushView("push", { failed: true })).toBe("error");
    expect(notifyDevice(env(UA.androidChrome, { worker: false }))).toBe("no-worker");
    expect(pushView("no-worker", { publicKey: KEY })).toBe("not-yet");
  });
});

const push = (kinds: NotificationKindPreferences): NotificationPreference => ({
  subjectKind: "user",
  subjectId: "usr_1",
  orgId: "00000000-0000-0000-0000-000000000000",
  channel: "push",
  categories: {},
  kinds,
  updatedAt: "2026-11-07T10:00:00.000Z",
});

describe("the switches", () => {
  it("are the canvas's four, in its order, each with its example", () => {
    // Today's frame: the three kinds (then the badge row), unchanged by CM-6.
    expect(pushRows(false).map((r) => [r.kind, r.title, r.example])).toEqual([
      ["kitchen.portion_set", "Someone set my portion", "Anu said you had 1 portion"],
      ["kitchen.dish_posted", "A dish to claim", "Egg fried rice is ready"],
      ["kitchen.paid_you", "Someone paid me", "Dev paid you ₹400"],
    ]);
    // The new frame adds Community's five (cookpool-community CM-6), plainly labelled.
    expect(PUSH_ROWS).toEqual(pushRows(true));
    expect(pushRows(true).map((r) => [r.kind, r.title])).toEqual([
      ["kitchen.portion_set", "Someone set my portion"],
      ["kitchen.dish_posted", "A dish to claim"],
      ["kitchen.paid_you", "Someone paid me"],
      ["kitchen.followed", "New followers"],
      ["kitchen.follow_request", "Follow requests"],
      ["kitchen.commented", "Comments"],
      ["kitchen.yum", "Likes"],
      ["kitchen.cooked_yours", "Cooked your recipe"],
      // Spliteco's three (cookpool-spliteco SE3): the one account's push switches.
      ["spliteco.reminder", "Payment reminders"],
      ["spliteco.paid_you", "Paid in Spliteco"],
      ["spliteco.expense_for_you", "Expenses you're on"],
    ]);
    expect(BADGE_ROW).toEqual({ title: "To-dos on the app icon", example: "3" });
    expect(qk.pushKey()).toEqual(["push", "key"]);
    expect(qk.pushPrefs()).toEqual(["push", "prefs"]);
  });

  it("are all off until turned on: only an explicit true is on, and only the push row counts", () => {
    expect(kindsOn([])).toEqual({
      "kitchen.portion_set": false,
      "kitchen.dish_posted": false,
      "kitchen.paid_you": false,
      // Community's five (CM-6), off until turned on like the rest.
      "kitchen.followed": false,
      "kitchen.follow_request": false,
      "kitchen.commented": false,
      "kitchen.yum": false,
      "kitchen.cooked_yours": false,
      // Spliteco's three (SE3).
      "spliteco.reminder": false,
      "spliteco.paid_you": false,
      "spliteco.expense_for_you": false,
    });
    const email = { ...push({ "kitchen.paid_you": true }), channel: "email" as const };
    expect(kindsOn([email])["kitchen.paid_you"]).toBe(false);
    expect(kindsOn([push({ "kitchen.paid_you": true, "kitchen.dish_posted": null, "kitchen.yum": true })])).toMatchObject({
      "kitchen.portion_set": false,
      "kitchen.dish_posted": false,
      "kitchen.paid_you": true,
      "kitchen.yum": true,
      "kitchen.followed": false,
    });
  });

  it("are on only where this device is subscribed with permission, and show a flip at once", () => {
    const kinds = kindsOn([push({ "kitchen.paid_you": true })]);
    expect(shownOn("kitchen.paid_you", kinds, { permission: "granted", endpoint: "https://push.test/1" })).toBe(true);
    // Turned on from another phone: not on this one until it subscribes.
    expect(shownOn("kitchen.paid_you", kinds, { permission: "granted", endpoint: null })).toBe(false);
    expect(shownOn("kitchen.paid_you", kinds, { permission: "denied", endpoint: "https://push.test/1" })).toBe(false);
    expect(shownOn("kitchen.portion_set", kinds, { permission: "default", endpoint: null }, true)).toBe(true);
    expect(shownOn("kitchen.paid_you", kinds, { permission: "granted", endpoint: "https://push.test/1" }, false)).toBe(false);
  });

  it("keep the server's answer as the push row", () => {
    const emailRow = { ...push({}), channel: "email" as const, orgId: "org_1" };
    const read = { preferences: [emailRow, push({})] };
    const next = withPushRow(read, push({ "kitchen.dish_posted": true }));
    expect(next.preferences).toEqual([emailRow, push({ "kitchen.dish_posted": true })]);
    expect(withPushRow(undefined, push({ "kitchen.paid_you": true })).preferences).toHaveLength(1);
  });
});

/** A browser and a server that record what was asked of them. */
function fakes(permission: NotificationPermission, answer: NotificationPermission = "granted") {
  const calls: string[] = [];
  const sub: PushSubscriptionRequest = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BP", auth: "au" } };
  const device: DevicePort = {
    permission: () => permission,
    requestPermission: async () => {
      calls.push("ask");
      return answer;
    },
    subscribe: async (key) => {
      calls.push(`subscribe:${key === KEY ? "key" : key}`);
      return sub;
    },
  };
  const server: PushServerPort = {
    subscribePush: async (s) => {
      calls.push(`POST ${s.endpoint}`);
    },
    setPushKinds: async (kinds) => {
      calls.push(`PUT ${JSON.stringify(kinds)}`);
      return { preference: push(kinds) };
    },
  };
  return { calls, device, server, sub };
}

describe("turning a kind on asks after the choice, never before", () => {
  it("grant: asks once, subscribes this device with the server's key, posts it, then turns the kind on", async () => {
    const f = fakes("default", "granted");
    const outcome = turnKindOn("kitchen.portion_set", KEY, f.device, f.server);
    // The prompt is the first thing awaited: still inside the tap, as Safari wants.
    expect(f.calls).toEqual(["ask"]);
    expect(await outcome).toEqual({ ok: true, endpoint: f.sub.endpoint, preference: push({ "kitchen.portion_set": true }) });
    expect(f.calls).toEqual(["ask", "subscribe:key", `POST ${f.sub.endpoint}`, 'PUT {"kitchen.portion_set":true}']);
  });

  it("deny: the switch goes back with one line, and nothing is subscribed or saved", async () => {
    const f = fakes("default", "denied");
    expect(await turnKindOn("kitchen.paid_you", KEY, f.device, f.server)).toEqual({ ok: false, reason: "blocked" });
    expect(f.calls).toEqual(["ask"]);
    expect(BLOCKED_LINE).toBe("Notifications are blocked in your browser settings");
    // Blocked before: the browser answers at once, the same way.
    const before = fakes("denied", "denied");
    expect(await turnKindOn("kitchen.paid_you", KEY, before.device, before.server)).toEqual({ ok: false, reason: "blocked" });
  });

  it("a closed prompt goes back quietly", async () => {
    const f = fakes("default", "default");
    expect(await turnKindOn("kitchen.dish_posted", KEY, f.device, f.server)).toEqual({ ok: false, reason: "dismissed" });
    expect(f.calls).toEqual(["ask"]);
  });

  it("already granted: no prompt, straight to subscribing", async () => {
    const f = fakes("granted");
    const outcome = await turnKindOn("kitchen.dish_posted", KEY, f.device, f.server);
    expect(outcome.ok).toBe(true);
    expect(f.calls).toEqual(["subscribe:key", `POST ${f.sub.endpoint}`, 'PUT {"kitchen.dish_posted":true}']);
  });

  it("a refusal anywhere after the prompt fails the flip (the switch goes back)", async () => {
    const f = fakes("granted");
    f.server.subscribePush = async () => {
      throw new Error("validation_failed");
    };
    expect(await turnKindOn("kitchen.paid_you", KEY, f.device, f.server)).toEqual({ ok: false, reason: "failed" });
    expect(f.calls).toEqual(["subscribe:key"]);
  });

  it("turning the last kind off keeps the subscription", async () => {
    const f = fakes("granted");
    expect(await turnKindOff("kitchen.paid_you", f.server)).toEqual(push({ "kitchen.paid_you": false }));
    // The server only: the device (and its subscription) is not touched.
    expect(f.calls).toEqual(['PUT {"kitchen.paid_you":false}']);
    f.server.setPushKinds = async () => {
      throw new Error("offline");
    };
    expect(await turnKindOff("kitchen.paid_you", f.server)).toBeNull();
  });

  it("says whether the test went out", () => {
    expect(testOutcome({ devices: 1, sent: 1, gone: 0, failed: 0 })).toEqual({ ok: true, title: TEST_SENT });
    expect(testOutcome({ devices: 1, sent: 0, gone: 1, failed: 0 })).toEqual({ ok: false, title: TEST_FAILED });
    expect(testOutcome(null)).toEqual({ ok: false, title: TEST_FAILED });
  });
});

describe("the server's key", () => {
  it("is base64url, compared byte for byte with a subscription's", () => {
    const bytes = base64UrlBytes(KEY)!;
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(base64UrlBytes("not a key!")).toBeNull();
    expect(sameServerKey(bytes.buffer, KEY)).toBe(true);
    expect(sameServerKey(new Uint8Array(65).buffer, KEY)).toBe(false);
    expect(sameServerKey(null, KEY)).toBe(false);
  });
});

describe("signing out removes this device", () => {
  function device(endpoint: string | null) {
    const calls: string[] = [];
    return {
      calls,
      subscription: async () =>
        endpoint === null
          ? null
          : {
              endpoint,
              unsubscribe: async () => {
                calls.push("unsubscribe");
                return true;
              },
            },
      tellServer: async (e: string) => {
        calls.push(`DELETE ${e}`);
      },
    };
  }

  it("tells the server once and unsubscribes the browser", async () => {
    const d = device("https://push.test/1");
    expect(await forgetPush(d)).toBe("https://push.test/1");
    expect(d.calls.sort()).toEqual(["DELETE https://push.test/1", "unsubscribe"]);
  });

  it("offline, or after a 401, only the browser unsubscribes (the server deletes it at its next push)", async () => {
    const d = device("https://push.test/1");
    await forgetPush({ ...d, offline: true });
    expect(d.calls).toEqual(["unsubscribe"]);
    const e = device("https://push.test/2");
    await forgetPush({ subscription: e.subscription });
    expect(e.calls).toEqual(["unsubscribe"]);
  });

  it("does nothing on a device with no subscription, and never throws", async () => {
    const d = device(null);
    expect(await forgetPush(d)).toBeNull();
    expect(d.calls).toEqual([]);
    const broken = { subscription: async () => Promise.reject(new Error("no worker")) };
    expect(await forgetPush(broken)).toBeNull();
    const failing = device("https://push.test/3");
    failing.tellServer = async () => {
      throw new Error("500");
    };
    expect(await forgetPush(failing)).toBe("https://push.test/3");
    expect(failing.calls).toEqual(["unsubscribe"]);
  });
});

const soon = (id: string, days: number): InboxItem => ({
  kind: "use_soon",
  item: {
    id,
    ref: `me:${id}`,
    name: "Greek yogurt",
    pantry: { kind: "personal", name: "My pantry" },
    orgId: null,
    qtyLeftMilli: 400_000,
    quantity: 400,
    unit: "g",
    expiresOn: "2026-11-08",
    daysToUseBy: days,
    canUse: true,
  },
  usual: null,
});
const inbox = (items: InboxItem[]): InboxResponse =>
  ({ items, counts: { total: items.length, claim_dish: 0, finalize_dish: 0, use_soon: items.length, payment_due: 0, flag: 0 } }) as InboxResponse;

describe("the icon badge", () => {
  it("is Home's to-do count, each thing once", () => {
    const a = soon("itm_00000000000000000000000000000001", 1);
    const b = soon("itm_00000000000000000000000000000002", -1);
    expect(homeTodoCount(inbox([a, b, a]))).toBe(2);
    expect(homeTodoCount(inbox([]))).toBe(0);
  });

  it("shows the count while the switch is on, clears at zero and when off, and waits for the count", () => {
    expect(badgeAction({ on: true, supported: true, count: 4 })).toEqual({ kind: "set", count: 4 });
    expect(badgeAction({ on: true, supported: true, count: 0 })).toEqual({ kind: "clear" });
    expect(badgeAction({ on: false, supported: true, count: 4 })).toEqual({ kind: "clear" });
    expect(badgeAction({ on: true, supported: true, count: null })).toBeNull();
    expect(badgeAction({ on: true, supported: false, count: 4 })).toBeNull();
  });
});
