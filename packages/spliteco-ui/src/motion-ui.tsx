"use client";

// Money-native MY-22: the motion primitives. Each reads the one set of timings
// in ./motion.ts and follows prefers-reduced-motion (or the `reduceMotion`
// prop, for a test or a framed preview). They animate transform and opacity
// (and a grid row's height, for rows that come and go); every change is a CSS
// transition, so one that is reversed mid-flight turns round from where it is
// and nothing waits on it.

import * as React from "react";
import {
  MOTION, durationOf, enterTransform, leaveTransform, transitionOf, tween,
  type MotionDirection,
} from "./motion.js";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True while the person has asked for reduced motion; follows the setting live. */
export function usePrefersReducedMotion(): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
  const [reduced, setReduced] = React.useState(get);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/** `reduceMotion` if given, else the setting. */
export function useReducedMotion(force?: boolean): boolean {
  const prefers = usePrefersReducedMotion();
  return force ?? prefers;
}

/** Calls `fn` two frames from now (so the "from" state has been painted); returns a cancel. */
function afterFrames(fn: () => void): () => void {
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
  const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (id: number) => clearTimeout(id);
  let second = 0;
  const first = raf(() => { second = raf(fn); });
  return () => { cancel(first); cancel(second); };
}

/** True one frame after mount: the first paint is the "from" state, the next the "to" state, so a transition runs. */
function useArmed(initial: boolean): boolean {
  const [armed, setArmed] = React.useState(initial);
  React.useEffect(() => (armed ? undefined : afterFrames(() => setArmed(true))), [armed]);
  return armed;
}

export type SwapMode = "drift" | "slide";

interface Layer { key: string; node: React.ReactNode; dir: MotionDirection; scrollY: number }

export interface MotionSwapProps {
  /** Which page is showing. When it changes the old page leaves and the new one enters. */
  k: string;
  /** `drift`: cross-fade with an 8-12px drift (the Groups | People pages). `slide`: the new page slides in from the right and the old shifts left and dims; `back` reverses it. */
  mode: SwapMode;
  /** +1 forward (the new page comes from the right, or the drift goes left), -1 back. */
  direction?: MotionDirection;
  reduceMotion?: boolean;
  children?: React.ReactNode;
  /** Called with `true` while a change is running and `false` when it has settled. */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Keeps the page that is leaving mounted while the new one enters. Layers are keyed by `k`, so going back to
 * a page that is still leaving reuses it and the CSS transition turns round from wherever it had got to.
 * A leaving page takes no taps. The container grows or shrinks to the new page's height in `drift` mode.
 */
export function MotionSwap({ k, mode, direction = 1, reduceMotion, children, onBusyChange }: MotionSwapProps) {
  const reduced = useReducedMotion(reduceMotion);
  const ms = durationOf(mode === "slide" ? "geometry" : "fade", reduced);
  const last = React.useRef<Layer>({ key: k, node: children, dir: direction, scrollY: 0 });
  const [leaving, setLeaving] = React.useState<Layer[]>([]);
  const prevKey = React.useRef(k);
  const dirRef = React.useRef(direction);

  // A new key: the page that was showing becomes a leaving layer, and one that was already leaving and is wanted again leaves the list.
  if (prevKey.current !== k) {
    const snapshot: Layer = { ...last.current, dir: direction, scrollY: typeof window === "undefined" ? 0 : window.scrollY };
    dirRef.current = direction;
    prevKey.current = k;
    setLeaving((cur) => [...cur.filter((l) => l.key !== k && l.key !== snapshot.key), snapshot]);
  }
  React.useLayoutEffect(() => { last.current = { key: k, node: children, dir: dirRef.current, scrollY: 0 }; });

  React.useEffect(() => {
    onBusyChange?.(leaving.length > 0);
    if (leaving.length === 0) return;
    const t = setTimeout(() => setLeaving([]), ms + 30);
    return () => clearTimeout(t);
  }, [leaving, ms, onBusyChange]);

  // The container eases to the height of the page that is now showing (drift mode).
  const hostRef = React.useRef<HTMLDivElement>(null);
  const currentRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | null>(null);
  React.useEffect(() => {
    const el = currentRef.current;
    if (mode !== "drift" || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, k]);

  const layers = [...leaving.map((l) => ({ ...l, role: "leaving" as const })), { key: k, node: children, dir: dirRef.current, scrollY: 0, role: "current" as const }];
  const forward = (d: MotionDirection) => d > 0;
  return (
    <div
      ref={hostRef}
      data-motion-swap={mode}
      data-busy={leaving.length > 0 ? "true" : "false"}
      style={{
        position: "relative",
        height: mode === "drift" && leaving.length > 0 && height !== null ? height : undefined,
        transition: mode === "drift" ? transitionOf("geometry", ["height"], reduced) : undefined,
        overflow: mode === "slide" ? "clip" : undefined,
      }}
    >
      {layers.map((l) => (
        <SwapLayer
          key={l.key}
          layerKey={l.key}
          role={l.role}
          mode={mode}
          dir={l.dir}
          reduced={reduced}
          scrollY={l.scrollY}
          animateIn={l.role === "current" && prevKey.current !== undefined && leaving.length > 0}
          dimmed={mode === "slide" && (l.role === "leaving" ? forward(l.dir) : false)}
          innerRef={l.role === "current" ? currentRef : undefined}
        >
          {l.node}
        </SwapLayer>
      ))}
    </div>
  );
}

interface SwapLayerProps {
  layerKey: string;
  role: "current" | "leaving";
  mode: SwapMode;
  dir: MotionDirection;
  reduced: boolean;
  scrollY: number;
  animateIn: boolean;
  dimmed: boolean;
  innerRef?: React.Ref<HTMLDivElement> | undefined;
  children?: React.ReactNode;
}

function SwapLayer({ layerKey, role, mode, dir, reduced, scrollY, animateIn, dimmed, innerRef, children }: SwapLayerProps) {
  // A layer that mounts while another is leaving starts at the "from" state and is armed a frame later.
  const armed = useArmed(!animateIn);
  const at = role === "current" ? (armed ? "rest" : "from") : "to";
  const reversing = mode === "slide" && dir < 0;
  let transform = "none";
  let opacity = 1;
  if (!reduced) {
    if (at === "from") transform = enterTransform(mode, dir);
    if (at === "to") transform = leaveTransform(mode, dir);
  }
  if (mode === "drift" && at !== "rest") opacity = 0;
  if (reduced && at !== "rest") opacity = 0;
  // A page sliding back in starts shifted and dim; the page under a forward slide ends shifted and dim.
  const dim = mode === "slide" && ((role === "leaving" && !reversing) || (role === "current" && at === "from" && reversing));
  void dimmed;
  const leavingBox: React.CSSProperties = role === "leaving"
    ? { position: mode === "slide" ? "fixed" : "absolute", inset: 0, top: mode === "slide" ? -scrollY : 0, overflow: mode === "slide" ? "hidden" : undefined, pointerEvents: "none", zIndex: mode === "slide" && reversing ? 2 : 1 }
    : { position: "relative", zIndex: mode === "slide" && !reversing ? 2 : 1 };
  return (
    <div
      ref={innerRef}
      data-layer={layerKey}
      data-role={role}
      data-at={at}
      aria-hidden={role === "leaving" ? true : undefined}
      style={{
        ...leavingBox,
        transform,
        opacity,
        willChange: "transform, opacity",
        transition: transitionOf("geometry", ["transform"], reduced) === "none"
          ? transitionOf("fade", ["opacity"], reduced)
          : `${transitionOf("geometry", ["transform"], reduced)}, ${transitionOf("fade", ["opacity"], reduced)}`,
      }}
    >
      {children}
      {mode === "slide" ? (
        <div
          data-layer-dim=""
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, pointerEvents: "none", background: MOTION.pageDim, opacity: dim ? 1 : 0, transition: `opacity ${reduced ? MOTION.reducedMs : MOTION.dimMs}ms ease` }}
        />
      ) : null}
    </div>
  );
}

export interface MotionSheetProps {
  open: boolean;
  /** Tapping the dim closes it. */
  onClose?: () => void;
  reduceMotion?: boolean;
  /** The sheet's name for assistive technology. */
  label: string;
  children?: React.ReactNode;
  /** Colour of the sheet's panel (a token). */
  background?: string;
}

/**
 * A sheet: the dim fades in over .3s and the panel slides up from the bottom over .45s; closing reverses
 * both. It stays mounted until the slide-out is done, and opening it again mid-close turns it round.
 */
export function MotionSheet({ open, onClose, reduceMotion, label, children, background = "var(--look-surface)" }: MotionSheetProps) {
  const reduced = useReducedMotion(reduceMotion);
  const [mounted, setMounted] = React.useState(open);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      return afterFrames(() => setShown(true));
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), durationOf("geometry", reduced) + 30);
    return () => clearTimeout(t);
  }, [open, reduced]);
  const on = open && shown;
  if (!mounted) return null;
  return (
    <div data-motion-sheet={on ? "open" : "closed"} style={{ position: "fixed", inset: 0, zIndex: 50, pointerEvents: open ? "auto" : "none" }}>
      <div
        data-sheet-dim=""
        aria-hidden="true"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(27,36,32,.42)", opacity: on ? 1 : 0, transition: `opacity ${reduced ? MOTION.reducedMs : MOTION.dimMs}ms ease` }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-sheet-panel=""
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, background, color: "var(--look-ink)",
          borderRadius: "22px 22px 0 0", maxHeight: "92%", overflow: "auto",
          transform: reduced || on ? "none" : "translate3d(0,100%,0)",
          opacity: reduced ? (on ? 1 : 0) : 1,
          transition: reduced ? transitionOf("fade", ["opacity"], true) : transitionOf("geometry", ["transform"]),
          willChange: "transform",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export interface CollapseProps {
  open: boolean;
  reduceMotion?: boolean;
  /** Start closed and open on mount (a row that was just added). */
  enter?: boolean;
  children?: React.ReactNode;
}

/** A row that eases its height (and fades) as it comes or goes: a grid track from 0fr to 1fr, so it needs no measuring. */
export function Collapse({ open, reduceMotion, enter = false, children }: CollapseProps) {
  const reduced = useReducedMotion(reduceMotion);
  const armed = useArmed(!enter);
  const on = open && armed;
  return (
    <div
      data-collapse={on ? "open" : "closed"}
      style={{
        display: "grid",
        gridTemplateRows: on ? "1fr" : "0fr",
        opacity: on ? 1 : 0,
        transition: reduced ? transitionOf("fade", ["opacity"], true) : `grid-template-rows ${MOTION.geometryMs}ms ${MOTION.ease}, ${transitionOf("fade", ["opacity"])}`,
      }}
    >
      <div style={{ overflow: "hidden", minHeight: 0 }} inert={!on ? true : undefined}>{children}</div>
    </div>
  );
}

export interface PresenceListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  render: (item: T) => React.ReactNode;
  reduceMotion?: boolean;
}

/** A list whose rows ease in when added and ease out (staying until they have gone) when removed. */
export function PresenceList<T>({ items, getKey, render, reduceMotion }: PresenceListProps<T>) {
  const reduced = useReducedMotion(reduceMotion);
  const seen = React.useRef(new Map<string, T>());
  const first = React.useRef(true);
  const [gone, setGone] = React.useState<string[]>([]);
  const currentKeys = new Set(items.map(getKey));
  const isFirst = first.current;
  React.useEffect(() => { first.current = false; }, []);
  // Rows that are no longer in `items` stay (closed) until their height has eased away.
  const leaving = [...seen.current.keys()].filter((key) => !currentKeys.has(key) && !gone.includes(key));
  React.useEffect(() => {
    if (leaving.length === 0) return;
    const t = setTimeout(() => {
      setGone((g) => [...g, ...leaving]);
      for (const key of leaving) seen.current.delete(key);
    }, durationOf("geometry", reduced) + 30);
    return () => clearTimeout(t);
  });
  const added = new Set(items.map(getKey).filter((key) => !seen.current.has(key)));
  const rows: { key: string; item: T; open: boolean }[] = items.map((item) => ({ key: getKey(item), item, open: true }));
  for (const key of leaving) {
    const item = seen.current.get(key);
    if (item !== undefined) rows.push({ key, item, open: false });
  }
  for (const item of items) seen.current.set(getKey(item), item);
  return (
    <>
      {rows.map((r) => (
        <Collapse key={r.key} open={r.open} enter={!isFirst && added.has(r.key)} {...(reduceMotion === undefined ? {} : { reduceMotion })}>{render(r.item)}</Collapse>
      ))}
    </>
  );
}

export interface AmountProps {
  /** The amount in minor units; when it changes the text counts to the new one. */
  value: number;
  format: (value: number) => string;
  reduceMotion?: boolean;
}

/** A balance that counts to its new value over .45s when it changes (after a payment); instant under reduced motion. */
export function Amount({ value, format, reduceMotion }: AmountProps) {
  const reduced = useReducedMotion(reduceMotion);
  const [shown, setShown] = React.useState(value);
  const from = React.useRef(value);
  React.useEffect(() => {
    if (reduced || from.current === value || typeof requestAnimationFrame !== "function") { from.current = value; setShown(value); return; }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = (now - t0) / MOTION.geometryMs;
      from.current = tween(start, value, t);
      setShown(from.current);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <span data-amount-value={value}>{format(shown)}</span>;
}
