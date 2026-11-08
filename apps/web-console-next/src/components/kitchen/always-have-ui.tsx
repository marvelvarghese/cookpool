"use client";

import * as React from "react";
import { Check, Plus, Search, X } from "lucide-react";
import type { FoodMatch, KitchenFood } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44, K_BUTTON } from "./kit";
import { useFoods } from "./recipes-data";
import { useSettled } from "./recipe-ui";
import { ALWAYS_HAVE_LINE, ALWAYS_HAVE_TITLE, canAddFood } from "./always-have";
import { useAlwaysHave, useEditAlwaysHave } from "./recipe-travel-data";

/**
 * Always have (cookpool-recipes RC-8, design §3.4), at the bottom of Pantry
 * in the new frame: "Always have · Count as there in Cook now", a chip per
 * food — salt and water until you change it — each with ✕, and + Add, which
 * searches the food list. Every edit shows at once with Undo, and Cook now
 * and every recipe's match are read again.
 */
export function AlwaysHaveCard() {
  const list = useAlwaysHave();
  const edit = useEditAlwaysHave();
  const [adding, setAdding] = React.useState(false);
  const have = React.useMemo(() => new Set((list.data?.foods ?? []).map((f) => f.key)), [list.data]);
  return (
    <>
      <AlwaysHaveCardView
        foods={list.data?.foods ?? null}
        loading={list.loading}
        failed={!!list.error && !list.data}
        canAdd={canAddFood(list.data)}
        onReload={list.reload}
        onRemove={(food) => void edit({ kind: "remove", food })}
        onAdd={() => setAdding(true)}
      />
      <FoodSearchSheet
        open={adding}
        onOpenChange={setAdding}
        have={have}
        onPick={(food) => {
          setAdding(false);
          void edit({ kind: "add", food });
        }}
      />
    </>
  );
}

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

/** + Add: a search of the food list in a bottom sheet; picking one adds it. */
function FoodSearchSheet({
  open,
  onOpenChange,
  have,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  have: ReadonlySet<string>;
  onPick: (food: KitchenFood) => void;
}) {
  const [query, setQuery] = React.useState("");
  const q = useSettled(query, 200);
  const foods = useFoods(q);
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className={cn(
          "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-hidden rounded-t-[24px] border-x-0 bg-background px-4 pt-2.5 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
          CLOSE_44,
        )}
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="flex min-h-11 shrink-0 items-center pr-12 text-[22px] font-extrabold">Add to Always have</SheetTitle>
        <label className="mt-2 flex min-h-[52px] shrink-0 items-center gap-2.5 rounded-2xl border border-[#C9CFC6] bg-card px-4 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
          <span className="sr-only">Search foods</span>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Turmeric, oil, jeera…"
            enterKeyHint="search"
            className="min-h-12 min-w-0 flex-1 bg-transparent text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="-mx-4 mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          {!q.trim() ? (
            <p className="px-1 text-sm text-muted-foreground">Type a food</p>
          ) : foods.loading && !foods.data ? (
            <div className="space-y-1.5" aria-hidden>
              <Skeleton className="h-12 w-full rounded-2xl" />
              <Skeleton className="h-12 w-full rounded-2xl" />
            </div>
          ) : (foods.data ?? []).length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">Not on the food list</p>
          ) : (
            <FoodResults foods={foods.data ?? []} have={have} onPick={onPick} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
