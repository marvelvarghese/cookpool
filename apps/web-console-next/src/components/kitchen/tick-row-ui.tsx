"use client";

import * as React from "react";
import Link from "./link";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { RING } from "./new-home-parts-ui";
import { cleanTyped, tickUnitChoice, type TickAmount, type TickMeta, type TickState } from "./tick-row";

/**
 * The tick row (cookpool-revamp RV-10, the canvas's RvKitchen "Tick to
 * log"), shared by the Kitchen and (RV-11) the cook session's ingredients.
 * Three columns: the name with its line under it, the amount box, the tick.
 *
 * - The box is a text input whose placeholder is the usual amount in grey;
 *   typing over it sets the amount. The unit sits inside it as a small
 *   button, which opens a chip row under the row with only the item's own
 *   measures. Picking one converts the grey amount, clears what was typed and
 *   is reported through `onUnit` (the caller keeps it as the usual).
 * - The tick runs `onTick`. Once `done`, the row is green, the box is locked
 *   on what was logged, and the tick (pressed) runs `onTick` again: the
 *   caller undoes.
 *
 * Controlled: the caller holds `state` (typed, unit) and `done`, so the same
 * item can show in two places with one state. Pure parts in tick-row.ts.
 */

/** The three columns, the header's and every row's. */
const GRID = "grid grid-cols-[minmax(0,1fr)_124px_48px] items-center gap-2 pl-3.5 pr-3";

const META_TONE: Record<TickMeta["tone"], string> = {
  muted: "text-muted-foreground",
  soon: "text-cp-soon",
  expired: "text-cp-expired",
  owe: "text-cp-owe",
};

/** The small column header: ITEM · LAST TIME | AMOUNT | ✓ (decorative; each control has its own name). */
export function TickHeader({ item = "ITEM · LAST TIME", amount = "AMOUNT", tick = "✓" }: { item?: string; amount?: string; tick?: string }) {
  return (
    <div aria-hidden className={cn(GRID, "pb-1 pt-2.5 text-[11px] font-medium tracking-[0.04em] text-muted-foreground")}>
      <span>{item}</span>
      <span className="text-center">{amount}</span>
      <span className="text-center">{tick}</span>
    </div>
  );
}

export interface TickRowProps {
  /** The item's `itm_…` (or the line's key): the row's `data-row-id`. */
  id: string;
  name: string;
  /** Where the name goes (the item page); plain text without. */
  href?: string | null;
  /** The line under the name: the last use, amber for use soon, red once expired. */
  meta: TickMeta | null;
  /** The box (tick-row.ts `tickAmount`); null draws no box and no tick (nothing to log), unless `fixed`. */
  amount: TickAmount | null;
  /**
   * With no `amount`: words drawn in the box's place, with the tick still
   * there ("To taste", RV-11's cook lines). Without it, no box and no tick.
   */
  fixed?: string | null;
  state: TickState;
  onState: (next: TickState) => void;
  /** A unit chip was picked (after `onState`): keep it as the usual. */
  onUnit?: (unitId: string) => void;
  /** Logged: the row is green and the box is locked on this amount ("1", "glass"). */
  done: { number: string; word: string } | null;
  /** The tick: log it, or (while `done`) undo it. */
  onTick: () => void;
  /** Instead of the tick (the Kitchen's ask-first rows: Ask, Cancel). */
  end?: React.ReactNode;
  /** The tick waits (a write on its way, an undo answering). */
  busy?: boolean;
  /** The tick's name: "Log 1 glass of Milk"; while done, "Logged 1 glass of Milk, undo". */
  tickLabel?: (words: string, name: string, done: boolean) => string;
  /** More under the name (a note, an ask's status). */
  children?: React.ReactNode;
}

const defaultTickLabel = (words: string, name: string, done: boolean) => (done ? `Logged ${words} of ${name}, undo` : `Log ${words} of ${name}`);

export function TickRow({ id, name, href, meta, amount, fixed = null, state, onState, onUnit, done, onTick, end, busy = false, tickLabel = defaultTickLabel, children }: TickRowProps) {
  const [unitsOpen, setUnitsOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const chipsId = React.useId();
  const showUnits = unitsOpen && !done && !!amount && amount.units.length > 1;
  const words = done ? `${done.number} ${done.word}` : (amount?.words ?? fixed ?? "");
  const fixedOnly = !amount && fixed !== null;
  const nameBody = (
    <>
      <span className="truncate text-base font-medium leading-snug">{name}</span>
      {meta ? <span className={cn("truncate text-[13px] font-normal", META_TONE[meta.tone])}>{meta.text}</span> : null}
      {children}
    </>
  );
  return (
    <div data-row-id={id} className={cn(done && "bg-cp-accent-tint")}>
      <div className={cn(GRID, "min-h-16 py-2")}>
        {href ? (
          <Link href={href} className={cn("flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded-lg text-foreground", RING)}>
            {nameBody}
          </Link>
        ) : (
          <span className="flex min-h-11 min-w-0 flex-col justify-center gap-0.5">{nameBody}</span>
        )}

        {fixedOnly ? (
          <span className={cn("truncate px-1 text-right text-[15px] font-normal", done ? "text-cp-accent-text" : "text-muted-foreground")}>{fixed}</span>
        ) : amount || done ? (
          <div
            onClick={() => inputRef.current?.focus()}
            className={cn(
              "flex min-h-11 cursor-text items-center gap-1 rounded-xl border pl-2.5 pr-1",
              done ? "border-transparent bg-transparent" : amount?.invalid ? "border-cp-expired bg-card" : "border-border bg-card focus-within:ring-2 focus-within:ring-ring",
            )}
          >
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              aria-label={`Amount of ${name}, ${done?.word ?? amount?.word ?? ""}`}
              aria-invalid={amount?.invalid || undefined}
              disabled={!!done}
              value={done ? done.number : state.typed}
              placeholder={amount?.ghost ?? ""}
              onChange={(e) => onState({ ...state, typed: cleanTyped(e.target.value) })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) {
                  e.preventDefault();
                  onTick();
                }
              }}
              className={cn(
                "w-full min-w-0 bg-transparent text-right text-[17px] tabular-nums outline-none placeholder:text-muted-foreground disabled:opacity-100",
                state.typed || done ? "font-medium" : "font-normal",
                done ? "text-cp-accent-text" : "text-foreground",
              )}
            />
            <button
              type="button"
              aria-expanded={showUnits}
              aria-controls={showUnits ? chipsId : undefined}
              aria-label={`Unit: ${done?.word ?? amount?.word ?? ""}, change`}
              disabled={!!done || !amount || amount.units.length < 2}
              onClick={(e) => {
                e.stopPropagation();
                setUnitsOpen((o) => !o);
              }}
              className={cn(
                "flex min-h-8 shrink-0 items-center gap-0.5 rounded-md pl-1 pr-0.5 text-[13px] font-normal disabled:cursor-default",
                done ? "text-cp-accent-text" : "text-muted-foreground",
                RING,
              )}
            >
              {done?.word ?? amount?.word}
              {amount && amount.units.length > 1 && !done ? <ChevronDown className="h-3 w-3" strokeWidth={2.4} aria-hidden /> : null}
            </button>
          </div>
        ) : (
          <span />
        )}

        {end ? (
          <span className="flex justify-center">{end}</span>
        ) : amount || done || fixedOnly ? (
          <button
            type="button"
            aria-pressed={!!done}
            aria-label={tickLabel(words, name, !!done)}
            aria-busy={busy || undefined}
            disabled={busy}
            onClick={onTick}
            className={cn(
              "flex h-11 w-12 items-center justify-center rounded-xl transition-colors disabled:opacity-60",
              done ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-cp-line text-muted-foreground hover:bg-muted",
              RING,
            )}
          >
            <Check className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden />
          </button>
        ) : (
          <span />
        )}
      </div>

      {showUnits && amount ? (
        <div id={chipsId} role="group" aria-label={`Measure for ${name}`} className="flex flex-wrap gap-1.5 px-3.5 pb-3">
          {amount.units.map((u) => {
            const on = u.id === amount.unit.id;
            return (
              <button
                key={u.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setUnitsOpen(false);
                  if (on) return;
                  onState(tickUnitChoice(state, u.id));
                  onUnit?.(u.id);
                }}
                className={cn(
                  "min-h-10 rounded-full px-3.5 text-sm font-medium transition-colors",
                  on ? "bg-primary text-primary-foreground" : "bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80",
                  RING,
                )}
              >
                {u.many}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
