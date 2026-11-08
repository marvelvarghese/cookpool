import { readdirSync } from "node:fs";
import { cwd } from "node:process";
import {
  STATIC_PAGES,
  htmlFile,
  matchPage,
  pathParam,
  prerenderedRoute,
  redirectRules,
  rscFetchShim,
  rscFile,
  staticPageFor,
} from "@web-console-next/lib/static-pages.mjs";

// Cookpool SM-2: the kitchen's pages, sign-in, the OAuth return and the entry
// page are prerendered and served as files by Workers Static Assets.

const APP = `${cwd()}/../../apps/web-console-next`;

describe("the pages served as files", () => {
  it("are every Cookpool page, plus sign-in, the OAuth return and the entry page", () => {
    const kitchen = readdirSync(`${APP}/src/app/(kitchen)`, { recursive: true })
      .filter((f) => f === "page.tsx" || f.endsWith("/page.tsx"))
      .map((f) => `/${f.replace(/\/?page\.tsx$/, "")}`.replace(/\[([^\]]+)\]/g, ":$1"))
      .map((p) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p));
    expect([...STATIC_PAGES].sort()).toEqual(["/", "/auth/callback", "/login", ...kitchen].sort());
  });

  it("name their prerendered route and files", () => {
    expect(prerenderedRoute("/dishes/:dishRef")).toBe("/dishes/_");
    expect(prerenderedRoute("/groups/:orgSlug/expense")).toBe("/groups/_/expense");
    expect(htmlFile("/")).toBe("/index.html");
    expect(htmlFile("/home")).toBe("/home.html");
    expect(htmlFile("/join/:code")).toBe("/join/_.html");
    expect(rscFile("/")).toBe("/_rsc/index.rsc");
    expect(rscFile("/pantry/:itemRef")).toBe("/_rsc/pantry/_.rsc");
  });
});

describe("matching an address to its page", () => {
  it("reads each param as the address spells it", () => {
    expect(matchPage("/dishes/:dishRef", "/dishes/dsh_1")).toEqual({ dishRef: "dsh_1" });
    expect(matchPage("/groups/:orgSlug/expense", "/groups/flat-4b/expense")).toEqual({ orgSlug: "flat-4b" });
    expect(matchPage("/join/:code", "/join/AB%20CD")).toEqual({ code: "AB%20CD" });
    expect(matchPage("/home", "/home/")).toEqual({});
    expect(matchPage("/dishes/:dishRef", "/dishes/")).toBeNull();
    expect(matchPage("/dishes/:dishRef", "/dishes/a/b")).toBeNull();
  });

  it("prefers a page without params (`/pantry/new` is not an item)", () => {
    expect(staticPageFor("/pantry/new")).toBe("/pantry/new");
    expect(staticPageFor("/pantry/itm_1")).toBe("/pantry/:itemRef");
    expect(staticPageFor("/groups/flat-4b/expense")).toBe("/groups/:orgSlug/expense");
    expect(staticPageFor("/")).toBe("/");
  });

  it("knows nothing of the Worker's routes", () => {
    for (const p of ["/orgs", "/orgs/acme/settings", "/account", "/onboarding", "/manifest.webmanifest", "/dishes"]) {
      expect(staticPageFor(p)).toBeNull();
    }
  });

  it("finds a layout's param at the start of a longer address", () => {
    expect(pathParam("/groups/:orgSlug", "orgSlug", "/groups/flat-4b/expense")).toBe("flat-4b");
    expect(pathParam("/dishes/:dishRef", "dishRef", "/dishes/dsh_1")).toBe("dsh_1");
    expect(pathParam("/dishes/:dishRef", "dishRef", "/pantry/itm_1")).toBeUndefined();
    expect(pathParam("/dishes/:dishRef", "dishRef", null)).toBeUndefined();
  });
});

describe("_redirects: one file serves every value", () => {
  const rules = redirectRules();

  it("proxies each dynamic page to its `_` file, the address staying (200)", () => {
    for (const rule of [
      "/dishes/:dishRef /dishes/_ 200",
      "/pantry/:itemRef /pantry/_ 200",
      "/people/:subjectId /people/_ 200",
      "/groups/:orgSlug /groups/_ 200",
      "/groups/:orgSlug/expense /groups/_/expense 200",
      "/join/:code /join/_ 200",
      "/recipes/:recipeId /recipes/_ 200",
      "/recipes/:recipeId/edit /recipes/_/edit 200",
    ]) {
      expect(rules).toContain(rule);
    }
  });

  it("pins /pantry/new to itself before the item rule could catch it", () => {
    expect(rules[0]).toBe("/pantry/new /pantry/new 200");
    expect(rules.indexOf("/pantry/new /pantry/new 200")).toBeLessThan(rules.indexOf("/pantry/:itemRef /pantry/_ 200"));
    // One rule per dynamic page (SM-11 added a group's settings, RC-5 a recipe and its edit page), plus the two pins.
    expect(rules).toHaveLength(11);
  });

  it("pins /recipes/new to itself before the recipe rule could catch it (RC-5)", () => {
    expect(rules.indexOf("/recipes/new /recipes/new 200")).toBeGreaterThanOrEqual(0);
    expect(rules.indexOf("/recipes/new /recipes/new 200")).toBeLessThan(rules.indexOf("/recipes/:recipeId /recipes/_ 200"));
    expect(staticPageFor("/recipes/new")).toBe("/recipes/new");
    expect(staticPageFor("/recipes/rcp_1")).toBe("/recipes/:recipeId");
    expect(staticPageFor("/recipes/rcp_1/edit")).toBe("/recipes/:recipeId/edit");
    expect(pathParam("/recipes/:recipeId", "recipeId", "/recipes/rcp_1/edit")).toBe("rcp_1");
  });
});

describe("the RSC fetch shim", () => {
  type Call = { url: string; init: RequestInit | undefined };
  const ORIGIN = "https://cookpool.store";

  /** A window whose fetch answers from `files` (404 otherwise), with the shim installed. */
  function install(files: Record<string, string>) {
    const calls: Call[] = [];
    const win = {
      location: { href: `${ORIGIN}/home`, origin: ORIGIN },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        calls.push({ url, init });
        const body = files[new URL(url).pathname];
        return body === undefined
          ? new Response("not found", { status: 404, headers: { "content-type": "text/html" } })
          : new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } });
      },
    };
    new Function("window", rscFetchShim())(win);
    return { win, calls };
  }
  const rsc = (extra: Record<string, string> = {}): RequestInit => ({
    credentials: "same-origin",
    headers: { RSC: "1", "Next-Router-State-Tree": "%5B%5D", ...extra },
  });

  it("sends a navigation's RSC request to the page's payload file, as Next expects it back", async () => {
    const { win, calls } = install({ "/_rsc/home.rsc": "0:payload" });
    const res = await win.fetch(new URL(`${ORIGIN}/home?_rsc=abc`), rsc());
    expect(calls.map((c) => c.url)).toEqual([`${ORIGIN}/_rsc/home.rsc?_rsc=abc`]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/x-component");
    // Next reads the page's address back from the response.
    expect(res.url).toBe(`${ORIGIN}/home?_rsc=abc`);
    expect(res.redirected).toBe(false);
    expect(await res.text()).toBe("0:payload");
  });

  it("sends a dynamic page to its `_` payload, and /pantry/new to its own", async () => {
    const { win, calls } = install({ "/_rsc/dishes/_.rsc": "d", "/_rsc/pantry/new.rsc": "n", "/_rsc/index.rsc": "i" });
    await win.fetch(new URL(`${ORIGIN}/dishes/dsh_1?_rsc=1`), rsc({ "Next-Router-Prefetch": "1" }));
    await win.fetch(new URL(`${ORIGIN}/pantry/new?_rsc=2`), rsc());
    await win.fetch(new URL(`${ORIGIN}/?_rsc=3`), rsc());
    expect(calls.map((c) => c.url)).toEqual([
      `${ORIGIN}/_rsc/dishes/_.rsc?_rsc=1`,
      `${ORIGIN}/_rsc/pantry/new.rsc?_rsc=2`,
      `${ORIGIN}/_rsc/index.rsc?_rsc=3`,
    ]);
  });

  it("leaves everything else alone", async () => {
    const { win, calls } = install({});
    const api = "https://cookpool-api-edge-prod.cookpool.workers.dev/v1/kitchen/me/inbox";
    await win.fetch(api, { headers: { authorization: "Bearer t" } });
    await win.fetch(new URL(`${ORIGIN}/orgs?_rsc=1`), rsc()); // the Worker's page
    await win.fetch(new URL(`${ORIGIN}/home`), { headers: { accept: "text/html" } }); // not RSC
    await win.fetch(new URL(`${ORIGIN}/home`), rsc()); // no _rsc marker
    await win.fetch(new URL(`https://elsewhere.example/home?_rsc=1`), rsc()); // another origin
    await win.fetch(new URL(`${ORIGIN}/home?_rsc=1`), { ...rsc({ "Next-Action": "x" }), method: "POST" }); // a server action
    expect(calls.map((c) => c.url)).toEqual([
      api,
      `${ORIGIN}/orgs?_rsc=1`,
      `${ORIGIN}/home`,
      `${ORIGIN}/home`,
      "https://elsewhere.example/home?_rsc=1",
      `${ORIGIN}/home?_rsc=1`,
    ]);
  });

  it("falls back to the original request when the payload file is not there (a dev server)", async () => {
    const { win, calls } = install({});
    const res = await win.fetch(new URL(`${ORIGIN}/home?_rsc=abc`), rsc());
    expect(calls.map((c) => c.url)).toEqual([`${ORIGIN}/_rsc/home.rsc?_rsc=abc`, `${ORIGIN}/home?_rsc=abc`]);
    expect(res.status).toBe(404);
  });

  it("installs once", async () => {
    const { win, calls } = install({ "/_rsc/home.rsc": "p" });
    new Function("window", rscFetchShim())(win);
    await win.fetch(new URL(`${ORIGIN}/home?_rsc=1`), rsc());
    expect(calls).toHaveLength(1);
  });
});

describe("pages-as-files (the build step)", () => {
  type Script = { pageFiles(): [string, string][]; redirectsFile(): string };
  const load = async (): Promise<Script> => {
    const spec = "../../../apps/web-console-next/scripts/pages-as-files.mjs";
    return (await import(spec)) as Script;
  };

  it("copies each page's HTML and payload from Next's prerender output", async () => {
    const files = (await load()).pageFiles();
    expect(files).toContainEqual(["/index.html", "/index.html"]);
    expect(files).toContainEqual(["/index.rsc", "/_rsc/index.rsc"]);
    expect(files).toContainEqual(["/dishes/_.html", "/dishes/_.html"]);
    expect(files).toContainEqual(["/groups/_/expense.rsc", "/_rsc/groups/_/expense.rsc"]);
    expect(files).toHaveLength(STATIC_PAGES.length * 2);
  });

  it("writes the rules after a comment saying where they come from", async () => {
    const text = (await load()).redirectsFile();
    expect(text.startsWith("# Written by scripts/pages-as-files.mjs")).toBe(true);
    expect(text.trimEnd().split("\n").slice(-redirectRules().length)).toEqual(redirectRules());
  });
});
