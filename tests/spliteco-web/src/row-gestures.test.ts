// Ported from Cookpool's tests/web-console-next/src/row-gestures.test.ts (spliteco-calm
// SL1, risk SL-A): the copied lib/gestures/row-gestures.ts must behave as its source.
import {
  CLICK_GUARD_MS,
  HOLD_REPEAT,
  HoldRepeatTracker,
  LONG_PRESS,
  RowGestureTracker,
  SWIPE,
  nextRepeatIn,
  pressMoved,
  repeatSchedule,
  swipeFires,
  swipeIntent,
  swipeOffset,
  swipeSpeed,
  type GestureClock,
  type PointerLike,
} from "@saas/gestures/row-gestures";

/** A clock the test moves by hand: timers run in order as time passes. */
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
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };
  return {
    clock,
    /** Let `ms` pass, running every timer due on the way at its own time. */
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
    pending: () => timers.size,
  };
}

const touch = (x: number, y: number, pointerId = 1): PointerLike => ({ pointerId, clientX: x, clientY: y, pointerType: "touch", button: 0 });

/** A 350 px row (a 390 px phone less the page's gutters) with a swipe and a menu, recording what it was told. */
function row(opts: { swipe?: boolean; menu?: boolean } = {}) {
  const t = fakeClock();
  const log: string[] = [];
  let lastDrag: { offset: number; armed: boolean } | null = null;
  const tracker = new RowGestureTracker({
    canSwipe: () => opts.swipe ?? true,
    canLongPress: () => opts.menu ?? true,
    clock: t.clock,
    handlers: {
      drag: (offset, armed) => {
        lastDrag = { offset, armed };
      },
      release: (fired) => log.push(fired ? "fired" : "sprang back"),
      longPress: () => log.push("menu"),
    },
  });
  /** Drag from (300, 400) by dx, dy in `steps` moves over `ms`. */
  const drag = (dx: number, dy: number, ms: number, steps = 6) => {
    for (let i = 1; i <= steps; i++) {
      t.advance(ms / steps);
      tracker.move(touch(300 + (dx * i) / steps, 400 + (dy * i) / steps));
    }
  };
  return { t, log, tracker, drag, last: () => lastDrag };
}

describe("swiping a row: the intent rule (PW-8, risk PW-D)", () => {
  it("decides nothing inside the slop", () => {
    expect(SWIPE.slopPx).toBe(10);
    expect(swipeIntent(-9, 0)).toBe("undecided");
    expect(swipeIntent(-6, 7)).toBe("undecided");
    expect(swipeIntent(0, 0)).toBe("undecided");
  });

  it("is a swipe only to the left and mostly sideways", () => {
    expect(swipeIntent(-12, 3)).toBe("swipe");
    expect(swipeIntent(-30, -20)).toBe("swipe");
  });

  it("leaves a vertical drag to the list's scroll, and a drag to the right to the back swipe", () => {
    expect(swipeIntent(-3, 14)).toBe("not-ours");
    expect(swipeIntent(-14, 14)).toBe("not-ours"); // a tie is not sideways
    expect(swipeIntent(-20, -40)).toBe("not-ours");
    expect(swipeIntent(15, 0)).toBe("not-ours");
  });

  it("moves the row with the finger, to the left only and never past its width", () => {
    expect(swipeOffset(-80, 350)).toBe(-80);
    expect(swipeOffset(40, 350)).toBe(0);
    expect(swipeOffset(-500, 350)).toBe(-350);
  });
});

describe("swiping a row: the threshold", () => {
  it("fires past 40% of the row", () => {
    expect(SWIPE.fireFraction).toBe(0.4);
    expect(swipeFires({ dx: -139, width: 350, speed: 0 })).toBe(false);
    expect(swipeFires({ dx: -140, width: 350, speed: 0 })).toBe(true);
    expect(swipeFires({ dx: -300, width: 350, speed: 0.2 })).toBe(true);
  });

  it("fires on a fast flick that went some way, not on a twitch", () => {
    expect(swipeFires({ dx: -60, width: 350, speed: -0.9 })).toBe(true);
    expect(swipeFires({ dx: -30, width: 350, speed: -2 })).toBe(false);
    expect(swipeFires({ dx: -100, width: 350, speed: -0.3 })).toBe(false);
  });

  it("reads the speed over the last 100 ms", () => {
    expect(swipeSpeed([])).toBe(0);
    expect(swipeSpeed([{ t: 0, x: 300 }])).toBe(0);
    expect(swipeSpeed([{ t: 0, x: 300 }, { t: 50, x: 250 }])).toBe(-1);
    // A finger that stopped before letting go is not a flick.
    expect(swipeSpeed([{ t: 0, x: 300 }, { t: 50, x: 200 }, { t: 400, x: 200 }])).toBe(0);
  });
});

describe("swiping a row: the tracker, with synthetic pointer events", () => {
  it("fires a long swipe left once, on release, and swallows the click that follows", () => {
    const r = row();
    expect(r.tracker.down(touch(300, 400), 350)).toBe(true);
    r.drag(-160, 4, 300);
    expect(r.tracker.state).toBe("swiping");
    expect(r.last()).toEqual({ offset: -160, armed: true });
    expect(r.log).toEqual([]);
    r.tracker.up(touch(140, 404));
    expect(r.log).toEqual(["fired"]);
    // The release's click must not open the item too.
    expect(r.tracker.consumeClick()).toBe(true);
    expect(r.tracker.consumeClick()).toBe(false);
  });

  it("springs back after a short, slow swipe, and nothing is logged", () => {
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.drag(-80, 0, 600);
    expect(r.last()).toEqual({ offset: -80, armed: false });
    r.t.advance(200);
    r.tracker.up(touch(220, 400));
    expect(r.log).toEqual(["sprang back"]);
    expect(r.tracker.consumeClick()).toBe(true);
  });

  it("fires on a quick flick shorter than 40%", () => {
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.drag(-70, 0, 60, 3);
    r.tracker.up(touch(230, 400));
    expect(r.log).toEqual(["fired"]);
  });

  it("lets a vertical drag scroll the list: no drag, no fire, no menu", () => {
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.drag(-4, 120, 200);
    expect(r.tracker.state).toBe("not-ours");
    expect(r.last()).toBeNull();
    r.t.advance(1000);
    r.tracker.up(touch(296, 520));
    expect(r.log).toEqual([]);
  });

  it("leaves a drag to the right alone (the edge swipe back)", () => {
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.drag(120, 0, 200);
    r.tracker.up(touch(420, 400));
    expect(r.last()).toBeNull();
    expect(r.log).toEqual([]);
  });

  it("springs back when the browser takes the touch", () => {
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.drag(-200, 0, 200);
    r.tracker.cancel();
    expect(r.log).toEqual(["sprang back"]);
  });

  it("ignores a mouse (the row's buttons are for it) and a second finger", () => {
    const r = row();
    expect(r.tracker.down({ pointerId: 1, clientX: 300, clientY: 400, pointerType: "mouse", button: 0 }, 350)).toBe(false);
    expect(r.tracker.down(touch(300, 400, 1), 350)).toBe(true);
    expect(r.tracker.down(touch(100, 400, 2), 350)).toBe(false);
    r.tracker.move(touch(0, 400, 2));
    expect(r.last()).toBeNull();
  });

  it("does nothing sideways on a row with nothing to swipe to (a viewer's, a payment's)", () => {
    const r = row({ swipe: false });
    r.tracker.down(touch(300, 400), 350);
    r.drag(-200, 0, 200);
    r.tracker.up(touch(100, 400));
    expect(r.last()).toBeNull();
    expect(r.log).toEqual([]);
    expect(row({ swipe: false, menu: false }).tracker.down(touch(300, 400), 350)).toBe(false);
  });
});

describe("pressing and holding a row (PW-8)", () => {
  it("opens the menu after ~450 ms held still, and the release opens nothing else", () => {
    expect(LONG_PRESS.delayMs).toBe(450);
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.t.advance(449);
    expect(r.log).toEqual([]);
    r.t.advance(1);
    expect(r.log).toEqual(["menu"]);
    expect(r.tracker.state).toBe("held");
    // Moving now neither swipes nor scrolls the row.
    r.tracker.move(touch(150, 400));
    expect(r.last()).toBeNull();
    r.t.advance(300);
    r.tracker.up(touch(150, 400));
    expect(r.tracker.consumeClick()).toBe(true);
  });

  it("is a tap when let go sooner: the click goes through to the row's link", () => {
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.t.advance(200);
    r.tracker.up(touch(300, 400));
    r.t.advance(1000);
    expect(r.log).toEqual([]);
    expect(r.tracker.consumeClick()).toBe(false);
  });

  it("is not a press once the finger moves past the slop, or starts a swipe", () => {
    expect(pressMoved(6, 6)).toBe(false);
    expect(pressMoved(8, 8)).toBe(true);
    const scroll = row();
    scroll.tracker.down(touch(300, 400), 350);
    scroll.tracker.move(touch(300, 412));
    scroll.t.advance(1000);
    expect(scroll.log).toEqual([]);
    const swipe = row();
    swipe.tracker.down(touch(300, 400), 350);
    swipe.drag(-30, 0, 100, 2);
    swipe.t.advance(1000);
    expect(swipe.log).toEqual([]);
    expect(swipe.tracker.state).toBe("swiping");
  });

  it("takes the phone's own long-press (Android's context menu) as its own, at once", () => {
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.t.advance(300);
    expect(r.tracker.contextMenu()).toBe(true); // prevented
    expect(r.log).toEqual(["menu"]);
    r.t.advance(500);
    expect(r.log).toEqual(["menu"]); // once
  });

  it("leaves the context menu alone on a row with no menu, unless it is swiping", () => {
    const r = row({ menu: false });
    r.tracker.down(touch(300, 400), 350);
    expect(r.tracker.contextMenu()).toBe(false);
    r.t.advance(1000);
    expect(r.log).toEqual([]);
    r.drag(-50, 0, 100);
    expect(r.tracker.contextMenu()).toBe(true);
  });

  it("swallows the click only for a moment after a gesture", () => {
    const r = row();
    r.tracker.down(touch(300, 400), 350);
    r.drag(-200, 0, 200);
    r.tracker.up(touch(100, 400));
    r.t.advance(CLICK_GUARD_MS + 1);
    expect(r.tracker.consumeClick()).toBe(false);
  });
});

describe("holding − or + (PW-8)", () => {
  it("repeats after ~400 ms every ~150 ms, then every ~60 ms after a second", () => {
    expect(HOLD_REPEAT).toEqual({ delayMs: 400, everyMs: 150, fastAfterMs: 1000, fastEveryMs: 60 });
    expect(nextRepeatIn(0)).toBe(400);
    expect(nextRepeatIn(100)).toBe(300);
    expect(nextRepeatIn(400)).toBe(150);
    expect(nextRepeatIn(999)).toBe(150);
    expect(nextRepeatIn(1000)).toBe(60);
    expect(repeatSchedule(1200)).toEqual([400, 550, 700, 850, 1000, 1060, 1120, 1180]);
    expect(repeatSchedule(399)).toEqual([]);
  });

  function stepper(value: number, max: number) {
    const t = fakeClock();
    const s = { value, max, stepped: 0 };
    const tracker = new HoldRepeatTracker({
      clock: t.clock,
      canStep: () => s.value < s.max,
      step: () => {
        s.value += 1;
        s.stepped += 1;
      },
    });
    /** A tap or the click that ends a press: the button's onClick. */
    const click = () => {
      if (!tracker.consumeClick() && s.value < s.max) s.value += 1;
    };
    return { t, s, tracker, click };
  }

  it("is one step for a tap, as before", () => {
    const p = stepper(1, 10);
    p.tracker.down(touch(20, 20));
    p.t.advance(120);
    p.tracker.up(touch(20, 20));
    p.click();
    expect(p.s.value).toBe(2);
    expect(p.tracker.steps).toBe(0);
    expect(p.t.pending()).toBe(0);
  });

  it("steps while held and adds nothing on release", () => {
    const p = stepper(0, 100);
    p.tracker.down(touch(20, 20));
    p.t.advance(1000);
    expect(p.s.value).toBe(5); // 400, 550, 700, 850, 1000
    p.t.advance(200);
    expect(p.s.value).toBe(8); // 1060, 1120, 1180
    p.tracker.up(touch(20, 20));
    p.click();
    expect(p.s.value).toBe(8);
    p.t.advance(1000);
    expect(p.s.value).toBe(8);
    expect(p.t.pending()).toBe(0);
  });

  it("stops at the max, even held on, and the release adds nothing", () => {
    const p = stepper(0, 5);
    p.tracker.down(touch(20, 20));
    p.t.advance(3000);
    expect(p.s.value).toBe(5);
    expect(p.tracker.repeating).toBe(false);
    expect(p.t.pending()).toBe(0);
    p.t.advance(2000); // still held, long past the click guard
    p.tracker.up(touch(20, 20));
    p.click();
    expect(p.s.value).toBe(5);
  });

  it("stops when the finger leaves the button or the browser takes it", () => {
    const p = stepper(0, 100);
    p.tracker.down(touch(20, 20));
    p.t.advance(700);
    expect(p.s.value).toBe(3);
    p.tracker.release();
    p.t.advance(2000);
    expect(p.s.value).toBe(3);
    expect(p.t.pending()).toBe(0);
  });

  it("does not start at the end, nor for the mouse's other buttons", () => {
    const end = stepper(5, 5);
    end.tracker.down(touch(20, 20));
    end.t.advance(2000);
    expect(end.s.stepped).toBe(0);
    const right = stepper(0, 5);
    right.tracker.down({ pointerId: 1, clientX: 20, clientY: 20, pointerType: "mouse", button: 2 });
    right.t.advance(2000);
    expect(right.s.stepped).toBe(0);
  });

  it("repeats for a mouse held down too", () => {
    const p = stepper(0, 100);
    p.tracker.down({ pointerId: 1, clientX: 20, clientY: 20, pointerType: "mouse", button: 0 });
    p.t.advance(550);
    expect(p.s.value).toBe(2);
  });
});
