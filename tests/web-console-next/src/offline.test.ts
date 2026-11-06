import { QueryClient } from "@tanstack/react-query";
import {
  OFFLINE_BANNER_TEXT,
  OFFLINE_WRITE_TEXT,
  OfflineError,
  alwaysSent,
  asOfText,
  bannerText,
  connection,
  createConnection,
  isOfflineRefusal,
  refuseIfOffline,
  watchedFetch,
} from "@/lib/connection";
import { createClient, wrap } from "@/lib/api";
import { beginWrite } from "@/components/kitchen/optimistic-data";
import { trackWrite, writesInFlight } from "@/lib/optimistic";
import { AWAY_RELOAD_MS, isSignInPath, pageBuildId, reloadsOnReturn, updateOffered, type UpdateGate } from "@/lib/sw-client";
import { CACHED_AT_HEADER } from "@web-console-next/service-worker/protocol.mjs";

// Cookpool PW-4: offline, the app shows what it saw last and holds every
// write back at once — no patch, no Undo, nothing sent, nothing queued — with
// one line, "You're offline · nothing was logged". A new build is offered
// only when reloading would lose nothing.

describe("the connection", () => {
  it("is offline while the browser says so, or since the last API call failed for network reasons", () => {
    const c = createConnection(true);
    expect(c.offline()).toBe(false);
    c.browser(false);
    expect(c.offline()).toBe(true);
    c.browser(true);
    c.failed(new TypeError("Failed to fetch"));
    expect(c.offline()).toBe(true);
    c.answered(null);
    expect(c.offline()).toBe(false);
  });

  it("counts an answer from the worker's cache as offline, and keeps the oldest time shown", () => {
    const c = createConnection(true);
    c.answered("2026-11-05T14:12:00.000Z");
    c.answered("2026-11-05T09:00:00.000Z");
    c.answered("2026-11-05T15:00:00.000Z");
    expect(c.get()).toEqual({ browserOffline: false, unreachable: true, cachedAt: "2026-11-05T09:00:00.000Z" });
    c.answered(null);
    expect(c.get()).toEqual({ browserOffline: false, unreachable: false, cachedAt: null });
  });

  it("does not count a cancelled read or a held-back write as no signal", () => {
    const c = createConnection(true);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    c.failed(abort);
    c.failed(new OfflineError());
    expect(c.offline()).toBe(false);
  });

  it("tells its listeners only when something changed", () => {
    const c = createConnection(true);
    let told = 0;
    c.subscribe(() => (told += 1));
    c.answered(null);
    c.browser(true);
    expect(told).toBe(0);
    c.browser(false);
    expect(told).toBe(1);
  });
});

describe("the banner", () => {
  const now = new Date(2026, 10, 5, 20, 0);
  it("says what it shows, and when the data is from when it came from the cache", () => {
    expect(OFFLINE_BANNER_TEXT).toBe("Offline · showing what you saw last");
    expect(bannerText({ browserOffline: true, unreachable: false, cachedAt: null }, now)).toBe(OFFLINE_BANNER_TEXT);
    const at = new Date(2026, 10, 5, 19, 42).toISOString();
    expect(bannerText({ browserOffline: true, unreachable: true, cachedAt: at }, now)).toBe("Offline · showing what you saw last · as of 7:42 pm");
    expect(asOfText(new Date(2026, 10, 4, 13, 5).toISOString(), now)).toBe("yesterday, 1:05 pm");
    expect(asOfText("not a date", now)).toBe("");
  });
});

describe("a write while offline", () => {
  afterEach(() => {
    connection.browser(true);
    connection.answered(null);
  });

  it("beginWrite holds it back at once: no patch, the one-line toast, nothing to roll back or count", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["kitchenPantry", "item", "me:itm_1"], { left: 5 });
    const patch = { prefix: ["kitchenPantry"], update: (d: unknown) => ({ ...(d as object), left: 4 }) };
    let toasts = 0;
    const stop = connection.onHeldBack(() => (toasts += 1));
    connection.browser(false);
    const write = beginWrite(qc, [patch]);
    expect(qc.getQueryData(["kitchenPantry", "item", "me:itm_1"])).toEqual({ left: 5 });
    expect(toasts).toBe(1);
    write.patch([patch]);
    write.rollback();
    write.restore([patch]);
    expect(qc.getQueryData(["kitchenPantry", "item", "me:itm_1"])).toEqual({ left: 5 });
    const sent = write.track(Promise.resolve("refused"));
    expect(writesInFlight(qc)).toBe(0);
    await sent;
    stop();
    // Online again, the same write shows at once (SM-5).
    connection.browser(true);
    beginWrite(qc, [patch]);
    expect(qc.getQueryData(["kitchenPantry", "item", "me:itm_1"])).toEqual({ left: 4 });
  });

  it("is refused by the API client before anything is sent, in the one line", async () => {
    const realFetch = globalThis.fetch;
    const sent: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(`${init?.method ?? "GET"} ${String(input)}`);
      return Response.json({ data: { ok: true }, meta: { requestId: "r" } });
    }) as typeof fetch;
    let toasts = 0;
    const stop = connection.onHeldBack(() => (toasts += 1));
    try {
      const client = createClient({ name: "prod", url: "https://cookpool.store/api", directUrl: "https://x.workers.dev" }, "tok");
      connection.browser(false);
      // Cook, settings, join, sign-in: every write path that is not beginWrite.
      const r = await wrap(() => client.kitchen.cookDish({ orgId: null, name: "Egg fried rice", portionsHalf: 4, lines: [] } as never));
      expect(r).toEqual({ ok: false, status: 0, error: { code: "network_error", reason: "offline", message: OFFLINE_WRITE_TEXT } });
      await wrap(() => client.memberships.join("KTCH2345"));
      await wrap(() => client.auth.loginStart({ email: "a@b.c" }));
      expect(sent).toEqual([]);
      expect(toasts).toBe(3);
      // Reads still go (the worker may answer them from its cache).
      await wrap(() => client.kitchen.inbox());
      expect(sent).toEqual(["GET https://cookpool.store/api/v1/kitchen/me/inbox"]);
      // Signing out is never held back.
      await wrap(() => client.auth.logout());
      expect(sent[1]).toBe("POST https://cookpool.store/api/v1/auth/logout");
    } finally {
      stop();
      globalThis.fetch = realFetch;
    }
  });

  it("says nothing and stops nothing when online", () => {
    let toasts = 0;
    const stop = connection.onHeldBack(() => (toasts += 1));
    expect(refuseIfOffline()).toBe(false);
    connection.failed(new TypeError("Failed to fetch"));
    expect(refuseIfOffline()).toBe(true);
    expect(toasts).toBe(1);
    stop();
  });

  it("only sign-out goes through regardless", () => {
    expect(alwaysSent("https://cookpool.store/api/v1/auth/logout")).toBe(true);
    expect(alwaysSent("https://cookpool.store/api/v1/auth/login/start")).toBe(false);
  });

  it("a screen's own refusal that only repeats it becomes the one line", () => {
    expect(OFFLINE_WRITE_TEXT).toBe("You're offline · nothing was logged");
    expect(isOfflineRefusal({ title: "Couldn't log Milk", description: OFFLINE_WRITE_TEXT })).toBe(true);
    expect(isOfflineRefusal({ title: OFFLINE_WRITE_TEXT })).toBe(true);
    expect(isOfflineRefusal({ title: "Couldn't log Milk", description: "Only 1 L is left." })).toBe(false);
  });
});

describe("the API client and the worker's cache", () => {
  it("reads the cached-at header off an answer, and a network failure as no signal", async () => {
    const c = createConnection(true);
    const realFetch = globalThis.fetch;
    let mode: "cached" | "fresh" | "down" = "cached";
    globalThis.fetch = (async () => {
      if (mode === "down") throw new TypeError("Failed to fetch");
      return new Response("{}", { headers: mode === "cached" ? { [CACHED_AT_HEADER]: "2026-11-05T14:12:00.000Z" } : {} });
    }) as typeof fetch;
    try {
      const f = watchedFetch(c);
      await f("https://cookpool.store/api/v1/kitchen/me/inbox");
      expect(c.get().cachedAt).toBe("2026-11-05T14:12:00.000Z");
      mode = "fresh";
      await f("https://cookpool.store/api/v1/kitchen/me/inbox");
      expect(c.offline()).toBe(false);
      mode = "down";
      await expect(f("https://cookpool.store/api/v1/kitchen/me/inbox")).rejects.toThrow();
      expect(c.offline()).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("New version · Reload", () => {
  const ready: UpdateGate = { waiting: true, writesInFlight: 0, undoOffersOpen: 0, offline: false, pathname: "/home", snoozed: false };

  it("is offered when a build is waiting and reloading would lose nothing", () => {
    expect(updateOffered(ready)).toBe(true);
    expect(updateOffered({ ...ready, waiting: false })).toBe(false);
  });

  it("never while a write is on its way (SM-5's tracking), or its Undo is on screen", async () => {
    const qc = new QueryClient();
    let land: () => void = () => undefined;
    const write = trackWrite(qc, new Promise<void>((resolve) => (land = resolve)));
    expect(updateOffered({ ...ready, writesInFlight: writesInFlight(qc) })).toBe(false);
    land();
    await write;
    await Promise.resolve();
    expect(updateOffered({ ...ready, writesInFlight: writesInFlight(qc) })).toBe(true);
    expect(updateOffered({ ...ready, undoOffersOpen: 1 })).toBe(false);
  });

  it("not offline, not on sign-in (a code being typed), not after it was closed", () => {
    expect(updateOffered({ ...ready, offline: true })).toBe(false);
    expect(updateOffered({ ...ready, pathname: "/login" })).toBe(false);
    expect(updateOffered({ ...ready, pathname: "/auth/callback" })).toBe(false);
    expect(updateOffered({ ...ready, snoozed: true })).toBe(false);
    expect(isSignInPath("/loginx")).toBe(false);
  });

  it("knows the page's own build from its flight data, else nothing (and then offers instead of adopting)", () => {
    const page = { __next_f: [[0], [1, '1:"$Sreact.fragment"\n'], [1, '0:{"P":null,"b":"TmdGONLvg4k1YG3mpvs7h","p":"","c":["",""]}']] };
    expect(pageBuildId(page)).toBe("TmdGONLvg4k1YG3mpvs7h");
    expect(pageBuildId({ __next_f: [[1, "no id here"]] })).toBeNull();
    expect(pageBuildId({})).toBeNull();
    expect(pageBuildId(undefined)).toBeNull();
  });

  it("an app brought back after more than a day with a build waiting reloads itself", () => {
    const back = { waiting: true, awayMs: AWAY_RELOAD_MS + 1, writesInFlight: 0, offline: false, pathname: "/home" };
    expect(AWAY_RELOAD_MS).toBe(24 * 60 * 60 * 1000);
    expect(reloadsOnReturn(back)).toBe(true);
    expect(reloadsOnReturn({ ...back, awayMs: AWAY_RELOAD_MS - 1 })).toBe(false);
    expect(reloadsOnReturn({ ...back, waiting: false })).toBe(false);
    expect(reloadsOnReturn({ ...back, writesInFlight: 1 })).toBe(false);
    expect(reloadsOnReturn({ ...back, pathname: "/login" })).toBe(false);
  });
});
