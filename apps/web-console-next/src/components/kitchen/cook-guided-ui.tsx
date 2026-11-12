"use client";

import * as React from "react";
import Link from "./link";
import {
  AlarmClock,
  BellRing,
  Check,
  ChevronDown,
  ChevronLeft,
  Flame,
  ListChecks,
  ListOrdered,
  Plus,
  Smartphone,
  Timer,
  Pause,
  Play,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { SessionRow } from "./cook-session-ui";
import type { SessionLineView } from "./cook-session";
import type { ScreenLockState } from "./cook-guided-device";
import { SCREEN_LOCK_REFUSED } from "./cook-guided-device";
import type {
  CheckpointView,
  DoneScreenView,
  FlameView,
  LongPrepView,
  MeanwhileItem,
  PrepScreenView,
  PromptView,
  StepChipView,
  StepScreenView,
  StripItem,
  TimerBanner,
  TimerCardView,
  WaitScreenView,
  WhistleView,
} from "./cook-guided-screens";

/**
 * Guided mode's screens as they draw (cookpool-guided GC-5, the canvas's
 * `GuidePrompt`, `GuidePrep`, `GuideStep`, `GuideWait` and `GuideDone`),
 * from the view-models in `cook-guided-screens.ts`: no reads, writes or
 * timers here, so each renders in tests. `cook-guided-screen.tsx` holds the
 * draft, the clock, the server timers and the phone's parts.
 *
 * The look (RV-4, the canvas's `RvCookStep`) is the revamp's tokens: the
 * accent for Done and the progress, the cook colour for the flames, the ring
 * and Start step by step, the cook strip for a running timer, the tint for
 * chips; 44 px targets, the step in large type, one main button.
 */

export const INK = "hsl(var(--cp-cook-bg))";
export const COOK = "hsl(var(--cp-cook))";
export const HERB = "hsl(var(--primary))";
export const TINT = "hsl(var(--cp-accent-tint))";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ICON_BUTTON = cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent", FOCUS);
const SMALL_BUTTON = cn("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[15px] font-medium transition-colors", FOCUS);
/** A quiet pill on the tint (RV-16: no bordered outline buttons). */
const QUIET = "bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80";
/** A running timer, on the cook strip. */
const DARK = "bg-cp-cook-bg text-cp-cook-ink hover:bg-cp-cook-bg/90";
/** Where a screen's sticky bottom sits: the screen's foot, since the session hides the tab bar (RV-19's `--cp-bottom-bar`). */
const BOTTOM = "sticky bottom-[var(--cp-bottom-bar,calc(max(14px,env(safe-area-inset-bottom))+76px))] z-30 mt-auto min-[900px]:bottom-6";

// ── The header, progress and the strip ────────────────────────────

/**
 * Minimize, the label, read aloud and the plan. The step and the waiting
 * screen show the dish's name there (`title`, RV-4); Before you start too
 * (RV-16). `back` draws the leading button as a back arrow (the prompt's
 * Back to recipe, Done's Back to the steps; RV-16, the canvas's
 * `RvCookStart`, `RvCookPrep`, `RvCookDone`), and `onMinimize` then also
 * shows as ⌄ at the end when the back arrow does something else.
 */
export function GuideHeader({
  label,
  title = false,
  onMinimize,
  onReadAloud,
  planHref,
  back = null,
}: {
  label: string;
  /** The dish's name in 16 px (RV-4's step) rather than "STEP 3 OF 8 · 14 MIN IN". */
  title?: boolean;
  onMinimize: () => void;
  onReadAloud?: (() => void) | null;
  planHref?: string | null;
  /** The back arrow: its name and what it does (null: ⌄ Minimize). */
  back?: { label: string; onClick: () => void; minimizeToo?: boolean } | null;
}) {
  return (
    <div className="flex items-center gap-1">
      {back ? (
        <button type="button" onClick={back.onClick} aria-label={back.label} className={cn(ICON_BUTTON, "-ml-2.5 text-foreground")}>
          <ChevronLeft className="h-[22px] w-[22px]" aria-hidden />
        </button>
      ) : (
        <button type="button" onClick={onMinimize} aria-label="Minimize" className={cn(ICON_BUTTON, "-ml-2.5 text-foreground")}>
          <ChevronDown className="h-6 w-6" aria-hidden />
        </button>
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          title ? "text-base font-medium text-foreground" : "text-[13px] font-medium tracking-[0.04em] text-muted-foreground",
        )}
      >
        {label}
      </span>
      {onReadAloud ? (
        <button type="button" onClick={onReadAloud} aria-label="Read this step aloud" className={ICON_BUTTON}>
          <Volume2 className="h-[22px] w-[22px]" aria-hidden />
        </button>
      ) : null}
      {planHref ? (
        <Link href={planHref} aria-label="The plan: every step" className={cn(ICON_BUTTON, "-mr-2.5")}>
          <ListOrdered className="h-[22px] w-[22px]" aria-hidden />
        </Link>
      ) : null}
      {back?.minimizeToo ? (
        <button type="button" onClick={onMinimize} aria-label="Minimize" className={cn(ICON_BUTTON, "-mr-2.5")}>
          <ChevronDown className="h-6 w-6" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** The step's progress (RV-4, the canvas's `RvCookStep`): a thin bar on the line, filled with the accent, and "3 of 7". */
export function StepProgress({ number, of, text, label }: { number: number; of: number; text: string; label: string }) {
  const pct = of > 0 ? Math.round((Math.min(number, of) / of) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={of} aria-valuenow={number} className="h-1 flex-1 overflow-hidden rounded-full bg-cp-line">
        <span className="block h-1 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">{text}</span>
    </div>
  );
}

/** The timer strip (design §3.3; RV-4's pills): other steps' timers, each a card pill opening its step. */
export function TimerStrip({ items, onOpen }: { items: readonly StripItem[]; onOpen: (item: StripItem) => void }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Timers running" className="flex flex-wrap gap-2">
      {items.map((t) => (
        <li key={t.id} className="min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => onOpen(t)}
            aria-label={`${t.label}: ${t.left}. Open it`}
            className={cn(
              "flex min-h-11 max-w-full items-center gap-2 rounded-full px-3.5 text-left text-sm font-medium shadow-cp-card",
              t.ended ? "bg-cp-cook-bg text-cp-cook-ink" : "bg-card text-foreground",
              FOCUS,
            )}
          >
            <Timer className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden />
            <span className="min-w-0 truncate">{t.pill}</span>
            <span aria-hidden>·</span>
            <span role="timer" className="shrink-0 tabular-nums">
              {t.left}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A timer that ended in the page (design §3.7): its push's words, Open and dismiss. */
export function TimerBannerCard({ banner, onOpen, onDismiss }: { banner: TimerBanner; onOpen: () => void; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="sticky top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 flex items-start gap-3 rounded-[18px] p-3 text-cp-cook-ink shadow-cp-nav"
      style={{ backgroundColor: INK }}
    >
      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]" style={{ backgroundColor: COOK }}>
        <BellRing className="h-6 w-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-medium">{banner.title}</span>
        <span className="text-[13px] font-normal text-cp-cook-ink/80">{banner.body}</span>
        <button
          type="button"
          onClick={onOpen}
          className={cn("mt-1.5 inline-flex min-h-11 items-center self-start rounded-xl bg-cp-cook-ink px-3.5 text-sm font-medium", FOCUS)}
          style={{ color: INK }}
        >
          {banner.open}
        </button>
      </span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-cp-cook-ink/80 hover:bg-cp-cook-ink/10", FOCUS)}>
        <X className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

// ── The heat, the check, the timer and the chips (RV-4) ───────────

/** The heat in one word (RV-16, the canvas's `RvCookStep`): "Medium", not "Medium flame". */
export const HEAT_WORDS = ["Flame off", "Low", "Medium", "High"] as const;

/**
 * The step's one heat and time chip (RV-4, the canvas's `RvCookStep`): the
 * flame and "Medium · 8–10 min" on the tint, "Flame off" plain; the time
 * alone when the step says no flame. RV-16 drops "· Stay close".
 */
export function HeatChip({ flame, time }: { flame: FlameView | null; time: string | null }) {
  if (!flame && !time) return null;
  const off = !flame || flame.level === 0;
  const words = [flame ? (HEAT_WORDS[flame.level] ?? flame.label) : null, time].filter(Boolean).join(" · ");
  return (
    <span
      data-heat={flame ? flame.level : "none"}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 self-start rounded-full px-3 text-sm font-medium",
        off ? "bg-cp-line text-muted-foreground" : "bg-cp-accent-tint text-cp-accent-text",
      )}
    >
      {flame ? <Flame className="h-4 w-4" fill="currentColor" strokeWidth={1.5} aria-hidden /> : <Timer className="h-4 w-4" strokeWidth={2.2} aria-hidden />}
      {words}
    </span>
  );
}

/** "8–10 min at this size" → "8–10 min", for the chip. */
export function chipTime(range: string | null | undefined): string | null {
  if (!range) return null;
  return range.replace(/ at this size$/, "");
}

/** What to watch for, in one muted line (RV-4; RV-25: no sense icon, as `RvCookStep`): "Until golden brown". */
export function CheckLine({ checkpoint }: { checkpoint: CheckpointView }) {
  const word = checkpoint.word.charAt(0) + checkpoint.word.slice(1).toLowerCase();
  return (
    <p className="text-[17px] font-normal leading-snug text-muted-foreground" data-sense={checkpoint.sense ?? "none"}>
      <span>
        <span className="sr-only">{word}: </span>
        {checkpoint.text}
      </span>
    </p>
  );
}

/**
 * The one hint a step's timer shows (RV-16: at most one hint per screen):
 * why it won't reach a locked phone, else how to hear timers locked (once
 * one runs on a phone without push), else what cooks learned (GC-7); null
 * when there is none.
 */
export function timerHint(timer: TimerCardView | null, pushHint: boolean): "push" | "learned" | "hint" | null {
  if (!timer) return null;
  if (timer.pushNote) return "push";
  if (pushHint && timer.state !== "idle") return "hint";
  if (timer.learned) return "learned";
  return null;
}

/**
 * The step's timer as a chip (RV-4, RV-16): "Start 8:00" (or "Start and go
 * on"), then "4:12 · Pause" on the cook strip while it runs, "4:12 ·
 * Resume" paused, and +1 min beside it; "Done · again" once it ends, which
 * sets it again. Under it, its one hint (`timerHint`).
 */
export function TimerChip({ timer, pushHint, on }: { timer: TimerCardView; pushHint: boolean; on: TimerHandlers }) {
  const id = timer.timerId;
  const chip = cn("inline-flex min-h-12 items-center gap-2 rounded-full px-[18px] text-[17px] font-medium tabular-nums transition-colors", FOCUS);
  const idle = cn(chip, "bg-card text-foreground shadow-cp-card hover:bg-accent");
  const running = cn(chip, "bg-cp-cook-bg text-cp-cook-ink hover:bg-cp-cook-bg/90");
  const hint = timerHint(timer, pushHint);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {timer.state === "idle" ? (
          <button type="button" onClick={on.onStart} aria-label={`${timer.startLabel}: timer, ${timer.clock}`} className={idle}>
            <AlarmClock className="h-5 w-5" strokeWidth={2.2} aria-hidden />
            <span>{timer.startLabel}</span>
            <span role="timer">{timer.clock}</span>
          </button>
        ) : timer.state === "running" && id ? (
          <button type="button" onClick={() => on.onPause(id)} aria-label={`Pause timer, ${timer.clock} left`} className={running}>
            <AlarmClock className="h-5 w-5" strokeWidth={2.2} aria-hidden />
            <span role="timer">{timer.clock}</span>
            <span aria-hidden>·</span>
            <span>Pause</span>
          </button>
        ) : timer.state === "paused" && id ? (
          <button type="button" onClick={() => on.onResume(id)} aria-label={`Resume timer, ${timer.clock} left`} className={idle}>
            <AlarmClock className="h-5 w-5" strokeWidth={2.2} aria-hidden />
            <span role="timer">{timer.clock}</span>
            <span aria-hidden>·</span>
            <span>Resume</span>
          </button>
        ) : (
          <button type="button" onClick={on.onStart} aria-label="Timer done, start again" className={idle}>
            <AlarmClock className="h-5 w-5" strokeWidth={2.2} aria-hidden />
            <span role="timer">Done</span>
            <span aria-hidden>·</span>
            <span>again</span>
          </button>
        )}
        {(timer.state === "running" || timer.state === "paused") && id ? (
          <button type="button" onClick={() => on.onPlus(id)} className={cn(SMALL_BUTTON, "rounded-full bg-card shadow-cp-card hover:bg-accent")}>
            <Plus className="h-4 w-4" aria-hidden />1 min
          </button>
        ) : null}
      </div>
      {hint === "push" ? <p className="text-[13px] font-normal text-cp-soon">{timer.pushNote}</p> : null}
      {hint === "learned" ? <p className="text-sm font-normal text-cp-owed">{timer.learned}</p> : null}
      {hint === "hint" ? <PushHint /> : null}
    </div>
  );
}

/** The step's lines, scaled, as chips that tick the session's lines (RV-4: card pills, struck through on the tint once in). */
export function StepChips({ chips, onTick, after }: { chips: readonly StepChipView[]; onTick: (key: string) => void; after?: React.ReactNode }) {
  if (chips.length === 0 && !after) return null;
  return (
    <div role="group" aria-label="Goes in now" className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={c.ticked}
          aria-label={c.checkLabel}
          disabled={!c.tickable}
          onClick={() => onTick(c.key)}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors",
            FOCUS,
            !c.tickable
              ? "cursor-default bg-cp-line text-muted-foreground line-through"
              : c.ticked
                ? "bg-cp-accent-tint text-cp-accent-text line-through"
                : "bg-card text-foreground shadow-cp-card hover:bg-accent",
          )}
        >
          {c.ticked ? <Check className="h-4 w-4" strokeWidth={2.6} aria-hidden /> : null}
          {c.label}
        </button>
      ))}
      {after ?? null}
    </div>
  );
}

// ── Timers ────────────────────────────────────────────────────────

/** A ring, filled in the cook colour as the time goes. */
export function Ring({ size, stroke, fraction, children }: { size: number; stroke: number; fraction: number; children: React.ReactNode }) {
  const r = (size - stroke) / 2 - 1;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--cp-line))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COOK}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * f).toFixed(1)} ${c.toFixed(1)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">{children}</span>
    </span>
  );
}

/** With no push on this device, a timer can't reach a locked phone: the way to turn it on. */
export function PushHint() {
  return (
    <Link
      href="/you/notifications"
      className={cn("flex min-h-11 items-center gap-2 rounded-xl px-1 text-[13px] font-normal text-cp-accent-text underline-offset-2 hover:underline", FOCUS)}
    >
      <AlarmClock className="h-4 w-4 shrink-0" aria-hidden />
      Turn on notifications to hear timers with the phone locked
    </Link>
  );
}

export interface TimerHandlers {
  onStart: () => void;
  onPause: (timerId: string) => void;
  onResume: (timerId: string) => void;
  onPlus: (timerId: string) => void;
}

/** The tip under the step. */
export function StepTip({ tip }: { tip: string }) {
  return <p className="px-0.5 text-sm font-normal leading-snug text-muted-foreground">Tip: {tip}</p>;
}

/**
 * The bottom (RV-4): Back, quiet, and the one main button on the accent
 * (Done, Finish — always enabled), 60 px, at the screen's foot. "Next · …"
 * is said to a screen reader. Back is off on the first step (RV-16).
 */
export function StepBottom({
  next,
  mainLabel,
  mainTone = "herb",
  backDisabled = false,
  onBack,
  onMain,
}: {
  next: string;
  mainLabel: string;
  /** The accent for Done; a card for Go on while a timer runs. */
  mainTone?: "herb" | "outline";
  /** The first step: there is nothing before it. */
  backDisabled?: boolean;
  onBack: () => void;
  onMain: () => void;
}) {
  return (
    <div data-toast-above="" className={cn(BOTTOM, "flex gap-2.5 bg-gradient-to-t from-background from-80% to-transparent pb-2 pt-4")}>
      <span className="sr-only">{next}</span>
      <button
        type="button"
        onClick={onBack}
        disabled={backDisabled}
        aria-label="Previous step"
        className={cn(
          "min-h-[60px] w-24 shrink-0 rounded-[18px] text-base font-medium text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:text-cp-line disabled:hover:bg-transparent",
          FOCUS,
        )}
      >
        Back
      </button>
      <Button
        type="button"
        onClick={onMain}
        className={cn(
          MAIN_BUTTON,
          "min-h-[60px] flex-1 gap-2.5 rounded-[18px] text-lg font-medium",
          mainTone === "herb" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-card text-foreground shadow-cp-card hover:bg-accent",
        )}
      >
        <span className="truncate">{mainLabel}</span>
      </Button>
    </div>
  );
}

// ── One step (GuideStep) ──────────────────────────────────────────

/** As tall as the screen, so the bottom sits in thumb reach however short the step (as RC-6's session). */
const SCREEN = "flex min-h-[calc(100dvh-env(safe-area-inset-top)-2.75rem-var(--cp-tabbar-space,84px))] flex-col gap-3.5 pb-2 min-[900px]:min-h-[calc(100dvh-6rem)]";

export interface StepHandlers extends TimerHandlers {
  onMinimize: () => void;
  onReadAloud: () => void;
  onTickChip: (key: string) => void;
  onBack: () => void;
  /** Done (or Finish): ticks the step and moves on. */
  onDone: () => void;
  onStrip: (item: StripItem) => void;
  /** "Add amounts" (RV-4): Before you start, where the lines take their amounts. */
  onAddAmounts?: (() => void) | undefined;
}

/**
 * One step at a time (design §3.3; RV-4, the canvas's `RvCookStep`): the
 * dish's name, a thin bar and "3 of 7", the other timers as pills, one heat
 * and time chip, the step in big type, what to watch for, the timer chip,
 * the lines as chips with "Add amounts" quiet after them, and Back and the
 * one main button. At most one hint (RV-16): the timer's, else the tip.
 */
export function GuideStepView({
  view,
  strip,
  pushHint,
  on,
  banner,
}: {
  view: StepScreenView;
  strip: readonly StripItem[];
  /** This device has no push: say how to hear timers locked. */
  pushHint: boolean;
  on: StepHandlers;
  banner?: React.ReactNode;
}) {
  const addAmounts = on.onAddAmounts ? (
    <button type="button" onClick={on.onAddAmounts} className={cn("inline-flex min-h-11 items-center rounded-lg px-1.5 text-sm font-medium text-cp-accent-text hover:underline", FOCUS)}>
      Add amounts
    </button>
  ) : null;
  return (
    <div className={cn(SCREEN, "gap-5")} data-guide="step">
      {banner}
      <GuideHeader label={view.title} title onMinimize={on.onMinimize} onReadAloud={on.onReadAloud} planHref={view.planHref} />
      <StepProgress number={view.number} of={view.of} text={view.countText} label={view.progressLabel} />
      <TimerStrip items={strip} onOpen={on.onStrip} />
      <div className="flex flex-col gap-3.5">
        <HeatChip flame={view.flame} time={chipTime(view.timer?.range)} />
        <h1 className="text-[30px] font-medium leading-[1.22] tracking-[-0.02em]">{view.text}</h1>
        {view.checkpoint ? <CheckLine checkpoint={view.checkpoint} /> : null}
      </div>
      {view.timer ? <TimerChip timer={view.timer} pushHint={pushHint} on={on} /> : null}
      <StepChips chips={view.chips} onTick={on.onTickChip} after={addAmounts} />
      {view.tip && !timerHint(view.timer, pushHint) ? <StepTip tip={view.tip} /> : null}
      <StepBottom
        next={view.next}
        mainLabel={view.mainLabel}
        backDisabled={view.number <= 1}
        onBack={on.onBack}
        onMain={on.onDone}
      />
    </div>
  );
}

// ── Waiting (GuideWait) ───────────────────────────────────────────

export interface WaitHandlers extends StepHandlers {
  onCountWhistle: () => void;
  /** "Can't hear it?": a timer for the usual time of the count. */
  onWhistleHelp: (seconds: number) => void;
  onScreenOn: (on: boolean) => void;
  onMeanwhile: (item: MeanwhileItem) => void;
  /** Go on to the next step; the timer keeps running. */
  onGoOn: (key: string) => void;
}

/**
 * The timer card (RV-16, the canvas's `RvCookWait`): the time left in 64 px,
 * "of 20:00" beside it, a thin bar filling with the accent, then Pause (or
 * Resume) and +1 min as pills on the tint (RV-25: Done is the main button,
 * "Done · next", as `RvCookWait`).
 */
export function WaitRing({ ring, on }: { ring: NonNullable<WaitScreenView["ring"]>; on: Pick<WaitHandlers, "onPlus" | "onPause" | "onResume" | "onDone"> }) {
  const pill = cn(SMALL_BUTTON, QUIET, "min-h-11 rounded-[14px] px-4");
  const pct = Math.round(Math.max(0, Math.min(1, ring.fraction)) * 100);
  return (
    <div className="flex flex-col gap-3.5 rounded-cp-card bg-card px-[18px] pb-4 pt-5 shadow-cp-card">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span role="timer" aria-live="polite" className="text-[64px] font-medium leading-none tracking-[-0.03em] tabular-nums">
          {ring.clock}
        </span>
        <span className="text-[15px] font-normal text-muted-foreground">{ring.sub}</span>
      </div>
      <div aria-hidden className="h-1 overflow-hidden rounded-full bg-cp-line">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {ring.state === "paused" ? (
          <button type="button" onClick={() => on.onResume(ring.timerId)} className={pill}>
            <Play className="h-4 w-4" fill="currentColor" aria-hidden />
            Resume
          </button>
        ) : ring.state !== "ended" ? (
          <button type="button" onClick={() => on.onPause(ring.timerId)} className={pill}>
            <Pause className="h-4 w-4" fill="currentColor" aria-hidden />
            Pause
          </button>
        ) : null}
        {ring.state !== "ended" ? (
          <button type="button" onClick={() => on.onPlus(ring.timerId)} className={pill}>
            +1 min
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A pressure cooker (design §3.4): the whistles as circles, "1 of 3 whistles", Count a whistle, and "Can't hear it?" when cooks' times say when. */
export function WhistleCounter({ whistles, on }: { whistles: WhistleView; on: Pick<WaitHandlers, "onCountWhistle" | "onWhistleHelp"> }) {
  return (
    <div className="flex flex-col items-center gap-3.5 rounded-[24px] bg-card shadow-cp-card p-[18px]">
      <div role="img" aria-label={whistles.label} className="flex flex-wrap justify-center gap-3">
        {whistles.circles.map((on, i) => (
          <span
            key={i}
            data-whistle={on ? "counted" : "to-come"}
            className={cn(
              "grid h-16 w-16 place-items-center rounded-full text-[22px] font-medium",
              on ? "text-cp-on-cook" : "border-2 border-dashed border-border bg-background text-muted-foreground",
            )}
            style={on ? { backgroundColor: COOK } : undefined}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <span className="text-[22px] font-medium" aria-live="polite">
        {whistles.label}
      </span>
      {whistles.helpTimer ? (
        <span className="text-sm font-normal text-muted-foreground">
          {whistles.helpTimer.state === "ended" ? "About time: check the cooker" : `We'll ping you in ${whistles.helpTimer.clock}`}
        </span>
      ) : whistles.help ? (
        <button type="button" onClick={() => on.onWhistleHelp(whistles.help!.seconds)} className={cn(SMALL_BUTTON, "text-sm text-cp-accent-text hover:bg-accent")}>
          {whistles.help.label}
        </button>
      ) : null}
      <Button type="button" onClick={on.onCountWhistle} className={cn(MAIN_BUTTON, "bg-primary text-[17px] font-medium text-primary-foreground hover:bg-primary/90")}>
        Count a whistle
      </Button>
    </div>
  );
}

/**
 * Keep the screen on, a switch row on its own card, and "We'll ping you when
 * it's done" as one muted line under it (design §3.4, §3.7; RV-16, the
 * canvas's `RvCookWait`).
 */
export function PingAndScreen({
  pingLine,
  screenOn,
  lockState,
  onScreenOn,
}: {
  pingLine: string;
  screenOn: boolean;
  lockState: ScreenLockState;
  onScreenOn: (on: boolean) => void;
}) {
  const refused = screenOn && (lockState === "refused" || lockState === "unsupported");
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-cp-card bg-card shadow-cp-card">
        <ScreenOnSwitch on={screenOn} onChange={onScreenOn} />
        {refused ? <p className="px-4 pb-3 text-[13px] font-normal text-cp-soon">{SCREEN_LOCK_REFUSED}</p> : null}
      </div>
      <span className="flex items-center justify-center gap-1.5 text-[13px] font-normal text-muted-foreground">
        <BellRing className="h-4 w-4 shrink-0" aria-hidden />
        {pingLine}
      </span>
    </div>
  );
}

/** The switch: Keep the screen on. */
export function ScreenOnSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn("flex min-h-[60px] w-full items-center gap-3 py-2 pl-4 pr-3.5 text-left", FOCUS)}
    >
      <Smartphone className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 text-base font-medium">Keep the screen on</span>
      <SwitchTrack on={on} />
    </button>
  );
}

/** A switch's track and knob (52 × 32), the accent when on. */
function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("relative h-8 w-[52px] shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-input")}>
      <span className={cn("absolute top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow-cp-card transition-[left]", on ? "left-[23px]" : "left-[3px]")} />
    </span>
  );
}

/**
 * Meanwhile (design §3.4; RV-16, the canvas's `RvCookWait`): prep not
 * ticked, then the next steps up to the next hands-off one, each a row that
 * does it (a prep ticks; a step opens), with its mark at the end.
 */
export function MeanwhileList({ items, onDo }: { items: readonly MeanwhileItem[]; onDo: (item: MeanwhileItem) => void }) {
  return (
    <section aria-labelledby="guide-meanwhile" className="flex flex-col gap-2.5">
      <h2 id="guide-meanwhile" className="text-[17px] font-medium">
        Meanwhile
      </h2>
      {items.length === 0 ? (
        <p className="px-0.5 text-sm font-normal text-muted-foreground">Nothing else to do yet: the next step needs this one.</p>
      ) : (
        <ul className="overflow-hidden rounded-cp-card bg-card shadow-cp-card">
          {items.map((m, i) => (
            <li key={m.key} className={cn(i > 0 && "border-t border-cp-line")}>
              <button
                type="button"
                onClick={() => onDo(m)}
                aria-label={`Do it: ${m.text}`}
                className={cn("flex min-h-16 w-full items-center gap-3 py-2 pl-4 pr-3 text-left transition-colors hover:bg-accent/50", m.done && "bg-cp-accent-tint", FOCUS)}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-base font-medium", m.done && "text-muted-foreground line-through")}>{m.text}</span>
                  <span className="text-[13px] font-normal text-muted-foreground">{m.sub}</span>
                </span>
                <span aria-hidden className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", m.done ? "bg-primary text-primary-foreground" : "bg-cp-line text-muted-foreground")}>
                  <Check className="h-5 w-5" strokeWidth={2.4} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Waiting (design §3.4; RV-16, the canvas's `RvCookWait`): a hands-off step
 * running, or a pressure cooker counting. The dish's name, the bar, "Low ·
 * hands off", the step at 28 px and what to watch for, the timer card (or the
 * whistles), Keep the screen on and the ping line, Meanwhile, and Back and the
 * main button. At most one hint: the push note, else how to hear timers
 * locked, else the tip.
 */
export function GuideWaitView({
  view,
  wait,
  strip,
  screenOn,
  lockState,
  pushHint,
  on,
  banner,
}: {
  view: StepScreenView;
  wait: WaitScreenView;
  strip: readonly StripItem[];
  screenOn: boolean;
  lockState: ScreenLockState;
  pushHint: boolean;
  on: WaitHandlers;
  banner?: React.ReactNode;
}) {
  const pushNote = view.timer?.pushNote ?? null;
  const showHint = !pushNote && pushHint && !!wait.ring;
  return (
    <div className={cn(SCREEN, "gap-5")} data-guide="wait">
      {banner}
      <GuideHeader label={view.title} title onMinimize={on.onMinimize} onReadAloud={on.onReadAloud} planHref={view.planHref} />
      <span className="sr-only">{wait.header}</span>
      <StepProgress number={view.number} of={view.of} text={view.countText} label={view.progressLabel} />
      <TimerStrip items={strip} onOpen={on.onStrip} />
      <div className="flex flex-col gap-3">
        <HeatChip flame={view.flame} time={view.whistles ? "pressure cooker" : "hands off"} />
        <h1 className="text-[28px] font-medium leading-[1.22] tracking-[-0.02em]">{view.text}</h1>
        {view.checkpoint ? <CheckLine checkpoint={view.checkpoint} /> : null}
      </div>
      <StepChips chips={view.chips} onTick={on.onTickChip} />
      {wait.ring ? <WaitRing ring={wait.ring} on={on} /> : null}
      {view.whistles ? <WhistleCounter whistles={view.whistles} on={on} /> : null}
      {pushNote ? <p className="text-[13px] font-normal text-cp-soon">{pushNote}</p> : showHint ? <PushHint /> : null}
      <MeanwhileList items={wait.meanwhile} onDo={on.onMeanwhile} />
      <PingAndScreen pingLine={wait.pingLine} screenOn={screenOn} lockState={lockState} onScreenOn={on.onScreenOn} />
      {view.tip && !pushNote && !showHint ? <StepTip tip={view.tip} /> : null}
      <StepBottom
        next={view.next}
        mainLabel={view.mainLabel === "Done" ? "Done · next" : view.mainLabel}
        mainTone={view.whistles && wait.ring?.state !== "ended" ? "outline" : "herb"}
        backDisabled={view.number <= 1}
        onBack={on.onBack}
        onMain={on.onDone}
      />
    </div>
  );
}

// ── The prompt (GuidePrompt) ──────────────────────────────────────

/** "Discard session": as RC-6's, a confirm in the row. */
export function DiscardRow({ onDiscard }: { onDiscard: () => void }) {
  const [asking, setAsking] = React.useState(false);
  return (
    <div className="flex justify-center">
      {asking ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-[18px] bg-card p-3 shadow-cp-card">
          <span className="text-sm font-normal">Discard this session? Nothing is posted.</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setAsking(false)} className={cn(SMALL_BUTTON, QUIET)}>
              Keep cooking
            </button>
            <button type="button" onClick={onDiscard} className={cn(SMALL_BUTTON, "bg-cp-expired-tint text-cp-expired hover:bg-cp-expired-tint/80")}>
              Discard
            </button>
          </span>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={cn(SMALL_BUTTON, "text-sm font-normal text-muted-foreground hover:bg-accent hover:text-foreground")}>
          Discard session
        </button>
      )}
    </div>
  );
}

/** Long prep first (design §1, §3.1): the amber card, with Soak now · ping me and Already done. */
export function LongPrepCard({
  prep,
  pushHint,
  onStart,
  onDone,
}: {
  prep: LongPrepView;
  pushHint: boolean;
  onStart: () => void;
  onDone: () => void;
}) {
  return (
    <section aria-label="Do this first" data-long-prep={prep.state} className="flex flex-col gap-3 rounded-[22px] border border-transparent bg-cp-soon-tint px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-card text-cp-soon">
          {prep.state === "done" ? <Check className="h-6 w-6" strokeWidth={2.6} /> : <AlarmClock className="h-6 w-6" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-medium text-cp-soon">{prep.title}</span>
          <span className="text-[13px] font-normal text-cp-soon">{prep.sub}</span>
        </span>
      </div>
      {prep.lines.length > 0 ? (
        <ul aria-label="It uses" className="flex flex-wrap gap-2">
          {prep.lines.map((l) => (
            <li key={l} className="inline-flex min-h-8 items-center rounded-full border border-transparent bg-card px-3 text-sm font-medium text-cp-soon">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
      {prep.state === "done" ? null : (
        <div className={cn("grid gap-2", prep.state === "idle" ? "grid-cols-[1.4fr_1fr]" : "grid-cols-1")}>
          {prep.state === "idle" ? (
            <button type="button" onClick={onStart} className={cn("min-h-12 rounded-[14px] bg-cp-soon px-3 text-[15px] font-medium text-background hover:bg-cp-soon/90", FOCUS)}>
              {prep.startLabel}
            </button>
          ) : null}
          <button type="button" onClick={onDone} className={cn("min-h-12 rounded-[14px] border border-transparent bg-card px-3 text-[15px] font-medium text-cp-soon hover:bg-cp-soon-tint/80", FOCUS)}>
            {prep.doneLabel}
          </button>
        </div>
      )}
      {prep.pushNote ? <p className="text-[13px] font-normal text-cp-soon">{prep.pushNote}</p> : prep.state === "running" && pushHint ? <PushHint /> : null}
    </section>
  );
}

export interface PromptHandlers {
  onMinimize: () => void;
  /** Start step by step. */
  onGuided: () => void;
  /** Just tick what I use: RC-6's screen. */
  onTick: () => void;
  onSoak: (key: string) => void;
  onLongPrepDone: (key: string) => void;
  onDiscard: () => void;
}

/** "7 steps · about 40 min" (RV-16, the canvas's `RvCookStart`), from the prompt's stats. */
export function promptLine(view: Pick<PromptView, "stats">): string {
  const [steps, minutes] = view.stats;
  return [steps ? `${steps.value} ${steps.label.toLowerCase()}` : null, minutes ? `${minutes.value} min` : null].filter(Boolean).join(" · ");
}

/**
 * The prompt (design §3.1; RV-16, the canvas's `RvCookStart`): Back to the
 * recipe, the dish's name at 30 px, "7 steps · about 40 min", the steps as
 * one bar (hands on in the accent, waiting on the tint), long prep first
 * when there is some; then, at the foot, the screen line, **Step by step**
 * (the one main button) and **Just tick what I use**, quiet.
 */
export function GuidePromptView({
  view,
  lockState,
  pushHint,
  on,
}: {
  view: PromptView;
  lockState: ScreenLockState;
  pushHint: boolean;
  on: PromptHandlers;
}) {
  const total = view.bar.reduce((a, b) => a + b.minutes, 0) || 1;
  const noLock = lockState === "refused" || lockState === "unsupported";
  return (
    <div className={cn(SCREEN, "gap-[22px]")} data-guide="prompt">
      <GuideHeader label="" back={{ label: "Back to recipe", onClick: on.onMinimize }} onMinimize={on.onMinimize} />
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-medium leading-tight tracking-[-0.02em]">{view.title}</h1>
        <span className="text-[17px] font-normal tabular-nums text-muted-foreground">{promptLine(view)}</span>
      </div>

      <div role="img" aria-label={view.barLabel} data-dimmed={view.dimmed ? "true" : "false"} className={cn("flex h-2 gap-[3px]", view.dimmed && "opacity-[0.55]")}>
        {view.bar.map((b, i) => (
          <span
            key={i}
            data-hands={b.handsOff ? "off" : "on"}
            className={cn("min-w-1.5 rounded-[4px]", b.handsOff ? "bg-cp-accent-tint" : "bg-primary")}
            style={{ flex: `${b.minutes / total} 1 0` }}
          />
        ))}
      </div>

      {view.longPrep.map((p) => (
        <LongPrepCard key={p.key} prep={p} pushHint={pushHint} onStart={() => on.onSoak(p.key)} onDone={() => on.onLongPrepDone(p.key)} />
      ))}

      <div className="mt-auto flex flex-col gap-2.5 pt-1">
        <span className="flex items-center justify-center gap-1.5 text-[13px] font-normal text-muted-foreground">
          <Smartphone className="h-4 w-4" aria-hidden />
          {noLock ? SCREEN_LOCK_REFUSED : "Your screen stays on while you cook"}
        </span>
        <Button
          type="button"
          onClick={on.onGuided}
          disabled={view.dimmed}
          className={cn(
            MAIN_BUTTON,
            "min-h-[60px] gap-2.5 rounded-[18px] bg-primary text-primary-foreground text-lg font-medium hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100",
          )}
        >
          {view.startSub ? (
            <MainButtonLabel title="Step by step" who={view.startSub} />
          ) : (
            <>
              <ListChecks className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
              Step by step
            </>
          )}
        </Button>
        <button type="button" onClick={on.onTick} className={cn("min-h-[52px] rounded-[18px] text-base font-medium text-muted-foreground hover:bg-accent", FOCUS)}>
          Just tick what I use
        </button>
        <DiscardRow onDiscard={on.onDiscard} />
      </div>
    </div>
  );
}

// ── Before you start (GuidePrep) ──────────────────────────────────

/** A row's tick at its end (RV-16, the canvas's `RvCookPrep`): 48 × 44, the line's fill, the accent once ticked. */
function TickBox({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className={cn(
        "grid h-11 w-12 shrink-0 place-items-center rounded-xl transition-colors",
        FOCUS,
        on ? "bg-primary text-primary-foreground" : "bg-cp-line text-muted-foreground hover:bg-cp-line/70",
      )}
    >
      <Check className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden />
    </button>
  );
}

/** A section of Before you start: its 17 px heading (with a muted count), then one card of rows. */
function PrepSection({ title, count, children }: { title: string; count?: string | undefined; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h2 className="text-[17px] font-medium">
        {title}
        {count ? <span className="font-normal text-muted-foreground"> {count}</span> : null}
      </h2>
      <ul className="overflow-hidden rounded-cp-card bg-card shadow-cp-card">{children}</ul>
    </section>
  );
}

export interface PrepHandlers {
  onMinimize: () => void;
  /** Back to the prompt (RV-25), while no step has started; else Back minimizes. */
  onBack?: (() => void) | null | undefined;
  onTickLine: (key: string) => void;
  /** Ask before use (cookpool-pantry PN-9): a line's Ask Meera, and Cancel while it waits. */
  onAskLine?: (key: string, who: string) => void;
  onCancelAskLine?: (key: string) => void;
  onToggleLine: (key: string) => void;
  onStepLine: (key: string, delta: 1 | -1) => void;
  onTickTool: (index: number) => void;
  onTickPrep: (key: string) => void;
  onStartPrep: (key: string) => void;
  onStrip: (item: StripItem) => void;
  onStart: () => void;
  onDiscard: () => void;
}

/**
 * Before you start (design §3.2; RV-16, the canvas's `RvCookPrep`): Back
 * and the dish's name; "Before you start" with a thin bar and "6 of 10";
 * Gather · 3 of 7 (the session's tick rows), Tools and Prep as cards of rows
 * with their ticks at the end; and the one main button, "Start step 1".
 */
export function GuidePrepView({
  view,
  gather,
  gatherList,
  openKey,
  strip,
  on,
  banner,
}: {
  view: PrepScreenView;
  /** The session's lines, as RC-6's rows show them (the same ticks and amounts). */
  gather: readonly SessionLineView[];
  /** In their place, the new frame's tick rows (cookpool-revamp RV-11), drawn by the screen. */
  gatherList?: React.ReactNode;
  openKey: string | null;
  strip: readonly StripItem[];
  on: PrepHandlers;
  banner?: React.ReactNode;
}) {
  const pct = view.ready.of > 0 ? Math.round((view.ready.done / view.ready.of) * 100) : 0;
  const gatherCount = view.gather.of > 0 ? `· ${view.gather.done} of ${view.gather.of}` : undefined;
  const row = (i: number, ticked: boolean) => cn("flex min-h-16 items-center gap-3 py-2 pl-4 pr-3", i > 0 && "border-t border-cp-line", ticked && "bg-cp-accent-tint");
  return (
    <div className={cn(SCREEN, "gap-5")} data-guide="prep">
      {banner}
      <GuideHeader label={view.title} title onMinimize={on.onMinimize} back={{ label: "Back", onClick: on.onBack ?? on.onMinimize }} />
      <span className="sr-only">{view.header}</span>
      <TimerStrip items={strip} onOpen={on.onStrip} />
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[26px] font-medium leading-tight tracking-[-0.02em]">Before you start</h1>
        <div className="flex items-center gap-3">
          <div role="progressbar" aria-label="Ready" aria-valuemin={0} aria-valuemax={view.ready.of} aria-valuenow={view.ready.done} className="h-1 flex-1 overflow-hidden rounded-full bg-cp-line">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-sm font-medium tabular-nums text-muted-foreground" aria-live="polite">
            {view.ready.text}
          </span>
        </div>
      </div>

      {gatherList ? (
        <section aria-label="Gather" className="flex flex-col gap-2.5">
          <h2 className="text-[17px] font-medium">
            Gather
            {gatherCount ? <span className="font-normal text-muted-foreground"> {gatherCount}</span> : null}
          </h2>
          {gatherList}
        </section>
      ) : gather.length > 0 ? (
        <PrepSection title="Gather" count={gatherCount}>
          {gather.map((v, i) => (
            <SessionRow
              key={v.key}
              view={v}
              open={openKey === v.key}
              flagged={false}
              last={i === gather.length - 1}
              onTick={() => on.onTickLine(v.key)}
              onToggle={() => on.onToggleLine(v.key)}
              onStep={(d) => on.onStepLine(v.key, d)}
              {...(on.onAskLine ? { onAsk: () => on.onAskLine?.(v.key, v.ask?.who ?? "the buyer") } : {})}
              {...(on.onCancelAskLine ? { onCancelAsk: () => on.onCancelAskLine?.(v.key) } : {})}
            />
          ))}
        </PrepSection>
      ) : null}

      {view.tools.length > 0 ? (
        <PrepSection title="Tools">
          {view.tools.map((t, i) => (
            <li key={t.index} className={row(i, t.ticked)}>
              <span className={cn("min-w-0 flex-1 text-base font-medium", t.ticked && "text-muted-foreground line-through")}>{t.name}</span>
              <TickBox on={t.ticked} label={t.checkLabel} onClick={() => on.onTickTool(t.index)} />
            </li>
          ))}
        </PrepSection>
      ) : null}

      {view.prep.length > 0 ? (
        <PrepSection title="Prep">
          {view.prep.map((p, i) => (
            <li key={p.key} className={row(i, p.ticked)}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("text-base font-medium", p.ticked && "text-muted-foreground line-through")}>{p.text}</span>
                {p.sub ? <span className="text-[13px] font-normal text-muted-foreground">{p.sub}</span> : null}
              </span>
              {p.timer ? (
                p.timer.state === "idle" ? (
                  <button type="button" onClick={() => on.onStartPrep(p.key)} className={cn(SMALL_BUTTON, DARK, "shrink-0 rounded-full text-sm")}>
                    {p.timer.label}
                  </button>
                ) : (
                  <span role="timer" className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-cp-accent-tint px-3 text-sm font-medium tabular-nums text-cp-accent-text">
                    {p.timer.label}
                  </span>
                )
              ) : null}
              <TickBox on={p.ticked} label={p.checkLabel} onClick={() => on.onTickPrep(p.key)} />
            </li>
          ))}
        </PrepSection>
      ) : null}

      <DiscardRow onDiscard={on.onDiscard} />

      <div data-toast-above="" className={cn(BOTTOM, "bg-gradient-to-t from-background from-70% to-transparent pb-2 pt-3")}>
        <Button type="button" onClick={on.onStart} className={cn(MAIN_BUTTON, "min-h-[60px] rounded-[18px] bg-primary text-primary-foreground text-lg font-medium hover:bg-primary/90")}>
          {view.startLabel}
          <span className="sr-only">
            {" "}
            · {view.startTitle} · {view.startSub}
          </span>
        </Button>
      </div>
    </div>
  );
}

// ── Done (GuideDone) ──────────────────────────────────────────────

export interface DoneHandlers {
  onMinimize: () => void;
  onBackToSteps: () => void;
  onUseTimes: (on: boolean) => void;
  onWhoAte: () => void;
  onStrip: (item: StripItem) => void;
  onDiscard: () => void;
}

/** How many of Done's rows show before See all (RV-16, the canvas's `RvCookDone`). */
export const DONE_FIRST = 3;

/**
 * Done (design §3.6; RV-16, the canvas's `RvCookDone`): Back to the steps,
 * a ✓ on the tint, the dish's name at 30 px and "37 min · 8 steps"; How each
 * step went, three rows then See all; Remember times; the one footnote; and
 * the one main button, Finish, on one line (RV-25; what it costs is said to
 * a screen reader).
 */
export function GuideDoneView({
  view,
  whoAteSub,
  mainTitle = "Who ate?",
  strip,
  savingTimes,
  alert,
  on,
}: {
  view: DoneScreenView;
  /** Under Who ate?: "₹143.96 · post to Flat 4B". */
  whoAteSub: string;
  /** The main button: "Who ate?", or "Finish" in the new frame (cookpool-community CM-9: the dish is yours; Split comes after). */
  mainTitle?: string;
  strip: readonly StripItem[];
  savingTimes: boolean;
  alert: string | null;
  on: DoneHandlers;
}) {
  const [all, setAll] = React.useState(false);
  const rows = all ? view.rows : view.rows.slice(0, DONE_FIRST);
  return (
    <div className={cn(SCREEN, "gap-[22px]")} data-guide="done">
      <GuideHeader label="" onMinimize={on.onMinimize} back={{ label: "Back to the steps", onClick: on.onBackToSteps, minimizeToo: true }} />
      <TimerStrip items={strip} onOpen={on.onStrip} />
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <span aria-hidden className="grid h-16 w-16 place-items-center rounded-full bg-cp-accent-tint text-cp-accent-text">
          <Check className="h-[30px] w-[30px]" strokeWidth={2.6} />
        </span>
        <h1 className="text-[30px] font-medium leading-tight tracking-[-0.02em]">
          {view.name}
          <span className="sr-only"> is done</span>
        </h1>
        <span className="text-[17px] font-normal tabular-nums text-muted-foreground" aria-label={`Cooked in ${view.total}`}>
          {view.line}
        </span>
      </div>

      {view.rows.length > 0 ? (
        <section aria-labelledby="guide-how" className="flex flex-col gap-2.5">
          <h2 id="guide-how" className="text-[17px] font-medium">
            How each step went
          </h2>
          <ol className="overflow-hidden rounded-cp-card bg-card shadow-cp-card">
            {rows.map((r, i) => (
              <li key={r.key} className={cn("flex min-h-16 items-center gap-3 px-4 py-2.5", i > 0 && "border-t border-cp-line")}>
                <span aria-hidden className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-cp-accent-tint text-[13px] font-medium text-cp-accent-text">
                  {i + 1}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-base font-medium">{r.name}</span>
                  {r.usual ? <span className="text-[13px] font-normal text-muted-foreground">{r.usual}</span> : null}
                </span>
                <span className={cn("shrink-0 text-[15px] font-medium tabular-nums", r.slow ? "text-cp-soon" : r.time === "Not ticked" ? "text-muted-foreground" : "text-cp-accent-text")}>
                  {r.time}
                </span>
              </li>
            ))}
            {view.rows.length > DONE_FIRST ? (
              <li className="border-t border-cp-line">
                <button
                  type="button"
                  aria-expanded={all}
                  onClick={() => setAll((x) => !x)}
                  className={cn("min-h-12 w-full text-sm font-medium text-cp-accent-text hover:bg-accent/50", FOCUS)}
                >
                  {all ? "Show less" : `See all ${view.rows.length}`}
                </button>
              </li>
            ) : null}
          </ol>
        </section>
      ) : null}

      {view.useTimes ? (
        <button
          type="button"
          role="switch"
          aria-checked={view.useTimes.on}
          disabled={savingTimes}
          onClick={() => on.onUseTimes(!view.useTimes!.on)}
          className={cn("flex min-h-[60px] items-center gap-3 rounded-[18px] bg-card py-2 pl-4 pr-3.5 text-left shadow-cp-card disabled:opacity-60", FOCUS)}
        >
          <span className="flex-1 text-base font-medium">
            Remember times
            <span className="sr-only">: {view.useTimes.sub}</span>
          </span>
          <SwitchTrack on={view.useTimes.on} />
        </button>
      ) : null}

      <p className="text-center text-[13px] font-normal text-muted-foreground">Your times help other cooks, never with your name</p>

      <DiscardRow onDiscard={on.onDiscard} />

      <div data-toast-above="" className={cn(BOTTOM, "space-y-2 bg-gradient-to-t from-background from-70% to-transparent pb-2 pt-3")}>
        {alert ? (
          <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-normal text-cp-expired">
            {alert}
          </p>
        ) : null}
        <Button type="button" onClick={on.onWhoAte} className={cn(MAIN_BUTTON, "min-h-[60px] rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/90")}>
          <span className="truncate text-lg font-medium">{mainTitle}</span>
          <span className="sr-only"> · {whoAteSub}</span>
        </Button>
      </div>
    </div>
  );
}
