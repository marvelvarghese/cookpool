import type { JoinPreviewPublic } from "@saas/contracts/membership";
import {
  DEFAULT_HEADLINE,
  INITIAL_SIGN_IN,
  RESEND_COOLDOWN_SECONDS,
  signInReducer,
  type SignInState,
} from "@web-console-next/components/kitchen/sign-in";
import {
  HELP_PATH,
  RESENT_NOTICE,
  WELCOME_BACK_HEADLINE,
  canStartSignUp,
  codeBoxes,
  codeStepLabel,
  continueMethod,
  formTitle,
  gmailInboxUrl,
  googleLabel,
  helpItems,
  helpPathFor,
  heroTitle,
  parseRememberedAccount,
  rememberedCard,
  rememberedFrom,
  resendButton,
  signUpNameHint,
  signUpNameToSave,
  writeToUsHref,
} from "@web-console-next/components/kitchen/sign-in-screens";
import { STATIC_PAGES, redirectRules, staticPageFor } from "@web-console-next/lib/static-pages.mjs";

// cookpool-passkeys PK-3: the getting-in screens — Sign in · Create account,
// the remembered account, the code's six boxes, and Can't sign in?.

const flat4b: JoinPreviewPublic = { groupName: "Flat 4B", inviterFirstName: "Anu", memberCount: 4 };

describe("Sign in · Create account", () => {
  it("switches tabs on the start only, keeping what was typed", () => {
    let s = signInReducer(INITIAL_SIGN_IN, { type: "email", value: "rahul@gmail.com" });
    s = signInReducer(s, { type: "tab", mode: "new" });
    expect(s).toMatchObject({ mode: "new", email: "rahul@gmail.com", step: "start" });
    const onCode: SignInState = { ...s, step: "code" };
    expect(signInReducer(onCode, { type: "tab", mode: "in" })).toBe(onCode);
    expect(signInReducer(s, { type: "tab", mode: "new" })).toBe(s);
  });

  it("clears a notice when the tab changes or the name is typed", () => {
    const withNotice: SignInState = { ...INITIAL_SIGN_IN, notice: { tone: "error", text: "x" } };
    expect(signInReducer(withNotice, { type: "tab", mode: "new" }).notice).toBeNull();
    expect(signInReducer({ ...withNotice, mode: "new" }, { type: "sign_up_name", value: "Rahul" })).toMatchObject({
      signUpName: "Rahul",
      notice: null,
    });
  });

  it("goes back from the code to the same tab, with the name and the address", () => {
    let s: SignInState = { ...INITIAL_SIGN_IN, mode: "new", signUpName: "Rahul V", email: "rv@example.com" };
    s = signInReducer(s, { type: "sent", email: "rv@example.com", challengeId: "c1", testCode: null, at: 0, resent: false });
    expect(s.step).toBe("code");
    expect(signInReducer(s, { type: "back" })).toEqual({ ...INITIAL_SIGN_IN, mode: "new", signUpName: "Rahul V", email: "rv@example.com" });
  });

  it("names the tabs' buttons and titles as drawn", () => {
    expect(googleLabel("in")).toBe("Continue with Google");
    expect(googleLabel("new")).toBe("Sign up with Google");
    expect(formTitle("in")).toBe("Sign in");
    expect(formTitle("new")).toBe("Make your account");
    expect(codeStepLabel("in")).toBe("Sign in");
    expect(codeStepLabel("new")).toBe("Step 2 of 2");
  });

  it("welcomes back only someone remembered here; a join link names the group", () => {
    expect(heroTitle("in", true, null)).toBe(WELCOME_BACK_HEADLINE);
    expect(heroTitle("in", false, null)).toBe(DEFAULT_HEADLINE);
    expect(heroTitle("new", true, null)).toBe(DEFAULT_HEADLINE);
    expect(heroTitle("in", true, flat4b)).toBe("Sign in to join Anu and the others");
  });
});

describe("Create account", () => {
  const ready = { signUpName: "Rahul", email: "rahul@gmail.com", busy: null } as const;

  it("asks for a name and an address before sending a code", () => {
    expect(canStartSignUp(ready)).toBe(true);
    expect(canStartSignUp({ ...ready, signUpName: "   " })).toBe(false);
    expect(canStartSignUp({ ...ready, email: "rahul@" })).toBe(false);
    expect(canStartSignUp({ ...ready, busy: "send" })).toBe(false);
  });

  it("shows the name as the groups will see it", () => {
    expect(signUpNameHint("Rahul Varghese")).toBe('Your groups see it, like "Rahul paid ₹60".');
    expect(signUpNameHint("")).toBe('Your groups see it, like "You paid ₹60".');
  });

  it("saves the name after the code only when the account has none", () => {
    const state = { mode: "new", signUpName: "  Rahul   Varghese " } as const;
    expect(signUpNameToSave(state, { displayName: null })).toBe("Rahul Varghese");
    expect(signUpNameToSave(state, { displayName: "  " })).toBe("Rahul Varghese");
    // An address that already has an account (and a name) just signs in.
    expect(signUpNameToSave(state, { displayName: "Rahul V" })).toBeNull();
    expect(signUpNameToSave({ mode: "in", signUpName: "Rahul" }, { displayName: null })).toBeNull();
    expect(signUpNameToSave({ mode: "new", signUpName: " " }, { displayName: null })).toBeNull();
    expect(signUpNameToSave(state, null)).toBeNull();
  });
});

describe("the account remembered on this device", () => {
  it("reads back only a well-formed record", () => {
    const ok = JSON.stringify({ name: " Rahul  Varghese ", email: "rahul@gmail.com", method: "google" });
    expect(parseRememberedAccount(ok)).toEqual({ name: "Rahul Varghese", email: "rahul@gmail.com", method: "google" });
    expect(parseRememberedAccount(JSON.stringify({ email: "a@b.co", method: "code" }))).toEqual({ name: "", email: "a@b.co", method: "code" });
    for (const bad of [null, "", "{", "[]", "null", JSON.stringify({ email: "nope", method: "code" }), JSON.stringify({ email: "a@b.co", method: "password" })]) {
      expect(parseRememberedAccount(bad)).toBeNull();
    }
  });

  it("is made from the signed-in profile: name, email and method, nothing more", () => {
    expect(rememberedFrom({ email: "anu@example.com", displayName: "Anu", id: "usr_1" } as never, "code")).toEqual({
      name: "Anu",
      email: "anu@example.com",
      method: "code",
    });
    expect(rememberedFrom({ email: "", displayName: "Anu" }, "code")).toBeNull();
  });

  it("draws the card and its one button", () => {
    expect(rememberedCard({ name: "Rahul Varghese", email: "rahul@gmail.com", method: "google" })).toEqual({
      initials: "RV",
      title: "Welcome back, Rahul",
      subtitle: "rahul@gmail.com · Google",
      action: "Continue as Rahul",
    });
    expect(rememberedCard({ name: "", email: "anu@example.com", method: "code" })).toEqual({
      initials: "A",
      title: "Welcome back",
      subtitle: "anu@example.com · email code",
      action: "Continue",
    });
  });

  it("continues by the method used last, falling back to a code when Google is not offered", () => {
    const google = { name: "R", email: "r@gmail.com", method: "google" } as const;
    expect(continueMethod(google, true)).toBe("google");
    expect(continueMethod(google, false)).toBe("code");
    expect(continueMethod({ ...google, method: "code" }, true)).toBe("code");
  });
});

describe("the code screen", () => {
  it("fills six boxes from the one field, marking the next while it has focus", () => {
    expect(codeBoxes("48", { wrong: false, focused: true }).map((b) => b.state)).toEqual([
      "filled",
      "filled",
      "active",
      "empty",
      "empty",
      "empty",
    ]);
    expect(codeBoxes("48", { wrong: false, focused: false }).map((b) => b.state)[2]).toBe("empty");
    expect(codeBoxes("481920", { wrong: false, focused: true }).map((b) => b.digit).join("")).toBe("481920");
    expect(codeBoxes("481920", { wrong: false, focused: true }).every((b) => b.state === "filled")).toBe(true);
    expect(codeBoxes("481920", { wrong: true, focused: true }).every((b) => b.state === "wrong")).toBe(true);
  });

  it("offers Open Gmail only for Gmail addresses", () => {
    expect(gmailInboxUrl("rahul@gmail.com")).toBe("https://mail.google.com/mail/u/0/#inbox");
    expect(gmailInboxUrl(" Rahul@GoogleMail.com ")).toBe("https://mail.google.com/mail/u/0/#inbox");
    expect(gmailInboxUrl("rahul@example.com")).toBeNull();
    expect(gmailInboxUrl("rahul@gmail.com.evil.example")).toBeNull();
    expect(gmailInboxUrl("")).toBeNull();
  });

  it("counts the resend down in the button's short words", () => {
    const T0 = 1_000_000;
    const sent = signInReducer(INITIAL_SIGN_IN, {
      type: "sent",
      email: "r@gmail.com",
      challengeId: "c1",
      testCode: null,
      at: T0,
      resent: true,
      notice: { tone: "success", text: RESENT_NOTICE },
    });
    expect(sent.notice).toEqual({ tone: "success", text: "New code sent. The old one no longer works." });
    expect(resendButton(sent, T0 + 1_000)).toEqual({ label: "Again in 0:59", disabled: true });
    expect(resendButton(sent, T0 + RESEND_COOLDOWN_SECONDS * 1000)).toEqual({ label: "Send a new code", disabled: false });
    expect(resendButton({ ...sent, busy: "send" }, T0 + 120_000)).toEqual({ label: "Sending…", disabled: true });
  });
});

describe("Can't sign in?", () => {
  it("has the four problems, each with a way forward", () => {
    const items = helpItems({ typedEmail: null, googleOffered: true, supportEmail: "help@example.com" });
    expect(items.map((i) => i.question)).toEqual([
      "The code didn't arrive",
      "I can't open that email any more",
      "I'm not sure which email I used",
      "It says too many tries",
    ]);
    expect(items.map((i) => [i.cta, i.action])).toEqual([
      ["Send a new code", "sign_in"],
      ["Write to us", "write"],
      ["Continue with Google", "google"],
      ["Back to sign in", "sign_in"],
    ]);
    expect(items[3]?.tips[0]).toBe(
      "After 5 codes in 15 minutes we pause new codes to that address for up to 15 minutes. It keeps your account safe.",
    );
  });

  it("names only the address this tab typed, and never whether it has an account", () => {
    expect(helpItems({ typedEmail: "rahul@gmail.com", googleOffered: true })[0]?.tips[1]).toBe(
      "Check the address: rahul@gmail.com. A typo sends it nowhere.",
    );
    expect(helpItems({ typedEmail: "not an address", googleOffered: true })[0]?.tips[1]).toBe(
      "Check the address you typed. A typo sends it nowhere.",
    );
    // The same words whatever the address: the page has nothing to say about accounts.
    const a = JSON.stringify(helpItems({ typedEmail: "known@example.com", googleOffered: true })).replace("known", "x");
    const b = JSON.stringify(helpItems({ typedEmail: "unknown@example.com", googleOffered: true })).replace("unknown", "x");
    expect(a).toBe(b);
    expect(JSON.stringify(helpItems({ typedEmail: null, googleOffered: true }))).not.toMatch(/no account|not found|isn't registered/i);
  });

  it("hides Write to us when the console has no support address", () => {
    for (const supportEmail of [undefined, null, "", "  ", "not-an-address"]) {
      const lost = helpItems({ typedEmail: null, googleOffered: true, supportEmail })[1];
      expect(lost).toMatchObject({ question: "I can't open that email any more", cta: "Back to sign in", action: "sign_in" });
      expect(lost?.tips).toEqual([
        "If you signed up with Google, Continue with Google still works.",
        "Your groups, kitchen and balances stay as they are meanwhile.",
      ]);
    }
    const withAddress = helpItems({ typedEmail: null, googleOffered: true, supportEmail: "help@example.com" })[1];
    expect(withAddress).toMatchObject({ cta: "Write to us", action: "write" });
    expect(withAddress?.tips).toHaveLength(3);
  });

  it("goes back to sign in when Google is not offered", () => {
    expect(helpItems({ typedEmail: null, googleOffered: false })[2]).toMatchObject({ cta: "Back to sign in", action: "sign_in" });
  });

  it("carries a safe next there and back, and nothing else", () => {
    expect(helpPathFor(null)).toBe(HELP_PATH);
    expect(helpPathFor("/join/KTCH2345")).toBe("/login/help?next=%2Fjoin%2FKTCH2345");
    expect(helpPathFor("//evil.example")).toBe(HELP_PATH);
    expect(helpPathFor("/home")).toBe(HELP_PATH);
  });

  it("writes to the console's contact address with no one's details in it", () => {
    expect(writeToUsHref("help@example.com")).toBe("mailto:help@example.com?subject=Can't%20sign%20in%20to%20Cookpool");
  });

  it("is a static page of its own, served as a file with no rewrite", () => {
    expect(STATIC_PAGES).toContain("/login/help");
    expect(staticPageFor("/login/help")).toBe("/login/help");
    expect(staticPageFor("/login/help/")).toBe("/login/help");
    expect(redirectRules().some((r) => r.startsWith("/login"))).toBe(false);
  });
});
