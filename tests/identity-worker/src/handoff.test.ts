// One tap from Cookpool into Spliteco (cookpool-spliteco SE-4, risk SE-D):
// POST /v1/auth/handoff makes a one-time code for a signed-in session, bound
// to the person and to the target app's origin; POST /v1/auth/handoff/exchange
// turns it, once, within 60 seconds and only from that origin, into a session
// of the target app's own. Through the handlers, over the identity fake and an
// in-memory handoff store that keeps the SQL's guards.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HANDOFF_CODE_RE, type HandoffCreateResponse, type LoginCompleteResponse } from "@saas/contracts/auth";
import type { ConsumeHandoffResult, CreateHandoffCodeInput, HandoffCode, HandoffRepository } from "@saas/db/identity";
import type { Env } from "../../../apps/identity-worker/src/env";
import { handleCreateHandoff, handleExchangeHandoff } from "../../../apps/identity-worker/src/handlers/handoff";
import { allowedTarget } from "../../../apps/identity-worker/src/services/handoff";
import { createAuthService } from "../../../apps/identity-worker/src/services/auth";
import { hashSha256 } from "../../../apps/identity-worker/src/crypto";
import { T0, createdDelegation, errorOf, signIn } from "./helpers/passkey-world";
import { req, seedApiKey, world as baseWorld, type World } from "./helpers/delegation-world";

const SPLITECO = "https://cookpool-spliteco-web-stage.cookpool.workers.dev";
const ENV = { ENVIRONMENT: "stage", HANDOFF_ORIGINS: `${SPLITECO}, https://other-app.cookpool.workers.dev` } as Env;

function fakeHandoffs(): HandoffRepository & { rows: Array<HandoffCode & { codeHash: string }> } {
  const rows: Array<HandoffCode & { codeHash: string }> = [];
  return {
    rows,
    async create(input: CreateHandoffCodeInput) {
      if (rows.some((r) => r.codeHash === input.codeHash)) throw new Error("UNIQUE constraint failed");
      const row = { id: input.id, userId: input.userId, codeHash: input.codeHash, targetOrigin: input.targetOrigin, createdAt: input.createdAt, expiresAt: input.expiresAt, usedAt: null, sessionId: null };
      rows.push(row);
      return row;
    },
    async consume(codeHash: string, origin: string, now: Date): Promise<ConsumeHandoffResult> {
      const row = rows.find((r) => r.codeHash === codeHash);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.usedAt) return { ok: false, reason: "used" };
      if (row.targetOrigin !== origin) return { ok: false, reason: "wrong_origin" };
      if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
      row.usedAt = now;
      return { ok: true, code: row };
    },
    async attachSession(id: string, sessionId: string) {
      const row = rows.find((r) => r.id === id);
      if (row && !row.sessionId) row.sessionId = sessionId;
    },
  };
}

interface HandoffWorld extends World {
  handoffs: ReturnType<typeof fakeHandoffs>;
  hdeps: { repo: World["repo"]; handoffs: ReturnType<typeof fakeHandoffs>; now: () => Date };
}

function world(): HandoffWorld {
  const base = baseWorld();
  const handoffs = fakeHandoffs();
  return { ...base, handoffs, hdeps: { repo: base.repo, handoffs, now: () => base.clock.now } };
}

const create = (w: HandoffWorld, token: string | null, body: unknown = { targetOrigin: SPLITECO }, env = ENV) =>
  handleCreateHandoff(req("/v1/auth/handoff", "POST", token, body), env, "req_h", w.hdeps);
const exchange = (w: HandoffWorld, code: string, origin: string | null = SPLITECO, env = ENV) =>
  handleExchangeHandoff(req("/v1/auth/handoff/exchange", "POST", null, { code }, origin ? { origin } : {}), env, "req_x", w.hdeps);

async function minted(w: HandoffWorld, token: string): Promise<HandoffCreateResponse> {
  const res = await create(w, token);
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: HandoffCreateResponse }).data;
}

describe("POST /v1/auth/handoff", () => {
  it("makes a 60-second code for the person and the origin, shown once and stored hashed", async () => {
    const w = world();
    const { token, userId } = await signIn(w);
    const made = await minted(w, token);
    expect(made.code).toMatch(HANDOFF_CODE_RE);
    expect(made).toMatchObject({ targetOrigin: SPLITECO, expiresAt: new Date(T0.getTime() + 60_000).toISOString() });
    expect(w.handoffs.rows).toHaveLength(1);
    const row = w.handoffs.rows[0]!;
    expect(row.codeHash).toBe(await hashSha256(made.code));
    expect(JSON.stringify(row)).not.toContain(made.code);
    expect(`usr_${row.userId.replace(/-/g, "")}`).toBe(userId);
    expect(w.repo._securityEvents.map((e) => e.eventType)).toContain("handoff.created");
  });

  it("refuses an origin this environment doesn't hand off to, or a path, or nothing", async () => {
    const w = world();
    const { token } = await signIn(w);
    for (const targetOrigin of ["https://evil.example", `${SPLITECO}/groups`, "http://localhost:3002", 42]) {
      const res = await create(w, token, { targetOrigin });
      expect((await errorOf(res)).status).toBe(422);
    }
    expect((await errorOf(await create(w, token, { targetOrigin: "https://evil.example" }))).reason).toBe("origin_not_allowed");
    expect(w.handoffs.rows).toHaveLength(0);
  });

  it("takes any localhost origin locally only", () => {
    expect(allowedTarget({ ENVIRONMENT: "local" } as Env, "http://localhost:3002")).toBe("http://localhost:3002");
    expect(allowedTarget({ ENVIRONMENT: "local" } as Env, "http://cookpool-stage.localhost:4100")).toBe("http://cookpool-stage.localhost:4100");
    expect(allowedTarget(ENV, "http://localhost:3002")).toBeNull();
    expect(allowedTarget(ENV, `${SPLITECO}/`)).toBe(SPLITECO);
  });

  it("needs a signed-in session: none is 401, an API key or an assistant's token 403 session_required", async () => {
    const w = world();
    expect((await errorOf(await create(w, null))).status).toBe(401);
    const key = await seedApiKey(w);
    expect(await errorOf(await create(w, key))).toMatchObject({ status: 403, reason: "session_required" });
    const { token } = await signIn(w);
    const delegated = await createdDelegation(w, token);
    expect(await errorOf(await create(w, delegated.token))).toMatchObject({ status: 403, reason: "session_required" });
  });
});

describe("POST /v1/auth/handoff/exchange", () => {
  it("gives the target app a session of its own for the same person", async () => {
    const w = world();
    const { token, userId } = await signIn(w);
    const { code } = await minted(w, token);
    const res = await exchange(w, code);
    expect(res.status).toBe(200);
    const session = ((await res.json()) as { data: LoginCompleteResponse }).data;
    expect(session.user.id).toBe(userId);
    expect(session.token).not.toBe(token);
    const auth = createAuthService({ repo: w.repo, now: () => w.clock.now });
    const resolved = await auth.getSession(session.token);
    expect("user" in resolved && resolved.user.id).toBe(userId);
    expect(w.handoffs.rows[0]!.sessionId).not.toBeNull();
    expect(w.repo._securityEvents.find((e) => e.eventType === "session.created" && (e.metadata as { method?: string })?.method === "handoff")).toBeTruthy();
  });

  it("is single use: a replay is 401 handoff_used and mints nothing", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { code } = await minted(w, token);
    expect((await exchange(w, code)).status).toBe(200);
    const sessions = w.repo._securityEvents.filter((e) => e.eventType === "session.created").length;
    expect(await errorOf(await exchange(w, code))).toMatchObject({ status: 401, code: "unauthenticated", reason: "handoff_used" });
    expect(w.repo._securityEvents.filter((e) => e.eventType === "session.created")).toHaveLength(sessions);
  });

  it("expires after 60 seconds", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { code } = await minted(w, token);
    w.clock.now = new Date(T0.getTime() + 60_000);
    expect(await errorOf(await exchange(w, code))).toMatchObject({ status: 401, reason: "handoff_expired" });
  });

  it("works only from the origin it was made for (another app's, or none, is refused) and stays usable there", async () => {
    const w = world();
    const { token } = await signIn(w);
    const { code } = await minted(w, token);
    expect(await errorOf(await exchange(w, code, "https://other-app.cookpool.workers.dev"))).toMatchObject({ status: 401, reason: "handoff_wrong_origin" });
    expect(await errorOf(await exchange(w, code, null))).toMatchObject({ status: 401, reason: "handoff_wrong_origin" });
    expect((await exchange(w, code)).status).toBe(200);
  });

  it("refuses a code it never made, or one that isn't a code", async () => {
    const w = world();
    expect(await errorOf(await exchange(w, `hoc_${"A".repeat(43)}`))).toMatchObject({ status: 401, reason: "handoff_invalid" });
    expect((await errorOf(await exchange(w, "123456"))).status).toBe(422);
  });
});

describe("the Spliteco host signs in like the console (wrangler.template.jsonc)", () => {
  const template = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/identity-worker/wrangler.template.jsonc"), "utf8");
  const config = JSON.parse(template.replace(/^\s*\/\/.*$/gm, "")) as {
    vars: Record<string, string>;
    env: Record<string, { vars: Record<string, string> }>;
  };

  it.each(["dev", "stage", "prod"])("%s: Google and GitHub may return to it, passkeys may come from it, and it takes handoffs", (envName) => {
    const vars = config.env[envName]!.vars;
    const spliteco = `https://cookpool-spliteco-web-${envName}.cookpool.workers.dev`;
    expect(vars.OAUTH_ALLOWED_CONSOLE_ORIGINS!.split(",")).toContain(spliteco);
    expect(vars.HANDOFF_ORIGINS).toBe(spliteco);
    if (envName !== "dev") expect(vars.PASSKEY_ORIGINS!.split(",")).toContain(spliteco);
    // Never another environment's app.
    for (const other of ["dev", "stage", "prod"].filter((e) => e !== envName)) {
      expect(JSON.stringify(vars)).not.toContain(`cookpool-spliteco-web-${other}`);
    }
  });

  it("local takes the app's dev server", () => {
    expect(config.vars.HANDOFF_ORIGINS).toBe("http://localhost:3002");
    expect(config.vars.PASSKEY_ORIGINS!.split(",")).toContain("http://localhost:3002");
  });
});
