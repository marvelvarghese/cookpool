"use client";

import * as React from "react";
import Link from "./link";
import {
  AlarmClock,
  BellRing,
  Check,
  ChevronDown,
  ChevronLeft,
  Ear,
  Eye,
  Flame,
  Hand,
  ListChecks,
  ListOrdered,
  Plus,
  Smartphone,
  Timer,
  Utensils,
  Volume2,
  Wind,
  X,
} from "lucide-react";
import type { StepSense } from "@saas/contracts/kitchen";
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
  SegmentState,
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
 * The look is the kitchen's: Plus Jakarta Sans, the ground #F6F7F4, herb
 * green #1F7A4D for Done, the cook colour #B4471F for the flames, the ring
 * and Start step by step, ink #17201B for the timer strip, the tint #E4F2EA
 * for the checkpoint; 44 px targets, the step in large type, one main button.
 */

export const INK = "#17201B";
export const COOK = "#B4471F";
export const HERB = "#1F7A4D";
export const TINT = "#E4F2EA";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ICON_BUTTON = cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[#3F4842] transition-colors hover:bg-accent", FOCUS);
const SMALL_BUTTON = cn("inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[15px] font-extrabold transition-colors", FOCUS);
const OUTLINE = "border border-[#C9CFC6] bg-card text-foreground hover:bg-accent";
const DARK = "border border-transparent bg-[#17201B] text-white hover:bg-[#2A342E]";
const CARD = "rounded-[18px] border border-[#E3E6E0] bg-card";

// ── The header, progress and the strip ────────────────────────────

/** Minimize, "STEP 3 OF 8 · 14 MIN IN", read aloud and the plan. */
export function GuideHeader({
  label,
  onMinimize,
  onReadAloud,
  planHref,
}: {
  label: string;
  onMinimize: () => void;
  onReadAloud?: (() => void) | null;
  planHref?: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={onMinimize} aria-label="Minimize" className={cn(ICON_BUTTON, "-ml-2.5")}>
        <ChevronDown className="h-6 w-6" aria-hidden />
      </button>
      <span className="min-w-0 flex-1 truncate text-[13px] font-extrabold tracking-[0.04em] text-[#5A635D]">{label}</span>
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
    </div>
  );
}

const SEGMENT: Readonly<Record<SegmentState, string>> = {
  done: HERB,
  current: INK,
  running: COOK,
  todo: "#D5DAD2",
};

/** One segment per step: done, this one, running (a timer or a cooker), to do. */
export function ProgressSegments({ segments, label }: { segments: readonly SegmentState[]; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex gap-1">
      {segments.map((s, i) => (
        <span key={i} data-segment={s} className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: SEGMENT[s] }} />
      ))}
    </div>
  );
}

/** The timer strip (design §3.3): other steps' timers, dark, each opening its step. */
export function TimerStrip({ items, onOpen }: { items: readonly StripItem[]; onOpen: (item: StripItem) => void }) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Timers running" className="flex flex-col gap-2">
      {items.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onClick={() => onOpen(t)}
            aria-label={`${t.label}: ${t.left}. Open it`}
            className={cn("flex min-h-12 w-full items-center gap-2.5 rounded-[14px] px-3 text-left text-white", FOCUS)}
            style={{ backgroundColor: INK }}
          >
            <Timer className="h-[18px] w-[18px] shrink-0 text-[#9AD3B2]" strokeWidth={2.2} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{t.ended ? `Done: ${t.label}` : t.label}</span>
            <span role="timer" className="shrink-0 text-base font-extrabold tabular-nums">
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
      className="sticky top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 flex items-start gap-3 rounded-[18px] p-3 text-white shadow-[0_8px_24px_rgba(23,32,27,0.28)]"
      style={{ backgroundColor: INK }}
    >
      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]" style={{ backgroundColor: COOK }}>
        <BellRing className="h-6 w-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-extrabold">{banner.title}</span>
        <span className="text-[13px] font-semibold text-[#D5DAD2]">{banner.body}</span>
        <button
          type="button"
          onClick={onOpen}
          className={cn("mt-1.5 inline-flex min-h-11 items-center self-start rounded-xl bg-white px-3.5 text-sm font-extrabold", FOCUS)}
          style={{ color: INK }}
        >
          {banner.open}
        </button>
      </span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white/80 hover:bg-white/10", FOCUS)}>
        <X className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

// ── The flame, the chips, the checkpoint ──────────────────────────

/** One to three flames, lit in the cook colour up to the level. */
export function Flames({ level, size = 18 }: { level: number; size?: number }) {
  return (
    <span aria-hidden className="flex items-end gap-0.5">
      {[1, 2, 3].map((k) => {
        const lit = level >= k;
        const px = size + (k - 1) * 4;
        return (
          <Flame
            key={k}
            data-lit={lit ? "true" : "false"}
            width={px}
            height={px}
            strokeWidth={1.8}
            color={lit ? COOK : "#C9CFC6"}
            fill={lit ? COOK : "none"}
          />
        );
      })}
    </span>
  );
}

/** The flame card: the flames and "Medium flame" (or "Flame off"). */
export function FlameCard({ flame }: { flame: FlameView }) {
  return (
    <div className={cn(CARD, "flex items-center gap-3 px-3.5 py-3")}>
      <span role="img" aria-label={flame.label}>
        <Flames level={flame.level} />
      </span>
      <span className="flex-1 text-[17px] font-extrabold">{flame.label}</span>
      {flame.hint ? <span className="text-[13px] font-bold text-[#5A635D]">{flame.hint}</span> : null}
    </div>
  );
}

/** The step's lines, scaled, as chips that tick the session's lines. */
export function StepChips({ chips, onTick }: { chips: readonly StepChipView[]; onTick: (key: string) => void }) {
  if (chips.length === 0) return null;
  return (
    <div role="group" aria-label="Goes in now" className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={c.ticked}
          aria-label={c.checkLabel}
          disabled={!c.tickable}
          onClick={() => onTick(c.key)}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-extrabold transition-colors",
            FOCUS,
            !c.tickable
              ? "cursor-default border-dashed border-[#C9CFC6] bg-background text-muted-foreground line-through"
              : c.ticked
                ? "border-[#1F7A4D] bg-[#1F7A4D] text-white"
                : "border-[#C9CFC6] bg-card text-foreground hover:border-[#1F7A4D]/60",
          )}
        >
          <Check className="h-4 w-4" strokeWidth={2.6} aria-hidden />
          {c.label}
        </button>
      ))}
    </div>
  );
}

const SENSE_ICONS: Readonly<Record<StepSense, typeof Eye>> = {
  look: Eye,
  smell: Wind,
  sound: Ear,
  feel: Hand,
  taste: Utensils,
};

/** The checkpoint (design §1): the sense, "LOOK FOR", then "Until golden brown", on the tint. */
export function CheckpointCard({ checkpoint }: { checkpoint: CheckpointView }) {
  const Icon = checkpoint.sense ? SENSE_ICONS[checkpoint.sense] : Eye;
  return (
    <div className="flex items-center gap-3 rounded-[18px] p-3.5" style={{ backgroundColor: TINT }}>
      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-white text-[#165C3A]" data-sense={checkpoint.sense ?? "none"}>
        <Icon className="h-6 w-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-extrabold tracking-[0.04em] text-[#165C3A]">{checkpoint.word}</span>
        <span className="text-[17px] font-extrabold text-[#0F3F27]">{checkpoint.text}</span>
      </span>
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ECEEE9" strokeWidth={stroke} />
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
      className={cn("flex min-h-11 items-center gap-2 rounded-xl px-1 text-[13px] font-bold text-[#1F7A4D] underline-offset-2 hover:underline", FOCUS)}
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

/**
 * The timer card (design §3.3): the ring, the range at this size, the
 * learned line when there is one (GC-7), and Start (Start and go on for a
 * hands-off step), Pause or Resume, and +1 min.
 */
export function TimerCard({ timer, pushHint, on }: { timer: TimerCardView; pushHint: boolean; on: TimerHandlers }) {
  const id = timer.timerId;
  return (
    <div className={cn(CARD, "flex flex-col gap-2 px-3.5 py-3")}>
      <div className="flex items-center gap-3.5">
        <Ring size={72} stroke={7} fraction={timer.fraction}>
          <span role="timer" className="text-[15px] font-extrabold tabular-nums">
            {timer.clock}
          </span>
        </Ring>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-extrabold">{timer.range}</span>
          {timer.learned ? <span className="text-[13px] font-bold text-[#1D4F91]">{timer.learned}</span> : null}
          <span className="mt-1.5 flex flex-wrap gap-2">
            {timer.state === "idle" ? (
              <button type="button" onClick={on.onStart} className={cn(SMALL_BUTTON, DARK)}>
                {timer.startLabel}
              </button>
            ) : timer.state === "running" && id ? (
              <button type="button" onClick={() => on.onPause(id)} className={cn(SMALL_BUTTON, OUTLINE)}>
                Pause
              </button>
            ) : timer.state === "paused" && id ? (
              <button type="button" onClick={() => on.onResume(id)} className={cn(SMALL_BUTTON, DARK)}>
                Resume
              </button>
            ) : null}
            {timer.state !== "idle" && id ? (
              <button type="button" onClick={() => on.onPlus(id)} className={cn(SMALL_BUTTON, OUTLINE)}>
                <Plus className="h-4 w-4" aria-hidden />1 min
              </button>
            ) : null}
          </span>
        </span>
      </div>
      {timer.pushNote ? <p className="text-[13px] font-semibold text-[#6B4600]">{timer.pushNote}</p> : null}
      {pushHint && timer.state !== "idle" && !timer.pushNote ? <PushHint /> : null}
    </div>
  );
}

/** The tip under the step. */
export function StepTip({ tip }: { tip: string }) {
  return <p className="px-0.5 text-sm font-semibold leading-snug text-[#3F4842]">Tip: {tip}</p>;
}

/** The bottom: "Next · …", Back, and the main button (Done, Finish). */
export function StepBottom({
  next,
  mainLabel,
  mainTone = "herb",
  onBack,
  onMain,
}: {
  next: string;
  mainLabel: string;
  /** Herb green for Done; outline for Go on while a timer runs. */
  mainTone?: "herb" | "outline";
  onBack: () => void;
  onMain: () => void;
}) {
  return (
    <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 mt-auto flex flex-col gap-2.5 bg-gradient-to-t from-background from-75% to-transparent pt-3 min-[900px]:bottom-6">
      <span className="truncate text-[13px] font-bold text-[#5A635D]">{next}</span>
      <div className="flex gap-2.5">
        <button type="button" onClick={onBack} aria-label="Previous step" className={cn("grid min-h-16 w-16 shrink-0 place-items-center rounded-[18px]", OUTLINE, FOCUS)}>
          <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden />
        </button>
        <Button
          type="button"
          onClick={onMain}
          className={cn(
            MAIN_BUTTON,
            "min-h-16 flex-1 gap-2.5 text-lg font-extrabold",
            mainTone === "herb" ? "bg-[#1F7A4D] text-white hover:bg-[#1A6A43]" : "border border-[#C9CFC6] bg-card text-foreground hover:bg-accent",
          )}
        >
          {mainTone === "herb" ? <Check className="h-[22px] w-[22px]" strokeWidth={2.8} aria-hidden /> : null}
          <span className="truncate">{mainLabel}</span>
        </Button>
      </div>
    </div>
  );
}

// ── One step (GuideStep) ──────────────────────────────────────────

/** As tall as the screen, so the bottom sits in thumb reach however short the step (as RC-6's session). */
const SCREEN = "flex min-h-[calc(100dvh-env(safe-area-inset-top)-8rem)] flex-col gap-3.5 pb-2 min-[900px]:min-h-[calc(100dvh-6rem)]";

export interface StepHandlers extends TimerHandlers {
  onMinimize: () => void;
  onReadAloud: () => void;
  onTickChip: (key: string) => void;
  onBack: () => void;
  /** Done (or Finish): ticks the step and moves on. */
  onDone: () => void;
  onStrip: (item: StripItem) => void;
}

/** One step at a time (design §3.3). */
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
  return (
    <div className={SCREEN} data-guide="step">
      {banner}
      <GuideHeader label={view.header} onMinimize={on.onMinimize} onReadAloud={on.onReadAloud} planHref={view.planHref} />
      <ProgressSegments segments={view.segments} label={view.progressLabel} />
      <TimerStrip items={strip} onOpen={on.onStrip} />
      {view.flame ? <FlameCard flame={view.flame} /> : null}
      <h1 className="mt-1 text-[26px] font-extrabold leading-tight tracking-[-0.01em]">{view.text}</h1>
      <StepChips chips={view.chips} onTick={on.onTickChip} />
      {view.checkpoint ? <CheckpointCard checkpoint={view.checkpoint} /> : null}
      {view.timer ? <TimerCard timer={view.timer} pushHint={pushHint} on={on} /> : null}
      {view.tip ? <StepTip tip={view.tip} /> : null}
      <StepBottom next={view.next} mainLabel={view.done && view.mainLabel === "Done" ? "Done · next" : view.mainLabel} onBack={on.onBack} onMain={on.onDone} />
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

/** The big ring: the time left, +1 min, Pause or Resume, and Done early. */
export function WaitRing({ ring, on }: { ring: NonNullable<WaitScreenView["ring"]>; on: Pick<WaitHandlers, "onPlus" | "onPause" | "onResume" | "onDone"> }) {
  return (
    <div className="flex flex-col items-center gap-3.5 rounded-[24px] border border-[#E3E6E0] bg-card p-[18px]">
      <Ring size={196} stroke={14} fraction={ring.fraction}>
        <span role="timer" aria-live="polite" className="text-[44px] font-extrabold tracking-[-0.02em] tabular-nums">
          {ring.clock}
        </span>
        <span className="max-w-[150px] text-center text-sm font-bold text-[#5A635D]">{ring.sub}</span>
      </Ring>
      <div className="grid w-full grid-cols-3 gap-2">
        <button type="button" onClick={() => on.onPlus(ring.timerId)} className={cn(SMALL_BUTTON, OUTLINE, "min-h-12 px-2")}>
          +1 min
        </button>
        {ring.state === "paused" ? (
          <button type="button" onClick={() => on.onResume(ring.timerId)} className={cn(SMALL_BUTTON, DARK, "min-h-12 px-2")}>
            Resume
          </button>
        ) : (
          <button type="button" onClick={() => on.onPause(ring.timerId)} disabled={ring.state === "ended"} className={cn(SMALL_BUTTON, OUTLINE, "min-h-12 px-2 disabled:opacity-40")}>
            Pause
          </button>
        )}
        <button type="button" onClick={on.onDone} className={cn(SMALL_BUTTON, OUTLINE, "min-h-12 px-2")}>
          {ring.state === "ended" ? "Done" : "Done early"}
        </button>
      </div>
    </div>
  );
}

/** A pressure cooker (design §3.4): the whistles as circles, "1 of 3 whistles", Count a whistle, and "Can't hear it?" when cooks' times say when. */
export function WhistleCounter({ whistles, on }: { whistles: WhistleView; on: Pick<WaitHandlers, "onCountWhistle" | "onWhistleHelp"> }) {
  return (
    <div className="flex flex-col items-center gap-3.5 rounded-[24px] border border-[#E3E6E0] bg-card p-[18px]">
      <div role="img" aria-label={whistles.label} className="flex flex-wrap justify-center gap-3">
        {whistles.circles.map((on, i) => (
          <span
            key={i}
            data-whistle={on ? "counted" : "to-come"}
            className={cn(
              "grid h-16 w-16 place-items-center rounded-full text-[22px] font-extrabold",
              on ? "text-white" : "border-2 border-dashed border-[#C9CFC6] bg-background text-[#9AA39D]",
            )}
            style={on ? { backgroundColor: COOK } : undefined}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <span className="text-[22px] font-extrabold" aria-live="polite">
        {whistles.label}
      </span>
      {whistles.helpTimer ? (
        <span className="text-sm font-bold text-[#5A635D]">
          {whistles.helpTimer.state === "ended" ? "About time: check the cooker" : `We'll ping you in ${whistles.helpTimer.clock}`}
        </span>
      ) : whistles.help ? (
        <button type="button" onClick={() => on.onWhistleHelp(whistles.help!.seconds)} className={cn(SMALL_BUTTON, "text-sm text-[#1F7A4D] hover:bg-accent")}>
          {whistles.help.label}
        </button>
      ) : null}
      <Button type="button" onClick={on.onCountWhistle} className={cn(MAIN_BUTTON, "bg-[#B4471F] text-[17px] font-extrabold text-white hover:bg-[#9C3C19]")}>
        Count a whistle
      </Button>
    </div>
  );
}

/** "We'll ping you when it's done" and Keep the screen on (design §3.4, §3.7). */
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
    <div className="overflow-hidden rounded-[22px] border border-[#E3E6E0] bg-card">
      <div className="flex min-h-14 items-center gap-3 border-b border-[#ECEEE9] px-3.5 py-1.5">
        <BellRing className="h-5 w-5 shrink-0 text-[#1F7A4D]" aria-hidden />
        <span className="flex-1 text-[15px] font-bold">{pingLine}</span>
      </div>
      <ScreenOnSwitch on={screenOn} onChange={onScreenOn} />
      {refused ? <p className="px-3.5 pb-3 text-[13px] font-semibold text-[#6B4600]">{SCREEN_LOCK_REFUSED}</p> : null}
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
      className={cn("flex min-h-14 w-full items-center gap-3 px-3.5 py-1.5 text-left", FOCUS)}
    >
      <Smartphone className="h-5 w-5 shrink-0 text-[#3F4842]" aria-hidden />
      <span className="flex-1 text-[15px] font-bold">Keep the screen on</span>
      <span aria-hidden className={cn("relative h-8 w-[52px] shrink-0 rounded-full transition-colors", on ? "bg-[#1F7A4D]" : "bg-[#C9CFC6]")}>
        <span className={cn("absolute top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-[left]", on ? "left-[23px]" : "left-[3px]")} />
      </span>
    </button>
  );
}

/** Meanwhile (design §3.4): prep not ticked, then the next steps up to the next hands-off one, each with Do it. */
export function MeanwhileList({ items, onDo }: { items: readonly MeanwhileItem[]; onDo: (item: MeanwhileItem) => void }) {
  return (
    <section aria-labelledby="guide-meanwhile" className="flex flex-col gap-2">
      <h2 id="guide-meanwhile" className="text-lg font-extrabold">
        Meanwhile
      </h2>
      {items.length === 0 ? (
        <p className="px-0.5 text-sm font-semibold text-[#5A635D]">Nothing else to do yet: the next step needs this one.</p>
      ) : (
        <ul className="overflow-hidden rounded-[22px] border border-[#E3E6E0] bg-card">
          {items.map((m, i) => (
            <li key={m.key} className={cn("flex min-h-16 items-center gap-3 py-2 pl-4 pr-3", i < items.length - 1 && "border-b border-[#ECEEE9]")}>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-[15px] font-extrabold">{m.text}</span>
                <span className="text-xs font-semibold text-[#5A635D]">{m.sub}</span>
              </span>
              <button type="button" onClick={() => onDo(m)} aria-label={`Do it: ${m.text}`} className={cn(SMALL_BUTTON, OUTLINE, "shrink-0")}>
                Do it
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Waiting (design §3.4): a hands-off step running, or a pressure cooker counting. */
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
  const ended = wait.ring?.state === "ended";
  return (
    <div className={SCREEN} data-guide="wait">
      {banner}
      <GuideHeader label={wait.header} onMinimize={on.onMinimize} onReadAloud={on.onReadAloud} planHref={view.planHref} />
      <ProgressSegments segments={view.segments} label={view.progressLabel} />
      <TimerStrip items={strip} onOpen={on.onStrip} />
      <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.01em]">{view.text}</h1>
      {view.flame ? (
        <div className="flex items-center gap-2.5 text-[15px] font-extrabold">
          <span role="img" aria-label={view.flame.label}>
            <Flames level={view.flame.level} size={16} />
          </span>
          {view.flame.label}
        </div>
      ) : null}
      <StepChips chips={view.chips} onTick={on.onTickChip} />
      {wait.ring ? <WaitRing ring={wait.ring} on={on} /> : null}
      {view.whistles ? <WhistleCounter whistles={view.whistles} on={on} /> : null}
      {view.timer?.pushNote ? <p className="text-[13px] font-semibold text-[#6B4600]">{view.timer.pushNote}</p> : pushHint && wait.ring ? <PushHint /> : null}
      <PingAndScreen pingLine={wait.pingLine} screenOn={screenOn} lockState={lockState} onScreenOn={on.onScreenOn} />
      <MeanwhileList items={wait.meanwhile} onDo={on.onMeanwhile} />
      {view.tip ? <StepTip tip={view.tip} /> : null}
      <StepBottom
        next={view.next}
        mainLabel={wait.goOn ? wait.goOn.label : view.mainLabel}
        mainTone={wait.goOn || (view.whistles && !ended) ? "outline" : "herb"}
        onBack={on.onBack}
        onMain={() => (wait.goOn ? on.onGoOn(wait.goOn.key) : on.onDone())}
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
        <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card p-3">
          <span className="text-sm font-semibold">Discard this session? Nothing is posted.</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setAsking(false)} className={cn(SMALL_BUTTON, OUTLINE)}>
              Keep cooking
            </button>
            <button type="button" onClick={onDiscard} className={cn(SMALL_BUTTON, OUTLINE, "text-cp-expired")}>
              Discard
            </button>
          </span>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)} className={cn(SMALL_BUTTON, "text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground")}>
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
    <section aria-label="Do this first" data-long-prep={prep.state} className="flex flex-col gap-3 rounded-[22px] border border-[#F0D9A0] bg-[#FDF1D6] px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-white text-[#8A5A00]">
          {prep.state === "done" ? <Check className="h-6 w-6" strokeWidth={2.6} /> : <AlarmClock className="h-6 w-6" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-extrabold text-[#4A3200]">{prep.title}</span>
          <span className="text-[13px] font-semibold text-[#6B4600]">{prep.sub}</span>
        </span>
      </div>
      {prep.lines.length > 0 ? (
        <ul aria-label="It uses" className="flex flex-wrap gap-2">
          {prep.lines.map((l) => (
            <li key={l} className="inline-flex min-h-8 items-center rounded-full border border-[#E2C27A] bg-white px-3 text-sm font-extrabold text-[#4A3200]">
              {l}
            </li>
          ))}
        </ul>
      ) : null}
      {prep.state === "done" ? null : (
        <div className={cn("grid gap-2", prep.state === "idle" ? "grid-cols-[1.4fr_1fr]" : "grid-cols-1")}>
          {prep.state === "idle" ? (
            <button type="button" onClick={onStart} className={cn("min-h-12 rounded-[14px] bg-[#8A5A00] px-3 text-[15px] font-extrabold text-white hover:bg-[#744B00]", FOCUS)}>
              {prep.startLabel}
            </button>
          ) : null}
          <button type="button" onClick={onDone} className={cn("min-h-12 rounded-[14px] border border-[#E2C27A] bg-white px-3 text-[15px] font-extrabold text-[#4A3200] hover:bg-[#FFF8E8]", FOCUS)}>
            {prep.doneLabel}
          </button>
        </div>
      )}
      {prep.pushNote ? <p className="text-[13px] font-semibold text-[#6B4600]">{prep.pushNote}</p> : prep.state === "running" && pushHint ? <PushHint /> : null}
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

/** The prompt (design §3.1): long prep first, then "Cook it step by step", and the two ways to cook. */
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
    <div className={SCREEN} data-guide="prompt">
      <GuideHeader label="COOKING" onMinimize={on.onMinimize} />
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em]">{view.title}</h1>
        {view.chip ? (
          <span className="inline-flex min-h-[34px] items-center self-start rounded-full px-3 text-[13px] font-extrabold text-white" style={{ backgroundColor: INK }}>
            {view.chip}
          </span>
        ) : null}
      </div>

      {view.longPrep.map((p) => (
        <LongPrepCard key={p.key} prep={p} pushHint={pushHint} onStart={() => on.onSoak(p.key)} onDone={() => on.onLongPrepDone(p.key)} />
      ))}

      <section aria-labelledby="guide-card-title" data-dimmed={view.dimmed ? "true" : "false"} className={cn("flex flex-col gap-3.5 rounded-[22px] border border-[#E3E6E0] bg-card p-4", view.dimmed && "opacity-[0.55]")}>
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] text-white" style={{ backgroundColor: COOK }}>
            <ListChecks className="h-[26px] w-[26px]" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <h2 id="guide-card-title" className="text-[19px] font-extrabold">
              Cook it step by step
            </h2>
            <span className="text-[13px] font-semibold text-[#5A635D]">{view.sub}</span>
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {view.stats.map((t) => (
            <div key={t.label} className="flex flex-col-reverse rounded-[14px] bg-background px-2.5 py-2">
              <dt className="text-xs font-bold text-[#5A635D]">{t.label}</dt>
              <dd className="text-lg font-extrabold">{t.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1.5">
          <div role="img" aria-label={view.barLabel} className="flex h-3.5 gap-[3px]">
            {view.bar.map((b, i) => (
              <span
                key={i}
                data-hands={b.handsOff ? "off" : "on"}
                className="min-w-1.5 rounded-[4px]"
                style={{ flex: `${b.minutes / total} 1 0`, backgroundColor: b.handsOff ? "#B9DCC8" : HERB }}
              />
            ))}
          </div>
          <div className="flex gap-3.5 text-xs font-bold text-[#5A635D]">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: HERB }} />
              Hands on
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-[#B9DCC8]" />
              Waiting
            </span>
          </div>
        </div>
        {view.before.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-[#ECEEE9] pt-3">
            <span className="text-xs font-extrabold tracking-[0.04em] text-[#5A635D]">BEFORE YOU START</span>
            <ul className="flex flex-col gap-2">
              {view.before.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[15px] font-semibold leading-snug">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9AA39D]" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <span className="flex items-center gap-2 text-[13px] font-bold text-[#5A635D]">
        <Smartphone className="h-4 w-4" aria-hidden />
        {noLock ? SCREEN_LOCK_REFUSED : "Your screen stays on while you cook"}
      </span>

      <div className="mt-auto flex flex-col gap-2 pt-1">
        <Button
          type="button"
          onClick={on.onGuided}
          disabled={view.dimmed}
          className={cn(MAIN_BUTTON, "bg-[#B4471F] text-white hover:bg-[#9C3C19] disabled:bg-[#ECEEE9] disabled:text-[#5A635D] disabled:opacity-100")}
        >
          <MainButtonLabel title="Start step by step" who={view.startSub} />
        </Button>
        <button type="button" onClick={on.onTick} className={cn("min-h-12 rounded-2xl text-[15px] font-extrabold text-[#3F4842] hover:bg-accent", FOCUS)}>
          Just tick what I use
        </button>
        <DiscardRow onDiscard={on.onDiscard} />
      </div>
    </div>
  );
}

// ── Before you start (GuidePrep) ──────────────────────────────────

function TickBox({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border-[1.5px] transition-colors",
        FOCUS,
        on ? "border-[#1F7A4D] bg-[#1F7A4D] text-white" : "border-[#C9CFC6] bg-card text-[#C9CFC6] hover:border-[#1F7A4D]/60",
      )}
    >
      <Check className="h-5 w-5" strokeWidth={2.6} aria-hidden />
    </button>
  );
}

function PrepSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-[13px] font-extrabold tracking-[0.04em] text-[#5A635D]">{title.toUpperCase()}</h2>
      <ul className="overflow-hidden rounded-[22px] border border-[#E3E6E0] bg-card">{children}</ul>
    </section>
  );
}

export interface PrepHandlers {
  onMinimize: () => void;
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

/** Before you start (design §3.2): Gather, Tools and Prep, with 44 px ticks, and Start cooking. */
export function GuidePrepView({
  view,
  gather,
  openKey,
  strip,
  on,
  banner,
}: {
  view: PrepScreenView;
  /** The session's lines, as RC-6's rows show them (the same ticks and amounts). */
  gather: readonly SessionLineView[];
  openKey: string | null;
  strip: readonly StripItem[];
  on: PrepHandlers;
  banner?: React.ReactNode;
}) {
  const pct = view.ready.of > 0 ? Math.round((view.ready.done / view.ready.of) * 100) : 0;
  return (
    <div className={SCREEN} data-guide="prep">
      {banner}
      <GuideHeader label={view.header} onMinimize={on.onMinimize} />
      <TimerStrip items={strip} onOpen={on.onStrip} />
      <div className="flex flex-col gap-2">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">Before you start</h1>
        <div className="flex items-center gap-2.5">
          <div role="progressbar" aria-label="Ready" aria-valuemin={0} aria-valuemax={view.ready.of} aria-valuenow={view.ready.done} className="h-2 flex-1 overflow-hidden rounded-full bg-[#E3E6E0]">
            <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: HERB }} />
          </div>
          <span className="text-[13px] font-extrabold text-[#3F4842]" aria-live="polite">
            {view.ready.text}
          </span>
        </div>
      </div>

      {gather.length > 0 ? (
        <section aria-label="Gather" className="flex flex-col gap-2">
          <h2 className="text-[13px] font-extrabold tracking-[0.04em] text-[#5A635D]">GATHER</h2>
          <ul className="overflow-hidden rounded-[22px] border bg-card">
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
          </ul>
        </section>
      ) : null}

      {view.tools.length > 0 ? (
        <PrepSection title="Tools">
          {view.tools.map((t, i) => (
            <li key={t.index} className={cn("flex min-h-[60px] items-center gap-2.5 py-1.5 pl-2 pr-3", i < view.tools.length - 1 && "border-b border-[#ECEEE9]", t.ticked && "bg-[#EEF7F1]")}>
              <TickBox on={t.ticked} label={t.checkLabel} onClick={() => on.onTickTool(t.index)} />
              <span className="flex-1 text-[15px] font-extrabold">{t.name}</span>
            </li>
          ))}
        </PrepSection>
      ) : null}

      {view.prep.length > 0 ? (
        <PrepSection title="Prep">
          {view.prep.map((p, i) => (
            <li key={p.key} className={cn("flex min-h-[60px] items-center gap-2.5 py-1.5 pl-2 pr-3", i < view.prep.length - 1 && "border-b border-[#ECEEE9]", p.ticked && "bg-[#EEF7F1]")}>
              <TickBox on={p.ticked} label={p.checkLabel} onClick={() => on.onTickPrep(p.key)} />
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className={cn("text-[15px] font-extrabold", p.ticked && "text-muted-foreground line-through")}>{p.text}</span>
                {p.sub ? <span className="text-xs font-semibold text-[#5A635D]">{p.sub}</span> : null}
              </span>
              {p.timer ? (
                p.timer.state === "idle" ? (
                  <button type="button" onClick={() => on.onStartPrep(p.key)} className={cn(SMALL_BUTTON, DARK, "shrink-0 text-sm")}>
                    {p.timer.label}
                  </button>
                ) : (
                  <span role="timer" className="inline-flex min-h-10 shrink-0 items-center rounded-xl border border-[#B9DCC8] px-3 text-sm font-extrabold tabular-nums text-[#165C3A]" style={{ backgroundColor: TINT }}>
                    {p.timer.label}
                  </span>
                )
              ) : null}
            </li>
          ))}
        </PrepSection>
      ) : null}

      <DiscardRow onDiscard={on.onDiscard} />

      <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 mt-auto bg-gradient-to-t from-background from-70% to-transparent pt-3 min-[900px]:bottom-6">
        <Button type="button" onClick={on.onStart} className={cn(MAIN_BUTTON, "min-h-16 bg-[#B4471F] text-white hover:bg-[#9C3C19]")}>
          <MainButtonLabel title={view.startTitle} who={view.startSub} />
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

/** Done (design §3.6): the time, hands on, steps and cost, how each step went, Use today's times, then Who ate? */
export function GuideDoneView({
  view,
  whoAteSub,
  strip,
  savingTimes,
  alert,
  on,
}: {
  view: DoneScreenView;
  /** Under Who ate?: "₹143.96 · post to Flat 4B". */
  whoAteSub: string;
  strip: readonly StripItem[];
  savingTimes: boolean;
  alert: string | null;
  on: DoneHandlers;
}) {
  return (
    <div className={SCREEN} data-guide="done">
      <GuideHeader label="DONE" onMinimize={on.onMinimize} />
      <TimerStrip items={strip} onOpen={on.onStrip} />
      <div className="flex flex-col items-center gap-2.5 rounded-[24px] px-4 py-5 text-center text-white" style={{ backgroundColor: INK }}>
        <span aria-hidden className="grid h-14 w-14 place-items-center rounded-full" style={{ backgroundColor: HERB }}>
          <Check className="h-[30px] w-[30px]" strokeWidth={2.8} />
        </span>
        <h1 className="text-2xl font-extrabold">{view.title}</h1>
        <span className="text-5xl font-extrabold tracking-[-0.02em] tabular-nums" aria-label={`Cooked in ${view.total}`}>
          {view.total}
        </span>
        <span className="text-sm font-bold text-[#C9CFC6]">In all, from the first step</span>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {view.stats.map((t) => (
          <div key={t.label} className="flex flex-col-reverse rounded-2xl border border-[#E3E6E0] bg-card px-3 py-2.5">
            <dt className="text-xs font-bold text-[#5A635D]">{t.label}</dt>
            <dd className="truncate text-lg font-extrabold">{t.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="guide-how" className="flex flex-col gap-2">
        <h2 id="guide-how" className="text-lg font-extrabold">
          How each step went
        </h2>
        <ol className="overflow-hidden rounded-[22px] border border-[#E3E6E0] bg-card">
          {view.rows.map((r, i) => (
            <li key={r.key} className={cn("px-3.5 py-3", i < view.rows.length - 1 && "border-b border-[#ECEEE9]")}>
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold">{r.name}</span>
                <span className={cn("shrink-0 text-[15px] font-extrabold tabular-nums", r.slow ? "text-[#8A5A00]" : r.time === "Not ticked" ? "text-muted-foreground" : "text-[#165C3A]")}>
                  {r.time}
                </span>
              </span>
              {r.bar ? (
                <span aria-hidden className="relative mt-2 block h-2.5 rounded-full bg-[#ECEEE9]">
                  {r.bar.highPct > 0 ? (
                    <span className="absolute inset-y-0 rounded-full bg-[#B9DCC8]" style={{ left: `${r.bar.lowPct}%`, width: `${Math.max(2, r.bar.highPct - r.bar.lowPct)}%` }} />
                  ) : null}
                  <span className="absolute -top-[3px] h-4 w-1 rounded-sm" style={{ left: `calc(${r.bar.markPct}% - 2px)`, backgroundColor: r.slow ? "#D97706" : HERB }} />
                </span>
              ) : null}
              {r.usual ? <span className="mt-1.5 block text-xs font-bold text-[#5A635D]">{r.usual}</span> : null}
            </li>
          ))}
        </ol>
      </section>

      {view.useTimes ? (
        <button
          type="button"
          role="switch"
          aria-checked={view.useTimes.on}
          disabled={savingTimes}
          onClick={() => on.onUseTimes(!view.useTimes!.on)}
          className={cn("flex min-h-16 items-center gap-3 rounded-[18px] border border-[#E3E6E0] bg-card px-3.5 py-2.5 text-left disabled:opacity-60", FOCUS)}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-extrabold">Use today&apos;s times next time</span>
            <span className="text-xs font-semibold text-[#5A635D]">{view.useTimes.sub}</span>
          </span>
          <span aria-hidden className={cn("relative h-8 w-[52px] shrink-0 rounded-full transition-colors", view.useTimes.on ? "bg-[#1F7A4D]" : "bg-[#C9CFC6]")}>
            <span className={cn("absolute top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-[left]", view.useTimes.on ? "left-[23px]" : "left-[3px]")} />
          </span>
        </button>
      ) : null}

      <p className="px-0.5 text-[13px] font-semibold leading-snug text-[#5A635D]">Your times join the ranges other cooks see, never with your name.</p>

      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={on.onBackToSteps} className={cn(SMALL_BUTTON, "text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-foreground")}>
          Back to the steps
        </button>
      </div>
      <DiscardRow onDiscard={on.onDiscard} />

      <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 mt-auto space-y-2 bg-gradient-to-t from-background from-70% to-transparent pt-3 min-[900px]:bottom-6">
        {alert ? (
          <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
            {alert}
          </p>
        ) : null}
        <Button type="button" onClick={on.onWhoAte} className={cn(MAIN_BUTTON, "min-h-16 bg-[#B4471F] text-white hover:bg-[#9C3C19]")}>
          <MainButtonLabel title="Who ate?" who={whoAteSub} />
        </Button>
      </div>
    </div>
  );
}
