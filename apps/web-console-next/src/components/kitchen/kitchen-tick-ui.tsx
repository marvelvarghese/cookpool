"use client";

import * as React from "react";
import { Check, Lock } from "lucide-react";
import type { KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { saveUsualUnit, useUsualUnits } from "@/lib/pantry-device";
import type { PantryRow } from "./pantry-list";
import { useByDay } from "./pantry-list";
import { useAskToUse, useCancelAsk } from "./ask-data";
import { askRowEnd, type AskStatus } from "./ask-before-use";
import { AskStatusLine } from "./ask-ui";
import { NoteLine } from "./item-note-ui";
import { RING } from "./new-home-parts-ui";
import { qtyText } from "./quick-use";
import type { MemberNames } from "./members";
import { TICK_EMPTY, lastUseText, tickAmount, tickMeta, tickStart, tickWrite, usualUnitKey, type TickAmount, type TickState } from "./tick-row";
import { logBar, loggedMeta, pickStep, pickToast, togglePick, withPicks, withoutPicks, type PickLine } from "./kitchen-picks";
import { useLogSeveral } from "./log-several-data";
import type { TrayEntry } from "./now-strip";
import { TickRow } from "./tick-row-ui";
// The board's row line and stock bar (RV-21).
import { kitchenRowMeta, stockBar } from "./kitchen-staples";
import { StockBar } from "./kitchen-staples-ui";

/**
 * The Kitchen's tick rows (cookpool-revamp RV-10, the canvas's RvKitchen):
 * the shared `TickRow` on a Kitchen item. The grey amount is the item's
 * suggestion (PN-2's usual for this part of the day, through PN-5's ladder),
 * in the food's usual unit on this device; the line under the name is the
 * last use (the caller's usual for it).
 *
 * Since RV-13 ("Tick to pick, Log once") a tick only picks the row: it turns
 * green, its amount and unit stay editable, and ticking again unpicks it.
 * Nothing is written until the screen's one Log button (`KitchenLogBar`),
 * which logs every picked row through Log several's path — each its own use,
 * for you alone, with its own idempotency key — under ONE Undo toast. A
 * logged row's line reads "Logged 1 glass · just now" until reload; a refused
 * one stays picked. Who else had it is the item page's (its Use).
 */

type Row = PantryRow & { item: ReachableItem };

/** The ticks of one Kitchen screen: each item's box, what is picked and what was logged, shared by every place it is listed. */
export function useKitchenTicks() {
  const [boxes, setBoxes] = React.useState<ReadonlyMap<string, TickState>>(() => new Map());
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(() => new Set());
  /** What each row logged from here ("1 glass"), until reload. */
  const [logged, setLogged] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const units = useUsualUnits();
  const setBox = React.useCallback((id: string, next: TickState) => setBoxes((m) => new Map(m).set(id, next)), []);
  const toggle = React.useCallback((id: string) => setPicked((p) => togglePick(p, id)), []);
  return { boxes, setBox, setBoxes, picked, setPicked, toggle, logged, setLogged, units };
}

export type KitchenTicks = ReturnType<typeof useKitchenTicks>;

/** The row's box: the grey amount from its suggestion in the food's usual unit, and what was typed; null when nothing can be logged. */
export function kitchenTickAmount(row: Row, ticks: Pick<KitchenTicks, "boxes" | "units">): TickAmount | null {
  const canLog = row.canUse && !row.pending;
  const start = canLog ? tickStart(row.item, row.ladder.suggestion, ticks.units[usualUnitKey(row.item)] ?? null) : null;
  return tickAmount(row.item, start, ticks.boxes.get(row.id) ?? TICK_EMPTY);
}

/** A row may be picked: it has an amount and needs no ask first. */
export function pickable(row: Row, amount: TickAmount | null): amount is TickAmount {
  return !!amount && row.variant === "use";
}

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
  const askToUse = useAskToUse();
  const cancelAsk = useCancelAsk();
  const { item } = row;
  const state = ticks.boxes.get(row.id) ?? TICK_EMPTY;
  const picked = ticks.picked.has(row.id);
  const logged = ticks.logged.get(row.id) ?? null;
  const unitKey = usualUnitKey(item);
  const amount = kitchenTickAmount(row, ticks);
  const left = item.qtyLeftMilli > 0 ? `${qtyText(item.qtyLeftMilli, item.dimension)} left` : row.levelText;
  const useBy = item.daysToUseBy !== null ? useByDay(item) : null;
  const base = logged
    ? loggedMeta(logged)
    : tickMeta({
        last: lastUseText(usual, item, now),
        left,
        expired: row.status.expired,
        soon: row.status.soon,
        useBy,
      });
  // RV-21 (RvKitchenB): "Use by tomorrow" in amber, "Expired" in red, and the stock bar under the name.
  const meta = kitchenRowMeta(base, row.status, useBy);
  const bar = stockBar(item, row.status);
  // An ask logs for you alone; your own pantry names nobody.
  const consumers = item.pantry.kind === "personal" ? [] : meId ? [meId] : [];

  const tick = () => {
    if (!pickable(row, amount) && !picked) return;
    ticks.toggle(row.id);
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
  } else if (row.variant === "ask") {
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
        done={null}
        picked={picked}
        onTick={tick}
        end={end}
        tickLabel={(words, name, on) => (on ? `Ticked ${words} of ${name}, untick` : `Tick ${words} of ${name}`)}
      >
        <StockBar {...bar} />
        {row.note ? <NoteLine note={row.note} /> : null}
        {askStatus ? <AskStatusLine status={askStatus} /> : null}
      </TickRow>
    </li>
  );
}

/**
 * Log every picked row (RV-13): each through Log several's path (its own use,
 * its own idempotency key, for you alone), under one "Logged 2 items" toast
 * whose Undo undoes them all. The picks clear at once and each row's line
 * says what it logged; a refused row is picked again with what it had, and
 * Undo picks them all again (the board's).
 */
export function useLogPicks(ticks: KitchenTicks, ctx: { meId: string | null; names: MemberNames }) {
  const logSeveral = useLogSeveral();
  return (rows: readonly Row[]) => {
    const picks = rows.flatMap((row) => {
      const amount = kitchenTickAmount(row, ticks);
      return pickable(row, amount) ? [{ row, amount }] : [];
    });
    if (picks.length === 0) return;
    const ids = picks.map((p) => p.row.id);
    const before = new Map(ids.map((id) => [id, ticks.boxes.get(id) ?? TICK_EMPTY] as const));
    const entries: TrayEntry[] = picks.map(({ row, amount }) => ({ itemId: row.id, ref: row.ref, item: row.item, name: row.name, step: pickStep(row.item, amount) }));
    const setLogged = (put: readonly { id: string; words: string }[], drop: readonly string[]) =>
      ticks.setLogged((m) => {
        const next = new Map(m);
        for (const id of drop) next.delete(id);
        for (const p of put) next.set(p.id, p.words);
        return next;
      });
    const setBoxesOf = (of: readonly string[], box: (id: string) => TickState) =>
      ticks.setBoxes((m) => {
        const next = new Map(m);
        for (const id of of) next.set(id, box(id));
        return next;
      });
    // Picked again with what each box had: a refused row, or every one on Undo.
    const putBack = (of: readonly string[]) => {
      setLogged([], of);
      setBoxesOf(of, (id) => before.get(id) ?? TICK_EMPTY);
      ticks.setPicked((p) => withPicks(p, of));
    };

    let undone = false;
    ticks.setPicked((p) => withoutPicks(p, ids));
    setLogged(
      picks.map((p) => ({ id: p.row.id, words: p.amount.words })),
      [],
    );
    setBoxesOf(ids, (id) => ({ typed: "", unit: before.get(id)?.unit ?? null }));
    void logSeveral(entries, {
      meId: ctx.meId,
      names: ctx.names,
      toast: pickToast,
      onRestore: () => {
        undone = true;
        putBack(ids);
      },
    }).then((refused) => {
      if (!undone && refused.length > 0) putBack(refused.map((e) => e.itemId));
    });
  };
}

/**
 * The one Log button (RV-13, the board's): above the floating tab bar (and
 * above the cooking bar while it shows), "Log 2 items" over what and how
 * much. It sits at the end of the page and sticks, so it never covers the
 * last rows; toasts lift above it.
 */
export function KitchenLogBar({ lines, onLog, aboveSessionBar = false }: { lines: readonly PickLine[]; onLog: () => void; aboveSessionBar?: boolean }) {
  const bar = logBar(lines);
  if (!bar) return null;
  return (
    <div
      data-toast-above=""
      className={cn(
        "sticky z-30 min-[900px]:bottom-6",
        // Above the tab bar's room (RV-19's --cp-bottom-bar), and the cooking bar while it shows.
        aboveSessionBar
          ? "bottom-[calc(var(--cp-bottom-bar,calc(max(14px,env(safe-area-inset-bottom))+76px))+74px)]"
          : "bottom-[calc(var(--cp-bottom-bar,calc(max(14px,env(safe-area-inset-bottom))+76px))+6px)]",
      )}
    >
      <button
        type="button"
        onClick={onLog}
        aria-label={bar.label}
        className={cn(
          "flex min-h-[60px] w-full items-center gap-3 rounded-[18px] bg-primary px-[18px] text-left text-primary-foreground shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-colors hover:bg-primary/90",
          RING,
        )}
      >
        <Check className="h-[22px] w-[22px] shrink-0" strokeWidth={2.4} aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[17px] font-medium">{bar.title}</span>
          <span className="truncate text-[13px] font-normal opacity-[0.85]">{bar.sub}</span>
        </span>
      </button>
    </div>
  );
}
