import { DECIDE_PX, listenForDrags, type DragEnd, type ElementLike, type StyleOf } from "@web-console-next/lib/gestures";
import {
  NO_TAB_SWIPE,
  TAB_SWIPE_EDGE_PX,
  TAB_SWIPE_MAX_PX,
  TAB_SWIPE_ORDER,
  TAB_SWIPE_PX,
  TAB_SWIPE_RATIO,
  isSideways,
  neighbourTab,
  refusesTabSwipe,
  tabSwipeClaims,
  tabSwipeDirection,
  tabSwipeOffset,
  tabSwipeOn,
  tabSwipeRelease,
  tabSwipeRule,
  tabSwipeTarget,
} from "@web-console-next/components/kitchen/tab-swipe";
import { NEW_FRAME_TABS } from "@web-console-next/components/kitchen/nav";

// cookpool-revamp RV-9: a sideways swipe on a tab's root goes to the tab beside it.

const PHONE = { newFrame: true, width: 390 };

describe("where the tabs swipe", () => {
  it("follows the tab bar's order: Home, Kitchen, Cook, Money, You", () => {
    expect(TAB_SWIPE_ORDER).toEqual(["/home", "/pantry", "/cook", "/money", "/you"]);
    expect(NEW_FRAME_TABS.map((t) => t.label)).toEqual(["Home", "Kitchen", "Cook", "Money", "You"]);
  });

  it("on the five tabs' roots only, in the new frame, below 900 px", () => {
    for (const root of TAB_SWIPE_ORDER) expect([root, tabSwipeOn(root, PHONE)]).toEqual([root, true]);
    expect(tabSwipeOn("/pantry/", PHONE)).toBe(true);
    expect(tabSwipeOn("/pantry?pantry=personal", PHONE)).toBe(true);
    for (const sub of ["/pantry/new", "/pantry/me:itm_1", "/cook/session", "/recipes/rcp_1", "/you/settings", "/money/x", "/groups", "/people", "/login", "/"]) {
      expect([sub, tabSwipeOn(sub, PHONE)]).toEqual([sub, false]);
    }
    expect(tabSwipeOn("/home", { newFrame: false, width: 390 })).toBe(false);
    expect(tabSwipeOn("/home", { newFrame: true, width: 900 })).toBe(false);
    expect(tabSwipeOn("/home", { newFrame: true, width: 899 })).toBe(true);
    expect(tabSwipeOn(null, PHONE)).toBe(false);
  });

  it("left goes to the next tab, right to the previous, and nothing past either end", () => {
    expect(tabSwipeDirection(-80)).toBe("next");
    expect(tabSwipeDirection(80)).toBe("prev");
    expect(tabSwipeDirection(0)).toBeNull();
    expect(neighbourTab("/home", "next")).toBe("/pantry");
    expect(neighbourTab("/pantry", "next")).toBe("/cook");
    expect(neighbourTab("/cook", "prev")).toBe("/pantry");
    expect(neighbourTab("/money", "next")).toBe("/you");
    expect(neighbourTab("/home", "prev")).toBeNull();
    expect(neighbourTab("/you", "next")).toBeNull();
    expect(neighbourTab("/recipes/rcp_1", "next")).toBeNull();
    expect(tabSwipeTarget("/home", -100)).toBe("/pantry");
    expect(tabSwipeTarget("/home", 100)).toBeNull();
    expect(tabSwipeTarget("/you", 100)).toBe("/money");
  });
});

describe("the numbers", () => {
  it("64 px to go, 1.6 times as sideways as up or down, 24 px from the edges", () => {
    expect(TAB_SWIPE_PX).toBe(64);
    expect(TAB_SWIPE_RATIO).toBe(1.6);
    expect(TAB_SWIPE_EDGE_PX).toBe(24);
  });

  it("sideways means |dx| over 1.6 × |dy|", () => {
    expect(isSideways(17, 10)).toBe(true);
    expect(isSideways(16, 10)).toBe(false);
    expect(isSideways(-40, 20)).toBe(true);
    expect(isSideways(-30, 20)).toBe(false);
    expect(isSideways(0, 0)).toBe(false);
  });

  it("decides only once the finger has gone DECIDE_PX, and only toward a tab that is there", () => {
    expect(tabSwipeClaims("/cook", -(DECIDE_PX - 1), 0)).toBe(false); // too soon to say
    expect(tabSwipeClaims("/cook", -DECIDE_PX, 0)).toBe(true);
    expect(tabSwipeClaims("/cook", DECIDE_PX, 0)).toBe(true);
    expect(tabSwipeClaims("/cook", -12, 10)).toBe(false); // too vertical: a scroll
    expect(tabSwipeClaims("/home", 30, 0)).toBe(false); // nothing before Home
    expect(tabSwipeClaims("/you", -30, 0)).toBe(false); // nothing after You
  });

  it("the page follows a share of the finger, at most 72 px, and not toward an end", () => {
    expect(tabSwipeOffset("/cook", -100)).toBe(-30);
    expect(tabSwipeOffset("/cook", 40)).toBe(12);
    expect(tabSwipeOffset("/cook", -1000)).toBe(-TAB_SWIPE_MAX_PX);
    expect(tabSwipeOffset("/home", 100)).toBe(0);
  });

  it("letting go past 64 px goes there, with its direction; short of it, nowhere", () => {
    expect(tabSwipeRelease("/cook", -64)).toEqual({ href: "/money", direction: "next" });
    expect(tabSwipeRelease("/cook", 90)).toEqual({ href: "/pantry", direction: "prev" });
    expect(tabSwipeRelease("/cook", -63)).toBeNull();
    expect(tabSwipeRelease("/home", 200)).toBeNull();
    expect(tabSwipeRelease("/you", -200)).toBeNull();
  });
});

// ── Fake elements: just what the rules read ─────────────────────────

interface FakeEl extends ElementLike {
  name: string;
  parentElement: FakeEl | null;
  overflowX: string;
  overflowY: string;
  /** The selectors it matches (by the part of NO_TAB_SWIPE or OWN_DRAGS it stands for). */
  is: string[];
}

function el(name: string, parent: FakeEl | null, over: Partial<FakeEl> = {}): FakeEl {
  const e: FakeEl = {
    name,
    parentElement: parent,
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 100,
    scrollWidth: 100,
    clientHeight: 100,
    clientWidth: 100,
    overflowX: "visible",
    overflowY: "visible",
    is: [],
    closest(selector: string) {
      const parts = selector.split(",").map((s) => s.trim());
      for (let at: FakeEl | null = e; at; at = at.parentElement) if (at.is.some((s) => parts.includes(s))) return at;
      return null;
    },
    ...over,
  };
  return e;
}

const styleOf: StyleOf = (e) => ({ overflowX: (e as FakeEl).overflowX, overflowY: (e as FakeEl).overflowY });

describe("the touches it never takes", () => {
  const main = el("main", null, { overflowY: "auto", scrollHeight: 2000, clientHeight: 800 });
  const card = el("card", main);
  const ctx = { pathname: "/cook", width: 390, sheetOpen: false };
  const at = (x: number) => ({ x, y: 400, t: 0 });

  it("takes a sideways drag on the page's content", () => {
    expect(tabSwipeRule(at(200), card, main, ctx, styleOf)?.(-40, 4)).toBe(true);
    expect(tabSwipeRule(at(200), card, main, ctx, styleOf)?.(4, 40)).toBe(false); // vertical: the scroll stays the browser's
  });

  it("never from within 24 px of either edge (iOS's back swipe)", () => {
    expect(tabSwipeRule(at(TAB_SWIPE_EDGE_PX - 1), card, main, ctx, styleOf)).toBeNull();
    expect(tabSwipeRule(at(390 - TAB_SWIPE_EDGE_PX + 1), card, main, ctx, styleOf)).toBeNull();
    expect(tabSwipeRule(at(TAB_SWIPE_EDGE_PX), card, main, ctx, styleOf)).not.toBeNull();
  });

  it("never on what scrolls sideways (Cook now's cards, chips), only while it does", () => {
    const strip = el("cook-now", main, { overflowX: "auto", scrollWidth: 900, clientWidth: 358 });
    const tile = el("tile", strip);
    expect(tabSwipeRule(at(200), tile, main, ctx, styleOf)).toBeNull();
    const fits = el("chips", main, { overflowX: "auto", scrollWidth: 300, clientWidth: 358 });
    expect(tabSwipeRule(at(200), el("chip", fits), main, ctx, styleOf)).not.toBeNull();
  });

  it("never on a swipe row, a field, a slider, a tab strip, a dialog, the bars, or data-no-tab-swipe", () => {
    const refused = [
      "[data-swipe-row]",
      "input",
      "textarea",
      "select",
      '[contenteditable="true"]',
      'input[type="range"]',
      '[role="slider"]',
      '[role="tablist"]',
      '[role="dialog"]',
      "[data-vt-keep]",
      "[data-no-tab-swipe]",
    ];
    for (const sel of refused) {
      const holder = el("holder", main, { is: [sel] });
      const inner = el("inner", holder);
      expect([sel, tabSwipeRule(at(200), inner, main, ctx, styleOf)]).toEqual([sel, null]);
      expect([sel, refusesTabSwipe(inner)]).toEqual([sel, true]);
    }
    expect(refusesTabSwipe(card)).toBe(false);
    expect(refusesTabSwipe(null)).toBe(false);
    expect(NO_TAB_SWIPE).toContain("[data-no-tab-swipe]");
    expect(NO_TAB_SWIPE).toContain("[data-swipe-row]");
  });

  it("never while a sheet or dialog is open", () => {
    expect(tabSwipeRule(at(200), card, main, { ...ctx, sheetOpen: true }, styleOf)).toBeNull();
  });
});

describe("with the finger (synthetic touch events)", () => {
  type Finger = { identifier: number; clientX: number; clientY: number };
  const finger = (x: number, y: number): Finger => ({ identifier: 1, clientX: x, clientY: y });
  function touch(type: string, touches: Finger[], changed: Finger[] = touches): Event {
    const e = new Event(type, { cancelable: type !== "touchcancel" });
    Object.defineProperties(e, { touches: { value: touches }, changedTouches: { value: changed }, target: { value: card } });
    return e;
  }
  const main = el("main", null);
  const card = el("card", main);

  function swipe(pathname: string, x: number, steps: Array<[number, number]>) {
    const surface = new EventTarget();
    let clock = 0;
    const moves: number[][] = [];
    const ends: DragEnd[] = [];
    const stop = listenForDrags(
      surface,
      {
        begin: (start, target) => tabSwipeRule(start, target, main, { pathname, width: 390, sheetOpen: false }, styleOf),
        move: (dx, dy) => void moves.push([dx, dy]),
        end: (end) => void ends.push(end),
      },
      () => clock,
    );
    const y = 400;
    clock = 0;
    surface.dispatchEvent(touch("touchstart", [finger(x, y)]));
    const sent = steps.map(([dx, dy], i) => {
      clock = 16 * (i + 1);
      const e = touch("touchmove", [finger(x + dx, y + dy)]);
      surface.dispatchEvent(e);
      return e;
    });
    const last = steps[steps.length - 1] ?? [0, 0];
    clock += 16;
    surface.dispatchEvent(touch("touchend", [], [finger(x + last[0], y + last[1])]));
    stop();
    const release = ends[0] ? tabSwipeRelease(pathname, ends[0].dx) : null;
    return { prevented: sent.map((e) => e.defaultPrevented), moves, release };
  }

  it("a swipe left on Kitchen opens Cook; no move is cancelled before it is known to be sideways", () => {
    const s = swipe("/pantry", 300, [[-3, 0], [-6, 1], [-12, 1], [-40, 3], [-90, 4]]);
    expect(s.prevented).toEqual([false, false, true, true, true]);
    expect(s.release).toEqual({ href: "/cook", direction: "next" });
  });

  it("a vertical scroll is never touched", () => {
    const s = swipe("/pantry", 200, [[0, -4], [1, -12], [2, -60], [3, -200]]);
    expect(s.prevented.some(Boolean)).toBe(false);
    expect(s.moves).toEqual([]);
    expect(s.release).toBeNull();
  });

  it("a diagonal drag that isn't sideways enough stays a scroll", () => {
    const s = swipe("/cook", 200, [[-6, -5], [-14, -10], [-60, -40]]);
    expect(s.prevented.some(Boolean)).toBe(false);
    expect(s.release).toBeNull();
  });

  it("a short swipe springs back", () => {
    const s = swipe("/cook", 200, [[10, 0], [30, 2], [50, 2]]);
    expect(s.moves.length).toBeGreaterThan(0);
    expect(s.release).toBeNull();
  });

  it("from the screen's edge, nothing", () => {
    const s = swipe("/cook", 10, [[20, 0], [80, 0], [160, 0]]);
    expect(s.prevented.some(Boolean)).toBe(false);
    expect(s.release).toBeNull();
  });
});
