// NO SIGNAL, CLEAN UPDATES (Cookpool PW-4, cookpool-app design §3): which
// requests the service worker answers, and how. One pure function,
// `classify`, so the rules are tested as a table:
//
// - NAVIGATIONS to Cookpool's pages and their CLIENT-NAVIGATION PAYLOADS
//   (`/_rsc/*.rsc`, SM-2) → network first, with a 3 s cutoff, then this
//   build's copy. A dynamic page (`/dishes/dsh_x`) falls back to its `_`
//   file, as `_redirects` serves it.
// - HASHED BUILD FILES (`/_next/static/*`) and the ICONS → this build's copy
//   first, else the network.
// - THE READS OF A PERSON'S OWN SCREENS (`GET /api/v1/…`, listed one by one
//   in API_READS) → network first; the last good answer is kept in a cache
//   named for the signed-in account, for when there is no signal.
// - EVERYTHING ELSE → the network only, never cached: any write, the rest of
//   the API (`/api/v1/auth/**` — sessions, profiles, codes —, join codes,
//   typed searches), the OAuth return (`/auth/callback`), the manifest route,
//   the admin console's pages (`/orgs…`, `/account…`), `/sw.js` itself, and
//   every other origin.
//
// Plain JavaScript (with routes.d.mts beside it): the build bundles it into
// `/sw.js`. Dependency-free but for the shared page table.

import { STATIC_PAGES, prerenderedRoute, rscFile, staticPageFor } from "../lib/static-pages.mjs";

/** How long a page or payload waits for the network before this build's copy answers. */
export const NETWORK_CUTOFF_MS = 3000;

/** Where the console Worker answers the API on the app's own address (SM-4). */
export const API_PREFIX = "/api";

/** Pages served as files that never come from the worker: the OAuth return (it carries a code). */
export const UNCACHED_PAGES = Object.freeze(["/auth/callback"]);

/**
 * The API reads kept for when there is no signal, after `/api`: exactly what
 * Home, Pantry, an item, a dish, Groups, a group, People and a person read
 * (the SDK calls those screens make). A `:name` segment is any one value.
 */
export const API_READS = Object.freeze([
  "/v1/organizations", // your groups
  "/v1/kitchen/me/inbox", // Home's inbox (its to-do cards)
  "/v1/kitchen/me/usuals", // Home's and Use's one-tap usuals
  "/v1/kitchen/me/pantries", // every pantry, with its totals
  "/v1/kitchen/me/items", // items: a pantry's list, use soon, what you can use or cook with
  "/v1/kitchen/me/items/:itemId", // an item in your own pantry
  "/v1/kitchen/me/items/:itemId/moves", // its history
  "/v1/organizations/:orgId/kitchen/items/:itemId", // an item in a group's pantry
  "/v1/organizations/:orgId/kitchen/items/:itemId/moves", // its history
  "/v1/kitchen/me/dishes", // your dishes and your groups' (the new frame's Home, You and a person, RC-2)
  "/v1/kitchen/me/dishes/:dishId", // a dish
  "/v1/organizations/:orgId/kitchen/dishes", // a group's dishes
  "/v1/organizations/:orgId/kitchen/members", // a group's people
  "/v1/organizations/:orgId/kitchen/settings", // a group's rules (its currency)
  "/v1/organizations/:orgId/kitchen/balances", // a group's balances
  "/v1/organizations/:orgId/kitchen/settle-plan", // a group's settle-up plan
  "/v1/organizations/:orgId/kitchen/activity", // a group's activity
  "/v1/kitchen/me/balances", // your balances across groups (People, Home)
  "/v1/kitchen/me/people/:subjectId", // a person, and why you owe each other
  "/v1/kitchen/me/recipes", // your recipes and copies (Cook's My recipes, You; RC-5)
  "/v1/kitchen/recipes/:recipeId", // a recipe
  "/v1/kitchen/me/recipes/:recipeId/match", // what your pantries hold for it, per factor
  "/v1/kitchen/me/cook-now", // what you can make now (Home, Cook)
]);

/** Values a `:name` above never takes: these are typed searches (`items/history?q=`, `dishes/recipes?q=`), not screens. */
const NOT_A_VALUE = new Set(["history", "recipes", "search"]);

function matches(pattern, path) {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return false;
  for (let i = 0; i < want.length; i++) {
    if (want[i].charAt(0) === ":") {
      if (!got[i] || NOT_A_VALUE.has(got[i])) return false;
    } else if (want[i] !== got[i]) {
      return false;
    }
  }
  return true;
}

/** The API_READS pattern a pathname (`/api/v1/…`) is, else null. */
export function apiRead(pathname) {
  if (!pathname.startsWith(`${API_PREFIX}/v1/`)) return null;
  const path = pathname.slice(API_PREFIX.length);
  return API_READS.find((p) => matches(p, path)) ?? null;
}

/** The page whose payload file this is (`/_rsc/dishes/_.rsc` → `/dishes/:dishRef`), else null. */
function pageOfPayload(pathname, pages) {
  return pages.find((p) => rscFile(p) === pathname) ?? null;
}

/**
 * How the worker answers one request:
 *
 * - `{ strategy: "network-first", fallback }`: the network, or after
 *   NETWORK_CUTOFF_MS (or at once when it fails) this build's copy of
 *   `fallback`, a path in the precache;
 * - `{ strategy: "cache-first" }`: this build's copy, else the network;
 * - `{ strategy: "data" }`: the network; when it fails, the signed-in
 *   account's last good answer;
 * - `{ strategy: "network-only" }`: the network, never cached.
 *
 * `request` is `{ method, url, mode, rsc }`: `mode` is the Request's
 * (`navigate` for a page load) and `rsc` whether it carries Next's `RSC: 1`
 * header. `origin` is the app's own.
 */
export function classify(request, origin, pages = STATIC_PAGES) {
  const only = { strategy: "network-only" };
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return only;
  }
  if (url.origin !== origin || request.method !== "GET") return only;
  const path = url.pathname;
  const cachedPage = (pathname) => {
    const page = staticPageFor(pathname, pages);
    return page && !UNCACHED_PAGES.includes(page) ? page : null;
  };
  if (request.mode === "navigate") {
    const page = cachedPage(path);
    return page ? { strategy: "network-first", fallback: prerenderedRoute(page) } : only;
  }
  if (path.startsWith("/_rsc/")) {
    const page = pageOfPayload(path, pages);
    return page && !UNCACHED_PAGES.includes(page) ? { strategy: "network-first", fallback: path } : only;
  }
  if (request.rsc && url.searchParams.has("_rsc")) {
    // A client navigation the SM-2 shim did not send to its file (`/home?_rsc=…`).
    const page = cachedPage(path);
    return page ? { strategy: "network-first", fallback: rscFile(page) } : only;
  }
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) return { strategy: "cache-first" };
  if (apiRead(path)) return { strategy: "data" };
  return only;
}
