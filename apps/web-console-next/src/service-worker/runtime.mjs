// NO SIGNAL, CLEAN UPDATES (Cookpool PW-4, cookpool-app design §3): the
// service worker itself, as a factory over what it needs from the platform
// (caches, fetch, clients, timers), so its behaviour is tested with fakes.
// scripts/service-worker.mjs bundles it into `/sw.js` with this build's id and
// precache list, and wires it to the worker's events.
//
// - INSTALL copies this build's shell (precache.mjs) into
//   `cookpool-static-<build id>`; a hashed file an earlier build already has
//   is copied from that cache instead of downloaded again. A page or payload
//   that does not name this build (a deploy landed meanwhile) fails the
//   install, which the browser retries on its next update check. A new
//   worker then WAITS: the page offers "New version · Reload", or adopts it
//   silently when the page already is this build (MESSAGE.adopt).
// - ACTIVATE deletes every other build's cache (and data caches of an older
//   shape), turns on navigation preload and takes over open pages.
// - FETCH follows routes.mjs.
// - THE DATA CACHE is per account. The page tells the worker who is signed in
//   (MESSAGE.account: the subject id and a SHA-256 of the session's token);
//   the worker keeps that one record and answers from, or stores into,
//   `cookpool-data-v1-<subject id>` only for requests that carry that very
//   token. A request with any other token (another account, a session from
//   before) goes to the network and is never stored. Telling it about
//   another account deletes every other account's data; sign-out deletes all
//   of it. Tokens, codes and auth answers are never stored: the record holds
//   a hash, entries are keyed by URL alone (no request headers), and the
//   auth routes are not reads it keeps.

import {
  CACHED_AT_HEADER,
  DATA_CACHE_PREFIX,
  DATA_CACHE_VERSION,
  MESSAGE,
  META_CACHE,
  STATIC_CACHE_PREFIX,
  accountUrl,
  bearerToken,
  dataCacheName,
  isSubjectId,
  isTokenHash,
  staticCacheName,
  tokenHash,
} from "./protocol.mjs";
import { NETWORK_CUTOFF_MS, classify } from "./routes.mjs";
import { namesItsBuild } from "./precache.mjs";

/** How many answers one account's data cache keeps (the oldest go first). */
export const DATA_CACHE_LIMIT = 300;

/** How many precache downloads run at once. */
const PARALLEL = 6;

async function inParallel(items, limit, work) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(lanes);
}

/**
 * The worker. `env`: `buildId`, `precache` (paths), `origin`, and the
 * platform's `caches`, `fetch`, `clients`, `registration`, `skipWaiting`,
 * `subtle`, `setTimeout`, `clearTimeout` and `now`.
 */
export function createServiceWorker(env) {
  const { buildId, precache, origin, caches } = env;
  const fetchNow = env.fetch;
  const later = env.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = env.clearTimeout ?? ((id) => clearTimeout(id));
  const now = env.now ?? (() => Date.now());
  const STATIC = staticCacheName(buildId);
  const ACCOUNT = accountUrl(origin);
  const precached = new Set(precache);
  const dataPrefix = `${DATA_CACHE_PREFIX}${DATA_CACHE_VERSION}-`;
  let stored = 0;

  const abs = (path) => new URL(path, origin).href;
  const match = (url, cacheName) => caches.match(url, { cacheName, ignoreVary: true }).catch(() => undefined);

  // ── Install and activate ──────────────────────────────────────────

  async function install() {
    const cache = await caches.open(STATIC);
    const older = (await caches.keys()).filter((n) => n.startsWith(STATIC_CACHE_PREFIX) && n !== STATIC);
    await inParallel([...precache], PARALLEL, async (path) => {
      const url = abs(path);
      if (await cache.match(url)) return;
      const hashed = path.startsWith("/_next/static/");
      if (hashed) {
        // Same name, same bytes: a hashed file an earlier build has is this one.
        for (const name of older) {
          const hit = await match(url, name);
          if (hit) return cache.put(url, hit);
        }
      }
      const response = await fetchNow(new Request(url, { cache: hashed ? "default" : "no-cache", credentials: "same-origin" }));
      if (!response.ok) throw new Error(`precache: ${path} answered ${response.status}`);
      const body = await response.arrayBuffer();
      if (namesItsBuild(path) && !new TextDecoder().decode(body).includes(buildId)) {
        throw new Error(`precache: ${path} is not build ${buildId} (a newer deploy?)`);
      }
      // A fresh Response: never a redirected one, which a navigation refuses.
      await cache.put(url, new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }));
    });
  }

  async function activate() {
    for (const name of await caches.keys()) {
      const otherBuild = name.startsWith(STATIC_CACHE_PREFIX) && name !== STATIC;
      const oldShape = name.startsWith(DATA_CACHE_PREFIX) && !name.startsWith(dataPrefix);
      if (otherBuild || oldShape) await caches.delete(name);
    }
    try {
      await env.registration?.navigationPreload?.enable();
    } catch {
      /* not every browser has it */
    }
    await env.clients?.claim();
  }

  // ── Fetch ─────────────────────────────────────────────────────────

  /** Network first; after the cutoff, or at once when the network fails, this build's copy of `fallback`. */
  function networkFirst(request, fallback, preload) {
    const network = Promise.resolve(preload).then((r) => r || fetchNow(request));
    const copy = () => match(abs(fallback), STATIC);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (response) => {
        if (done) return;
        done = true;
        cancel(timer);
        resolve(response);
      };
      const timer = later(() => {
        void copy().then((hit) => {
          if (hit) finish(hit);
        });
      }, NETWORK_CUTOFF_MS);
      network.then(finish, (error) => {
        cancel(timer);
        void copy().then((hit) => {
          if (done) return;
          done = true;
          if (hit) resolve(hit);
          else reject(error);
        });
      });
    });
  }

  async function cacheFirst(request) {
    const hit = await match(request.url, STATIC);
    return hit ?? fetchNow(request);
  }

  /** The account record, when it is whole. */
  async function account() {
    const hit = await match(ACCOUNT, META_CACHE);
    if (!hit) return null;
    try {
      const a = await hit.json();
      return isSubjectId(a?.subjectId) && isTokenHash(a?.tokenHash) ? { subjectId: a.subjectId, tokenHash: a.tokenHash } : null;
    } catch {
      return null;
    }
  }

  /** The account a request belongs to: the signed-in one, if it carries that session's token. */
  async function accountOf(request) {
    const token = bearerToken(request.headers.get("authorization"));
    if (!token) return null;
    const known = await account();
    if (!known) return null;
    return (await tokenHash(token, env.subtle)) === known.tokenHash ? known : null;
  }

  const same = (a, b) => !!a && !!b && a.subjectId === b.subjectId && a.tokenHash === b.tokenHash;

  /** Keep a good answer for `who`, unless they signed out (or someone else signed in) meanwhile. */
  async function keep(who, url, response) {
    const body = await response.arrayBuffer();
    if (!same(await account(), who)) return;
    const headers = new Headers(response.headers);
    headers.delete("vary");
    headers.set(CACHED_AT_HEADER, new Date(now()).toISOString());
    const name = dataCacheName(who.subjectId);
    const cache = await caches.open(name);
    await cache.put(url, new Response(body, { status: response.status, statusText: response.statusText, headers }));
    // Signed out while that was being written: it goes too.
    if (!same(await account(), who)) {
      await caches.delete(name);
      return;
    }
    if (++stored % 20 === 0) {
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - DATA_CACHE_LIMIT))) await cache.delete(key);
    }
  }

  async function dataRead(request, waitUntil) {
    let who = null;
    try {
      who = await accountOf(request);
    } catch {
      who = null;
    }
    if (!who) return fetchNow(request);
    let response;
    try {
      response = await fetchNow(request);
    } catch (error) {
      const hit = await match(request.url, dataCacheName(who.subjectId));
      if (hit) return hit;
      throw error;
    }
    if (response.status === 200) {
      const job = keep(who, request.url, response.clone()).catch(() => undefined);
      try {
        waitUntil?.(job);
      } catch {
        /* the event is over: the job still runs */
      }
    }
    return response;
  }

  /**
   * The answer to one request, or null to leave it to the browser. Every
   * navigation is answered (navigation preload is on); a request the rules
   * give to the network alone is otherwise left alone.
   */
  function respond(request, ctx = {}) {
    const navigate = request.mode === "navigate";
    let route;
    try {
      route = classify({ method: request.method, url: request.url, mode: request.mode, rsc: request.headers.get("rsc") === "1" }, origin);
    } catch {
      route = { strategy: "network-only" };
    }
    const preload = navigate ? ctx.preloadResponse : undefined;
    switch (route.strategy) {
      case "network-first":
        return precached.has(route.fallback) ? networkFirst(request, route.fallback, preload) : navigate ? fromNetwork(request, preload) : null;
      case "cache-first":
        return cacheFirst(request);
      case "data":
        return dataRead(request, ctx.waitUntil);
      default:
        return navigate ? fromNetwork(request, preload) : null;
    }
  }

  function fromNetwork(request, preload) {
    return Promise.resolve(preload).then((r) => r || fetchNow(request));
  }

  // ── Messages from the page ────────────────────────────────────────

  async function rememberAccount(subjectId, hash) {
    if (!isSubjectId(subjectId) || !isTokenHash(hash)) return;
    const mine = dataCacheName(subjectId);
    // One account's data on this phone at a time.
    for (const name of await caches.keys()) {
      if (name.startsWith(DATA_CACHE_PREFIX) && name !== mine) await caches.delete(name);
    }
    const meta = await caches.open(META_CACHE);
    await meta.put(ACCOUNT, new Response(JSON.stringify({ subjectId, tokenHash: hash }), { headers: { "content-type": "application/json" } }));
  }

  async function forgetAccounts() {
    await caches.delete(META_CACHE);
    for (const name of await caches.keys()) {
      if (name.startsWith(DATA_CACHE_PREFIX)) await caches.delete(name);
    }
  }

  async function message(data, reply) {
    const type = data && typeof data === "object" ? data.type : undefined;
    if (type === MESSAGE.account) return rememberAccount(data.subjectId, data.tokenHash);
    if (type === MESSAGE.signedOut) return forgetAccounts();
    if (type === MESSAGE.activate) return env.skipWaiting?.();
    if (type === MESSAGE.adopt) {
      // Only the very same build: a page of another build keeps its worker
      // until the person reloads (its chunks may be gone from this precache).
      const adopted = typeof data.buildId === "string" && data.buildId === buildId;
      if (adopted) await env.skipWaiting?.();
      reply?.({ adopted });
    }
  }

  return { buildId, install, activate, respond, message, account };
}
