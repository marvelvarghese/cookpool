"use client";

import * as React from "react";
import Link from "./link";
import { Check, ChevronDown, CookingPot, Hourglass, Lock, Minus, Plus, Timer, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatMinor } from "./money";
import { Face } from "./faces-ui";
import { RepeatButton } from "./row-gestures-ui";
import type { MemberNames } from "./members";
import { UNTICKED_CHOICES, type FinishEaterRow, type SessionBarView, type SessionLineView, type SessionStep, type UntickedChoice } from "./cook-session";

/**
 * The cooking session's pieces (cookpool-recipes RC-6, the canvas's
 * `LiveCook`), as views over `cook-session.ts`: the header (minimize,
 * COOKING, the clock, the name, the scale chip, "3 of 7 in"), one row per
 * line (the 44 px tick, the name, where it comes from and last time, the
 * amount that opens − / + with "≈ 225 g · ₹9"), Add an item, the steps, the
 * Finish sheet's parts, the one-at-a-time prompt and the bar on every tab.
 * No reads or writes here: the screen (`cook-session-screen.tsx`) and the bar
 * (`session-bar.tsx`) hold those.
 */

/** The cook strip (RV-4: the `cp-cook-bg` token, ink in light and the tint in dark). */
const INK = "hsl(var(--cp-cook-bg))";

/** The time now, every `ms` (the header's clock each second, the bar's minutes). */
export function useNow(ms: number): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ── The header ────────────────────────────────────────────────────

export function SessionTopBar({ elapsed, onMinimize }: { elapsed: string; onMinimize: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onMinimize}
        aria-label="Minimize"
        className="-ml-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown className="h-6 w-6" aria-hidden />
      </button>
      <span className="flex-1 text-[13px] font-medium tracking-[0.04em] text-muted-foreground">COOKING</span>
      <span className="flex items-center gap-1.5 text-[15px] font-medium tabular-nums text-muted-foreground">
        <Timer className="h-[18px] w-[18px]" aria-hidden />
        <span className="sr-only">Cooking for </span>
        {elapsed}
      </span>
    </div>
  );
}

/** The chip ("For about 2 · ×0.45", opening the recipe) and "3 of 7 in". */
export function SessionMeta({ chip, progress }: { chip: { label: string; href: string } | null; progress: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      {chip ? (
        <Link
          href={chip.href}
          className="-my-1 inline-flex min-h-11 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="inline-flex min-h-[34px] items-center rounded-full px-3 text-[13px] font-medium text-cp-cook-ink" style={{ backgroundColor: INK }}>
            {chip.label}
          </span>
        </Link>
      ) : null}
      {progress ? (
        <span className="text-[13px] font-normal text-muted-foreground" aria-live="polite">
          {progress}
        </span>
      ) : null}
    </div>
  );
}

// ── One line ──────────────────────────────────────────────────────

export const STEP_BUTTON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/**
 * A line: the tick (green filled when ticked, the row tinted; dashed and off
 * for a line not in your pantries), the name (struck through when missing)
 * and where it comes from, and the amount — a button that opens − / + and
 * what that takes and costs, in the row.
 */
export function SessionRow({
  view,
  open,
  flagged,
  last,
  onTick,
  onToggle,
  onStep,
  onAsk,
  onCancelAsk,
}: {
  view: SessionLineView;
  open: boolean;
  /** A refusal pointed here. */
  flagged: boolean;
  last: boolean;
  onTick: () => void;
  onToggle: () => void;
  onStep: (delta: 1 | -1) => void;
  /** Ask before use (cookpool-pantry PN-9): the line's Ask Meera, in the tick's place. */
  onAsk?: () => void;
  /** …and Cancel, while it waits. */
  onCancelAsk?: () => void;
}) {
  const panelId = `session-amount-${view.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const ask = view.ask;
  return (
    <li
      id={`session-line-${view.key.replace(/[^A-Za-z0-9_-]/g, "-")}`}
      className={cn(
        "scroll-mt-24",
        !last && "border-b border-cp-line",
        view.ticked ? "bg-cp-accent-tint" : view.ask?.state === "waiting" ? "bg-cp-soon-tint" : "bg-card",
        flagged && "outline outline-2 -outline-offset-2 outline-cp-expired",
      )}
    >
      <div className="flex min-h-16 items-center gap-2.5 py-1.5 pl-2 pr-2.5">
        {ask ? (
          ask.button && onAsk ? (
            <button
              type="button"
              onClick={onAsk}
              aria-label={ask.buttonLabel ?? ask.button}
              className="flex h-11 max-w-[42%] shrink-0 items-center gap-1.5 rounded-[14px] px-3 text-sm font-medium text-cp-cook-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ backgroundColor: INK }}
            >
              <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.6} aria-hidden />
              <span className="truncate">{ask.button}</span>
            </button>
          ) : (
            <span
              aria-hidden
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-[14px]",
                ask.state === "approved" ? "bg-cp-accent-tint text-primary" : ask.state === "waiting" ? "bg-cp-soon-tint text-cp-soon" : "bg-muted text-muted-foreground",
              )}
            >
              {ask.state === "approved" ? <Check className="h-5 w-5" strokeWidth={2.6} /> : ask.state === "declined" ? <X className="h-5 w-5" strokeWidth={2.4} /> : ask.state === "waiting" ? <Hourglass className="h-5 w-5" strokeWidth={2.2} /> : <Lock className="h-5 w-5" strokeWidth={2.2} />}
            </span>
          )
        ) : (
        <button
          type="button"
          onClick={onTick}
          aria-pressed={view.ticked}
          aria-label={view.checkLabel}
          disabled={!view.tickable}
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border-[1.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !view.tickable
              ? "cursor-default border-dashed border-border bg-background text-muted-foreground/60"
              : view.ticked
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground/60 hover:border-primary/60",
          )}
        >
          <Check className="h-5 w-5" strokeWidth={2.6} aria-hidden />
        </button>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className={cn("truncate text-[15px] font-medium", view.missing && "text-muted-foreground line-through")}>{view.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{view.sub}</span>
          {ask?.text ? (
            <span role="status" className={cn("text-xs font-medium leading-snug", ask.state === "approved" ? "text-cp-accent-text" : ask.state === "waiting" ? "text-cp-soon" : "text-muted-foreground")}>
              {ask.text}
            </span>
          ) : null}
        </div>
        {ask?.cancel && onCancelAsk ? (
          <button
            type="button"
            onClick={onCancelAsk}
            aria-label={`Cancel the ask for ${view.name}`}
            className="min-h-11 shrink-0 rounded-xl border border-transparent bg-card px-3 text-sm font-medium text-cp-soon transition-colors hover:bg-cp-soon-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        ) : view.canEdit ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${view.name}: ${view.amount}. Change the amount`}
            className={cn(
              "min-h-11 min-w-[76px] shrink-0 rounded-xl border px-3 text-[15px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              open ? "border-transparent text-cp-cook-ink" : "border-border bg-background text-foreground hover:bg-accent",
            )}
            style={open ? { backgroundColor: INK } : undefined}
          >
            {view.amount}
          </button>
        ) : (
          <span className="min-w-[76px] shrink-0 px-3 text-center text-[15px] font-medium tabular-nums text-muted-foreground">{view.amount}</span>
        )}
      </div>
      {open && view.canEdit ? (
        <div id={panelId} className="flex items-center gap-2.5 pb-3 pl-[62px] pr-3">
          <RepeatButton className={STEP_BUTTON} aria-label={view.lessLabel} disabled={!view.canLess} onStep={() => onStep(-1)}>
            <Minus className="h-5 w-5" aria-hidden />
          </RepeatButton>
          <RepeatButton className={STEP_BUTTON} aria-label={view.moreLabel} disabled={!view.canMore} onStep={() => onStep(1)}>
            <Plus className="h-5 w-5" aria-hidden />
          </RepeatButton>
          <span className="ml-auto text-right text-[13px] font-normal tabular-nums text-muted-foreground" aria-live="polite">
            {view.costNote}
          </span>
        </div>
      ) : null}
    </li>
  );
}

/** Add an item: today's item picker (search every pantry, or something just bought). */
export const AddItemButton = React.forwardRef<HTMLButtonElement, { onClick: () => void; expanded: boolean }>(function AddItemButton({ onClick, expanded }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-muted-foreground/50 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
      Add an item
    </button>
  );
});

/** Steps · 2 of 5: open it to tick them. */
export function StepsCard({
  title,
  steps,
  open,
  onOpen,
  onToggle,
}: {
  title: string;
  steps: readonly SessionStep[];
  open: boolean;
  onOpen: () => void;
  onToggle: (index: number) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-cp-card">
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        aria-controls="session-steps"
        className="flex min-h-[52px] w-full items-center justify-between px-4 text-left text-[15px] font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {title}
        <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ol id="session-steps" aria-label="Steps" className="border-t border-cp-line">
          {steps.map((s, i) => (
            <li key={i} className={cn(i > 0 && "border-t border-cp-line")}>
              <button
                type="button"
                role="checkbox"
                aria-checked={s.done}
                onClick={() => onToggle(i)}
                className="flex min-h-12 w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full border-[1.5px] text-xs font-medium",
                    s.done ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                  )}
                >
                  {s.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn("text-[15px] leading-snug", s.done && "text-muted-foreground line-through")}>{s.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

// ── The Finish sheet's parts ──────────────────────────────────────

/** "3 not ticked · Took them all / Leave them out" (Took them all is the default). */
export function UntickedChoiceBox({ text, value, onChange }: { text: string; value: UntickedChoice; onChange: (v: UntickedChoice) => void }) {
  return (
    <div className="space-y-2 rounded-2xl bg-cp-soon-tint p-3">
      <p id="session-unticked" className="text-sm font-medium text-cp-soon">
        {text}
      </p>
      <div role="radiogroup" aria-labelledby="session-unticked" className="grid grid-cols-2 gap-[3px] rounded-xl bg-cp-soon-tint p-[3px]">
        {UNTICKED_CHOICES.map((c) => {
          const on = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(c.id)}
              className={cn(
                "min-h-11 rounded-[10px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "bg-transparent text-cp-soon",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Who ate: the post-to group's faces, each with ½ steppers and their share. */
export function WhoAteList({
  rows,
  meId,
  names,
  currency,
  loading,
  onStep,
}: {
  rows: readonly FinishEaterRow[];
  meId: string;
  names?: MemberNames | null;
  currency: string;
  loading: boolean;
  onStep: (subjectId: string, delta: 1 | -1) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-hidden>
        <div className="h-14 animate-pulse rounded-2xl bg-muted" />
        <div className="h-14 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }
  return (
    <ul aria-label="Who ate" className="flex flex-col">
      {rows.map((r) => (
        <li key={r.subjectId} className="flex min-h-14 items-center gap-3 border-b border-cp-line py-1.5 last:border-b-0">
          <Face subjectId={r.subjectId} meId={meId} names={names ?? null} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium">{r.label}</span>
            <span className={cn("text-xs font-normal tabular-nums", r.half > 0 ? "text-muted-foreground" : "text-muted-foreground")}>
              {formatMinor(r.amountMinor, currency)}
            </span>
          </span>
          <RepeatButton className={STEP_BUTTON} aria-label={r.lessLabel} disabled={!r.canLess} onStep={() => onStep(r.subjectId, -1)}>
            <Minus className="h-5 w-5" aria-hidden />
          </RepeatButton>
          <span className="min-w-7 text-center text-lg font-medium tabular-nums" aria-label={`${r.portions} portions for ${r.label}`}>
            {r.portions}
          </span>
          <RepeatButton className={STEP_BUTTON} aria-label={r.moreLabel} disabled={!r.canMore} onStep={() => onStep(r.subjectId, 1)}>
            <Plus className="h-5 w-5" aria-hidden />
          </RepeatButton>
        </li>
      ))}
    </ul>
  );
}

/** A switch row: "Save today's amounts to my recipe", "Save as a recipe". */
export function SaveSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl text-left text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex-1">{label}</span>
      <span aria-hidden className={cn("relative h-8 w-[52px] shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/40")}>
        <span className={cn("absolute top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-[left]", on ? "left-[23px]" : "left-[3px]")} />
      </span>
    </button>
  );
}

// ── One session at a time ─────────────────────────────────────────

/** "Finish or discard Chicken curry?" with Resume (the main button) and Discard and start. */
export function DiscardPromptBody({
  prompt,
  onResume,
  onDiscard,
}: {
  prompt: { title: string; body: string; resume: string; discard: string };
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] text-muted-foreground">{prompt.body}</p>
      <button
        type="button"
        onClick={onResume}
        className="min-h-[52px] w-full rounded-[18px] bg-primary px-4 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {prompt.resume}
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="min-h-[52px] w-full rounded-[18px] border border-input bg-card px-4 text-base font-medium text-cp-expired transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {prompt.discard}
      </button>
    </div>
  );
}

// ── The bar on every tab ──────────────────────────────────────────

/**
 * The session's bar (design §4.4): dark, a pot tile in the cook colour, the
 * name, "Cooking · 12 min · 3 of 7 in" and a white Resume. Just above the tab
 * bar on a phone; in the sidebar's footer from 900px.
 */
export function SessionBarCard({ view, placement }: { view: SessionBarView; placement: "phone" | "sidebar" }) {
  const pot = (
    <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-cp-cook text-cp-on-cook">
      <CookingPot className="h-6 w-6" strokeWidth={2.1} />
    </span>
  );
  const words = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[15px] font-medium">{view.name}</span>
      <span className="truncate text-xs font-normal text-cp-cook-ink/75">{view.meta}</span>
    </span>
  );
  const resume = (className: string) => (
    <Link
      href={view.href}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-xl bg-cp-cook-ink px-4 text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cp-cook-ink focus-visible:ring-offset-2 focus-visible:ring-offset-cp-cook-bg",
        className,
      )}
      style={{ color: INK }}
      aria-label={`Resume ${view.name}`}
    >
      Resume
    </Link>
  );
  if (placement === "sidebar") {
    return (
      <section aria-label="Cooking now" className="mx-3 mb-3 rounded-[18px] p-3 text-cp-cook-ink" style={{ backgroundColor: INK }}>
        <div className="flex items-center gap-3">
          {pot}
          {words}
        </div>
        {resume("mt-2.5 w-full")}
      </section>
    );
  }
  return (
    <section
      aria-label="Cooking now"
      data-toast-above=""
      // It stays put while the page moves (RC-11's page transitions). It sits 8px
      // above the floating tab bar (RV-2).
      data-vt-keep="session-bar"
      className="fixed inset-x-3 bottom-[calc(max(14px,env(safe-area-inset-bottom))+76px)] z-40 mx-auto max-w-lg rounded-[18px] py-2 pl-2 pr-2 text-cp-cook-ink shadow-[0_8px_24px_rgba(23,32,27,0.28)] min-[900px]:hidden"
      style={{ backgroundColor: INK }}
    >
      <div className="flex items-center gap-3">
        {pot}
        {words}
        {resume("shrink-0")}
      </div>
    </section>
  );
}
