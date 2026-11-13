import {
  DECIDE_PX,
  EDGE_PX,
  HOLD,
  HoldTracker,
  PAGER,
  ROW_SWIPE,
  SETTLE_TRANSITION,
  SLIDER_FIRE_FRACTION,
  SwipeRowTracker,
  edgeBackDevice,
  edgeSwipeGoesBack,
  holdMoved,
  pagerNeighbour,
  pagerOffset,
  pagerPosition,
  pagerRelease,
  pagerRule,
  rowOrPager,
  rowSwipeOffset,
  rowSwipeRelease,
  rubberBand,
  sheetDragCloses,
  sliderFires,
  sliderKeyFires,
  sliderPosition,
  type RowRelease,
} from "@saas/gestures/rules";
import type { GestureClock, PointerLike } from "@saas/gestures/row-gestures";

// spliteco-calm SL1 (design §2): the pure rules SL2–SL5 build the pager, the
// row swipe, the hold sheet, the sheets, the edge back and Settle's slider on.

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: GestureClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
  };
  return {
    clock,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

const finger = (x: number, y: number, pointerId = 1): PointerLike => ({ pointerId, clientX: x, clientY: y, pointerType: "touch", button: 0 });

describe("the settle", () => {
  it("is 200 ms on Cookpool's curve", () => {
    expect(SETTLE_TRANSITION).toBe("transform 200ms cubic-bezier(0.32, 0.72, 0, 1)");
  });
});

describe("the pager (Home ↔ Groups ↔ Activity)", () => {
  const W = 390;

  it("knows the page beside, and none past the ends", () => {
    expect(pagerNeighbour(0, 3, -10)).toBe(1);
    expect(pagerNeighbour(1, 3, 10)).toBe(0);
    expect(pagerNeighbour(0, 3, 10)).toBeNull();
    expect(pagerNeighbour(2, 3, -10)).toBeNull();
    expect(pagerNeighbour(1, 3, 0)).toBeNull();
  });

  it("follows the finger one to one toward a page, and rubber-bands past an end", () => {
    expect(pagerOffset(0, 3, -120, W)).toBe(-120);
    expect(pagerOffset(0, 3, -900, W)).toBe(-W);
    const past = pagerOffset(0, 3, 120, W);
    expect(past).toBeGreaterThan(0);
    expect(past).toBeLessThan(120 * 0.5);
    expect(past).toBeCloseTo(rubberBand(120, W));
    expect(rubberBand(0, W)).toBe(0);
    expect(rubberBand(-50, W)).toBeLessThan(0);
  });

  it("gives the indicator a fractional page, kept inside the ends", () => {
    expect(pagerPosition(0, 3, 0, W)).toBe(0);
    expect(pagerPosition(0, 3, -W / 2, W)).toBeCloseTo(0.5);
    expect(pagerPosition(1, 3, W / 4, W)).toBeCloseTo(0.75);
    expect(pagerPosition(0, 3, 200, W)).toBe(0);
    expect(pagerPosition(2, 3, -200, W)).toBe(2);
  });

  it("goes on past 35% of the width or a flick; a flick back stays; the ends stay", () => {
    expect(PAGER.fraction).toBe(0.35);
    const at = (dx: number, vx: number, index = 0) => pagerRelease({ index, count: 3, dx, vx, width: W });
    expect(at(-0.34 * W, 0)).toBe(0);
    expect(at(-0.35 * W, 0)).toBe(1);
    expect(at(-30, -0.6)).toBe(1); // a flick, past FLICK_MIN_PX
    expect(at(-20, -0.9)).toBe(0); // too short to be a flick
    expect(at(-0.6 * W, 0.6)).toBe(0); // flicked back
    expect(at(0.6 * W, 0.9)).toBe(0); // nothing before Home
    expect(at(-0.6 * W, -0.9, 2)).toBe(2); // nothing after Activity
    expect(at(0.5 * W, 0, 2)).toBe(1);
  });

  it("claims only sideways drags past DECIDE_PX; on a swipe row only to the right", () => {
    const plain = { closest: () => null };
    const rule = pagerRule(plain)!;
    expect(rule(-5, 0)).toBe(false); // undecided: nothing cancelled yet
    expect(rule(-DECIDE_PX, 0)).toBe(true);
    expect(rule(-20, 15)).toBe(false); // not 1.6× as sideways
    expect(rule(0, 40)).toBe(false); // a scroll

    const onRow = { closest: (s: string) => (s === "[data-swipe-row]" ? {} : null) };
    const rowRule = pagerRule(onRow)!;
    expect(rowRule(-30, 0)).toBe(false); // the row's
    expect(rowRule(30, 0)).toBe(true); // the pager's

    const field = { closest: (s: string) => (s.includes("input") ? {} : null) };
    expect(pagerRule(field)).toBeNull();
    expect(rowOrPager(-10, false)).toBe("row");
    expect(rowOrPager(10, false)).toBe("pager");
    expect(rowOrPager(10, true)).toBe("row");
  });
});

describe("a row swiped left: reveal or fire", () => {
  const W = 350;

  it("sits at −96 px when open and follows the finger left, never right of 0 or past its width", () => {
    expect(ROW_SWIPE.revealPx).toBe(96);
    expect(rowSwipeOffset(-30, W, false)).toBe(-30);
    expect(rowSwipeOffset(30, W, false)).toBe(0);
    expect(rowSwipeOffset(0, W, true)).toBe(-96);
    expect(rowSwipeOffset(50, W, true)).toBe(-46);
    expect(rowSwipeOffset(-900, W, false)).toBe(-W);
  });

  it("a short swipe reveals; past 40% or a flick fires; short of 40 px or a flick right closes", () => {
    const r = (dx: number, speed = 0, open = false): RowRelease => rowSwipeRelease({ dx, width: W, speed, open });
    expect(r(-20)).toBe("close");
    expect(r(-60)).toBe("reveal");
    expect(r(-0.39 * W)).toBe("reveal");
    expect(r(-0.4 * W)).toBe("fire");
    expect(r(-60, -0.7)).toBe("fire"); // a flick left
    expect(r(-30, -0.7)).toBe("close"); // too short for a flick, short of open
    expect(r(-60, 0.6)).toBe("close"); // flicked back
    // Open: a little more left stays open, a drag back closes, far enough fires.
    expect(r(-10, 0, true)).toBe("reveal");
    expect(r(70, 0, true)).toBe("close");
    expect(r(-50, 0, true)).toBe("fire"); // −146 px ≥ 40% of 350
  });

  function tracked(opts: { hold?: boolean; open?: boolean } = {}) {
    const t = fakeClock();
    const log: string[] = [];
    const tracker = new SwipeRowTracker({
      canSwipe: () => true,
      canHold: () => opts.hold ?? true,
      isOpen: () => opts.open ?? false,
      clock: t.clock,
      handlers: {
        drag: (offset, release) => void log.push(`drag ${offset} ${release}`),
        release: (result) => void log.push(`release ${result}`),
        hold: () => void log.push("hold"),
      },
    });
    return { t, log, tracker };
  }

  it("decides after 8 px, says when to take pointer capture, and swallows the click after", () => {
    const { t, log, tracker } = tracked();
    expect(tracker.down(finger(300, 100), W)).toBe(true);
    expect(tracker.move(finger(296, 100))).toBe(false); // inside the slop
    expect(tracker.move(finger(290, 101))).toBe(true); // decided: capture now
    expect(tracker.move(finger(240, 102))).toBe(false); // already captured
    t.advance(300);
    tracker.up(finger(240, 102));
    expect(log).toEqual(["drag -10 close", "drag -60 reveal", "release reveal"]);
    expect(tracker.consumeClick()).toBe(true);
    expect(tracker.consumeClick()).toBe(false);
  });

  it("a drag to the right is not the row's (the pager's), unless the row is open", () => {
    const closed = tracked();
    closed.tracker.down(finger(100, 100), W);
    closed.tracker.move(finger(140, 100));
    expect(closed.tracker.state).toBe("not-ours");
    expect(closed.log).toEqual([]);

    const open = tracked({ open: true });
    open.tracker.down(finger(100, 100), W);
    open.tracker.move(finger(180, 100));
    open.t.advance(300);
    open.tracker.up(finger(180, 100));
    expect(open.log[open.log.length - 1]).toBe("release close");
  });

  it("a vertical drag is the list's scroll", () => {
    const { log, tracker } = tracked();
    tracker.down(finger(200, 100), W);
    tracker.move(finger(201, 130));
    expect(tracker.state).toBe("not-ours");
    expect(log).toEqual([]);
  });

  it("held still 480 ms opens the hold; moving first cancels it", () => {
    const still = tracked();
    still.tracker.down(finger(200, 100), W);
    still.t.advance(HOLD.delayMs - 1);
    expect(still.log).toEqual([]);
    still.t.advance(1);
    expect(still.log).toEqual(["hold"]);
    still.tracker.up(finger(200, 100));
    expect(still.tracker.consumeClick()).toBe(true);

    const moved = tracked();
    moved.tracker.down(finger(200, 100), W);
    moved.tracker.move(finger(200, 112));
    moved.t.advance(1000);
    expect(moved.log).toEqual([]);
  });

  it("a mouse is left alone (it has the twin)", () => {
    const { tracker } = tracked();
    expect(tracker.down({ ...finger(1, 1), pointerType: "mouse" }, W)).toBe(false);
  });
});

describe("hold", () => {
  it("is 480 ms, cancelled by moving more than 8 px", () => {
    expect(HOLD).toEqual({ delayMs: 480, slopPx: 8 });
    expect(holdMoved(5, 6)).toBe(false);
    expect(holdMoved(6, 6)).toBe(true);
  });

  it("fires once, swallows the click after, and a mouse is ignored unless asked", () => {
    const t = fakeClock();
    let held = 0;
    const tracker = new HoldTracker({ onHold: () => void (held += 1), clock: t.clock });
    tracker.down(finger(10, 10));
    tracker.move(finger(14, 14));
    t.advance(480);
    expect(held).toBe(1);
    expect(tracker.held).toBe(true);
    tracker.up(finger(14, 14));
    expect(tracker.consumeClick()).toBe(true);
    expect(tracker.consumeClick()).toBe(false);

    tracker.down(finger(10, 10));
    tracker.move(finger(30, 10));
    t.advance(1000);
    expect(held).toBe(1);

    tracker.down({ ...finger(10, 10), pointerType: "mouse" });
    t.advance(1000);
    expect(held).toBe(1);
    const mouse = new HoldTracker({ onHold: () => void (held += 1), clock: t.clock, mouse: true });
    mouse.down({ ...finger(10, 10), pointerType: "mouse" });
    t.advance(480);
    expect(held).toBe(2);
  });

  it("a tap is a tap", () => {
    const t = fakeClock();
    const tracker = new HoldTracker({ onHold: () => undefined, clock: t.clock });
    tracker.down(finger(10, 10));
    t.advance(100);
    tracker.up(finger(10, 10));
    expect(tracker.consumeClick()).toBe(false);
    expect(tracker.pending).toBe(false);
  });
});

describe("sheet drag-down and edge back", () => {
  it("a sheet closes at 80 px or on a flick", () => {
    expect(sheetDragCloses(79, 0)).toBe(false);
    expect(sheetDragCloses(80, 0)).toBe(true);
    expect(sheetDragCloses(30, 0.6)).toBe(true);
  });

  it("the edge back starts within 20 px, goes back past 30% or a flick", () => {
    expect(EDGE_PX).toBe(20);
    expect(edgeSwipeGoesBack(116, 390, 0)).toBe(false);
    expect(edgeSwipeGoesBack(117, 390, 0)).toBe(true);
    expect(edgeSwipeGoesBack(40, 390, 0.6)).toBe(true);
  });

  it("runs only in the installed app on an iPhone or iPad", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    expect(edgeBackDevice({ userAgent: iphone, maxTouchPoints: 5, standalone: true })).toBe(true);
    expect(edgeBackDevice({ userAgent: iphone, maxTouchPoints: 5, standalone: false })).toBe(false);
    expect(edgeBackDevice({ userAgent: ipad, maxTouchPoints: 5, standalone: true })).toBe(true);
    expect(edgeBackDevice({ userAgent: ipad, maxTouchPoints: 0, standalone: true })).toBe(false);
    expect(edgeBackDevice({ userAgent: "Mozilla/5.0 (Linux; Android 15)", maxTouchPoints: 5, standalone: true })).toBe(false);
  });
});

describe("the slider (Settle)", () => {
  it("fires at 85% of the travel or more; else springs back", () => {
    expect(SLIDER_FIRE_FRACTION).toBe(0.85);
    expect(sliderFires(254, 300)).toBe(false);
    expect(sliderFires(255, 300)).toBe(true);
    expect(sliderFires(0, 0)).toBe(false);
  });

  it("keeps the knob on its track", () => {
    expect(sliderPosition(-20, 300)).toBe(0);
    expect(sliderPosition(120, 300)).toBe(120);
    expect(sliderPosition(900, 300)).toBe(300);
  });

  it("has a keyboard twin: Enter or Space", () => {
    expect(sliderKeyFires("Enter")).toBe(true);
    expect(sliderKeyFires(" ")).toBe(true);
    expect(sliderKeyFires("ArrowRight")).toBe(false);
  });
});
