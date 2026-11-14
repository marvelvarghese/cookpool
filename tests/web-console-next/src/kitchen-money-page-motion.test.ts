// money-native MY-23: Money's page steps run on the motion tokens.

import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { MOTION } from "@saas/spliteco-ui/motion";
import { moneyKind, transitionKind } from "@web-console-next/components/kitchen/transitions";
import { TRANSITION_MS, transitionStyle } from "@web-console-next/lib/transitions";

const root = `${cwd()}/../../apps/web-console-next/src`;
const css = readFileSync(`${root}/styles/globals.css`, "utf8");
const money = css.slice(css.indexOf("/* Money (MY-23)"), css.indexOf("/* up: the cooking session"));
const opts = { newFrame: true } as const;

describe("which kind a Money step is", () => {
  it("Groups to People drifts forward, People to Groups back (a push or the history's back)", () => {
    expect(moneyKind("/money", "/money/people")).toBe("side-next");
    expect(moneyKind("/money/people", "/money")).toBe("side-prev");
    expect(moneyKind("/money/people", null)).toBe("side-prev");
    expect(transitionKind("/money", "/money/people", opts)).toBe("side-next");
    expect(transitionKind("/money/people", null, opts)).toBe("side-prev");
  });
  it("a person's page and Manage group slide in, and back slides out", () => {
    expect(transitionKind("/money/people", "/money/people/sub_1", opts)).toBe("money-forward");
    expect(transitionKind("/money", "/money/group", opts)).toBe("money-forward");
    expect(transitionKind("/money/people/sub_1", "/money/people", opts)).toBe("money-back");
    expect(transitionKind("/money/people/sub_1", null, opts)).toBe("money-back");
    expect(transitionKind("/money/group", null, opts)).toBe("money-back");
    expect(transitionKind("/money/group", "/money", { ...opts, direction: "back" })).toBe("money-back");
  });
  it("Add group is a sheet that rises by itself: the page does not move", () => {
    expect(transitionKind("/money", "/money/add-group", opts)).toBeNull();
    expect(transitionKind("/money/add-group", null, opts)).toBeNull();
    expect(transitionKind("/money/add-group", "/money", opts)).toBeNull();
  });
  it("outside Money the route model is unchanged", () => {
    expect(moneyKind("/home", "/pantry")).toBeUndefined();
    expect(transitionKind("/home", "/pantry", opts)).toBe("tab");
  });
});

describe("the timings are the tokens'", () => {
  it("slides take the geometry time, the drift the fade time", () => {
    expect(TRANSITION_MS["money-forward"]).toBe(MOTION.geometryMs);
    expect(TRANSITION_MS["money-back"]).toBe(MOTION.geometryMs);
    expect(TRANSITION_MS["side-next"]).toBe(MOTION.fadeMs);
    expect(TRANSITION_MS["side-prev"]).toBe(MOTION.fadeMs);
    expect(MOTION.geometryMs).toBe(450);
    expect(MOTION.shiftPct).toBe(20);
  });
  it("the CSS reads them from variables, with no number or curve of its own", () => {
    expect(money).toContain("animation-duration: var(--kp-motion-geometry)");
    expect(money).toContain("animation-duration: var(--kp-motion-fade)");
    expect(money).toContain("translateX(calc(var(--kp-motion-shift) * -1))");
    expect(money).toContain("var(--kp-motion-drift)");
    expect(money).not.toMatch(/\d+ms/);
    expect(money).not.toContain("cubic-bezier");
  });
  it("it animates transform and opacity (and the old page's dim), nothing else", () => {
    const props = [...money.matchAll(/(?:from|to) \{ ([^}]*) \}/g)].flatMap((m) => m[1]!.split(";").map((d) => d.split(":")[0]!.trim()).filter(Boolean));
    expect(new Set(props)).toEqual(new Set(["transform", "filter", "opacity"]));
  });
  it("reduced motion is the plain fade, whatever the kind", () => {
    const ctx = { wide: false, reducedMotion: true, swiped: false } as const;
    for (const kind of ["money-forward", "money-back", "side-next", "side-prev"] as const) expect(transitionStyle(kind, ctx)).toBe("reduced");
  });
  it("the switch is kept in place on a side step so its pill slides in the live page", () => {
    expect(money).toContain('html[data-vt^="side-"] [data-vt-keep="money-switch"] { view-transition-name: kp-money-switch; }');
  });
});
