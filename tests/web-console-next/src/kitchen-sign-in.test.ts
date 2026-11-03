import { AUTH_ERROR_REASONS, LOGIN_CODE_MAX_ATTEMPTS } from "@saas/contracts/auth";
import type { JoinPreviewPublic } from "@saas/contracts/membership";
import {
  CODE_REPLACED_NOTICE,
  DEFAULT_HEADLINE,
  DESKTOP_TITLE,
  GENERIC_NOTICE,
  INITIAL_SIGN_IN,
  INVALID_CODE_NOTICE,
  INVALID_EMAIL_NOTICE,
  NAME_INVALID_NOTICE,
  NAME_MAX,
  NAME_SAVE_FAILED_NOTICE,
  NETWORK_NOTICE,
  RESEND_COOLDOWN_SECONDS,
  SIGNED_OUT_NOTICE,
  TERMS_SENTENCE,
  afterOAuthPath,
  canSaveName,
  canVerify,
  cleanDisplayName,
  completeOutcome,
  countdownText,
  desktopTitle,
  isCodeComplete,
  isLocalHostname,
  firstRunRedirect,
  joinCard,
  joinCodeFromNext,
  liveInitials,
  looksLikeEmail,
  minutesToWait,
  nameCheck,
  nameExample,
  namePrefill,
  nameStepAction,
  needsName,
  oauthReturnTo,
  offersGoogle,
  rateLimitedMessage,
  replacementRefusedNotice,
  resendControl,
  sanitizeCode,
  saveNameOutcome,
  showsDeveloperSignIn,
  signInEnvironment,
  signInReducer,
  startHeadline,
  startRefusal,
  termsLine,
  testCodeFor,
  tooManyTriesMessage,
  wrongCodeMessage,
  type SignInEnvironment,
  type SignInState,
} from "@web-console-next/components/kitchen/sign-in";

// Cookpool SI-5: the sign-in page's model. The API answers are SI-2's as
// built (404 + attemptsLeft, 422 + reason, 429 + retryAfterSeconds).

describe("the code field", () => {
  it("keeps digits only, at most six", () => {
    expect(sanitizeCode("246810")).toBe("246810");
    expect(sanitizeCode("246 810")).toBe("246810");
    expect(sanitizeCode("246-810")).toBe("246810");
    expect(sanitizeCode("Your code is 246810.")).toBe("246810");
    expect(sanitizeCode("2468101")).toBe("246810");
    expect(sanitizeCode("abc")).toBe("");
  });

  it("is complete at exactly six digits", () => {
    expect(isCodeComplete("246810")).toBe(true);
    expect(isCodeComplete("24681")).toBe(false);
    expect(isCodeComplete("")).toBe(false);
    expect(isCodeComplete("24681a")).toBe(false);
  });

  it("checks an address loosely (the server has the last word)", () => {
    expect(looksLikeEmail("anu@example.com")).toBe(true);
    expect(looksLikeEmail("  anu@cookpool.test ")).toBe(true);
    expect(looksLikeEmail("anu")).toBe(false);
    expect(looksLikeEmail("anu@example")).toBe(false);
    expect(looksLikeEmail("a nu@example.com")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });
});

describe("messages", () => {
  it("counts the tries left, singular at one", () => {
    expect(wrongCodeMessage(4)).toBe("That code didn't match. 4 more tries, then we'll send you a new one.");
    expect(wrongCodeMessage(2)).toBe("That code didn't match. 2 more tries, then we'll send you a new one.");
    expect(wrongCodeMessage(1)).toBe("That code didn't match. 1 more try, then we'll send you a new one.");
  });

  it("turns retryAfterSeconds into whole minutes, rounded up, at least one", () => {
    expect(minutesToWait(900)).toBe(15);
    expect(minutesToWait(754)).toBe(13);
    expect(minutesToWait(61)).toBe(2);
    expect(minutesToWait(60)).toBe(1);
    expect(minutesToWait(1)).toBe(1);
    expect(minutesToWait(0)).toBe(1);
    expect(minutesToWait(Number.NaN)).toBe(1);
    expect(rateLimitedMessage(754)).toBe("Too many codes for this address. Try again in 13 minutes.");
    expect(rateLimitedMessage(30)).toBe("Too many codes for this address. Try again in 1 minute.");
  });

  it("words the edge's per-IP limit in seconds or minutes", () => {
    expect(tooManyTriesMessage(7)).toBe("Too many tries from here. Try again in 7 seconds.");
    expect(tooManyTriesMessage(1)).toBe("Too many tries from here. Try again in 1 second.");
    expect(tooManyTriesMessage(120)).toBe("Too many tries from here. Try again in 2 minutes.");
    expect(tooManyTriesMessage(null)).toBe("Too many tries from here. Wait a moment and try again.");
  });

  it("has the signed-out notice and the Terms line from the design", () => {
    expect(SIGNED_OUT_NOTICE).toBe("You were signed out. Sign in to carry on.");
    expect(CODE_REPLACED_NOTICE).toBe("That code has expired. We've sent a new one.");
    expect(termsLine(true)).toBe(
      "New to Cookpool? The same buttons make your account. By continuing you agree to the Terms and the Privacy notice.",
    );
    // Without Google there is one button: no "the same buttons".
    expect(termsLine(false)).toBe(TERMS_SENTENCE);
  });
});

describe("startRefusal (POST /v1/auth/login/start)", () => {
  it("names the address's 15-minute limit with its minutes", () => {
    const r = startRefusal(
      { code: "rate_limited", details: { reason: AUTH_ERROR_REASONS.TOO_MANY_CODES, retryAfterSeconds: 754 } },
      429,
    );
    expect(r.notice).toEqual({ tone: "error", text: "Too many codes for this address. Try again in 13 minutes." });
    expect(r.retryAfterSeconds).toBe(754);
  });

  it("reads the reason from wrap()'s top-level copy too", () => {
    const r = startRefusal({ code: "rate_limited", reason: "too_many_codes", details: { retryAfterSeconds: 60 } }, 429);
    expect(r.notice.text).toBe("Too many codes for this address. Try again in 1 minute.");
  });

  it("tells the edge's per-IP limit (details.scope, no reason) apart", () => {
    const r = startRefusal({ code: "rate_limited", details: { scope: "identity", retryAfterSeconds: 6 } }, 429);
    expect(r.notice.text).toBe("Too many tries from here. Try again in 6 seconds.");
    expect(r.retryAfterSeconds).toBe(6);
  });

  it("asks for a real address on a validation failure", () => {
    expect(startRefusal({ code: "validation_failed" }, 400).notice.text).toBe(INVALID_EMAIL_NOTICE);
  });

  it("says when the network is down, and something generic otherwise", () => {
    expect(startRefusal({ code: "network_error" }, 0).notice.text).toBe(NETWORK_NOTICE);
    expect(startRefusal({ code: "internal_error" }, 503).notice.text).toBe(GENERIC_NOTICE);
  });
});

describe("completeOutcome (POST /v1/auth/login/complete)", () => {
  it("a wrong code with tries left stays on the code, saying how many", () => {
    const o = completeOutcome({ code: "not_found", details: { attemptsLeft: 4 } }, 404);
    expect(o).toEqual({
      kind: "wrong",
      attemptsLeft: 4,
      notice: { tone: "error", text: "That code didn't match. 4 more tries, then we'll send you a new one." },
    });
    const last = completeOutcome({ code: "not_found", details: { attemptsLeft: 1 } }, 404);
    expect(last.kind === "wrong" && last.notice.text).toBe(
      "That code didn't match. 1 more try, then we'll send you a new one.",
    );
  });

  it("every way a code is finished asks for a new one", () => {
    for (const reason of [
      AUTH_ERROR_REASONS.TOO_MANY_ATTEMPTS,
      AUTH_ERROR_REASONS.CODE_EXPIRED,
      AUTH_ERROR_REASONS.CODE_USED,
    ]) {
      expect(completeOutcome({ code: "precondition_failed", details: { reason } }, 422)).toEqual({ kind: "new_code" });
    }
    // The 5th wrong code is the spent answer, attemptsLeft 0.
    expect(
      completeOutcome({ code: "precondition_failed", details: { reason: "too_many_attempts", attemptsLeft: 0 } }, 422),
    ).toEqual({ kind: "new_code" });
    // An unknown challenge is a bare 404: no code can answer it.
    expect(completeOutcome({ code: "not_found" }, 404)).toEqual({ kind: "new_code" });
    expect(completeOutcome({ code: "not_found", details: { attemptsLeft: 0 } }, 404)).toEqual({ kind: "new_code" });
  });

  it("the attempt limit the copy counts down from is SI-2's", () => {
    expect(LOGIN_CODE_MAX_ATTEMPTS).toBe(5);
    expect(wrongCodeMessage(LOGIN_CODE_MAX_ATTEMPTS - 1)).toContain("4 more tries");
  });

  it("rate limits, bad requests and the network are shown as they are", () => {
    const limited = completeOutcome({ code: "rate_limited", details: { scope: "identity", retryAfterSeconds: 9 } }, 429);
    expect(limited).toEqual({
      kind: "refused",
      notice: { tone: "error", text: "Too many tries from here. Try again in 9 seconds." },
      retryAfterSeconds: 9,
    });
    expect(completeOutcome({ code: "validation_failed" }, 400)).toMatchObject({
      kind: "refused",
      notice: { text: INVALID_CODE_NOTICE },
    });
    expect(completeOutcome({ code: "network_error" }, 0)).toMatchObject({ kind: "refused", notice: { text: NETWORK_NOTICE } });
    expect(completeOutcome({ code: "internal_error" }, 500)).toMatchObject({ kind: "refused", notice: { text: GENERIC_NOTICE } });
  });

  it("when the automatic new code is refused too, says both", () => {
    const refused = startRefusal({ code: "rate_limited", details: { reason: "too_many_codes", retryAfterSeconds: 300 } }, 429);
    expect(replacementRefusedNotice(refused)).toEqual({
      tone: "error",
      text: "That code has expired. Too many codes for this address. Try again in 5 minutes.",
    });
  });
});

describe("the step machine", () => {
  const T0 = 1_800_000_000_000;
  const sent = (state: SignInState = INITIAL_SIGN_IN, extra: Partial<{ resent: boolean; at: number }> = {}) =>
    signInReducer(state, {
      type: "sent",
      email: "anu@example.com",
      challengeId: "lch_1",
      testCode: null,
      at: extra.at ?? T0,
      resent: extra.resent ?? false,
    });

  it("start → code when a code goes out, with the countdown armed", () => {
    const typed = signInReducer(INITIAL_SIGN_IN, { type: "email", value: "anu@example.com" });
    const busy = signInReducer(typed, { type: "busy", busy: "send" });
    expect(busy.busy).toBe("send");
    const s = sent(busy);
    expect(s.step).toBe("code");
    expect(s.email).toBe("anu@example.com");
    expect(s.challengeId).toBe("lch_1");
    expect(s.busy).toBeNull();
    expect(s.resendAt).toBe(T0 + RESEND_COOLDOWN_SECONDS * 1000);
  });

  it("signs in only with a full code that was not just refused", () => {
    let s = sent();
    expect(canVerify(s)).toBe(false);
    s = signInReducer(s, { type: "code", value: "24681" });
    expect(canVerify(s)).toBe(false);
    s = signInReducer(s, { type: "code", value: "246811" });
    expect(canVerify(s)).toBe(true);
    s = signInReducer(s, { type: "busy", busy: "verify" });
    expect(canVerify(s)).toBe(false);
    s = signInReducer(s, { type: "wrong", code: "246811", notice: { tone: "error", text: wrongCodeMessage(4) } });
    expect(s.notice?.text).toBe(wrongCodeMessage(4));
    expect(canVerify(s)).toBe(false); // the same code again would only spend a try
    s = signInReducer(s, { type: "code", value: "246810" });
    expect(s.notice).toBeNull(); // editing clears the message
    expect(canVerify(s)).toBe(true);
  });

  it("a replacement code clears the old one and says why", () => {
    let s = signInReducer(sent(), { type: "code", value: "111111" });
    s = signInReducer(s, {
      type: "sent",
      email: "anu@example.com",
      challengeId: "lch_2",
      testCode: null,
      at: T0 + 5_000,
      resent: true,
      notice: { tone: "info", text: CODE_REPLACED_NOTICE },
    });
    expect(s.challengeId).toBe("lch_2");
    expect(s.code).toBe("");
    expect(s.rejectedCode).toBeNull();
    expect(s.notice).toEqual({ tone: "info", text: CODE_REPLACED_NOTICE });
  });

  it("a refused replacement leaves no code to try, and rests until the limit lifts", () => {
    let s = signInReducer(sent(INITIAL_SIGN_IN, { resent: true }), { type: "code", value: "111111" });
    const refused = startRefusal({ code: "rate_limited", details: { reason: "too_many_codes", retryAfterSeconds: 600 } }, 429);
    s = signInReducer(s, { type: "refused", refused, at: T0 + 1_000, challengeGone: true, notice: replacementRefusedNotice(refused) });
    expect(s.challengeId).toBeNull();
    expect(s.code).toBe("");
    expect(canVerify(signInReducer(s, { type: "code", value: "246810" }))).toBe(false);
    expect(s.resendAt).toBe(T0 + 1_000 + 600_000);
    // No "New code sent": the last send was refused.
    expect(resendControl(s, T0 + 2_000)).toMatchObject({ disabled: true, label: "Send a new code in 9:59" });
  });

  it("'Use a different email' goes back, keeping the address", () => {
    const s = signInReducer(signInReducer(sent(), { type: "code", value: "12" }), { type: "back" });
    expect(s).toEqual({ ...INITIAL_SIGN_IN, email: "anu@example.com" });
  });
});

describe("Send a new code", () => {
  const T0 = 1_800_000_000_000;
  const at = (resent: boolean): SignInState =>
    signInReducer(INITIAL_SIGN_IN, { type: "sent", email: "a@b.co", challengeId: "lch_1", testCode: null, at: T0, resent });

  it("rests 60 seconds after a send, counting down", () => {
    expect(resendControl(at(false), T0)).toEqual({ label: "Send a new code in 1:00", disabled: true, secondsLeft: 60 });
    expect(resendControl(at(false), T0 + 1_000)).toMatchObject({ label: "Send a new code in 0:59", disabled: true });
    expect(resendControl(at(true), T0 + 1_000)).toMatchObject({ label: "New code sent. Send again in 0:59" });
    expect(resendControl(at(true), T0 + 59_500)).toMatchObject({ label: "New code sent. Send again in 0:01" });
    expect(resendControl(at(true), T0 + 60_000)).toEqual({ label: "Send a new code", disabled: false, secondsLeft: 0 });
  });

  it("is off while sending", () => {
    const s = signInReducer(at(false), { type: "busy", busy: "send" });
    expect(resendControl(s, T0 + 120_000)).toMatchObject({ label: "Sending a new code…", disabled: true });
  });

  it("formats m:ss", () => {
    expect(countdownText(59)).toBe("0:59");
    expect(countdownText(60)).toBe("1:00");
    expect(countdownText(754)).toBe("12:34");
    expect(countdownText(-3)).toBe("0:00");
  });
});

describe("environments: developer sign-in and test codes", () => {
  it("reads the deploy environment first", () => {
    expect(signInEnvironment("stage", "localhost")).toBe("stage");
    expect(signInEnvironment("prod", "localhost")).toBe("prod");
    expect(signInEnvironment("dev", "example.com")).toBe("dev");
    expect(signInEnvironment(" Stage ", "x")).toBe("stage");
  });

  it("with none, a local development host is local and the dev workers host is dev", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "cookpool.localhost"]) {
      expect(isLocalHostname(host)).toBe(true);
      expect(signInEnvironment(undefined, host)).toBe("local");
    }
    expect(signInEnvironment(undefined, "cookpool-web-console-next-dev.rahulvarghesepullely.workers.dev")).toBe("dev");
  });

  it("fails closed: an unknown host or value is prod", () => {
    expect(signInEnvironment(undefined, "app.cookpool.example")).toBe("prod");
    expect(signInEnvironment(undefined, "localhost.evil.example")).toBe("prod");
    expect(signInEnvironment("", "cookpool-web-console-next.rahulvarghesepullely.workers.dev")).toBe("prod");
    expect(signInEnvironment("staging-ish", "localhost")).toBe("prod");
  });

  it("shows the Bearer-token form only on local and dev", () => {
    const shown = (["local", "dev", "stage", "prod"] as SignInEnvironment[]).filter(showsDeveloperSignIn);
    expect(shown).toEqual(["local", "dev"]);
  });

  it("shows a returned code locally, on dev and on stage, never on prod", () => {
    const debug = { mode: "local_debug" as const, code: "246810" };
    expect(testCodeFor("local", debug)).toBe("246810");
    expect(testCodeFor("dev", debug)).toBe("246810");
    // Stage shows any code identity-worker returns: every address since SI-9.
    expect(testCodeFor("stage", debug)).toBe("246810");
    // Prod never shows one, even if a server ever sent it.
    expect(testCodeFor("prod", debug)).toBeNull();
  });

  it("shows nothing when the code was emailed", () => {
    expect(testCodeFor("local", { mode: "email" })).toBeNull();
    expect(testCodeFor("stage", { mode: "email", code: "246810" })).toBeNull();
    expect(testCodeFor("local", { mode: "local_debug", code: "" })).toBeNull();
  });
});

describe("next: the join link and Google's returnTo", () => {
  it("finds the join code when next is the join page", () => {
    expect(joinCodeFromNext("/join/KTCH2345")).toBe("KTCH2345");
    expect(joinCodeFromNext("/join/ktch-2345")).toBe("KTCH2345");
    expect(joinCodeFromNext("/join/KTCH2345/")).toBe("KTCH2345");
    expect(joinCodeFromNext("/join/KTCH2345?ref=wa#x")).toBe("KTCH2345");
    expect(joinCodeFromNext("/join/KTCH%2D2345")).toBe("KTCH2345");
  });

  it("refuses anything that is not a same-origin join path", () => {
    expect(joinCodeFromNext(null)).toBeNull();
    expect(joinCodeFromNext("/home")).toBeNull();
    expect(joinCodeFromNext("/groups/join/KTCH2345")).toBeNull();
    expect(joinCodeFromNext("/join/KTCH2345/extra")).toBeNull();
    expect(joinCodeFromNext("/join/NOPE")).toBeNull();
    expect(joinCodeFromNext("/join/%E0%A4%A")).toBeNull();
    expect(joinCodeFromNext("//evil.example/join/KTCH2345")).toBeNull();
    expect(joinCodeFromNext("/\\evil.example/join/KTCH2345")).toBeNull();
    expect(joinCodeFromNext("https://evil.example/join/KTCH2345")).toBeNull();
    expect(joinCodeFromNext("javascript:alert(1)//join/KTCH2345")).toBeNull();
  });

  it("carries only a safe next through Google", () => {
    const origin = "https://cookpool-web-console-next-prod.x.workers.dev";
    expect(oauthReturnTo(origin, "/join/KTCH2345")).toBe(`${origin}/auth/callback?next=%2Fjoin%2FKTCH2345`);
    expect(oauthReturnTo(`${origin}/`, "/pantry?filter=soon")).toBe(`${origin}/auth/callback?next=%2Fpantry%3Ffilter%3Dsoon`);
    expect(oauthReturnTo(origin, null)).toBe(`${origin}/auth/callback`);
    expect(oauthReturnTo(origin, "//evil.example")).toBe(`${origin}/auth/callback`);
    expect(oauthReturnTo(origin, "/\\evil.example")).toBe(`${origin}/auth/callback`);
    expect(oauthReturnTo(origin, "https://evil.example/home")).toBe(`${origin}/auth/callback`);
    expect(oauthReturnTo(origin, "javascript:alert(1)")).toBe(`${origin}/auth/callback`);
  });

  it("offers Google only when the providers list has it", () => {
    expect(offersGoogle([])).toBe(false);
    expect(offersGoogle(null)).toBe(false);
    expect(offersGoogle([{ id: "github" }])).toBe(false);
    expect(offersGoogle([{ id: "github" }, { id: "google" }])).toBe(true);
  });
});

describe("the join card (SI-4's signed-out preview)", () => {
  const flat: JoinPreviewPublic = { groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 5 };

  it("names the group, who invited you and how many are in", () => {
    expect(joinCard(flat)).toEqual({
      groupName: "Flat 4B",
      title: "Sign in to join Flat 4B",
      subtitle: "Anu invited you · 5 people are in",
    });
    expect(joinCard({ ...flat, memberCount: 1 }).subtitle).toBe("Anu invited you · 1 person is in");
  });

  it("leaves out what the preview does not know", () => {
    expect(joinCard({ ...flat, inviterFirstName: null }).subtitle).toBe("5 people are in");
    expect(joinCard({ ...flat, inviterFirstName: "  " }).subtitle).toBe("5 people are in");
    expect(joinCard({ ...flat, inviterFirstName: null, memberCount: 0 }).subtitle).toBeNull();
  });

  it("puts who you are joining in the headline", () => {
    expect(startHeadline(null)).toBe(DEFAULT_HEADLINE);
    expect(DEFAULT_HEADLINE).toBe("Cook together. Pay for what you use.");
    expect(startHeadline(flat)).toBe("Sign in to join Anu and the others");
    expect(startHeadline({ ...flat, memberCount: 2 })).toBe("Sign in to join Anu and one other");
    expect(startHeadline({ ...flat, memberCount: 1 })).toBe("Sign in to join Anu");
    expect(startHeadline({ ...flat, inviterFirstName: null })).toBe("Sign in to join Flat 4B");
  });

  it("titles the desktop form 'Sign in', or the join headline", () => {
    expect(desktopTitle(null)).toBe(DESKTOP_TITLE);
    expect(desktopTitle(flat)).toBe("Sign in to join Anu and the others");
  });
});

// ── Cookpool SI-6: the Name step and the first-run checks ─────────────

describe("the Name step's prefill and initials", () => {
  it("prefills from the part of the email before the @, tidied", () => {
    expect(namePrefill("rahul@gmail.com")).toBe("Rahul");
    expect(namePrefill("rahul.varghese@gmail.com")).toBe("Rahul Varghese");
    expect(namePrefill("anu_k+food@example.com")).toBe("Anu K");
    expect(namePrefill("  Meera@Example.com ")).toBe("Meera");
    expect(namePrefill("dev-patel@example.com")).toBe("Dev-patel");
    expect(namePrefill("rv1987@example.com")).toBe("Rv1987");
  });

  it("prefills nothing when there is nothing to go on", () => {
    expect(namePrefill("")).toBe("");
    expect(namePrefill(null)).toBe("");
    expect(namePrefill("@example.com")).toBe("");
    expect(namePrefill("+tag@example.com")).toBe("");
    expect(namePrefill("...@example.com")).toBe("");
  });

  it("never prefills more than a name can hold", () => {
    expect(namePrefill(`${"a".repeat(200)}@example.com`)).toHaveLength(NAME_MAX);
  });

  it("shows initials live, as the groups' avatars will", () => {
    expect(liveInitials("Rahul Varghese")).toBe("RV");
    expect(liveInitials("Rahul")).toBe("R");
    expect(liveInitials("  anu   k  ")).toBe("AK");
    expect(liveInitials("")).toBe("?");
    expect(liveInitials("   ")).toBe("?");
  });

  it("shows the name the way the app will use it", () => {
    expect(nameExample("Rahul Varghese")).toBe('It shows next to what you buy, use and cook, like "Rahul paid ₹60.00".');
    expect(nameExample("  ")).toBe('It shows next to what you buy, use and cook, like "You paid ₹60.00".');
  });

  it("cleans a name the way it is saved", () => {
    expect(cleanDisplayName("  Rahul   Varghese ")).toBe("Rahul Varghese");
    expect(cleanDisplayName("Rahul\tV")).toBe("Rahul V");
    expect(cleanDisplayName(null)).toBe("");
    expect(cleanDisplayName("x".repeat(NAME_MAX + 5))).toHaveLength(NAME_MAX);
  });

  it("says Join Flat 4B from a join link, else Continue", () => {
    expect(nameStepAction(null)).toBe("Continue");
    expect(nameStepAction({ groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 5 })).toBe("Join Flat 4B");
  });

  it("titles the join card for someone on their way in", () => {
    const flat: JoinPreviewPublic = { groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 5 };
    expect(joinCard(flat, { joining: true })).toEqual({
      groupName: "Flat 4B",
      title: "You're joining Flat 4B",
      subtitle: "Anu invited you · 5 people are in",
    });
    expect(joinCard(flat, { joining: false }).title).toBe("Sign in to join Flat 4B");
  });
});

describe("the Name step in the step machine", () => {
  const T0 = 1_800_000_000_000;
  const onCode = signInReducer(INITIAL_SIGN_IN, {
    type: "sent",
    email: "rahul.varghese@example.com",
    challengeId: "lch_1",
    testCode: "246810",
    at: T0,
    resent: false,
  });

  it("follows a code sign-in with no name, prefilled, and keeps nothing of the code", () => {
    const typed = signInReducer(onCode, { type: "code", value: "246810" });
    const s = signInReducer(typed, { type: "ask_name", email: "rahul.varghese@example.com" });
    expect(s.step).toBe("name");
    expect(s.name).toBe("Rahul Varghese");
    expect(s.email).toBe("rahul.varghese@example.com");
    expect(s.code).toBe("");
    expect(s.challengeId).toBeNull();
    expect(s.testCode).toBeNull();
    expect(s.notice).toBeNull();
    expect(canSaveName(s)).toBe(true);
    expect(canVerify(s)).toBe(false);
  });

  it("takes a given name over the email's", () => {
    const s = signInReducer(INITIAL_SIGN_IN, { type: "ask_name", email: "rv@example.com", name: "  Rahul  V " });
    expect(s.name).toBe("Rahul V");
  });

  it("saves only a name, once at a time", () => {
    let s = signInReducer(INITIAL_SIGN_IN, { type: "ask_name", email: "anu@example.com" });
    s = signInReducer(s, { type: "name", value: "   " });
    expect(canSaveName(s)).toBe(false);
    s = signInReducer(s, { type: "name", value: "Anu K" });
    expect(canSaveName(s)).toBe(true);
    s = signInReducer(s, { type: "busy", busy: "save" });
    expect(canSaveName(s)).toBe(false);
    // Not on another step.
    expect(canSaveName(signInReducer(INITIAL_SIGN_IN, { type: "name", value: "Anu" }))).toBe(false);
  });

  it("keeps the field to the longest name", () => {
    const s = signInReducer(INITIAL_SIGN_IN, { type: "ask_name", email: "anu@example.com" });
    expect(signInReducer(s, { type: "name", value: "y".repeat(NAME_MAX + 20) }).name).toHaveLength(NAME_MAX);
  });

  it("after a failed save, says why and offers to do it later; typing clears the message", () => {
    let s = signInReducer(INITIAL_SIGN_IN, { type: "ask_name", email: "anu@example.com" });
    expect(s.nameSaveFailed).toBe(false);
    s = signInReducer(s, { type: "busy", busy: "save" });
    s = signInReducer(s, { type: "name_refused", notice: { tone: "error", text: NAME_SAVE_FAILED_NOTICE } });
    expect(s.busy).toBeNull();
    expect(s.nameSaveFailed).toBe(true);
    expect(s.notice?.text).toBe(NAME_SAVE_FAILED_NOTICE);
    expect(canSaveName(s)).toBe(true); // try again
    s = signInReducer(s, { type: "name", value: "Anu K" });
    expect(s.notice).toBeNull();
    expect(s.nameSaveFailed).toBe(true);
    // Saving again clears the old message.
    s = signInReducer(signInReducer(s, { type: "name_refused", notice: { tone: "error", text: "x" } }), { type: "busy", busy: "save" });
    expect(s.notice).toBeNull();
  });
});

describe("saving the name: the API's answers", () => {
  it("a 401 means the session ended", () => {
    expect(saveNameOutcome({ code: "unauthenticated" }, 401)).toEqual({ kind: "signed_out" });
  });

  it("says why anything else failed", () => {
    expect(saveNameOutcome({ code: "validation_failed" }, 400)).toEqual({
      kind: "refused",
      notice: { tone: "error", text: NAME_INVALID_NOTICE },
    });
    expect(NAME_INVALID_NOTICE).toBe(`That name can't be used. Keep it under ${NAME_MAX} characters.`);
    expect(saveNameOutcome({ code: "network_error" }, 0)).toEqual({ kind: "refused", notice: { tone: "error", text: NETWORK_NOTICE } });
    expect(saveNameOutcome({ code: "internal_error" }, 500)).toEqual({
      kind: "refused",
      notice: { tone: "error", text: NAME_SAVE_FAILED_NOTICE },
    });
  });
});

describe("first run: who is asked for a name, and never in a loop", () => {
  const nameless = { id: "usr_1", email: "rahul@example.com", displayName: null };
  const named = { ...nameless, displayName: "Rahul Varghese" };

  it("a profile needs a name when it has none, or only spaces", () => {
    expect(needsName(nameless)).toBe(true);
    expect(needsName({ displayName: "   " })).toBe(true);
    expect(needsName({})).toBe(true);
    expect(needsName(named)).toBe(false);
    // No profile (not read yet) is not a reason to ask.
    expect(needsName(null)).toBe(false);
    expect(needsName(undefined)).toBe(false);
  });

  it("Google: the Name step only for a profile read with no name; anything else goes on", () => {
    expect(afterOAuthPath({ ok: true, user: nameless }, "/join/KTCH2345")).toBe("/login?step=name&next=%2Fjoin%2FKTCH2345");
    expect(afterOAuthPath({ ok: true, user: nameless }, null)).toBe("/login?step=name");
    // Google brought a name: straight on.
    expect(afterOAuthPath({ ok: true, user: named }, "/join/KTCH2345")).toBe("/join/KTCH2345");
    // A read that fails never traps anyone on the Name step.
    expect(afterOAuthPath({ ok: false, status: 503 }, "/join/KTCH2345")).toBe("/join/KTCH2345");
    expect(afterOAuthPath({ ok: false, status: 0 }, null)).toBe("/home");
    expect(afterOAuthPath({ ok: true, user: nameless }, "https://evil.example")).toBe("/login?step=name");
  });

  it("?step=name: asks only when the read says there is no name", () => {
    expect(nameCheck({ ok: true, user: nameless })).toEqual({ kind: "ask", userId: "usr_1", email: "rahul@example.com" });
    expect(nameCheck({ ok: true, user: named })).toEqual({ kind: "go" });
    expect(nameCheck({ ok: false, status: 500 })).toEqual({ kind: "go" });
    expect(nameCheck({ ok: false, status: 0 })).toEqual({ kind: "go" });
    expect(nameCheck({ ok: false, status: 401 })).toEqual({ kind: "signed_out" });
  });

  it("the kitchen asks once per person per device, and only after a successful read", () => {
    expect(firstRunRedirect({ ok: true, user: nameless }, null, "/home")).toBe("/login?step=name");
    expect(firstRunRedirect({ ok: true, user: nameless }, "usr_someone_else", "/join/KTCH2345")).toBe(
      "/login?step=name&next=%2Fjoin%2FKTCH2345",
    );
    // Asked already on this device: never again.
    expect(firstRunRedirect({ ok: true, user: nameless }, "usr_1", "/home")).toBeNull();
    // Not read yet, or the read failed: nothing.
    expect(firstRunRedirect(null, null, "/home")).toBeNull();
    expect(firstRunRedirect({ ok: false, status: 503 }, null, "/home")).toBeNull();
    // Named: nothing.
    expect(firstRunRedirect({ ok: true, user: named }, null, "/home")).toBeNull();
  });

  it("cannot loop: kitchen → Name step whose read fails → back → not asked again", () => {
    let asked: string | null = null;
    // 1. The kitchen reads the profile, remembers the ask, and redirects.
    const to = firstRunRedirect({ ok: true, user: nameless }, asked, "/pantry");
    expect(to).toBe("/login?step=name&next=%2Fpantry");
    asked = nameless.id;
    // 2. The Name step cannot read the profile: it goes straight back.
    const check = nameCheck({ ok: false, status: 503 });
    expect(check.kind).toBe("go");
    // 3. Back in the kitchen, the (cached) profile still has no name, but it was asked.
    expect(firstRunRedirect({ ok: true, user: nameless }, asked, "/pantry")).toBeNull();
  });
});
