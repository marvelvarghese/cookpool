"use client";

import { Minus, Plus } from "lucide-react";
import type { Pantry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { pantryChipLabel, pantryKey } from "./pantry";
import type { TickedLine } from "./shopping-run";

/**
 * A ticked line, opened (PN-6): the amount's − / +, the price (last time's
 * for that amount, editable) and the pantry chip with its choices. The
 * receipt's lines (AI-8) open the same editor.
 */
export function RunLineEditor({
  name,
  ticked,
  choosing,
  pantries,
  onStep,
  onPrice,
  onChoose,
  onPantry,
}: {
  name: string;
  ticked: TickedLine;
  choosing: boolean;
  pantries: readonly Pantry[];
  onStep: (delta: 1 | -1) => void;
  onPrice: (text: string) => void;
  onChoose: () => void;
  onPantry: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 pl-[62px] pr-3">
      <button type="button" aria-label={`Less ${name}`} disabled={!ticked.canLess} onClick={() => onStep(-1)} className={STEPPER}>
        <Minus className="h-5 w-5" aria-hidden />
      </button>
      <span role="status" className="min-w-16 text-center text-[15px] font-medium tabular-nums">
        {ticked.step.words}
      </span>
      <button type="button" aria-label={`More ${name}`} disabled={!ticked.canMore} onClick={() => onStep(1)} className={STEPPER}>
        <Plus className="h-5 w-5" aria-hidden />
      </button>
      <label
        className={cn(
          // A field keeps its boundary (RV-19): the input token, or the expired red when the price doesn't read.
          "flex min-h-11 items-center gap-1 rounded-xl border bg-card px-2.5 text-[15px] font-medium focus-within:ring-2 focus-within:ring-ring",
          ticked.priceMinor === null ? "border-destructive" : "border-input",
        )}
      >
        <span aria-hidden>{ticked.prefix}</span>
        <input
          type="text"
          inputMode="decimal"
          value={ticked.priceText}
          onChange={(e) => onPrice(e.target.value)}
          aria-label={`Price of ${name}`}
          aria-invalid={ticked.priceMinor === null}
          autoComplete="off"
          className="w-16 bg-transparent text-[15px] font-medium tabular-nums text-foreground outline-none"
        />
      </label>
      <button
        type="button"
        aria-expanded={choosing}
        aria-label={`${name} goes to ${ticked.pantryLabel} · change`}
        onClick={onChoose}
        className="min-h-11 min-w-11 rounded-full bg-cp-owed-tint px-3 text-[13px] font-medium text-cp-owed transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ticked.pantryLabel}
      </button>
      {choosing ? (
        <div role="group" aria-label={`Where ${name} goes`} className="flex w-full flex-wrap gap-2 pt-1">
          {pantries.map((p) => {
            const key = pantryKey(p);
            const here = key === ticked.pantry;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={here}
                onClick={() => onPantry(key)}
                className={cn(
                  "min-h-11 rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  here ? "bg-cp-accent-tint text-cp-accent-text" : "bg-muted text-foreground hover:bg-cp-line",
                )}
              >
                {pantryChipLabel(p)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const STEPPER =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cp-line text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
