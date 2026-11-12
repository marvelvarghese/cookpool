import * as React from "react";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { renderToStaticMarkup } from "react-dom/server";
import { StartStep, type StartStepProps } from "@web-console-next/components/kitchen/sign-in-steps-ui";
import { WelcomeHero } from "@web-console-next/components/kitchen/sign-in-screens-ui";
import { rememberedCard } from "@web-console-next/components/kitchen/sign-in-screens";

// cookpool-revamp RV-6: You, Community and Sign in in the new look
// (`RvYou`, `RvCommunity`, `RvSignIn`).

const SRC = `${cwd()}/../../apps/web-console-next/src`;

function start(over: Partial<StartStepProps> = {}): string {
  const p: StartStepProps = {
    mode: "in",
    onMode: () => undefined,
    title: "Sign in",
    remembered: null,
    onContinue: () => undefined,
    onForget: () => undefined,
    continuing: false,
    passkey: { busy: false, onClick: () => undefined },
    passkeyNotice: null,
    withGoogle: true,
    googleBusy: false,
    onGoogle: () => undefined,
    email: "",
    onEmail: () => undefined,
    signUpName: "",
    onSignUpName: () => undefined,
    notice: null,
    sending: false,
    canSignUp: false,
    onSubmit: () => undefined,
    helpHref: "/login/help",
    emailRef: null,
    nameRef: null,
    ...over,
  };
  return renderToStaticMarkup(React.createElement(StartStep, p));
}

describe("Sign in (RvSignIn)", () => {
  it("puts Google and Passkey side by side, each keeping its full name for screen readers", () => {
    const out = start();
    expect(out).toContain("grid-cols-2");
    expect(out).toMatch(/aria-label="Continue with Google"[^>]*>.*?Google<\/button>/);
    expect(out).toMatch(/aria-label="Sign in with a passkey"[^>]*>.*?Passkey<\/button>/);
    expect(out).toContain(">or<");
    expect(out).toContain(">Email me a code<");
    // One helper line: the terms, under Can't sign in?; Terms and Privacy link to its Privacy and terms (RV-18; the board's shorter words, RV-23).
    expect(out.replace(/<[^>]+>/g, "")).toContain("By continuing you agree to the Terms and Privacy.");
    expect(out).toMatch(/href="\/login\/help#privacy"[^>]*>Terms<\/a>/);
    expect(out).toMatch(/href="\/login\/help#privacy"[^>]*>Privacy<\/a>/);
    expect(out).not.toContain("No password.");
  });

  it("has Google alone on Create account, and Google alone where passkeys do not run", () => {
    const create = start({ mode: "new" });
    expect(create).toContain('aria-label="Sign up with Google"');
    expect(create).not.toContain("Passkey");
    expect(create).toContain("grid-cols-1");
    expect(start({ passkey: null })).not.toContain("Passkey");
    expect(start({ withGoogle: false, passkey: null })).not.toContain(">or<");
  });

  it("shows the remembered card with its one main button, Face ID's icon for a passkey account", () => {
    const card = rememberedCard({ name: "Rahul Varghese", email: "rahul@gmail.com", method: "passkey" }, { label: "Sign in with Face ID", here: "passkey on this phone" });
    const out = start({ remembered: card, rememberedPasskey: true });
    expect(out).toContain(">Welcome back, Rahul<");
    expect(out).toContain("Sign in with Face ID");
    expect(out).toContain("lucide-scan-face");
    expect(out).toContain(">Use another account<");
    expect(out).not.toContain("Email me a code");
    expect(start({ remembered: rememberedCard({ name: "Anu", email: "anu@example.com", method: "code" }) })).not.toContain("lucide-scan-face");
  });

  it("draws the welcome panel in the accent, with no chips", () => {
    const out = renderToStaticMarkup(React.createElement(WelcomeHero, { title: "Good to see you again." }));
    expect(out).toContain("bg-primary");
    expect(out).toContain("text-primary-foreground");
    expect(out).toContain("Good to see you again.");
    expect(out).not.toContain("You&#x27;re square");
  });

  it("turns dark on for sign-in only with the new look, after mount", () => {
    const page = readFileSync(`${SRC}/app/login/page.tsx`, "utf8");
    expect(page).toContain("useKitchenBodyTheme(newLook)");
    expect(page).toContain("newLook && KITCHEN_NEW_LOOK_CLASS");
    expect(readFileSync(`${SRC}/components/kitchen/sign-in-screens-ui.tsx`, "utf8")).toMatch(/React\.useEffect\(\(\) => setOn\(newFrame\(\)\), \[\]\)/);
  });
});

describe("the new look's rules in RV-6's screens", () => {
  const FILES = [
    "components/kitchen/you-home-ui.tsx",
    "components/kitchen/you-settings-ui.tsx",
    "components/kitchen/ai-settings-ui.tsx",
    "components/kitchen/passkey-ui.tsx",
    "components/kitchen/passkey-security-ui.tsx",
    "components/kitchen/sign-in-ui.tsx",
    "components/kitchen/sign-in-screens-ui.tsx",
    "components/kitchen/sign-in-steps-ui.tsx",
    "components/kitchen/sign-in-help-ui.tsx",
    "components/kitchen/community-ui.tsx",
    "components/kitchen/community-views.tsx",
    "components/kitchen/community-feed-ui.tsx",
    "components/kitchen/community-post-views.tsx",
    "components/kitchen/community-post-ui.tsx",
    "components/kitchen/community-profile-ui.tsx",
    "components/kitchen/community-setup-ui.tsx",
    "components/kitchen/community-share-ui.tsx",
    "components/kitchen/community-report-ui.tsx",
    "components/kitchen/community-activity-ui.tsx",
    "app/login/page.tsx",
    "app/login/help/page.tsx",
  ];

  it.each(FILES)("%s uses tokens and weights 400/500 only", (file) => {
    // Google's mark keeps its brand colours (fill="#…", not a class).
    const text = readFileSync(`${SRC}/${file}`, "utf8").replace(/fill="#[0-9A-Fa-f]{6}"/g, "");
    expect(text).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(text).not.toMatch(/\bfont-(semibold|bold|extrabold|black)\b/);
  });
});
