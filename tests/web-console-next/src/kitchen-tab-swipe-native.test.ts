import * as React from "react";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { renderToStaticMarkup } from "react-dom/server";
// The context `usePathname()` reads, so the tab bar can be rendered on a page.
import { PathnameContext } from "@web-console-next/../node_modules/next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import { KitchenTabBar } from "@web-console-next/components/kitchen/tab-bar";
import {
  TAB_SPRING_MAX_MS,
  TAB_SPRING_OMEGA,
  TAB_SWIPE_FRACTION,
  barDirection,
  barTabAt,
  rubberBand,
  springAt,
  springFrame,
  tabSwipeOffset,
  tabSwipeRelease,
} from "@web-console-next/components/kitchen/tab-swipe";

// cookpool-revamp RV-12: the tab swipe feels native — one to one, decided by
// distance or a flick, settled by a critically damped spring, rubber-banded
// past the ends — and sliding along the tab bar moves between tabs.

const W = 390;

describe("the release: distance or velocity", () => {
  it("goes past 35% of the width, whatever the speed (short of a flick back)", () => {
    expect(TAB_SWIPE_FRACTION).toBe(0.35);
    expect(tabSwipeRelease("/pantry", -W * 0.35, 0, W)).toEqual({ href: "/cook", direction: "next" });
    expect(tabSwipeRelease("/pantry", -W * 0.35 + 1, 0, W)).toBeNull();
    expect(tabSwipeRelease("/pantry", W * 0.5, 0.2, W)).toEqual({ href: "/home", direction: "prev" });
  });

  it("a quick flick toward the tab beside goes, from 24 px on", () => {
    expect(tabSwipeRelease("/pantry", -30, -0.5, W)).toEqual({ href: "/cook", direction: "next" });
    expect(tabSwipeRelease("/pantry", 30, 0.8, W)).toEqual({ href: "/home", direction: "prev" });
    expect(tabSwipeRelease("/pantry", -30, -0.49, W)).toBeNull(); // not quite a flick
    expect(tabSwipeRelease("/pantry", -20, -2, W)).toBeNull(); // too short to be one
  });

  it("a flick back cancels even past the distance", () => {
    expect(tabSwipeRelease("/pantry", -250, 0.6, W)).toBeNull();
    expect(tabSwipeRelease("/pantry", 250, -0.6, W)).toBeNull();
    expect(tabSwipeRelease("/pantry", -250, 0.3, W)).toEqual({ href: "/cook", direction: "next" }); // drifting back slowly still goes
  });

  it("never past the first or last tab", () => {
    expect(tabSwipeRelease("/home", 300, 2, W)).toBeNull();
    expect(tabSwipeRelease("/you", -300, -2, W)).toBeNull();
    expect(tabSwipeRelease("/cook", 0, 2, W)).toBeNull();
  });
});

describe("rubber band past the ends", () => {
  it("resists more the further it goes, and never reaches the finger", () => {
    const a = rubberBand(50, W);
    const b = rubberBand(150, W);
    const c = rubberBand(1000, W);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(50);
    expect((b - a) / 100).toBeLessThan(a / 50); // each px further gives less
    expect(c).toBeLessThan(W * 0.6);
    expect(rubberBand(-150, W)).toBeCloseTo(-b, 9);
    expect(rubberBand(0, W)).toBe(0);
  });

  it("applies only toward an end", () => {
    expect(tabSwipeOffset("/home", 120, W)).toBeCloseTo(rubberBand(120, W), 9);
    expect(tabSwipeOffset("/home", -120, W)).toBe(-120);
    expect(tabSwipeOffset("/you", -120, W)).toBeCloseTo(rubberBand(-120, W), 9);
  });
});

describe("the spring", () => {
  /** Runs the spring at 60 fps, as the page does: where it is each frame, and how long it took. */
  function run(d0: number, v0: number) {
    const frames: number[] = [];
    for (let t = 16; ; t += 16) {
      const f = springFrame(d0, v0, t);
      frames.push(f.d);
      if (f.done) return { frames, ms: t };
    }
  }

  it("is critically damped: d(t) = (d0 + (v0 + ω·d0)·t)·e^(−ωt), and its speed the derivative", () => {
    const w = TAB_SPRING_OMEGA;
    expect(springAt(100, 0, 0)).toEqual({ d: 100, v: 0 });
    const t = 50;
    expect(springAt(100, -1, t).d).toBeCloseTo((100 + (-1 + w * 100) * t) * Math.exp(-w * t), 9);
    const h = 1e-4;
    const slope = (springAt(100, -1, t + h).d - springAt(100, -1, t - h).d) / (2 * h);
    expect(springAt(100, -1, t).v).toBeCloseTo(slope, 5);
  });

  it("settles a full width from rest in about 300 ms, never bouncing back past where it goes", () => {
    const { frames, ms } = run(W, 0);
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThanOrEqual(350);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!).toBeGreaterThanOrEqual(0);
      expect(frames[i]!).toBeLessThanOrEqual(frames[i - 1]!);
    }
    expect(frames[frames.length - 1]).toBe(0);
  });

  it("a cancelled swipe springs back to 0 the same way, from either side", () => {
    const left = run(-100, 0);
    const right = run(100, 0);
    expect(left.ms).toBe(right.ms);
    expect(left.ms).toBeLessThanOrEqual(TAB_SPRING_MAX_MS);
    expect(left.frames.at(-1)).toBe(0);
  });

  it("starts at the finger's speed, so a flick carries on, and is done the moment it would pass", () => {
    // 300 px to go, moving toward it at 3 px/ms: the first frame moves farther than from rest.
    const flung = springFrame(300, -3, 16).d;
    const rest = springFrame(300, 0, 16).d;
    expect(flung).toBeLessThan(rest);
    // A fling so fast it would overshoot ends exactly there.
    const fast = run(20, -6);
    expect(fast.frames.at(-1)).toBe(0);
    expect(fast.frames.every((d) => d >= 0)).toBe(true);
  });

  it("never runs past its cap", () => {
    expect(springFrame(1e6, 0, TAB_SPRING_MAX_MS)).toEqual({ d: 0, done: true });
  });
});

describe("the tab bar's finger", () => {
  const bar = { left: 12, width: 366 };
  const pad = 6;

  it("maps the finger to the cell under it, in five equal cells inside the padding", () => {
    const cell = (366 - 12) / 5;
    expect(barTabAt(12 + pad + 1, bar, 5, pad)).toBe(0);
    expect(barTabAt(12 + pad + cell - 0.5, bar, 5, pad)).toBe(0);
    expect(barTabAt(12 + pad + cell + 0.5, bar, 5, pad)).toBe(1);
    expect(barTabAt(12 + pad + 2.5 * cell, bar, 5, pad)).toBe(2);
    expect(barTabAt(12 + pad + 4.99 * cell, bar, 5, pad)).toBe(4);
  });

  it("beyond either end it is the end's tab", () => {
    expect(barTabAt(0, bar, 5, pad)).toBe(0);
    expect(barTabAt(-50, bar, 5, pad)).toBe(0);
    expect(barTabAt(500, bar, 5, pad)).toBe(4);
    expect(barTabAt(100, bar, 0, pad)).toBe(-1);
  });

  it("slides the page the way the highlight went", () => {
    expect(barDirection(1, 3)).toBe("next");
    expect(barDirection(3, 0)).toBe("prev");
    expect(barDirection(2, 2)).toBeNull();
    expect(barDirection(-1, 2)).toBeNull();
  });

  it("at rest is exactly RV-2's bar: the current tab filled, no gliding highlight; its drags are its own", () => {
    const html = renderToStaticMarkup(
      React.createElement(PathnameContext.Provider, { value: "/cook" }, React.createElement(KitchenTabBar, { onAdd: () => undefined, addOpen: false, newFrame: true })),
    );
    expect(html).not.toContain("data-tab-highlight");
    const nav = html.match(/<nav[^>]*>/)![0];
    expect(nav).toContain('data-gestures="off"');
    expect(nav).toContain('data-vt-keep="tabs"');
    const current = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]).filter((a) => a.includes('aria-current="page"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('href="/cook"');
    expect(current[0]).toContain("bg-primary text-primary-foreground");
  });

  it("ticks a light haptic at each crossing, only where vibrate exists and never with reduced motion", () => {
    const src = readFileSync(`${cwd()}/../../apps/web-console-next/src/components/kitchen/tab-bar.tsx`, "utf8");
    expect(src).toMatch(/if \(prefersReducedMotion\(\)\) return;/);
    expect(src).toMatch(/typeof navigator\.vibrate === "function"\) navigator\.vibrate\(8\)/);
    expect(src).toContain("listenForDrags(el,");
  });
});
