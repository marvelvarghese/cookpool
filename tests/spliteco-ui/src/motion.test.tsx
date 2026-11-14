/**
 * @jest-environment jsdom
 */
// money-native MY-22: motion. One set of timings, the sliding switch, pages that swap and slide,
// sheets, rows, amounts, and reduced motion.

import { jest } from "@jest/globals";
import * as React from "react";
import { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { MoneySwitch, resetMoneySwitchMemory, type MoneySide } from "@saas/spliteco-ui/groups-ui";
import { MOTION, MOTION_CSS, durationOf, enterTransform, leaveTransform, pillOffset, sideDirection, transitionOf, tween } from "@saas/spliteco-ui/motion";
import { Amount, Collapse, MotionSheet, MotionSwap, PresenceList } from "@saas/spliteco-ui/motion-ui";
import { EXPAND_MS } from "@saas/spliteco-ui/expand-button";
import { BOARD } from "@saas/spliteco-ui/board";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduce && q.includes("prefers-reduced-motion"), media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
const render = (node: React.ReactNode) => act(() => { root.render(node); });
const frames = (n = 3) => { for (let i = 0; i < n; i++) act(() => { jest.advanceTimersByTime(17); }); };

beforeEach(() => {
  jest.useFakeTimers();
  mockReducedMotion(false);
  resetMoneySwitchMemory();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  jest.useRealTimers();
});

describe("the tokens", () => {
  it("are the ExpandButton's: .45s on cubic-bezier(.2,.8,.2,1), fades .25s, small .15s", () => {
    expect(MOTION.ease).toBe("cubic-bezier(.2,.8,.2,1)");
    expect(MOTION.geometryMs).toBe(450);
    expect(MOTION.fadeMs).toBe(250);
    expect(MOTION.smallMs).toBe(150);
    expect(MOTION.dimMs).toBe(300);
    expect(EXPAND_MS).toBe(MOTION.geometryMs);
    expect(MOTION.driftPx).toBeGreaterThanOrEqual(8);
    expect(MOTION.driftPx).toBeLessThanOrEqual(12);
    expect(MOTION.shiftPct).toBe(20);
  });
  it("transitionOf draws geometry on the curve, fades and small on ease, and reduced motion keeps only a .15s fade", () => {
    expect(transitionOf("geometry", ["transform"])).toBe("transform 450ms cubic-bezier(.2,.8,.2,1)");
    expect(transitionOf("fade", ["opacity"])).toBe("opacity 250ms ease");
    expect(transitionOf("small", ["transform"])).toBe("transform 150ms ease");
    expect(transitionOf("geometry", ["transform", "opacity"], true)).toBe("opacity 150ms ease");
    expect(transitionOf("geometry", ["transform"], true)).toBe("none");
    expect(durationOf("geometry", true)).toBe(150);
  });
  it("the shared CSS presses to .98 for .15s and, under reduced motion, tints instead of scaling", () => {
    expect(MOTION_CSS).toContain(":active{transform:scale(0.98)}");
    expect(MOTION_CSS).toContain("transform 150ms ease");
    const reduced = MOTION_CSS.slice(MOTION_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("transform:none;opacity:.7");
  });
  it("no page or primitive hard-codes a duration or the curve: they read the tokens", () => {
    for (const f of ["groups-ui.tsx", "motion-ui.tsx", "people-ui.tsx"]) {
      const src = readFileSync(new URL(`../../../packages/spliteco-ui/src/${f}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/cubic-bezier\(/);
      expect(src).not.toMatch(/\b(450|250|300)\s*(ms|\))/);
    }
  });
  it("tween eases out and lands on the target", () => {
    expect(tween(0, 100, 0)).toBe(0);
    expect(tween(0, 100, 1)).toBe(100);
    expect(tween(0, 100, 0.5)).toBeGreaterThan(50);
    expect(tween(100, 0, 2)).toBe(0);
  });
  it("directions: Groups to People is forward, People to Groups back; enter and leave mirror", () => {
    expect(sideDirection("groups", "people")).toBe(1);
    expect(sideDirection("people", "groups")).toBe(-1);
    expect(enterTransform("drift", 1)).toBe("translate3d(10px,0,0)");
    expect(leaveTransform("drift", 1)).toBe("translate3d(-10px,0,0)");
    expect(enterTransform("drift", -1)).toBe("translate3d(-10px,0,0)");
    expect(enterTransform("slide", 1)).toBe("translate3d(100%,0,0)");
    expect(leaveTransform("slide", 1)).toBe("translate3d(-20%,0,0)");
    expect(enterTransform("slide", -1)).toBe("translate3d(-20%,0,0)");
    expect(leaveTransform("slide", -1)).toBe("translate3d(100%,0,0)");
    expect(enterTransform("rise", 1)).toBe("translate3d(0,100%,0)");
  });
});

describe("the Groups | People switch", () => {
  const travel = BOARD.switch.foldedWidth + BOARD.switch.gap;
  const pill = () => host.querySelector<HTMLElement>("[data-switch-pill]")!;
  const sw = () => host.querySelector<HTMLElement>("[data-switch]")!;
  const Switch = ({ side, reduce }: { side: MoneySide; reduce?: boolean }) => <MoneySwitch side={side} onSide={() => undefined} {...(reduce === undefined ? {} : { reduceMotion: reduce })} />;

  it("the pill is one element that moves: transform from 0 to the folded tab's width plus the gap, on the geometry curve", () => {
    render(<Switch side="groups" />);
    frames();
    expect(pill().style.transform).toBe("translate3d(0px,0,0)");
    expect(pill().style.transition).toBe("transform 450ms cubic-bezier(.2,.8,.2,1)");
    render(<Switch side="people" />);
    frames();
    expect(pill().style.transform).toBe(`translate3d(${travel}px,0,0)`);
    expect(sw().dataset.direction).toBe("forward");
    expect(pillOffset("people", travel)).toBe(travel);
  });

  it("going back moves it back and says so", () => {
    render(<Switch side="people" />);
    frames();
    render(<Switch side="groups" />);
    frames();
    expect(pill().style.transform).toBe("translate3d(0px,0,0)");
    expect(sw().dataset.direction).toBe("back");
  });

  it("a switch mounted anew (each side is its own page) starts where the last one was and then slides", () => {
    render(<Switch side="groups" />);
    frames();
    act(() => root.unmount());
    root = createRoot(host);
    render(<Switch side="people" />);
    expect(pill().style.transform).toBe("translate3d(0px,0,0)"); // first paint: where it was
    frames();
    expect(pill().style.transform).toBe(`translate3d(${travel}px,0,0)`);
  });

  it("the label cross-fades: both labels stay in the DOM, one at opacity 1 and the other at 0", () => {
    render(<Switch side="groups" />);
    const labels = Array.from(host.querySelectorAll<HTMLElement>("[data-label]"));
    expect(labels.map((l) => l.style.opacity)).toEqual(["1", "0"]);
    expect(labels[0]!.style.transition).toContain("opacity 250ms ease");
    render(<Switch side="people" />);
    expect(Array.from(host.querySelectorAll<HTMLElement>("[data-label]")).map((l) => l.style.opacity)).toEqual(["0", "1"]);
  });

  it("reduced motion: the pill does not travel, it fades; nothing animates a transform", () => {
    render(<Switch side="groups" reduce />);
    expect(pill().style.transition).toBe("opacity 150ms ease");
    expect(sw().querySelector<HTMLElement>("button")!.style.transition).toBe("none");
  });

  it("follows the prefers-reduced-motion setting when not forced", () => {
    mockReducedMotion(true);
    render(<Switch side="groups" />);
    expect(pill().style.transition).toBe("opacity 150ms ease");
  });
});

describe("MotionSwap", () => {
  const swap = (k: string, props: Partial<React.ComponentProps<typeof MotionSwap>> = {}) => (
    <MotionSwap k={k} mode="drift" {...props}><p data-page={k}>{k}</p></MotionSwap>
  );
  const layer = (k: string) => host.querySelector<HTMLElement>(`[data-layer="${k}"]`);

  it("shows one page at rest", () => {
    render(swap("groups"));
    expect(host.querySelectorAll("[data-layer]")).toHaveLength(1);
    expect(layer("groups")!.dataset.role).toBe("current");
    expect(layer("groups")!.style.transform).toBe("none");
  });

  it("forward: the old page drifts left and fades while the new one drifts in from the right; the old takes no taps", () => {
    render(swap("groups"));
    render(swap("people", { direction: 1 }));
    expect(layer("groups")!.dataset.role).toBe("leaving");
    expect(layer("groups")!.style.pointerEvents).toBe("none");
    expect(layer("groups")!.getAttribute("aria-hidden")).toBe("true");
    expect(layer("groups")!.style.transform).toBe("translate3d(-10px,0,0)");
    expect(layer("groups")!.style.opacity).toBe("0");
    expect(layer("people")!.dataset.at).toBe("from");
    expect(layer("people")!.style.transform).toBe("translate3d(10px,0,0)");
    expect(layer("people")!.style.opacity).toBe("0");
    frames();
    expect(layer("people")!.dataset.at).toBe("rest");
    expect(layer("people")!.style.transform).toBe("none");
    expect(layer("people")!.style.opacity).toBe("1");
    expect(layer("people")!.style.transition).toContain("transform 450ms cubic-bezier(.2,.8,.2,1)");
    expect(layer("people")!.style.transition).toContain("opacity 250ms ease");
  });

  it("back drifts the other way", () => {
    render(swap("people"));
    render(swap("groups", { direction: -1 }));
    expect(layer("people")!.style.transform).toBe("translate3d(10px,0,0)");
    expect(layer("groups")!.style.transform).toBe("translate3d(-10px,0,0)");
  });

  it("the old page goes once the change has settled", () => {
    render(swap("groups"));
    render(swap("people"));
    expect(host.querySelector("[data-motion-swap]")!.getAttribute("data-busy")).toBe("true");
    act(() => { jest.advanceTimersByTime(MOTION.fadeMs + 100); });
    expect(layer("groups")).toBeNull();
    expect(host.querySelector("[data-motion-swap]")!.getAttribute("data-busy")).toBe("false");
  });

  it("interruptible: asking for the old page again mid-flight reuses its layer (the transition turns round) and never blocks", () => {
    render(swap("groups"));
    render(swap("people", { direction: 1 }));
    frames(1);
    const before = layer("groups")!;
    render(swap("groups", { direction: -1 }));
    expect(layer("groups")).toBe(before); // same DOM node: its CSS transition reverses from where it is
    expect(layer("groups")!.dataset.role).toBe("current");
    expect(layer("groups")!.style.pointerEvents).not.toBe("none");
    expect(layer("people")!.dataset.role).toBe("leaving");
    act(() => { jest.advanceTimersByTime(MOTION.geometryMs + 100); });
    expect(layer("people")).toBeNull();
    expect(layer("groups")!.dataset.role).toBe("current");
  });

  it("slide forward: the new page comes from the right, the old shifts left 20% and dims", () => {
    render(swap("list"));
    render(<MotionSwap k="page" mode="slide" direction={1}><p>page</p></MotionSwap>);
    expect(layer("list")!.style.transform).toBe("translate3d(-20%,0,0)");
    expect(layer("list")!.querySelector<HTMLElement>("[data-layer-dim]")!.style.opacity).toBe("1");
    expect(layer("page")!.style.transform).toBe("translate3d(100%,0,0)");
    frames();
    expect(layer("page")!.style.transform).toBe("none");
  });

  it("slide back: the page slides off to the right and the one under returns from 20% left, dimmed, undimming", () => {
    const slide = (k: string, direction: 1 | -1) => <MotionSwap k={k} mode="slide" direction={direction}><p>{k}</p></MotionSwap>;
    render(slide("page", 1));
    render(slide("list", -1));
    expect(layer("page")!.style.transform).toBe("translate3d(100%,0,0)");
    expect(layer("list")!.style.transform).toBe("translate3d(-20%,0,0)");
    expect(layer("list")!.querySelector<HTMLElement>("[data-layer-dim]")!.style.opacity).toBe("1");
    frames();
    expect(layer("list")!.style.transform).toBe("none");
    expect(layer("list")!.querySelector<HTMLElement>("[data-layer-dim]")!.style.opacity).toBe("0");
  });

  it("reduced motion: no transform at all, a plain .15s fade, gone after .15s", () => {
    render(swap("groups", { reduceMotion: true }));
    render(swap("people", { reduceMotion: true }));
    expect(layer("groups")!.style.transform).toBe("none");
    expect(layer("people")!.style.transform).toBe("none");
    expect(layer("people")!.style.transition).toBe("opacity 150ms ease");
    act(() => { jest.advanceTimersByTime(MOTION.reducedMs + 40); });
    expect(layer("groups")).toBeNull();
  });
});

describe("MotionSheet", () => {
  const sheet = (open: boolean, reduce?: boolean) => (
    <MotionSheet open={open} label="Add group" {...(reduce === undefined ? {} : { reduceMotion: reduce })}><button type="button">Save</button></MotionSheet>
  );
  const panel = () => host.querySelector<HTMLElement>("[data-sheet-panel]");
  const dim = () => host.querySelector<HTMLElement>("[data-sheet-dim]");

  it("is not there when closed; opening mounts it below the screen and then slides it up while the dim fades in", () => {
    render(sheet(false));
    expect(panel()).toBeNull();
    render(sheet(true));
    expect(panel()!.style.transform).toBe("translate3d(0,100%,0)");
    expect(dim()!.style.opacity).toBe("0");
    frames();
    expect(panel()!.style.transform).toBe("none");
    expect(panel()!.style.transition).toBe("transform 450ms cubic-bezier(.2,.8,.2,1)");
    expect(dim()!.style.opacity).toBe("1");
    expect(dim()!.style.transition).toBe("opacity 300ms ease");
  });

  it("closing slides it down, keeps it mounted until it is out, then removes it", () => {
    render(sheet(true));
    frames();
    render(sheet(false));
    expect(panel()!.style.transform).toBe("translate3d(0,100%,0)");
    expect(dim()!.style.opacity).toBe("0");
    act(() => { jest.advanceTimersByTime(MOTION.geometryMs + 100); });
    expect(panel()).toBeNull();
  });

  it("interruptible: reopening mid-close turns it round and it stays", () => {
    render(sheet(true));
    frames();
    render(sheet(false));
    act(() => { jest.advanceTimersByTime(200); });
    render(sheet(true));
    act(() => { jest.advanceTimersByTime(MOTION.geometryMs + 100); });
    expect(panel()).not.toBeNull();
    expect(panel()!.style.transform).toBe("none");
  });

  it("tapping the dim closes it", () => {
    const onClose = jest.fn();
    render(<MotionSheet open label="Add group" onClose={onClose}>x</MotionSheet>);
    frames();
    act(() => { dim()!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reduced motion: the panel does not travel; it fades in .15s", () => {
    render(sheet(true, true));
    frames();
    expect(panel()!.style.transform).toBe("none");
    expect(panel()!.style.transition).toBe("opacity 150ms ease");
    expect(dim()!.style.transition).toBe("opacity 150ms ease");
  });
});

describe("rows and amounts", () => {
  it("Collapse eases a row's height as a grid track and fades it", () => {
    render(<Collapse open enter><i>row</i></Collapse>);
    const el = () => host.querySelector<HTMLElement>("[data-collapse]")!;
    expect(el().style.gridTemplateRows).toBe("0fr");
    frames();
    expect(el().style.gridTemplateRows).toBe("1fr");
    expect(el().style.transition).toContain("grid-template-rows 450ms cubic-bezier(.2,.8,.2,1)");
    render(<Collapse open={false}><i>row</i></Collapse>);
    expect(el().style.gridTemplateRows).toBe("0fr");
    expect(el().style.opacity).toBe("0");
  });

  it("PresenceList: an added row eases in, a removed row stays until it has eased out", () => {
    const list = (ids: string[]) => <PresenceList items={ids} getKey={(i) => i} render={(i) => <b data-row={i}>{i}</b>} />;
    render(list(["a", "b"]));
    expect(host.querySelectorAll("[data-collapse=open]")).toHaveLength(2);
    render(list(["a", "b", "c"]));
    expect(host.querySelector("[data-row=c]")!.parentElement!.parentElement!.dataset.collapse).toBe("closed");
    frames();
    expect(host.querySelector("[data-row=c]")!.parentElement!.parentElement!.dataset.collapse).toBe("open");
    render(list(["a", "c"]));
    expect(host.querySelector("[data-row=b]")!.parentElement!.parentElement!.dataset.collapse).toBe("closed");
    act(() => { jest.advanceTimersByTime(MOTION.geometryMs + 100); });
    expect(host.querySelector("[data-row=b]")).toBeNull();
    expect(host.querySelector("[data-row=a]")).not.toBeNull();
  });

  it("Amount counts to the new value over the geometry time and lands on it; reduced motion is instant", () => {
    const raf = jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
    const fmt = (n: number) => `₹${n}`;
    render(<Amount value={0} format={fmt} />);
    render(<Amount value={1000} format={fmt} />);
    act(() => { jest.advanceTimersByTime(100); });
    const mid = Number(host.textContent!.replace("₹", ""));
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1000);
    act(() => { jest.advanceTimersByTime(MOTION.geometryMs + 100); });
    expect(host.textContent).toBe("₹1000");
    render(<Amount value={5} format={fmt} reduceMotion />);
    expect(host.textContent).toBe("₹5");
    raf.mockRestore();
  });
});
