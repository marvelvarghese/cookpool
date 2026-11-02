/// <reference types="@cloudflare/workers-types" />
/**
 * Cookpool SI-2: limits on sign-in codes, through the handlers.
 *
 * - A code allows 5 tries: wrong codes answer 404 `not_found` with
 *   `details.attemptsLeft` (4, 3, 2, 1); the 5th wrong one spends the code and
 *   answers 422 `precondition_failed` / `too_many_attempts`, and so does every
 *   try after it, the right code included.
 * - An address can ask for 5 codes in 15 minutes; the 6th answers 429
 *   `rate_limited` with `details.retryAfterSeconds` until the oldest of the
 *   five leaves the window.
 * - Only addresses in DEBUG_DELIVERY_DOMAINS get their code on screen.
 *
 * The repository here is the in-memory fake, which mirrors the D1 statements;
 * tests/db runs the real statements against SQLite (atomicity included).
 */
import crypto from "node:crypto";
import { createFakeRepository } from "./helpers/fake-repository";
import type { Env } from "../../../apps/identity-worker/src/env";
import type { LoginStartResponse } from "@saas/contracts/auth";
import {
  AUTH_ERROR_REASONS,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODES_PER_WINDOW,
  LOGIN_CODE_WINDOW_SECONDS,
} from "@saas/contracts/auth";
import { LOGIN_CHALLENGE_MAX_ATTEMPTS } from "@saas/db/identity";
import type {
  NotificationsClientContext,
  NotificationsEnvBinding,
  EnqueueNotificationResult,
} from "@saas/notifications-client";
import type { EnqueueNotificationRequest } from "@saas/contracts/notifications";

interface GlobalCryptoLike {
  crypto?: { subtle?: unknown; randomUUID?: () => string };
}
const g: GlobalCryptoLike = globalThis;
if (!g.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: crypto.webcrypto });
}
if (typeof g.crypto?.randomUUID !== "function") {
  (g.crypto as { randomUUID: () => string }).randomUUID = () => crypto.randomUUID();
}

import { handleLoginStart } from "../../../apps/identity-worker/src/handlers/login-start";
import { handleLoginComplete } from "../../../apps/identity-worker/src/handlers/login-complete";
import { handleHealth } from "../../../apps/identity-worker/src/handlers/health";
import { createAuthService } from "../../../apps/identity-worker/src/services/auth";
import { parseChallengePublicId } from "../../../apps/identity-worker/src/ids";
import {
  deliversCodeInline,
  parseDebugDeliveryDomains,
} from "../../../apps/identity-worker/src/debug-delivery";

type Repo = ReturnType<typeof createFakeRepository>;

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown>; requestId: string };
}

const T0 = new Date("2026-11-02T09:00:00.000Z");
const MINUTE = 60_000;

function makeEnv(extras: Partial<Env> = {}): Env {
  return { ENVIRONMENT: "test", NOTIFICATIONS_WORKER: {} as Fetcher, ...extras } as Env;
}

function makeRecorder() {
  const calls: EnqueueNotificationRequest[] = [];
  const fn = async (
    _env: NotificationsEnvBinding,
    _ctx: NotificationsClientContext,
    request: EnqueueNotificationRequest,
  ): Promise<EnqueueNotificationResult> => {
    calls.push(request);
    return { ok: true as const, notificationId: `notif_${calls.length}` };
  };
  return { calls, fn };
}

function startRequest(email: string, ip = "203.0.113.1"): Request {
  return new Request("https://identity.internal/v1/auth/login/start", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ email }),
  });
}

function completeRequest(challengeId: string, code: string): Request {
  return new Request("https://identity.internal/v1/auth/login/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challengeId, code }),
  });
}

/** A challenge for `email` at `at`, with its code (set up through the service, not the handler under test). */
async function issueCode(repo: Repo, email = "anu@example.com", at = T0) {
  const started = await createAuthService({ repo, now: () => at }).startLogin(email);
  if ("error" in started) throw new Error("startLogin failed");
  const wrongCode = started.rawCode === "000000" ? "111111" : "000000";
  return { challengeId: started.challengeId, code: started.rawCode, wrongCode };
}

async function complete(repo: Repo, challengeId: string, code: string, at = new Date(T0.getTime() + MINUTE), requestId = "req_complete") {
  return handleLoginComplete(completeRequest(challengeId, code), makeEnv(), requestId, { repo, now: () => at });
}

function stored(repo: Repo, challengeId: string) {
  return repo._challenges.get(parseChallengePublicId(challengeId)!)!;
}

describe("the limits agree with what the app is told", () => {
  it("5 tries per code, 5 codes per 15 minutes", () => {
    expect(LOGIN_CODE_MAX_ATTEMPTS).toBe(5);
    expect(LOGIN_CHALLENGE_MAX_ATTEMPTS).toBe(LOGIN_CODE_MAX_ATTEMPTS);
    expect(LOGIN_CODES_PER_WINDOW).toBe(5);
    expect(LOGIN_CODE_WINDOW_SECONDS).toBe(15 * 60);
  });
});

describe("POST /v1/auth/login/complete — 5 tries per code (SI-2)", () => {
  it("counts wrong codes down, spends the code on the 5th, and refuses the right code after that", async () => {
    const repo = createFakeRepository();
    const { challengeId, code, wrongCode } = await issueCode(repo);

    for (const attemptsLeft of [4, 3, 2, 1]) {
      const res = await complete(repo, challengeId, wrongCode, undefined, `req_wrong_${attemptsLeft}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: {
          code: "not_found",
          message: "Challenge not found or code is invalid",
          details: { attemptsLeft },
          requestId: `req_wrong_${attemptsLeft}`,
        },
      });
    }

    const fifth = await complete(repo, challengeId, wrongCode, undefined, "req_wrong_5");
    expect(fifth.status).toBe(422);
    expect(await fifth.json()).toEqual({
      error: {
        code: "precondition_failed",
        message: "Too many wrong codes. Ask for a new code.",
        details: { reason: "too_many_attempts", attemptsLeft: 0 },
        requestId: "req_wrong_5",
      },
    });

    // The 6th try, with the RIGHT code: refused the same way, and no session.
    const sixth = await complete(repo, challengeId, code, undefined, "req_right_6");
    expect(sixth.status).toBe(422);
    expect(await sixth.json()).toEqual({
      error: {
        code: "precondition_failed",
        message: "Too many wrong codes. Ask for a new code.",
        details: { reason: AUTH_ERROR_REASONS.TOO_MANY_ATTEMPTS, attemptsLeft: 0 },
        requestId: "req_right_6",
      },
    });
    expect(repo._sessions.size).toBe(0);
    expect(stored(repo, challengeId).attempts).toBe(5);
    expect(stored(repo, challengeId).consumedAt).toBeNull();
  });

  it("still takes the right code on the 5th try (four wrong ones first), as before", async () => {
    const repo = createFakeRepository();
    const { challengeId, code, wrongCode } = await issueCode(repo);
    for (let i = 0; i < 4; i++) expect((await complete(repo, challengeId, wrongCode)).status).toBe(404);

    const res = await complete(repo, challengeId, code);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { token: string; tokenType: string; user: { email: string } } };
    expect(body.data.tokenType).toBe("bearer");
    expect(body.data.token).toMatch(/^sps_ses_/);
    expect(body.data.user.email).toBe("anu@example.com");
    expect(repo._sessions.size).toBe(1);
    // Used: a further try is refused as used, not counted.
    const again = await complete(repo, challengeId, code, undefined, "req_again");
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({
      error: {
        code: "precondition_failed",
        message: "Challenge has already been used",
        details: { reason: "code_used" },
        requestId: "req_again",
      },
    });
    expect(stored(repo, challengeId).attempts).toBe(4);
  });

  it("counts two wrong codes sent at once twice", async () => {
    const repo = createFakeRepository();
    const { challengeId, wrongCode } = await issueCode(repo);

    const responses = await Promise.all([
      complete(repo, challengeId, wrongCode, undefined, "req_a"),
      complete(repo, challengeId, wrongCode, undefined, "req_b"),
    ]);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as ErrorBody[];
    expect(responses.map((r) => r.status)).toEqual([404, 404]);
    expect(bodies.map((b) => b.error.details["attemptsLeft"]).sort()).toEqual([3, 4]);
    expect(stored(repo, challengeId).attempts).toBe(2);
  });

  it("lets no 6th try through when many arrive at once", async () => {
    const repo = createFakeRepository();
    const { challengeId, code, wrongCode } = await issueCode(repo);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) => complete(repo, challengeId, wrongCode, undefined, `req_${i}`)),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 404)).toHaveLength(4);
    expect(statuses.filter((s) => s === 422)).toHaveLength(6);
    expect(stored(repo, challengeId).attempts).toBe(5);

    const right = await complete(repo, challengeId, code);
    expect(right.status).toBe(422);
    expect(((await right.json()) as ErrorBody).error.details).toEqual({ reason: "too_many_attempts", attemptsLeft: 0 });
    expect(repo._sessions.size).toBe(0);
  });

  it("refuses an expired code with a reason, and does not count the try", async () => {
    const repo = createFakeRepository();
    const { challengeId, code } = await issueCode(repo);

    const res = await complete(repo, challengeId, code, new Date(T0.getTime() + 11 * MINUTE), "req_late");
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: {
        code: "precondition_failed",
        message: "Challenge has expired",
        details: { reason: "code_expired" },
        requestId: "req_late",
      },
    });
    expect(stored(repo, challengeId).attempts).toBe(0);
  });

  it("answers an unknown challenge with a bare not_found (no tries to count)", async () => {
    const repo = createFakeRepository();
    const res = await complete(repo, "chl_00000000000000000000000000000000", "123456", undefined, "req_unknown");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: "not_found",
        message: "Challenge not found or code is invalid",
        details: {},
        requestId: "req_unknown",
      },
    });
  });

  it("records each wrong try as before, and the spent code as too_many_attempts", async () => {
    const repo = createFakeRepository();
    const { challengeId, code, wrongCode } = await issueCode(repo);
    for (let i = 0; i < 5; i++) await complete(repo, challengeId, wrongCode);
    await complete(repo, challengeId, code);

    const failed = repo._securityEvents.filter((e) => e.eventType === "login.complete.failed");
    expect(failed.map((e) => e.outcome)).toEqual([
      "invalid_code_or_challenge",
      "invalid_code_or_challenge",
      "invalid_code_or_challenge",
      "invalid_code_or_challenge",
      "too_many_attempts",
      "too_many_attempts",
    ]);
    expect(failed.slice(0, 4).map((e) => e.metadata)).toEqual([4, 3, 2, 1].map((attemptsLeft) => ({ method: "email_code", attemptsLeft })));
    for (const event of failed) {
      expect(event.challengeId).toBe(parseChallengePublicId(challengeId));
      expect(JSON.stringify(event.metadata)).not.toContain(code);
      expect(JSON.stringify(event.metadata)).not.toContain(wrongCode);
    }
    expect(repo._securityEvents.some((e) => e.eventType === "session.created")).toBe(false);
  });
});

describe("POST /v1/auth/login/start — 5 codes per address per 15 minutes (SI-2)", () => {
  async function start(repo: Repo, email: string, at: Date, opts: { ip?: string; env?: Partial<Env>; requestId?: string; recorder?: ReturnType<typeof makeRecorder> } = {}) {
    const recorder = opts.recorder ?? makeRecorder();
    return handleLoginStart(startRequest(email, opts.ip), makeEnv(opts.env), opts.requestId ?? "req_start", {
      repo,
      enqueueNotification: recorder.fn,
      now: () => at,
    });
  }

  it("takes 5, refuses the 6th with retryAfterSeconds until the oldest leaves the window, then takes one again", async () => {
    const repo = createFakeRepository();
    for (let i = 0; i < 5; i++) {
      expect((await start(repo, "anu@example.com", new Date(T0.getTime() + i * MINUTE))).status).toBe(200);
    }

    const sixth = await start(repo, "anu@example.com", new Date(T0.getTime() + 5 * MINUTE), { requestId: "req_sixth" });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBe("600");
    expect(await sixth.json()).toEqual({
      error: {
        code: "rate_limited",
        message: "Too many codes for this address. Try again later.",
        details: { reason: "too_many_codes", retryAfterSeconds: 600 },
        requestId: "req_sixth",
      },
    });

    // A second before the first code leaves the window: still refused.
    const justBefore = await start(repo, "anu@example.com", new Date(T0.getTime() + 15 * MINUTE - 1000));
    expect(justBefore.status).toBe(429);
    expect(justBefore.headers.get("Retry-After")).toBe("1");
    expect(((await justBefore.json()) as ErrorBody).error.details).toEqual({ reason: "too_many_codes", retryAfterSeconds: 1 });

    // 15 minutes after the first: it has left, so one more fits…
    const after = await start(repo, "anu@example.com", new Date(T0.getTime() + 15 * MINUTE));
    expect(after.status).toBe(200);
    // …and the window is full again until the second (T0 + 1 min) leaves.
    const full = await start(repo, "anu@example.com", new Date(T0.getTime() + 15 * MINUTE));
    expect(full.status).toBe(429);
    expect(((await full.json()) as ErrorBody).error.details).toEqual({ reason: "too_many_codes", retryAfterSeconds: 60 });

    expect(repo._challenges.size).toBe(6);
  });

  it("counts per address, whatever the IP or the letter case, and leaves other addresses alone", async () => {
    const repo = createFakeRepository();
    const emails = ["anu@example.com", "Anu@Example.com", "ANU@EXAMPLE.COM", "anu@example.com", "Anu@example.com"];
    for (const [i, email] of emails.entries()) {
      expect((await start(repo, email, T0, { ip: `198.51.100.${i + 1}` })).status).toBe(200);
    }
    expect((await start(repo, "anu@example.com", T0, { ip: "192.0.2.77" })).status).toBe(429);
    expect((await start(repo, "ravi@example.com", T0)).status).toBe(200);
  });

  it("refuses without making a code, emailing anything or showing one", async () => {
    const repo = createFakeRepository();
    const recorder = makeRecorder();
    for (let i = 0; i < 5; i++) await start(repo, "anu@example.com", T0, { recorder });
    expect(recorder.calls).toHaveLength(5);

    const refused = await start(repo, "anu@example.com", T0, { recorder });
    expect(refused.status).toBe(429);
    expect(recorder.calls).toHaveLength(5);
    expect(repo._challenges.size).toBe(5);
    const body = (await refused.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("data");

    const event = repo._securityEvents.find((e) => e.eventType === "login.start.failed");
    expect(event).toMatchObject({ outcome: "rate_limited", metadata: { method: "email_code", retryAfterSeconds: 900 } });
    expect(event!.userId).toBe([...repo._users.keys()][0]);
  });

  it("holds when the five arrive at once", async () => {
    const repo = createFakeRepository();
    const responses = await Promise.all(Array.from({ length: 8 }, () => start(repo, "anu@example.com", T0)));
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
    expect(repo._challenges.size).toBe(5);
  });
});

describe("DEBUG_DELIVERY_DOMAINS — codes on screen only for test domains (SI-2)", () => {
  async function startWith(domains: string | undefined, email: string) {
    const repo = createFakeRepository();
    const recorder = makeRecorder();
    const env = domains === undefined ? {} : { DEBUG_DELIVERY_DOMAINS: domains };
    const res = await handleLoginStart(startRequest(email), makeEnv(env), "req_domains", {
      repo,
      enqueueNotification: recorder.fn,
      now: () => T0,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: LoginStartResponse };
    return { delivery: body.data.delivery, emailed: recorder.calls };
  }

  it("stage's list (cookpool.test): a cookpool.test address gets its code inline and no email", async () => {
    const { delivery, emailed } = await startWith("cookpool.test", "tester@cookpool.test");
    expect(delivery.mode).toBe("local_debug");
    expect(delivery.code).toMatch(/^\d{6}$/);
    expect(emailed).toHaveLength(0);
  });

  it("stage's list (cookpool.test): a gmail.com address is emailed and gets no code", async () => {
    const { delivery, emailed } = await startWith("cookpool.test", "someone@gmail.com");
    expect(delivery).toEqual({ mode: "email", emailHint: "s***@gmail.com" });
    expect(emailed).toHaveLength(1);
    expect(emailed[0]!.recipient).toEqual({ channel: "email", address: "someone@gmail.com" });
  });

  it("local and dev's `*`: every address gets its code inline", async () => {
    for (const email of ["someone@gmail.com", "tester@cookpool.test"]) {
      const { delivery, emailed } = await startWith("*", email);
      expect(delivery.mode).toBe("local_debug");
      expect(delivery.code).toMatch(/^\d{6}$/);
      expect(emailed).toHaveLength(0);
    }
  });

  it("prod's empty list, or none set: every address is emailed, none gets a code", async () => {
    for (const domains of ["", undefined]) {
      for (const email of ["someone@gmail.com", "tester@cookpool.test"]) {
        const { delivery, emailed } = await startWith(domains, email);
        expect(delivery.mode).toBe("email");
        expect(delivery).not.toHaveProperty("code");
        expect(emailed).toHaveLength(1);
      }
    }
  });

  it("matches whole domains, ignoring case and spaces in the list", () => {
    const list = " CookPool.Test , example.org ";
    expect(parseDebugDeliveryDomains(list)).toEqual({ all: false, domains: ["cookpool.test", "example.org"] });
    expect(parseDebugDeliveryDomains("cookpool.test,*")).toEqual({ all: true, domains: [] });
    expect(parseDebugDeliveryDomains(undefined)).toEqual({ all: false, domains: [] });
    expect(deliversCodeInline(list, "Tester@COOKPOOL.TEST")).toBe(true);
    expect(deliversCodeInline(list, "x@example.org")).toBe(true);
    expect(deliversCodeInline(list, "x@sub.cookpool.test")).toBe(false);
    expect(deliversCodeInline(list, "x@cookpool.test.example.com")).toBe(false);
    expect(deliversCodeInline(list, "cookpool.test@gmail.com")).toBe(false);
    expect(deliversCodeInline("", "x@cookpool.test")).toBe(false);
  });
});

describe("GET /health reports which addresses get codes on screen", () => {
  async function debugDelivery(domains: string | undefined) {
    const env = { ENVIRONMENT: "stage", ...(domains === undefined ? {} : { DEBUG_DELIVERY_DOMAINS: domains }) } as Env;
    const body = (await (await handleHealth(env, "req_health")).json()) as {
      data: { checks: { debugDelivery: unknown } };
    };
    return body.data.checks.debugDelivery;
  }

  it("names the domains, `*` for all, and nothing on prod", async () => {
    expect(await debugDelivery("cookpool.test")).toEqual({ enabled: true, domains: ["cookpool.test"] });
    expect(await debugDelivery("*")).toEqual({ enabled: true, domains: ["*"] });
    expect(await debugDelivery("")).toEqual({ enabled: false, domains: [] });
    expect(await debugDelivery(undefined)).toEqual({ enabled: false, domains: [] });
  });
});
