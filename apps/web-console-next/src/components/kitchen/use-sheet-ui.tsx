"use client";

import * as React from "react";
import Link from "./link";
import { Minus, Plus } from "lucide-react";
import type { KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
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
import { RepeatButton } from "./row-gestures-ui";
import { WasteConfirm } from "./item-actions-ui";
import { amountCost, amountStep, amountText, initialAmount, shareBreakdown, stepAmount } from "./item-use";
import { expiryText, leftOfBought, pantryLabel } from "./pantry";
import { formatMinor } from "./money";
import { cookHref } from "./dish-maker";
import { LevelBar } from "./pantry-row-ui";
import { useSetState } from "./set-row-ui";
import { restStep, type LadderStep } from "./pantry-set";
import type { PantryRow } from "./pantry-list";

/** What the sheet is for: a row, its item and its usual. */
export interface UseSheetTarget {
  row: PantryRow;
  item: ReachableItem;
  usual: KitchenUsual | null;
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
 * much — the item's four tiles and Other, a stepper in its unit; Who had it
 * and what each pays; the one main button, Log; then Finish it (logs the
 * rest), Wasted (the item page's confirm) and Cook with it. It shares the
 * set row's amount and people (the device's draft), so either can be used.
 */
export function UseSheet({ target, onClose, meId, onLogged }: { target: UseSheetTarget | null; onClose: () => void; meId: string | null; onLogged: () => void }) {
  // The last item stays on the sheet while it slides away.
  const last = React.useRef<UseSheetTarget | null>(target);
  if (target) last.current = target;
  const shown = target ?? last.current;
  return (
    <Sheet open={target !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        {shown ? <SheetBody key={shown.item.id} target={shown} meId={meId} onClose={onClose} onLogged={onLogged} /> : <SheetTitle className="sr-only">Use</SheetTitle>}
        <div aria-hidden className="h-6 shrink-0" />
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ target, meId, onClose, onLogged }: { target: UseSheetTarget; meId: string | null; onClose: () => void; onLogged: () => void }) {
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
  const tiles = row.ladder.tiles;
  const step = set.step;
  const onTile = step ? tiles.find((t) => t.id === step.key || (!t.rest && t.amount.qtyMilli === step.qtyMilli && !step.rest)) : undefined;
  const [otherOpen, setOtherOpen] = React.useState(() => step !== null && !onTile);
  const consumers = set.consumers;
  const ready = step !== null && (personal || consumers.length > 0);
  const breakdown = !personal && step ? shareBreakdown({ item, qtyMilli: step.qtyMilli, consumers, meId, names }) : null;
  const who = personal || !step ? null : whoLine({ ids: faceOrder(consumers, meId, names), meId, names, amounts: breakdown?.lines.map((l) => l.amountMinor) ?? null, currency: item.currency });
  const cost = step ? formatMinor(amountCost(item, step.qtyMilli), item.currency) : null;
  const facts = [pantryLabel(item.pantry), personal ? null : `${memberLabel(item.paidBy, meId, names)} paid ${formatMinor(item.priceMinor, item.currency)}`, expiryText(item)]
    .filter(Boolean)
    .join(" · ");

  const log = (s: LadderStep) => {
    if (personal || consumers.length > 0) {
      void logUse({
        ref: row.ref,
        item,
        qtyMilli: s.qtyMilli,
        consumers,
        idempotencyKey: crypto.randomUUID(),
        what: s.words,
        measure: s.amount.kind === "measure" ? { measure: s.amount.measure, quantity: s.amount.quantity } : null,
        meId,
        names,
      });
      set.clear();
      onClose();
      onLogged();
    }
  };
  const otherQty = step && !onTile ? step.qtyMilli : initialAmount(item);
  // Other, in the item's unit; all that is left is The rest.
  const pickOther = (qtyMilli: number) =>
    set.pick(qtyMilli >= item.qtyLeftMilli ? restStep(item) : { key: `u:${qtyMilli}`, amount: { kind: "unit", qtyMilli }, qtyMilli, words: amountText(qtyMilli, item), rest: false });

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

      {wasting ? (
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
            <div role="group" aria-label="How much" className="grid grid-cols-4 gap-1.5">
              {tiles.map((t) => {
                const on = !otherOpen && onTile?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setOtherOpen(false);
                      set.pick(t.rest ? restStep(item) : { key: t.id, amount: t.amount, qtyMilli: t.amount.qtyMilli, words: t.amount.kind === "measure" ? t.amount.label : t.words, rest: false });
                    }}
                    className={cn(
                      "flex min-h-[60px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] border px-1 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-[#D5DAD2] bg-card text-foreground hover:bg-accent",
                    )}
                  >
                    <span className="max-w-full truncate text-[15px] font-extrabold leading-tight">{t.label}</span>
                    <span className={cn("max-w-full truncate text-[11px] font-bold", on ? "text-[#D9F0E3]" : "text-muted-foreground")}>
                      {t.usual ? (row.ladder.suggestion?.reason === "usual_now" ? row.ladder.suggestion.why : "Your usual") : t.sub.split(" · ")[0]}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className={cn("rounded-[14px] bg-card px-3", otherOpen ? "border-2 border-primary pb-3" : "border border-[#D5DAD2]")}>
              <button
                type="button"
                aria-expanded={otherOpen}
                onClick={() => {
                  if (!otherOpen) pickOther(otherQty);
                  setOtherOpen((o) => !o);
                }}
                className="flex min-h-11 w-full items-center justify-between text-[15px] font-extrabold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>Other</span>
                {otherOpen ? null : <span className="text-sm font-bold text-muted-foreground">in {amountStep(item).unit}</span>}
              </button>
              {otherOpen && step ? (
                <div className="flex items-center gap-2.5">
                  <RepeatButton aria-label="Less" className={STEPPER} disabled={stepAmount(step.qtyMilli, -1, item) === step.qtyMilli} onStep={() => pickOther(stepAmount(step.qtyMilli, -1, item))}>
                    <Minus className="h-5 w-5" aria-hidden />
                  </RepeatButton>
                  <span role="status" className="min-w-0 flex-1 text-center text-xl font-extrabold tabular-nums">
                    {amountText(step.qtyMilli, item)}
                  </span>
                  <RepeatButton aria-label="More" className={STEPPER} disabled={stepAmount(step.qtyMilli, 1, item) === step.qtyMilli} onStep={() => pickOther(stepAmount(step.qtyMilli, 1, item))}>
                    <Plus className="h-5 w-5" aria-hidden />
                  </RepeatButton>
                </div>
              ) : null}
            </div>
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

          <Button type="button" className={MAIN_BUTTON} disabled={!ready} onClick={() => step && log(step)}>
            <MainButtonLabel title={!ready ? "Pick who had it" : `Log ${step!.words}${personal && cost ? ` · ${cost}` : ""}`} who={ready ? who : null} />
          </Button>

          <div className="grid grid-cols-3 gap-2">
            <button type="button" className={ACTION} disabled={!(personal || consumers.length > 0)} onClick={() => log(restStep(item))}>
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
    </div>
  );
}

const STEPPER =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#C9CFC6] bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
