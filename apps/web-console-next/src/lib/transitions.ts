/**
 * Page transitions (cookpool-recipes RC-11, design §1.6): the View
 * Transitions API, with no animation library, for the new frame's client
 * navigations. Next 15.0.3 has no `onNavigate` or `viewTransition` of its
 * own, so the kitchen wraps its navigations itself:
 *
 *   document.startViewTransition(async () => { router.push(href); await committed })
 *
 * The browser captures the page that leaves, runs the update, waits for the
 * new page to render (the frame's pathname effect says so, `committed`), then
 * animates from one to the other by the kind of the step, which is set on
 * `<html data-vt>` for the CSS (globals.css): a tab cross-fades, deeper slides
 * in from the right, back slides out, the cooking session rises and falls.
 *
 * This file is the mechanics alone — no React, no Next, no route model (the
 * kind of a step is `components/kitchen/transitions.ts`'s) — over an
 * injected environment, so every rule here is unit-tested:
 *  - no `startViewTransition` (iOS before 18): the navigation runs at once;
 *  - reduced motion: a plain 100 ms fade; from 900 px: a 120 ms fade;
 *  - a slow page never freezes the old screenshot: the wait for it is capped
 *    at 350 ms, and a page that is not there by then switches without an
 *    animation, rather than animating a stale frame;
 *  - Safari's own back swipe in a tab (iOS, not installed), or any browser
 *    that animated a back itself (`hasUAVisualTransition`), is not animated
 *    a second time;
 *  - after the installed iPhone's edge swipe (PW-7) has slid the page away,
 *    back only fades the new page in (`swiped`);
 *  - a swipe between tabs (cookpool-revamp RV-9) slides the page out the
 *    way the finger went and the next tab in after it (`tabSwiped`);
 *  - a tapped card's title and tile carry into the page they open: the
 *    names go on the tapped card only, just before the capture, move to the
 *    new page's matching parts, and are cleared when it ends;
 *  - a second navigation while one runs (a double tap, a quick back) skips
 *    the first and clears its names: nothing throws, nothing stays named;
 *  - the animation never holds a navigation: if the browser does not capture
 *    the old page within 500 ms (no frame comes), it navigates without one.
 */

import { INSTALLED_DISPLAY_MODES, isIos } from "./install";

// ── Kinds and styles ──────────────────────────────────────────────

/** What a step is (the route model's call): between tabs, deeper, back up, into the cooking session, out of it. */
export type TransitionKind = "tab" | "forward" | "back" | "up" | "down";

/**
 * What plays, on `<html data-vt>`: the kind on a phone, or one of three
 * plainer ones — `fade` from 900 px (the sidebar's desktop), `reduced` with
 * reduced motion, `swiped` after the edge swipe has moved the page already —
 * or a swipe between tabs (RV-9): `swipe-next` (the finger went left: the page
 * leaves to the left, the next tab comes in from the right) and `swipe-prev`.
 */
export type TransitionStyle = TransitionKind | "fade" | "reduced" | "swiped" | "swipe-next" | "swipe-prev";

/** Which way a swipe between tabs went: to the next tab (a swipe left) or the previous one. */
export type TabSwipeDirection = "next" | "prev";

/** How long each style runs, in ms (globals.css says the same): every one under 300. */
export const TRANSITION_MS: Readonly<Record<TransitionStyle, number>> = {
  tab: 150,
  forward: 280,
  back: 280,
  up: 280,
  down: 240,
  fade: 120,
  reduced: 100,
  swiped: 150,
  "swipe-next": 240,
  "swipe-prev": 240,
};

/** The longest the old page's screenshot waits for the new page (and its shared parts). */
export const COMMIT_CAP_MS = 350;

/**
 * The longest a navigation waits for the browser to capture the old page (a
 * frame). A page the browser does not paint — hidden in all but name — would
 * otherwise never navigate: past this it navigates without the animation.
 */
export const CAPTURE_CAP_MS = 500;

/** From this width the sidebar is up (the desktop): every kind is the plain fade. */
export const WIDE_MIN_PX = 900;

/** The attribute on `<html>` the CSS keys on. */
export const VT_ATTR = "data-vt";

export interface StyleContext {
  /** At least 900 px wide. */
  wide: boolean;
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
  /** The installed iPhone's edge swipe has slid the page away already. */
  swiped: boolean;
  /** A swipe between tabs is running this step, and which way (RV-9). */
  tabSwipe?: TabSwipeDirection | null | undefined;
}

/** What plays for a kind: reduced motion and the desktop fade first, then the swipe's, else the kind itself. */
export function transitionStyle(kind: TransitionKind, ctx: StyleContext): TransitionStyle {
  if (ctx.reducedMotion) return "reduced";
  if (ctx.wide) return "fade";
  if (ctx.swiped) return "swiped";
  if (ctx.tabSwipe) return ctx.tabSwipe === "next" ? "swipe-next" : "swipe-prev";
  return kind;
}

/** Whether a style carries shared parts (a phone's moving kinds; never the plain fades). */
export function carriesShared(style: TransitionStyle): boolean {
  return style === "tab" || style === "forward" || style === "back" || style === "up" || style === "down";
}

// ── Shared parts: a card's title and tile ─────────────────────────

/** On a card's part that may travel: its part's name (`title`, `tile`). */
export const SHARE_PART_ATTR = "data-vt-part";
/** On the destination's part: which thing it is (`recipe:rcp_1`), beside its part's name. */
export const SHARE_FOR_ATTR = "data-vt-for";
/** On a card whose link is not around all of its parts (the tile beside the link): the parts are looked for in it. */
export const SHARE_CARD_ATTR = "data-vt-card";

/** What a shared part's key names: a recipe or a dish, by its id. */
export function shareKey(kind: "recipe" | "dish", id: string): string {
  return `${kind}:${id}`;
}

/** The `view-transition-name` a part wears while it travels. */
export function shareName(part: string): string {
  return `kp-share-${part.replace(/[^a-z0-9-]/gi, "")}`;
}

/** A card's part that may travel (its title, its tile): spread it on the element. */
export function sharePart(part: string): Record<string, string> {
  return { [SHARE_PART_ATTR]: part };
}

/** The destination's matching part, for the thing `key` names: spread it on the element. */
export function shareTarget(key: string, part: string): Record<string, string> {
  return { [SHARE_PART_ATTR]: part, [SHARE_FOR_ATTR]: key };
}

/** An element as the transitions touch it (a fake in tests). */
export interface NamedElement {
  style: { viewTransitionName: string };
  getAttribute(name: string): string | null;
}

/** Where a tapped card's parts are looked for (the link, or the card around it). */
export interface ShareScope {
  closest(selector: string): ShareScope | null;
  querySelectorAll(selector: string): ArrayLike<NamedElement>;
}

/** What travels with a step: the thing's key and the tapped card's parts. */
export interface ShareSource {
  key: string;
  parts: ReadonlyArray<{ part: string; el: NamedElement }>;
}

/**
 * The tapped link's parts that travel: inside the link, or inside the card
 * it sits in (`data-vt-card`), one element per part, never a destination's.
 */
export function shareSourceOf(anchor: ShareScope, key: string): ShareSource {
  const scope = anchor.closest(`[${SHARE_CARD_ATTR}]`) ?? anchor;
  const found = scope.querySelectorAll(`[${SHARE_PART_ATTR}]:not([${SHARE_FOR_ATTR}])`);
  const parts: { part: string; el: NamedElement }[] = [];
  for (let i = 0; i < found.length; i++) {
    const el = found[i]!;
    const part = el.getAttribute(SHARE_PART_ATTR);
    if (part && !parts.some((p) => p.part === part)) parts.push({ part, el });
  }
  return { key, parts };
}

// ── The environment ───────────────────────────────────────────────

/** The part of a `ViewTransition` used here. */
export interface ViewTransitionLike {
  readonly ready: Promise<unknown>;
  readonly finished: Promise<unknown>;
  readonly updateCallbackDone: Promise<unknown>;
  skipTransition(): void;
}

/** What the transitions ask of the browser (a fake in tests). */
export interface TransitionEnv {
  /** `document.startViewTransition` exists. */
  supported(): boolean;
  /** `document.startViewTransition(update)`. */
  start(update: () => Promise<void>): ViewTransitionLike;
  /** `<html data-vt>`: the style that plays, or none. */
  setStyle(style: TransitionStyle | null): void;
  reducedMotion(): boolean;
  wide(): boolean;
  /** The page is in the background: nothing to animate. */
  hidden(): boolean;
  /** Safari or another iOS browser in a tab, not the installed app: it swipes back with its own animation. */
  iosTab(): boolean;
  /** The destination's part for `key`, once it is on the page. */
  findTarget(key: string, part: string): NamedElement | null;
  /** Calls `onChange` on every change to the page until the returned stop is called. */
  watch(onChange: () => void): () => void;
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

// ── The transitions ───────────────────────────────────────────────

export interface NavigationRequest {
  /** The step's kind, or null for none (another frame, the same page, outside the app): it just runs. */
  kind: TransitionKind | null;
  /** The pathname shown now: the page that leaves. */
  from: string;
  /** The router's call (`router.push(href)`, `router.back()`). */
  run: () => void;
  /** It goes back in the browser's history (`router.back()`): its `popstate` is ours, not the system's. */
  pops?: boolean | undefined;
  /** The tapped card's parts that travel. */
  share?: ShareSource | null | undefined;
}

export interface PopRequest {
  /** The step's kind, from where the history landed. */
  kind: TransitionKind | null;
  /** The pathname that was shown. */
  from: string;
  /** The browser animated this back itself (`PopStateEvent.hasUAVisualTransition`). */
  uaTransition: boolean;
}

export interface Transitions {
  /** Whether the browser can animate (`startViewTransition` exists). */
  supported(): boolean;
  /**
   * Whether the frame animates the browser's back and forward itself (it can,
   * and it is not iOS in a tab, whose own swipe animates them): then it also
   * restores their scroll, which the browser would otherwise apply to the old
   * page before it is captured.
   */
  ownsTraversals(): boolean;
  /** Runs a navigation, animated when it can be. */
  navigate(request: NavigationRequest): void;
  /** The browser's back or forward (`popstate`, in the capture phase): animated when it is not already. */
  pop(request: PopRequest): void;
  /** The frame rendered a pathname (its pathname effect). */
  committed(pathname: string): void;
  /** The last pathname the frame rendered. */
  shown(): string | null;
  /**
   * While a back or forward waits for the old page to be captured: what the
   * frame suspends on before it renders `pathname` (React's `use`), so the
   * new page cannot paint over the screenshot. Null otherwise.
   */
  gateFor(pathname: string): Promise<void> | null;
  /** Runs `back` as the edge swipe's (PW-7): the page has moved already, so back only fades. */
  swiped<T>(back: () => T): T;
  /** Runs `go` as a swipe between tabs (RV-9): its step slides the way the finger went. */
  tabSwiped<T>(direction: TabSwipeDirection, go: () => T): T;
  /** A transition is running (tests). */
  running(): boolean;
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** A pathname as the frame compares them: no query or hash, no trailing slash, decoded. */
export function normalizePath(path: string): string {
  let p = path.split(/[?#]/)[0] ?? "";
  if (p.length > 1) p = p.replace(/\/+$/, "");
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

interface Running {
  vt: ViewTransitionLike | null;
  /** The elements this transition named: the card's, then the new page's. */
  named: NamedElement[];
}

const quiet = (): void => undefined;

export function createTransitions(env: TransitionEnv): Transitions {
  let current: Running | null = null;
  let shownPath: string | null = null;
  let ownPop = false;
  let swiping = false;
  let tabSwipe: TabSwipeDirection | null = null;
  const waiters = new Set<{ from: string; done: (ok: boolean) => void }>();
  let gate: { promise: Promise<void>; open: () => void; done: boolean } | null = null;

  const unname = (running: Running) => {
    for (const el of running.named) el.style.viewTransitionName = "";
    running.named.length = 0;
  };

  const settle = (running: Running) => {
    unname(running);
    if (current !== running) return;
    current = null;
    env.setStyle(null);
  };

  // A new step overtakes the one running: it ends now and gives up its names.
  const interrupt = () => {
    const was = current;
    if (!was) return;
    current = null;
    unname(was);
    try {
      was.vt?.skipTransition();
    } catch {
      // Already over.
    }
  };

  const canAnimate = () => env.supported() && !env.hidden();

  // The new page rendered (true), or the cap passed (false). A page that
  // changed already, before this step's update ran (one it overtook), counts.
  const waitForCommit = (from: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      if (shownPath !== null && !samePath(shownPath, from)) {
        resolve(true);
        return;
      }
      let timer: unknown = null;
      const waiter = {
        from,
        done: (ok: boolean) => {
          if (!waiters.delete(waiter)) return;
          env.clearTimeout(timer);
          if (!ok) ownPop = false;
          resolve(ok);
        },
      };
      waiters.add(waiter);
      timer = env.setTimeout(() => waiter.done(false), ms);
    });

  // The new page's parts take the names the card gave up, as they appear, until the deadline.
  const nameTargets = (running: Running, key: string, parts: readonly string[], deadline: number) =>
    new Promise<void>((resolve) => {
      const pending = new Set(parts);
      let finished = false;
      let stop: () => void = quiet;
      let timer: unknown = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        stop();
        if (timer !== null) env.clearTimeout(timer);
        resolve();
      };
      const look = () => {
        if (finished) return;
        if (current !== running) return finish();
        for (const part of [...pending]) {
          const el = env.findTarget(key, part);
          if (!el) continue;
          el.style.viewTransitionName = shareName(part);
          running.named.push(el);
          pending.delete(part);
        }
        if (pending.size === 0) finish();
      };
      look();
      if (finished) return;
      stop = env.watch(look);
      timer = env.setTimeout(finish, Math.max(0, deadline - env.now()));
    });

  const animate = (style: TransitionStyle, request: NavigationRequest) => {
    interrupt();
    const running: Running = { vt: null, named: [] };
    current = running;
    const share = request.share && carriesShared(style) && request.share.parts.length > 0 ? request.share : null;
    // Only the tapped card's parts, just before the old page is captured.
    if (share) {
      for (const { part, el } of share.parts) {
        el.style.viewTransitionName = shareName(part);
        running.named.push(el);
      }
    }
    env.setStyle(style);

    // The router's call, once: from the update, or from the capture's cap.
    let ran = false;
    const runOnce = () => {
      if (ran) return false;
      ran = true;
      unname(running);
      if (request.pops) ownPop = true;
      request.run();
      return true;
    };
    let captureCap: unknown = null;

    const update = async () => {
      env.clearTimeout(captureCap);
      const deadline = env.now() + COMMIT_CAP_MS;
      // Captured: the card gives up its names before the new page can take them.
      if (!runOnce()) return;
      const ok = await waitForCommit(request.from, COMMIT_CAP_MS);
      if (current !== running) return;
      if (!ok) {
        // A slow page: it switches without an animation when it comes, never a stale frame animated.
        running.vt?.skipTransition();
        return;
      }
      if (share) await nameTargets(running, share.key, share.parts.map((p) => p.part), deadline);
    };

    let vt: ViewTransitionLike;
    try {
      vt = env.start(update);
    } catch {
      unname(running);
      current = null;
      env.setStyle(null);
      request.run();
      return;
    }
    running.vt = vt;
    captureCap = env.setTimeout(() => {
      if (!runOnce()) return;
      try {
        vt.skipTransition();
      } catch {
        // Already over.
      }
      settle(running);
    }, CAPTURE_CAP_MS);
    vt.ready.catch(quiet);
    vt.updateCallbackDone.catch(quiet);
    vt.finished.then(
      () => settle(running),
      () => settle(running),
    );
  };

  return {
    supported: () => env.supported(),

    ownsTraversals: () => env.supported() && !env.iosTab(),

    navigate(request) {
      const style = request.kind && canAnimate() ? transitionStyle(request.kind, { wide: env.wide(), reducedMotion: env.reducedMotion(), swiped: swiping, tabSwipe }) : null;
      if (!style) {
        if (current) {
          interrupt();
          env.setStyle(null);
        }
        request.run();
        return;
      }
      animate(style, request);
    },

    pop({ kind, from, uaTransition }) {
      if (ownPop) {
        // Our own back (a Back control, the edge swipe): it is animating already.
        ownPop = false;
        return;
      }
      if (!kind || uaTransition || env.iosTab() || !canAnimate()) return;
      const style = transitionStyle(kind, { wide: env.wide(), reducedMotion: env.reducedMotion(), swiped: false });
      // Next restores the page in a transition right after this; the frame holds
      // it on the gate until the old page is captured (the update starts).
      let open: () => void = quiet;
      const promise = new Promise<void>((resolve) => {
        open = resolve;
      });
      const g = {
        promise,
        done: false,
        open: () => {
          if (g.done) return;
          g.done = true;
          if (gate === g) gate = null;
          open();
        },
      };
      gate = g;
      // Never held for long, whatever the browser does.
      env.setTimeout(g.open, COMMIT_CAP_MS);
      animate(style, { kind, from, run: g.open });
    },

    committed(pathname) {
      shownPath = normalizePath(pathname);
      ownPop = false;
      for (const waiter of [...waiters]) {
        if (!samePath(waiter.from, pathname)) waiter.done(true);
      }
    },

    shown: () => shownPath,

    gateFor(pathname) {
      if (!gate || gate.done) return null;
      return shownPath !== null && samePath(shownPath, pathname) ? null : gate.promise;
    },

    swiped(back) {
      swiping = true;
      try {
        return back();
      } finally {
        swiping = false;
      }
    },

    tabSwiped(direction, go) {
      tabSwipe = direction;
      try {
        return go();
      } finally {
        tabSwipe = null;
      }
    },

    running: () => current !== null,
  };
}

// ── The browser's ─────────────────────────────────────────────────

function matches(query: string): boolean {
  try {
    return window.matchMedia?.(query).matches === true;
  } catch {
    return false;
  }
}

function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/** The environment of a page in the browser. */
export function browserTransitionEnv(): TransitionEnv {
  return {
    supported: () => typeof document.startViewTransition === "function",
    start: (update) => document.startViewTransition(update),
    setStyle(style) {
      if (style) document.documentElement.setAttribute(VT_ATTR, style);
      else document.documentElement.removeAttribute(VT_ATTR);
    },
    reducedMotion: () => matches("(prefers-reduced-motion: reduce)"),
    wide: () => matches(`(min-width: ${WIDE_MIN_PX}px)`),
    hidden: () => document.visibilityState === "hidden",
    iosTab() {
      const nav = navigator as Navigator & { standalone?: boolean };
      const installed = nav.standalone === true || INSTALLED_DISPLAY_MODES.some((mode) => matches(`(display-mode: ${mode})`));
      return !installed && isIos(nav.userAgent, nav.maxTouchPoints ?? 0);
    },
    findTarget: (key, part) =>
      document.querySelector<HTMLElement>(`[${SHARE_FOR_ATTR}="${cssString(key)}"][${SHARE_PART_ATTR}="${cssString(part)}"]`),
    watch(onChange) {
      if (typeof MutationObserver === "undefined") return quiet;
      const observer = new MutationObserver(onChange);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    now: () => Date.now(),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
  };
}

/** Where nothing animates (the server, a prerender): every navigation just runs. */
const NO_TRANSITIONS: TransitionEnv = {
  supported: () => false,
  start: () => {
    throw new Error("No view transitions here");
  },
  setStyle: quiet,
  reducedMotion: () => false,
  wide: () => false,
  hidden: () => true,
  iosTab: () => false,
  findTarget: () => null,
  watch: () => quiet,
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** The page's transitions: one per page load. */
export const transitions: Transitions = createTransitions(typeof window === "undefined" ? NO_TRANSITIONS : browserTransitionEnv());
