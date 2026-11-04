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
import { apiTargets, createClient, isLocked } from "@web-console-next/lib/api";
import { SessionProvider, useSession } from "@web-console-next/lib/session";

// Cookpool SM-2: the pages are static files, so the browser resolves the app
// config itself from its own host, and must do so before its first API call
// (risk SM-C: a prod page must never call stage's API, or the other way).

const STAGE_API = "https://cookpool-api-edge-stage.cookpool.workers.dev";
const PROD_API = "https://cookpool-api-edge-prod.cookpool.workers.dev";

describe("browserAppConfig: the environment from the page's host", () => {
  const apiFor = (host: string) => apiTargets(browserAppConfig(host)).map((t) => t.url);

  it("locks the custom domains to their environment", () => {
    expect(browserAppConfig("cookpool.store").deployEnv).toBe("prod");
    expect(apiFor("cookpool.store")).toEqual([PROD_API]);
    expect(browserAppConfig("stage.cookpool.store").deployEnv).toBe("stage");
    expect(apiFor("stage.cookpool.store")).toEqual([STAGE_API]);
    expect(isLocked(browserAppConfig("cookpool.store"))).toBe(true);
  });

  it("locks the workers.dev hosts to the -<env> they carry", () => {
    expect(apiFor("cookpool-web-console-next-stage.cookpool.workers.dev")).toEqual([STAGE_API]);
    expect(apiFor("cookpool-web-console-next-prod.cookpool.workers.dev")).toEqual([PROD_API]);
  });

  it("leaves localhost and unknown hosts unlocked, offering both targets", () => {
    for (const host of ["localhost:3001", "127.0.0.1:8787", "[::1]:3001", "www.cookpool.store"]) {
      expect(browserAppConfig(host).deployEnv).toBeUndefined();
      expect(apiFor(host)).toEqual([STAGE_API, PROD_API]);
    }
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
    expect(firstRender()).toEqual({ target: PROD_API, locked: true });
    expect(calls).toEqual([]);
  });

  it("on stage.cookpool.store it targets stage", () => {
    browserAt("stage.cookpool.store");
    expect(firstRender()).toEqual({ target: STAGE_API, locked: true });
  });

  it("on the workers.dev hosts it targets the host's environment", () => {
    browserAt("cookpool-web-console-next-prod.cookpool.workers.dev");
    expect(firstRender().target).toBe(PROD_API);
    browserAt("cookpool-web-console-next-stage.cookpool.workers.dev");
    expect(firstRender().target).toBe(STAGE_API);
  });

  it("a saved target from the other environment cannot override a locked host", () => {
    browserAt("cookpool.store");
    g.window!.localStorage.setItem(`${DEFAULT_APP_CONFIG.storagePrefix}.target`, "stage");
    expect(firstRender().target).toBe(PROD_API);
  });

  it("the first API call a page makes goes to its own environment", async () => {
    browserAt("cookpool.store");
    const client = createClient(apiTargets()[0]!, null);
    await client.auth.listOAuthProviders();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.startsWith(`${PROD_API}/`)).toBe(true);
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
