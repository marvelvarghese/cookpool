// A delegated token against every route the edge forwards (cookpool-mcp
// MC-2, design §1; risks MC-A). The route tables are read from the source:
// kitchen-worker's (router.ts, community-routes.ts, ai-routes.ts — everything
// the kitchen facade's catch-all forwards) and every api-edge facade's paths
// and patterns. Each one is tried with every method by a token holding ALL
// four scopes: anything the allowlist does not name is refused with 403
// `forbidden`, reason `scope`, before identity or any worker is asked; and
// the writes the allowlist lets through are pinned, so widening it fails here.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDelegationAllowed } from "@api-edge/delegation-scopes";
import { ALL_SCOPES, ORG, delegatedActor, delegatedToken, edge, reasonOf } from "./delegation-fixtures";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS = resolve(__dirname, "../../../apps");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const HEX = "0123456789abcdef0123456789abcdef";

// ── kitchen-worker's route tables, from its source ──────────────────

interface KitchenRoute {
  pattern: RegExp;
  methods: string[];
  path: string;
}

/** A sample id for the capture after `segment`, in the shape kitchen-worker parses. */
function sampleFor(segment: string): string {
  const prefixes: Record<string, string> = {
    organizations: "org",
    items: "itm",
    recipes: "rcp",
    people: "usr",
    timers: "tmr",
    dishes: "dsh",
    moves: "mov",
    txns: "txn",
    asks: "ask",
    purchases: "pur",
    posts: "pst",
    comments: "cmt",
    claims: "usr",
    follows: "usr",
    followers: "usr",
    blocks: "usr",
    mutes: "usr",
    "follow-requests": "usr",
    "recipe-links": "lnk",
  };
  if (segment === "handles" || segment === "profiles") return "meeracooks";
  return `${prefixes[segment] ?? "xid"}_${HEX}`;
}

function pathFromPattern(pattern: RegExp): string {
  const segments = pattern.source
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\(\[\^\\?\/\]\+\)/g, "\u0000")
    .replace(/\\\//g, "/")
    .split("/");
  const out: string[] = [];
  for (const seg of segments) out.push(seg === "\u0000" ? sampleFor(out[out.length - 1] ?? "") : seg);
  return out.join("/");
}

function kitchenRoutes(): KitchenRoute[] {
  const files = ["router.ts", "community-routes.ts", "ai-routes.ts"].map((f) =>
    readFileSync(join(APPS, "kitchen-worker/src", f), "utf8"),
  );
  const routes: KitchenRoute[] = [];
  const entry = /pattern:\s*\/(.+)\/,\s*\n\s*methods:\s*\{([^}]*)\}/g;
  for (const text of files) {
    for (const m of text.matchAll(entry)) {
      const pattern = new RegExp(m[1]!);
      const methods = [...m[2]!.matchAll(/\b(GET|POST|PUT|PATCH|DELETE):/g)].map((x) => x[1]!);
      routes.push({ pattern, methods, path: pathFromPattern(pattern) });
    }
  }
  return routes;
}

// ── spliteco-worker's route table, from its source (cookpool-spliteco SE-6) ──

const SPLITECO_SAMPLES: Record<string, string> = {
  groups: `org_${HEX}`,
  expenses: `txn_${HEX}`,
  friends: `usr_${HEX}`,
  settlements: `txn_${HEX}`,
  live: "KTCH2345",
  drafts: `drf_${HEX}`,
};

function splitecoRoutes(): KitchenRoute[] {
  const text = readFileSync(join(APPS, "spliteco-worker/src/router.ts"), "utf8");
  const routes: KitchenRoute[] = [];
  const entry = /pattern:\s*new RegExp\(`\$\{P\}([^`]*)`\),\s*\n?\s*methods:\s*\{([^}]*)\}/g;
  for (const m of text.matchAll(entry)) {
    const body = m[1]!.replace(/\$$/, "").replace(/\\\\\./g, ".").replace(/\(csv\|json\)/, "csv");
    const segments = body.split("/");
    const out: string[] = [];
    for (const seg of segments) out.push(seg === "${ID}" ? (SPLITECO_SAMPLES[out[out.length - 1] ?? ""] ?? `xid_${HEX}`) : seg);
    const path = `/v1/spliteco${out.join("/")}`;
    const methods = [...m[2]!.matchAll(/\b(GET|POST|PUT|PATCH|DELETE):/g)].map((x) => x[1]!);
    routes.push({ pattern: new RegExp(`^${path.replace(/\./g, "\\.")}$`), methods, path });
  }
  return routes;
}

// ── api-edge's facades: their paths and patterns, from their source ──

function facadeTables(): { literals: string[]; patterns: RegExp[] } {
  const dir = join(APPS, "api-edge/src");
  const literals = new Set<string>();
  const patterns: RegExp[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith("-facade.ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const m of text.matchAll(/"(\/(?:v1|ingress)\/[^"]*)"/g)) literals.add(m[1]!);
    for (const m of text.matchAll(/^const \w+_RE = \/(.+)\/([a-z]*);$/gm)) patterns.push(new RegExp(m[1]!, m[2]));
  }
  return { literals: [...literals], patterns };
}

const PRJ = `prj_${HEX}`;
const ENV = `env_${HEX}`;
const O = `/v1/organizations/${ORG}`;
const config = (base: string) =>
  ["settings", "settings/k", "feature-flags", "feature-flags/k", "secrets", "secrets/k", "secrets/k/rotate"].map(
    (s) => `${base}/config/${s}`,
  );

/** One or more paths for every facade pattern (checked below); kitchen's come from kitchen-worker. */
const FACADE_SAMPLES = [
  `${O}`,
  `${O}/members`,
  `${O}/members/usr_${HEX}`,
  `${O}/invitations`,
  `${O}/invitations/accept`,
  `${O}/invitations/inv_${HEX}`,
  `${O}/api-keys`,
  `${O}/api-keys/key_${HEX}`,
  "/v1/join",
  "/v1/join/ABCD1234",
  "/v1/join/ABCD1234/preview",
  `${O}/join-code`,
  `${O}/join-code/rotate`,
  `${O}/leave`,
  `${O}/audit`,
  ...config(O),
  ...config(`${O}/projects/${PRJ}`),
  ...config(`${O}/projects/${PRJ}/environments/${ENV}`),
  ...["plans", "customer", "summary", "invoices", "entitlements", "payment-methods", "checkout", "portal", "subscription/cancel", "subscription/change", "reconcile"].map(
    (s) => `${O}/billing/${s}`,
  ),
  "/v1/billing/webhooks/polar",
  `${O}/usage`,
  `${O}/usage/batch`,
  `${O}/usage/summary`,
  `${O}/quotas/check`,
  `${O}/quotas/violations`,
  `${O}/projects`,
  `${O}/projects/${PRJ}`,
  `${O}/projects/${PRJ}/environments`,
  `${O}/projects/${PRJ}/environments/${ENV}`,
  `${O}/integrations`,
  `${O}/integrations/github/installations`,
  `${O}/projects/${PRJ}/repo-links`,
  `${O}/projects/${PRJ}/repo-links/rl_1`,
  `${O}/webhooks/endpoints`,
  `${O}/projects/${PRJ}/webhooks/endpoints`,
  "/v1/auth/oauth/github/start",
  "/v1/auth/oauth/github/callback",
  `/v1/auth/delegations/dlg_${HEX}`,
  // Passkeys (PK-2): removing one.
  "/v1/auth/passkeys/pky_0123456789abcdef",
  // Beyond the tables: the kitchen roots, internal routes no facade should
  // forward, an admin path, and MC-5's suggestion routes before they exist.
  "/v1/kitchen",
  `${O}/kitchen`,
  `/v1/internal/kitchen/organizations/${ORG}/subjects/usr_${HEX}/balance`,
  "/v1/internal/delegations/refresh",
  "/v1/internal/identity/users/lookup",
  "/v1/admin/users",
  "/v1/kitchen/me/suggestions",
  `/v1/kitchen/me/suggestions/sug_${HEX}/confirm`,
  `/v1/kitchen/me/suggestions/sug_${HEX}/discard`,
  // Spliteco: the root, and ids of the wrong kind where a delegated token must not reach.
  "/v1/spliteco",
  `/v1/spliteco/groups/xid_${HEX}`,
  `/v1/spliteco/expenses/xid_${HEX}`,
  "/v1/spliteco/drafts/drf_nothex/save",
  // Tripeco (tripeco TR-2): no scope lists any of it.
  "/v1/tripeco/me",
  `/v1/tripeco/rides/trp_${HEX}`,
  // Words kitchen-worker routes where an id could sit.
  "/v1/kitchen/me/items/history",
  "/v1/kitchen/me/recipes/copies",
];

const KITCHEN = kitchenRoutes();
const SPLITECO_ROUTES = splitecoRoutes();
const FACADES = facadeTables();
const ALL_PATHS = [...new Set([...KITCHEN.map((r) => r.path), ...SPLITECO_ROUTES.map((r) => r.path), ...FACADES.literals, ...FACADE_SAMPLES])];

/** Every (method, path) a token with all four scopes may use. Widening the allowlist must change this list. */
const ALLOWED = [
  "GET /v1/kitchen/me/pantries",
  "GET /v1/kitchen/me/items",
  `GET /v1/kitchen/me/items/itm_${HEX}`,
  "GET /v1/kitchen/me/search",
  "GET /v1/kitchen/me/balances",
  `GET /v1/kitchen/me/people/usr_${HEX}`,
  "GET /v1/kitchen/me/inbox",
  "GET /v1/kitchen/me/recipes",
  `GET /v1/kitchen/me/recipes/rcp_${HEX}/match`,
  "GET /v1/kitchen/me/cook-now",
  "GET /v1/kitchen/recipes",
  `GET /v1/kitchen/recipes/rcp_${HEX}`,
  "GET /v1/kitchen/me/timers",
  "POST /v1/kitchen/me/timers",
  `DELETE /v1/kitchen/me/timers/tmr_${HEX}`,
  "GET /v1/kitchen/me/restock",
  `GET ${O}/kitchen/balances`,
  `GET ${O}/kitchen/items`,
  "POST /v1/kitchen/me/suggestions",
  // Spliteco (SE-6): money.read's reads…
  "GET /v1/spliteco/me/home",
  "GET /v1/spliteco/me/groups",
  "GET /v1/spliteco/me/balances",
  "GET /v1/spliteco/me/activity",
  "GET /v1/spliteco/me/search",
  `GET /v1/spliteco/me/friends/usr_${HEX}`,
  `GET /v1/spliteco/groups/org_${HEX}`,
  `GET /v1/spliteco/groups/org_${HEX}/activity`,
  `GET /v1/spliteco/expenses/txn_${HEX}`,
  "GET /v1/spliteco/insights",
  // …and money.write's writes: drafts, delete, restore, comments, reminders. Never a payment.
  "POST /v1/spliteco/drafts",
  `POST /v1/spliteco/drafts/drf_${HEX}/save`,
  `DELETE /v1/spliteco/expenses/txn_${HEX}`,
  `POST /v1/spliteco/expenses/txn_${HEX}/restore`,
  `POST /v1/spliteco/expenses/txn_${HEX}/comments`,
  "POST /v1/spliteco/reminders",
].sort();

/** Spliteco's routes a delegated token never reaches, whatever its scopes (design §0.9). */
const SPLITECO_REFUSED = [
  `POST /v1/spliteco/groups/org_${HEX}/settlements`,
  `POST /v1/spliteco/settlements/txn_${HEX}/not-received`,
  `GET /v1/spliteco/groups/org_${HEX}/settle-plan`,
  "GET /v1/spliteco/me/profile",
  "PUT /v1/spliteco/me/profile",
  "POST /v1/spliteco/groups",
  `PUT /v1/spliteco/groups/org_${HEX}/settings`,
  `POST /v1/spliteco/groups/org_${HEX}/live`,
  "GET /v1/spliteco/live/KTCH2345",
  "POST /v1/spliteco/live/KTCH2345/claims",
  "POST /v1/spliteco/live/KTCH2345/lock",
  `POST /v1/spliteco/me/friends/usr_${HEX}/direct`,
  `GET /v1/spliteco/groups/org_${HEX}/export.csv`,
  // Straight away, without a draft:
  `POST /v1/spliteco/groups/org_${HEX}/expenses`,
  `PUT /v1/spliteco/expenses/txn_${HEX}`,
  `POST /v1/spliteco/expenses/txn_${HEX}/move`,
];

describe("the route tables are read whole", () => {
  it("finds kitchen-worker's routes, each sample matching its own pattern", () => {
    expect(KITCHEN.length).toBeGreaterThan(80);
    for (const r of KITCHEN) {
      expect(r.methods.length).toBeGreaterThan(0);
      expect(r.pattern.test(r.path)).toBe(true);
    }
  });

  it("finds spliteco-worker's routes, every one of them either allowed or refused by name", () => {
    expect(SPLITECO_ROUTES.length).toBeGreaterThan(25);
    const all = SPLITECO_ROUTES.flatMap((r) => r.methods.map((m) => `${m} ${r.path}`)).sort();
    const named = [...ALLOWED.filter((a) => a.includes("/v1/spliteco/")), ...SPLITECO_REFUSED].sort();
    expect(all).toEqual(named);
  });

  it("has a sample for every facade pattern", () => {
    expect(FACADES.patterns.length).toBeGreaterThan(40);
    const unmatched = FACADES.patterns.filter((p) => !ALL_PATHS.some((path) => p.test(path)));
    expect(unmatched.map(String)).toEqual([]);
  });
});

describe("a delegated token with every scope, against every route and method", () => {
  const cases = ALL_PATHS.flatMap((path) => METHODS.map((method) => ({ method, path })));

  it("is allowed exactly the pinned list, and only GETs besides the timer, suggestion and Spliteco writes", () => {
    const allowed = cases.filter((c) => isDelegationAllowed(c.method, c.path, ALL_SCOPES)).map((c) => `${c.method} ${c.path}`);
    expect(allowed.sort()).toEqual(ALLOWED);
    const writes = allowed.filter((a) => !a.startsWith("GET "));
    expect(writes.sort()).toEqual(
      [
        "POST /v1/kitchen/me/timers",
        `DELETE /v1/kitchen/me/timers/tmr_${HEX}`,
        "POST /v1/kitchen/me/suggestions",
        "POST /v1/spliteco/drafts",
        `POST /v1/spliteco/drafts/drf_${HEX}/save`,
        `DELETE /v1/spliteco/expenses/txn_${HEX}`,
        `POST /v1/spliteco/expenses/txn_${HEX}/restore`,
        `POST /v1/spliteco/expenses/txn_${HEX}/comments`,
        "POST /v1/spliteco/reminders",
      ].sort(),
    );
    // No payment, however it is spelled.
    expect(allowed.filter((a) => /settle|not-received|profile|live|\/groups\/[^/]+\/expenses/.test(a))).toEqual([]);
  });

  it("refuses every Spliteco payment, setting and straight-away write by name, before identity is asked", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(ALL_SCOPES) });
    for (const entry of SPLITECO_REFUSED) {
      const [method, path] = entry.split(" ") as [string, string];
      expect([entry, await reasonOf(await e.fetch(path, method))]).toEqual([entry, { status: 403, code: "forbidden", reason: "scope" }]);
    }
    expect(e.resolves()).toBe(0);
    expect(e.forwarded).toEqual([]);
  });

  it("is refused everything else with reason scope, before identity or any worker is asked", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(ALL_SCOPES) });
    const leaks: string[] = [];
    for (const { method, path } of cases) {
      if (isDelegationAllowed(method, path, ALL_SCOPES)) continue;
      const before = { forwarded: e.forwarded.length, resolves: e.resolves() };
      const res = await e.fetch(path, method);
      const got = await reasonOf(res);
      if (got.status !== 403 || got.code !== "forbidden" || got.reason !== "scope") leaks.push(`${method} ${path} → ${got.status}`);
      if (e.forwarded.length !== before.forwarded || e.resolves() !== before.resolves) leaks.push(`${method} ${path} reached a worker`);
    }
    expect(leaks).toEqual([]);
  });

  it("reaches kitchen-worker or spliteco-worker on each allowed route, with the delegation forwarded", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(ALL_SCOPES) });
    for (const entry of ALLOWED) {
      const [method, path] = entry.split(" ") as [string, string];
      const res = await e.fetch(path, method);
      expect([entry, res.status]).toEqual([entry, 200]);
      const last = e.forwarded[e.forwarded.length - 1]!;
      expect(last.binding).toBe(path.startsWith("/v1/spliteco/") ? "SPLITECO_WORKER" : "KITCHEN_WORKER");
      expect(new URL(last.url).pathname).toBe(path);
      expect(last.headers.get("x-actor-delegation-id")).toBe("dlg_0123456789abcdef0123456789abcdef");
      expect(last.headers.get("x-actor-scopes")).toBe(ALL_SCOPES.join(","));
    }
  });

  it("is refused the same way however the Authorization header is spelled", async () => {
    const e = edge({ [delegatedToken()]: delegatedActor(ALL_SCOPES) });
    for (const authorization of [`Bearer  ${delegatedToken()}`, `bearer ${delegatedToken()}`, delegatedToken(), `Basic ${delegatedToken()}`]) {
      for (const path of ["/v1/auth/profile", "/v1/auth/delegations", `${O}/members`]) {
        const got = await reasonOf(await e.fetch(path, "GET", { authorization }));
        expect([authorization, path, got.reason]).toEqual([authorization, path, "scope"]);
      }
    }
    expect(e.forwarded).toEqual([]);
  });
});
