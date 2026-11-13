"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import type { KitchenDimension, KitchenMeasure, KitchenMeasureInput } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { RING } from "./new-home-parts-ui";
import { measureBase, readNewMeasure } from "./measure-drawer";

/**
 * The Measure drawer (cookpool-kitchen-calm KC-2, the canvas's `UnitDrawer` and
 * `NewMeasure`): one bottom sheet for every "which unit" in the Kitchen — a
 * tick row's measure, Add item's unit. The plain units as a grid, then Your
 * measures ("1 packet = 200 g"), then **New measure**: "1 [box] = [500] g"
 * and Save and use, which adds it and picks it at once. Picking anything
 * closes the drawer.
 */

export interface DrawerUnit {
  /** The caller's id ("u:g", "m:glass", or Add item's unit key). */
  id: string;
  label: string;
  /** "= 200 g" for a measure; none for a plain unit. */
  size?: string | null;
}

export interface MeasureDrawerAdd {
  dimension: KitchenDimension;
  measures: readonly Pick<KitchenMeasure, "one" | "many">[];
  /** Save it; the drawer picks `id` once this is called. */
  onAdd: (input: KitchenMeasureInput, id: string) => void;
}

const SHEET =
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[28px] border-x-0 bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-2.5 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border";
const FIELD = "h-11 min-w-0 rounded-xl bg-background px-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring";

export function MeasureDrawer({
  open,
  onOpenChange,
  units,
  measures,
  chosen,
  onPick,
  add = null,
  title = "Measure",
  saveLabel = "Save and use",
  footer = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The plain units, in the grid. */
  units: readonly DrawerUnit[];
  /** Your measures, as rows. */
  measures: readonly DrawerUnit[];
  chosen: string | null;
  onPick: (id: string) => void;
  /** New measure; left out, the drawer only picks. */
  add?: MeasureDrawerAdd | null;
  title?: string;
  /** New measure's button: "Save and use" where it is picked, "Add measure" where it is only kept. */
  saveLabel?: string;
  /** One more control under everything (the shopping list's Take off the list). */
  footer?: React.ReactNode;
}) {
  const [adding, setAdding] = React.useState(false);
  const [word, setWord] = React.useState("");
  const [size, setSize] = React.useState("");
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    if (open) return;
    setAdding(false);
    setWord("");
    setSize("");
    setTried(false);
  }, [open]);
  const pick = (id: string) => {
    onOpenChange(false);
    onPick(id);
  };
  const read = add ? readNewMeasure(add.dimension, word, size, add.measures) : null;
  const save = () => {
    setTried(true);
    if (!add || !read?.ok) return;
    add.onAdd(read.input, read.id);
    pick(read.id);
  };
  const problem = read && !read.ok && tried ? (read.problem ?? "Name the measure") : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="mb-4 text-lg font-medium">{title}</SheetTitle>
        {units.length > 0 ? (
          <div role="group" aria-label="Units" className="mb-5 grid grid-cols-5 gap-2">
            {units.map((u) => {
              const on = u.id === chosen;
              return (
                <button
                  key={u.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(u.id)}
                  className={cn("min-h-12 truncate rounded-[14px] px-1 text-[15px] font-medium transition-colors", on ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted", RING)}
                >
                  {u.label}
                </button>
              );
            })}
          </div>
        ) : null}
        {measures.length > 0 || add ? (
          <div className="space-y-2">
            <p className="px-1 text-[13px] text-muted-foreground">Your measures</p>
            <div className="divide-y divide-border overflow-hidden rounded-[18px] bg-background">
              {measures.map((m) => {
                const on = m.id === chosen;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pick(m.id)}
                    className={cn("flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium", on ? "text-cp-accent-text" : "text-foreground", RING)}
                  >
                    <span className="min-w-0 flex-1 truncate">1 {m.label}</span>
                    {m.size ? <span className="text-sm font-normal text-muted-foreground">{m.size}</span> : null}
                  </button>
                );
              })}
              {add && !adding ? (
                <button type="button" onClick={() => setAdding(true)} className={cn("flex min-h-[52px] w-full items-center gap-2.5 px-4 text-[15px] font-medium text-cp-accent-text", RING)}>
                  <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
                  New measure
                </button>
              ) : null}
              {add && adding ? (
                <form
                  className="space-y-2.5 px-4 pb-4 pt-3.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                >
                  <div className="flex items-center gap-2 text-[15px]">
                    <span className="text-muted-foreground">1</span>
                    <input autoFocus aria-label="Measure name" placeholder="box" value={word} onChange={(e) => setWord(e.target.value)} className={cn(FIELD, "flex-1")} />
                    <span className="text-muted-foreground">=</span>
                    <input aria-label={`How many ${measureBase(add.dimension)} in one`} inputMode="decimal" placeholder="500" value={size} onChange={(e) => setSize(e.target.value)} className={cn(FIELD, "w-20 text-center tabular-nums")} />
                    <span className="text-muted-foreground">{measureBase(add.dimension)}</span>
                  </div>
                  {problem ? (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {problem}
                    </p>
                  ) : null}
                  <button type="submit" className={cn("min-h-11 w-full rounded-xl bg-primary text-[15px] font-medium text-primary-foreground hover:bg-primary/90", RING)}>
                    {saveLabel}
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}
        {footer ? <div className="mt-4 flex justify-center">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
