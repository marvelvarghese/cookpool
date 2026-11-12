import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { PAGER_TABS, TABS, nearestTab, pillPosition, showsAdd, tabIndexOf } from "@/lib/tabs";

// spliteco-calm SL1 (design §1, §3 "Sign in"): the calm surfaces, the
// floating tab bar and V2SignIn, read from the app's source.

const APP = `${cwd()}/../../apps/spliteco-web/src`;
const read = (path: string) => readFileSync(`${APP}/${path}`, "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

/** A CSS rule's body: `.card { … }`. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("type (design §1)", () => {
  it("has no font weight above 600 anywhere in spliteco-web", () => {
    const heavy: string[] = [];
    for (const file of sources(APP)) {
      const text = readFileSync(file, "utf8");
      const found = text.match(/font-?[wW]eight:\s*"?(?:[7-9]00|bold(?:er)?)\b/g);
      if (found) heavy.push(`${file.slice(APP.length)}: ${found.join(", ")}`);
    }
    expect(heavy).toEqual([]);
  });

  it("caps <b> and <strong> at 600, and sizes titles 26, rows 16, meta 13, tabs 11", () => {
    const css = read("app/globals.css");
    expect(css).toContain("b, strong, th { font-weight: 600; }");
    expect(rule(css, ".h1")).toContain("font-size: 26px");
    expect(rule(css, ".lrow .title")).toContain("font-size: 16px");
    expect(rule(css, ".lrow .sub")).toContain("font-size: 13px");
    expect(rule(css, ".tabbar a")).toContain("font-size: 11px");
  });
});

describe("surfaces (design §1)", () => {
  const css = read("app/globals.css");

  it("cards are radius 22 with no border, and rows split by --line-soft", () => {
    for (const sel of [".card", ".panel", ".gcard", ".table", ".item"]) {
      const body = rule(css, sel);
      expect(body).toContain("border-radius: 22px");
      expect(body).toContain("border: 0");
    }
    expect(rule(css, ".lrow")).toContain("border-bottom: 1px solid var(--line-soft)");
  });

  it("keeps Deep ocean and the light theme", () => {
    expect(css).toContain("--ground: #08111f;");
    expect(css).toContain(':root[data-theme="light"] {');
    expect(css).toContain("--cobalt: #2563eb;");
  });
});

describe("the floating tab bar (design §1)", () => {
  const css = read("app/globals.css");

  it("floats 12 px from the sides and 14 px from the bottom, radius 24, on --surface with a shadow", () => {
    const bar = rule(css, ".tabbar");
    expect(bar).toContain("position: fixed");
    expect(bar).toContain("left: 12px; right: 12px");
    expect(bar).toContain("bottom: calc(14px + env(safe-area-inset-bottom))");
    expect(bar).toContain("border-radius: 24px");
    expect(bar).toContain("background: var(--surface)");
    expect(bar).toContain("box-shadow: var(--bar-shadow)");
  });

  it("slides a cobalt pill to the fractional tab in --tab", () => {
    const pill = rule(css, ".tabbar .pill");
    expect(pill).toContain("background: var(--cobalt)");
    expect(pill).toContain("translateX(calc(var(--tab, 0) * 100%))");
    expect(read("components/ui.tsx")).toContain('"--tab": at');
  });

  it("floats a round 60 px cobalt + above it", () => {
    const fab = rule(css, ".add-fab");
    expect(fab).toContain("width: 60px; height: 60px; border-radius: 50%");
    expect(fab).toContain("background: var(--cobalt)");
  });

  it("has Home, Groups, Activity, You; the + only on the first three", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Home", "Groups", "Activity", "You"]);
    expect(PAGER_TABS).toBe(3);
    expect(tabIndexOf("/")).toBe(0);
    expect(tabIndexOf("/groups")).toBe(1);
    expect(tabIndexOf("/groups/")).toBe(1);
    expect(tabIndexOf("/activity")).toBe(2);
    expect(tabIndexOf("/you")).toBe(3);
    expect(tabIndexOf("/you/assistants")).toBe(3);
    expect(tabIndexOf("/group")).toBe(-1); // a pushed screen, not Groups
    expect(tabIndexOf("/add")).toBe(-1);
    expect([0, 1, 2, 3, -1].map(showsAdd)).toEqual([true, true, true, false, false]);
    expect(pillPosition(1.5)).toBe(1.5);
    expect(pillPosition(-1)).toBe(0);
    expect(pillPosition(9)).toBe(3);
    expect(nearestTab(1.6)).toBe(2);
  });

  it("is hidden on pushed screens, which go back from the left edge", () => {
    const ui = read("components/ui.tsx");
    expect(ui).toContain("{nav ? <TabBar /> : null}");
    expect(ui).toContain("useEdgeBack(goBack, !nav)");
    expect(ui).not.toContain("BottomNav");
    expect(read("components/ui.tsx")).toContain("useSheetDrag(onClose)");
  });
});

describe("Sign in (V2SignIn)", () => {
  const page = read("app/sign-in/page.tsx");

  it("shows the mark, the name and one line", () => {
    expect(page).toContain("<Mark");
    expect(page).toContain("<h1>Spliteco</h1>");
    expect(page).toContain("Split it. Settle it.");
    expect(rule(read("app/globals.css"), ".signin-brand h1")).toContain("font-size: 34px; font-weight: 600");
  });

  it("puts Google and Passkey side by side, Email me a code below, and the Cookpool line", () => {
    expect(page).toContain('className={passkeys ? "grid2" : "stack"}');
    expect(page.indexOf("Google\n")).toBeLessThan(page.indexOf("Passkey\n"));
    expect(page.indexOf("Passkey\n")).toBeLessThan(page.lastIndexOf("Email me a code"));
    expect(page).toContain("Same account as Cookpool");
    // The email code flow is still there, behind the link.
    expect(page).toContain("client.auth.loginStart");
    expect(page).toContain("client.auth.loginComplete");
    expect(page).toContain("passkeySignIn(client)");
  });
});
