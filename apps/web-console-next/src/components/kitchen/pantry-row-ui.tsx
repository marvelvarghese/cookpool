"use client";

import * as React from "react";
import { Check, Lock } from "lucide-react";
import type { KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { NoteLine } from "./item-note-ui";
import { SwipeRow, type SwipeAction } from "./row-gestures-ui";
import { swipeUseLabel } from "./item-actions";
import { LEVEL_COLORS, type LevelTone, type PantryRow, type RowTag } from "./pantry-list";
import type { MemberNames } from "./members";
import { SetRow } from "./set-row-ui";

/**
 * One row of the new Pantry (cookpool-pantry PN-5, design §1, the canvas's
 * PantryNew): the name and its one tag, the level bar in its colour with
 * what is left, the note, and at the end the suggestion chip — "1 glass",
 * logged in one tap for the people from last time, with Undo — or "Use…",
 * which opens the row. A tap on the row opens it in place (the set row);
 * only one is open at a time. PW-8's gestures keep their buttons: swiping
 * left logs the chip's amount, and holding opens the More… sheet, which the
 * set row's More… opens too. Under Log several the chip (and its swipe) puts
 * the amount in the tray instead, and shows a tick while it is there.
 */

const TAG: Record<RowTag["tone"], string> = {
  pantry: "bg-muted text-muted-foreground",
  soon: "bg-[#FDF1D6] text-[#8A5A00]",
  low: "bg-[#FDF1D6] text-[#8A5A00]",
  expired: "bg-[#FDECEC] text-[#B42318]",
  ask: "bg-muted text-foreground",
};

export function RowTagPill({ tag }: { tag: RowTag }) {
  return (
    <span className={cn("inline-flex min-w-0 shrink items-center gap-1 truncate whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-extrabold", TAG[tag.tone])}>
      {tag.tone === "ask" ? <Lock className="h-3 w-3 shrink-0" aria-hidden /> : null}
      <span className="truncate">{tag.label}</span>
    </span>
  );
}

/** How much is left, as a bar in the level's colour (design §2.3). Decorative: the words beside it say the amount. */
export function LevelBar({ percent, tone, className }: { percent: number; tone: LevelTone; className?: string }) {
  return (
    <span aria-hidden className={cn("block h-1.5 shrink-0 overflow-hidden rounded-full bg-[#ECEEE9]", className)}>
      <span className="block h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: LEVEL_COLORS[tone] }} />
    </span>
  );
}

export function PantryRowView({
  row,
  item,
  usual,
  open,
  onToggle,
  onChip,
  onMore,
  several,
  inTray,
  meId,
  names,
  onLogged,
}: {
  row: PantryRow;
  item: ReachableItem;
  usual: KitchenUsual | null;
  open: boolean;
  /** Open the row in place, or close it. */
  onToggle: () => void;
  /** The chip: log the suggestion (or, under Log several, put it in the tray). */
  onChip: () => void;
  /** The More… sheet. */
  onMore: () => void;
  several: boolean;
  inTray: boolean;
  meId: string | null;
  names: MemberNames;
  /** The set row logged: close it. */
  onLogged: () => void;
}) {
  const chip = row.chip;
  const swipe: SwipeAction | null =
    chip?.kind === "log" ? { label: several ? (inTray ? "Take out" : "Add to tray") : swipeUseLabel(chip.words), tone: "use", run: onChip } : null;
  const opens = !row.pending && row.canUse;
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 shrink truncate text-base font-extrabold leading-snug", row.struck && "text-muted-foreground line-through")}>{row.name}</span>
        {row.tag ? <RowTagPill tag={row.tag} /> : null}
      </span>
      <span className="mt-1.5 flex min-w-0 items-center gap-2">
        <LevelBar percent={row.percent} tone={row.level} className="w-16" />
        <span className="min-w-0 truncate text-[13px] font-semibold text-muted-foreground">
          <span className="sr-only">Left: </span>
          {row.levelText}
        </span>
      </span>
      {row.note ? <NoteLine note={row.note} /> : null}
    </>
  );
  return (
    <SwipeRow
      action={row.pending || open ? null : swipe}
      onLongPress={row.pending || !row.canUse ? undefined : onMore}
      aria-busy={row.pending || undefined}
      data-row-id={row.id}
      frontClassName={cn(open && "bg-[#FBFCFA]")}
    >
      <div className="flex min-h-[68px] items-center gap-2.5 py-2.5 pl-3.5 pr-2.5">
        {opens ? (
          <button
            type="button"
            data-row-surface=""
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-w-0 flex-1 flex-col items-stretch rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {body}
          </button>
        ) : (
          <span className={cn("flex min-w-0 flex-1 flex-col", row.pending && "opacity-70")}>{body}</span>
        )}
        {open || !chip ? null : chip.kind === "log" ? (
          <button
            type="button"
            aria-label={several ? `${inTray ? "Take out of" : "Add to"} the tray: ${chip.words} of ${row.name}` : chip.label}
            aria-pressed={several ? inTray : undefined}
            onClick={onChip}
            className={cn(
              "flex h-11 max-w-[42%] shrink-0 items-center gap-1.5 rounded-[12px] border px-3 text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              several && inTray ? "border-primary bg-primary text-primary-foreground" : "border-[#C9CFC6] bg-card text-foreground hover:bg-accent",
            )}
          >
            {several ? (
              <span
                aria-hidden
                className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full", inTray ? "bg-primary-foreground text-primary" : "border-[1.5px] border-[#C9CFC6] text-transparent")}
              >
                <Check className="h-3 w-3" strokeWidth={3.2} />
              </span>
            ) : null}
            <span className="truncate">{chip.words}</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={chip.label}
            onClick={onToggle}
            className="h-11 shrink-0 rounded-[12px] border border-[#C9CFC6] bg-card px-3 text-sm font-extrabold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Use…
          </button>
        )}
      </div>
      {open ? <SetRow row={row} item={item} usual={usual} meId={meId} names={names} onMore={onMore} onLogged={onLogged} /> : null}
    </SwipeRow>
  );
}
