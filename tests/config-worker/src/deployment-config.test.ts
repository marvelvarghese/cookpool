/**
 * Deployment-config regression tests for config-worker and api-edge.
 *
 * BF6/BF6b: resource IDs are never committed. The committed artifact per
 * worker is wrangler.template.jsonc carrying @@wiring(...)@@ tokens; the
 * deployable wrangler.jsonc is rendered by tooling/wire/render.mjs (from
 * wiring.fixture.json offline, from the Secrets Manager manifest live).
 * These tests assert on the committed templates and on an offline fixture
 * render they perform themselves, so they are hermetic on a fresh checkout.
 *
 * Task 0057 — introduced after main CI run 26568163207 failed because
 * config-worker stage used a placeholder database id.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ── Helpers ────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..", "..");

function parseJsonc(raw: string): Record<string, unknown> {
  // Strip single-line // comments (good enough for our wrangler files)
  const stripped = raw.replace(/\/\/.*$/gm, "");
  return JSON.parse(stripped);
}

function readJsonc(relPath: string): Record<string, unknown> {
  return parseJsonc(fs.readFileSync(path.join(ROOT, relPath), "utf-8"));
}

function readYaml(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

/**
 * Offline fixture render of a worker's committed template, exactly as the
 * composition's wire-fixture step does it (same script, same fixture).
 */
function renderFromFixture(
  appDir: string,
  parse: (raw: string) => Record<string, unknown> = parseJsonc,
): Record<string, unknown> {
  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "wire-render-")),
    "wrangler.jsonc",
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "tooling", "wire", "render.mjs"),
      "--template",
      path.join(ROOT, appDir, "wrangler.template.jsonc"),
      "--out",
      outFile,
      "--map",
      path.join(ROOT, appDir, "wiring.fixture.json"),
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`wire render failed for ${appDir}: ${result.stderr}`);
  }
  return parse(fs.readFileSync(outFile, "utf-8"));
}

// Valid Cloudflare D1 database ID: a UUID, or the 32-hex form the offline
// wiring fixture uses.
const D1_ID_RE = /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLACEHOLDER_RE = /PLACEHOLDER/i;
const WIRING_TOKEN_RE = /^@@wiring\(cloudflare-d1\/(stage|prod):d1_database_id\)@@$/;

// ── Workers bound to the platform database ─────────────────────

const D1_WORKER_TEMPLATES = [
  "apps/api-edge/wrangler.template.jsonc",
  "apps/admin-worker/wrangler.template.jsonc",
  "apps/billing-worker/wrangler.template.jsonc",
  "apps/config-worker/wrangler.template.jsonc",
  "apps/events-worker/wrangler.template.jsonc",
  "apps/identity-worker/wrangler.template.jsonc",
  "apps/integrations-worker/wrangler.template.jsonc",
  "apps/kitchen-worker/wrangler.template.jsonc",
  "apps/membership-worker/wrangler.template.jsonc",
  "apps/metering-worker/wrangler.template.jsonc",
  "apps/notifications-worker/wrangler.template.jsonc",
  "apps/projects-worker/wrangler.template.jsonc",
  "apps/webhooks-worker/wrangler.template.jsonc",
];

// ── config-worker D1 wiring ────────────────────────────────────

describe("config-worker D1 wiring", () => {
  type D1Binding = { binding: string; database_name?: string; database_id: string };
  type WranglerEnvs = { env: Record<string, { d1_databases?: D1Binding[] }> };

  const template = readJsonc("apps/config-worker/wrangler.template.jsonc") as WranglerEnvs;
  const rendered = renderFromFixture("apps/config-worker") as unknown as WranglerEnvs;

  test("committed template carries wiring tokens, not literal IDs", () => {
    for (const envName of ["stage", "prod"]) {
      const bindings = template.env[envName]?.d1_databases ?? [];
      const db = bindings.find((b) => b.binding === "PLATFORM_DB");
      expect(db).toBeDefined();
      expect(db!.database_id).toMatch(WIRING_TOKEN_RE);
      expect(db!.database_id).not.toMatch(D1_ID_RE);
    }
  });

  test("fixture render binds stage PLATFORM_DB to a valid database ID", () => {
    const bindings = rendered.env.stage?.d1_databases ?? [];
    const db = bindings.find((b) => b.binding === "PLATFORM_DB");
    expect(db).toBeDefined();
    expect(db!.database_id).toMatch(D1_ID_RE);
  });

  test("fixture render binds prod PLATFORM_DB to a valid ID distinct from stage", () => {
    const stageDb = (rendered.env.stage?.d1_databases ?? []).find(
      (b) => b.binding === "PLATFORM_DB",
    );
    const prodDb = (rendered.env.prod?.d1_databases ?? []).find((b) => b.binding === "PLATFORM_DB");
    expect(prodDb).toBeDefined();
    expect(prodDb!.database_id).toMatch(D1_ID_RE);
    expect(prodDb!.database_id).not.toBe(stageDb!.database_id);
  });

  test("each environment binds its own database, never another environment's", () => {
    for (const envName of ["stage", "prod"]) {
      const db = (rendered.env[envName]?.d1_databases ?? []).find(
        (b) => b.binding === "PLATFORM_DB",
      );
      // SM-3: the Asia–Pacific database (infra/terraform/cloudflare-d1).
      expect(db!.database_name).toBe(`cookpool-${envName}-apac`);
    }
  });

  test("no placeholder database IDs in any rendered environment", () => {
    for (const envName of Object.keys(rendered.env)) {
      for (const entry of rendered.env[envName]?.d1_databases ?? []) {
        expect(entry.database_id).not.toMatch(PLACEHOLDER_RE);
      }
    }
  });

  test("all rendered database IDs are a valid ID format", () => {
    for (const envName of Object.keys(rendered.env)) {
      for (const entry of rendered.env[envName]?.d1_databases ?? []) {
        expect(entry.database_id).toMatch(D1_ID_RE);
      }
    }
  });
});

// ── Cross-worker template scan ─────────────────────────────────

describe("no placeholder or committed resource IDs in any Worker template", () => {
  for (const templatePath of D1_WORKER_TEMPLATES) {
    const fullPath = path.join(ROOT, templatePath);
    // BF6b rolls out in batches; skip workers not yet templated.
    if (!fs.existsSync(fullPath)) continue;

    test(`${templatePath} has no PLACEHOLDER or committed 32-hex IDs`, () => {
      // Scan config values only — strip `//` comments so benign prose (e.g. the
      // identity-worker OAuth setup notes that mention "placeholders") doesn't
      // false-positive. The intent is to catch placeholder resource *IDs*.
      const stripped = fs.readFileSync(fullPath, "utf-8").replace(/\/\/.*$/gm, "");
      expect(stripped).not.toMatch(PLACEHOLDER_RE);
      // BF6 guard (mirrors the composition's verify-worker-structure step):
      // templates must never carry committed resource IDs.
      expect(stripped).not.toMatch(/"(id|database_id)":\s*"[0-9a-f]{32}"/);
    });
  }
});

// ── api-edge CONFIG_WORKER service bindings ────────────────────
//
// Skipped when api-edge is absent: incremental forks copy config-worker
// (batch 14 of the fork order) before api-edge (batch 16).

const HAS_API_EDGE = fs.existsSync(path.join(ROOT, "apps", "api-edge", "component.yaml"));

(HAS_API_EDGE ? describe : describe.skip)("api-edge CONFIG_WORKER service bindings", () => {
  const rendered = (
    HAS_API_EDGE ? renderFromFixture("apps/api-edge") : { env: {} }
  ) as unknown as {
    env: Record<string, { services?: Array<{ binding: string; service: string }> }>;
  };

  test("stage binds CONFIG_WORKER to cookpool-config-worker-stage", () => {
    const svc = rendered.env.stage?.services ?? [];
    const cw = svc.find((s) => s.binding === "CONFIG_WORKER");
    expect(cw).toBeDefined();
    expect(cw!.service).toBe("cookpool-config-worker-stage");
  });

  test("prod binds CONFIG_WORKER to cookpool-config-worker-prod", () => {
    const svc = rendered.env.prod?.services ?? [];
    const cw = svc.find((s) => s.binding === "CONFIG_WORKER");
    expect(cw).toBeDefined();
    expect(cw!.service).toBe("cookpool-config-worker-prod");
  });
});

// ── kitchen-worker (Cookpool CP-4) ─────────────────────────────
//
// The kitchen bounded context: its own D1 wiring, its four service bindings,
// and api-edge's KITCHEN_WORKER binding to it in each deployed environment.
// Its vars hold the app's URL (CP-18), so it is read with the string-aware
// JSONC parser.

describe("kitchen-worker deployment config", () => {
  type Triggers = { crons?: string[] };
  type Rendered = {
    name: string;
    triggers?: Triggers;
    env: Record<
      string,
      {
        workers_dev?: boolean;
        triggers?: Triggers;
        vars?: Record<string, string>;
        d1_databases?: Array<{ binding: string; database_name?: string; database_id: string }>;
        services?: Array<{ binding: string; service: string }>;
      }
    >;
  };
  const template = parseJsoncStrings(
    fs.readFileSync(path.join(ROOT, "apps/kitchen-worker/wrangler.template.jsonc"), "utf-8"),
  ) as unknown as Rendered;
  const rendered = renderFromFixture("apps/kitchen-worker", parseJsoncStrings) as unknown as Rendered;

  // The daily use-soon sweep (CP-18, risks CP-N) and the per-minute timer
  // sweep (GC-3): scheduled() never runs without a cron trigger, and fails
  // silently. `triggers` is inheritable in wrangler: declared at the top
  // level, an environment carries it unless it declares its own — so each
  // deployed environment's effective crons are its own `triggers`, else the
  // top level's.
  const SWEEP_CRON = "30 2 * * *";
  const TIMER_CRON = "* * * * *";
  const CRONS = [SWEEP_CRON, TIMER_CRON];
  const cronsOf = (envName: string): string[] =>
    (rendered.env[envName]?.triggers ?? rendered.triggers)?.crons ?? [];
  const edge = (HAS_API_EDGE ? renderFromFixture("apps/api-edge") : { env: {} }) as unknown as Rendered;

  test("is named cookpool-kitchen-worker", () => {
    expect(template.name).toBe("cookpool-kitchen-worker");
  });

  for (const envName of ["stage", "prod"]) {
    test(`${envName} binds PLATFORM_DB to cookpool-${envName}-apac through a wiring token`, () => {
      const db = (template.env[envName]?.d1_databases ?? []).find((b) => b.binding === "PLATFORM_DB");
      expect(db?.database_name).toBe(`cookpool-${envName}-apac`);
      expect(db?.database_id).toMatch(WIRING_TOKEN_RE);
      const renderedDb = (rendered.env[envName]?.d1_databases ?? []).find((b) => b.binding === "PLATFORM_DB");
      expect(renderedDb?.database_id).toMatch(D1_ID_RE);
    });

    test(`${envName} is private and binds membership, policy, notifications and identity`, () => {
      expect(rendered.env[envName]?.workers_dev).toBe(false);
      const services = Object.fromEntries((rendered.env[envName]?.services ?? []).map((s) => [s.binding, s.service]));
      expect(services).toEqual({
        MEMBERSHIP_WORKER: `cookpool-membership-worker-${envName}`,
        POLICY_WORKER: `cookpool-policy-worker-${envName}`,
        NOTIFICATIONS_WORKER: `cookpool-notifications-worker-${envName}`,
        // People's names (CP-9): identity-worker's internal lookup.
        IDENTITY_WORKER: `cookpool-identity-worker-${envName}`,
      });
    });

    test(`${envName} runs the daily sweep and the timer sweep: its rendered config carries the ${SWEEP_CRON} and ${TIMER_CRON} cron triggers`, () => {
      expect(cronsOf(envName)).toEqual(CRONS);
    });

    test(`${envName} links emails to the ${envName} app over https`, () => {
      // The app's own domain (SI-8): stage.cookpool.store, and the bare
      // cookpool.store for prod.
      expect(rendered.env[envName]?.vars?.APP_URL).toBe(
        envName === "prod" ? "https://cookpool.store" : `https://${envName}.cookpool.store`,
      );
    });

    (HAS_API_EDGE ? test : test.skip)(`api-edge ${envName} binds KITCHEN_WORKER to cookpool-kitchen-worker-${envName}`, () => {
      const svc = (edge.env[envName]?.services ?? []).find((s) => s.binding === "KITCHEN_WORKER");
      expect(svc?.service).toBe(`cookpool-kitchen-worker-${envName}`);
    });
  }

  test("dev carries no bindings (verify-only)", () => {
    expect(template.env.dev?.d1_databases).toBeUndefined();
    expect(template.env.dev?.services).toBeUndefined();
  });

  // Its internal routes (CP-19: a person's balance, for leaving a group) are
  // reachable only over a service binding: kitchen-worker has no public URL
  // (above), api-edge never routes /v1/internal/… (tests/api-edge), and the
  // only workers bound to it are api-edge and membership-worker.
  const membership = renderFromFixture("apps/membership-worker") as unknown as Rendered;
  for (const envName of ["stage", "prod"]) {
    test(`membership-worker ${envName} binds KITCHEN_WORKER to cookpool-kitchen-worker-${envName}, and is private`, () => {
      const svc = (membership.env[envName]?.services ?? []).find((s) => s.binding === "KITCHEN_WORKER");
      expect(svc?.service).toBe(`cookpool-kitchen-worker-${envName}`);
      expect(membership.env[envName]?.workers_dev).toBe(false);
    });
  }

  test("only api-edge and membership-worker are bound to kitchen-worker", () => {
    const appsDir = path.join(ROOT, "apps");
    const holders = fs
      .readdirSync(appsDir)
      .filter((app) => {
        const file = path.join(appsDir, app, "wrangler.template.jsonc");
        return fs.existsSync(file) && /"service":\s*"cookpool-kitchen-worker-(?:dev|stage|prod)"/.test(fs.readFileSync(file, "utf-8"));
      })
      .sort();
    expect(holders).toEqual(HAS_API_EDGE ? ["api-edge", "membership-worker"] : ["membership-worker"]);
  });

  test("the sweeps' triggers are declared once, at the top level, and no environment overrides them", () => {
    expect(template.triggers?.crons).toEqual(CRONS);
    for (const envName of Object.keys(template.env)) expect(template.env[envName]?.triggers).toBeUndefined();
  });

  test("the worker's entry exports scheduled() beside fetch()", () => {
    const entry = fs.readFileSync(path.join(ROOT, "apps/kitchen-worker/src/index.ts"), "utf-8");
    expect(entry).toMatch(/async scheduled\(/);
    expect(entry).toMatch(/async fetch\(/);
  });

  (HAS_API_EDGE ? test : test.skip)("api-edge component.yaml depends on kitchen-worker", () => {
    expect(readYaml("apps/api-edge/component.yaml")).toContain("component: kitchen-worker");
  });
});

// ── api-edge component.yaml depends on config-worker ───────────

(HAS_API_EDGE ? describe : describe.skip)("api-edge component.yaml dependency on config-worker", () => {
  test("dependsOn includes config-worker", () => {
    const yaml = readYaml("apps/api-edge/component.yaml");
    expect(yaml).toContain("component: config-worker");
  });
});

// ── service bindings must be declared dependsOn edges ──────────
//
// A wrangler service binding is a deploy-time prerequisite (Cloudflare
// rejects a deploy whose bound service does not exist), so the component
// DAG must declare it — otherwise fresh-account convergence and
// per-component forks deploy in the wrong order. Two binding edges form
// cycles and cannot be declared in an acyclic DAG; they are acknowledged
// here. On a fresh account policy-worker's pre-deploy places every binding
// target before any binding holder deploys (tooling/deploy/fleet-stubs.mjs),
// so the cycle never has to be deployed in an order.

const ACKNOWLEDGED_BINDING_CYCLES = new Set([
  "billing-worker -> membership-worker", // mutual pair: billing <-> membership
  "membership-worker -> notifications-worker", // cycle: membership -> notifications -> events -> membership
  // Mutual pair (Cookpool CP-19): kitchen-worker depends on membership-worker
  // (rosters, groups, authorization), and membership-worker binds
  // kitchen-worker to ask a leaving member's balance. Deploy order stays
  // advisory (both lanes run dependencyMode: advisory on stage and prod).
  "membership-worker -> kitchen-worker",
  // Mutual pair (Cookpool SI-4): identity-worker depends on membership-worker,
  // and membership-worker binds identity-worker so the signed-out join preview
  // can name the group's first owner (its internal people lookup). Advisory
  // on both sides, like the pair above.
  "membership-worker -> identity-worker",
]);

describe("every wrangler service binding is a declared dependsOn edge", () => {
  const appsDir = path.join(ROOT, "apps");
  for (const app of fs.readdirSync(appsDir)) {
    const wrangler = ["wrangler.template.jsonc", "wrangler.jsonc"]
      .map((f) => path.join(appsDir, app, f))
      .find((f) => fs.existsSync(f));
    if (!wrangler) continue;

    test(`${app} declares its service-binding prerequisites`, () => {
      const raw = fs.readFileSync(wrangler, "utf-8");
      // Deployed worker names may be brand-prefixed (<brand>-<component>-<env>),
      // but the orun component / dependsOn identity is the bare <component>.
      // Derive this worker's brand prefix from its own top-level name vs its
      // app directory, then strip it (and the env suffix) to recover the
      // component — keeping the test brand-agnostic across forks.
      const ownName = (raw.match(/"name":\s*"([a-z][a-z0-9-]*)"/) ?? [])[1] ?? app;
      const brandPrefix = ownName.endsWith(app)
        ? ownName.slice(0, ownName.length - app.length)
        : "";
      const bound = new Set(
        [...raw.matchAll(/"service":\s*"([a-z-]+?)-(?:dev|stage|prod)"/g)].map((m) => {
          const name = m[1] ?? "";
          return brandPrefix && name.startsWith(brandPrefix)
            ? name.slice(brandPrefix.length)
            : name;
        }),
      );
      const componentYaml = readYaml(`apps/${app}/component.yaml`);
      const declared = new Set(
        [...componentYaml.matchAll(/component: ([a-z-]+)/g)].map((m) => m[1]),
      );
      const missing = [...bound].filter(
        (b) => !declared.has(b) && !ACKNOWLEDGED_BINDING_CYCLES.has(`${app} -> ${b}`),
      );
      expect(missing).toEqual([]);
    });
  }
});


// ── identity-worker is private (Cookpool CP-9) ─────────────────
//
// identity-worker serves the service-internal people lookup
// (/v1/internal/identity/users/lookup), which returns names and emails with
// no caller check of its own. It must answer only over service bindings, so
// stage and prod never publish a workers.dev URL; api-edge is the way in.

/** JSONC with `//` comments removed outside strings (identity's vars hold `http://…` URLs). */
function parseJsoncStrings(raw: string): Record<string, unknown> {
  let out = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\") out += raw[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
    } else {
      out += ch;
    }
  }
  return JSON.parse(out);
}

// ── membership-worker binds identity-worker (Cookpool SI-4) ────
//
// The signed-out join preview names the group's first owner through
// identity-worker's internal people lookup. membership-worker is private
// (no workers.dev URL), so the binding adds no public way to that lookup.

describe("membership-worker's identity binding", () => {
  type Rendered = {
    env: Record<string, { workers_dev?: boolean; services?: Array<{ binding: string; service: string }> }>;
  };
  const template = readJsonc("apps/membership-worker/wrangler.template.jsonc") as unknown as Rendered;
  const rendered = renderFromFixture("apps/membership-worker") as unknown as Rendered;

  for (const envName of ["stage", "prod"]) {
    test(`${envName} binds IDENTITY_WORKER to cookpool-identity-worker-${envName}, and is private`, () => {
      const svc = (rendered.env[envName]?.services ?? []).find((s) => s.binding === "IDENTITY_WORKER");
      expect(svc?.service).toBe(`cookpool-identity-worker-${envName}`);
      expect(rendered.env[envName]?.workers_dev).toBe(false);
    });
  }

  test("dev carries no bindings (verify-only)", () => {
    expect(template.env.dev?.services).toBeUndefined();
  });

  test("the binding is acknowledged as a cycle, not declared as a dependsOn edge", () => {
    expect(readYaml("apps/identity-worker/component.yaml")).toContain("component: membership-worker");
    expect(readYaml("apps/membership-worker/component.yaml")).not.toMatch(/component: identity-worker/);
    expect(ACKNOWLEDGED_BINDING_CYCLES.has("membership-worker -> identity-worker")).toBe(true);
  });
});

describe("identity-worker deployment config", () => {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wire-render-")), "wrangler.jsonc");
  const result = spawnSync(process.execPath, [
    path.join(ROOT, "tooling", "wire", "render.mjs"),
    "--template", path.join(ROOT, "apps/identity-worker", "wrangler.template.jsonc"),
    "--out", outFile,
    "--map", path.join(ROOT, "apps/identity-worker", "wiring.fixture.json"),
  ]);
  if (result.status !== 0) throw new Error(`identity-worker render failed: ${String(result.stderr)}`);
  const rendered = parseJsoncStrings(fs.readFileSync(outFile, "utf-8")) as unknown as {
    vars: Record<string, string>;
    env: Record<string, { workers_dev?: boolean; vars: Record<string, string> }>;
  };
  for (const envName of ["stage", "prod"]) {
    test(`${envName} has no public workers.dev URL`, () => {
      expect(rendered.env[envName]?.workers_dev).toBe(false);
    });
  }

  // Cookpool SI-2: sign-in codes are shown on screen only for test domains.
  // Stage used to return every code (DEBUG_DELIVERY=true), so anyone could
  // sign in to stage as anyone; now only name@cookpool.test addresses get one.
  test("stage shows codes only for cookpool.test, prod for no address, local and dev for every address", () => {
    expect(rendered.env["stage"]?.vars["DEBUG_DELIVERY_DOMAINS"]).toBe("*");
    expect(rendered.env["prod"]?.vars["DEBUG_DELIVERY_DOMAINS"]).toBe("");
    expect(rendered.env["dev"]?.vars["DEBUG_DELIVERY_DOMAINS"]).toBe("*");
    expect(rendered.vars["DEBUG_DELIVERY_DOMAINS"]).toBe("*");
  });

  test("no environment carries the old all-or-nothing DEBUG_DELIVERY", () => {
    expect(rendered.vars).not.toHaveProperty("DEBUG_DELIVERY");
    for (const envName of ["dev", "stage", "prod"]) {
      expect(rendered.env[envName]?.vars).not.toHaveProperty("DEBUG_DELIVERY");
    }
  });
});

// ── the app's workers.dev subdomain (Cookpool SI-11) ───────────
//
// The console reads CONSOLE_WORKERS_DEV_SUBDOMAIN from its committed
// wrangler.jsonc to find api-edge. SI-10 moved accounts and missed this file,
// so the new app called the old account's API. Keep it, the console
// component's `workersDevSubdomain` and every rendered api-edge URL in step.

describe("web-console-next workers.dev subdomain", () => {
  const consoleVars = (parseJsoncStrings(fs.readFileSync(path.join(ROOT, "apps/web-console-next/wrangler.jsonc"), "utf-8")) as {
    vars?: Record<string, string>;
  }).vars ?? {};
  const component = fs.readFileSync(path.join(ROOT, "apps/web-console-next/component.yaml"), "utf-8");
  const declared = (component.match(/^\s*workersDevSubdomain:\s*([a-z0-9-]+)\s*$/m) ?? [])[1];

  test("the console's wrangler.jsonc names the same subdomain as its component", () => {
    expect(declared).toBeDefined();
    expect(consoleVars["CONSOLE_WORKERS_DEV_SUBDOMAIN"]).toBe(declared);
  });

  test("the console maps the same custom domains as api-edge, per environment (SI-12)", () => {
    const map = new Map(
      (consoleVars["CONSOLE_CUSTOM_DOMAINS"] ?? "")
        .split(",")
        .map((e) => e.split("=").map((x) => x.trim()) as [string, string])
        .filter(([e, h]) => e && h),
    );
    const edge = parseJsoncStrings(fs.readFileSync(path.join(ROOT, "apps/api-edge/wrangler.template.jsonc"), "utf-8")) as {
      env: Record<string, { vars?: Record<string, string> }>;
    };
    for (const env of ["stage", "prod"]) {
      const host = edge.env[env]?.vars?.["CONSOLE_CUSTOM_DOMAIN"];
      expect(host).toBeTruthy();
      expect(map.get(env)).toBe(host);
    }
  });

  test("identity's console origins use that subdomain", () => {
    const identity = fs.readFileSync(path.join(ROOT, "apps/identity-worker/wrangler.template.jsonc"), "utf-8");
    for (const env of ["stage", "prod"]) {
      expect(identity).toContain(`https://cookpool-web-console-next-${env}.${declared}.workers.dev`);
    }
  });
});

// ── the database near its people (Cookpool SM-3) ───────────────
//
// The D1 database lives in Asia–Pacific (infra/terraform/cloudflare-d1:
// primary_location_hint "apac", named cookpool-<env>-apac), and every Worker
// bound to it runs with Smart Placement, so a request's D1 queries execute
// next to the database instead of across the Pacific. On main every one of
// them redeploys after the database's apply and its migrations (enforced
// edges), so none goes live on a database without its tables.

describe("the database near its people (SM-3)", () => {
  type Placement = { mode?: string };
  type Rendered = {
    placement?: Placement;
    env: Record<
      string,
      {
        placement?: Placement;
        d1_databases?: Array<{ binding: string; database_name?: string; database_id: string }>;
      }
    >;
  };
  const appOf = (templatePath: string): string => templatePath.split("/")[1]!;
  const terraform = fs.readFileSync(path.join(ROOT, "infra/terraform/cloudflare-d1/terraform/main.tf"), "utf-8");
  const adopt = fs.readFileSync(path.join(ROOT, "infra/terraform/cloudflare-d1/terraform/adopt.tf"), "utf-8");

  // The name Terraform gives the database, for this fork's defaults
  // (namespacePrefix "", repo "cookpool"): `${var.namespacePrefix}${var.repo}-${var.environment}<suffix>`.
  const nameSuffix = (terraform.match(
    /^\s*database_name\s*=\s*"\$\{var\.namespacePrefix\}\$\{var\.repo\}-\$\{var\.environment\}([a-z0-9-]*)"\s*$/m,
  ) ?? [])[1];

  test("every Worker that binds PLATFORM_DB is in the list these tests cover", () => {
    const appsDir = path.join(ROOT, "apps");
    const bound = fs
      .readdirSync(appsDir)
      .filter((app) => {
        const file = path.join(appsDir, app, "wrangler.template.jsonc");
        return fs.existsSync(file) && /"binding":\s*"PLATFORM_DB"/.test(fs.readFileSync(file, "utf-8"));
      })
      .sort();
    expect(bound).toEqual(D1_WORKER_TEMPLATES.map(appOf).sort());
  });

  test("Terraform creates the database in Asia–Pacific, once, under the -apac name", () => {
    const resource = (terraform.match(/resource "cloudflare_d1_database" "([a-z_]+)" \{([\s\S]*?)\n\}/) ?? []) as string[];
    expect(resource[1]).toBe("platform_apac");
    expect(resource[2]).toMatch(/^\s*primary_location_hint\s*=\s*"apac"\s*$/m);
    // Cloudflare never reads the hint back: without this, an adopted
    // (imported) database would plan a replacement, which deletes its rows.
    expect(resource[2]).toMatch(/ignore_changes\s*=\s*\[primary_location_hint\]/);
    expect(nameSuffix).toBe("-apac");
    // The pinned provider is a v5: v4's cloudflare_d1_database has no hint.
    expect(terraform).toMatch(/source\s*=\s*"cloudflare\/cloudflare"\s*\n\s*version\s*=\s*"5\.\d+\.\d+"/);
  });

  test("the database before it is forgotten, never destroyed, and adoption targets the new one", () => {
    expect(terraform).toMatch(
      /removed \{\s*from = cloudflare_d1_database\.platform\s+lifecycle \{\s*destroy = false\s*\}\s*\}/,
    );
    expect(adopt).toMatch(/to\s*=\s*cloudflare_d1_database\.platform_apac\s*$/m);
    expect(adopt).toContain('.type == "cloudflare_d1_database" and .name == "platform_apac"');
    expect(terraform).toContain("d1_database_id   = cloudflare_d1_database.platform_apac.id");
  });

  for (const templatePath of D1_WORKER_TEMPLATES) {
    const app = appOf(templatePath);
    const template = parseJsoncStrings(fs.readFileSync(path.join(ROOT, templatePath), "utf-8")) as unknown as Rendered;
    const rendered = renderFromFixture(`apps/${app}`, parseJsoncStrings) as unknown as Rendered;
    // `placement` is inheritable in wrangler: an environment carries the top
    // level's unless it declares its own.
    const placementOf = (envName: string): Placement | undefined =>
      rendered.env[envName]?.placement ?? rendered.placement;

    for (const envName of ["stage", "prod"]) {
      test(`${app} ${envName} runs with Smart Placement`, () => {
        expect(placementOf(envName)).toEqual({ mode: "smart" });
      });

      test(`${app} ${envName} binds PLATFORM_DB to the database Terraform names, cookpool-${envName}${nameSuffix ?? ""}`, () => {
        const db = (rendered.env[envName]?.d1_databases ?? []).find((b) => b.binding === "PLATFORM_DB");
        expect(db?.database_name).toBe(`cookpool-${envName}${nameSuffix}`);
        expect(db?.database_id).toMatch(D1_ID_RE);
      });
    }

    test(`${app} declares placement once, at the top level`, () => {
      expect(template.placement).toEqual({ mode: "smart" });
      for (const envName of Object.keys(template.env)) expect(template.env[envName]?.placement).toBeUndefined();
    });

    test(`${app} redeploys after the database's apply and its migrations, with their wiring`, () => {
      const yaml = readYaml(`apps/${app}/component.yaml`);
      const enforcedOnMain = (component: string): boolean =>
        new RegExp(
          `- component: ${component}\\n\\s+mode: enforced\\n\\s+modeRules:\\n\\s+- mode: advisory\\n\\s+when:\\n\\s+triggerRef: github-pull-request`,
        ).test(yaml);
      expect(enforcedOnMain("cloudflare-d1")).toBe(true);
      expect(enforcedOnMain("db-migrate")).toBe(true);
      expect(yaml).toContain('WIRING_CLOUDFLARE_D1_STAGE: "secret://ws_QX130J0D/cookpool/stage/WIRING_CLOUDFLARE_D1"');
      expect(yaml).toContain('WIRING_CLOUDFLARE_D1_PROD: "secret://ws_QX130J0D/cookpool/prod/WIRING_CLOUDFLARE_D1"');
    });
  }
});

// ── the API on the app's address (Cookpool SM-4) ───────────────
//
// The console Worker answers `/api/*` on the app's own hosts by forwarding to
// api-edge over a service binding, per environment. The composition deploys it
// with `wrangler deploy --config wrangler.jsonc --name <worker>-<env>` (no
// --env), so the component sets CLOUDFLARE_ENV, which picks the section. The
// binding's props are how api-edge tells the console from the internet before
// it believes a forwarded client address (apps/api-edge/src/client-ip.ts).

describe("the API on the app's address (SM-4)", () => {
  type Service = { binding: string; service: string; entrypoint?: string; props?: Record<string, unknown> };
  type Section = { vars?: Record<string, string>; services?: Service[]; placement?: unknown };
  type ConsoleConfig = Section & {
    main?: string;
    assets?: { directory?: string; binding?: string; run_worker_first?: boolean | string[] };
    env: Record<string, Section>;
  };
  const consoleConfig = parseJsoncStrings(
    fs.readFileSync(path.join(ROOT, "apps/web-console-next/wrangler.jsonc"), "utf-8"),
  ) as unknown as ConsoleConfig;
  const component = readYaml("apps/web-console-next/component.yaml");
  const clientIp = fs.readFileSync(path.join(ROOT, "apps/api-edge/src/client-ip.ts"), "utf-8");
  const forwarder = fs.readFileSync(path.join(ROOT, "apps/web-console-next/src/worker/api-forward.mjs"), "utf-8");
  const consoleCaller = (clientIp.match(/export const CONSOLE_CALLER = "([a-z-]+)";/) ?? [])[1];

  test("the Worker's entry is the console's own, which forwards /api and loads OpenNext lazily", () => {
    expect(consoleConfig.main).toBe("src/worker/index.mjs");
    expect(fs.existsSync(path.join(ROOT, "apps/web-console-next", consoleConfig.main!))).toBe(true);
    // The composition still checks the build's own output exists.
    expect(component).toMatch(/^\s*workerEntrypoint: \.open-next\/worker\.js\s*$/m);
  });

  test("/api/* always reaches the Worker, never the static assets or their _redirects", () => {
    expect(consoleConfig.assets).toEqual({ directory: ".open-next/assets", binding: "ASSETS", run_worker_first: ["/api/*"] });
  });

  for (const envName of ["stage", "prod"]) {
    test(`${envName} binds API_EDGE to cookpool-api-edge-${envName}, its default entrypoint, with the console's props`, () => {
      expect(consoleConfig.env[envName]?.services).toEqual([
        { binding: "API_EDGE", service: `cookpool-api-edge-${envName}`, props: { caller: "web-console-next" } },
      ]);
    });
  }

  test("dev (verify-only) and the top level (local wrangler dev) bind nothing", () => {
    expect(consoleConfig.services).toBeUndefined();
    expect(consoleConfig.env.dev?.services).toBeUndefined();
    expect(Object.keys(consoleConfig.env).sort()).toEqual(["dev", "prod", "stage"]);
  });

  test("every environment carries the top level's vars (wrangler does not inherit them)", () => {
    expect(consoleConfig.vars).toBeDefined();
    for (const envName of Object.keys(consoleConfig.env)) expect(consoleConfig.env[envName]?.vars).toEqual(consoleConfig.vars);
  });

  test("the props are the caller api-edge believes, and what the forwarder says it sends", () => {
    expect(consoleCaller).toBe("web-console-next");
    expect(forwarder).toContain(`export const BINDING_PROPS = Object.freeze({ caller: "${consoleCaller}" });`);
    expect(forwarder).toContain('export const CLIENT_IP_HEADER = "x-console-client-ip";');
    expect(clientIp).toContain('export const FORWARDED_CLIENT_IP_HEADER = "x-console-client-ip";');
  });

  test("the deploy picks the environment's section: CLOUDFLARE_ENV is the job's Orun environment", () => {
    expect(component).toMatch(/^  env:\n\s+CLOUDFLARE_ENV: "\{\{ \.environment \}\}"\s*$/m);
  });

  test("on main the console deploys after api-edge; there is no cycle", () => {
    expect(component).toMatch(
      /- component: api-edge\n\s+mode: enforced\n\s+modeRules:\n\s+- mode: advisory\n\s+when:\n\s+triggerRef: github-pull-request/,
    );
    expect(readYaml("apps/api-edge/component.yaml")).not.toMatch(/component: web-console-next/);
  });

  test("the deploy smoke reaches api-edge through /api and requires the console's forwarded address", () => {
    expect(component).toContain('api=$(curl -sf \\"${DEPLOYED_URL}/api/health\\")');
    expect(component).toContain("grep -q '\\\"source\\\":\\\"console\\\"'");
  });

  test("the console takes no Smart Placement: it binds no database, and api-edge is placed on its own (SM-3)", () => {
    expect(consoleConfig.placement).toBeUndefined();
    for (const envName of Object.keys(consoleConfig.env)) expect(consoleConfig.env[envName]?.placement).toBeUndefined();
  });
});

// ── notifications-worker's Web Push keys (Cookpool PW-5) ───────
//
// Each deployed environment has its own VAPID pair: the public key a plain
// var in the template (an empty placeholder until the owner generates the
// pair — push is then off, email unaffected), the private key a runtime
// secret pushed from orun secrets at deploy, never in config.

describe("notifications-worker Web Push keys", () => {
  type Rendered = {
    vars?: Record<string, string>;
    env: Record<string, { vars?: Record<string, string> }>;
  };
  const templateRaw = fs.readFileSync(path.join(ROOT, "apps/notifications-worker/wrangler.template.jsonc"), "utf-8");
  const template = parseJsoncStrings(templateRaw) as unknown as Rendered;
  const rendered = renderFromFixture("apps/notifications-worker", parseJsoncStrings) as unknown as Rendered;
  const component = readYaml("apps/notifications-worker/component.yaml");
  // Empty until the pair exists; then base64url of a 65-byte uncompressed P-256 point.
  const PUBLIC_KEY_RE = /^$|^B[A-Za-z0-9_-]{86}$/;

  for (const envName of ["stage", "prod"]) {
    test(`${envName} declares its VAPID public key as a var, and the subject's sender address`, () => {
      const vars = rendered.env[envName]?.vars ?? {};
      expect(vars).toHaveProperty("VAPID_PUBLIC_KEY");
      expect(vars.VAPID_PUBLIC_KEY).toMatch(PUBLIC_KEY_RE);
      expect(vars.EMAIL_FROM_ADDRESS).toMatch(/^[^@\s]+@[^@\s]+$/);
      expect(template.env[envName]?.vars).not.toHaveProperty("VAPID_PRIVATE_KEY");
    });
  }

  test("stage and prod never share a public key", () => {
    const stage = rendered.env.stage?.vars?.VAPID_PUBLIC_KEY ?? "";
    const prod = rendered.env.prod?.vars?.VAPID_PUBLIC_KEY ?? "";
    if (stage || prod) expect(stage).not.toBe(prod);
  });

  test("the private key is only ever a secret reference, per environment, pushed as a runtime secret", () => {
    expect(templateRaw).not.toMatch(/"VAPID_PRIVATE_KEY"\s*:/);
    expect(component).toMatch(
      /optionalSecretEnv:\n\s+VAPID_PRIVATE_KEY: "secret:\/\/ws_QX130J0D\/cookpool\/\{\{ \.environment \}\}\/VAPID_PRIVATE_KEY"/,
    );
    expect(component).toMatch(/runtimeSecrets: "VAPID_PRIVATE_KEY"/);
  });
});
