"use client";

import * as React from "react";
import Link from "./link";
import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import type { KitchenDish } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON, K_BUTTON_QUIET, K_CARD, K_ROWS } from "./kit";
import { Money } from "./ledger-ui";
import { Face } from "./faces-ui";
import { RepeatButton } from "./row-gestures-ui";
import type { MemberNames } from "./members";
import { useGroupDishes } from "./dish-data";
import {
  dishRow,
  dishSubtitle,
  halfText,
  ingredientLines,
  ingredientsSummary,
  perPortionText,
  portionsText,
  type DishChip,
  type DishPeople,
  type FlowLine,
  type MoneyFlow,
  type MoneySummaryLine,
  type WhoRow,
} from "./dish";

/**
 * The dish screens' pieces (Cookpool CP-17; SM-10 as the canvas's "Simpler —
 * Dish" draws them): the one status word, the ½-portion stepper, who had
 * some, the dish's money in two lines with Details, and a group's dishes.
 * Colors come from the `.cookpool` tokens; every amount says which way it
 * goes in words, not by color alone.
 */

const CHIP_TONES: Record<DishChip["tone"], string> = {
  open: "bg-cp-tomato-tint text-cp-tomato",
  ready: "bg-cp-herb-tint text-primary",
  done: "bg-muted text-muted-foreground",
  muted: "bg-muted text-muted-foreground",
};

export function DishChipPill({ chip, className }: { chip: DishChip; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium", CHIP_TONES[chip.tone], className)}>
      {chip.label}
    </span>
  );
}

// ── Steppers ───────────────────────────────────────────────────────

/**
 * − ½ + : half a portion at a time, 44px tall targets. It reports steps, not
 * values, so two quick taps count twice (the owner adds them to its latest
 * value, not to what this render showed). Held, a button repeats (PW-8),
 * each step the same as a tap, so a claim's burst stays one toast.
 */
export function PortionStepper({
  value,
  onStep,
  who,
  max,
  disabled,
}: {
  value: number;
  onStep: (delta: 1 | -1) => void;
  /** Who it is for, in the buttons' names: "Anu", "you". */
  who: string;
  max: number;
  disabled?: boolean;
}) {
  const btn =
    "grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div role="group" aria-label={`Portions for ${who}`} className="flex shrink-0 items-center gap-1">
      <RepeatButton className={cn(btn, "bg-muted text-foreground hover:bg-accent")} aria-label={`Half a portion less for ${who}`} disabled={disabled || value <= 0} onStep={() => onStep(-1)}>
        <Minus className="h-4 w-4" aria-hidden />
      </RepeatButton>
      <span className="min-w-[32px] text-center text-[17px] font-medium tabular-nums" aria-live="polite">
        {halfText(value)}
      </span>
      <RepeatButton className={cn(btn, "bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80")} aria-label={`Half a portion more for ${who}`} disabled={disabled || value >= max} onStep={() => onStep(1)}>
        <Plus className="h-4 w-4" aria-hidden />
      </RepeatButton>
    </div>
  );
}

// ── Who had some ───────────────────────────────────────────────────

/** "Who had some?" — a card with one row per person (the canvas): face, name, "by Anu · ₹62.40", and the stepper. */
export function WhoHadSomeList({
  rows,
  meId,
  names,
  stepperFor,
}: {
  rows: readonly WhoRow[];
  meId: string | null;
  names: MemberNames;
  /** The stepper for a row, or null when it is read-only. */
  stepperFor: (row: WhoRow) => React.ReactNode;
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-[22px] bg-card shadow-cp-card">
      <h2 id={headingId} className="px-4 pb-1.5 pt-3 text-base font-medium">
        Who had some?
      </h2>
    <ul className="divide-y border-t">
      {rows.map((r) => {
        const stepper = stepperFor(r);
        return (
          <li key={r.subjectId} className="flex min-h-16 items-center gap-3 py-2.5 pl-4 pr-3">
            <Face subjectId={r.subjectId} meId={meId} names={names} className="h-11 w-11" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium">
                {r.label}
                {r.isCook ? <span className="font-medium text-muted-foreground"> · cook</span> : null}
              </p>
              {r.by || r.note ? (
                <p className="truncate text-[13px] text-muted-foreground">
                  {r.by ? <span className="font-medium text-cp-purple">{r.by}</span> : null}
                  {r.by && r.note ? " · " : null}
                  {r.note}
                </p>
              ) : null}
            </div>
            {stepper ?? (
              <span className="min-w-[34px] shrink-0 text-center text-[15px] font-medium tabular-nums">
                {r.exactMinor !== null ? "—" : halfText(r.half)}
                <span className="sr-only"> {r.exactMinor !== null ? "a fixed amount" : r.half > 0 && r.half <= 2 ? "portion" : "portions"}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
    </section>
  );
}

// ── How the dish moves money: two lines, and Details ──────────────

const FLOW_TONES: Record<FlowLine["tone"], string> = {
  owed: "text-cp-owed",
  owe: "text-cp-owe",
  neutral: "text-foreground",
};

function FlowRows({ lines, currency }: { lines: readonly FlowLine[]; currency: string }) {
  return (
    <ul className="space-y-1">
      {lines.map((l) => (
        <li key={l.key} className="flex justify-between gap-3 text-sm">
          <span className="min-w-0">{l.text}</span>
          <Money minor={l.amountMinor} currency={currency} className={cn("shrink-0 font-medium", FLOW_TONES[l.tone])} />
        </li>
      ))}
    </ul>
  );
}

function FlowPart({ title, lines, empty, currency }: { title: string; lines: readonly FlowLine[]; empty: string | null; currency: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-[13px] font-medium text-muted-foreground">{title}</h3>
      {lines.length > 0 ? <FlowRows lines={lines} currency={currency} /> : <p className="text-sm text-muted-foreground">{empty}</p>}
    </div>
  );
}

/** The money in at most two lines (`dishMoneySummary`): in the card, or with the cook's Finalize (SM-15). */
export function MoneyLines({ summary, className }: { summary: readonly MoneySummaryLine[]; className?: string }) {
  return (
    <div className={cn("space-y-0.5", className)}>
      {summary.map((l) => (
        <p key={l.key} className={cn("text-[15px] font-medium leading-snug tabular-nums", FLOW_TONES[l.tone])}>
          {l.text}
        </p>
      ))}
    </div>
  );
}

/**
 * A dish's money (SM-10): at most two short lines — "Anu and Dev owe Meera
 * ₹93.60 · in Flat 4B", "Meera owes Anu ₹40.00 for ingredients" — and the
 * rest behind "Details": when and where it was cooked, every ingredient with
 * its pantry and price, what each person owes, what the cook owes each
 * buyer, and where each person ends up with the cook.
 */
export function DishMoney({
  dish,
  summary,
  flow,
  people,
  now,
}: {
  dish: KitchenDish;
  summary: readonly MoneySummaryLine[];
  flow: MoneyFlow;
  people: DishPeople;
  now: Date;
}) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const lines = ingredientLines(dish, people);
  return (
    <section aria-label="Money" className="overflow-hidden rounded-[22px] bg-card shadow-cp-card">
      {summary.length > 0 ? <MoneyLines summary={summary} className="px-4 pb-2.5 pt-3" /> : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex min-h-11 w-full items-center justify-between gap-2 px-4", summary.length > 0 && "border-t", "text-left text-sm font-medium text-cp-accent-text hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
      >
        Details
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={panelId} hidden={!open} className="space-y-3 border-t px-4 pb-4 pt-3">
        {open ? (
          <>
            <p className="text-[13px] text-muted-foreground">{dishSubtitle(dish, { ...people, now })}</p>
            <div className="space-y-1">
              <h3 className="text-[13px] font-medium text-muted-foreground">{ingredientsSummary(dish)}</h3>
              <ul className="space-y-1 text-sm">
                {lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {l.name} <span className="whitespace-nowrap">{l.qty}</span> <span className="text-muted-foreground">· {l.where}</span>
                    </span>
                    <Money minor={l.amountMinor} currency={dish.currency} className="shrink-0" />
                  </li>
                ))}
                {dish.extrasMinor > 0 ? (
                  <li className="flex justify-between gap-3">
                    <span className="min-w-0">Extras</span>
                    <Money minor={dish.extrasMinor} currency={dish.currency} className="shrink-0" />
                  </li>
                ) : null}
                <li className="flex justify-between gap-3 border-t pt-1 font-medium">
                  <span>
                    Total · {portionsText(dish.portionsHalf)} · {perPortionText(dish)} each
                  </span>
                  <Money minor={dish.totalMinor} currency={dish.currency} className="shrink-0" />
                </li>
              </ul>
            </div>
            {dish.state === "canceled" ? null : (
              <>
                <FlowPart title={flow.eatenTitle} lines={flow.eaten} empty={flow.eatenEmpty} currency={dish.currency} />
                <FlowPart title={flow.tookTitle} lines={flow.took} empty={flow.tookEmpty} currency={dish.currency} />
                {flow.netted.length > 0 ? <FlowPart title="In the end" lines={flow.netted} empty={null} currency={dish.currency} /> : null}
              </>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

// ── A group's Dishes tab ───────────────────────────────────────────

/**
 * The dishes shared with a group, newest first, each one row opening its
 * page: the name, "Meera · 1 of 5 had · ₹156.00" and its status word (SM-11:
 * not "Finalize" / "Claim" / "Split", which looked like buttons). The group
 * page shows `limit` of them and "See all" for the rest.
 */
export function GroupDishesPanel({
  orgId,
  meId,
  names,
  limit,
  heading,
}: {
  orgId: string;
  meId: string | null;
  names: MemberNames;
  limit?: number;
  /**
   * The new frame's group page (RvGroup, RV-23): the panel draws its own 17 px
   * heading with See all beside it, and each row leads with the cook's face.
   */
  heading?: { id: string; title: string };
}) {
  const dishes = useGroupDishes(orgId);
  const [all, setAll] = React.useState(false);
  const now = React.useMemo(() => new Date(), []);
  const list = dishes.data?.pages.flatMap((p) => p.dishes) ?? [];
  const more = !!limit && list.length > limit;
  const body = (() => {
    if (dishes.isLoading) {
      return <Skeleton className="h-14 w-full rounded-[22px]" aria-hidden />;
    }
    if (dishes.error || !dishes.data) {
      return (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the dishes.</p>
          <Button variant="ghost" className={K_BUTTON_QUIET} onClick={() => void dishes.refetch()}>
            Try again
          </Button>
        </KCard>
      );
    }
    if (list.length === 0) {
      return <p className={cn(K_CARD, "flex min-h-14 items-center px-4 text-sm font-normal text-muted-foreground")}>No dishes yet</p>;
    }
    const shown = limit && !all ? list.slice(0, limit) : list;
    return (
      <div className="space-y-2">
        <ul className={K_ROWS}>
          {shown.map((d) => {
            const row = dishRow(d, { meId, names, now });
            return (
              <li key={row.id}>
                <Link
                  href={row.href}
                  className="flex min-h-14 items-center gap-3 px-3.5 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {heading ? <Face subjectId={d.cook} meId={meId} names={names} className="h-9 w-9 text-[13px] font-medium" /> : null}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[15px] font-medium", d.state === "canceled" && "text-muted-foreground line-through")}>
                      {row.name}
                    </span>
                    <span className="block truncate text-[13px] font-normal text-muted-foreground">{row.sub}</span>
                  </span>
                  <DishChipPill chip={row.chip} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
        {more && !all && !heading ? (
          <Button variant="ghost" className={cn(K_BUTTON, "w-full text-cp-accent-text")} onClick={() => setAll(true)}>
            See all {list.length}
          </Button>
        ) : dishes.hasNextPage && (all || !limit) ? (
          <Button variant="ghost" className={cn(K_BUTTON_QUIET, "w-full")} loading={dishes.isFetchingNextPage} onClick={() => void dishes.fetchNextPage()}>
            Show older dishes
          </Button>
        ) : null}
      </div>
    );
  })();
  if (!heading) return body;
  return (
    <section aria-labelledby={heading.id} className="space-y-2.5">
      <div className="flex min-h-11 items-center justify-between">
        <h2 id={heading.id} className="text-[17px] font-medium leading-snug">
          {heading.title}
        </h2>
        {more ? (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll(!all)}
            className="flex min-h-11 items-center rounded-md text-sm font-medium text-cp-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {all ? "Show less" : "See all"}
          </button>
        ) : null}
      </div>
      {body}
    </section>
  );
}
