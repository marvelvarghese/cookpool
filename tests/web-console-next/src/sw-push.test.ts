import {
  DEFAULT_PATH,
  GENERIC_BODY,
  GENERIC_TITLE,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  appPath,
  createPushHandlers,
  pushNotice,
  type PushWindow,
} from "@web-console-next/service-worker/push.mjs";
import { MESSAGE } from "@web-console-next/service-worker/protocol.mjs";

// Cookpool PW-6: the service worker shows a push and opens its page on a
// tap — with fakes for the registration and the window clients.

const ORIGIN = "https://cookpool.store";
const MESSAGE_JSON = JSON.stringify({
  kind: "kitchen.portion_set",
  title: "Cookpool",
  body: "Anu said you had 1 portion of Egg fried rice",
  url: "/dishes/dsh_00000000000000000000000000000002",
  tag: "kitchen.portion_set:dsh_00000000000000000000000000000002:usr_000000000000000000000000000000aa",
});

describe("what a push shows", () => {
  it("is the payload's title and body, its page and tag, with the app's icons and no re-alert", () => {
    expect(pushNotice(MESSAGE_JSON)).toEqual({
      title: "Cookpool",
      options: {
        body: "Anu said you had 1 portion of Egg fried rice",
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
        renotify: false,
        tag: "kitchen.portion_set:dsh_00000000000000000000000000000002:usr_000000000000000000000000000000aa",
        data: { url: "/dishes/dsh_00000000000000000000000000000002" },
      },
    });
    expect(NOTIFICATION_ICON).toBe("/icons/icon-192.png");
  });

  it("is a generic Cookpool one for a missing or bad payload (userVisibleOnly needs one)", () => {
    const generic = { title: GENERIC_TITLE, options: { body: GENERIC_BODY, icon: NOTIFICATION_ICON, badge: NOTIFICATION_BADGE, renotify: false, data: { url: DEFAULT_PATH } } };
    expect(GENERIC_TITLE).toBe("Cookpool");
    for (const bad of [null, undefined, "", "not json", "[]", "42", JSON.stringify({ title: "Cookpool" }), JSON.stringify({ title: 1, body: 2 })]) {
      expect(pushNotice(bad)).toEqual(generic);
    }
  });

  it("opens only a path in the app", () => {
    expect(appPath("/people/usr_1")).toBe("/people/usr_1");
    for (const bad of ["https://evil.test/", "//evil.test/x", "/\\evil.test", "javascript:alert(1)", "dishes/1", 42, null]) expect(appPath(bad)).toBeNull();
    const elsewhere = JSON.parse(MESSAGE_JSON) as Record<string, unknown>;
    elsewhere.url = "https://evil.test/";
    expect(pushNotice(JSON.stringify(elsewhere)).options.data.url).toBe(DEFAULT_PATH);
  });
});

/** Windows and a registration that record what was done with them. */
function platform(windows: Partial<PushWindow>[] = []) {
  const log: string[] = [];
  const open: PushWindow[] = windows.map((w, i) => {
    const win: PushWindow = {
      url: w.url ?? `${ORIGIN}/home`,
      focused: w.focused ?? false,
      visibilityState: w.visibilityState ?? "hidden",
      focus: async () => {
        log.push(`focus ${i}`);
        return win;
      },
      navigate: w.navigate ?? (async (url: string) => {
        log.push(`navigate ${i} ${url}`);
        return win;
      }),
      postMessage: (m: unknown) => void log.push(`message ${i} ${JSON.stringify(m)}`),
    };
    return win;
  });
  let failFirst = false;
  const shown: [string, Record<string, unknown> | undefined][] = [];
  const handlers = createPushHandlers({
    origin: ORIGIN,
    registration: {
      showNotification: async (title, options) => {
        if (failFirst) {
          failFirst = false;
          throw new TypeError("bad options");
        }
        shown.push([title, options]);
      },
      pushManager: {
        subscribe: async (o) => {
          log.push(`subscribe ${o.userVisibleOnly} ${new Uint8Array(o.applicationServerKey as ArrayBuffer).length}`);
          return { endpoint: "https://push.test/new" };
        },
      },
    },
    clients: {
      matchAll: async () => open,
      openWindow: async (url) => void log.push(`open ${url}`),
    },
  });
  return { handlers, log, shown, failNext: () => (failFirst = true) };
}

describe("the push handler", () => {
  it("shows the payload as the notification", async () => {
    const p = platform();
    await p.handlers.push(MESSAGE_JSON);
    expect(p.shown).toEqual([[pushNotice(MESSAGE_JSON).title, pushNotice(MESSAGE_JSON).options]]);
  });

  it("still shows one when the platform refuses the options", async () => {
    const p = platform();
    p.failNext();
    await p.handlers.push(MESSAGE_JSON);
    expect(p.shown).toEqual([[GENERIC_TITLE, { body: GENERIC_BODY, icon: NOTIFICATION_ICON, data: { url: DEFAULT_PATH } }]]);
  });
});

describe("a tap on a notification", () => {
  const dish = `${ORIGIN}/dishes/dsh_00000000000000000000000000000002`;
  const tap = () => {
    const closed = { n: 0 };
    return { closed, notification: { data: { url: "/dishes/dsh_00000000000000000000000000000002" }, close: () => void (closed.n += 1) } };
  };

  it("focuses the open Cookpool window and opens the page in it", async () => {
    const p = platform([{ url: `${ORIGIN}/pantry` }, { url: `${ORIGIN}/home`, focused: true }]);
    const t = tap();
    await p.handlers.click(t.notification);
    expect(t.closed.n).toBe(1);
    expect(p.log).toEqual(["focus 1", `navigate 1 ${dish}`]);
  });

  it("prefers a visible window, and only focuses one already on that page", async () => {
    const p = platform([{ url: `${ORIGIN}/home` }, { url: dish, visibilityState: "visible" }]);
    await p.handlers.click(tap().notification);
    expect(p.log).toEqual(["focus 1"]);
  });

  it("opens a window when none is open (another site's windows don't count)", async () => {
    const p = platform([{ url: "https://elsewhere.test/home", focused: true }]);
    await p.handlers.click(tap().notification);
    expect(p.log).toEqual([`open ${dish}`]);
  });

  it("opens a window when the open one can't be moved", async () => {
    const p = platform([
      {
        url: `${ORIGIN}/home`,
        navigate: async () => {
          throw new TypeError("not controlled");
        },
      },
    ]);
    await p.handlers.click(tap().notification);
    expect(p.log).toEqual(["focus 0", `open ${dish}`]);
  });

  it("opens Home for a notification with no page of its own", async () => {
    const p = platform();
    await p.handlers.click({ data: { url: "https://evil.test/" } });
    await p.handlers.click(null);
    expect(p.log).toEqual([`open ${ORIGIN}/home`, `open ${ORIGIN}/home`]);
  });
});

describe("a renewed subscription", () => {
  it("is re-made with the same key, and the open pages are told to post it again", async () => {
    const p = platform([{ url: `${ORIGIN}/home` }]);
    const key = new Uint8Array(65).fill(4).buffer;
    await p.handlers.subscriptionChange({ oldSubscription: { options: { applicationServerKey: key } } });
    expect(p.log).toEqual(["subscribe true 65", `message 0 ${JSON.stringify({ type: MESSAGE.pushRenewed })}`]);
  });

  it("uses the new one when the browser gives it, and does nothing without a key", async () => {
    const p = platform([{ url: `${ORIGIN}/home` }]);
    await p.handlers.subscriptionChange({ newSubscription: { endpoint: "https://push.test/2" } });
    expect(p.log).toEqual([`message 0 ${JSON.stringify({ type: "cookpool:push-renewed" })}`]);
    const q = platform([{ url: `${ORIGIN}/home` }]);
    await q.handlers.subscriptionChange({ oldSubscription: null });
    await q.handlers.subscriptionChange(undefined);
    expect(q.log).toEqual([]);
  });
});
