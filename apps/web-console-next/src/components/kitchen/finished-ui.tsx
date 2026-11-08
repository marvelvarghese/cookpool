"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { FinishedRow } from "./restock";

/**
 * Finished this week (cookpool-pantry PN-6, design §6.1, the canvas's
 * PantryNew): what was used up or went bad in the last 7 days, in pantries
 * you reach, each "Bread · Finished Tue · Flat 4B" with **Bought again**
 * (one tap, like last time, with Change and Undo). Its heading folds it like
 * the sections by kind, remembered on the device; it isn't drawn when empty.
 */
export function FinishedThisWeek({
  rows,
  open,
  onFold,
  onBought,
}: {
  rows: readonly FinishedRow[];
  open: boolean;
  onFold: () => void;
  onBought: (row: FinishedRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="pantry-finished" className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={onFold}
        className="flex min-h-11 items-center gap-2 rounded-lg px-0.5 text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span id="pantry-finished" className="flex-1 text-left text-xs font-extrabold uppercase tracking-[0.06em]">
          Finished this week
        </span>
        <span className="text-xs font-extrabold tabular-nums">{rows.length}</span>
        <ChevronDown className={cn("h-[18px] w-[18px] transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden />
      </button>
      {open ? (
        <ul className="divide-y divide-dashed divide-[#D5DAD2] overflow-hidden rounded-[20px] border border-dashed border-[#C9CFC6] bg-card">
          {rows.map((r) => (
            <li key={r.key} className="flex min-h-16 items-center gap-2.5 py-2 pl-3.5 pr-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-extrabold text-muted-foreground">{r.name}</span>
                <span className="truncate text-[13px] font-semibold text-muted-foreground">{r.sub}</span>
              </span>
              {r.canAdd ? (
                <button
                  type="button"
                  onClick={() => onBought(r)}
                  aria-label={`Bought ${r.name} again · ${r.price}`}
                  className="min-h-11 shrink-0 rounded-xl border border-[#C9CFC6] bg-card px-3 text-sm font-extrabold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Bought again
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
