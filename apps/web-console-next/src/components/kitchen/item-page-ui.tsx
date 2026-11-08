"use client";

import * as React from "react";
import Link from "./link";
import { CookingPot, SlidersVertical, Timer } from "lucide-react";
import type { KitchenItem, KitchenStockMove, KitchenUsual } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import type { MemberNames } from "./members";
import { expiryChip, expiryText, type ItemRef } from "./pantry";
import { pantryRow } from "./pantry-list";
import { UseSheet, type UseSheetTarget } from "./use-sheet-ui";
import { UseByPill } from "./pantry-ui";
import { WasteConfirm } from "./item-actions-ui";
import { Face } from "./faces-ui";
import { useLogUse, useWasteItem } from "./pantry-data";
import { useBuyAgain } from "./buy-again-data";
import { defaultConsumers } from "./quick-use";
import { cookHref } from "./dish-maker";
import { localIsoDay } from "./item-form";
import { shortMoney } from "./from-before";
import { leftText } from "./pantry";
import { runOutEstimate, whoHadIt } from "./item-use";
import { useAskToUse, useAsks, useCancelAsk, useMinuteNow } from "./ask-data";
import { askName, askStatus } from "./ask-before-use";
import { AskLockIcon, AskStatusLine, AskWaitBox } from "./ask-ui";
import {
  RING_COLORS,
  canBuyAgain,
  canCheck,
  checkHref,
  chipMeasure,
  levelRing,
  quickChips,
  ringDash,
  type QuickChip,
} from "./item-page";

/**
 * The new frame's item page parts (cookpool-pantry PN-7, design §5, the
 * canvas's ItemPage): the level ring, the quick-use chips, "At this rate",
 * Who had it, and the actions — Bought again, Finish it, Wasted, Fix how
 * much is left, and Cook with it. The page (`/pantry/[itemRef]`) puts them
 * in the design's order; its history, note and measures are its own.
 */

export interface ItemPartsCtx {
  itemRef: ItemRef;
  item: KitchenItem;
  meId: string | null;
  names: MemberNames;
  /** The group's members in its order (null for your own item, or while they load). */
  roster: readonly string[] | null;
  /** Your usual of it (PN-2's, with the part of the day's), or null. */
  usual: KitchenUsual | null;
}

/** A quiet button beside the chips: the actions row. */
const ACTION =
  "flex min-h-[48px] min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border border-input bg-card px-2.5 text-sm font-extrabold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ── The level ring ─────────────────────────────────────────────────

const RING_R = 40;

/** What is left of what was bought, and what that is worth, as a ring in the level's colour. */
export function LevelRingCard({ item, usual, meId, names }: Pick<ItemPartsCtx, "item" | "usual" | "meId" | "names">) {
  const ring = levelRing(item, { usual, meId, names });
  const chip = expiryChip(item);
  const long = expiryText(item);
  return (
    <section aria-label="How much is left" className="flex items-center gap-4 rounded-[22px] border bg-card p-4">
      <span className="relative h-24 w-24 shrink-0" role="img" aria-label={ring.label}>
        <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden className="block">
          <circle cx="48" cy="48" r={RING_R} fill="none" stroke="#ECEEE9" strokeWidth="10" />
          {ring.percent > 0 ? (
            <circle
              cx="48"
              cy="48"
              r={RING_R}
              fill="none"
              stroke={RING_COLORS[ring.tone]}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={ringDash(ring.percent, RING_R)}
              transform="rotate(-90 48 48)"
            />
          ) : null}
        </svg>
        <span aria-hidden className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-extrabold tabular-nums leading-none">{ring.percent}%</span>
          <span className="mt-0.5 text-[11px] font-bold text-muted-foreground">left</span>
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-[22px] font-extrabold leading-tight tracking-tight tabular-nums">{ring.left}</span>
          <span className="text-[15px] font-semibold text-muted-foreground">{ring.of}</span>
        </span>
        {ring.worth ? <span className="text-sm font-bold tabular-nums text-foreground/80">{ring.worth}</span> : null}
        <span className="text-[13px] font-semibold text-muted-foreground">{ring.detail}</span>
        {chip && long && item.qtyLeftMilli > 0 ? <UseByPill chip={{ ...chip, label: long }} className="mt-1 self-start px-2.5 py-1" /> : null}
      </span>
    </section>
  );
}

// ── The quick-use chips ────────────────────────────────────────────

const CHIP =
  "flex min-h-[52px] min-w-0 flex-col items-center justify-center rounded-[14px] border bg-card px-1.5 py-1 text-center transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The suggestion (its reason under it), the next two steps of the ladder,
 * and More…: a tap logs that amount for the people of last time, with the
 * ten-second Undo. More… is the Pantry's sheet (PN-5's `UseSheet`).
 */
export function QuickUseChips({ itemRef, item, usual, roster, meId, names }: ItemPartsCtx) {
  const logUse = useLogUse();
  const [sheet, setSheet] = React.useState<UseSheetTarget | null>(null);
  // Ask before use (cookpool-pantry PN-9): who you must ask first, and your ask while it waits.
  const askToUse = useAskToUse();
  const cancelAsk = useCancelAsk();
  const asks = useAsks();
  const now = useMinuteNow();
  const who = itemRef.kind === "group" ? askName(item, { names }) : null;
  const status = askStatus(item.id, asks.data?.mine ?? null, { now, names });
  const chips = quickChips(item, usual);
  if (chips.length === 0) return null;
  const log = (chip: QuickChip) => {
    const fromChip = chip.consumerIds?.filter((id) => roster === null || roster.includes(id)) ?? [];
    const consumers = item.pantry.kind === "personal" ? [] : fromChip.length > 0 ? fromChip : defaultConsumers(usual, roster, meId);
    if (who && itemRef.kind === "group") {
      void askToUse({ ref: itemRef, item, qtyMilli: chip.qtyMilli, consumers, idempotencyKey: crypto.randomUUID(), what: chip.words, measure: chipMeasure(chip), meId, names, who });
      return;
    }
    void logUse({
      ref: itemRef,
      item,
      qtyMilli: chip.qtyMilli,
      consumers,
      idempotencyKey: crypto.randomUUID(),
      what: chip.words,
      measure: chipMeasure(chip),
      meId,
      names,
    });
  };
  if (status?.phase === "waiting") return <AskWaitBox status={status} onCancel={() => void cancelAsk(status.ask)} />;
  return (
    <div className="flex flex-col gap-2">
    {status ? <AskStatusLine status={status} className="mt-0 px-1" /> : null}
    {who ? (
      <p className="flex items-center gap-1.5 px-1 text-[13px] font-bold text-[#8A5A00]">
        <AskLockIcon className="h-4 w-4" />
        Each tap asks {who}
      </p>
    ) : null}
    <div role="group" aria-label={who ? `Ask ${who} for some` : "Use some"} className="grid grid-cols-4 gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => log(chip)}
          className={cn(CHIP, chip.suggested ? "border-primary/60 bg-[#E4F2EA]" : "border-[#C9CFC6]")}
        >
          <span className="max-w-full truncate text-sm font-extrabold">{chip.label}</span>
          {chip.why ? <span className="max-w-full truncate text-[11px] font-bold text-[#165C3A]">{chip.why}</span> : null}
        </button>
      ))}
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setSheet({ row: pantryRow(item, { usual, showPantry: false, meId, names, askName: who }), item: { ...item, canUse: true }, usual })}
        className="col-start-4 flex min-h-[52px] items-center justify-center rounded-[14px] bg-primary px-2 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        More…
      </button>
      {/* The Pantry's More… sheet (PN-5): how much, who had it, Log, Finish it, Wasted, Cook with it. */}
      <UseSheet target={sheet} onClose={() => setSheet(null)} meId={meId} onLogged={() => undefined} />
    </div>
    </div>
  );
}

// ── At this rate ───────────────────────────────────────────────────

/** "At this rate it runs out Tue" with the rate under it; nothing without an estimate. */
export function RunOutCard({ item, moves }: { item: KitchenItem; moves: readonly KitchenStockMove[] | null }) {
  const now = React.useMemo(() => new Date(), []);
  const estimate = moves ? runOutEstimate(moves, item, now) : null;
  if (!estimate) return null;
  return (
    <section aria-label="At this rate" className="flex items-center gap-3 rounded-[18px] bg-[#E6EEF8] px-3.5 py-3">
      <Timer className="h-[22px] w-[22px] shrink-0 text-[#1D4F91]" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-extrabold text-[#12305A]">{estimate.line}</span>
        <span className="text-[13px] font-semibold text-[#1D4F91]">{estimate.rate}</span>
      </span>
    </section>
  );
}

// ── Who had it ─────────────────────────────────────────────────────

/** A group item's people, each with their part of what was used, what they had and what it cost them. */
export function WhoHadItCard({ item, moves, meId, names }: { item: KitchenItem; moves: readonly KitchenStockMove[] | null; meId: string | null; names: MemberNames }) {
  if (item.pantry.kind !== "group" || !moves) return null;
  const rows = whoHadIt(moves, item, { meId, names });
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="who-had-it-heading" className="space-y-2.5">
      <h2 id="who-had-it-heading" className="text-[17px] font-extrabold">
        Who had it
      </h2>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {rows.map((r) => (
          <li key={r.subjectId} className="flex min-w-[96px] flex-1 flex-col items-center gap-1 rounded-[16px] border bg-card px-2 py-2.5 text-center">
            <Face subjectId={r.subjectId} meId={meId} names={names} className="h-9 w-9" />
            <span className="max-w-full truncate text-[13px] font-extrabold">
              {r.name} <span className="tabular-nums">{r.shareText}</span>
            </span>
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">
              {r.qtyText}
              {r.costMinor > 0 ? ` · ${shortMoney(r.costMinor, item.currency)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The actions ────────────────────────────────────────────────────

/**
 * Bought again (one tap, like last time, with Change and Undo), Finish it
 * (logs the rest for the people of last time), Wasted (the waste confirm,
 * with who pays), Fix how much is left (the stock check), and Cook with it.
 * Each shows only where it can be done: using needs something left, buying
 * and checking a pantry you may change.
 */
export function ItemActionsRow({ itemRef, item, usual, roster, meId, names, canWrite }: ItemPartsCtx & { canWrite: boolean }) {
  const buyAgain = useBuyAgain();
  const logUse = useLogUse();
  const wasteItem = useWasteItem();
  const askToUse = useAskToUse();
  const [wasting, setWasting] = React.useState(false);
  const live = canWrite && item.state === "active" && item.qtyLeftMilli > 0;
  // You must ask first (PN-9): Finish it asks for the rest; Wasted and Cook with it are the buyer's (the server refuses them).
  const who = itemRef.kind === "group" ? askName(item, { names }) : null;
  const buy = canBuyAgain(item, canWrite);
  const check = canCheck(item, canWrite);
  if (!live && !buy && !check) return null;

  const finish = () =>
    who && itemRef.kind === "group"
      ? void askToUse({
          ref: itemRef,
          item,
          qtyMilli: item.qtyLeftMilli,
          consumers: defaultConsumers(usual, roster, meId),
          idempotencyKey: crypto.randomUUID(),
          what: leftText(item),
          measure: null,
          meId,
          names,
          who,
        })
      : void logUse({
      ref: itemRef,
      item,
      qtyMilli: item.qtyLeftMilli,
      consumers: item.pantry.kind === "personal" ? [] : defaultConsumers(usual, roster, meId),
      idempotencyKey: crypto.randomUUID(),
      what: leftText(item),
      measure: null,
      meId,
      names,
    });
  const waste = () => {
    setWasting(false);
    void wasteItem({ ref: itemRef, item, meId, idempotencyKey: crypto.randomUUID() });
  };

  return (
    <section aria-label="Actions" className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        {buy ? (
          <button
            type="button"
            onClick={() => void buyAgain({ ref: itemRef, item, meId, today: localIsoDay(new Date()), idempotencyKey: crypto.randomUUID() })}
            className={ACTION}
          >
            <span className="truncate">Bought again</span>
          </button>
        ) : null}
        {live ? (
          <button type="button" onClick={finish} className={ACTION}>
            {who ? "Ask for the rest" : "Finish it"}
          </button>
        ) : null}
        {live && !who ? (
          <button type="button" aria-expanded={wasting} aria-controls="waste-preview" onClick={() => setWasting((w) => !w)} className={ACTION}>
            Wasted
          </button>
        ) : null}
      </div>
      {wasting && live ? (
        <WasteConfirm id="waste-preview" item={item} roster={roster} meId={meId} names={names} onKeep={() => setWasting(false)} onWaste={waste} />
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        {check ? (
          <Link href={checkHref(itemRef)} className={cn(ACTION, live && !who ? "" : "col-span-2")}>
            <SlidersVertical className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">Fix how much is left</span>
          </Link>
        ) : null}
        {live && !who ? (
          <Link href={cookHref(itemRef)} className={cn(ACTION, check ? "px-3.5" : "col-span-2")}>
            <CookingPot className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
            Cook with it
          </Link>
        ) : null}
      </div>
    </section>
  );
}
