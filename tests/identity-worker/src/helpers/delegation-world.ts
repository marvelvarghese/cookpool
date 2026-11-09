// Shared by the delegation tests (cookpool-mcp MC-2): an identity fake with a
// delegations fake beside it, a clock, sign-in, and request helpers.

import crypto from "node:crypto";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: crypto.webcrypto });
}

import { asUuid } from "@saas/db";
import type { CreateDelegationResponse } from "@saas/contracts/delegations";
import { createFakeRepository } from "./fake-repository";
import { createFakeDelegations } from "./fake-delegations";
import type { Env } from "../../../../apps/identity-worker/src/env";
import { createAuthService } from "../../../../apps/identity-worker/src/services/auth";
import { hashSha256 } from "../../../../apps/identity-worker/src/crypto";
import { handleCreateDelegation } from "../../../../apps/identity-worker/src/handlers/delegations";

export const T0 = new Date("2026-11-09T12:00:00.000Z");
export const DAY = 24 * 60 * 60 * 1000;
export const env = { ENVIRONMENT: "test" } as Env;

export interface World {
  repo: ReturnType<typeof createFakeRepository>;
  delegations: ReturnType<typeof createFakeDelegations>;
  clock: { now: Date };
  deps: { repo: ReturnType<typeof createFakeRepository>; delegations: ReturnType<typeof createFakeDelegations>; now: () => Date };
  auth: ReturnType<typeof createAuthService>;
}

export function world(): World {
  const repo = createFakeRepository();
  const delegations = createFakeDelegations(repo);
  const clock = { now: T0 };
  const now = () => clock.now;
  return { repo, delegations, clock, deps: { repo, delegations, now }, auth: createAuthService({ repo, delegations, now }) };
}

export async function signIn(w: World, email = "anu@cookpool.test"): Promise<{ token: string; userId: string }> {
  const start = await w.auth.startLogin(email);
  if ("error" in start) throw new Error("startLogin failed");
  const done = await w.auth.completeLogin(start.challengeId, start.rawCode);
  if ("error" in done) throw new Error("completeLogin failed");
  return { token: done.token, userId: done.user.id };
}

export function req(path: string, method: string, token: string | null, body?: unknown, headers: Record<string, string> = {}): Request {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`http://identity-worker${path}`, {
    method,
    headers: h,
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

export const BODY = { scopes: ["timers.write", "kitchen.read"], clientName: "  Claude  ", clientId: "cli_abc123" };

export async function create(w: World, token: string | null, body: unknown = BODY): Promise<Response> {
  return handleCreateDelegation(req("/v1/auth/delegations", "POST", token, body), env, "req_t", w.deps);
}

export async function created(w: World, token: string, body: unknown = BODY): Promise<CreateDelegationResponse> {
  const res = await create(w, token, body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: CreateDelegationResponse }).data;
}

export async function errorOf(res: Response): Promise<{ status: number; code: string; reason?: unknown; fields?: unknown }> {
  const json = (await res.json()) as { error: { code: string; details?: { reason?: unknown; fields?: unknown } } };
  return { status: res.status, code: json.error.code, reason: json.error.details?.reason, fields: json.error.details?.fields };
}

export async function seedApiKey(w: World): Promise<string> {
  const spId = crypto.randomUUID();
  const orgId = asUuid(crypto.randomUUID());
  const createdBy = asUuid(crypto.randomUUID());
  const rawKey = `sk_${crypto.randomBytes(32).toString("hex")}`;
  await w.repo.createServicePrincipal({ id: spId, orgId, projectId: null, displayName: "Bot", createdBy, createdAt: T0 });
  await w.repo.createApiKey({
    id: crypto.randomUUID(),
    servicePrincipalId: spId,
    orgId,
    keyPrefix: rawKey.slice(0, 12),
    keyHash: await hashSha256(rawKey),
    label: "k",
    createdBy,
    createdAt: T0,
  });
  return rawKey;
}

