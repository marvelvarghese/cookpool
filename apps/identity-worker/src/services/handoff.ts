// One-time handoff codes (cookpool-spliteco SE-4, design §4, risk SE-D).
//
// Cookpool's "More in Spliteco" opens Spliteco on its own host already signed
// in. With a session, Cookpool asks for a code bound to the person and to the
// exact origin of the app it opens; the code lives 60 seconds, is stored as
// its SHA-256 only, and is exchanged once — from that origin, as the browser's
// Origin header says — for a session of the target app's own. A replay, an
// expired code or another origin is 401 with the reason, and mints nothing.

import { HANDOFF_CODE_RE, HANDOFF_CODE_SECONDS, HANDOFF_ERROR_REASONS } from "@saas/contracts/auth";
import type { HandoffRepository, IdentityRepository } from "@saas/db/identity";
import type { Env } from "../env.js";
import { isLocalEnv } from "../oauth/config.js";
import { hashSha256 } from "../crypto.js";
import { createAuthService, type CompleteLoginResult, type RequestContext } from "./auth.js";
import { requireSessionUser, type ServiceFailure } from "./session-user.js";
import { generateSecurityEventId, parseSessionToken } from "../ids.js";

const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$/;

/** The origins this environment hands off to (HANDOFF_ORIGINS, comma-separated; any localhost one locally). */
export function handoffOrigins(env: Pick<Env, "HANDOFF_ORIGINS">): string[] {
  return (env.HANDOFF_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/** An exact origin (scheme, host, port; no path) this environment hands off to, or null. */
export function allowedTarget(env: Env, raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== raw.replace(/\/$/, "")) return null;
  if (handoffOrigins(env).includes(url.origin)) return url.origin;
  if (isLocalEnv(env) && LOCAL_ORIGIN_RE.test(url.origin)) return url.origin;
  return null;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `hoc_` and 32 random bytes, base64url (43 characters). */
export function generateHandoffCode(): string {
  return `hoc_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export interface HandoffServiceDeps {
  env: Env;
  repo: IdentityRepository;
  handoffs: HandoffRepository;
  now: () => Date;
  ctx: RequestContext;
}

export function createHandoffService(deps: HandoffServiceDeps) {
  const { env, repo, handoffs, now, ctx } = deps;

  async function event(input: { eventType: string; outcome: "success" | "failure"; userId: string | null; sessionId?: string | null; metadata: Record<string, unknown> }) {
    await repo.recordSecurityEvent({
      id: generateSecurityEventId(),
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      occurredAt: now(),
      eventType: input.eventType,
      outcome: input.outcome,
      userId: input.userId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      metadata: input.metadata,
    });
  }

  return {
    /** POST /v1/auth/handoff: a code for the signed-in person and `targetOrigin`. */
    async create(token: string | null, body: unknown): Promise<{ code: string; targetOrigin: string; expiresAt: string } | ServiceFailure> {
      const who = await requireSessionUser(repo, token, now(), "A handoff needs a signed-in session");
      if ("status" in who) return who;
      const raw = body && typeof body === "object" ? (body as { targetOrigin?: unknown }).targetOrigin : undefined;
      if (typeof raw !== "string") {
        return { status: 422, code: "validation_failed", message: "Validation failed", details: { fields: { targetOrigin: ["targetOrigin is required"] } } };
      }
      const targetOrigin = allowedTarget(env, raw);
      if (!targetOrigin) {
        return {
          status: 422,
          code: "validation_failed",
          message: "That app is not one this sign-in can open",
          details: { reason: HANDOFF_ERROR_REASONS.ORIGIN_NOT_ALLOWED, fields: { targetOrigin: ["Not an app this environment hands off to"] } },
        };
      }
      const code = generateHandoffCode();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + HANDOFF_CODE_SECONDS * 1000);
      const stored = await handoffs.create({
        id: `hof_${hex(crypto.getRandomValues(new Uint8Array(16)))}`,
        userId: who.userId,
        codeHash: await hashSha256(code),
        targetOrigin,
        createdAt,
        expiresAt,
      });
      await event({ eventType: "handoff.created", outcome: "success", userId: who.userId, sessionId: who.sessionId, metadata: { handoffId: stored.id, targetOrigin } });
      return { code, targetOrigin, expiresAt: expiresAt.toISOString() };
    },

    /** POST /v1/auth/handoff/exchange: the code, from `origin`, for a session of the target app's own. */
    async exchange(origin: string | null, body: unknown): Promise<CompleteLoginResult | ServiceFailure> {
      const code = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
      if (typeof code !== "string" || !HANDOFF_CODE_RE.test(code)) {
        return { status: 422, code: "validation_failed", message: "Validation failed", details: { fields: { code: ["A handoff code is required"] } } };
      }
      const refused = (reason: string, message: string): ServiceFailure => ({ status: 401, code: "unauthenticated", message, details: { reason } });
      if (!origin) return refused(HANDOFF_ERROR_REASONS.WRONG_ORIGIN, "This code can only be used from the app it was made for");
      const taken = await handoffs.consume(await hashSha256(code), origin, now());
      if (!taken.ok) {
        await event({ eventType: "handoff.exchanged", outcome: "failure", userId: null, metadata: { reason: taken.reason, origin } });
        switch (taken.reason) {
          case "expired":
            return refused(HANDOFF_ERROR_REASONS.CODE_EXPIRED, "This sign-in link has expired. Open it again from Cookpool.");
          case "used":
            return refused(HANDOFF_ERROR_REASONS.CODE_USED, "This sign-in link was already used. Open it again from Cookpool.");
          case "wrong_origin":
            return refused(HANDOFF_ERROR_REASONS.WRONG_ORIGIN, "This code can only be used from the app it was made for");
          default:
            return refused(HANDOFF_ERROR_REASONS.CODE_INVALID, "This sign-in link isn't valid");
        }
      }
      const user = await repo.getUserById(taken.code.userId);
      if (!user.ok) return { status: 500, code: "internal_error", message: "Failed to read the user" };
      const auth = createAuthService({ repo, now, ctx });
      const issued = await auth.issueSession(user.value, { method: "handoff", handoffId: taken.code.id, origin });
      if ("error" in issued) return { status: 500, code: "internal_error", message: issued.message };
      const sessionId = parseSessionToken(issued.token)?.sessionId ?? null;
      if (sessionId) await handoffs.attachSession(taken.code.id, sessionId).catch(() => undefined);
      return issued;
    },
  };
}
