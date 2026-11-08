import { API_READS, NETWORK_CUTOFF_MS, apiRead, classify } from "@web-console-next/service-worker/routes.mjs";
import { redirectRules, matchPage, STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";

// Cookpool PW-4: which requests the service worker answers, and how — the
// rules as a table.

const ORIGIN = "https://cookpool.store";
const nav = (path: string) => classify({ method: "GET", url: `${ORIGIN}${path}`, mode: "navigate" }, ORIGIN);
const get = (path: string, extra: { rsc?: boolean; origin?: string } = {}) =>
  classify({ method: "GET", url: `${extra.origin ?? ORIGIN}${path}`, mode: "cors", rsc: extra.rsc ?? false }, ORIGIN);

describe("pages and their payloads: network first, then this build's copy", () => {
  it("waits 3 s for the network", () => {
    expect(NETWORK_CUTOFF_MS).toBe(3000);
  });

  it("falls back to the page's own file", () => {
    expect(nav("/home")).toEqual({ strategy: "network-first", fallback: "/home" });
    expect(nav("/home/")).toEqual({ strategy: "network-first", fallback: "/home" });
    expect(nav("/")).toEqual({ strategy: "network-first", fallback: "/" });
    expect(nav("/login?next=%2Fhome")).toEqual({ strategy: "network-first", fallback: "/login" });
    expect(nav("/pantry/new")).toEqual({ strategy: "network-first", fallback: "/pantry/new" });
  });

  it("a dynamic page falls back to its `_` file, as _redirects serves it", () => {
    expect(nav("/dishes/dsh_x")).toEqual({ strategy: "network-first", fallback: "/dishes/_" });
    expect(nav("/pantry/me:itm_1")).toEqual({ strategy: "network-first", fallback: "/pantry/_" });
    expect(nav("/groups/flat-4b/expense")).toEqual({ strategy: "network-first", fallback: "/groups/_/expense" });
    expect(nav("/join/KTCH2345")).toEqual({ strategy: "network-first", fallback: "/join/_" });
  });

  it("payloads fall back to themselves; a client navigation the shim missed, to its page's payload", () => {
    expect(get("/_rsc/home.rsc?_rsc=abc", { rsc: true })).toEqual({ strategy: "network-first", fallback: "/_rsc/home.rsc" });
    expect(get("/_rsc/dishes/_.rsc?_rsc=abc", { rsc: true })).toEqual({ strategy: "network-first", fallback: "/_rsc/dishes/_.rsc" });
    expect(get("/dishes/dsh_x?_rsc=abc", { rsc: true })).toEqual({ strategy: "network-first", fallback: "/_rsc/dishes/_.rsc" });
    // Without Next's header it is not a client navigation.
    expect(get("/home?_rsc=abc")).toEqual({ strategy: "network-only" });
    expect(get("/_rsc/nope.rsc")).toEqual({ strategy: "network-only" });
  });
});

describe("hashed build files and icons: this build's copy first", () => {
  it.each(["/_next/static/chunks/main-app-b80322d12100fbf7.js", "/_next/static/css/008bd6d633316b4d.css", "/_next/static/media/a.woff2", "/icons/icon-192.png"])(
    "%s",
    (path) => expect(get(path)).toEqual({ strategy: "cache-first" }),
  );
});

describe("a person's own screens: network first, the last good answer kept per account", () => {
  const reads = [
    "/api/v1/organizations",
    "/api/v1/kitchen/me/inbox",
    "/api/v1/kitchen/me/usuals?limit=8",
    "/api/v1/kitchen/me/pantries",
    "/api/v1/kitchen/me/items?pantry=all&limit=50",
    "/api/v1/kitchen/me/items/itm_1",
    "/api/v1/kitchen/me/items/itm_1/moves?limit=100",
    "/api/v1/organizations/org_1/kitchen/items/itm_2",
    "/api/v1/organizations/org_1/kitchen/items/itm_2/moves",
    "/api/v1/kitchen/me/dishes?limit=100",
    "/api/v1/kitchen/me/dishes/dsh_1",
    "/api/v1/organizations/org_1/kitchen/dishes",
    "/api/v1/organizations/org_1/kitchen/members",
    "/api/v1/organizations/org_1/kitchen/settings",
    "/api/v1/organizations/org_1/kitchen/balances",
    "/api/v1/organizations/org_1/kitchen/settle-plan",
    "/api/v1/organizations/org_1/kitchen/activity?limit=20",
    "/api/v1/kitchen/me/balances",
    "/api/v1/kitchen/me/people/usr_1",
  ];

  it.each(reads)("%s", (path) => expect(get(path)).toEqual({ strategy: "data" }));

  it("are exactly the reads listed, one each", () => {
    const covered = new Set(reads.map((r) => apiRead(new URL(`${ORIGIN}${r}`).pathname)));
    expect(covered).toEqual(new Set(API_READS));
  });
});

describe("everything else: the network only, never cached", () => {
  it.each([
    ["any write", { method: "POST", url: `${ORIGIN}/api/v1/kitchen/me/items/itm_1/uses` }],
    ["a PUT", { method: "PUT", url: `${ORIGIN}/api/v1/organizations/org_1/kitchen/dishes/dsh_1/claims/me` }],
    ["sign-in and sessions", { method: "GET", url: `${ORIGIN}/api/v1/auth/session` }],
    ["the profile", { method: "GET", url: `${ORIGIN}/api/v1/auth/profile` }],
    ["OAuth providers", { method: "GET", url: `${ORIGIN}/api/v1/auth/oauth/providers` }],
    ["a join code", { method: "GET", url: `${ORIGIN}/api/v1/organizations/org_1/join-code` }],
    ["a join preview", { method: "GET", url: `${ORIGIN}/api/v1/join/KTCH2345/preview` }],
    ["a typed search", { method: "GET", url: `${ORIGIN}/api/v1/kitchen/me/search?q=mil` }],
    ["names bought before", { method: "GET", url: `${ORIGIN}/api/v1/kitchen/me/items/history?q=mil` }],
    ["dishes cooked before", { method: "GET", url: `${ORIGIN}/api/v1/kitchen/me/dishes/recipes?q=egg` }],
    ["the admin console's API", { method: "GET", url: `${ORIGIN}/api/v1/organizations/org_1/members` }],
    ["health", { method: "GET", url: `${ORIGIN}/api/health` }],
    ["the manifest", { method: "GET", url: `${ORIGIN}/manifest.webmanifest` }],
    ["the worker itself", { method: "GET", url: `${ORIGIN}/sw.js` }],
    ["the build id", { method: "GET", url: `${ORIGIN}/BUILD_ID` }],
    ["another origin's API", { method: "GET", url: "https://cookpool-api-edge-prod.cookpool.workers.dev/v1/kitchen/me/inbox" }],
    ["another origin's files", { method: "GET", url: "https://fonts.example/_next/static/x.js" }],
  ])("%s", (_name, request) => {
    expect(classify({ ...request, mode: "cors" }, ORIGIN)).toEqual({ strategy: "network-only" });
  });

  it.each(["/auth/callback?code=abc", "/orgs", "/orgs/acme/settings", "/account", "/onboarding", "/demo", "/nope"])("a page load of %s", (path) => {
    expect(nav(path)).toEqual({ strategy: "network-only" });
  });

  it("the OAuth return's payload too", () => {
    expect(get("/_rsc/auth/callback.rsc?_rsc=1", { rsc: true })).toEqual({ strategy: "network-only" });
  });
});

describe("/sw.js is a file the Worker never sees", () => {
  it("no _redirects rule takes it", () => {
    for (const rule of redirectRules()) expect(matchPage(rule.split(" ")[0]!, "/sw.js")).toBeNull();
    for (const page of STATIC_PAGES) expect(matchPage(page, "/sw.js")).toBeNull();
  });
});
