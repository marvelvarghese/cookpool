import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { Passkey, PasskeyAuthenticationResponseJSON, PasskeyRegistrationResponseJSON } from "@saas/contracts/passkeys";
import type { ApiResult } from "@web-console-next/lib/api";
import {
  PASSKEY_ADD_FAILED_NOTICE,
  PASSKEY_LIMIT_NOTICE,
  PASSKEY_OPTIONS_FRESH_MS,
  PASSKEY_TAP_AGAIN_NOTICE,
  addPasskey,
  ceremonyErrorName,
  createOptionsPrefetch,
  passkeyAlreadyNotice,
  serverFailureDetail,
  signInWithPasskey,
} from "@web-console-next/components/kitchen/passkeys";
import { addNotice } from "@web-console-next/components/kitchen/passkey-ui";

// cookpool-passkeys PK-6, from the first phone test: iPhone Safari opens the
// passkey sheet only from the tap itself, so the options are fetched ahead
// and the tap starts the ceremony with no network call (and no await) before
// it. A failed add never moves on silently: it says so, with the browser's
// error or the server's step under it.

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data, meta: { requestId: "", cursor: null } });
const named = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name, ...extra });
const attestation = { id: "cred", rawId: "cred", type: "public-key" } as unknown as PasskeyRegistrationResponseJSON;
const assertion = { id: "cred", rawId: "cred", type: "public-key" } as unknown as PasskeyAuthenticationResponseJSON;
const passkey: Passkey = { id: "pky_0123456789abcdef", deviceName: "iPhone", createdAt: "2026-11-12T00:00:00Z", lastUsedAt: null, backedUp: true };
const session = { token: "t", tokenType: "Bearer" as const, expiresAt: "x", user: { id: "u", email: "a@b.c", displayName: null } };

/** Everything that happens, in order: network calls and the sheet. */
function world() {
  const log: string[] = [];
  let n = 0;
  const clock = { now: 0 };
  const fetchOptions = async () => {
    log.push("fetch options");
    n += 1;
    return ok({ options: { challenge: `c${n}` } });
  };
  const add = {
    options: createOptionsPrefetch(fetchOptions, () => clock.now),
    register: (o: { challenge: string }) => {
      log.push(`sheet ${o.challenge}`);
      return Promise.resolve(attestation);
    },
    registerVerify: async () => {
      log.push("verify");
      return ok({ passkey });
    },
    deviceName: "iPhone",
  };
  const signIn = {
    options: createOptionsPrefetch(fetchOptions, () => clock.now),
    authenticate: (o: { challenge: string }) => {
      log.push(`sheet ${o.challenge}`);
      return Promise.resolve(assertion);
    },
    loginVerify: async () => {
      log.push("verify");
      return ok(session);
    },
  };
  return { log, clock, add, signIn };
}

describe("the tap opens the sheet before any network call", () => {
  it("Turn on Face ID / Add a passkey: the sheet starts synchronously in the tap", async () => {
    const w = world();
    await w.add.options.refresh(); // the screen showed
    w.log.length = 0;
    const out = addPasskey(w.add as never);
    // Nothing has been awaited yet: the sheet is already open, and nothing was fetched first.
    expect(w.log).toEqual(["sheet c1"]);
    expect(await out).toEqual({ kind: "added", passkey });
    // Then verify, and fresh options for the next attempt.
    expect(w.log).toEqual(["sheet c1", "verify", "fetch options"]);
  });

  it("Sign in with a passkey / the remembered card: the sheet starts synchronously in the tap", async () => {
    const w = world();
    await w.signIn.options.refresh();
    w.log.length = 0;
    const out = signInWithPasskey(w.signIn as never);
    expect(w.log).toEqual(["sheet c1"]);
    expect(await out).toEqual({ kind: "signed_in", session });
  });

  it("with no options at the tap, fetches them and asks for another tap instead of opening the sheet late", async () => {
    const w = world();
    expect(await addPasskey(w.add as never)).toEqual({ kind: "retry" });
    expect(await signInWithPasskey(w.signIn as never)).toEqual({ kind: "retry" });
    expect(w.log).toEqual(["fetch options", "fetch options"]);
    w.log.length = 0;
    const again = addPasskey(w.add as never);
    expect(w.log).toEqual(["sheet c1"]);
    await again;
  });

  it("refetches after a failed or cancelled attempt, and never reuses a challenge", async () => {
    const w = world();
    await w.signIn.options.refresh();
    const cancelled = { ...w.signIn, authenticate: () => Promise.reject(named("NotAllowedError")) };
    expect(await signInWithPasskey(cancelled as never)).toEqual({ kind: "cancelled" });
    w.log.length = 0;
    const next = signInWithPasskey(w.signIn as never);
    expect(w.log).toEqual(["sheet c2"]);
    await next;
  });

  it("the handlers in the screens call the ceremony with no await before it", () => {
    const src = (path: string) => readFileSync(`${cwd()}/../../apps/web-console-next/src/${path}`, "utf8");
    const before = (text: string, start: string, call: string) => {
      const from = text.indexOf(start);
      expect(from).toBeGreaterThan(-1);
      const to = text.indexOf(call, from);
      expect(to).toBeGreaterThan(from);
      return text.slice(from, to);
    };
    for (const [file, start, call] of [
      ["components/kitchen/passkey-ui.tsx", "const turnOn = () => {", "addPasskeyHere("],
      ["components/kitchen/passkey-security-ui.tsx", "const add = () => {", "addPasskeyHere("],
      ["app/login/page.tsx", "const startPasskey = () => {", "signInWithPasskey("],
    ] as const) {
      expect(before(src(file), start, call)).not.toMatch(/\bawait\b|\.then\(|fetch|wrap\(/);
    }
    // The remembered card's Face ID button goes the same way, not after an await.
    expect(before(src("app/login/page.tsx"), "const continueAsRemembered = () => {", "startPasskey()")).not.toMatch(/\bawait\b/);
  });
});

describe("options fetched ahead", () => {
  it("are used for 4 minutes (the challenge lives 5), then fetched again", async () => {
    const w = world();
    expect(PASSKEY_OPTIONS_FRESH_MS).toBe(4 * 60 * 1000);
    await w.add.options.refresh();
    expect(w.add.options.staleAt()).toBe(PASSKEY_OPTIONS_FRESH_MS);
    w.clock.now = PASSKEY_OPTIONS_FRESH_MS - 1;
    await w.add.options.refresh();
    expect(w.log).toEqual(["fetch options"]);
    w.clock.now = PASSKEY_OPTIONS_FRESH_MS;
    expect(w.add.options.take()).toBeNull();
    await w.add.options.refresh();
    expect(w.log).toEqual(["fetch options", "fetch options"]);
    expect(w.add.options.take()).toEqual({ challenge: "c2" });
    expect(w.add.options.take()).toBeNull();
  });

  it("share one fetch while it is under way, and a failure is answered, not held", async () => {
    const w = world();
    const [a, b] = [w.add.options.refresh(), w.add.options.refresh()];
    expect(a).toBe(b);
    await a;
    expect(w.log).toEqual(["fetch options"]);
    const failing = createOptionsPrefetch(async () => ({ ok: false as const, status: 503, error: { code: "unavailable", message: "x" } }));
    expect(await failing.refresh()).toMatchObject({ status: 503 });
    expect(failing.take()).toBeNull();
    const thrown = createOptionsPrefetch(() => Promise.reject(new Error("offline")));
    expect(await thrown.refresh()).toMatchObject({ status: 0, error: { code: "network_error" } });
  });
});

describe("what an add that did not save shows", () => {
  it("a failure: the notice, Try again, and the browser's error name or the server's step under it", () => {
    expect(PASSKEY_ADD_FAILED_NOTICE).toBe("Couldn't save the passkey. Try again, or carry on with Google or an email code.");
    expect(addNotice({ kind: "failed", detail: "NotAllowedError" }, "iphone")).toEqual({
      text: PASSKEY_ADD_FAILED_NOTICE,
      detail: "NotAllowedError",
      tone: "error",
      retry: true,
    });
    expect(ceremonyErrorName(named("WebAuthnError", { cause: named("InvalidStateError") }))).toBe("InvalidStateError");
    expect(ceremonyErrorName(named("NotSupportedError"))).toBe("NotSupportedError");
    expect(ceremonyErrorName(new Error("x"))).toBe("Error");
    expect(ceremonyErrorName("nope")).toBe("Error");
    const step = { status: 422, error: { code: "precondition_failed", reason: "passkey_failed", details: { step: "not_user_verified" } } };
    expect(serverFailureDetail(step)).toBe("not_user_verified · 422");
    expect(serverFailureDetail({ status: 500, error: { code: "internal_error" } })).toBe("internal_error · 500");
    // PK-7: a 5xx says what broke, in the server's own words, before the code.
    expect(serverFailureDetail({ status: 500, error: { code: "internal_error", message: "Failed to store passkey" } })).toBe(
      "Failed to store passkey · internal_error · 500",
    );
    expect(serverFailureDetail({ status: 502, error: { code: "internal_error", message: "HTTP 502" } })).toBe("internal_error · 502");
    expect(serverFailureDetail({ status: 500, error: { code: "internal_error", message: "x".repeat(300) } })).toBe(`${"x".repeat(119)}… · internal_error · 500`);
    // Below 500 the message stays out: the step already names the refusal.
    expect(serverFailureDetail({ ...step, error: { ...step.error, message: "The passkey could not be verified" } })).toBe("not_user_verified · 422");
    expect(serverFailureDetail({ status: 0, error: { code: "network_error", reason: "offline" } })).toBe("offline");
  });

  it("the limit, a device that already has one, options not ready, and a closed sheet", () => {
    expect(PASSKEY_LIMIT_NOTICE).toBe("You have 10 passkeys. Remove one under Sign-in and security first.");
    expect(addNotice({ kind: "limit" }, "iphone")).toMatchObject({ text: PASSKEY_LIMIT_NOTICE, retry: false, detail: null });
    expect(addNotice({ kind: "already" }, "iphone")).toMatchObject({ text: "This phone already has a Cookpool passkey.", retry: false });
    expect(passkeyAlreadyNotice("android")).toBe("This phone already has a Cookpool passkey.");
    expect(passkeyAlreadyNotice("ipad")).toBe("This iPad already has a Cookpool passkey.");
    expect(passkeyAlreadyNotice("mac")).toBe("This device already has a Cookpool passkey.");
    expect(addNotice({ kind: "retry" }, "iphone")).toMatchObject({ text: PASSKEY_TAP_AGAIN_NOTICE, tone: "info", retry: true });
    expect(addNotice({ kind: "cancelled" }, "iphone")).toBeNull();
    expect(addNotice({ kind: "added", passkey }, "iphone")).toBeNull();
  });
});
