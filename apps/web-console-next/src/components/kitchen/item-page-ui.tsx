"use client";

import * as React from "react";
import Link from "./link";
import { CookingPot, SlidersVertical, Timer } from "lucide-react";
import type { KitchenItem, KitchenStockMove, KitchenUsual } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import type { MemberNames } from "./members";
import type { ItemRef } from "./pantry";
import { pantryRow } from "./pantry-list";
import { UseSheet, scaledLeftOfBought, type UseSheetTarget } from "./use-sheet-ui";
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
import { askButtonText, askName, askStatus } from "./ask-before-use";
import { AskLockIcon, AskStatusLine, AskWaitBox } from "./ask-ui";
import { canBuyAgain, canCheck, checkHref, levelRing, quickPicks, ringDash, ringLines, type RingTone } from "./item-page";
import { K_CARD, K_SECTION } from "./kit";
import { useSetState } from "./set-row-ui";
import { pickWrite, type AmountPick } from "./amount-picker";

/**
 * The new frame's item page parts (cookpool-pantry PN-7, design §5, the
 * canvas's ItemPage; cookpool-revamp RV-15, RvItem): the level ring, the
 * use row, "Runs out Tue", Who had it, and the actions — Got more, Finish
 * it, Wasted, then Fix how much is left and Cook with it. The page (`/pantry/[itemRef]`) puts them
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
  "flex min-h-12 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] bg-card px-2.5 text-sm font-medium text-foreground shadow-cp-card transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The ring's colour (RV-3, the board): ink while there is plenty, amber when low or use soon, red once expired. */
const RING_STROKE: Record<RingTone, string> = { ok: "stroke-foreground", low: "stroke-cp-soon", expired: "stroke-cp-expired" };

// ── The level ring ─────────────────────────────────────────────────

const RING_R = 36;

/**
 * How much is left (RV-15, the board): an 88 px ring in the level's colour
 * with the percent inside, then two lines — "1 L of 2 L" and "₹34 left".
 * RV-24: each amount in its own best unit ("500 ml of 2 L", never "1000 ml"),
 * and no use-by after the worth (the header's chip says it).
 */
export function LevelRingCard({ item, usual, meId, names }: Pick<ItemPartsCtx, "item" | "usual" | "meId" | "names">) {
  const ring = levelRing(item, { usual, meId, names });
  const lines = ringLines(item);
  const left = scaledLeftOfBought(item) ?? lines.left;
  return (
    <section aria-label="How much is left" className={cn(K_CARD, "flex items-center gap-4 p-4")}>
      <span className="relative h-[88px] w-[88px] shrink-0" role="img" aria-label={ring.label}>
        <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden className="block">
          <circle cx="44" cy="44" r={RING_R} fill="none" className="stroke-cp-line" strokeWidth="9" />
          {ring.percent > 0 ? (
            <circle
              cx="44"
              cy="44"
              r={RING_R}
              fill="none"
              className={RING_STROKE[ring.tone]}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={ringDash(ring.percent, RING_R)}
              transform="rotate(-90 44 44)"
            />
          ) : null}
        </svg>
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-lg font-medium tabular-nums">
          {ring.percent}%
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span role="status" className="text-xl font-medium leading-tight tabular-nums">
          {left}
        </span>
        {lines.worth ? <span className="text-sm font-normal tabular-nums text-muted-foreground">{lines.worth}</span> : null}
      </span>
    </section>
  );
}

// ── How much to use ────────────────────────────────────────────────

/** The use row's buttons: 48 px, on the tint; your usual on the accent. */
const QUICK =
  "flex min-h-12 min-w-0 items-center justify-center rounded-[14px] px-1.5 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/**
 * How much to use (RV-15, the board): one row of one-tap amounts — half
 * your usual, your usual on the accent, twice it — and More, the Pantry's
 * sheet (PN-5's `UseSheet`) with the full amount picker, who had it, Finish
 * it and the rest. A tap logs it at once for the people of last time, with
 * the ten-second Undo; when you must ask first (PN-9) the same taps ask
 * instead, and while an ask waits its box shows here with Cancel.
 */
export function QuickUse({ itemRef, item, usual, roster, meId, names }: ItemPartsCtx) {
  const logUse = useLogUse();
  const [sheet, setSheet] = React.useState<UseSheetTarget | null>(null);
  // Ask before use (cookpool-pantry PN-9): who you must ask first, and your ask while it waits.
  const askToUse = useAskToUse();
  const cancelAsk = useCancelAsk();
  const asks = useAsks();
  const now = useMinuteNow();
  const who = itemRef.kind === "group" ? askName(item, { names }) : null;
  const status = askStatus(item.id, asks.data?.mine ?? null, { now, names });
  const row = pantryRow(item, { usual, showPantry: false, meId, names, askName: who });
  const set = useSetState(row, item, roster, meId);
  const { consumers } = set;
  const picks = quickPicks(item, set.start);
  if (picks.length === 0) return null;
  const personal = item.pantry.kind === "personal";
  const ready = personal || consumers.length > 0;
  const use = (pick: AmountPick) => {
    if (!ready) return;
    const write = pickWrite(item, pick);
    if (who && itemRef.kind === "group") {
      void askToUse({ ref: itemRef, item, ...write, consumers, idempotencyKey: crypto.randomUUID(), meId, names, who });
    } else {
      void logUse({ ref: itemRef, item, ...write, consumers, idempotencyKey: crypto.randomUUID(), meId, names });
    }
  };
  if (status?.phase === "waiting") return <AskWaitBox status={status} onCancel={() => void cancelAsk(status.ask)} />;
  return (
    <section aria-label={who ? `Ask ${who} for some` : "Use some"} className="flex flex-col gap-2">
      {status ? <AskStatusLine status={status} className="mt-0 px-1" /> : null}
      {who ? (
        <p className="flex items-center gap-1.5 px-1 text-[13px] font-normal text-muted-foreground">
          <AskLockIcon className="h-3.5 w-3.5" />
          {askButtonText(who)} first
        </p>
      ) : null}
      <div role="group" aria-label="Use some" className="grid grid-cols-4 gap-2">
        {picks.map((q) => (
          <button
            key={q.label}
            type="button"
            disabled={!ready}
            aria-label={who ? `${askButtonText(who)} for ${q.label}` : `Use ${q.label}`}
            onClick={() => use(q.pick)}
            className={cn(QUICK, q.usual ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80")}
          >
            <span className="truncate">{q.label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setSheet({ row, item: { ...item, canUse: true }, usual })}
          className={cn(QUICK, "col-start-4 bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80")}
        >
          More
        </button>
      </div>
      {/* The Pantry's More… sheet (PN-5): the full amount picker, who had it, Log, Finish it, Wasted, Cook with it. */}
      <UseSheet target={sheet} onClose={() => setSheet(null)} meId={meId} onLogged={() => undefined} />
    </section>
  );
}

// ── At this rate ───────────────────────────────────────────────────

/** "Runs out Tue" (RV-15, the board), its rate for a screen reader; nothing without an estimate. */
export function RunOutCard({ item, moves }: { item: KitchenItem; moves: readonly KitchenStockMove[] | null }) {
  const now = React.useMemo(() => new Date(), []);
  const estimate = moves ? runOutEstimate(moves, item, now) : null;
  if (!estimate) return null;
  return (
    <section aria-label="At this rate" className="flex min-h-11 items-center gap-2.5 px-0.5">
      <Timer className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate text-[15px] font-medium">
        {estimate.short}
        <span className="sr-only"> · {estimate.rate}</span>
      </span>
    </section>
  );
}

// ── Who had it ─────────────────────────────────────────────────────

/** A group item's people (RV-15, the board): each a face and how much they had; their part and cost for a screen reader. */
export function WhoHadItCard({ item, moves, meId, names }: { item: KitchenItem; moves: readonly KitchenStockMove[] | null; meId: string | null; names: MemberNames }) {
  if (item.pantry.kind !== "group" || !moves) return null;
  const rows = whoHadIt(moves, item, { meId, names });
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="who-had-it-heading" className="space-y-2.5">
      <h2 id="who-had-it-heading" className={K_SECTION}>
        Who had it
      </h2>
      <ul className="flex gap-5 overflow-x-auto pb-1">
        {rows.map((r) => (
          <li key={r.subjectId} className="flex min-w-[56px] shrink-0 flex-col items-center gap-1.5 text-center">
            <Face subjectId={r.subjectId} meId={meId} names={names} className="h-12 w-12 text-[15px] font-medium" />
            <span className="max-w-[96px] truncate text-[13px] font-medium tabular-nums">
              <span className="sr-only">{r.name} </span>
              {r.qtyText}
              <span className="sr-only">
                , {r.shareText}
                {r.costMinor > 0 ? `, ${shortMoney(r.costMinor, item.currency)}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The actions ────────────────────────────────────────────────────

/** The second row: quieter, no card under them. */
const SECONDARY_ACTION =
  "flex min-h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The board's one row (RV-15): Got more (one tap, like last time, with
 * Change and Undo), Finish it (logs the rest for the people of last time),
 * Wasted (at once, with the ten-second Undo, which puts it back and takes
 * back any charge). Under it, quieter: Fix how much is left (the stock
 * check) and Cook with it. Each shows only where it can be done: using needs
 * something left, getting more and checking a pantry you may change.
 */
export function ItemActionsRow({ itemRef, item, usual, roster, meId, names, canWrite }: ItemPartsCtx & { canWrite: boolean }) {
  const buyAgain = useBuyAgain();
  const logUse = useLogUse();
  const wasteItem = useWasteItem();
  const askToUse = useAskToUse();
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
  // At once (SM-5, the board): none left on screen and the Undo toast up before the server answers; it says who was charged.
  const waste = () => void wasteItem({ ref: itemRef, item, meId, idempotencyKey: crypto.randomUUID() });
  const cook = live && !who;

  return (
    <section aria-label="Actions" className="space-y-1.5">
      <div className="grid grid-cols-3 gap-2">
        {buy ? (
          <button
            type="button"
            onClick={() => void buyAgain({ ref: itemRef, item, meId, today: localIsoDay(new Date()), idempotencyKey: crypto.randomUUID() })}
            className={ACTION}
          >
            <span className="truncate">Got more</span>
          </button>
        ) : null}
        {live ? (
          <button type="button" onClick={finish} className={ACTION}>
            <span className="truncate">{who ? "Ask for the rest" : "Finish it"}</span>
          </button>
        ) : null}
        {live && !who ? (
          <button type="button" onClick={waste} className={ACTION}>
            Wasted
          </button>
        ) : null}
      </div>
      {check || cook ? (
        <div className="flex flex-wrap items-center justify-center gap-1">
          {check ? (
            <Link href={checkHref(itemRef)} className={SECONDARY_ACTION}>
              <SlidersVertical className="h-[18px] w-[18px] shrink-0" aria-hidden />
              <span className="truncate">Fix how much is left</span>
            </Link>
          ) : null}
          {cook ? (
            <Link href={cookHref(itemRef)} className={SECONDARY_ACTION}>
              <CookingPot className="h-[18px] w-[18px] shrink-0" aria-hidden />
              Cook with it
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
