import * as React from "react";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { renderToStaticMarkup } from "react-dom/server";
// The context `usePathname()` reads, so the tab bar can be rendered on a page.
import { PathnameContext } from "@web-console-next/../node_modules/next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { KitchenTabBar } from "@web-console-next/components/kitchen/tab-bar";
import { K_BUTTON, K_BUTTON_QUIET, K_CARD, K_ROWS, K_SECTION, K_TITLE } from "@web-console-next/components/kitchen/kit";

// cookpool-revamp RV-2 (design §1–3): the new look's foundation — the tokens in
// light and dark, Outfit, the weight cap, the card and the floating tab bar.

const APP = `${cwd()}/../../apps/web-console-next`;
const css = readFileSync(`${APP}/src/styles/globals.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The custom properties declared in the first rule whose selector is exactly `selector`. */
function vars(selector: string): Record<string, string> {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.trim().replace(/\s+/g, " ") === selector);
  if (!rule) throw new Error(`no rule ${selector}`);
  return Object.fromEntries([...rule[2]!.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** "H S% L%" to "#RRGGBB". */
function hex(hsl: string): string {
  const [h, s, l] = hsl.replace(/%/g, "").split(/\s+/).map(Number) as [number, number, number];
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255);
  };
  return `#${[f(0), f(8), f(4)].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Each channel within 1 of the design's hex (the HSL is written to one decimal). */
function near(actual: string, want: string): boolean {
  const ch = (x: string) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
  const [a, b] = [ch(actual), ch(want)];
  return a.every((v, i) => Math.abs(v - b[i]!) <= 1);
}

function expectColours(tokens: Record<string, string>, table: Record<string, string>) {
  for (const [name, want] of Object.entries(table)) {
    const value = tokens[name];
    expect([name, value !== undefined && near(hex(value), want) ? want : `${value ? hex(value) : "missing"}`]).toEqual([name, want]);
  }
}

describe("the tokens (design §1)", () => {
  const light = vars(".cookpool");
  const dark = vars(".cookpool.cookpool-new, .cookpool-new .cookpool");

  it("carry the design table's light values, the old cp-* names included", () => {
    expectColours(light, {
      background: "#FAF7F2",
      card: "#FFFFFF",
      foreground: "#17201B",
      "muted-foreground": "#5F6862",
      primary: "#167A4A",
      "primary-foreground": "#FFFFFF",
      "cp-card": "#FFFFFF",
      "cp-line": "#F0ECE5",
      "cp-accent-text": "#0F5C37",
      "cp-accent-tint": "#E3F3EA",
      "cp-herb-tint": "#E3F3EA",
      "cp-on-accent": "#FFFFFF",
      "cp-owed": "#1D4ED8",
      "cp-owed-tint": "#E3EBFD",
      "cp-owe": "#C2410C",
      "cp-expired": "#B42318",
      "cp-expired-tint": "#FDECEC",
      "cp-nav-bg": "#17201B",
      "cp-cook": "#D9481F",
      "cp-cook-bg": "#17201B",
    });
    expect(light["cp-shadow-card"]).toBe("0 1px 2px rgba(23, 32, 27, 0.06), 0 4px 14px rgba(23, 32, 27, 0.06)");
  });

  it("carry the dark values: Gold with no orange anywhere, and money you owe in pink", () => {
    expectColours(dark, {
      background: "#0F1412",
      card: "#1A211D",
      foreground: "#F2F5F3",
      "muted-foreground": "#A3ADA7",
      primary: "#FACC15",
      "primary-foreground": "#0F1412",
      "cp-card": "#1A211D",
      "cp-line": "#26302A",
      "cp-accent-text": "#FDE68A",
      "cp-accent-tint": "#3A3112",
      "cp-on-accent": "#0F1412",
      "cp-owed": "#93C5FD",
      "cp-owed-tint": "#16264A",
      "cp-owe": "#F9A8D4",
      "cp-expired": "#FCA5A5",
      "cp-expired-tint": "#3A1A1A",
      "cp-nav-bg": "#1A211D",
      "cp-cook": "#FACC15",
      "cp-tomato": "#FACC15",
    });
    expect(dark["cp-shadow-card"]).toBe("none");
    // No orange: no colour token in dark has a hue between 10° and 40°.
    const orange = Object.entries(dark).filter(([name, v]) => !name.includes("shadow") && /^[\d.]+ [\d.]+% [\d.]+%$/.test(v) && Number(v.split(" ")[0]) >= 10 && Number(v.split(" ")[0]) <= 40 && parseFloat(v.split(" ")[1]!) > 20);
    expect(orange).toEqual([]);
  });

  it("puts dark under prefers-color-scheme, for the new frame only", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*\.cookpool\.cookpool-new,\s*\.cookpool-new \.cookpool \{/);
  });

  it("caps every heavier weight at 500 in kitchen screens", () => {
    const cap = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.includes(".cookpool .font-bold"));
    expect(cap?.[1]).toMatch(/\.cookpool \.font-semibold/);
    expect(cap?.[1]).toMatch(/\.cookpool \.font-extrabold/);
    expect(cap?.[2]).toContain("font-weight: 500");
  });
});

describe("Outfit (design §2)", () => {
  it("is self-hosted through next/font/local as --font-cookpool, replacing Plus Jakarta Sans", () => {
    const theme = readFileSync(`${APP}/src/components/kitchen/theme.ts`, "utf8");
    expect(theme).toContain('from "next/font/local"');
    expect(theme).toContain("@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2");
    expect(theme).toContain('variable: "--font-cookpool"');
    expect(theme).not.toMatch(/plus-jakarta/);
    const pkg = JSON.parse(readFileSync(`${APP}/package.json`, "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/outfit"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies["@fontsource-variable/plus-jakarta-sans"]).toBeUndefined();
  });
});

describe("the kit (design §3)", () => {
  it("has borderless cards with the soft shadow and radius 22, and rows split by the line", () => {
    expect(K_CARD).toBe("rounded-cp-card bg-card text-card-foreground shadow-cp-card");
    expect(K_CARD).not.toMatch(/\bborder\b/);
    expect(K_ROWS).toContain("divide-cp-line");
  });

  it("sizes titles instead of bolding them, and keeps buttons at 44px and Medium", () => {
    expect(K_TITLE).toContain("text-[26px]");
    expect(K_SECTION).toContain("text-[17px]");
    for (const c of [K_TITLE, K_SECTION, K_BUTTON, K_BUTTON_QUIET]) {
      expect(c).toContain("font-medium");
      expect(c).not.toMatch(/font-(semibold|bold|extrabold)/);
    }
    expect(K_BUTTON).toContain("h-11");
    expect(K_BUTTON_QUIET).toContain("bg-cp-accent-tint text-cp-accent-text");
  });
});

describe("the floating tab bar (design §3)", () => {
  const bar = (path: string, frame: boolean) =>
    renderToStaticMarkup(
      React.createElement(PathnameContext.Provider, { value: path }, React.createElement(KitchenTabBar, { onAdd: () => undefined, addOpen: false, newFrame: frame })),
    );

  it("floats 12px from the sides and 14px (or the safe area) from the bottom, radius 24, on nav-bg", () => {
    const nav = bar("/home", true).match(/<nav[^>]*>/)![0];
    expect(nav).toContain("inset-x-3");
    expect(nav).toContain("bottom-[max(14px,env(safe-area-inset-bottom))]");
    expect(nav).toContain("rounded-[24px]");
    expect(nav).toContain("bg-cp-nav-bg");
  });

  it("fills the current tab with the accent, its words on-accent, and only that one", () => {
    const html = bar("/pantry/me:itm_1", true);
    const tabs = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(5);
    const current = tabs.filter((a) => a.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/pantry"');
    expect(current[0]).toContain("bg-primary text-primary-foreground");
    for (const a of tabs.filter((t) => !t.includes("aria-current"))) expect(a).toContain("text-cp-nav-ink");
  });

  it("leaves today's frame on its own bar", () => {
    const html = bar("/home", false);
    expect(html).not.toContain("bg-cp-nav-bg");
    expect(html).toContain("inset-x-0 bottom-0");
  });
});
