// money-native MY-2: one look, two themes.

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SPLITECO_INSIDE } from "@saas/spliteco-ui/inside-look";
import { LOOK_TOKENS, LookScope, contrastRatio, look, lookColours, lookVars } from "@saas/spliteco-ui/look";

const THEMES = ["cookpool", "spliteco"] as const;

describe("the token set", () => {
  it.each(THEMES)("%s resolves every token to a hex colour", (theme) => {
    const colours = lookColours(theme);
    expect(Object.keys(colours).sort()).toEqual([...LOOK_TOKENS].sort());
    for (const t of LOOK_TOKENS) expect(colours[t]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("matches the Theme_Tokens board", () => {
    expect(lookColours("cookpool")).toMatchObject({ bg: "#F6F5F0", surface: "#FFFFFF", primary: "#1F7A4D", owe: "#A3360A", navInk: "#1F7A4D", grab: "#D8D5CA" });
    expect(lookColours("spliteco")).toMatchObject({ money: "#F5B53D", navInk: "#F5B53D", grab: "#33466B" });
  });

  it("keeps Deep ocean exactly as SPLITECO_INSIDE has it", () => {
    const o = lookColours("spliteco");
    const s = SPLITECO_INSIDE;
    expect([o.bg, o.surface, o.line, o.soft, o.ink, o.muted, o.softInk, o.onPrimary, o.primary, o.money, o.get, o.owe]).toEqual(
      [s.ground, s.card, s.line, s.tint, s.ink, s.muted, s.soft, s.white, s.cobalt, s.gold, s.get, s.owe],
    );
  });

  it.each(THEMES)("%s reads ink, muted, owe and get over surface at 4.5:1 or better", (theme) => {
    const c = lookColours(theme);
    for (const t of ["ink", "muted", "owe", "get", "softInk"] as const) {
      const over = t === "softInk" ? c.soft : c.surface;
      expect(contrastRatio(c[t], over)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("LookScope", () => {
  it("a page draws from variables, never a colour of its own", () => {
    for (const t of LOOK_TOKENS) expect(look[t]).toBe(`var(--look-${t})`);
  });

  it.each(THEMES)("sets every token for %s as a CSS variable", (theme) => {
    const vars = lookVars(theme);
    for (const t of LOOK_TOKENS) expect(vars[`--look-${t}`]).toBe(lookColours(theme)[t]);
    const html = renderToStaticMarkup(<LookScope theme={theme}><b>x</b></LookScope>);
    expect(html).toContain(`data-look="${theme}"`);
    expect(html).toContain(`--look-ink:${lookColours(theme).ink}`);
    expect(html).toContain("<b>x</b>");
  });
});
