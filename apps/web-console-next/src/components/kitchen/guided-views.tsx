"use client";

import * as React from "react";
import { Clock, Ear, Eye, Flame, Hand, Timer, Utensils, Wind, type LucideIcon } from "lucide-react";
import type { StepHeat, StepSense } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import type { StepRow } from "./guided-steps";
import type { LongPrepRow } from "./long-prep";

/**
 * Guided steps as they draw on the recipe page (cookpool-guided GC-6): a
 * step's flame, its range at the page's size, what to watch for, a hands-off
 * tag and the learned badge (GC-7); and the amber Long prep card. No reads
 * or writes here, so each is rendered in tests.
 */

/** The flame as one to three flames, lit to its heat (none lit, for off): the canvas's `GuideStep`. */
export function Flames({ heat, className }: { heat: StepHeat; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-end gap-px", className)}>
      {[1, 2, 3].map((k) => (
        <Flame
          key={k}
          className={cn(k === 1 ? "h-3.5 w-3.5" : k === 2 ? "h-4 w-4" : "h-[18px] w-[18px]", heat >= k ? "fill-[#B4471F] text-[#B4471F]" : "text-[#C9CFC6]")}
          strokeWidth={1.8}
        />
      ))}
    </span>
  );
}

/** The sense a checkpoint is watched with, as an icon. */
export const SENSE_ICONS: Readonly<Record<StepSense, LucideIcon>> = {
  look: Eye,
  smell: Wind,
  sound: Ear,
  feel: Hand,
  taste: Utensils,
};

/** The learned badge (GC-7), in the canvas's blue: "Usually 7–9 min · 23 cooks". */
export function LearnedBadge({ text }: { text: string }) {
  return <span className="inline-flex min-h-6 items-center rounded-full bg-[#E6EEF8] px-2 text-xs font-extrabold text-[#1D4F91]">{text}</span>;
}

/** The hands-off tag. */
export function HandsOffTag() {
  return <span className="inline-flex min-h-6 items-center rounded-full bg-cp-herb-tint px-2 text-xs font-extrabold text-[#165C3A]">Hands off</span>;
}

/**
 * One step in the recipe page's Steps list: its number (tinted when hands
 * off), its words, then its flame, its range at the page's size, Prep and
 * Hands off, what to watch for, the learned badge and the tip — each only
 * when the step says it.
 */
export function GuidedStepItem({ row }: { row: StepRow }) {
  const SenseIcon = row.sense ? SENSE_ICONS[row.sense] : Eye;
  const hasMeta = row.flame || row.time || row.handsOff || row.phase === "prep";
  return (
    <li className="flex gap-3 rounded-2xl border bg-card px-3.5 py-3">
      <span
        aria-hidden
        className={cn(
          "grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-extrabold",
          row.handsOff ? "bg-cp-herb-tint text-[#165C3A]" : "bg-foreground text-background",
        )}
      >
        {row.number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[15px] font-semibold leading-snug">{row.text}</span>
        {hasMeta ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-bold text-[#3F4842]">
            {row.flame && row.heat !== null ? (
              <span className="inline-flex items-center gap-1.5">
                <Flames heat={row.heat} />
                {row.flame}
              </span>
            ) : null}
            {row.time ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
                {row.time}
              </span>
            ) : null}
            {row.phase === "prep" ? <span className="inline-flex min-h-6 items-center rounded-full bg-[#ECEEE9] px-2 text-xs font-extrabold">Prep</span> : null}
            {row.handsOff ? <HandsOffTag /> : null}
          </span>
        ) : null}
        {row.checkpoint ? (
          <span className="inline-flex items-start gap-1.5 text-[13px] font-bold text-[#165C3A]">
            <SenseIcon className="mt-px h-4 w-4 shrink-0" aria-hidden />
            {row.checkpoint}
          </span>
        ) : null}
        {row.learned ? (
          <span>
            <LearnedBadge text={row.learned} />
          </span>
        ) : null}
        {row.tip ? <span className="text-[13px] font-semibold text-muted-foreground">{row.tip}</span> : null}
      </div>
    </li>
  );
}

/**
 * Long prep first (design §1, the canvas's soak card): an amber card, one
 * row per long prep step not done on this device — its words and how long,
 * then **Soak now · ping me** and **Already done**; once started, when we'll
 * ping. Nothing at all when every step is done.
 */
export function LongPrepCardView({
  rows,
  busyKey,
  error,
  endsText,
  onStart,
  onDone,
}: {
  rows: readonly LongPrepRow[];
  /** The step whose timer is being set. */
  busyKey: string | null;
  error: string | null;
  /** "6:30 pm": when a started step's timer ends, in words. */
  endsText: (iso: string) => string;
  onStart: (key: string) => void;
  onDone: (key: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="long-prep-h" className="flex flex-col gap-3 rounded-[22px] border border-[#F0D9A0] bg-[#FDF1D6] px-4 py-3.5">
      <h2 id="long-prep-h" className="text-xs font-extrabold tracking-[0.04em] text-[#6B4600]">
        LONG PREP FIRST
      </h2>
      {rows.map((row) => (
        <div key={row.key} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-white text-[#8A5A00]">
              <Clock className="h-6 w-6" strokeWidth={2} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-extrabold leading-snug text-[#4A3200]">
                {row.text} <span className="whitespace-nowrap tabular-nums">· {row.duration}</span>
              </span>
              <span className="text-[13px] font-semibold text-[#6B4600]">
                {row.status.state === "started" ? `Started · we'll ping you at ${endsText(row.status.endsAt)}` : "Long prep, so it shows before anything else"}
              </span>
            </span>
          </div>
          <div className={cn("grid gap-2", row.status.state === "started" ? "grid-cols-1" : "grid-cols-[1.4fr_1fr]")}>
            {row.status.state === "todo" ? (
              <button
                type="button"
                disabled={busyKey !== null}
                aria-busy={busyKey === row.key || undefined}
                onClick={() => onStart(row.key)}
                className="min-h-12 rounded-[14px] bg-[#8A5A00] px-3 text-[15px] font-extrabold text-white transition-colors hover:bg-[#744C00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {busyKey === row.key ? "Setting it…" : row.startLabel}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onDone(row.key)}
              className="min-h-12 rounded-[14px] border border-[#E2C27A] bg-white px-3 text-[15px] font-extrabold text-[#4A3200] transition-colors hover:bg-[#FFF8E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Already done
            </button>
          </div>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm font-bold text-[#8A2B12]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
