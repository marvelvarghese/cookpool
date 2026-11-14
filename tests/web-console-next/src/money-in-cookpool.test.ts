import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { SPLITECO_SCREENS, splitecoToCookpool } from "@web-console-next/components/kitchen/spliteco-paths";
import { scopeCss } from "@web-console-next/lib/scope-css.mjs";
import { NEW_FRAME_ONLY } from "@web-console-next/lib/features";
import { STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";

// money-inside MN-8: every Money feature stays inside Cookpool.

const APP = `${cwd()}/../../apps/web-console-next`;
const SPLITECO_CSS = `${cwd()}/../../apps/spliteco-web/src/app/globals.css`;

describe("Spliteco's screens inside Cookpool's Money (MN-8)", () => {
  it("send Spliteco's links to Cookpool's address for the same screen", () => {
    expect(splitecoToCookpool("/group?id=org_1")).toBe("/money/group?id=org_1");
    expect(splitecoToCookpool("/add?group=org_1&method=items")).toBe("/money/add?group=org_1&method=items");
    expect(splitecoToCookpool("/expense?id=t_1&comment=1")).toBe("/money/expense?id=t_1&comment=1");
    // /money/settle is the kitchen's settle; Spliteco's Settle up is settle-up.
    expect(splitecoToCookpool("/settle")).toBe("/money/settle-up");
    expect(splitecoToCookpool("/settle?group=org_1&to=u_2")).toBe("/money/settle-up?group=org_1&to=u_2");
    // Screens Cookpool does not show go back to the Money tab, never to the Spliteco app.
    for (const p of ["/", "/groups", "/you", "/activity", "/live/KTCH2345"]) expect(splitecoToCookpool(p)).toBe("/money");
  });

  it("give every mounted screen its page, in the new frame only and served as a file", () => {
    for (const at of Object.values(SPLITECO_SCREENS)) {
      const route = at.replace("/money/", "");
      const page = readFileSync(`${APP}/src/app/(kitchen)/money/${route}/page.tsx`, "utf8");
      expect(page).toContain("<SplitecoScreen");
      expect(NEW_FRAME_ONLY[at]).toBe("/home");
      expect(STATIC_PAGES).toContain(at);
    }
  });

  it("open Settle up, + Expense and a group inside Cookpool, with no handoff to the Spliteco app", () => {
    const tab = readFileSync(`${APP}/src/components/kitchen/money-inside-ui.tsx`, "utf8");
    expect(tab).toContain("splitecoToCookpool(splitecoPath(t))");
    expect(tab).not.toMatch(/handoffCode|handoffUrlTo|location\.assign/);
  });

  it("scope Spliteco's stylesheet under .spx: no rule restyles Cookpool, and the generated file is current", () => {
    const css = scopeCss(readFileSync(SPLITECO_CSS, "utf8"));
    const heads = css.match(/^[^@\s}][^{]*(?=\{)/gm) ?? [];
    expect(heads.length).toBeGreaterThan(300);
    for (const h of heads) for (const sel of h.split(",")) expect(sel.trim()).toMatch(/^\.spx(\s|$)/);
    expect(css).not.toContain('data-theme="light"');
    expect(css).toContain(".spx {");
    const file = readFileSync(`${APP}/src/styles/spliteco-inside.css`, "utf8");
    expect(file.slice(file.indexOf("\n") + 1).trim()).toBe(css.trim());
  });

  it("keeps @keyframes and scopes the rules inside @media", () => {
    const out = scopeCss("@keyframes spin { to { transform: rotate(360deg); } }\n@media (max-width: 9px) { .a { color: red; } }\nbody { margin: 0 }\n* { box-sizing: border-box; }");
    expect(out).toContain("@keyframes spin { to { transform: rotate(360deg); } }");
    expect(out).toMatch(/@media \(max-width: 9px\) \{\s*\.spx \.a \{/);
    expect(out).toContain(".spx { margin: 0 }");
    expect(out).toContain(".spx, .spx * {");
  });
});
