import * as React from "react";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { renderToStaticMarkup } from "react-dom/server";
import type { KitchenDish } from "@saas/contracts/kitchen";
import { NOTIFY_TITLE } from "@web-console-next/lib/push";
import { isSignInPath } from "@web-console-next/lib/sign-in-path";
import { HELP_CENTRE_HREF, PRIVACY_HREF, PUSH_TITLE, youGroups } from "@web-console-next/components/kitchen/you";
import { ASSISTANTS_TITLE } from "@web-console-next/components/kitchen/assistants";
import { AI_SETTINGS_TITLE } from "@web-console-next/components/kitchen/ai-settings";
import { CodeStep, type CodeStepProps } from "@web-console-next/components/kitchen/sign-in-steps-ui";
import { AuthTabs } from "@web-console-next/components/kitchen/sign-in-screens-ui";
import { SIGN_IN_SECONDARY } from "@web-console-next/components/kitchen/sign-in-ui";
import { HelpScreen } from "@web-console-next/components/kitchen/sign-in-help-ui";
import { PRIVACY_SECTION_ID, TERMS_LEAD, TERMS_SENTENCE, termsHref } from "@web-console-next/components/kitchen/sign-in";
import { CODE_HINT, NO_EMAIL_LINE, PRIVACY_TITLE, helpItems, privacyMailHref } from "@web-console-next/components/kitchen/sign-in-screens";
import { SEARCH_LABEL, SectionLabel } from "@web-console-next/components/kitchen/community-views";
import { FeedTabs } from "@web-console-next/components/kitchen/community-post-views";
import { SHARE_A_COOK, shareCookChoices } from "@web-console-next/components/kitchen/community-share-cook";
import { ShareCookButton } from "@web-console-next/components/kitchen/community-share-cook-ui";

// cookpool-revamp RV-18: You, Community and Sign in match RvYou, RvCommunity
// and RvSignIn, and the gaps the revamp audit found are closed.

const SRC = `${cwd()}/../../apps/web-console-next/src`;
const read = (file: string) => readFileSync(`${SRC}/${file}`, "utf8");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
/** A class list's plain (unprefixed) utilities. */
const plain = (classes: string) => classes.split(/\s+/).filter((c) => !c.includes(":"));

describe("You (RvYou)", () => {
  it("names each row as its page is titled", () => {
    const rows = youGroups({ passkeys: true }).flatMap((g) => g.rows);
    const label = (id: string) => rows.find((r) => r.id === id)!.label;
    expect(label("apps")).toBe(ASSISTANTS_TITLE);
    expect(ASSISTANTS_TITLE).toBe("Connected apps");
    expect(label("ai")).toBe(AI_SETTINGS_TITLE);
    expect(AI_SETTINGS_TITLE).toBe("AI settings");
    expect(label("push")).toBe(PUSH_TITLE);
    // The notifications page is shared: the new frame takes the row's name, today's keeps its own.
    expect(read("app/(kitchen)/you/notifications/page.tsx")).toContain("newFrame() ? PUSH_TITLE : NOTIFY_TITLE");
    expect(NOTIFY_TITLE).toBe("Notifications");
  });

  it("ends with Help: the help centre and Privacy and terms, each coming back to You", () => {
    const help = youGroups({ passkeys: false }).at(-1)!;
    expect(help.title).toBe("Help");
    expect(help.rows.map((r) => [r.label, r.href])).toEqual([
      ["Help centre", HELP_CENTRE_HREF],
      ["Privacy and terms", PRIVACY_HREF],
    ]);
    expect(PRIVACY_HREF).toBe(`/login/help?next=%2Fyou#${PRIVACY_SECTION_ID}`);
    // Signed in, the help page's Back goes to `next`, not to the sign-in page.
    const page = read("app/login/help/page.tsx");
    expect(page).toContain('signedIn ? (safeNextPath(rawNext) ?? "/home") : signInHref');
  });

  it("keeps Sign out clear of the floating tab bar, and This phone before Help", () => {
    const you = read("components/kitchen/you-home-ui.tsx");
    expect(you).toContain("flex-col gap-[22px] pb-10");
    expect(you).toContain('g.id === "help" ? <InstallGroup /> : null');
  });
});

describe("Community (RvCommunity)", () => {
  const dish = (over: Partial<KitchenDish>) =>
    ({ id: "dsh_1", cook: "usr_me", name: "Dal", orgId: null, state: "open", cookedAt: "2026-11-13T09:00:00", ...over }) as KitchenDish;

  it("Share a cook lists your latest postable cooks, each opening the existing share sheet", () => {
    const now = new Date("2026-11-13T12:00:00");
    const dishes = [
      dish({ id: "dsh_1", name: "Dal" }),
      dish({ id: "dsh_2", cook: "usr_anu", name: "Anu's curry" }),
      dish({ id: "dsh_3", state: "canceled", name: "Burnt rice" }),
      dish({ id: "dsh_4", state: "finalized", name: "Poha", cookedAt: "2026-11-12T09:00:00", orgId: "org_1" }),
    ];
    expect(shareCookChoices(dishes, "usr_me", now)).toEqual([
      { id: "dsh_1", name: "Dal", when: "Today", href: "/dishes/dsh_1?share=1" },
      { id: "dsh_4", name: "Poha", when: "Yesterday", href: "/dishes/dsh_4?share=1" },
    ]);
    expect(shareCookChoices(dishes, null, now)).toEqual([]);
    expect(shareCookChoices(Array.from({ length: 9 }, (_, i) => dish({ id: `dsh_${i}` })), "usr_me", now)).toHaveLength(5);
  });

  it("draws Share a cook as the one main button, floating above the tab bar, on the feed", () => {
    const out = html(React.createElement(ShareCookButton));
    expect(out).toContain(`>${SHARE_A_COOK}</button>`);
    expect(out).toContain("bg-primary");
    expect(out).toContain("fixed inset-x-[18px] bottom-[calc(max(14px,env(safe-area-inset-bottom))+82px)]");
    // Its room at the feed's end, so the last card is never under it.
    expect(out).toMatch(/^<div class="h-14 /);
    expect(read("components/kitchen/community-ui.tsx")).toMatch(/<CommunityFeed \/>\s*\{\/\*[^}]*\}\s*<ShareCookButton \/>/);
  });

  it("has tabs with no ring, an empty state with no dashed border, and plain section headings", () => {
    const tabs = html(React.createElement(FeedTabs, { tab: "following" }));
    expect(tabs).toContain('aria-current="page"');
    expect(plain(tabs.replace(/"/g, " "))).not.toContain("ring-1");
    expect(read("components/kitchen/community-feed-ui.tsx")).not.toContain("border-dashed");
    const label = html(React.createElement(SectionLabel, { id: "x", children: "From your groups" }));
    expect(label).not.toContain("uppercase");
    expect(label).toContain("text-[17px] font-medium");
  });

  it("names search for what it finds, and keeps Activity's No quiet with no helper line", () => {
    expect(SEARCH_LABEL).toBe("Search people");
    const activity = read("components/kitchen/community-activity-ui.tsx");
    expect(activity).toContain("PLAIN_BUTTON");
    expect(activity).not.toContain("ACTIVITY_PUSH_NOTE");
    expect(read("components/kitchen/community-ui.tsx")).not.toContain("border-foreground");
    expect(read("components/kitchen/community-post-ui.tsx")).not.toContain("commentsNote");
  });
});

describe("Sign in (RvSignIn)", () => {
  it("links Terms and Privacy notice to the help page's Privacy and terms, keeping `next`", () => {
    expect(termsHref("/login/help?next=%2Fpantry")).toBe("/login/help?next=%2Fpantry#privacy");
    expect(termsHref("/login/help#privacy")).toBe("/login/help#privacy");
    expect(TERMS_SENTENCE.startsWith(TERMS_LEAD)).toBe(true);
  });

  it("draws Google and Passkey with the shadow only in light, and the chosen tab with no ring", () => {
    expect(plain(SIGN_IN_SECONDARY)).not.toContain("ring-1");
    expect(SIGN_IN_SECONDARY).toContain("[@media(prefers-color-scheme:dark)]:[.cookpool-new_&]:ring-1");
    expect(SIGN_IN_SECONDARY).toContain("shadow-cp-card");
    const tabs = html(React.createElement(AuthTabs, { mode: "in", onMode: () => undefined }));
    expect(plain(tabs.replace(/"/g, " "))).not.toContain("ring-1");
  });

  it("has one helper line on the code step", () => {
    const p: CodeStepProps = {
      stepLabel: "Step 2 of 2",
      email: "rahul@gmail.com",
      onBack: () => undefined,
      boxes: Array.from({ length: 6 }, () => ({ digit: "", state: "empty" as const })),
      code: "",
      disabled: false,
      wrong: false,
      testCode: null,
      notice: null,
      verifying: false,
      onCode: () => undefined,
      onPaste: () => false,
      onFocusChange: () => undefined,
      onSubmit: () => undefined,
      gmailUrl: null,
      resend: { label: "Send a new code", disabled: false },
      onResend: () => undefined,
      helpHref: "/login/help",
      codeRef: null,
    };
    const out = html(React.createElement(CodeStep, p));
    expect(out).toContain(NO_EMAIL_LINE);
    expect(out).not.toContain(CODE_HINT);
    expect(html(React.createElement(CodeStep, { ...p, verifying: true }))).toContain("Signing you in…");
  });

  it("has a Privacy and terms section on Can't sign in?, and no bordered cards", () => {
    const props = {
      items: helpItems({ typedEmail: null, googleOffered: true, supportEmail: "help@cookpool.store" }),
      backHref: "/login",
      signInHref: "/login",
      writeHref: "mailto:help@cookpool.store",
      onGoogle: () => undefined,
      googleBusy: false,
    };
    const out = html(React.createElement(HelpScreen, { ...props, privacyWriteHref: privacyMailHref("help@cookpool.store") }));
    expect(out).toContain(`id="${PRIVACY_SECTION_ID}"`);
    expect(out).toContain(`>${PRIVACY_TITLE}</h2>`);
    expect(out).toContain('href="mailto:help@cookpool.store?subject=Cookpool%20privacy%20and%20terms"');
    expect(plain(out.replace(/"/g, " "))).not.toContain("border");
    expect(privacyMailHref("")).toBeNull();
    expect(html(React.createElement(HelpScreen, props))).not.toContain("Write to us with any question");
  });

  it("forces the admin console's theme light on the sign-in pages, so <html> has no `dark` there", () => {
    expect(isSignInPath("/login")).toBe(true);
    expect(isSignInPath("/login/help")).toBe(true);
    expect(isSignInPath("/loginx")).toBe(false);
    expect(isSignInPath("/home")).toBe(false);
    expect(isSignInPath(null)).toBe(false);
    expect(read("app/providers.tsx")).toContain('forcedTheme={forcedTheme}');
  });
});

describe("the new look's rules in RV-18's restyled screens", () => {
  const FILES = [
    "components/kitchen/notify-ui.tsx",
    "components/kitchen/assistants-ui.tsx",
    "components/kitchen/connect-ui.tsx",
    "components/kitchen/community-share-cook-ui.tsx",
    "components/kitchen/rv-look.ts",
    "app/(kitchen)/you/notifications/page.tsx",
  ];

  it.each(FILES)("%s uses tokens and weights 400/500 only", (file) => {
    const text = read(file);
    expect(text).not.toMatch(/#[0-9A-Fa-f]{6}\b/);
    expect(text).not.toMatch(/\bfont-(semibold|bold|extrabold|black)\b/);
    expect(text).not.toMatch(/\b(text|bg)-white\b/);
    expect(text).not.toMatch(/\buppercase\b/);
  });
});
