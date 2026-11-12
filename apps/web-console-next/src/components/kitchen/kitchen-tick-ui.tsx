"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import type { KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { saveUsualUnit, useUsualUnits } from "@/lib/pantry-device";
import type { PantryRow } from "./pantry-list";
import { useByDay } from "./pantry-list";
import { useLogUse } from "./pantry-data";
import { useAskToUse, useCancelAsk } from "./ask-data";
import { askRowEnd, type AskStatus } from "./ask-before-use";
import { AskStatusLine } from "./ask-ui";
import { NoteLine } from "./item-note-ui";
import { RING } from "./new-home-parts-ui";
import { qtyText } from "./quick-use";
import type { MemberNames } from "./members";
import { TICK_EMPTY, lastUseText, tickAmount, tickMeta, tickStart, tickWrite, usualUnitKey, type TickState } from "./tick-row";
import { TickRow } from "./tick-row-ui";

/**
 * The Kitchen's tick rows (cookpool-revamp RV-10, the canvas's RvKitchen):
 * the shared `TickRow` on a Kitchen item. The grey amount is the item's
 * suggestion (PN-2's usual for this part of the day, through PN-5's ladder),
 * in the food's usual unit on this device; the line under the name is the
 * last use (the caller's usual for it); the tick logs through the one use
 * path (`useLogUse`: at once, with the Undo toast) for you alone, and ticking
 * again presses that toast's Undo. Who else had it is the item page's (its
 * Use, with the people).
 */

type Row = PantryRow & { item: ReachableItem };

interface Done {
  number: string;
  word: string;
  /** The toast's Undo, once it shows. */
  undo: (() => void) | null;
}

/** The ticks of one Kitchen screen: each item's box and whether it is logged, shared by every place it is listed (Usual now and its section). */
export function useKitchenTicks() {
  const [boxes, setBoxes] = React.useState<ReadonlyMap<string, TickState>>(() => new Map());
  const [done, setDone] = React.useState<ReadonlyMap<string, Done>>(() => new Map());
  const units = useUsualUnits();
  const setBox = React.useCallback((id: string, next: TickState) => setBoxes((m) => new Map(m).set(id, next)), []);
  const putDone = React.useCallback((id: string, d: Done | null) => {
    setDone((m) => {
      const next = new Map(m);
      if (d) next.set(id, d);
      else next.delete(id);
      return next;
    });
  }, []);
  return { boxes, setBox, done, putDone, units };
}

export type KitchenTicks = ReturnType<typeof useKitchenTicks>;

export function KitchenTickRow({
  row,
  usual,
  ticks,
  meId,
  names,
  now,
  askName = null,
  askStatus = null,
}: {
  row: Row;
  usual: KitchenUsual | null;
  ticks: KitchenTicks;
  meId: string | null;
  names: MemberNames;
  now: Date;
  askName?: string | null;
  askStatus?: AskStatus | null;
}) {
  const logUse = useLogUse();
  const askToUse = useAskToUse();
  const cancelAsk = useCancelAsk();
  const { item } = row;
  const state = ticks.boxes.get(row.id) ?? TICK_EMPTY;
  const done = ticks.done.get(row.id) ?? null;
  const unitKey = usualUnitKey(item);
  const canLog = row.canUse && !row.pending;
  const start = canLog ? tickStart(item, row.ladder.suggestion, ticks.units[unitKey] ?? null) : null;
  const amount = tickAmount(item, start, state);
  const left = item.qtyLeftMilli > 0 ? `${qtyText(item.qtyLeftMilli, item.dimension)} left` : row.levelText;
  const meta = tickMeta({
    last: lastUseText(usual, item, now),
    left,
    expired: row.status.expired,
    soon: row.status.soon,
    useBy: item.daysToUseBy !== null ? useByDay(item) : null,
  });
  // A tick logs for you alone; your own pantry names nobody.
  const consumers = item.pantry.kind === "personal" ? [] : meId ? [meId] : [];

  const tick = () => {
    if (done) {
      done.undo?.();
      return;
    }
    if (!amount) return;
    const w = tickWrite(item, amount);
    const mine: Done = { number: amount.number, word: amount.word, undo: null };
    ticks.putDone(row.id, mine);
    void logUse({
      ref: row.ref,
      item,
      qtyMilli: w.qtyMilli,
      consumers,
      idempotencyKey: crypto.randomUUID(),
      what: w.what,
      measure: w.measure,
      meId,
      names,
      onUndoable: (undo) => {
        mine.undo = undo;
      },
      onUndone: () => ticks.putDone(row.id, null),
    }).then((r) => {
      if (!r.ok) ticks.putDone(row.id, null);
    });
  };

  // Ask before use (PN-9): an ask-first row asks with the box's amount, and a waiting ask offers Cancel, in the tick's place.
  const askEnd = askRowEnd(row, askStatus, { askName, meId, names });
  let end: React.ReactNode = null;
  if (askEnd?.kind === "ask" && amount && askName && row.ref.kind === "group") {
    const ref = row.ref;
    const w = tickWrite(item, amount);
    end = (
      <button
        type="button"
        aria-label={`Ask ${askName} for ${amount.words} of ${row.name}`}
        onClick={() =>
          void askToUse({ ref, item, qtyMilli: w.qtyMilli, consumers, idempotencyKey: crypto.randomUUID(), what: w.what, measure: w.measure, meId, names, who: askName })
        }
        className={cn("flex h-11 w-12 items-center justify-center rounded-xl bg-foreground text-background hover:bg-foreground/90", RING)}
      >
        <Lock className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
      </button>
    );
  } else if (askEnd?.kind === "cancel") {
    const ask = askEnd.ask;
    end = (
      <button
        type="button"
        aria-label={askEnd.label}
        onClick={() => void cancelAsk(ask)}
        className={cn("flex h-11 w-12 items-center justify-center rounded-xl bg-cp-soon-tint text-[13px] font-medium text-cp-soon hover:bg-cp-soon-tint/80", RING)}
      >
        ×
      </button>
    );
  } else if (row.variant === "ask" && !done) {
    end = <span aria-hidden />;
  }

  return (
    <li aria-busy={row.pending || undefined}>
      <TickRow
        id={row.id}
        name={row.name}
        href={row.pending ? null : row.href}
        meta={meta}
        amount={row.variant === "ask" && !askEnd ? null : amount}
        state={state}
        onState={(next) => ticks.setBox(row.id, next)}
        onUnit={(unitId) => saveUsualUnit(unitKey, unitId)}
        done={done ? { number: done.number, word: done.word } : null}
        onTick={tick}
        end={end}
      >
        {row.note ? <NoteLine note={row.note} /> : null}
        {askStatus ? <AskStatusLine status={askStatus} /> : null}
      </TickRow>
    </li>
  );
}
