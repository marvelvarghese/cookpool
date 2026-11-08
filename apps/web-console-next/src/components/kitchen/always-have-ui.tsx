"use client";

import * as React from "react";
import { Search } from "lucide-react";
import type { KitchenFood } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { useFoods } from "./recipes-data";
import { useSettled } from "./recipe-ui";
import { canAddFood } from "./always-have";
import { AlwaysHaveCardView, FoodResults } from "./always-have-views";
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
