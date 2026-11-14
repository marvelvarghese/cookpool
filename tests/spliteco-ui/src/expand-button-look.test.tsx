// money-native MY-3: the button reads colours only from the MY-2 tokens (static markup, no DOM).

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExpandButton } from "@saas/spliteco-ui/expand-button";

describe("both themes", () => {
  const markup = (theme: "cookpool" | "spliteco", open: boolean) =>
    renderToStaticMarkup(<ExpandButton kind="settle" label="Settle" theme={theme} defaultOpen={open}>x</ExpandButton>);
  // The scope's own `--look-*: #hex` declarations are the tokens; everything else must only refer to them.
  // The one literal is the boards' dim, rgba(27,36,32,.42), the same in both themes.
  const drawn = (html: string) => html.replace(/--look-\w+:[^;]+;/g, "").replace("rgba(27,36,32,.42)", "");

  it.each(["cookpool", "spliteco"] as const)("%s: the button draws only from tokens", (theme) => {
    for (const open of [false, true]) {
      const html = drawn(markup(theme, open));
      expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(html).not.toMatch(/rgba?\(|hsla?\(/);
      expect(html).toContain("var(--look-");
    }
  });

  it("is primary closed and surface open, with the board's dim in both themes", () => {
    expect(drawn(markup("spliteco", false))).toContain("background:var(--look-primary)");
    expect(drawn(markup("spliteco", true))).toContain("background:var(--look-surface)");
    for (const theme of ["cookpool", "spliteco"] as const) expect(markup(theme, true)).toContain("background:rgba(27,36,32,.42)");
  });
});

