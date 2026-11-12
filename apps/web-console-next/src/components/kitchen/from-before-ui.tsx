"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
  FROM_BEFORE_DEBOUNCE_MS,
  TYPEAHEAD_CLOSED,
  createDebounce,
  fromBeforeTerm,
  typeaheadKey,
  type SuggestionView,
  type TypeaheadState,
} from "./from-before";

/**
 * The "from before" type-ahead (SM-9): the name field becomes a combobox and
 * the suggestions sit directly under it, one 44 px row each — the only thing
 * the type-ahead adds to a screen (rule 4). The field keeps focus while a row
 * is tapped; ↑/↓ move, Enter picks, Esc closes. On a phone the list is kept
 * above the keyboard and the sticky bars (rule 1).
 */

/** `value`, once it has been still for `ms` (at once when `now` says so). */
export function useDebouncedValue<T>(value: T, ms: number, now?: (value: T) => boolean): T {
  const [settled, setSettled] = React.useState(value);
  const nowRef = React.useRef(now);
  nowRef.current = now;
  const debounce = React.useMemo(() => createDebounce<T>(ms, setSettled, (v) => nowRef.current?.(v) ?? false), [ms]);
  React.useEffect(() => {
    debounce.push(value);
  }, [debounce, value]);
  React.useEffect(() => () => debounce.cancel(), [debounce]);
  return settled;
}

export interface Typeahead {
  /** What to ask for: the typed text, normalized, once the typing pauses (an emptied field at once). */
  term: string;
  /** The field has focus and the list was not closed (Esc, a pick). */
  open: boolean;
  /** The highlighted suggestion, or -1. */
  active: number;
  /** The props that make the field a combobox over `count` suggestions. */
  inputProps(opts: {
    count: number;
    onPick: (index: number) => void;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
  }): React.InputHTMLAttributes<HTMLInputElement>;
  highlight(index: number): void;
  close(): void;
}

export function useTypeahead(text: string, listId: string): Typeahead {
  const [state, setState] = React.useState<TypeaheadState>(TYPEAHEAD_CLOSED);
  const term = useDebouncedValue(fromBeforeTerm(text), FROM_BEFORE_DEBOUNCE_MS, (t) => t === "");
  const close = React.useCallback(() => setState(TYPEAHEAD_CLOSED), []);
  const reopen = () => setState((s) => (s.open ? s : { open: true, active: -1 }));
  return {
    term,
    open: state.open,
    active: state.active,
    close,
    highlight: (index) => setState({ open: true, active: index }),
    inputProps: ({ count, onPick, onChange }) => {
      const expanded = state.open && count > 0;
      return {
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": expanded,
        "aria-controls": expanded ? listId : undefined,
        "aria-activedescendant": expanded && state.active >= 0 && state.active < count ? `${listId}-${state.active}` : undefined,
        // Focus opens the list, and so does a tap on the field once Esc or a pick closed it.
        onFocus: reopen,
        onClick: reopen,
        onBlur: close,
        onChange: (e) => {
          setState({ open: true, active: -1 });
          onChange(e);
        },
        onKeyDown: (e) => {
          if (e.nativeEvent.isComposing) return;
          const r = typeaheadKey(state, e.key, count);
          if (!r.handled) return;
          e.preventDefault();
          setState(r.state);
          if (r.pick !== null) onPick(r.pick);
        },
      };
    },
  };
}

/** What sticks to a phone's bottom edge while the keyboard is down: the tab bar and a page's sticky button. */
const BOTTOM_BARS_PX = 168;

/**
 * On a phone, scroll so the whole list shows above the keyboard (or, with the
 * keyboard down, above the sticky bars) — never so far that the field itself
 * leaves the screen. Checked when the list changes and as the keyboard moves.
 */
function useKeepInView(list: React.RefObject<HTMLElement | null>, field: React.RefObject<HTMLElement | null>, count: number) {
  React.useEffect(() => {
    if (count === 0 || typeof window === "undefined") return;
    const check = () => {
      const el = list.current;
      const anchor = field.current;
      if (!el || !anchor || !window.matchMedia("(max-width: 899px)").matches) return;
      const vv = window.visualViewport;
      const top = vv ? vv.offsetTop : 0;
      const height = vv ? vv.height : window.innerHeight;
      const keyboard = height < window.innerHeight - 120;
      const over = el.getBoundingClientRect().bottom - (top + height - (keyboard ? 8 : BOTTOM_BARS_PX));
      const room = anchor.getBoundingClientRect().top - top - 8;
      const by = Math.min(over, room);
      if (by > 0) window.scrollBy({ top: by });
    };
    check();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", check);
    return () => vv?.removeEventListener("resize", check);
  }, [count, list, field]);
}

/**
 * The suggestions: "From before" over one row per suggestion — "Milk · 1 L ·
 * Flat 4B · 6×" and its price — highlighted by the keyboard or the pointer.
 * Pressing a row keeps the focus in the field, so a tap is one pick.
 */
export function SuggestionList({
  id,
  label,
  views,
  active,
  onPick,
  onHighlight,
  fieldRef,
  className,
}: {
  id: string;
  label: string;
  views: readonly SuggestionView[];
  active: number;
  onPick: (index: number) => void;
  onHighlight: (index: number) => void;
  /** The field and its label: kept on screen when the list scrolls into view. */
  fieldRef: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useKeepInView(ref, fieldRef, views.length);
  if (views.length === 0) return null;
  return (
    <div ref={ref} className={cn("space-y-1.5", className)}>
      <p id={`${id}-label`} className="px-1 text-[13px] font-normal text-muted-foreground">
        {label}
      </p>
      <ul
        id={id}
        role="listbox"
        aria-labelledby={`${id}-label`}
        onMouseDown={(e) => e.preventDefault()}
        className="overflow-hidden rounded-2xl border bg-card"
      >
        {views.map((v, i) => (
          <li
            key={v.key}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            aria-label={v.label}
            onClick={() => onPick(i)}
            onPointerMove={() => {
              if (i !== active) onHighlight(i);
            }}
            className={cn(
              "flex min-h-11 cursor-pointer select-none items-center gap-3 border-t px-3.5 py-2 text-[15px] first:border-t-0",
              i === active ? "bg-accent" : "active:bg-accent",
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{v.name}</span>
              {v.meta ? <span className="text-muted-foreground"> · {v.meta}</span> : null}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{v.price}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
