import type { Passkey, PasskeyAuthenticationResponseJSON, PasskeyRegistrationResponseJSON } from "@saas/contracts/passkeys";
import type { ApiResult } from "@web-console-next/lib/api";
import { DEFAULT_APP_CONFIG } from "@web-console-next/lib/app-config";
import {
  OFFER_SNOOZE_MS,
  PASSKEY_BUTTON,
  PASSKEY_FAILED_NOTICE,
  PASSKEY_REFUSED_NOTICE,
  PASSKEY_UNREACHABLE_NOTICE,
  REMOVE_HOLD_MS,
  addPasskey,
  canAddPasskey,
  createOptionsPrefetch,
  holdRemoval,
  isCeremonyCancel,
  lastUsedText,
  offerCopy,
  offerDue,
  offerSnoozed,
  otherWaysIn,
  passkeyDevice,
  passkeyDeviceName,
  passkeyHere,
  passkeyMeta,
  passkeyRpId,
  passkeySignInLabel,
  passkeysRunHere,
  signInWithPasskey,
  type PasskeyDevice,
} from "@web-console-next/components/kitchen/passkeys";
import { continueMethod, parseRememberedAccount, rememberedCard } from "@web-console-next/components/kitchen/sign-in-screens";
import { addNotice } from "@web-console-next/components/kitchen/passkey-ui";

// cookpool-passkeys PK-4: where passkeys run, the words that follow the
// device, Turn on Face ID's conditions, Sign-in and security's rows, Remove
// with Undo, and the two ceremonies with the SDK and the browser mocked.

const stage = { deployEnv: "stage", customDomains: DEFAULT_APP_CONFIG.customDomains };
const prod = { deployEnv: "prod", customDomains: DEFAULT_APP_CONFIG.customDomains };
const dev: { deployEnv: string | undefined; customDomains: string } = { deployEnv: undefined, customDomains: DEFAULT_APP_CONFIG.customDomains };

const UA: Record<string, string> = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
};

describe("where passkeys run", () => {
  it("takes the RP ID from the deploy config: the environment's custom domain, localhost in dev", () => {
    expect(passkeyRpId(stage)).toBe("stage.cookpool.store");
    expect(passkeyRpId(prod)).toBe("cookpool.store");
    expect(passkeyRpId(dev)).toBe("localhost");
    expect(passkeyRpId({ deployEnv: "stage", customDomains: "prod=cookpool.store" })).toBeNull();
  });

  it("runs only with WebAuthn on the RP ID's own host", () => {
    const at = (hostname: string, config: { deployEnv: string | undefined; customDomains: string } = stage, hasWebAuthn = true) => passkeysRunHere({ hostname, hasWebAuthn, config });
    expect(at("stage.cookpool.store")).toBe(true);
    expect(at("STAGE.cookpool.store")).toBe(true);
    expect(at("cookpool.store", prod)).toBe(true);
    expect(at("localhost", dev)).toBe(true);
    // The workers.dev hosts, a local proxy, another environment, no WebAuthn: hidden.
    expect(at("cookpool-web-console-next-stage.cookpool.workers.dev")).toBe(false);
    expect(at("cookpool-web-console-next-prod.cookpool.workers.dev", prod)).toBe(false);
    expect(at("cookpool-stage.localhost")).toBe(false);
    expect(at("cookpool.store")).toBe(false);
    expect(at("stage.cookpool.store", prod)).toBe(false);
    expect(at("evil-stage.cookpool.store")).toBe(false);
    expect(at("stage.cookpool.store", stage, false)).toBe(false);
    expect(at("", dev)).toBe(false);
    expect(passkeysRunHere({ hostname: "x", hasWebAuthn: true, config: { deployEnv: "stage", customDomains: "" } })).toBe(false);
  });
});

describe("the device and its words", () => {
  it("reads the device from the user agent, an iPad that says Mac by its touch points", () => {
    expect(passkeyDevice(UA.iphone!)).toBe("iphone");
    expect(passkeyDevice(UA.ipad!)).toBe("ipad");
    expect(passkeyDevice(UA.mac!, 5)).toBe("ipad");
    expect(passkeyDevice(UA.mac!, 0)).toBe("mac");
    expect(passkeyDevice(UA.android!)).toBe("android");
    expect(passkeyDevice(UA.windows!)).toBe("windows");
    expect(passkeyDevice(UA.linux!)).toBe("other");
    expect(passkeyDevice("")).toBe("other");
  });

  it("names a new passkey after the device, or leaves it to the server", () => {
    const names = (["iphone", "ipad", "android", "mac", "windows", "other"] as PasskeyDevice[]).map(passkeyDeviceName);
    expect(names).toEqual(["iPhone", "iPad", "Android phone", "Mac", "Windows PC", undefined]);
  });

  it("words the button by device: Face ID, the fingerprint, else a passkey", () => {
    expect(passkeySignInLabel("iphone")).toBe("Sign in with Face ID");
    expect(passkeySignInLabel("ipad")).toBe("Sign in with Face ID");
    expect(passkeySignInLabel("android")).toBe("Sign in with your fingerprint");
    for (const d of ["mac", "windows", "other"] as PasskeyDevice[]) expect(passkeySignInLabel(d)).toBe(PASSKEY_BUTTON);
    expect(PASSKEY_BUTTON).toBe("Sign in with a passkey");
  });

  it("remembers a passkey account and signs it in with the device's own button where passkeys run", () => {
    const account = parseRememberedAccount(JSON.stringify({ name: "Rahul Varghese", email: "rahul@gmail.com", method: "passkey" }))!;
    expect(account.method).toBe("passkey");
    const here = { label: passkeySignInLabel("iphone"), here: passkeyHere("iphone") };
    expect(rememberedCard(account, here)).toEqual({
      initials: "RV",
      title: "Welcome back, Rahul",
      subtitle: "rahul@gmail.com · passkey on this phone",
      action: "Sign in with Face ID",
    });
    expect(rememberedCard(account, { label: passkeySignInLabel("android"), here: passkeyHere("android") }).action).toBe(
      "Sign in with your fingerprint",
    );
    expect(rememberedCard(account, { label: passkeySignInLabel("mac"), here: passkeyHere("mac") }).subtitle).toBe(
      "rahul@gmail.com · passkey on this device",
    );
    expect(continueMethod(account, true, true)).toBe("passkey");
    // Where passkeys do not run it falls back to a code, as it says.
    expect(rememberedCard(account, null).action).toBe("Continue as Rahul");
    expect(continueMethod(account, true, false)).toBe("code");
    expect(continueMethod({ ...account, method: "google" }, true, true)).toBe("google");
  });
});

describe("Turn on Face ID", () => {
  const now = Date.UTC(2026, 10, 12, 12);
  const yes = { afterSignIn: true, runsHere: true, platformAuthenticator: true, deviceHasPasskey: false, dismissedAt: null, now };

  it("shows after a sign-in only when every condition holds", () => {
    expect(offerDue(yes)).toBe(true);
    expect(offerDue({ ...yes, afterSignIn: false })).toBe(false);
    expect(offerDue({ ...yes, runsHere: false })).toBe(false);
    expect(offerDue({ ...yes, platformAuthenticator: false })).toBe(false);
    expect(offerDue({ ...yes, deviceHasPasskey: true })).toBe(false);
  });

  it("waits 30 days after Not now", () => {
    expect(OFFER_SNOOZE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(offerDue({ ...yes, dismissedAt: now - 29 * 86_400_000 })).toBe(false);
    expect(offerDue({ ...yes, dismissedAt: now - OFFER_SNOOZE_MS + 1 })).toBe(false);
    expect(offerDue({ ...yes, dismissedAt: now - OFFER_SNOOZE_MS })).toBe(true);
    expect(offerSnoozed(null, now)).toBe(false);
    expect(offerSnoozed(Number.NaN, now)).toBe(false);
  });

  it("follows the device in its words", () => {
    const iphone = offerCopy("iphone", "Rahul");
    expect(iphone).toMatchObject({ eyebrow: "You're in, Rahul", title: "Next time, just use Face ID", action: "Turn on Face ID", doneTitle: "Face ID is on" });
    expect(iphone.doneBody).toContain('"iPhone"');
    expect(iphone.points[1]).toContain("iCloud Keychain");
    const android = offerCopy("android", null);
    expect(android).toMatchObject({ eyebrow: "You're in", title: "Next time, just use your fingerprint" });
    expect(android.points[1]).toContain("Google account");
    expect(offerCopy("mac", "Anu").title).toBe("Next time, just use your screen lock");
    expect(offerCopy("other", "Anu").doneBody).not.toContain('""');
  });
});

describe("Sign-in and security", () => {
  const now = new Date(2026, 10, 12, 15, 0).getTime();
  const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

  it("says when each passkey was last used, in the person's own days", () => {
    expect(lastUsedText(at(2026, 10, 12, 0), now)).toBe("used today");
    expect(lastUsedText(at(2026, 10, 11, 23), now)).toBe("used yesterday");
    expect(lastUsedText(at(2026, 10, 9), now)).toBe("used 3 days ago");
    expect(lastUsedText(at(2026, 7, 1), now)).toBe("used 3 months ago");
    expect(lastUsedText(null, now)).toBe("never used");
    expect(lastUsedText("not a date", now)).toBe("never used");
  });

  it("says whether it syncs", () => {
    expect(passkeyMeta({ backedUp: true, lastUsedAt: at(2026, 10, 12) }, now)).toBe("Synced · used today");
    expect(passkeyMeta({ backedUp: false, lastUsedAt: null }, now)).toBe("One device · never used");
  });

  it("adds up to the limit of 10", () => {
    expect(canAddPasskey(9)).toBe(true);
    expect(canAddPasskey(10)).toBe(false);
  });

  it("lists Google when it is offered, Linked only when known, and the email code always", () => {
    expect(otherWaysIn({ email: "rahul@gmail.com", googleOffered: true, googleLinked: true })).toEqual([
      { way: "google", title: "Google", subtitle: "rahul@gmail.com", badge: "Linked" },
      { way: "code", title: "Email code", subtitle: "rahul@gmail.com · always on, so you can't lock yourself out", badge: null },
    ]);
    expect(otherWaysIn({ email: "a@b.co", googleOffered: true, googleLinked: false })[0]!.badge).toBeNull();
    expect(otherWaysIn({ email: "a@b.co", googleOffered: false, googleLinked: true }).map((r) => r.way)).toEqual(["code"]);
  });
});

describe("Remove, with Undo", () => {
  /** A clock the test moves by hand. */
  function fakeTimers() {
    let now = 0;
    let next = 1;
    const due = new Map<number, { at: number; fn: () => void }>();
    return {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        due.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (h: unknown) => void due.delete(h as number),
      advance(ms: number) {
        now += ms;
        for (const [id, t] of [...due]) {
          if (t.at <= now) {
            due.delete(id);
            t.fn();
          }
        }
      },
    };
  }
  const counter = () => {
    const c = { calls: 0, send: () => void (c.calls += 1) };
    return c;
  };

  it("sends the DELETE after 5 s, once", () => {
    const timers = fakeTimers();
    const c = counter();
    holdRemoval(c.send, timers);
    expect(REMOVE_HOLD_MS).toBe(5000);
    timers.advance(4999);
    expect(c.calls).toBe(0);
    timers.advance(1);
    expect(c.calls).toBe(1);
    timers.advance(10_000);
    expect(c.calls).toBe(1);
  });

  it("never sends it when Undo comes first, and Undo after the send says so", () => {
    const timers = fakeTimers();
    const c = counter();
    const held = holdRemoval(c.send, timers);
    timers.advance(3000);
    expect(held.undo()).toBe(true);
    timers.advance(10_000);
    expect(c.calls).toBe(0);

    const late = holdRemoval(c.send, timers);
    timers.advance(5000);
    expect(late.undo()).toBe(false);
    expect(c.calls).toBe(1);
  });

  it("sends it at once when the page closes, and not again", () => {
    const timers = fakeTimers();
    const c = counter();
    const held = holdRemoval(c.send, timers);
    held.flush();
    held.flush();
    timers.advance(10_000);
    expect(c.calls).toBe(1);
    expect(held.undo()).toBe(false);
  });
});

// ── The ceremonies, with the SDK and the browser mocked ───────────

const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data, meta: { requestId: "", cursor: null } });
const err = <T>(status: number, code: string, reason?: string): ApiResult<T> => ({
  ok: false,
  status,
  error: { code, message: code, ...(reason ? { reason } : {}) },
});
/** A stand-in that records its calls and answers from a queue, then its default. */
function fn<A extends unknown[], R>(answer: (...args: A) => Promise<R>) {
  const queue: Array<() => Promise<R>> = [];
  const f = Object.assign(
    (...args: A): Promise<R> => {
      f.calls.push(args);
      const once = queue.shift();
      return once ? once() : answer(...args);
    },
    {
      calls: [] as A[],
      resolveOnce: (value: R) => void queue.push(async () => value),
      rejectOnce: (error: unknown) => void queue.push(async () => Promise.reject(error)),
    },
  );
  return f;
}

const named = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name, ...extra });

const assertion = { id: "cred", rawId: "cred", type: "public-key" } as unknown as PasskeyAuthenticationResponseJSON;
const attestation = { id: "cred", rawId: "cred", type: "public-key" } as unknown as PasskeyRegistrationResponseJSON;
const session = {
  token: "tok_1",
  tokenType: "Bearer" as const,
  expiresAt: "2026-12-12T00:00:00Z",
  user: { id: "usr_1", email: "rahul@gmail.com", displayName: "Rahul" },
};
const passkey: Passkey = { id: "pky_0123456789abcdef", deviceName: "iPhone", createdAt: "2026-11-12T00:00:00Z", lastUsedAt: null, backedUp: true };

/** A prefetch over a fake options call, already filled (the screen showed). */
async function ready<T>(fetchOptions: () => Promise<ApiResult<{ options: T }>>) {
  const p = createOptionsPrefetch(fetchOptions);
  await p.refresh();
  return p;
}

describe("signing in with a passkey", () => {
  const deps = async () => {
    const loginOptions = fn(async () => ok({ options: { challenge: "c1", rpId: "stage.cookpool.store" } }));
    return {
      loginOptions,
      options: await ready(loginOptions),
      authenticate: fn(async () => assertion),
      loginVerify: fn(async () => ok(session) as ApiResult<typeof session>),
    };
  };

  it("opens the sheet with the options fetched ahead, and verifies what it returns", async () => {
    const d = await deps();
    const out = await signInWithPasskey(d as never);
    expect(out).toEqual({ kind: "signed_in", session });
    expect(d.authenticate.calls).toEqual([[{ challenge: "c1", rpId: "stage.cookpool.store" }]]);
    expect(d.loginVerify.calls).toEqual([[assertion]]);
    // Signed in: the page leaves, so no new challenge is fetched.
    expect(d.loginOptions.calls).toHaveLength(1);
  });

  it("leaves the screen as it was when the sheet is closed", async () => {
    for (const cancel of [
      named("NotAllowedError"),
      named("AbortError"),
      named("WebAuthnError", { code: "ERROR_CEREMONY_ABORTED" }),
      named("NotAllowedError", { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", cause: named("NotAllowedError") }),
    ]) {
      const d = await deps();
      d.authenticate.rejectOnce(cancel);
      expect(await signInWithPasskey(d as never)).toEqual({ kind: "cancelled" });
      expect(d.loginVerify.calls).toHaveLength(0);
    }
    expect(isCeremonyCancel(named("SecurityError"))).toBe(false);
  });

  it("says the passkey didn't work when the server refuses it, nothing about why, and how to add it again", async () => {
    const d = await deps();
    d.loginVerify.resolveOnce(err(401, "unauthenticated", "passkey_failed"));
    expect(await signInWithPasskey(d as never)).toEqual({ kind: "failed", notice: PASSKEY_REFUSED_NOTICE });
    expect(PASSKEY_REFUSED_NOTICE).toBe(
      "That passkey didn't work. Try again, or use Google or an email code. If you turned on Face ID before today, open Sign-in and security after signing in and add it again.",
    );
    const broken = await deps();
    broken.authenticate.rejectOnce(named("SecurityError"));
    expect(await signInWithPasskey(broken as never)).toEqual({ kind: "failed", notice: PASSKEY_FAILED_NOTICE });
    expect(PASSKEY_FAILED_NOTICE).toBe("That passkey didn't work. Try again, or use Google or an email code.");
  });

  it("says it couldn't reach us when the options or the network fail", async () => {
    const d = await deps();
    d.loginOptions.resolveOnce(err(0, "network_error") as never);
    const empty = createOptionsPrefetch(d.loginOptions);
    expect(await signInWithPasskey({ ...d, options: empty } as never)).toEqual({ kind: "failed", notice: PASSKEY_UNREACHABLE_NOTICE });
    expect(d.authenticate.calls).toHaveLength(0);
    const limited = await deps();
    limited.loginVerify.resolveOnce(err(429, "rate_limited"));
    expect(await signInWithPasskey(limited as never)).toEqual({ kind: "failed", notice: PASSKEY_UNREACHABLE_NOTICE });
  });
});

describe("adding a passkey on this device", () => {
  const deps = async () => {
    const registerOptions = fn(async () => ok({ options: { challenge: "c2" } }));
    return {
      registerOptions,
      options: await ready(registerOptions),
      register: fn(async () => attestation),
      registerVerify: fn(async () => ok({ passkey }) as ApiResult<{ passkey: Passkey }>),
      deviceName: "iPhone" as string | undefined,
    };
  };

  it("registers and verifies with the device's name", async () => {
    const d = await deps();
    expect(await addPasskey(d as never)).toEqual({ kind: "added", passkey });
    expect(d.register.calls).toEqual([[{ challenge: "c2" }]]);
    expect(d.registerVerify.calls).toEqual([[{ response: attestation, deviceName: "iPhone" }]]);
    const unnamed = { ...(await deps()), deviceName: undefined };
    await addPasskey(unnamed as never);
    expect(unnamed.registerVerify.calls).toEqual([[{ response: attestation }]]);
  });

  it("stops at the limit of 10, at options or at verify", async () => {
    const d = await deps();
    d.registerOptions.resolveOnce(err(409, "conflict", "too_many_passkeys") as never);
    expect(await addPasskey({ ...d, options: createOptionsPrefetch(d.registerOptions) } as never)).toEqual({ kind: "limit" });
    expect(d.register.calls).toHaveLength(0);
    const late = await deps();
    late.registerVerify.resolveOnce(err(409, "conflict", "too_many_passkeys"));
    expect(await addPasskey(late as never)).toEqual({ kind: "limit" });
  });

  it("tells a closed sheet, a device that already has one, and a failure apart, naming the failure", async () => {
    const cancel = await deps();
    cancel.register.rejectOnce(named("NotAllowedError"));
    expect(await addPasskey(cancel as never)).toEqual({ kind: "cancelled" });
    expect(cancel.registerVerify.calls).toHaveLength(0);
    const already = await deps();
    already.register.rejectOnce(named("InvalidStateError", { code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" }));
    expect(await addPasskey(already as never)).toEqual({ kind: "already" });
    const failed = await deps();
    failed.registerVerify.resolveOnce({
      ok: false,
      status: 422,
      error: { code: "precondition_failed", message: "x", reason: "passkey_failed", details: { reason: "passkey_failed", step: "not_verified" } },
    });
    expect(await addPasskey(failed as never)).toEqual({ kind: "failed", detail: "not_verified · 422" });
    // PK-7: stage's 500 now says which step broke, and the error line shows it.
    const stored = await deps();
    stored.registerVerify.resolveOnce({ ok: false, status: 500, error: { code: "internal_error", message: "Failed to store passkey" } });
    const outcome = await addPasskey(stored as never);
    expect(outcome).toEqual({ kind: "failed", detail: "Failed to store passkey · internal_error · 500" });
    expect(addNotice(outcome, "iphone")).toMatchObject({ detail: "Failed to store passkey · internal_error · 500", tone: "error", retry: true });
    const browser = await deps();
    browser.register.rejectOnce(named("WebAuthnError", { code: "ERROR_INVALID_DOMAIN", cause: named("SecurityError") }));
    expect(await addPasskey(browser as never)).toEqual({ kind: "failed", detail: "SecurityError" });
  });
});
