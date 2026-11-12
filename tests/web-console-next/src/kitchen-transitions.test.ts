import * as React from "react";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { renderToStaticMarkup } from "react-dom/server";
import { newFrame } from "@web-console-next/lib/features";
import {
  CAPTURE_CAP_MS,
  COMMIT_CAP_MS,
  TRANSITION_MS,
  carriesShared,
  createTransitions,
  normalizePath,
  shareKey,
  shareName,
  sharePart,
  shareSourceOf,
  shareTarget,
  transitionStyle,
  type NamedElement,
  type ShareScope,
  type TransitionEnv,
  type TransitionKind,
  type TransitionStyle,
} from "@web-console-next/lib/transitions";
import {
  TAB_ROOTS,
  isAppScreen,
  linkTransition,
  popDirection,
  routeDepth,
  transitionKind,
  type LinkClick,
  type LinkClickContext,
} from "@web-console-next/components/kitchen/transitions";
import { NEW_FRAME_TABS } from "@web-console-next/components/kitchen/nav";
import { STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";
import Link from "@web-console-next/components/kitchen/link";
import { KitchenTabBar } from "@web-console-next/components/kitchen/tab-bar";

// cookpool-recipes RC-11 (design §1.6): page transitions on phones, with the
// View Transitions API. The kind of each step comes from the route model; the
// helper animates it where it can, and otherwise navigates exactly as before.

const kind = (from: string, to: string | null, direction?: "back" | "forward") => transitionKind(from, to, { newFrame: true, direction });

describe("the kind of a step (transitionKind)", () => {
  it("cross-fades between the five tabs, both ways", () => {
    expect(TAB_ROOTS).toEqual(NEW_FRAME_TABS.map((t) => t.href));
    expect(kind("/home", "/money")).toBe("tab");
    expect(kind("/money", "/home")).toBe("tab");
    expect(kind("/pantry", "/cook")).toBe("tab");
    expect(kind("/cook", "/you")).toBe("tab");
    // A tab is a tab even when the history goes back to it.
    expect(kind("/money", "/home", "back")).toBe("tab");
  });

  it("slides forward from a list to a detail, and from a detail to its plan or edit", () => {
    expect(kind("/cook", "/recipes/rcp_1")).toBe("forward");
    expect(kind("/home", "/recipes/rcp_1")).toBe("forward");
    expect(kind("/home", "/dishes/dsh_1")).toBe("forward");
    expect(kind("/money", "/people/usr_anu")).toBe("forward");
    expect(kind("/pantry", "/pantry/me:itm_1")).toBe("forward");
    expect(kind("/you", "/you/settings")).toBe("forward");
    expect(kind("/recipes/rcp_1", "/recipes/rcp_1/plan")).toBe("forward");
    expect(kind("/recipes/rcp_1", "/recipes/rcp_1/edit")).toBe("forward");
  });

  it("slides forward across screens of the same depth (a recipe from Explore, a group from a person)", () => {
    expect(kind("/explore", "/recipes/rcp_1")).toBe("forward");
    expect(kind("/people/usr_anu", "/groups/flat-4b")).toBe("forward");
    expect(kind("/recipes/rcp_1", "/recipes/rcp_2")).toBe("forward");
  });

  it("slides back to a shallower screen, and on any known back", () => {
    expect(kind("/recipes/rcp_1/plan", "/recipes/rcp_1")).toBe("back");
    expect(kind("/recipes/rcp_1/edit", "/recipes/rcp_1")).toBe("back");
    expect(kind("/groups/flat-4b/expense", "/groups/flat-4b")).toBe("back");
    expect(kind("/pantry/new", "/pantry?pantry=personal")).toBe("back");
    // A recipe opened from Home, then Back: back, not a tab switch.
    expect(kind("/recipes/rcp_1", "/home", "back")).toBe("back");
    // The history's back, wherever it lands.
    expect(kind("/recipes/rcp_1", null)).toBe("back");
    expect(kind("/people/usr_anu", null)).toBe("back");
  });

  it("is a tab switch from a screen to another tab's root (the tab bar), back to its own tab's root", () => {
    expect(kind("/recipes/rcp_1", "/home")).toBe("tab");
    expect(kind("/people/usr_anu", "/pantry")).toBe("tab");
    expect(kind("/recipes/rcp_1", "/cook")).toBe("back");
    expect(kind("/groups/flat-4b", "/money")).toBe("back");
  });

  it("rises into the cooking session and slides down out of it", () => {
    expect(kind("/cook", "/cook/session")).toBe("up");
    expect(kind("/recipes/rcp_1", "/cook/session?recipe=rcp_1&f=450")).toBe("up");
    expect(kind("/home", "/cook/session")).toBe("up");
    expect(kind("/cook/session", "/cook")).toBe("down");
    expect(kind("/cook/session", "/cook", "back")).toBe("down");
    expect(kind("/cook/session", "/dishes/dsh_1")).toBe("down");
    expect(kind("/cook/session", "/recipes/rcp_1")).toBe("down");
    // Minimize goes back in the history: down.
    expect(kind("/cook/session", null)).toBe("down");
  });

  it("is none for the same screen, a query that changes, or a page outside the app", () => {
    expect(kind("/pantry?pantry=personal", "/pantry?pantry=org_1")).toBeNull();
    expect(kind("/money", "/money?list=groups")).toBeNull();
    expect(kind("/home/", "/home")).toBeNull();
    expect(kind("/you/settings", "/login")).toBeNull();
    expect(kind("/login", "/home")).toBeNull();
    expect(kind("/home", "/orgs/acme")).toBeNull();
    expect(kind("/", "/home")).toBeNull();
  });

  it("is none in today's frame (newFrame() false), for every step", () => {
    const off = { newFrame: newFrame({ deployEnv: "prod" }) };
    expect(off.newFrame).toBe(false);
    for (const [from, to] of [
      ["/home", "/money"],
      ["/cook", "/recipes/rcp_1"],
      ["/recipes/rcp_1", "/home"],
      ["/cook", "/cook/session"],
      ["/cook/session", "/cook"],
    ] as const) {
      expect(transitionKind(from, to, off)).toBeNull();
      expect(transitionKind(from, null, off)).toBeNull();
    }
  });

  it("gives every screen of the app a kind from Home, so a new page cannot be left still", () => {
    const pages = STATIC_PAGES.map((p) => p.replace(/:[A-Za-z]+/g, "x1"));
    for (const path of pages) {
      if (!isAppScreen(path) || path === "/home") continue;
      expect([path, kind("/home", path)]).toEqual([path, expect.stringMatching(/^(tab|forward|up)$/)]);
    }
    expect(pages.filter((p) => !isAppScreen(p))).toEqual(["/", "/login", "/login/help", "/auth/callback"]);
  });

  it("measures depth by the parent map: tabs 0, a recipe 1, its plan 2", () => {
    expect(TAB_ROOTS.map(routeDepth)).toEqual([0, 0, 0, 0, 0]);
    expect(routeDepth("/recipes/rcp_1")).toBe(1);
    expect(routeDepth("/recipes/rcp_1/plan")).toBe(2);
    expect(routeDepth("/groups/flat-4b/expense")).toBe(2);
    // You → Notifications is You's own row since RV-6 (it was under settings).
    expect(routeDepth("/you/notifications")).toBe(1);
    expect(routeDepth("/pantry/me:itm_1")).toBe(1);
  });
});

describe("the direction of the browser's back or forward (popDirection)", () => {
  it("reads the trail's counts: fewer behind is back, more is forward", () => {
    expect(popDirection({ cookpoolBack: 3 }, { cookpoolBack: 2 })).toBe("back");
    expect(popDirection({ cookpoolBack: 1 }, { cookpoolBack: 2 })).toBe("forward");
  });

  it("is unknown without both counts (the route model decides)", () => {
    expect(popDirection(null, { cookpoolBack: 2 })).toBeUndefined();
    expect(popDirection({ cookpoolBack: 2 }, {})).toBeUndefined();
    expect(popDirection({ cookpoolBack: 2 }, { cookpoolBack: 2 })).toBeUndefined();
  });
});

describe("what plays (transitionStyle)", () => {
  const KINDS: TransitionKind[] = ["tab", "forward", "back", "up", "down"];
  const phone = { wide: false, reducedMotion: false, swiped: false };

  it("is the kind itself on a phone", () => {
    for (const k of KINDS) expect(transitionStyle(k, phone)).toBe(k);
  });

  it("is only the subtle fade from 900 px, for every kind", () => {
    for (const k of KINDS) expect(transitionStyle(k, { ...phone, wide: true })).toBe("fade");
  });

  it("is the plain fade with reduced motion, even on the desktop or after a swipe", () => {
    for (const k of KINDS) expect(transitionStyle(k, { ...phone, reducedMotion: true, wide: true, swiped: true })).toBe("reduced");
  });

  it("only fades after the edge swipe has moved the page already", () => {
    expect(transitionStyle("back", { ...phone, swiped: true })).toBe("swiped");
    expect(transitionStyle("down", { ...phone, swiped: true })).toBe("swiped");
  });

  it("keeps every step under 300 ms: tab 150, slides 280, down 240, desktop 120, reduced 100", () => {
    for (const ms of Object.values(TRANSITION_MS)) expect(ms).toBeLessThan(300);
    expect(TRANSITION_MS).toMatchObject({ tab: 150, forward: 280, back: 280, fade: 120, reduced: 100 });
  });

  it("carries a card's parts only with a phone's moving kinds", () => {
    expect(carriesShared("forward")).toBe(true);
    for (const s of ["fade", "reduced", "swiped"] as const) expect(carriesShared(s)).toBe(false);
  });
});

// ── The helper, over a fake browser ───────────────────────────────

/** A call counter (this package's tests use no jest mocks). */
function spy(): (() => void) & { calls: number } {
  const fn = Object.assign(() => {
    fn.calls++;
  }, { calls: 0 });
  return fn;
}

/** Promise callbacks run (the browser's capture, the router's commit, the end). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * A fake `ViewTransition`: the update runs once the old page is "captured"
 * (a microtask, or `capture()` when the browser paints no frame), the
 * animation ends on `end()`.
 */
function fakeTransition(update: () => Promise<void>, deferred = false) {
  let end: () => void = () => undefined;
  const animation = new Promise<void>((resolve) => {
    end = resolve;
  });
  let capture: () => void = () => undefined;
  const captured = deferred
    ? new Promise<void>((resolve) => {
        capture = resolve;
      })
    : Promise.resolve();
  const state = { skipped: false, updated: false, done: false };
  const updateCallbackDone = captured.then(async () => {
    state.updated = true;
    await update();
    state.done = true;
  });
  return {
    state,
    updateCallbackDone,
    ready: updateCallbackDone.then(() => {
      if (state.skipped) throw new Error("AbortError: skipped");
    }),
    finished: updateCallbackDone.then(
      () => animation,
      () => undefined,
    ),
    skipTransition() {
      state.skipped = true;
      end();
    },
    end: () => end(),
    capture: () => capture(),
  };
}

/** An element as the transitions see it, with just the selectors `shareSourceOf` asks. */
class FakeEl implements NamedElement {
  style = { viewTransitionName: "" };
  parent: FakeEl | null = null;
  constructor(
    private readonly attrs: Record<string, string> = {},
    readonly children: FakeEl[] = [],
  ) {
    for (const c of children) c.parent = this;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  closest(selector: string): FakeEl | null {
    const attr = selector.slice(1, -1);
    for (let el: FakeEl | null = this; el; el = el.parent) if (el.attrs[attr] !== undefined) return el;
    return null;
  }
  querySelectorAll(selector: string): FakeEl[] {
    expect(selector).toBe("[data-vt-part]:not([data-vt-for])");
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) => {
      for (const c of el.children) {
        if (c.attrs["data-vt-part"] !== undefined && c.attrs["data-vt-for"] === undefined) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

const scope = (el: FakeEl): ShareScope => el;

interface HarnessOptions {
  supported?: boolean;
  reducedMotion?: boolean;
  wide?: boolean;
  hidden?: boolean;
  iosTab?: boolean;
  startThrows?: boolean;
  /** The browser never calls the update (to prove nothing waits forever). */
  neverUpdates?: boolean;
  /** The browser captures only on `capture()` (a page it does not paint). */
  noFrames?: boolean;
}

function harness(opts: HarnessOptions = {}) {
  let now = 0;
  let nextId = 1;
  const timers: { at: number; id: number; run: () => void }[] = [];
  const started: ReturnType<typeof fakeTransition>[] = [];
  const styles: (TransitionStyle | null)[] = [];
  const targets = new Map<string, FakeEl>();
  const watchers = new Set<() => void>();
  const env: TransitionEnv = {
    supported: () => opts.supported ?? true,
    start(update) {
      if (opts.startThrows) throw new Error("InvalidStateError");
      const t = fakeTransition(opts.neverUpdates ? () => new Promise<void>(() => undefined) : update, opts.noFrames ?? false);
      started.push(t);
      return t;
    },
    setStyle: (style) => styles.push(style),
    reducedMotion: () => opts.reducedMotion ?? false,
    wide: () => opts.wide ?? false,
    hidden: () => opts.hidden ?? false,
    iosTab: () => opts.iosTab ?? false,
    findTarget: (key, part) => targets.get(`${key} ${part}`) ?? null,
    watch(onChange) {
      watchers.add(onChange);
      return () => {
        watchers.delete(onChange);
      };
    },
    now: () => now,
    setTimeout(run, ms) {
      const id = nextId++;
      timers.push({ at: now + ms, id, run });
      return id;
    },
    clearTimeout(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift();
      now = next.at;
      next.run();
      await flush();
    }
    now = until;
    await flush();
  };
  return {
    tx: createTransitions(env),
    started,
    styles,
    targets,
    watchers,
    advance,
    style: () => (styles.length > 0 ? styles[styles.length - 1]! : null),
    target(key: string, part: string) {
      const el = new FakeEl(shareTarget(key, part));
      targets.set(`${key} ${part}`, el);
      return el;
    },
  };
}

describe("the helper animates a navigation with startViewTransition", () => {
  it("runs the router inside the transition, after the old page is captured, and ends when the new page has rendered", async () => {
    const h = harness();
    const run = spy();
    h.tx.navigate({ kind: "forward", from: "/cook", run });
    expect(h.started).toHaveLength(1);
    expect(h.style()).toBe("forward");
    expect(run.calls).toBe(0);
    await flush();
    expect(run.calls).toBe(1);
    // Waiting for the new page: the old screenshot holds.
    expect(h.started[0]!.state.done).toBe(false);
    h.tx.committed("/cook");
    await flush();
    expect(h.started[0]!.state.done).toBe(false);
    h.tx.committed("/recipes/rcp_1");
    await flush();
    expect(h.started[0]!.state.done).toBe(true);
    expect(h.started[0]!.state.skipped).toBe(false);
    expect(h.tx.running()).toBe(true);
    h.started[0]!.end();
    await flush();
    expect(h.style()).toBeNull();
    expect(h.tx.running()).toBe(false);
    expect(h.tx.shown()).toBe("/recipes/rcp_1");
  });

  it("navigates at once, with no transition, where the browser has no startViewTransition (iOS before 18)", () => {
    const h = harness({ supported: false });
    const run = spy();
    h.tx.navigate({ kind: "forward", from: "/cook", run });
    expect(run.calls).toBe(1);
    expect(h.started).toHaveLength(0);
    expect(h.styles).toEqual([]);
    expect(h.tx.supported()).toBe(false);
  });

  it("navigates at once when there is nothing to animate: no kind (another frame, the same screen), or a hidden page", () => {
    const h = harness();
    const run = spy();
    h.tx.navigate({ kind: null, from: "/pantry", run });
    expect(run.calls).toBe(1);
    const hidden = harness({ hidden: true });
    hidden.tx.navigate({ kind: "forward", from: "/cook", run });
    expect(run.calls).toBe(2);
    expect([...h.started, ...hidden.started]).toHaveLength(0);
  });

  it("plays a plain 100 ms fade with reduced motion, and the 120 ms fade from 900 px", () => {
    const reduced = harness({ reducedMotion: true });
    reduced.tx.navigate({ kind: "forward", from: "/cook", run: () => undefined });
    expect(reduced.style()).toBe("reduced");
    const wide = harness({ wide: true });
    wide.tx.navigate({ kind: "up", from: "/cook", run: () => undefined });
    expect(wide.style()).toBe("fade");
  });

  it("caps the wait for the new page at 350 ms: a slow page switches when it comes, never animating a stale frame", async () => {
    const h = harness();
    const run = spy();
    h.tx.navigate({ kind: "forward", from: "/cook", run });
    await flush();
    await h.advance(COMMIT_CAP_MS - 1);
    expect(h.started[0]!.state.done).toBe(false);
    await h.advance(1);
    expect(h.started[0]!.state.done).toBe(true);
    expect(h.started[0]!.state.skipped).toBe(true);
    expect(h.style()).toBeNull();
    expect(h.tx.running()).toBe(false);
    // The page arriving late changes nothing.
    h.tx.committed("/recipes/rcp_1");
    await flush();
    expect(h.started).toHaveLength(1);
    expect(run.calls).toBe(1);
  });

  it("never holds a navigation on the animation: with no frame to capture by 500 ms, it navigates without one", async () => {
    const h = harness({ noFrames: true });
    const run = spy();
    h.tx.navigate({ kind: "forward", from: "/cook", run });
    await h.advance(CAPTURE_CAP_MS - 1);
    expect(run.calls).toBe(0);
    await h.advance(1);
    expect(run.calls).toBe(1);
    expect(h.started[0]!.state.skipped).toBe(true);
    expect(h.style()).toBeNull();
    expect(h.tx.running()).toBe(false);
    // The frame comes at last: the browser calls the update, which navigates no second time.
    h.started[0]!.capture();
    await flush();
    expect(run.calls).toBe(1);
  });

  it("runs the navigation anyway when startViewTransition throws, and clears the style", () => {
    const h = harness({ startThrows: true });
    const run = spy();
    expect(() => h.tx.navigate({ kind: "forward", from: "/cook", run })).not.toThrow();
    expect(run.calls).toBe(1);
    expect(h.style()).toBeNull();
    expect(h.tx.running()).toBe(false);
  });

  it("only fades after the edge swipe (swiped), and only for that one step", () => {
    const h = harness();
    h.tx.swiped(() => h.tx.navigate({ kind: "back", from: "/recipes/rcp_1", run: () => undefined }));
    expect(h.style()).toBe("swiped");
    h.tx.navigate({ kind: "back", from: "/recipes/rcp_1", run: () => undefined });
    expect(h.style()).toBe("back");
  });
});

describe("a tapped card's title and tile carry into the page (shared names)", () => {
  const KEY = shareKey("recipe", "rcp_1");

  // Home can show the same recipe twice: Cook now's card (tile in the link) and a row (tile beside it, in its card).
  function home() {
    const stripTile = new FakeEl(sharePart("tile"));
    const stripTitle = new FakeEl(sharePart("title"));
    const stripLink = new FakeEl({ href: "/recipes/rcp_1" }, [stripTile, stripTitle]);
    const rowTile = new FakeEl(sharePart("tile"));
    const rowTitle = new FakeEl(sharePart("title"));
    const rowLink = new FakeEl({ href: "/recipes/rcp_1" }, [rowTitle]);
    const rowCard = new FakeEl({ "data-vt-card": "" }, [rowTile, rowLink]);
    new FakeEl({}, [stripLink, rowCard]);
    return { stripTile, stripTitle, stripLink, rowTile, rowTitle, rowLink };
  }
  const names = (...els: FakeEl[]) => els.map((e) => e.style.viewTransitionName);

  it("finds the tapped link's parts, in the link or in the card around it, never a destination's", () => {
    const h = home();
    expect(shareSourceOf(scope(h.stripLink), KEY).parts.map((p) => [p.part, p.el])).toEqual([
      ["tile", h.stripTile],
      ["title", h.stripTitle],
    ]);
    expect(shareSourceOf(scope(h.rowLink), KEY).parts.map((p) => [p.part, p.el])).toEqual([
      ["tile", h.rowTile],
      ["title", h.rowTitle],
    ]);
    expect(shareName("title")).toBe("kp-share-title");
    expect(shareTarget(KEY, "tile")).toEqual({ "data-vt-part": "tile", "data-vt-for": "recipe:rcp_1" });
  });

  it("names only the tapped card, gives the names to the new page's header, and clears them when it ends", async () => {
    const t = harness();
    const h = home();
    t.tx.navigate({ kind: "forward", from: "/home", run: () => undefined, share: shareSourceOf(scope(h.rowLink), KEY) });
    // Just before the capture: the tapped row only — the strip shows the same recipe, unnamed.
    expect(names(h.rowTile, h.rowTitle)).toEqual(["kp-share-tile", "kp-share-title"]);
    expect(names(h.stripTile, h.stripTitle)).toEqual(["", ""]);
    await flush();
    // Captured: the card gives its names up before the new page takes them.
    expect(names(h.rowTile, h.rowTitle)).toEqual(["", ""]);
    const title = t.target(KEY, "title");
    const tile = t.target(KEY, "tile");
    t.tx.committed("/recipes/rcp_1");
    await flush();
    expect(names(tile, title)).toEqual(["kp-share-tile", "kp-share-title"]);
    expect(t.started[0]!.state.done).toBe(true);
    t.started[0]!.end();
    await flush();
    expect(names(tile, title, h.rowTile, h.rowTitle, h.stripTile, h.stripTitle)).toEqual(["", "", "", "", "", ""]);
  });

  it("waits, within the cap, for the header to appear, and names only the parts the card had", async () => {
    const t = harness();
    const titleOnly = new FakeEl(sharePart("title"));
    const link = new FakeEl({}, [titleOnly]);
    t.tx.navigate({ kind: "forward", from: "/cook", run: () => undefined, share: shareSourceOf(scope(link), KEY) });
    await flush();
    t.tx.committed("/recipes/rcp_1");
    await flush();
    // The page is there, its header not yet (the recipe still loading).
    expect(t.started[0]!.state.done).toBe(false);
    expect(t.watchers.size).toBe(1);
    const tile = t.target(KEY, "tile");
    const title = t.target(KEY, "title");
    for (const w of [...t.watchers]) w();
    await flush();
    expect(names(title, tile)).toEqual(["kp-share-title", ""]);
    expect(t.started[0]!.state.done).toBe(true);
    expect(t.watchers.size).toBe(0);
  });

  it("goes without the header when it does not come by the cap, leaving no name behind", async () => {
    const t = harness();
    const h = home();
    t.tx.navigate({ kind: "forward", from: "/home", run: () => undefined, share: shareSourceOf(scope(h.stripLink), KEY) });
    await flush();
    await t.advance(100);
    t.tx.committed("/recipes/rcp_1");
    await flush();
    await t.advance(COMMIT_CAP_MS - 100);
    expect(t.started[0]!.state.done).toBe(true);
    expect(t.started[0]!.state.skipped).toBe(false);
    const late = t.target(KEY, "title");
    expect(t.watchers.size).toBe(0);
    t.started[0]!.end();
    await flush();
    expect(names(late, h.stripTile, h.stripTitle)).toEqual(["", "", ""]);
  });

  it("names nothing with the plain fades (reduced motion, the desktop)", () => {
    for (const opts of [{ reducedMotion: true }, { wide: true }]) {
      const t = harness(opts);
      const h = home();
      t.tx.navigate({ kind: "forward", from: "/home", run: () => undefined, share: shareSourceOf(scope(h.stripLink), KEY) });
      expect(names(h.stripTile, h.stripTitle)).toEqual(["", ""]);
    }
  });
});

describe("an interrupted transition (a double tap, a fast back)", () => {
  const KEY = shareKey("recipe", "rcp_1");

  it("skips the first, clears its names, never names its page late, and leaves no style", async () => {
    const t = harness();
    const title = new FakeEl(sharePart("title"));
    const link = new FakeEl({}, [title]);
    const runs: string[] = [];
    t.tx.navigate({ kind: "forward", from: "/cook", run: () => runs.push("open"), share: shareSourceOf(scope(link), KEY) });
    await flush();
    // A fast back while the recipe is on its way.
    expect(() => t.tx.navigate({ kind: "back", from: "/cook", pops: true, run: () => runs.push("back") })).not.toThrow();
    expect(t.started[0]!.state.skipped).toBe(true);
    expect(t.style()).toBe("back");
    const header = t.target(KEY, "title");
    t.tx.committed("/recipes/rcp_1");
    await flush();
    expect(header.style.viewTransitionName).toBe("");
    expect(title.style.viewTransitionName).toBe("");
    expect(runs).toEqual(["open", "back"]);
    t.started[1]!.end();
    await flush();
    expect(t.style()).toBeNull();
    expect(t.tx.running()).toBe(false);
  });

  it("survives a double tap before the first capture: both run, in order, and nothing throws", async () => {
    const t = harness();
    const runs: string[] = [];
    t.tx.navigate({ kind: "forward", from: "/cook", run: () => runs.push("first") });
    t.tx.navigate({ kind: "forward", from: "/cook", run: () => runs.push("second") });
    expect(t.started[0]!.state.skipped).toBe(true);
    await flush();
    expect(runs).toEqual(["first", "second"]);
    t.tx.committed("/recipes/rcp_1");
    await flush();
    t.started[1]!.end();
    await flush();
    expect(t.style()).toBeNull();
    expect(t.tx.running()).toBe(false);
  });

  it("ends a running one when a step with nothing to animate comes", async () => {
    const t = harness();
    t.tx.navigate({ kind: "forward", from: "/cook", run: () => undefined });
    await flush();
    t.tx.navigate({ kind: null, from: "/cook", run: () => undefined });
    expect(t.started[0]!.state.skipped).toBe(true);
    expect(t.style()).toBeNull();
  });
});

describe("the browser's own back and forward (popstate)", () => {
  it("animates the system back on Android, holding the new page until the old one is captured", async () => {
    const t = harness();
    t.tx.committed("/recipes/rcp_1");
    t.tx.pop({ kind: "back", from: "/recipes/rcp_1", uaTransition: false });
    expect(t.started).toHaveLength(1);
    expect(t.style()).toBe("back");
    // Next restores /cook right after the event: the frame waits on the gate.
    const gate = t.tx.gateFor("/cook");
    expect(gate).not.toBeNull();
    expect(t.tx.gateFor("/recipes/rcp_1")).toBeNull();
    await flush();
    // Captured: the page may render.
    expect(t.tx.gateFor("/cook")).toBeNull();
    await expect(gate).resolves.toBeUndefined();
    t.tx.committed("/cook");
    await flush();
    expect(t.started[0]!.state.done).toBe(true);
  });

  it("never animates Safari's own swipe back in a browser tab (iOS, not installed)", () => {
    const t = harness({ iosTab: true });
    t.tx.committed("/recipes/rcp_1");
    t.tx.pop({ kind: "back", from: "/recipes/rcp_1", uaTransition: false });
    expect(t.started).toHaveLength(0);
    expect(t.tx.gateFor("/cook")).toBeNull();
  });

  it("never animates a back the browser animated itself (hasUAVisualTransition)", () => {
    const t = harness();
    t.tx.pop({ kind: "back", from: "/recipes/rcp_1", uaTransition: true });
    expect(t.started).toHaveLength(0);
  });

  it("does not animate our own back twice: a Back control's router.back() pops once, already animating", async () => {
    const t = harness();
    t.tx.navigate({ kind: "back", from: "/recipes/rcp_1", pops: true, run: () => undefined });
    await flush();
    t.tx.pop({ kind: "back", from: "/recipes/rcp_1", uaTransition: false });
    expect(t.started).toHaveLength(1);
    // The next system back is the system's again.
    t.tx.committed("/cook");
    t.tx.pop({ kind: "tab", from: "/cook", uaTransition: false });
    expect(t.started).toHaveLength(2);
  });

  it("never holds the new page past the cap, whatever the browser does", async () => {
    const t = harness({ neverUpdates: true });
    t.tx.committed("/recipes/rcp_1");
    t.tx.pop({ kind: "back", from: "/recipes/rcp_1", uaTransition: false });
    expect(t.tx.gateFor("/cook")).not.toBeNull();
    await t.advance(COMMIT_CAP_MS);
    expect(t.tx.gateFor("/cook")).toBeNull();
  });

  it("owns the back and forward's scroll only where it animates them: not without the API, nor in iOS's tab", () => {
    expect(harness().tx.ownsTraversals()).toBe(true);
    expect(harness({ supported: false }).tx.ownsTraversals()).toBe(false);
    expect(harness({ iosTab: true }).tx.ownsTraversals()).toBe(false);
  });

  it("does nothing without the API, or with no kind (outside the app, the same screen)", () => {
    const none = harness({ supported: false });
    none.tx.pop({ kind: "back", from: "/recipes/rcp_1", uaTransition: false });
    const same = harness();
    same.tx.pop({ kind: null, from: "/pantry", uaTransition: false });
    expect([...none.started, ...same.started]).toHaveLength(0);
  });
});

describe("the kitchen Link (linkTransition): next/link's own behaviour unless it is a plain click to another screen", () => {
  const anchor = (attrs: Record<string, string> = {}) => ({ getAttribute: (name: string) => attrs[name] ?? null });
  const click = (patch: Partial<LinkClick> = {}): LinkClick => ({
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    currentTarget: anchor(),
    nativeEvent: { which: 1 },
    ...patch,
  });
  const ctx = (patch: Partial<LinkClickContext> = {}): LinkClickContext => ({
    newFrame: true,
    ready: true,
    supported: true,
    location: { href: "https://stage.cookpool.store/cook", origin: "https://stage.cookpool.store", pathname: "/cook" },
    ...patch,
  });

  it("takes a plain click to another screen, with its kind", () => {
    expect(linkTransition(click(), "/recipes/rcp_1", ctx())).toEqual({ href: "/recipes/rcp_1", kind: "forward" });
    expect(linkTransition(click(), "/money", ctx())).toEqual({ href: "/money", kind: "tab" });
    expect(linkTransition(click(), "/cook/session?recipe=rcp_1&f=450", ctx())).toEqual({ href: "/cook/session?recipe=rcp_1&f=450", kind: "up" });
    expect(linkTransition(click(), "https://stage.cookpool.store/recipes/rcp_1", ctx())?.kind).toBe("forward");
  });

  it("leaves modifier and middle clicks to the browser (a new tab, a new window, a download)", () => {
    for (const patch of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { nativeEvent: { which: 2 } }]) {
      expect(linkTransition(click(patch), "/recipes/rcp_1", ctx())).toBeNull();
    }
    expect(linkTransition(click({ currentTarget: anchor({ target: "_blank" }) }), "/recipes/rcp_1", ctx())).toBeNull();
    expect(linkTransition(click({ currentTarget: anchor({ target: "_self" }) }), "/recipes/rcp_1", ctx())).not.toBeNull();
    expect(linkTransition(click({ currentTarget: anchor({ download: "" }) }), "/recipes/rcp_1", ctx())).toBeNull();
  });

  it("leaves external links, and links Next handles its own way, to next/link", () => {
    expect(linkTransition(click(), "https://wa.me/919800000000", ctx())).toBeNull();
    expect(linkTransition(click(), "mailto:anu@example.com", ctx())).toBeNull();
    expect(linkTransition(click(), { pathname: "/recipes/rcp_1" }, ctx())).toBeNull();
    expect(linkTransition(click({ defaultPrevented: true }), "/recipes/rcp_1", ctx())).toBeNull();
  });

  it("navigates at once (next/link) for the same screen, outside the app, without the API, or before the frame is up", () => {
    expect(linkTransition(click(), "/cook?x=1", ctx())).toBeNull();
    expect(linkTransition(click(), "/login", ctx())).toBeNull();
    expect(linkTransition(click(), "/recipes/rcp_1", ctx({ supported: false }))).toBeNull();
    expect(linkTransition(click(), "/recipes/rcp_1", ctx({ ready: false }))).toBeNull();
  });

  it("is next/link itself in today's frame (newFrame() false): no transition", () => {
    expect(linkTransition(click(), "/recipes/rcp_1", ctx({ newFrame: newFrame({ deployEnv: "prod" }) }))).toBeNull();
  });

  it("renders next/link's markup: the href and attributes pass through, `share` does not", () => {
    const html = renderToStaticMarkup(
      React.createElement(Link, { href: "/recipes/rcp_1", share: shareKey("recipe", "rcp_1"), className: "card", "aria-label": "Chicken curry" }, "Chicken curry"),
    );
    expect(html).toBe('<a class="card" aria-label="Chicken curry" href="/recipes/rcp_1">Chicken curry</a>');
  });
});

describe("the parts that stay put, and the stylesheet", () => {
  const css = readFileSync(`${cwd()}/../../apps/web-console-next/src/styles/globals.css`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));

  it("has a rule for every style, at its duration", () => {
    for (const [style, ms] of Object.entries(TRANSITION_MS)) {
      const own = rules.filter((r) => r.selector.includes(`html[data-vt="${style}"]`));
      expect([style, own.some((r) => r.body.includes(`${ms}ms`))]).toEqual([style, true]);
    }
  });

  it("names the tab bar, the sidebar and the session bar during a step only, with no animation", () => {
    for (const [keep, name] of [
      ["tabs", "kp-tabs"],
      ["sidebar", "kp-sidebar"],
      ["session-bar", "kp-session-bar"],
    ]) {
      const named = rules.find((r) => r.selector === `html[data-vt] [data-vt-keep="${keep}"]`);
      expect(named?.body).toContain(`view-transition-name: ${name}`);
      const still = rules.find((r) => r.selector.includes(`::view-transition-group(${name})`));
      expect(still?.body).toContain("animation: none");
    }
  });

  it("marks the new frame's tab bar to stay put, and today's not at all", () => {
    const tabBar = (frame: boolean) =>
      renderToStaticMarkup(React.createElement(KitchenTabBar, { onAdd: () => undefined, addOpen: false, newFrame: frame }));
    expect(tabBar(true)).toContain('data-vt-keep="tabs"');
    expect(tabBar(false)).not.toContain("data-vt-keep");
  });

  it("keeps a path's identity across a trailing slash, a query and its encoding", () => {
    expect(normalizePath("/recipes/rcp_1/?f=450#steps")).toBe("/recipes/rcp_1");
    expect(normalizePath("/people/usr%5F1")).toBe("/people/usr_1");
    expect(normalizePath("/")).toBe("/");
  });
});
