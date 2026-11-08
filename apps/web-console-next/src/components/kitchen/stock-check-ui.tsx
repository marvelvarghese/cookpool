"use client";

import * as React from "react";
import type { KitchenItem, StockCheckGone } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MemberNames } from "./members";
import { pantryLabel, type ItemRef } from "./pantry";
import { BackButton, useBack } from "./back-ui";
import { MAIN_BUTTON } from "./faces-ui";
import { useCheckItem } from "./stock-check-data";
import {
  MORE_TEXT,
  checkDiff,
  checkMarks,
  checkOptions,
  checkTitle,
  clampLevel,
  defaultGone,
  fixButton,
  levelAt,
  levelKeyOf,
  levelPercent,
  levelValueText,
  stepLevel,
  thinksAndSays,
  whereTitle,
} from "./stock-check";

/**
 * The stock check (cookpool-pantry PN-7, design §7, the canvas's
 * StockCheck): a tall level you drag, the marks beside it (Empty, ¼, ½, ¾,
 * Full of what was bought) and the arrow keys; "Cookpool thinks · You say";
 * for less, where the difference went, with what each answer does to money;
 * for more, that no money moves; then one main button, **Fix to 750 ml**,
 * which writes the check with the ten-second Undo and goes back to the item.
 * At the level Cookpool thinks it reads **It's right** and writes nothing.
 */
export function StockCheckScreen({
  itemRef,
  item,
  meId,
  names,
  roster,
  canWrite,
}: {
  itemRef: ItemRef;
  item: KitchenItem;
  meId: string | null;
  names: MemberNames;
  /** The group's members, oldest first (null for your own item, or while they load). */
  roster: readonly string[] | null;
  canWrite: boolean;
}) {
  const checkItem = useCheckItem();
  const back = useBack();
  const [says, setSays] = React.useState(() => clampLevel(item, item.qtyLeftMilli));
  const [gone, setGone] = React.useState<StockCheckGone>(() => defaultGone(item));
  const idemKey = React.useRef(crypto.randomUUID());
  const group = item.pantry.kind === "group";
  const groupRoster = group ? roster : null;
  const diff = checkDiff(item, says);
  const tiles = thinksAndSays(item, says);
  const options = checkOptions({ item, says, roster: groupRoster, meId, names });
  const option = options.find((o) => o.gone === gone) ?? options[0] ?? null;
  const fix = fixButton(item, says);
  const heading = checkTitle(item);
  const waiting = group && roster === null && diff.kind === "less";

  const submit = () => {
    if (fix.same || !meId) {
      back();
      return;
    }
    void checkItem({
      ref: itemRef,
      item,
      says,
      gone: option?.gone ?? gone,
      option,
      roster: groupRoster,
      meId,
      names,
      idempotencyKey: idemKey.current,
    });
    back();
  };

  return (
    <div className="space-y-4 pb-2">
      <div className="flex min-w-0 items-center gap-1">
        <BackButton />
        <div className="min-w-0">
          <h1 className="break-words text-[22px] font-extrabold leading-tight tracking-tight">{heading.title}</h1>
          <p className="truncate text-sm font-bold text-muted-foreground">{heading.what}</p>
        </div>
      </div>

      <div className="flex items-stretch gap-4 rounded-[22px] border bg-card p-4">
        <LevelControl item={item} says={says} onChange={setSays} />
        <div className="flex flex-1 flex-col justify-between py-0.5">
          {checkMarks(item).map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={says === m.qtyMilli}
              onClick={() => setSays(m.qtyMilli)}
              className={cn(
                "min-h-11 rounded-xl border px-3 text-left text-[15px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                says === m.qtyMilli ? "border-foreground bg-foreground text-background" : "border-[#D5DAD2] bg-card hover:bg-accent",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2" aria-live="polite">
        <span className="flex flex-col rounded-2xl border bg-card px-3 py-2.5">
          <span className="text-xs font-bold text-muted-foreground">Cookpool thinks</span>
          <span className="text-xl font-extrabold tabular-nums">{tiles.thinks}</span>
        </span>
        <span className="flex flex-col rounded-2xl border border-[#B9DCC8] bg-[#E4F2EA] px-3 py-2.5">
          <span className="text-xs font-bold text-[#165C3A]">You say</span>
          <span className="text-xl font-extrabold tabular-nums text-[#0F3F27]">{tiles.says}</span>
        </span>
      </div>

      {diff.kind === "less" ? (
        <section aria-labelledby="where-heading" className="space-y-2">
          <h2 id="where-heading" className="text-lg font-extrabold">
            {whereTitle(diff)}
          </h2>
          <div role="radiogroup" aria-labelledby="where-heading" className="flex flex-col gap-2">
            {options.map((o) => {
              const on = option?.gone === o.gone;
              return (
                <button
                  key={o.gone}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setGone(o.gone)}
                  className={cn(
                    "flex min-h-16 items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-[1.5px] border-primary bg-[#E4F2EA]" : "border border-[#D5DAD2] bg-card hover:bg-accent",
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-base font-extrabold">{o.title}</span>
                    {o.sub ? (
                      <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">{o.sub}</span>
                    ) : (
                      <Skeleton className="mt-1 h-3.5 w-24" />
                    )}
                  </span>
                  <span aria-hidden className={cn("grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2", on ? "border-primary" : "border-[#9AA39D]")}>
                    <span className={cn("h-2.5 w-2.5 rounded-full", on ? "bg-primary" : "bg-transparent")} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {diff.kind === "more" ? <p className="rounded-2xl border bg-card px-3.5 py-3 text-[15px] font-bold text-foreground/80">{MORE_TEXT}</p> : null}

      {canWrite ? (
        <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 min-[900px]:static min-[900px]:max-w-sm">
          <Button
            type="button"
            disabled={waiting}
            onClick={submit}
            className={cn(
              MAIN_BUTTON,
              "text-[17px] font-extrabold",
              fix.same ? "bg-[#ECEEE9] text-[#3F4842] shadow-none hover:bg-[#E3E6E0]" : "shadow-[0_8px_24px_rgba(23,32,27,0.18)] min-[900px]:shadow-none",
            )}
          >
            {fix.label}
          </Button>
        </div>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">You only view {pantryLabel(item.pantry)}.</p>
      )}
    </div>
  );
}

/**
 * The tall level: drag it (a pointer anywhere on it sets the level there),
 * or focus it and use the arrow keys — a slider (`role="slider"`) whose
 * value reads "750 ml of 2 L". A dashed line marks what Cookpool thinks.
 */
function LevelControl({ item, says, onChange }: { item: KitchenItem; says: number; onChange: (milli: number) => void }) {
  const dragging = React.useRef(false);
  const fill = levelPercent(item, says);
  const thinks = levelPercent(item, item.qtyLeftMilli);
  const setFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.height <= 0) return;
    onChange(levelAt(item, (r.bottom - e.clientY) / r.height));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${item.name} left`}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={item.qtyBoughtMilli}
      aria-valuenow={says}
      aria-valuetext={levelValueText(item, says)}
      onKeyDown={(e) => {
        const key = levelKeyOf(e.key);
        if (!key) return;
        e.preventDefault();
        onChange(stepLevel(item, says, key));
      }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setFrom(e);
      }}
      onPointerMove={(e) => {
        if (dragging.current) setFrom(e);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      className="relative h-[260px] w-[120px] shrink-0 cursor-ns-resize touch-none select-none overflow-hidden rounded-b-[26px] rounded-t-[18px] border-[3px] border-foreground bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span aria-hidden className="absolute inset-x-0 bottom-0 border-t-2 border-primary bg-[#E4F2EA] transition-[height] duration-100" style={{ height: `${fill}%` }} />
      <span aria-hidden className="absolute inset-x-0 border-t-2 border-dashed border-[#9AA39D]" style={{ bottom: `${thinks}%` }} />
      <span
        aria-hidden
        className="absolute left-1/2 -ml-7 h-7 w-14 rounded-full bg-foreground shadow-[0_2px_6px_rgba(0,0,0,0.25)]"
        style={{ bottom: `calc(${fill}% - 14px)` }}
      />
    </div>
  );
}
