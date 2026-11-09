"use client";

import * as React from "react";
import Link from "./link";
import type { KitchenItem, KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { NoteLine } from "./item-note-ui";
import { FaceRow, MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { faceOrder, toggleFace, whoLine } from "./faces";
import { memberLabel, type MemberNames } from "./members";
import { useLogUse, useMembersOf, useWasteItem } from "./pantry-data";
import { useMemberNames } from "./people-data";
import { WasteConfirm } from "./item-actions-ui";
import { amountCost, shareBreakdown } from "./item-use";
import { qtyText } from "./quick-use";
import { expiryText, leftOfBought, pantryLabel } from "./pantry";
import { formatMinor } from "./money";
import { cookHref } from "./dish-maker";
import { LevelBar } from "./pantry-row-ui";
import { useSetState } from "./set-row-ui";
import type { pickWrite } from "./amount-picker";
import { AmountPicker } from "./amount-picker-ui";
import type { PantryRow } from "./pantry-list";
import { useAskToUse, useAsks, useCancelAsk, useMinuteNow } from "./ask-data";
import { askButtonText, askName, askStatus } from "./ask-before-use";
import { AskLockIcon, AskWaitBox } from "./ask-ui";
import { shortMoney } from "./from-before";

type PickWrite = ReturnType<typeof pickWrite>;

/** What the sheet is for: a row, its item and its usual. */
export interface UseSheetTarget {
  row: PantryRow;
  item: ReachableItem;
  usual: KitchenUsual | null;
  /** A running-low row's Bought again (cookpool-pantry PN-6): the item it buys like; none otherwise. */
  buyAgain?: KitchenItem | null | undefined;
}

const SHEET_CLASS = cn(
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[28px] border-x-0 bg-card px-5 pt-2.5 shadow-2xl focus:outline-none",
  "min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
);
const SECTION = "text-xs font-extrabold uppercase tracking-[0.06em] text-muted-foreground";
const ACTION =
  "flex min-h-12 items-center justify-center rounded-[14px] border border-[#C9CFC6] bg-card px-2 text-sm font-extrabold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The More… sheet (cookpool-pantry PN-5, design §1.2, the canvas's
 * UseSheet). It replaces the held item's menu (`ItemActionsSheet`) on the
 * new Pantry: the name, its level and note, and Open (the item page); How
 * much — the amount with unit chips (PN-11's `AmountPicker`); Who had it
 * and what each pays; the one main button, Log; then Finish it (logs the
 * rest), Wasted (the item page's confirm) and Cook with it. It shares the
 * set row's amount and people (the device's draft), so either can be used.
 * A running-low row's sheet ends with Bought again (PN-6), like last time.
 */
export function UseSheet({
  target,
  onClose,
  meId,
  onLogged,
  onBoughtAgain,
}: {
  target: UseSheetTarget | null;
  onClose: () => void;
  meId: string | null;
  onLogged: () => void;
  onBoughtAgain?: ((item: KitchenItem) => void) | undefined;
}) {
  // The last item stays on the sheet while it slides away.
  const last = React.useRef<UseSheetTarget | null>(target);
  if (target) last.current = target;
  const shown = target ?? last.current;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        {shown ? (
          <SheetBody key={shown.item.id} target={shown} meId={meId} onClose={onClose} onLogged={onLogged} onBoughtAgain={onBoughtAgain} />
        ) : (
          <SheetTitle className="sr-only">Use</SheetTitle>
        )}
        <div aria-hidden className="h-6 shrink-0" />
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({
  target,
  meId,
  onClose,
  onLogged,
  onBoughtAgain,
}: {
  target: UseSheetTarget;
  meId: string | null;
  onClose: () => void;
  onLogged: () => void;
  onBoughtAgain?: ((item: KitchenItem) => void) | undefined;
}) {
  const { row, item } = target;
  const orgId = item.pantry.kind === "group" ? item.pantry.orgId : null;
  const members = useMembersOf(orgId);
  const names: MemberNames = useMemberNames(members.data);
  const roster = React.useMemo(() => (orgId && members.data ? members.data.map((m) => m.subjectId) : null), [orgId, members.data]);
  const set = useSetState(row, item, roster, meId);
  const logUse = useLogUse();
  const wasteItem = useWasteItem();
  const [wasting, setWasting] = React.useState(false);
  const personal = item.pantry.kind === "personal";
  // Ask before use (cookpool-pantry PN-9): who you must ask first, and your ask while it waits.
  const askToUse = useAskToUse();
  const cancelAsk = useCancelAsk();
  const asks = useAsks();
  const now = useMinuteNow();
  const who = row.ref.kind === "group" ? askName(item, { names }) : null;
  const waiting = askStatus(item.id, asks.data?.mine ?? null, { now, names });
  const { pick, write } = set;
  const consumers = set.consumers;
  const ready = write !== null && (personal || consumers.length > 0);
  const breakdown = !personal && write ? shareBreakdown({ item, qtyMilli: write.qtyMilli, consumers, meId, names }) : null;
  const whoText = personal || !write ? null : whoLine({ ids: faceOrder(consumers, meId, names), meId, names, amounts: breakdown?.lines.map((l) => l.amountMinor) ?? null, currency: item.currency });
  const cost = write ? formatMinor(amountCost(item, write.qtyMilli), item.currency) : null;
  const facts = [pantryLabel(item.pantry), personal ? null : `${memberLabel(item.paidBy, meId, names)} paid ${formatMinor(item.priceMinor, item.currency)}`, expiryText(item)]
    .filter(Boolean)
    .join(" · ");

  const log = (w: PickWrite) => {
    if (who && row.ref.kind === "group" && consumers.length > 0) {
      void askToUse({
        ref: row.ref,
        item,
        ...w,
        consumers,
        idempotencyKey: crypto.randomUUID(),
        meId,
        names,
        who,
      });
      set.clear();
      onClose();
      return;
    }
    if (personal || consumers.length > 0) {
      void logUse({
        ref: row.ref,
        item,
        ...w,
        consumers,
        idempotencyKey: crypto.randomUUID(),
        meId,
        names,
      });
      set.clear();
      onClose();
      onLogged();
    }
  };
  // Finish it: all that is left, in the item's base unit.
  const theRest: PickWrite = { qtyMilli: item.qtyLeftMilli, what: qtyText(item.qtyLeftMilli, item.dimension), measure: null };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div className="flex items-start gap-3 pr-12">
        <div className="min-w-0 flex-1 space-y-1.5">
          <SheetTitle className="truncate text-2xl font-extrabold tracking-[-0.01em]">{item.name}</SheetTitle>
          <span className="flex items-center gap-2">
            <LevelBar percent={row.percent} tone={row.level} className="w-20" />
            <span className="text-[13px] font-bold text-foreground/80">{leftOfBought(item)} left</span>
          </span>
          <p className="text-[13px] font-semibold text-muted-foreground">{facts}</p>
          {row.note ? <NoteLine note={row.note} className="mt-0 font-bold text-foreground/80" /> : null}
        </div>
        <Link href={row.href} onClick={onClose} className="flex min-h-11 shrink-0 items-center rounded-xl border border-[#D5DAD2] px-3 text-sm font-extrabold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Open
        </Link>
      </div>

      {waiting?.phase === "waiting" ? (
        <AskWaitBox status={waiting} onCancel={() => void cancelAsk(waiting.ask)} />
      ) : wasting ? (
        <WasteConfirm
          className="border-0 bg-background p-4"
          item={item}
          roster={personal ? null : roster}
          meId={meId}
          names={names}
          onKeep={() => setWasting(false)}
          onWaste={() => {
            onClose();
            void wasteItem({ ref: row.ref, item, meId, idempotencyKey: crypto.randomUUID() });
          }}
        />
      ) : (
        <>
          <section aria-label="How much" className="space-y-2">
            <h3 className={SECTION}>How much</h3>
            {pick ? <AmountPicker item={item} name={item.name} pick={pick} start={set.start} why={set.why} onPick={set.setPick} /> : null}
          </section>

          {personal ? null : (
            <section aria-label="Who had it" className="space-y-2">
              <FaceRow
                legend="Who had it"
                people={roster}
                chosen={new Set(consumers)}
                onToggle={(id) => set.people([...toggleFace(new Set(consumers), id)])}
                meId={meId}
                names={names}
                className="[&>legend]:text-xs [&>legend]:font-extrabold [&>legend]:uppercase [&>legend]:tracking-[0.06em] [&>legend]:text-muted-foreground"
              />
            </section>
          )}

          {who ? (
            <>
              <Button type="button" className={cn(MAIN_BUTTON, "bg-[#17201B] hover:bg-[#17201B]/90")} disabled={!ready} onClick={() => write && log(write)}>
                <MainButtonLabel title={!ready ? "Pick who had it" : `${askButtonText(who)} · ${write!.what}`} who={ready ? whoText : null} />
              </Button>
              {/* Wasted and Cook with it are the buyer's to do while you must ask (the server refuses them: ask_first). */}
              <div className="grid grid-cols-[auto_1fr] items-center gap-3">
                <button type="button" className={cn(ACTION, "px-3.5")} disabled={consumers.length === 0} onClick={() => log(theRest)}>
                  Ask for the rest
                </button>
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#8A5A00]">
                  <AskLockIcon className="h-4 w-4" />
                  Nothing comes off until {who} says yes
                </p>
              </div>
            </>
          ) : (
            <>
              <Button type="button" className={MAIN_BUTTON} disabled={!ready} onClick={() => write && log(write)}>
                <MainButtonLabel title={!ready ? "Pick who had it" : `Log ${write!.what}${personal && cost ? ` · ${cost}` : ""}`} who={ready ? whoText : null} />
              </Button>

              <div className="grid grid-cols-3 gap-2">
                <button type="button" className={ACTION} disabled={!(personal || consumers.length > 0)} onClick={() => log(theRest)}>
                  Finish it
                </button>
                <button type="button" className={ACTION} onClick={() => setWasting(true)}>
                  Wasted
                </button>
                <Link href={cookHref(row.ref)} onClick={onClose} className={ACTION}>
                  Cook with it
                </Link>
              </div>
            </>
          )}
          {target.buyAgain && onBoughtAgain ? (
            <button
              type="button"
              className={ACTION}
              onClick={() => {
                const like = target.buyAgain!;
                onClose();
                onBoughtAgain(like);
              }}
            >
              Bought again · {shortMoney(target.buyAgain.priceMinor, target.buyAgain.currency)}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

