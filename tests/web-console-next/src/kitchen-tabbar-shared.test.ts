import * as React from "react";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { renderToStaticMarkup } from "react-dom/server";
import { tabBarHidden } from "@web-console-next/components/kitchen/nav";
import { GROUP_TINTS, groupTint } from "@web-console-next/components/kitchen/group-tint";
import { GroupAvatar } from "@web-console-next/components/kitchen/kit";
import { FACE_COLORS, ME_FACE } from "@web-console-next/components/kitchen/faces";
import { MainButtonLabel } from "@web-console-next/components/kitchen/faces-ui";
import { Chip, Segmented } from "@web-console-next/components/kitchen/ledger-ui";

// cookpool-revamp RV-19: the pushed screens the boards draw without the tab
// bar hide it, the room it takes is a CSS variable, and the shared parts
// (faces, group tints, Chip, Segmented, the card-border rule) follow the tokens.

const APP = `${cwd()}/../../apps/web-console-next`;
const read = (path: string) => readFileSync(`${APP}/${path}`, "utf8");
const css = read("src/styles/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

describe("which screens hide the tab bar (RV-19)", () => {
  const hides = (path: string, search?: string) => tabBarHidden(true, path, search);

  it("hides it on an item, a recipe, the cooking session, Cooked! and Groups", () => {
    expect(hides("/pantry/me:itm_1")).toBe(true);
    expect(hides("/pantry/org_1:itm_2/")).toBe(true);
    expect(hides("/recipes/rcp_1")).toBe(true);
    expect(hides("/cook/session")).toBe(true);
    expect(hides("/dishes/dsh_1", "cooked=1")).toBe(true);
    expect(hides("/dishes/dsh_1", "?cooked=1&split=1")).toBe(true);
    expect(hides("/groups")).toBe(true);
    expect(hides("/groups/")).toBe(true);
  });

  it("keeps it on the tabs, Add item, the shopping run, a stock check, forms and a plain dish", () => {
    for (const path of [
      "/home",
      "/pantry",
      "/pantry/new",
      "/pantry/run",
      "/pantry/me:itm_1/check",
      "/recipes/new",
      "/recipes/rcp_1/edit",
      "/recipes/rcp_1/plan",
      "/cook",
      "/money",
      "/you",
      "/groups/flat-4b",
      "/groupsx",
      "/dishes/dsh_1",
    ]) {
      expect([path, hides(path)]).toEqual([path, false]);
    }
    expect(hides("/dishes/dsh_1", "split=1")).toBe(false);
    expect(hides("/dishes/dsh_1", "cooked=0")).toBe(false);
  });

  it("never hides today's frame's bar", () => {
    expect(tabBarHidden(false, "/pantry/me:itm_1")).toBe(false);
    expect(tabBarHidden(false, "/groups")).toBe(false);
    expect(tabBarHidden(true, null)).toBe(false);
  });

  it("is what the kitchen layout renders by, with data-tabbar for the CSS", () => {
    const layout = read("src/app/(kitchen)/layout.tsx");
    expect(layout).toContain("tabBarHidden(frameNew, pathname, search)");
    expect(layout).toContain("ready && !barHidden ? <KitchenTabBar");
    expect(layout).toContain('data-tabbar={frameNew ? (barHidden ? "hidden" : "shown") : undefined}');
    // The query is read inside Suspense, so every page stays static.
    expect(layout).toMatch(/<React\.Suspense fallback=\{null\}>\s*<SearchProbe/);
  });
});

describe("the tab bar's room as CSS variables (RV-19)", () => {
  const rule = (selector: string) => {
    const m = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1]!.trim() === selector);
    if (!m) throw new Error(`no rule ${selector}`);
    return m[2]!;
  };

  it("takes the bar's height and gap where it shows, and 0 where it is hidden", () => {
    expect(rule('[data-tabbar="shown"]')).toContain("--cp-tabbar-space: calc(var(--cp-bar-top) + 8px)");
    expect(rule('[data-tabbar="shown"]')).toContain("--cp-bottom-bar: var(--cp-tabbar-space)");
    const hidden = rule('[data-tabbar="hidden"]');
    expect(hidden).toContain("--cp-tabbar-space: 0px");
    expect(hidden).toContain("--cp-bottom-bar: max(12px, env(safe-area-inset-bottom))");
    expect(hidden).toContain("--cp-main-bottom:");
    expect(rule("[data-tabbar]")).toContain("--cp-tabbar-space: 0px");
  });

  it("is what this task's sticky bars use, falling back to today's offset without it", () => {
    const fallback = "bottom-[var(--cp-bottom-bar,calc(env(safe-area-inset-bottom)+5.75rem))]";
    for (const f of ["src/app/(kitchen)/pantry/new/page.tsx", "src/components/kitchen/shopping-run-ui.tsx", "src/components/kitchen/stock-check-ui.tsx"]) {
      expect([f, read(f).includes(fallback)]).toEqual([f, true]);
    }
    expect(read("src/app/(kitchen)/layout.tsx")).toContain("pb-[var(--cp-main-bottom,calc(env(safe-area-inset-bottom)+6.5rem))]");
  });
});

describe("the card-border rule (RV-19)", () => {
  it("takes the border off every rounded bordered card in the new frame, never off a field or a control", () => {
    const m = css.match(/(\.cookpool-new \[class\*="rounded"\]\.border\.bg-card[^{]*)\{([^}]*)\}/);
    expect(m).not.toBeNull();
    for (const keep of [":not(input)", ":not(textarea)", ":not(select)", ":not(label)", ":not(button)", ":not([role])", ":not(.border-dashed)", ":has(> input, > textarea, > select)"]) {
      expect(m![1]).toContain(keep);
    }
    expect(m![2]).toContain("border-width: 0");
    expect(m![2]).toContain("box-shadow: var(--cp-shadow-card)");
  });
});

describe("a group's tint (RV-19)", () => {
  const ids = Array.from({ length: 60 }, (_, i) => `org_${i.toString(36)}${"x".repeat(i % 7)}`);

  it("is stable from the group id, and spreads over all six", () => {
    for (const id of ids) expect(groupTint(id)).toBe(groupTint(id));
    expect(new Set(ids.map(groupTint)).size).toBe(GROUP_TINTS.length);
    expect(GROUP_TINTS).toEqual(["green", "blue", "amber", "purple", "teal", "slate"]);
  });

  it("is drawn by GroupAvatar in the new frame only, from the id, else the name", () => {
    const html = (props: { name: string; id?: string }) => renderToStaticMarkup(React.createElement(GroupAvatar, props));
    const a = html({ name: "Flat 4B", id: "org_a1" });
    expect(a).toContain(`data-tint="${groupTint("org_a1")}"`);
    expect(a).toContain(">F4<");
    // Today's frame keeps the green tint; the group's own is under .cookpool-new.
    expect(a).toContain("bg-cp-herb-tint");
    expect(a).toMatch(/\[\.cookpool-new_&amp;\]:bg-cp-[a-z-]+-tint/);
    // Renaming the group keeps its tint; without an id, the name picks it.
    expect(html({ name: "Renamed", id: "org_a1" })).toContain(`data-tint="${groupTint("org_a1")}"`);
    expect(html({ name: "Flat 4B" })).toContain(`data-tint="${groupTint("Flat 4B")}"`);
  });

  it("is a light tint with dark words, and the dark-mode pair, as tokens", () => {
    for (const t of ["purple", "teal", "slate"]) {
      expect(css).toMatch(new RegExp(`--cp-${t}: [\\d.]+ [\\d.]+% [\\d.]+%;`));
      expect(css).toMatch(new RegExp(`--cp-${t}-tint: [\\d.]+ [\\d.]+% [\\d.]+%;`));
      // Light, the phone's dark, and Dark pinned in Appearance (KC-9).
      expect(css.match(new RegExp(`--cp-${t}-tint:`, "g"))).toHaveLength(3);
    }
  });
});

describe("the shared parts follow the tokens (RV-19)", () => {
  it("draws faces from the face tokens, yours on the accent", () => {
    expect(ME_FACE).toBe("hsl(var(--cp-face-me))");
    expect(FACE_COLORS).toEqual([1, 2, 3, 4, 5, 6].map((n) => `hsl(var(--cp-face-${n}))`));
    for (let n = 1; n <= 6; n++) expect(css).toContain(`--cp-face-${n}:`);
    expect(css.match(/--cp-face-me:/g)).toHaveLength(3);
  });

  it("sets the main button's words 17px Medium over 12px Regular in the new frame", () => {
    const html = renderToStaticMarkup(React.createElement(MainButtonLabel, { title: "Add", who: "You + Anu" }));
    expect(html).toContain("[.cookpool-new_&amp;]:text-[17px] [.cookpool-new_&amp;]:font-medium");
    expect(html).toContain("[.cookpool-new_&amp;]:text-xs [.cookpool-new_&amp;]:font-normal");
  });

  it("draws Chip and Segmented without borders, Medium, on the tint or the accent, in the new frame", () => {
    const on = renderToStaticMarkup(React.createElement(Chip, { selected: true }, "UPI"));
    const off = renderToStaticMarkup(React.createElement(Chip, { selected: false }, "Cash"));
    for (const c of [on, off]) expect(c).toContain("[.cookpool-new_&amp;]:border-0 [.cookpool-new_&amp;]:font-medium");
    expect(on).toContain("[.cookpool-new_&amp;]:bg-cp-accent-tint [.cookpool-new_&amp;]:text-cp-accent-text");
    expect(off).toContain("[.cookpool-new_&amp;]:bg-muted");
    const seg = renderToStaticMarkup(
      React.createElement(Segmented, {
        label: "Split",
        value: "even",
        options: [
          { id: "even", label: "Even" },
          { id: "shares", label: "Shares" },
        ],
        onChange: () => undefined,
      }),
    );
    expect(seg).toContain("[.cookpool-new_&amp;]:border-0 [.cookpool-new_&amp;]:bg-muted");
    // Medium in both frames since RV-23 (the global cap made today's semibold 500 already).
    expect(seg).toContain("px-2 text-sm font-medium");
    expect(seg).not.toContain("font-semibold");
    expect(seg).toContain("bg-primary text-primary-foreground");
  });

  it("leaves no raw hex and no heavy weight in add item and the shopping-run flow", () => {
    for (const f of [
      "src/app/(kitchen)/pantry/new/page.tsx",
      "src/components/kitchen/shopping-run-ui.tsx",
      "src/components/kitchen/run-line-editor-ui.tsx",
      "src/components/kitchen/receipt-scan-ui.tsx",
      "src/components/kitchen/receipt-run-ui.tsx",
      "src/components/kitchen/stock-check-ui.tsx",
    ]) {
      const src = read(f);
      expect([f, src.match(/#[0-9A-Fa-f]{3,8}\b/g)]).toEqual([f, null]);
      expect([f, src.match(/font-(semibold|bold|extrabold|black)/g)]).toEqual([f, null]);
      expect([f, src.match(/rgba\(/g)]).toEqual([f, null]);
    }
  });
});
