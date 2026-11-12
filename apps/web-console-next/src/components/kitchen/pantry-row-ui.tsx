"use client";

import * as React from "react";
import { Check, Lock } from "lucide-react";
import type { KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { NoteLine } from "./item-note-ui";
import { SwipeRow, type SwipeAction } from "./row-gestures-ui";
import { swipeUseLabel } from "./item-actions";
import { type LevelTone, type PantryRow, type RowTag } from "./pantry-list";
import { pillClass } from "./new-home-parts-ui";
import type { MemberNames } from "./members";
import { SetRow } from "./set-row-ui";
import { useAskToUse, useCancelAsk } from "./ask-data";
import { askRowEnd, type AskStatus } from "./ask-before-use";
import { AskStatusLine } from "./ask-ui";

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
  soon: "bg-cp-soon-tint text-cp-soon",
  low: "bg-cp-soon-tint text-cp-soon",
  expired: "bg-cp-expired-tint text-cp-expired",
  // The canvas's AskRequest: amber, with a lock (PN-9).
  ask: "bg-cp-soon-tint text-cp-soon",
};

/** The bar's fill (RV-3, the board): muted while there is plenty, amber when low or use soon, red once expired. */
const LEVEL_FILL: Record<LevelTone, string> = { ok: "bg-muted-foreground", low: "bg-cp-soon", expired: "bg-cp-expired" };

export function RowTagPill({ tag }: { tag: RowTag }) {
  return (
    <span className={cn("inline-flex min-w-0 shrink items-center gap-1 truncate whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TAG[tag.tone])}>
      {tag.tone === "ask" ? <Lock className="h-3 w-3 shrink-0" aria-hidden /> : null}
      <span className="truncate">{tag.label}</span>
    </span>
  );
}

/** How much is left, as a bar in the level's colour (design §2.3). Decorative: the words beside it say the amount. */
export function LevelBar({ percent, tone, className }: { percent: number; tone: LevelTone; className?: string }) {
  return (
    <span aria-hidden className={cn("block h-1 shrink-0 overflow-hidden rounded-full bg-cp-line", className)}>
      <span className={cn("block h-full rounded-full", LEVEL_FILL[tone])} style={{ width: `${percent}%` }} />
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
  askName = null,
  askStatus = null,
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
  /** Ask before use (cookpool-pantry PN-9): who you must ask ("Meera"), when you must (the row's `variant: "ask"`). */
  askName?: string | null;
  /** Your latest ask for it, as the row says it ("Asked Meera · 1 pinch · waiting"). */
  askStatus?: AskStatus | null;
}) {
  const chip = row.chip;
  const askToUse = useAskToUse();
  const cancelAsk = useCancelAsk();
  const askEnd = several ? null : askRowEnd(row, askStatus, { askName, meId, names });
  const ask = () => {
    if (askEnd?.kind !== "ask" || item.pantry.kind !== "group" || row.ref.kind !== "group" || !askName) return;
    const step = askEnd.step;
    void askToUse({
      ref: row.ref,
      item,
      qtyMilli: step.qtyMilli,
      consumers: askEnd.consumers,
      idempotencyKey: crypto.randomUUID(),
      what: step.words,
      measure: step.amount.kind === "measure" ? { measure: step.amount.measure, quantity: step.amount.quantity } : null,
      meId,
      names,
      who: askName,
    });
  };
  const swipe: SwipeAction | null =
    chip?.kind === "log" ? { label: several ? (inTray ? "Take out" : "Add to tray") : swipeUseLabel(chip.words), tone: "use", run: onChip } : null;
  const opens = !row.pending && row.canUse;
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 shrink truncate text-base font-medium leading-snug", row.struck && "text-muted-foreground line-through")}>{row.name}</span>
        {row.tag ? <RowTagPill tag={row.tag} /> : null}
      </span>
      <span className="mt-1.5 flex min-w-0 items-center gap-2">
        <LevelBar percent={row.percent} tone={row.level} className="w-14" />
        <span className="min-w-0 truncate text-[13px] font-normal text-muted-foreground">
          <span className="sr-only">Left: </span>
          {row.levelText}
        </span>
      </span>
      {row.note ? <NoteLine note={row.note} /> : null}
      {/* While it waits and the row is open, the set row's box says it (with Cancel). */}
      {askStatus && !(open && askStatus.phase === "waiting") ? <AskStatusLine status={askStatus} /> : null}
    </>
  );
  return (
    <SwipeRow
      action={row.pending || open ? null : swipe}
      onLongPress={row.pending || !row.canUse ? undefined : onMore}
      aria-busy={row.pending || undefined}
      data-row-id={row.id}
      frontClassName={cn(open && "bg-muted/40")}
    >
      <div className="flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-3">
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
        {open ? null : askEnd?.kind === "ask" ? (
          <button
            type="button"
            aria-label={askEnd.label}
            onClick={ask}
            className="flex h-11 max-w-[46%] shrink-0 items-center gap-1.5 rounded-[14px] bg-foreground px-3.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} aria-hidden />
            <span className="truncate">{askEnd.words}</span>
          </button>
        ) : askEnd?.kind === "cancel" ? (
          <button
            type="button"
            aria-label={askEnd.label}
            onClick={() => void cancelAsk(askEnd.ask)}
            className={cn(pillClass(), "h-11 bg-cp-soon-tint text-cp-soon hover:bg-cp-soon-tint/80")}
          >
            Cancel
          </button>
        ) : !chip ? null : chip.kind === "log" ? (
          <button
            type="button"
            aria-label={several ? `${inTray ? "Take out of" : "Add to"} the tray: ${chip.words} of ${row.name}` : chip.label}
            aria-pressed={several ? inTray : undefined}
            onClick={onChip}
            className={cn(pillClass(several && inTray ? "main" : "quiet"), "h-11 max-w-[42%]")}
          >
            {several ? (
              <span
                aria-hidden
                className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full", inTray ? "bg-primary-foreground text-primary" : "border-[1.5px] border-current text-transparent opacity-60")}
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
            className={cn(pillClass(), "h-11")}
          >
            Use
          </button>
        )}
      </div>
      {open ? (
        <SetRow row={row} item={item} usual={usual} meId={meId} names={names} onMore={onMore} onLogged={onLogged} askName={askName} askStatus={askStatus} />
      ) : null}
    </SwipeRow>
  );
}
