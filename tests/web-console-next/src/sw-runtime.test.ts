import { createServiceWorker } from "@web-console-next/service-worker/runtime.mjs";
import {
  CACHED_AT_HEADER,
  MESSAGE,
  META_CACHE,
  dataCacheName,
  staticCacheName,
  tokenHash,
} from "@web-console-next/service-worker/protocol.mjs";
import { FakeCaches, fakeNetwork, flush } from "./sw-fakes";

// Cookpool PW-4: the service worker's behaviour, with fake caches and a
// scripted network — the last-seen data per account, deleted on sign-out,
// never shared between two accounts on one phone, never a token; pages
// network-first with a 3 s cutoff; a new build adopted only when the page is
// already that build.

const ORIGIN = "https://cookpool.store";
const BUILD = "bld_1";
const INBOX = `${ORIGIN}/api/v1/kitchen/me/inbox`;
const PANTRIES = `${ORIGIN}/api/v1/kitchen/me/pantries`;
const ANU = "usr_0000000000000000000000000000b0b0";
const DEV = "usr_00000000000000000000000000003f9a";

function setup(answer: (r: Request) => Response | Promise<Response> = (r) => Response.json({ data: { for: r.headers.get("authorization") } })) {
  const caches = new FakeCaches();
  const net = fakeNetwork(answer);
  const jobs: Promise<unknown>[] = [];
  let skipped = 0;
  const sw = createServiceWorker({
    buildId: BUILD,
    precache: ["/home", "/_rsc/home.rsc", "/dishes/_", "/_next/static/chunks/a-1.js"],
    origin: ORIGIN,
    caches: caches as unknown as CacheStorage,
    fetch: net.fetch,
    skipWaiting: async () => {
      skipped += 1;
    },
    now: () => Date.parse("2026-11-05T14:12:00.000Z"),
  });
  const read = async (url: string, token: string | null) => {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    const answer = sw.respond(new Request(url, { headers }), { waitUntil: (job) => jobs.push(job) });
    if (!answer) throw new Error("not answered by the worker");
    const response = await answer;
    await Promise.all(jobs.splice(0));
    return response;
  };
  const signIn = async (subjectId: string, token: string) => sw.message({ type: MESSAGE.account, subjectId, tokenHash: await tokenHash(token) });
  return { sw, caches, net, read, signIn, skipped: () => skipped };
}

describe("the last-seen data, per account", () => {
  it("is named for the signed-in account", () => {
    expect(dataCacheName(ANU)).toBe(`cookpool-data-v1-${ANU}`);
    expect(() => dataCacheName("../meta")).toThrow();
    expect(staticCacheName(BUILD)).toBe("cookpool-static-bld_1");
  });

  it("keeps each good answer and gives it back when there is no signal, saying when it is from", async () => {
    const t = setup();
    await t.signIn(ANU, "tok_anu");
    const fresh = await t.read(INBOX, "tok_anu");
    expect(fresh.headers.get(CACHED_AT_HEADER)).toBeNull();
    t.net.goOffline();
    const cached = await t.read(INBOX, "tok_anu");
    expect(await cached.json()).toEqual({ data: { for: "Bearer tok_anu" } });
    expect(cached.headers.get(CACHED_AT_HEADER)).toBe("2026-11-05T14:12:00.000Z");
  });

  it("keeps nothing until the page says who is signed in, and nothing for another session's token", async () => {
    const t = setup();
    await t.read(INBOX, "tok_anu");
    expect([...t.caches.stores.keys()].filter((n) => n.startsWith("cookpool-data-"))).toEqual([]);
    await t.signIn(ANU, "tok_anu");
    await t.read(INBOX, "tok_old_session");
    await t.read(INBOX, null);
    expect(t.caches.stores.get(dataCacheName(ANU))?.entries.size ?? 0).toBe(0);
    t.net.goOffline();
    await expect(t.read(INBOX, "tok_old_session")).rejects.toThrow();
  });

  it("never keeps a token: entries are keyed by address alone, and the account record holds a hash", async () => {
    const t = setup();
    await t.signIn(ANU, "tok_anu");
    await t.read(INBOX, "tok_anu");
    const entry = [...t.caches.stores.get(dataCacheName(ANU))!.entries.values()][0]!;
    expect(entry.request.headers.get("authorization")).toBeNull();
    const record = await t.caches.text(META_CACHE, `${ORIGIN}/__cookpool/account`);
    expect(record).not.toContain("tok_anu");
    expect(JSON.parse(record!)).toEqual({ subjectId: ANU, tokenHash: await tokenHash("tok_anu") });
  });

  it("keeps only 200s, and only the listed reads", async () => {
    const t = setup((r) => (r.url === PANTRIES ? new Response("{}", { status: 500 }) : Response.json({ data: 1 })));
    await t.signIn(ANU, "tok_anu");
    await t.read(PANTRIES, "tok_anu");
    expect(t.caches.stores.get(dataCacheName(ANU))?.entries.size ?? 0).toBe(0);
    expect(t.sw.respond(new Request(`${ORIGIN}/api/v1/auth/profile`, { headers: { authorization: "Bearer tok_anu" } }))).toBeNull();
  });

  it("is deleted on sign-out, record and all", async () => {
    const t = setup();
    await t.signIn(ANU, "tok_anu");
    await t.read(INBOX, "tok_anu");
    await t.sw.message({ type: MESSAGE.signedOut });
    expect([...t.caches.stores.keys()].filter((n) => n === META_CACHE || n.startsWith("cookpool-data-"))).toEqual([]);
    expect(await t.sw.account()).toBeNull();
    t.net.goOffline();
    await expect(t.read(INBOX, "tok_anu")).rejects.toThrow();
  });

  it("an answer still on its way at sign-out is not kept", async () => {
    let release: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const atNetwork = new Promise<void>((resolve) => (reached = resolve));
    const t = setup(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(Response.json({ data: 1 }));
          reached();
        }),
    );
    await t.signIn(ANU, "tok_anu");
    const pending = t.read(INBOX, "tok_anu");
    await atNetwork;
    await t.sw.message({ type: MESSAGE.signedOut });
    release();
    await pending;
    await flush();
    expect(t.caches.stores.has(dataCacheName(ANU))).toBe(false);
  });

  it("two accounts on one phone never see each other's data", async () => {
    const t = setup();
    await t.signIn(ANU, "tok_anu");
    await t.read(INBOX, "tok_anu");
    // Dev signs in on the same phone (Anu never signed out).
    await t.signIn(DEV, "tok_dev");
    expect(t.caches.stores.has(dataCacheName(ANU))).toBe(false);
    t.net.goOffline();
    await expect(t.read(INBOX, "tok_dev")).rejects.toThrow();
    // A tab still holding Anu's session gets nothing from Dev's cache either.
    t.net.goOnline();
    await t.read(INBOX, "tok_dev");
    await t.read(PANTRIES, "tok_anu");
    expect([...t.caches.stores.get(dataCacheName(DEV))!.entries.keys()]).toEqual([INBOX]);
    t.net.goOffline();
    await expect(t.read(INBOX, "tok_anu")).rejects.toThrow();
    expect(await (await t.read(INBOX, "tok_dev")).json()).toEqual({ data: { for: "Bearer tok_dev" } });
  });
});

describe("pages and payloads: network first, 3 s, then this build's copy", () => {
  function pageSetup(answer: (r: Request) => Promise<Response>) {
    const caches = new FakeCaches();
    const timers: (() => void)[] = [];
    const sw = createServiceWorker({
      buildId: BUILD,
      precache: ["/home", "/dishes/_"],
      origin: ORIGIN,
      caches: caches as unknown as CacheStorage,
      fetch: answer,
      setTimeout: (fn) => timers.push(fn),
      clearTimeout: () => undefined,
    });
    return { sw, caches, timers };
  }
  const navigation = (path: string) => {
    const r = new Request(`${ORIGIN}${path}`);
    Object.defineProperty(r, "mode", { value: "navigate" });
    return r;
  };

  it("answers from the network when it answers", async () => {
    const t = pageSetup(async () => new Response("fresh"));
    await (await t.caches.open(staticCacheName(BUILD))).put(`${ORIGIN}/home`, new Response("copy"));
    expect(await (await t.sw.respond(navigation("/home"))!).text()).toBe("fresh");
  });

  it("uses this build's copy once the network has taken 3 s", async () => {
    const t = pageSetup(() => new Promise<Response>(() => undefined));
    await (await t.caches.open(staticCacheName(BUILD))).put(`${ORIGIN}/dishes/_`, new Response("the _ file"));
    const answer = t.sw.respond(navigation("/dishes/dsh_x"))!;
    expect(t.timers).toHaveLength(1);
    t.timers[0]!();
    expect(await (await answer).text()).toBe("the _ file");
  });

  it("uses the navigation preload when there is one", async () => {
    const t = pageSetup(async () => new Response("fetched"));
    const answer = t.sw.respond(navigation("/home"), { preloadResponse: Promise.resolve(new Response("preloaded")) })!;
    expect(await (await answer).text()).toBe("preloaded");
  });

  it("fails like the network when there is no copy", async () => {
    const t = pageSetup(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(t.sw.respond(navigation("/home"))!).rejects.toThrow("Failed to fetch");
  });
});

describe("a new build", () => {
  it("copies hashed files an earlier build already has, and downloads the rest", async () => {
    const t = setup((r) => new Response(new URL(r.url).pathname === "/_next/static/chunks/a-1.js" ? "downloaded" : `page of ${BUILD}`));
    await (await t.caches.open(staticCacheName("bld_0"))).put(`${ORIGIN}/_next/static/chunks/a-1.js`, new Response("from bld_0"));
    await t.sw.install();
    expect(await t.caches.text(staticCacheName(BUILD), `${ORIGIN}/_next/static/chunks/a-1.js`)).toBe("from bld_0");
    expect(t.net.seen.map((r) => new URL(r.url).pathname).sort()).toEqual(["/_rsc/home.rsc", "/dishes/_", "/home"]);
    // Activating drops the earlier build's cache and keeps the account's data.
    await t.signIn(ANU, "tok_anu");
    await t.read(INBOX, "tok_anu");
    await t.sw.activate();
    expect(await t.caches.keys()).toEqual(expect.arrayContaining([staticCacheName(BUILD), META_CACHE, dataCacheName(ANU)]));
    expect(await t.caches.has(staticCacheName("bld_0"))).toBe(false);
  });

  it("takes over without a reload only when the page is already this build (its build id)", async () => {
    const t = setup();
    const answers: boolean[] = [];
    // An older page, even one whose script tags this build still has (the
    // chunk that changed was loaded on demand): it waits for Reload.
    await t.sw.message({ type: MESSAGE.adopt, buildId: "bld_0", urls: ["/_next/static/chunks/a-1.js"] }, (a) => answers.push(a.adopted));
    await t.sw.message({ type: MESSAGE.adopt }, (a) => answers.push(a.adopted));
    expect(t.skipped()).toBe(0);
    await t.sw.message({ type: MESSAGE.adopt, buildId: BUILD }, (a) => answers.push(a.adopted));
    expect(t.skipped()).toBe(1);
    expect(answers).toEqual([false, false, true]);
  });

  it("takes over when the page says Reload", async () => {
    const t = setup();
    await t.sw.message({ type: MESSAGE.activate });
    expect(t.skipped()).toBe(1);
  });
});
