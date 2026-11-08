import {
  DECIDE_PX,
  EDGE_PX,
  PULL_MAX_PX,
  PULL_THRESHOLD_PX,
  SHEET_CLOSE_PX,
  atStart,
  createDrag,
  edgeSwipeGoesBack,
  edgeSwipeRule,
  hasOwnDrags,
  isDownward,
  isFlick,
  isRightward,
  listenForDrags,
  pullDistance,
  pullRefreshes,
  pullRule,
  scrollersBetween,
  sheetDragCloses,
  sheetDragRule,
  type DragEnd,
  type ElementLike,
  type StyleOf,
} from "@web-console-next/lib/gestures";
import { PULL_PAGES, edgeSwipeBackOn, edgeSwipeDevice, pullsToRefresh, type EdgeSwipeEnv } from "@web-console-next/components/kitchen/gestures";
import { SCREENS_WITH_PARENT, TAB_PAGES } from "@web-console-next/components/kitchen/back";
import { STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";

// cookpool-app PW-7: pull to refresh, the installed iPhone's edge swipe back,
// and bottom sheets that drag away.

describe("which screens pull to refresh", () => {
  // The forms, and the pages that are not lists; the frame's outside pages never mount it.
  const NO_PULL = [
    "/",
    "/login",
    "/auth/callback",
    "/use",
    "/cook",
    "/settle",
    "/you",
    "/you/settings",
    "/you/notifications",
    "/pantry/new",
    "/pantry/:itemRef",
    "/groups/:orgSlug/expense",
    "/groups/:orgSlug/settings",
    "/join/:code",
    // The recipe screens (cookpool-recipes RC-5): a recipe's steppers, and its two forms.
    "/recipes/new",
    "/recipes/:recipeId",
    "/recipes/:recipeId/edit",
  ];

  it("decides for every page: a new page must choose", () => {
    expect([...PULL_PAGES, ...NO_PULL].sort()).toEqual([...STATIC_PAGES].sort());
    expect(PULL_PAGES).toEqual(["/home", "/pantry", "/groups", "/groups/:orgSlug", "/people", "/people/:subjectId", "/dishes/:dishRef", "/money"]);
  });

  it.each([
    ["/home", true],
    ["/pantry", true],
    ["/groups", true],
    ["/groups/", true],
    ["/groups/flat-4b-k3x9", true],
    ["/people", true],
    ["/people/usr_00000000000000000000000000003f9a", true],
    ["/dishes/dsh_1", true],
    // Not the forms: Use, Bought, Cook, Add a bill, Settings.
    ["/use", false],
    ["/pantry/new", false],
    ["/cook", false],
    ["/groups/flat-4b-k3x9/expense", false],
    ["/groups/flat-4b-k3x9/settings", false],
    // Nor You, an item, a join link, or what is not a page.
    ["/you", false],
    ["/pantry/me:itm_abc123", false],
    ["/join/KTCH2345", false],
    ["/nowhere", false],
    ["", false],
    [null, false],
  ])("%s → %s", (path, pulls) => {
    expect(pullsToRefresh(path)).toBe(pulls);
  });
});

describe("the pull's numbers", () => {
  it("follows the finger at half speed, never above the top, at most PULL_MAX_PX", () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-40)).toBe(0);
    expect(pullDistance(Number.NaN)).toBe(0);
    expect(pullDistance(10)).toBe(5);
    expect(pullDistance(128)).toBe(64);
    expect(pullDistance(1000)).toBe(PULL_MAX_PX);
    expect(PULL_MAX_PX).toBeGreaterThan(PULL_THRESHOLD_PX);
  });

  it("refreshes from 64 px (a finger 128 px down); short of it, springs back", () => {
    expect(PULL_THRESHOLD_PX).toBe(64);
    expect(pullRefreshes(pullDistance(127))).toBe(false);
    expect(pullRefreshes(pullDistance(128))).toBe(true);
    expect(pullRefreshes(PULL_MAX_PX)).toBe(true);
    expect(pullRefreshes(0)).toBe(false);
  });
});

describe("the edge swipe's gate: installed on an iPhone, never on a tab", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
  const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  const MAC = IPAD_DESKTOP;
  const env = (userAgent: string, standalone: boolean, maxTouchPoints = 5): EdgeSwipeEnv => ({ userAgent, standalone, maxTouchPoints });

  it.each([
    ["the installed iPhone app", env(IPHONE, true), true],
    ["an installed iPad that asks for desktop sites", env(IPAD_DESKTOP, true, 5), true],
    ["iPhone Safari in the browser (it has its own swipe)", env(IPHONE, false), false],
    ["the installed Android app (Android has its own back)", env(ANDROID, true), false],
    ["Chrome on Android", env(ANDROID, false), false],
    ["a Mac (no touch)", env(MAC, true, 0), false],
  ])("%s", (_what, device, on) => {
    expect(edgeSwipeDevice(device)).toBe(on);
  });

  it("is on for every screen with a back control and off on the tabs", () => {
    const iphone = env(IPHONE, true);
    for (const tab of TAB_PAGES) expect(edgeSwipeBackOn(iphone, tab)).toBe(false);
    expect(edgeSwipeBackOn(iphone, "/groups/")).toBe(false);
    const examples: Record<string, string> = {
      "/pantry/:itemRef": "/pantry/me:itm_abc123",
      "/dishes/:dishRef": "/dishes/dsh_1",
      "/groups/:orgSlug": "/groups/flat-4b-k3x9",
      "/groups/:orgSlug/settings": "/groups/flat-4b-k3x9/settings",
      "/groups/:orgSlug/expense": "/groups/flat-4b-k3x9/expense",
      "/join/:code": "/join/KTCH2345",
      "/people/:subjectId": "/people/usr_1",
    };
    for (const page of SCREENS_WITH_PARENT) expect([page, edgeSwipeBackOn(iphone, examples[page] ?? page)]).toEqual([page, true]);
    expect(edgeSwipeBackOn(env(ANDROID, true), "/dishes/dsh_1")).toBe(false);
    expect(edgeSwipeBackOn(iphone, null)).toBe(false);
  });

  it("goes back past 30% of the width, or on a flick; never leftwards", () => {
    expect(edgeSwipeGoesBack(116, 390, 0)).toBe(false);
    expect(edgeSwipeGoesBack(117, 390, 0)).toBe(true);
    // A flick: fast, and far enough to be meant.
    expect(edgeSwipeGoesBack(40, 390, 0.8)).toBe(true);
    expect(edgeSwipeGoesBack(20, 390, 2)).toBe(false);
    expect(edgeSwipeGoesBack(40, 390, 0.3)).toBe(false);
    expect(edgeSwipeGoesBack(-200, 390, 1)).toBe(false);
  });
});

describe("the sheet's numbers", () => {
  it("closes past 80 px down, or on a flick down; otherwise springs back", () => {
    expect(SHEET_CLOSE_PX).toBe(80);
    expect(sheetDragCloses(79, 0)).toBe(false);
    expect(sheetDragCloses(80, 0)).toBe(true);
    expect(sheetDragCloses(30, 0.6)).toBe(true);
    expect(sheetDragCloses(30, -0.6)).toBe(false);
    expect(sheetDragCloses(-120, 1)).toBe(false);
    expect(isFlick(23, 5)).toBe(false);
  });
});

describe("directions", () => {
  it("a pull or a sheet's drag is down and more down than sideways; the edge swipe is right and more sideways", () => {
    expect(isDownward(3, 10)).toBe(true);
    expect(isDownward(10, 10)).toBe(false);
    expect(isDownward(0, -10)).toBe(false);
    expect(isRightward(10, 3)).toBe(true);
    expect(isRightward(10, -10)).toBe(false);
    expect(isRightward(-10, 0)).toBe(false);
  });
});

describe("following one finger (createDrag)", () => {
  const at = (x: number, y: number, t: number) => ({ x, y, t });

  it("decides after DECIDE_PX: a drag it claims is its own from then on", () => {
    const drag = createDrag(at(100, 100, 0), isDownward);
    // Before deciding, a move it would claim is cancelled already, so the page never starts to scroll.
    expect(drag.move(at(100, 103, 16))).toEqual({ phase: "deciding", dx: 0, dy: 3, prevent: true });
    expect(drag.move(at(100, 100 + DECIDE_PX, 32))).toMatchObject({ phase: "dragging", prevent: true });
    // Once it has it, it keeps it, whichever way the finger goes.
    expect(drag.move(at(160, 90, 48))).toMatchObject({ phase: "dragging", dx: 60, dy: -10, prevent: true });
  });

  it("leaves a drag it does not claim to the browser, and never cancels its moves", () => {
    const drag = createDrag(at(100, 100, 0), isDownward);
    expect(drag.move(at(100, 96, 16))).toMatchObject({ phase: "deciding", prevent: false });
    expect(drag.move(at(100, 80, 32))).toMatchObject({ phase: "ignored", prevent: false });
    // Coming back down later does not make it a pull.
    expect(drag.move(at(100, 200, 48))).toMatchObject({ phase: "ignored", prevent: false });
  });

  it("measures the speed at release over the last 100 ms", () => {
    const drag = createDrag(at(0, 0, 0), isDownward);
    drag.move(at(0, 10, 100));
    drag.move(at(0, 20, 400)); // a slow drag…
    drag.move(at(0, 30, 450));
    const end = drag.end(at(0, 80, 500)); // …then a flick
    expect(end.phase).toBe("dragging");
    expect(end.dy).toBe(80);
    expect(end.vy).toBeCloseTo((80 - 20) / (500 - 400));
    expect(sheetDragCloses(end.dy, end.vy)).toBe(true);
  });

  it("a finger held still has no speed", () => {
    const drag = createDrag(at(0, 0, 0), isDownward);
    drag.move(at(0, 40, 10));
    drag.move(at(0, 40, 400));
    expect(drag.end().vy).toBe(0);
  });
});

// ── Fake elements: just what the rules read ─────────────────────────

interface FakeEl extends ElementLike {
  name: string;
  parentElement: FakeEl | null;
  scrollTop: number;
  scrollLeft: number;
  overflowX: string;
  overflowY: string;
  matches: boolean;
  closest(selector: string): FakeEl | null;
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
    matches: false,
    closest(_selector: string) {
      for (let at: FakeEl | null = e; at; at = at.parentElement) if (at.matches) return at;
      return null;
    },
    ...over,
  };
  return e;
}

const styleOf: StyleOf = (e) => ({ overflowX: (e as FakeEl).overflowX, overflowY: (e as FakeEl).overflowY });

describe("what is under the finger", () => {
  it("text fields and anything marked data-gestures=off keep their own drags", () => {
    const root = el("root", null);
    const field = el("input", root, { matches: true });
    expect(hasOwnDrags(el("span", field))).toBe(true);
    expect(hasOwnDrags(el("button", root))).toBe(false);
    expect(hasOwnDrags(null)).toBe(false);
    expect(hasOwnDrags({})).toBe(false);
  });

  it("finds the lists between the finger and the root that scroll that way", () => {
    const root = el("root", null, { overflowY: "auto", scrollHeight: 900 });
    const list = el("list", root, { overflowY: "auto", scrollHeight: 400 });
    const short = el("short", list, { overflowY: "auto" }); // nothing more to show
    const row = el("row", short, { overflowX: "auto", scrollWidth: 300 });
    const hidden = el("hidden", row, { overflowY: "hidden", scrollHeight: 400 });
    const leaf = el("leaf", hidden);
    expect(scrollersBetween(leaf, root, "y", styleOf).map((e) => (e as FakeEl).name)).toEqual(["list", "root"]);
    expect(scrollersBetween(leaf, root, "x", styleOf).map((e) => (e as FakeEl).name)).toEqual(["row"]);
    // A finger outside the root: nothing of the root's.
    expect(scrollersBetween(el("elsewhere", null, { overflowY: "auto", scrollHeight: 400 }), root, "y", styleOf)).toEqual([]);
    expect(atStart(list, "y")).toBe(true);
    list.scrollTop = 1;
    expect(atStart(list, "y")).toBe(false);
  });
});

describe("whose drag is it", () => {
  it("a pull: only at the very top of the page and of the list under the finger", () => {
    const main = el("main", null);
    const list = el("list", main, { overflowY: "auto", scrollHeight: 400 });
    const row = el("row", list);
    let pageTop = 0;
    const top = () => pageTop;
    expect(pullRule(row, main, top, styleOf)?.(0, 20)).toBe(true);
    expect(pullRule(row, main, top, styleOf)?.(20, 10)).toBe(false); // mostly sideways
    expect(pullRule(row, main, top, styleOf)?.(0, -20)).toBe(false); // up: a scroll
    list.scrollTop = 30;
    expect(pullRule(row, main, top, styleOf)?.(0, 20)).toBe(false); // the list scrolls back first
    list.scrollTop = 0;
    pageTop = 12;
    expect(pullRule(row, main, top, styleOf)).toBeNull(); // the page is not at its top
    pageTop = 0;
    expect(pullRule(el("input", main, { matches: true }), main, top, styleOf)).toBeNull();
  });

  it("the edge swipe: from the left edge only, and a sideways row keeps its drag", () => {
    const frame = el("frame", null);
    const usuals = el("usuals", frame, { overflowX: "auto", scrollWidth: 600 });
    const chip = el("chip", usuals);
    const card = el("card", frame);
    expect(edgeSwipeRule({ x: EDGE_PX, y: 300, t: 0 }, card, frame, styleOf)?.(40, 5)).toBe(true);
    expect(edgeSwipeRule({ x: 4, y: 300, t: 0 }, card, frame, styleOf)?.(5, 40)).toBe(false); // turns vertical: a scroll
    expect(edgeSwipeRule({ x: EDGE_PX + 1, y: 300, t: 0 }, card, frame, styleOf)).toBeNull(); // starts elsewhere
    expect(edgeSwipeRule({ x: 4, y: 300, t: 0 }, chip, frame, styleOf)).toBeNull();
  });

  it("a sheet: from the handle or header, or a list at its top; a list scrolled down keeps scrolling", () => {
    const sheet = el("sheet", null, { overflowY: "hidden", scrollHeight: 900 });
    const handle = el("handle", sheet);
    const list = el("list", sheet, { overflowY: "auto", scrollHeight: 1200, clientHeight: 500 });
    const tile = el("tile", list);
    const chips = el("chips", sheet, { overflowX: "auto", scrollWidth: 500 });
    expect(sheetDragRule(handle, sheet, styleOf)?.(2, 30)).toBe(true);
    expect(sheetDragRule(tile, sheet, styleOf)?.(2, 30)).toBe(true);
    expect(sheetDragRule(tile, sheet, styleOf)?.(0, -30)).toBe(false); // up scrolls the list
    expect(sheetDragRule(el("chip", chips), sheet, styleOf)?.(30, 2)).toBe(false); // sideways scrolls the chips
    list.scrollTop = 200;
    expect(sheetDragRule(tile, sheet, styleOf)?.(2, 30)).toBe(false);
    expect(sheetDragRule(handle, sheet, styleOf)?.(2, 30)).toBe(true); // the handle still drags it
    expect(sheetDragRule(el("field", sheet, { matches: true }), sheet, styleOf)).toBeNull();
  });
});

describe("listening for drags (synthetic touch events)", () => {
  type Finger = { identifier: number; clientX: number; clientY: number };
  const finger = (x: number, y: number, identifier = 1): Finger => ({ identifier, clientX: x, clientY: y });

  function touch(type: string, touches: Finger[], changed: Finger[] = touches): Event {
    const e = new Event(type, { cancelable: type !== "touchcancel" });
    Object.defineProperties(e, { touches: { value: touches }, changedTouches: { value: changed } });
    return e;
  }

  function setup(rule: (target: unknown) => ((dx: number, dy: number) => boolean) | null) {
    const surface = new EventTarget();
    let clock = 0;
    const log: { moves: number[][]; ends: Array<{ end: DragEnd; cancelled: boolean }>; targets: unknown[] } = { moves: [], ends: [], targets: [] };
    const stop = listenForDrags(
      surface,
      {
        begin(_start, target) {
          log.targets.push(target);
          return rule(target);
        },
        move: (dx, dy) => void log.moves.push([dx, dy]),
        end: (end, cancelled) => void log.ends.push({ end, cancelled }),
      },
      () => clock,
    );
    const send = (e: Event, at?: number) => {
      if (at !== undefined) clock = at;
      surface.dispatchEvent(e);
      return e;
    };
    // One finger from (x, y) down `dys` px, 16 ms apart; returns the touchmoves.
    const drag = (x: number, y: number, steps: Array<[number, number]>, lift = true) => {
      send(touch("touchstart", [finger(x, y)]), 0);
      const moves = steps.map(([dx, dy], i) => send(touch("touchmove", [finger(x + dx, y + dy)]), 16 * (i + 1)));
      const last = steps[steps.length - 1] ?? [0, 0];
      if (lift) send(touch("touchend", [], [finger(x + last[0], y + last[1])]), 16 * (steps.length + 1));
      return moves;
    };
    return { surface, log, send, drag, stop };
  }

  it("a drag the gesture takes: its moves are cancelled (no scroll under it), it follows, then ends", () => {
    const { log, drag } = setup(() => isDownward);
    const moves = drag(200, 100, [[0, 4], [1, 12], [2, 60], [2, 140]]);
    expect(moves.map((e) => e.defaultPrevented)).toEqual([true, true, true, true]);
    expect(log.moves).toEqual([[1, 12], [2, 60], [2, 140]]);
    expect(log.ends).toHaveLength(1);
    expect(log.ends[0]).toMatchObject({ cancelled: false, end: { phase: "dragging", dx: 2, dy: 140 } });
  });

  it("a drag it does not take is the browser's: nothing cancelled, nothing followed", () => {
    const { log, drag } = setup(() => isDownward);
    const moves = drag(200, 300, [[0, -4], [0, -20], [0, 40]]);
    expect(moves.some((e) => e.defaultPrevented)).toBe(false);
    expect(log.moves).toEqual([]);
    expect(log.ends).toEqual([]);
  });

  it("a touch the gesture leaves alone at the start is never followed", () => {
    const { log, drag } = setup(() => null);
    const moves = drag(10, 300, [[30, 0], [120, 0]]);
    expect(moves.some((e) => e.defaultPrevented)).toBe(false);
    expect(log.moves).toEqual([]);
    expect(log.targets).toHaveLength(1);
  });

  it("a second finger, or the browser taking the touch, ends the drag as cancelled", () => {
    const two = setup(() => isDownward);
    two.drag(200, 100, [[0, 30]], false);
    two.send(touch("touchstart", [finger(200, 130), finger(100, 100, 2)], [finger(100, 100, 2)]));
    expect(two.log.ends).toEqual([expect.objectContaining({ cancelled: true })]);

    const taken = setup(() => isDownward);
    taken.drag(200, 100, [[0, 30]], false);
    taken.send(touch("touchcancel", [], [finger(200, 130)]));
    expect(taken.log.ends).toEqual([expect.objectContaining({ cancelled: true })]);
  });

  it("stops listening when asked", () => {
    const { log, drag, stop } = setup(() => isDownward);
    stop();
    drag(200, 100, [[0, 30], [0, 90]]);
    expect(log.targets).toEqual([]);
  });

  it("a pull past 64 px refreshes; a short one springs back", () => {
    const main = el("main", null);
    const released: number[] = [];
    const surface = new EventTarget();
    let clock = 0;
    listenForDrags(
      surface,
      {
        begin: () => pullRule(main, main, () => 0, styleOf),
        move: () => undefined,
        end: (end, cancelled) => void released.push(cancelled ? 0 : pullDistance(end.dy)),
      },
      () => clock,
    );
    const pull = (dy: number) => {
      clock = 0;
      surface.dispatchEvent(touch("touchstart", [finger(200, 100)]));
      for (let step = 1; step <= 4; step++) {
        clock = step * 40;
        surface.dispatchEvent(touch("touchmove", [finger(200, 100 + (dy * step) / 4)]));
      }
      clock = 400; // held a moment before letting go
      surface.dispatchEvent(touch("touchend", [], [finger(200, 100 + dy)]));
    };
    pull(160);
    pull(100);
    expect(released).toEqual([80, 50]);
    expect(released.map(pullRefreshes)).toEqual([true, false]);
  });

  it("a sheet dragged 100 px closes, a fast short flick closes, a nudge springs back", () => {
    const sheet = el("sheet", null);
    const surface = new EventTarget();
    const closes: boolean[] = [];
    let clock = 0;
    listenForDrags(
      surface,
      { begin: () => sheetDragRule(sheet, sheet, styleOf), move: () => undefined, end: (end) => void closes.push(sheetDragCloses(end.dy, end.vy)) },
      () => clock,
    );
    const pull = (dy: number, ms: number) => {
      clock = 0;
      surface.dispatchEvent(touch("touchstart", [finger(200, 500)]));
      clock = ms / 2;
      surface.dispatchEvent(touch("touchmove", [finger(200, 500 + dy / 2)]));
      clock = ms;
      surface.dispatchEvent(touch("touchmove", [finger(200, 500 + dy)]));
      surface.dispatchEvent(touch("touchend", [], [finger(200, 500 + dy)]));
    };
    pull(100, 400);
    pull(40, 50);
    pull(40, 400);
    expect(closes).toEqual([true, true, false]);
  });
});
