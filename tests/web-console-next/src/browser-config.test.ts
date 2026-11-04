import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import {
  DEFAULT_APP_CONFIG,
  RUNTIME_KEYS,
  appConfig,
  browserAppConfig,
  resetAppConfigForTests,
} from "@web-console-next/lib/app-config";
import { SAME_ORIGIN_API_PATH, allTargets, apiTargets, createClient, isLocked, sameOriginTarget } from "@web-console-next/lib/api";
import { SessionProvider, useSession } from "@web-console-next/lib/session";

// Cookpool SM-2: the pages are static files, so the browser resolves the app
// config itself from its own host, and must do so before its first API call
// (risk SM-C: a prod page must never call stage's API, or the other way).
// Cookpool SM-4: on a host that one environment's console Worker serves, that
// API is on the page's own origin, `/api` (the Worker forwards it to api-edge
// over a service binding): same origin, so no CORS preflight. OAuth still
// starts on api-edge's workers.dev host, where the provider returns.

const STAGE_API = "https://cookpool-api-edge-stage.cookpool.workers.dev";
const PROD_API = "https://cookpool-api-edge-prod.cookpool.workers.dev";
const PROD_PAGE_API = "https://cookpool.store/api";
const STAGE_PAGE_API = "https://stage.cookpool.store/api";

describe("browserAppConfig: the environment from the page's host", () => {
  const apiFor = (host: string) => apiTargets(browserAppConfig(host), `https://${host}`).map((t) => t.url);

  it("locks the custom domains to their environment, on their own /api", () => {
    expect(browserAppConfig("cookpool.store").deployEnv).toBe("prod");
    expect(apiFor("cookpool.store")).toEqual([PROD_PAGE_API]);
    expect(browserAppConfig("stage.cookpool.store").deployEnv).toBe("stage");
    expect(apiFor("stage.cookpool.store")).toEqual([STAGE_PAGE_API]);
    expect(isLocked(browserAppConfig("cookpool.store"))).toBe(true);
  });

  it("locks the workers.dev hosts to the -<env> they carry, on their own /api", () => {
    expect(apiFor("cookpool-web-console-next-stage.cookpool.workers.dev")).toEqual([
      "https://cookpool-web-console-next-stage.cookpool.workers.dev/api",
    ]);
    expect(apiFor("cookpool-web-console-next-prod.cookpool.workers.dev")).toEqual([
      "https://cookpool-web-console-next-prod.cookpool.workers.dev/api",
    ]);
  });

  it("leaves localhost and unknown hosts unlocked, offering both workers.dev targets (the developer's picker)", () => {
    for (const host of ["localhost:3001", "127.0.0.1:8787", "[::1]:3001", "www.cookpool.store", "cookpool-web-console-next-dev.cookpool.workers.dev"]) {
      expect(browserAppConfig(host).deployEnv).toBeUndefined();
      expect(apiFor(host)).toEqual([STAGE_API, PROD_API]);
    }
  });

  it("keeps the workers.dev API for OAuth on every host", () => {
    for (const host of ["cookpool.store", "cookpool-web-console-next-prod.cookpool.workers.dev"]) {
      expect(apiTargets(browserAppConfig(host), `https://${host}`).map((t) => t.directUrl)).toEqual([PROD_API]);
    }
    expect(apiTargets(browserAppConfig("stage.cookpool.store"), "https://stage.cookpool.store")[0]!.directUrl).toBe(STAGE_API);
  });
});

describe("sameOriginTarget: only a host that serves the target's environment", () => {
  const config = browserAppConfig("cookpool.store");
  const [stage, prod] = allTargets(config) as [ReturnType<typeof allTargets>[number], ReturnType<typeof allTargets>[number]];

  it("is /api on the page's origin", () => {
    expect(SAME_ORIGIN_API_PATH).toBe("/api");
    expect(sameOriginTarget(prod, config, "https://cookpool.store")).toEqual({ name: "prod", url: PROD_PAGE_API, directUrl: PROD_API });
  });

  it("never sends one environment's calls to another's console", () => {
    // e.g. a build locked to stage opened on the prod domain: prod's Worker
    // would forward to prod's api-edge, so stage keeps its workers.dev API.
    expect(sameOriginTarget(stage, config, "https://cookpool.store")).toEqual(stage);
    expect(sameOriginTarget(prod, config, "https://cookpool-web-console-next-stage.cookpool.workers.dev")).toEqual(prod);
  });

  it("is the workers.dev API with no page (prerendering, tooling) or a host that names nothing", () => {
    expect(sameOriginTarget(prod, config, undefined)).toEqual(prod);
    expect(sameOriginTarget(prod, config, "http://localhost:3001")).toEqual(prod);
    expect(sameOriginTarget(prod, config, "not a url")).toEqual(prod);
  });
});

describe("the browser resolves before its first API call (SM-C)", () => {
  type FakeWindow = { location: { host: string; href: string; origin: string }; localStorage: Storage };
  const g = globalThis as unknown as { window?: FakeWindow; fetch: typeof fetch };
  const realFetch = g.fetch;
  let calls: string[] = [];

  function browserAt(host: string): void {
    const store = new Map<string, string>();
    g.window = {
      location: { host, href: `https://${host}/home`, origin: `https://${host}` },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      } as Storage,
    };
    resetAppConfigForTests();
  }

  beforeEach(() => {
    calls = [];
    g.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify({ data: { providers: [] }, meta: { requestId: "r", cursor: null } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    delete g.window;
    g.fetch = realFetch;
    resetAppConfigForTests();
  });

  /** What the session's first render (a page's first client render) is pointed at. */
  function firstRender(): { target: string; locked: boolean } {
    const seen: { target: string; locked: boolean }[] = [];
    function Probe() {
      const s = useSession();
      seen.push({ target: s.target.url, locked: s.isLocked });
      return null;
    }
    renderToStaticMarkup(React.createElement(SessionProvider, null, React.createElement(Probe)));
    return seen[0]!;
  }

  it("on cookpool.store the very first render already targets prod, and nothing was fetched to decide", () => {
    browserAt("cookpool.store");
    expect(firstRender()).toEqual({ target: PROD_PAGE_API, locked: true });
    expect(calls).toEqual([]);
  });

  it("on stage.cookpool.store it targets stage", () => {
    browserAt("stage.cookpool.store");
    expect(firstRender()).toEqual({ target: STAGE_PAGE_API, locked: true });
  });

  it("on the workers.dev hosts it targets the host's environment, on the host", () => {
    browserAt("cookpool-web-console-next-prod.cookpool.workers.dev");
    expect(firstRender().target).toBe("https://cookpool-web-console-next-prod.cookpool.workers.dev/api");
    browserAt("cookpool-web-console-next-stage.cookpool.workers.dev");
    expect(firstRender().target).toBe("https://cookpool-web-console-next-stage.cookpool.workers.dev/api");
  });

  it("a saved target from the other environment cannot override a locked host", () => {
    browserAt("cookpool.store");
    g.window!.localStorage.setItem(`${DEFAULT_APP_CONFIG.storagePrefix}.target`, "stage");
    expect(firstRender().target).toBe(PROD_PAGE_API);
  });

  it("the first API call a page makes goes to its own environment, on its own origin", async () => {
    browserAt("cookpool.store");
    const client = createClient(apiTargets()[0]!, null);
    await client.auth.listOAuthProviders();
    expect(calls).toEqual([`${PROD_PAGE_API}/v1/auth/oauth/providers`]);
  });

  it("OAuth starts on api-edge's workers.dev host, where Google returns and the state cookie lives", () => {
    browserAt("cookpool.store");
    const client = createClient(apiTargets()[0]!, null);
    const start = new URL(client.auth.oauthStartUrl("google", "https://cookpool.store/auth/callback"));
    expect(`${start.origin}${start.pathname}`).toBe(`${PROD_API}/v1/auth/oauth/google/start`);
    expect(start.searchParams.get("return_to")).toBe("https://cookpool.store/auth/callback");
  });

  it("resolves once, from the host the page was opened on", () => {
    browserAt("stage.cookpool.store");
    expect(appConfig().deployEnv).toBe("stage");
    g.window!.location.host = "cookpool.store";
    expect(appConfig().deployEnv).toBe("stage");
  });
});

// The browser no longer sees the Worker's vars, only the compiled-in values:
// the two must say the same, or a static page and a server-rendered one would
// disagree (e.g. on the storage prefix, signing someone out).
describe("the compiled-in config equals the console Worker's vars", () => {
  const text = new TextDecoder().decode(readFileSync(`${cwd()}/../../apps/web-console-next/wrangler.jsonc`));
  const json = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const vars = (JSON.parse(json) as { vars?: Record<string, string> }).vars ?? {};

  it("for every var wrangler.jsonc sets", () => {
    const keys = Object.entries(RUNTIME_KEYS) as [keyof typeof RUNTIME_KEYS, string][];
    const set = keys.filter(([, key]) => key in vars);
    expect(set.map(([, key]) => key).sort()).toEqual(Object.keys(vars).sort());
    for (const [field, key] of set) expect([key, vars[key]]).toEqual([key, DEFAULT_APP_CONFIG[field]]);
  });
});
