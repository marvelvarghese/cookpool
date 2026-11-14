"use client";

// Money-native MY-3: the one expanding button. A floating button above the tab
// bar that grows into a box over a dimmed page and shrinks back (the
// ExpandButton board). Three screens use it: `settle` (a person), `expense`
// (Groups) and `people` (People's Settle up). The package owns the motion, the
// dim, the focus and the keyboard; the host owns what is inside the box, which
// it passes as children. Colours are the MY-2 tokens only (./look.ts).

import * as React from "react";
import { look, lookVars, type LookTheme } from "./look.js";

export type ExpandButtonKind = "settle" | "expense" | "people";

export interface ExpandButtonApi {
  /** Close the box (for a Done or Paid button in the content). */
  close: () => void;
  /** Hide the title row (the boards' Done screen has none); the title stays as the dialog's name. */
  setHeaderHidden: (hidden: boolean) => void;
  /** Ask for a taller (or, with `null`, the default) open box, in px: the Custom keypad needs room. */
  setBoxHeight: (height: number | null) => void;
}

const NOOP_API: ExpandButtonApi = { close: () => undefined, setHeaderHidden: () => undefined, setBoxHeight: () => undefined };
const BoxContext = React.createContext<ExpandButtonApi>(NOOP_API);

/** The box a component is inside, for content that mounts below the ExpandButton's children. */
export function useExpandBox(): ExpandButtonApi {
  return React.useContext(BoxContext);
}

/** Hide the title row while the calling component is mounted (a Done screen). */
export function useHideBoxHeader(hidden = true): void {
  const { setHeaderHidden } = useExpandBox();
  React.useEffect(() => {
    setHeaderHidden(hidden);
    return () => setHeaderHidden(false);
  }, [hidden, setHeaderHidden]);
}

/** Ask for an open box of this height while the calling component is mounted (`null`: the default). */
export function useBoxHeight(height: number | null): void {
  const { setBoxHeight } = useExpandBox();
  React.useEffect(() => {
    setBoxHeight(height);
    return () => setBoxHeight(null);
  }, [height, setBoxHeight]);
}

/** The boards' open heights (390x844): top 170, 120 and 300; every open box ends 114px above the bottom. */
export const BOX_HEIGHTS: Record<ExpandButtonKind, number> = { settle: 560, expense: 610, people: 430 };
/** How far the open box's bottom sits above the closed button's bottom: 114 - 96. */
export const OPEN_LIFT = 18;
/** The dim over the page: the boards' literal rgba(27,36,32,.42), the same in both themes. */
export const DIM = "rgba(27,36,32,.42)";
export const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";

export interface ExpandButtonProps {
  /** Which screen the button is on; it sets the icon (a plus for `expense`, a chevron otherwise). */
  kind: ExpandButtonKind;
  /** The button's text and its accessible name ("Settle ₹1,500", "Expense", "Settle up"). */
  label: string;
  theme: LookTheme;
  /** The box's title, shown at the top and used as the dialog's name. Defaults to `label`. */
  title?: string;
  /** What is inside the box: nodes, or a function that is given `close`. The package holds none of its own. */
  children?: React.ReactNode | ((api: ExpandButtonApi) => React.ReactNode);
  /** Height of the open box in px (it never grows past the screen). Default: the board's, by kind (settle 560, expense 610, people 430). */
  boxHeight?: number;
  /** Gap from the screen's bottom to the closed button, in px: the tab bar's height plus a margin. Default 96. */
  bottomOffset?: number;
  /** Accessible name of the X. Default "Close". */
  closeLabel?: string;
  /** Controlled open state; left out, the button keeps its own. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Place it inside the nearest positioned ancestor instead of the screen (a framed preview). */
  contained?: boolean;
  /** Force reduced motion on or off; left out, it follows the `prefers-reduced-motion` setting. */
  reduceMotion?: boolean;
}

/** How long the grow and shrink take (ms), and the longest the reduce-motion fade may take. */
export const EXPAND_MS = 450;
export const EXPAND_FADE_MS = 120;

/** Out of sight but still the dialog's name and in the reading order. */
const HIDDEN: React.CSSProperties = { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

const EASE = "cubic-bezier(.2,.8,.2,1)";
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [reduced, setReduced] = React.useState(get);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function ExpandButton({
  kind, label, theme, title, children, boxHeight, bottomOffset = 96, closeLabel = "Close",
  open: controlled, defaultOpen = false, onOpenChange, contained = false, reduceMotion,
}: ExpandButtonProps) {
  const [inner, setInner] = React.useState(defaultOpen);
  const open = controlled ?? inner;
  const [headerHidden, setHeaderHidden] = React.useState(false);
  const [taller, setTaller] = React.useState<number | null>(null);
  const openHeight = taller ?? boxHeight ?? BOX_HEIGHTS[kind];
  const prefers = usePrefersReducedMotion();
  const reduced = reduceMotion ?? prefers;
  const ms = reduced ? EXPAND_FADE_MS : EXPAND_MS;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlled === undefined) setInner(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const close = React.useCallback(() => setOpen(false), [setOpen]);
  const api = React.useMemo<ExpandButtonApi>(() => ({ close, setHeaderHidden, setBoxHeight: setTaller }), [close]);

  // The content stays mounted while the box shrinks back, then goes.
  const [shown, setShown] = React.useState(open);
  React.useEffect(() => {
    if (open) { setShown(true); return; }
    const t = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);

  // The content mounts at opacity 0 and is switched on once that has been laid out, so the fade
  // (.25s, after .3s) runs on open as it does on the board; a box that starts open shows at once.
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const [contentOn, setContentOn] = React.useState(open);
  React.useEffect(() => {
    if (!open) { setContentOn(false); return; }
    void dialogRef.current?.getBoundingClientRect();
    setContentOn(true);
  }, [open, shown]);

  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const wasOpen = React.useRef(open);
  const titleId = React.useId();

  // Focus moves into the box on open and back to the button on close.
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? dialogRef.current)?.focus();
    } else if (!open && wasOpen.current) {
      buttonRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // Escape closes while the box is open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) { e.preventDefault(); return; }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const geometry = reduced
    ? "none"
    : [...["left", "right", "bottom", "height"].map((p) => `${p} ${ms}ms ${EASE}`), `border-radius ${ms}ms ease`, `background-color ${ms}ms ease`].join(", ");
  const boxStyle: React.CSSProperties = open
    ? { left: 12, right: 12, bottom: bottomOffset + OPEN_LIFT, height: openHeight, maxHeight: `calc(100% - ${bottomOffset + OPEN_LIFT + 24}px)`, borderRadius: 20, background: look.surface }
    : { left: 20, right: 20, bottom: bottomOffset, height: 52, borderRadius: 12, background: look.primary };
  const fade = `opacity ${EXPAND_FADE_MS}ms ease`;
  const icon = kind === "expense"
    ? <path d="M12 5v14M5 12h14" />
    : <path d="M9 5l7 7-7 7" />;

  return (
    <div
      data-expand-button={kind}
      data-look={theme}
      data-open={open ? "true" : "false"}
      style={{ ...(lookVars(theme) as React.CSSProperties), position: contained ? "absolute" : "fixed", inset: 0, pointerEvents: "none", zIndex: 40, color: look.ink, fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}
    >
      <div
        data-expand-dim=""
        aria-hidden="true"
        onClick={close}
        style={{
          position: "absolute", inset: 0, opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
          background: DIM, transition: reduced ? fade : `opacity 300ms ease`,
        }}
      />
      <div
        data-expand-box=""
        style={{
          position: "absolute", overflow: "hidden", zIndex: 1, pointerEvents: open ? "auto" : "none",
          transition: reduced ? "none" : geometry, ...boxStyle,
        }}
      >
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          tabIndex={open ? -1 : 0}
          onClick={() => setOpen(true)}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "transparent", color: look.onPrimary,
            font: "inherit", fontSize: 15, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            cursor: "pointer", opacity: open ? 0 : 1, pointerEvents: open ? "none" : "auto", transition: fade,
          }}
        >
          {kind === "expense" ? (
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">{icon}</svg>
          ) : null}
          <span>{label}</span>
          {kind !== "expense" ? (
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
          ) : null}
        </button>
        {open || shown ? (
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-hidden={open ? undefined : true}
            tabIndex={-1}
            onKeyDown={trapTab}
            style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 12, padding: "16px 20px 20px", boxSizing: "border-box",
              outline: "none", color: look.ink,
              opacity: open && contentOn ? 1 : 0, pointerEvents: open ? "auto" : "none",
              transition: open && !reduced ? `opacity 250ms ease 300ms` : fade,
            }}
          >
            <div style={headerHidden ? HIDDEN : { display: "flex", alignItems: "center", height: 36 }}>
              <h2 id={titleId} style={{ margin: 0, flex: 1, fontSize: 18, fontWeight: 500 }}>{title ?? label}</h2>
              <button
                type="button"
                aria-label={closeLabel}
                tabIndex={headerHidden ? -1 : 0}
                aria-hidden={headerHidden ? true : undefined}
                onClick={close}
                style={{ width: 44, height: 44, marginRight: -12, border: 0, background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={look.muted} strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
              <BoxContext.Provider value={api}>{typeof children === "function" ? children(api) : children}</BoxContext.Provider>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
