// money-native MY-22: the console's Money motion reads the one set of tokens
// (@saas/spliteco-ui/motion): the sheet rises over .45s on the product's
// curve with the dim fading over .3s, and a switch slides its knob.

import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { MOTION } from "@saas/spliteco-ui/motion";

const root = `${cwd()}/../../apps/web-console-next/src`;
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

describe("Money's sheets and switches use the motion tokens", () => {
  const kit = read("components/kitchen/money-sheet-kit.tsx");
  const manage = read("components/kitchen/money-manage-view.tsx");

  it("the board sheet's slide takes the geometry time on the product's curve, its scrim the dim time", () => {
    expect(kit).toContain("animationDuration: `${MOTION.geometryMs}ms`");
    expect(kit).toContain("animationTimingFunction: MOTION.ease");
    expect(kit).toContain("animationDuration: `${MOTION.dimMs}ms`");
    expect(MOTION.geometryMs).toBe(450);
    expect(MOTION.dimMs).toBe(300);
  });

  it("the switch's knob slides on transform (not left) with the small-change time, and reduced motion drops it", () => {
    expect(manage).toContain('transform: `translate3d(${on ? 18 : 0}px,0,0)`');
    expect(manage).toContain('transitionOf("small", ["transform"], reduced)');
    expect(manage).not.toMatch(/left: on \?/);
  });

  it("the console's sheet and scrim have no hard-coded Money timing", () => {
    expect(kit).not.toMatch(/\b(450|300)ms/);
    expect(manage).not.toMatch(/\b150ms/);
  });
});
