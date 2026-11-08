"use client";

import * as React from "react";
import Link from "./link";
import { CornerDownRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { LearnedBadge } from "./guided-views";
import { planNote, planTotals, type Plan, type PlanRow, type PlanSize } from "./guided-steps";

/**
 * The plan as it draws (cookpool-guided GC-6, design §3.5, the canvas's
 * `GuideTimeline`): the recipe's name, The plan, the size switch, the three
 * totals, one row per step — its number (tinted when hands off), its words,
 * its range at this size, the learned badge, its rule in words and a bar,
 * and the Meanwhile line under a hands-off step — then Start step by step.
 * No reads or writes here (the Back control is handed in: it needs the
 * router), so it is rendered in tests.
 */
export function PlanView({
  back,
  name,
  plan,
  sizes,
  onSize,
  startHref,
}: {
  back?: React.ReactNode;
  name: string;
  plan: Plan;
  sizes: readonly PlanSize[];
  onSize: (factorMilli: number) => void;
  startHref: string;
}) {
  const timed = plan.rows.some((r) => r.time !== null);
  return (
    <div className="flex w-full max-w-xl flex-col gap-3.5 pb-2">
      <div className="flex items-center gap-1">
        {back}
        <span className="min-w-0 flex-1 truncate text-[13px] font-extrabold uppercase tracking-[0.04em] text-[#5A635D]">{name}</span>
      </div>
      <h1 className="-mt-1 text-[26px] font-extrabold leading-tight tracking-[-0.02em]">The plan</h1>

      {sizes.length > 1 ? (
        <div role="group" aria-label="Size" className="grid grid-cols-2 rounded-[14px] bg-[#ECEEE9] p-[3px]">
          {sizes.map((s) => {
            const on = s.factorMilli === plan.factorMilli;
            return (
              <button
                key={s.factorMilli}
                type="button"
                aria-pressed={on}
                onClick={() => onSize(s.factorMilli)}
                className={cn(
                  "min-h-10 truncate rounded-[11px] px-2 text-sm font-extrabold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-[#5A635D] hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      ) : sizes[0] ? (
        <span className="inline-flex min-h-8 items-center self-start rounded-full bg-[#ECEEE9] px-3 text-[13px] font-extrabold tabular-nums text-[#3F4842]">{sizes[0].label}</span>
      ) : null}

      <dl className="grid grid-cols-3 gap-2">
        {planTotals(plan.totals).map((t) => (
          <div key={t.label} className="flex flex-col rounded-2xl border border-[#E3E6E0] bg-card px-3 py-2.5">
            <dd className="order-1 text-xl font-extrabold tabular-nums leading-tight">{t.value}</dd>
            <dt className="order-2 text-xs font-bold text-[#5A635D]">{t.label}</dt>
          </div>
        ))}
      </dl>
      {planNote(plan) ? <p className="-mt-1 px-0.5 text-[13px] font-semibold text-[#5A635D]">{planNote(plan)}</p> : null}

      <ol className="overflow-hidden rounded-[22px] border border-[#E3E6E0] bg-card">
        {plan.rows.map((row, i) => (
          <PlanRowItem key={row.position} row={row} last={i === plan.rows.length - 1} />
        ))}
      </ol>

      <p className="px-0.5 text-[13px] font-semibold leading-relaxed text-[#5A635D]">
        {timed
          ? "Each step's real time is kept with the size you cooked. After 5 cooks a range shows here and on the step. It never changes the recipe's words."
          : "No step has a time yet. Its owner can add one in Edit."}
      </p>

      <div
        data-toast-above=""
        className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-30 -mx-4 bg-background px-4 pb-2 pt-3 min-[900px]:bottom-6 min-[900px]:mx-0 min-[900px]:bg-transparent min-[900px]:px-0"
      >
        <Link
          href={startHref}
          className="flex min-h-[60px] w-full items-center justify-center rounded-[18px] bg-[#B4471F] px-4 text-[17px] font-extrabold text-white shadow-[0_8px_24px_rgba(23,32,27,0.18)] transition-colors hover:bg-[#9C3D1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Start step by step
        </Link>
      </div>
    </div>
  );
}

/** One step of the plan. */
function PlanRowItem({ row, last }: { row: PlanRow; last: boolean }) {
  return (
    <li className={cn("px-3.5 py-3", !last && "border-b border-[#ECEEE9]", row.handsOff && "bg-[#F4FAF6]")}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-extrabold",
            row.handsOff ? "bg-cp-herb-tint text-[#165C3A]" : "bg-foreground text-background",
          )}
        >
          {row.number}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] font-extrabold leading-snug">
            <span className="sr-only">Step {row.number}: </span>
            {row.text}
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {row.time ? (
              <span className="text-[13px] font-extrabold tabular-nums">
                {row.time}
                {row.handsOff ? " · hands off" : ""}
              </span>
            ) : row.handsOff ? (
              <span className="text-[13px] font-extrabold">Hands off</span>
            ) : null}
            {row.learned ? <LearnedBadge text={row.learned} /> : null}
            {row.rule ? <span className="text-xs font-bold text-[#5A635D]">{row.rule}</span> : null}
            {row.longPrep ? <span className="text-xs font-bold text-[#8A5A00]">Long prep · do it first</span> : row.phase === "prep" ? <span className="text-xs font-bold text-[#5A635D]">Prep</span> : null}
          </span>
          <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-[#ECEEE9]">
            {row.bar > 0 ? <span className={cn("block h-full rounded-full", row.handsOff ? "bg-[#B9DCC8]" : "bg-primary")} style={{ width: `${row.bar}%` }} /> : null}
          </span>
        </span>
      </div>
      {row.meanwhile ? (
        <p className="ml-10 mt-2 flex items-start gap-1.5 text-[13px] font-bold text-[#165C3A]">
          <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
          {row.meanwhile}
        </p>
      ) : null}
    </li>
  );
}

export function PlanSkeleton() {
  return (
    <div className="flex max-w-xl flex-col gap-3.5" aria-hidden>
      <Skeleton className="h-11 w-40 rounded-xl" />
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-11 w-full rounded-[14px]" />
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
      </div>
      <Skeleton className="h-96 w-full rounded-[22px]" />
    </div>
  );
}
