"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { RepeatButton } from "./row-gestures-ui";
import { amountView, parseTyped, pickRest, pickStep, pickTyped, pickUnit, type AmountPick, type PickItem } from "./amount-picker";

const STEP =
  "grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-cp-accent-tint text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
const CHIP =
  "min-h-11 rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

/**
 * The amount with unit chips (cookpool-pantry PN-11, the canvas's
 * AmountPicker): `− [ amount unit ] +` with its reason under it, then the
 * item's own measures and its plain units as chips, and a dashed The rest.
 * Tapping the number lets you type it. Shared by the open row, the More…
 * sheet and the item page; the pick is the caller's (the device's draft).
 */
export function AmountPicker({
  item,
  name,
  pick,
  start,
  why,
  onPick,
  className,
}: {
  item: PickItem;
  /** The item's name, for the buttons' labels ("Less Milk"). */
  name: string;
  pick: AmountPick;
  /** Where it started (the suggestion), so its reason shows while it is there. */
  start: AmountPick | null;
  /** The suggestion's reason ("Morning usual"). */
  why: string | null;
  onPick: (next: AmountPick) => void;
  className?: string;
}) {
  const view = amountView(item, pick, start, why);
  const [typing, setTyping] = React.useState<string | null>(null);
  const bad = typing !== null && typing.trim() !== "" && parseTyped(typing) === null;
  const inputId = React.useId();

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex items-center gap-2">
        <RepeatButton aria-label={`Less ${name}`} className={STEP} disabled={!view.canLess} onStep={() => onPick(pickStep(item, pick, -1))}>
          <Minus className="h-5 w-5" aria-hidden />
        </RepeatButton>
        <label
          htmlFor={inputId}
          className="flex min-h-14 min-w-0 flex-1 cursor-text flex-col items-center justify-center rounded-2xl border-[1.5px] border-primary bg-background px-2 focus-within:ring-2 focus-within:ring-ring"
        >
          <span className="flex max-w-full items-baseline justify-center gap-1.5">
            {/* A tap clears the box to type over; the amount stays as its placeholder, and is kept if nothing is typed. */}
            <input
              id={inputId}
              aria-label={`How much ${name}, in ${view.unit.many}`}
              aria-invalid={bad || undefined}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={typing ?? view.number}
              placeholder={view.number}
              onFocus={() => setTyping("")}
              onChange={(e) => {
                setTyping(e.target.value);
                const next = pickTyped(item, pick, e.target.value);
                if (next) onPick(next);
              }}
              onBlur={() => setTyping(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              style={{ width: `${Math.max(2, (typing || view.number).length + 0.5)}ch` }}
              className={cn(
                "min-w-0 max-w-[9ch] border-0 bg-transparent p-0 text-right text-2xl font-medium tabular-nums text-foreground outline-none placeholder:text-foreground/35",
                bad && "text-cp-expired",
              )}
            />
            <span className="truncate text-[17px] font-medium text-muted-foreground">{view.word}</span>
          </span>
          <span role="status" className="max-w-full truncate text-xs font-normal text-cp-accent-text">
            {bad ? "Type a number like 2 or 1½" : (view.reason ?? " ")}
          </span>
        </label>
        <RepeatButton aria-label={`More ${name}`} className={STEP} disabled={!view.canMore} onStep={() => onPick(pickStep(item, pick, 1))}>
          <Plus className="h-5 w-5" aria-hidden />
        </RepeatButton>
      </div>

      <div role="radiogroup" aria-label="Unit" className="flex flex-wrap gap-1.5">
        {view.units.map((u) => {
          const on = u.id === view.unit.id;
          return (
            <button
              key={u.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onPick(pickUnit(item, pick, u.id))}
              className={cn(CHIP, on ? "bg-cp-accent-tint text-cp-accent-text" : "bg-muted text-foreground hover:bg-muted/70")}
            >
              {u.many}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={view.rest}
          onClick={() => onPick(pickRest(pick))}
          className={cn(CHIP, "border-[1.5px] border-dashed", view.rest ? "border-primary bg-cp-accent-tint text-cp-accent-text" : "border-muted-foreground/60 bg-transparent text-muted-foreground hover:bg-muted")}
        >
          The rest
        </button>
      </div>
      <p className="text-xs font-normal tabular-nums text-muted-foreground">{view.hint}</p>
    </div>
  );
}
