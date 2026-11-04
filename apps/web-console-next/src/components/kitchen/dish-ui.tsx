"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, CookingPot, Minus, Plus } from "lucide-react";
import type { KitchenDish } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IconBubble, KCard, K_BUTTON } from "./kit";
import { Money, PersonAvatar } from "./ledger-ui";
import type { MemberNames } from "./members";
import { useClaimer, useGroupDishes } from "./dish-data";
import {
  CLAIM_CHOICES,
  claimChoiceLabel,
  claimText,
  claimableHalf,
  dishRow,
  halfText,
  ingredientLines,
  ingredientsSummary,
  perPortionText,
  portionsText,
  type DishChip,
  type DishPeople,
  type FlowLine,
  type MoneyFlow,
  type WhoRow,
} from "./dish";

/**
 * The dish screens' pieces (Cookpool CP-17): the state chip, the ½-portion
 * stepper, the claim buttons a member taps ("How much did you have?" — also
 * for Home's inbox, CP-23), the cost card, who had some, how the dish moves
 * money, and a group's Dishes tab. Colors come from the `.cookpool` tokens;
 * every amount says which way it goes in words, not by color alone.
 */

const CHIP_TONES: Record<DishChip["tone"], string> = {
  open: "bg-cp-tomato-tint text-cp-tomato",
  ready: "bg-cp-herb-tint text-primary",
  done: "bg-muted text-muted-foreground",
  muted: "bg-muted text-muted-foreground",
};

export function DishChipPill({ chip, className }: { chip: DishChip; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold", CHIP_TONES[chip.tone], className)}>
      {chip.label}
    </span>
  );
}

// ── Steppers ───────────────────────────────────────────────────────

/**
 * − ½ + : half a portion at a time, 44px tall targets. It reports steps, not
 * values, so two quick taps count twice (the owner adds them to its latest
 * value, not to what this render showed).
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
    "grid h-11 w-9 shrink-0 place-items-center rounded-[10px] border border-input bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div role="group" aria-label={`Portions for ${who}`} className="flex shrink-0 items-center gap-1">
      <button type="button" className={btn} aria-label={`Half a portion less for ${who}`} disabled={disabled || value <= 0} onClick={() => onStep(-1)}>
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <span className="min-w-[34px] text-center text-[15px] font-extrabold tabular-nums" aria-live="polite">
        {halfText(value)}
      </span>
      <button type="button" className={btn} aria-label={`Half a portion more for ${who}`} disabled={disabled || value >= max} onClick={() => onStep(1)}>
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * "How much did you have?" — None · ½ · 1 · 1½ · 2, one tap to claim (and
 * Undo on the toast). Once claimed it says what it costs ("You had 1 ·
 * you'll owe Meera ₹31.20") with Change. Choices beyond what is left are off.
 * Render it for an open dish shared with a group, for someone who may claim
 * (not a viewer); Home's inbox (CP-23) reuses it.
 */
export function DishClaimStepper(props: { dish: KitchenDish; meId: string; names: MemberNames; className?: string }) {
  const claimer = useClaimer(props.dish, props.meId, props.names);
  return <DishClaimChoices {...props} claimer={claimer} />;
}

export type Claimer = ReturnType<typeof useClaimer>;

/** The claim buttons over a claimer the screen already holds (the dish page shares it with your row's stepper). */
export function DishClaimChoices({
  dish,
  meId,
  names,
  claimer,
  className,
}: {
  dish: KitchenDish;
  meId: string;
  names: MemberNames;
  claimer: Claimer;
  className?: string;
}) {
  const [changing, setChanging] = React.useState(false);
  const [skipped, setSkipped] = React.useState(false);
  const headingId = React.useId();
  const half = claimer.half;
  const max = claimableHalf(dish);
  const choosing = changing || (half === 0 && !skipped);

  return (
    <div className={cn("space-y-2", className)}>
      {choosing ? (
        <>
          <p id={headingId} className="text-sm font-bold">
            How much did you have?
          </p>
          <div role="group" aria-labelledby={headingId} className="grid grid-cols-5 gap-1.5">
            {CLAIM_CHOICES.map((h) => {
              const selected = h === half && (h > 0 || skipped);
              return (
                <button
                  key={h}
                  type="button"
                  aria-pressed={selected}
                  aria-label={h === 0 ? "None" : portionsText(h)}
                  disabled={h > max}
                  onClick={() => {
                    setChanging(false);
                    setSkipped(h === 0);
                    claimer.set(h, { now: true });
                  }}
                  className={cn(
                    "min-h-11 rounded-xl border text-[15px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
                    selected ? "border-primary bg-accent text-primary" : "border-input bg-card text-foreground hover:bg-accent/60",
                  )}
                >
                  {claimChoiceLabel(h)}
                </button>
              );
            })}
          </div>
          {max < CLAIM_CHOICES[CLAIM_CHOICES.length - 1]! ? (
            <p className="text-xs text-muted-foreground">
              {max === 0 ? "Every portion is claimed." : `You can claim up to ${portionsText(max)}: the rest is taken.`}
            </p>
          ) : null}
        </>
      ) : (
        <div role="status" className="flex items-center gap-2.5 rounded-xl bg-cp-herb-tint px-3 py-1 text-sm font-bold text-primary">
          <span className="min-w-0 flex-1 py-1.5">{half === 0 ? "You skipped this one." : claimText({ dish, meId, names, half })}</span>
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="min-h-11 shrink-0 rounded-lg px-2 font-extrabold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Change
          </button>
        </div>
      )}
    </div>
  );
}

// ── The cost card ──────────────────────────────────────────────────

export function DishCostCard({ dish, chip, people }: { dish: KitchenDish; chip: DishChip; people: DishPeople }) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const lines = ingredientLines(dish, people);
  return (
    <section aria-label="Cost" className="space-y-3.5 rounded-[22px] border bg-card p-5">
      <DishChipPill chip={chip} />
      <dl className="grid grid-cols-3 gap-2.5">
        <Fact term="Total">
          <Money minor={dish.totalMinor} currency={dish.currency} />
        </Fact>
        <Fact term="Portions">{halfText(dish.portionsHalf)}</Fact>
        <Fact term="Each" className="text-primary">
          {perPortionText(dish)}
        </Fact>
      </dl>
      <div className="border-t pt-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg text-left text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>{ingredientsSummary(dish)}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {open ? (
          <ul id={listId} className="mt-1 space-y-1.5 text-sm">
            {lines.map((l) => (
              <li key={l.key} className="flex justify-between gap-3">
                <span className="min-w-0">
                  {l.name} {l.qty} <span className="text-muted-foreground">· {l.where}</span>
                </span>
                <Money minor={l.amountMinor} currency={dish.currency} className="shrink-0" />
              </li>
            ))}
            {dish.extrasMinor > 0 ? (
              <li className="flex justify-between gap-3">
                <span className="min-w-0">
                  Extras <span className="text-muted-foreground">· gas, spices, paid by {people.meId === dish.cook ? "you" : "the cook"}</span>
                </span>
                <Money minor={dish.extrasMinor} currency={dish.currency} className="shrink-0" />
              </li>
            ) : null}
            <li className="flex justify-between gap-3 border-t pt-1.5 font-bold">
              <span>
                Total · {portionsText(dish.portionsHalf)}
              </span>
              <Money minor={dish.totalMinor} currency={dish.currency} className="shrink-0" />
            </li>
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Fact({ term, children, className }: { term: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{term}</dt>
      <dd className={cn("truncate text-xl font-extrabold tabular-nums", className)}>{children}</dd>
    </div>
  );
}

// ── Who had some ───────────────────────────────────────────────────

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
  return (
    <ul className="divide-y rounded-[18px] border bg-card">
      {rows.map((r) => {
        const stepper = stepperFor(r);
        return (
          <li key={r.subjectId} className="flex min-h-[68px] items-center gap-3 py-2.5 pl-3.5 pr-3">
            <PersonAvatar subjectId={r.subjectId} meId={meId} names={names} className="h-[38px] w-[38px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">
                {r.label}
                {r.isCook ? <span className="font-medium text-muted-foreground"> · cook</span> : null}
              </p>
              <p className="text-[13px] text-muted-foreground">{r.note}</p>
            </div>
            {stepper ?? (
              <span className="min-w-[34px] shrink-0 text-center text-[15px] font-extrabold tabular-nums">
                {r.exactMinor !== null ? "—" : halfText(r.half)}
                <span className="sr-only"> {r.exactMinor !== null ? "a fixed amount" : r.half > 0 && r.half <= 2 ? "portion" : "portions"}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── How this moves money ───────────────────────────────────────────

const FLOW_TONES: Record<FlowLine["tone"], string> = {
  owed: "text-cp-owed",
  owe: "text-cp-owe",
  neutral: "text-foreground",
};

function FlowRows({ lines, currency }: { lines: readonly FlowLine[]; currency: string }) {
  return (
    <ul className="space-y-1.5">
      {lines.map((l) => (
        <li key={l.key} className="flex justify-between gap-3 text-sm">
          <span className="min-w-0">{l.text}</span>
          <Money minor={l.amountMinor} currency={currency} className={cn("shrink-0 font-bold", FLOW_TONES[l.tone])} />
        </li>
      ))}
    </ul>
  );
}

export function MoneyFlowCard({ flow, currency, previewLabel }: { flow: MoneyFlow; currency: string; previewLabel: string | null }) {
  return (
    <section aria-labelledby="flow-h" className="space-y-3 rounded-[22px] border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="flow-h" className="text-base font-extrabold">
          How this moves money
        </h2>
        {previewLabel ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {previewLabel}
          </span>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <h3 className="text-[13px] font-bold text-cp-owed">{flow.eatenTitle}</h3>
        {flow.eaten.length > 0 ? <FlowRows lines={flow.eaten} currency={currency} /> : <p className="text-sm text-muted-foreground">{flow.eatenEmpty}</p>}
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-1.5">
        <h3 className="text-[13px] font-bold text-cp-owe">{flow.tookTitle}</h3>
        {flow.took.length > 0 ? <FlowRows lines={flow.took} currency={currency} /> : <p className="text-sm text-muted-foreground">{flow.tookEmpty}</p>}
      </div>
      {flow.netted.length > 0 ? (
        <div className="space-y-1.5 rounded-[14px] bg-cp-herb-tint/60 px-3.5 py-3">
          <h3 className="text-[13px] font-extrabold text-primary">After netting inside each group</h3>
          <FlowRows lines={flow.netted} currency={currency} />
          <p className="text-xs text-muted-foreground">
            Settle up folds these into everything else in the group and shows the fewest payments.
          </p>
        </div>
      ) : null}
    </section>
  );
}

// ── A group's Dishes tab ───────────────────────────────────────────

const ROW_CHIP: Record<DishChip["tone"], string> = CHIP_TONES;

/** The dishes shared with a group, newest first, each opening its page. */
export function GroupDishesPanel({
  orgId,
  groupName,
  meId,
  names,
}: {
  orgId: string;
  groupName: string;
  meId: string | null;
  names: MemberNames;
}) {
  const dishes = useGroupDishes(orgId);
  const now = React.useMemo(() => new Date(), []);
  if (dishes.isLoading) {
    return (
      <div className="space-y-2.5" aria-hidden>
        <Skeleton className="h-[72px] w-full rounded-[18px]" />
        <Skeleton className="h-[72px] w-full rounded-[18px]" />
      </div>
    );
  }
  if (dishes.error || !dishes.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the dishes. {dishes.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={() => void dishes.refetch()}>
          Try again
        </Button>
      </KCard>
    );
  }
  const list = dishes.data.pages.flatMap((p) => p.dishes);
  if (list.length === 0) {
    return (
      <KCard className="flex gap-4 p-5">
        <IconBubble icon={CookingPot} tone="tomato" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold tracking-tight">No dishes shared yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            When someone cooks and shares a dish with {groupName}, it shows here: who had how much, and what each of you owes for it.
          </p>
        </div>
      </KCard>
    );
  }
  return (
    <div className="space-y-2.5">
      <ul className="space-y-2.5">
        {list.map((d) => {
          const row = dishRow(d, { meId, names, now });
          return (
            <li key={row.id}>
              <Link
                href={row.href}
                className="flex min-h-[72px] items-center gap-3 rounded-[18px] border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[15px] font-bold", d.state === "canceled" && "text-muted-foreground line-through")}>
                    {row.name}
                  </span>
                  <span className="block text-[13px] text-muted-foreground">{row.sub}</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", ROW_CHIP[row.chip.tone])}>{row.chip.label}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
      {dishes.hasNextPage ? (
        <Button variant="outline" className={cn(K_BUTTON, "w-full")} loading={dishes.isFetchingNextPage} onClick={() => void dishes.fetchNextPage()}>
          Show older dishes
        </Button>
      ) : null}
    </div>
  );
}
