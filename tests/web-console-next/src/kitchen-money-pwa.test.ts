// MY-21: Cookpool run as an installed web app (PWA, standalone). Money's pages
// are routes of their own, so switching between pages and Back work; Money sits
// in the frame without a second padding; and the app does not zoom.

import { existsSync, readFileSync } from "node:fs";
import { cwd } from "node:process";
import {
  legacyMoneyHref,
  moneyGroupHref,
  moneyHref,
  MONEY_ADD_GROUP_HREF,
} from "@web-console-next/components/kitchen/money-native";
import { backParent } from "@web-console-next/components/kitchen/back";
import { PULL_PAGES, pullsToRefresh } from "@web-console-next/components/kitchen/gestures";
import { activeNewFrameTab, moneyFlush } from "@web-console-next/components/kitchen/nav";
import { transitionKind } from "@web-console-next/components/kitchen/transitions";
import { frameRedirect } from "@web-console-next/lib/features";
import { STATIC_PAGES, pathParam, staticPageFor } from "@web-console-next/lib/static-pages.mjs";

const root = `${cwd()}/../../apps/web-console-next/src`;
const ui = `${cwd()}/../../packages/spliteco-ui/src`;
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");
const query = (s: string) => new URLSearchParams(s);

describe("Money's pages are routes (switching pages, Back)", () => {
  it("has a route for Groups, People and a person, each a static page with its own file", () => {
    expect(moneyHref({ kind: "groups" })).toBe("/money");
    expect(moneyHref({ kind: "people" })).toBe("/money/people");
    expect(moneyHref({ kind: "person", subjectId: "usr_zoya" })).toBe("/money/people/usr_zoya");
    for (const page of ["/money", "/money/people", "/money/people/:subjectId"]) expect(STATIC_PAGES).toContain(page);
    expect(staticPageFor("/money/people/usr_zoya")).toBe("/money/people/:subjectId");
    expect(pathParam("/money/people/:subjectId", "subjectId", "/money/people/usr_zoya")).toBe("usr_zoya");
    for (const file of ["people/page.tsx", "people/[subjectId]/page.tsx", "people/[subjectId]/layout.tsx"]) {
      expect(existsSync(`${root}/app/(kitchen)/money/${file}`)).toBe(true);
    }
  });

  it("is the new frame's only: today's frame sends a visitor Home", () => {
    expect(frameRedirect("/money/people", false)).toBe("/home");
    expect(frameRedirect("/money/people/:subjectId", false)).toBe("/home");
    expect(frameRedirect("/money/people", true)).toBeNull();
  });

  it("goes back one step at a time: a person → People → Money → Home", () => {
    expect(backParent("/money/people/usr_zoya", {}, { newFrame: true })).toBe("/money/people");
    expect(backParent("/money/people", {}, { newFrame: true })).toBe("/money");
    expect(backParent("/money", {}, { newFrame: true })).toBeNull();
  });

  it("stays on the Money tab, and a step between them is a page transition, not a no-op", () => {
    for (const path of ["/money", "/money/people", "/money/people/usr_zoya", "/money/group", "/money/add-group"]) {
      expect(activeNewFrameTab(path)).toBe("money");
    }
    expect(transitionKind("/money", "/money/people", { newFrame: true })).toBe("side-next");
    expect(transitionKind("/money/people", "/money", { newFrame: true })).toBe("side-prev");
    expect(transitionKind("/money/people/usr_zoya", "/money/people", { newFrame: true })).toBe("money-back");
    expect(transitionKind("/money/people", "/cook", { newFrame: true })).toBe("tab");
  });

  it("pulls to refresh on the people lists like Money", () => {
    for (const page of ["/money/people", "/money/people/:subjectId"]) expect(PULL_PAGES).toContain(page);
    expect(pullsToRefresh("/money/people")).toBe(true);
  });

  it("sends the first build's ?side= and ?person= addresses to their routes", () => {
    expect(legacyMoneyHref(query(""))).toBeNull();
    expect(legacyMoneyHref(null)).toBeNull();
    expect(legacyMoneyHref(query("side=people"))).toBe("/money/people");
    expect(legacyMoneyHref(query("person=usr_zoya"))).toBe("/money/people/usr_zoya");
    expect(legacyMoneyHref(query("person=../x"))).toBeNull();
  });

  it("navigates through the frame's router and Back, never the bare router or a replace", () => {
    const src = read("components/kitchen/money-native-ui.tsx");
    expect(src).not.toMatch(/\brouter\.replace\((?!legacy)/);
    expect(src).not.toMatch(/import \{[^}]*useRouter[^}]*\} from "next\/navigation"/);
    expect(src).toContain("useKitchenRouter()");
    expect(src).toContain("onBack={goBack}");
    expect(src).toContain("router.push(moneyHref({ kind: side }))");
    expect(src).toContain("router.push(moneyHref({ kind: \"person\", subjectId: p.subjectId }))");
    expect(src).toContain("router.push(moneyGroupHref(id))");
    expect(MONEY_ADD_GROUP_HREF).toBe("/money/add-group");
    expect(moneyGroupHref("org_a")).toBe("/money/group?id=org_a");
  });

  it("keeps a closing box from taking taps: the button is live only once the box is back", () => {
    const src = readFileSync(`${ui}/expand-button.tsx`, "utf8");
    expect(src).toContain('pointerEvents: open || shown ? "none" : "auto"');
  });
});

describe("Money sits in the frame once (no double padding)", () => {
  it("leaves the shared pages their own edges: flush on Money's three pages, in the new frame only", () => {
    for (const path of ["/money", "/money/", "/money/people", "/money/people/usr_zoya"]) expect(moneyFlush(true, path)).toBe(true);
    for (const path of ["/money/group", "/money/add-group", "/money/settle", "/home", "/people", "/pantry"]) expect(moneyFlush(false, path) || moneyFlush(true, path)).toBe(false);
    expect(moneyFlush(false, "/money")).toBe(false);
    expect(moneyFlush(true, null)).toBe(false);
  });

  it("drops <main>'s side and top padding for them, keeping only the safe area", () => {
    const layout = read("app/(kitchen)/layout.tsx");
    expect(layout).toContain("const flush = moneyFlush(frameNew, pathname)");
    expect(layout).toContain("pt-[env(safe-area-inset-top)] pb-0 [--cp-gutter:0px]");
    expect(layout).toContain("min-[900px]:px-0 min-[900px]:pb-0 min-[900px]:pt-0");
    // The shared pages carry the boards' 20px sides and the room for the tab bar.
    const page = readFileSync(`${ui}/board.ts`, "utf8");
    expect(page).toContain("page: { padX: 20, padTop: 20");
  });

  it("sits the bar and the floating buttons on one set of variables, with a single offset", () => {
    const css = read("styles/globals.css");
    const vars = css.match(/:root \{\s*--cp-bar-h:[^}]*\}/)?.[0] ?? "";
    expect(vars).toContain("--cp-bar-h: 68px");
    expect(vars).toContain("--cp-bar-bottom: 14px");
    expect(vars).toContain("--cp-bar-top: calc(var(--cp-bar-bottom) + var(--cp-bar-h))");
    expect(vars).toContain("--cp-fab-gap: 14px");
    expect(vars).toContain("--cp-fab-bottom: calc(var(--cp-bar-top) + var(--cp-fab-gap))");
    expect(vars).toContain("--cp-page-end: calc(var(--cp-fab-bottom) + var(--cp-fab-h) + 12px)");
    // The bar reads them; it is not also lifted by the safe inset, and neither is the page under it.
    const bar = read("components/kitchen/tab-bar.tsx");
    expect(bar).toContain("bottom-[var(--cp-bar-bottom)]");
    expect(bar).toContain("h-[var(--cp-bar-h)]");
    expect(bar).not.toMatch(/bottom-\[max\(14px,env/);
    expect(css).toContain("--cp-main-bottom: calc(var(--cp-bar-top) + 24px)");
    // Expense and Settle up default to the variable; the Money pages no longer measure the inset.
    const button = readFileSync(`${ui}/expand-button.tsx`, "utf8");
    expect(button).toContain('DEFAULT_BOTTOM = "var(--cp-fab-bottom, 96px)"');
    expect(read("components/kitchen/money-native-ui.tsx")).not.toMatch(/bottomOffset|safe-area-inset/);
    for (const page of ["groups-ui.tsx", "people-ui.tsx"]) expect(readFileSync(`${ui}/${page}`, "utf8")).toContain("var(--cp-page-end, 120px)");
  });
});

describe("the app does not zoom", () => {
  const layout = read("app/layout.tsx");
  const css = read("styles/globals.css");

  it("says so in the viewport: no scaling, notch-aware", () => {
    expect(layout).toMatch(/export const viewport: Viewport = \{[^}]*width: "device-width"/s);
    expect(layout).toMatch(/initialScale: 1,\s*maximumScale: 1,\s*userScalable: false,\s*viewportFit: "cover"/);
  });

  it("stops the double-tap zoom on the root, not only on controls", () => {
    expect(css).toMatch(/html,\s*body \{\s*touch-action: manipulation;/);
  });

  it("keeps phone text fields at 16px so iOS does not zoom on focus, and leaves the browser's text size alone", () => {
    expect(css).toContain("@media (max-width: 899px)");
    expect(css).toContain("font-size: max(16px, 1em) !important;");
    expect(css).toContain("text-size-adjust: 100%;");
    // No fixed root font size that would override the person's text-size setting.
    expect(css).not.toMatch(/html\s*\{[^}]*font-size:\s*\d+px/);
  });

  it("is installed as a standalone app", () => {
    expect(readFileSync(`${root}/lib/manifest.ts`, "utf8")).toContain('display: "standalone"');
  });
});
