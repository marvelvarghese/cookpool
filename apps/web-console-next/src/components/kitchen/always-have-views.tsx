"use client";

import * as React from "react";
import { Check, Plus, X } from "lucide-react";
import type { FoodMatch, KitchenFood } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { K_BUTTON } from "./kit";
import { ALWAYS_HAVE_LINE, ALWAYS_HAVE_TITLE, type FoodAsk } from "./always-have";

/**
 * Always have's card, the food search's answers and the food ask's cards as
 * they draw (cookpool-recipes RC-8), from what was read: no reads or writes,
 * so each is rendered in tests. `always-have-ui.tsx` and `food-ask-ui.tsx`
 * put them over the data.
 */

/** The card as it draws (no reads or writes, so tests render it). */
export function AlwaysHaveCardView({
  foods,
  loading,
  failed,
  canAdd,
  onReload,
  onRemove,
  onAdd,
}: {
  foods: readonly KitchenFood[] | null;
  loading: boolean;
  failed: boolean;
  canAdd: boolean;
  onReload?: (() => void) | undefined;
  onRemove: (food: KitchenFood) => void;
  onAdd: () => void;
}) {
  return (
    <section aria-labelledby="always-have-h" className="flex flex-col gap-3 rounded-[22px] border bg-card px-4 py-3.5">
      <div className="flex flex-col">
        <h2 id="always-have-h" className="text-lg font-extrabold tracking-tight">
          {ALWAYS_HAVE_TITLE}
        </h2>
        <p className="text-[13px] font-semibold text-muted-foreground">{ALWAYS_HAVE_LINE}</p>
      </div>
      {loading ? (
        <div className="flex gap-2" aria-hidden>
          <Skeleton className="h-11 w-20 rounded-full" />
          <Skeleton className="h-11 w-24 rounded-full" />
        </div>
      ) : failed ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load it.</p>
          {onReload ? (
            <Button variant="outline" className={K_BUTTON} onClick={onReload}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : (
        <ul aria-label={ALWAYS_HAVE_TITLE} className="flex flex-wrap gap-2">
          {(foods ?? []).map((f) => (
            <li key={f.key} className="flex min-h-11 items-center rounded-full border border-[#D5DAD2] bg-background pl-3.5">
              <span className="text-[15px] font-bold">{f.name}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onRemove(f)}
                className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" strokeWidth={2.4} aria-hidden />
              </button>
            </li>
          ))}
          {canAdd ? (
            <li>
              <button
                type="button"
                onClick={onAdd}
                className="flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-[#9AA39D] px-4 text-[15px] font-extrabold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                Add
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

/** The food list's answers for what is typed, as they draw. */
export function FoodResults({ foods, have, onPick }: { foods: readonly FoodMatch[]; have: ReadonlySet<string>; onPick: (food: FoodMatch) => void }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {foods.map((f) => {
        const on = have.has(f.key);
        const alias = f.matchedName && f.matchedName.toLowerCase() !== f.name.toLowerCase() ? f.matchedName : null;
        return (
          <li key={f.key}>
            <button
              type="button"
              disabled={on}
              onClick={() => onPick(f)}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-2xl border px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-[#B9DCC8] bg-cp-herb-tint" : "border-[#E3E6E0] bg-card hover:bg-accent",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-extrabold">{f.name}</span>
                {alias ? <span className="truncate text-[13px] font-semibold text-muted-foreground">{alias}</span> : null}
              </span>
              {on ? (
                <span className="flex items-center gap-1 text-[13px] font-extrabold text-[#165C3A]">
                  <Check className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                  Added
                </span>
              ) : (
                <Plus className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.2} aria-hidden />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One ask as it draws. */
export function FoodAskCard({ ask, busy, onAnswer }: { ask: Pick<FoodAsk, "question">; busy: boolean; onAnswer: (yes: boolean) => void }) {
  return (
    <div role="group" aria-label={ask.question} className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[#F0DDB0] bg-[#FFF8E6] py-2 pl-4 pr-2">
      <p className="min-w-0 flex-1 text-[15px] font-extrabold">{ask.question}</p>
      <div className="flex shrink-0 gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(true)}
          className="min-h-11 rounded-xl bg-primary px-4 text-[15px] font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Yes
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(false)}
          className="min-h-11 rounded-xl border border-[#C9CFC6] bg-card px-4 text-[15px] font-extrabold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          No
        </button>
      </div>
    </div>
  );
}

/** The asks as they draw: nothing when there are none. */
export function FoodAskListView({ asks, busy, onAnswer }: { asks: readonly FoodAsk[]; busy: ReadonlySet<string>; onAnswer: (ask: FoodAsk, yes: boolean) => void }) {
  if (asks.length === 0) return null;
  return (
    <section aria-label="Is this the same food?" className="flex flex-col gap-2">
      {asks.map((a) => (
        <FoodAskCard key={a.nameKey} ask={a} busy={busy.has(a.nameKey)} onAnswer={(yes) => onAnswer(a, yes)} />
      ))}
    </section>
  );
}
