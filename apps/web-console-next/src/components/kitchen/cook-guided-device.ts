/**
 * Guided mode on the phone (cookpool-guided GC-5, design §3.7): keeping the
 * screen on (the Screen Wake Lock, taken again whenever the page comes back),
 * reading a step aloud (`speechSynthesis`), and ringing a timer that ends in
 * the page (a short Web Audio beep, a vibration where there is one).
 *
 * Each takes the little of the browser it uses as an argument, so all of it
 * runs in tests against fakes; the `browser…()` helpers hand over the real
 * one. Nothing here throws: a phone that can't do one of these cooks on
 * without it. Swiping between steps is a rule on top of PW-7's gestures
 * (`lib/gestures.ts`).
 */

import { EDGE_PX, hasOwnDrags, isFlick, scrollersBetween, type Claims, type DragPoint, type ElementLike, type StyleOf } from "@/lib/gestures";

// ── Swipe between steps ───────────────────────────────────────────

/** A swipe this far across the step (of its width), or a flick, moves to the next or the previous step. */
export const STEP_SWIPE_FRACTION = 0.25;

/**
 * Whose drag is it: the step's, when it is mostly sideways — but not from
 * the left edge (the installed app's swipe back, PW-7), not on a field, and
 * not on a row that scrolls sideways.
 */
export function stepSwipeRule(start: DragPoint, target: unknown, surface: ElementLike, styleOf?: StyleOf): Claims | null {
  if (start.x <= EDGE_PX || hasOwnDrags(target)) return null;
  if (scrollersBetween(target, surface, "x", styleOf).length > 0) return null;
  return (dx, dy) => Math.abs(dx) > Math.abs(dy);
}

/** Where a swipe let go `dx` px across (moving `vx` px/ms) on a step `width` px wide goes: 1 the next step (to the left), -1 the one before, 0 nowhere. */
export function stepSwipeGoes(dx: number, width: number, vx: number): 1 | -1 | 0 {
  const distance = Math.abs(dx);
  const speed = Math.sign(vx) === Math.sign(dx) ? Math.abs(vx) : 0;
  if (distance < width * STEP_SWIPE_FRACTION && !isFlick(distance, speed)) return 0;
  return dx < 0 ? 1 : -1;
}

// ── Screen on ─────────────────────────────────────────────────────

/** `on` held; `off` not wanted (or not visible yet); `refused` the browser said no; `unsupported` no Wake Lock here. */
export type ScreenLockState = "off" | "on" | "refused" | "unsupported";

export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
}

export interface ScreenLockEnv {
  /** `navigator.wakeLock`, when the browser has it. */
  wakeLock: { request(type: "screen"): Promise<WakeLockSentinelLike> } | null;
  /** `document.visibilityState === "visible"`. */
  visible(): boolean;
  /** `visibilitychange`; returns how to stop listening. */
  onVisibility(listener: () => void): () => void;
}

export interface ScreenLock {
  /** Hold the lock while the page is visible (true), or let it go (false). */
  want(on: boolean): void;
  state(): ScreenLockState;
  dispose(): void;
}

/** What "Keep the screen on" says when the phone won't. */
export const SCREEN_LOCK_REFUSED = "Your phone won't keep the screen on";

/**
 * The screen lock (design §3.7): taken while it is wanted and the page is
 * visible, and taken again on `visibilitychange` (the browser lets it go
 * whenever the page is hidden). `onState` hears every change.
 */
export function createScreenLock(env: ScreenLockEnv, onState: (state: ScreenLockState) => void = () => undefined): ScreenLock {
  let wanted = false;
  let held: WakeLockSentinelLike | null = null;
  let asking = false;
  let state: ScreenLockState = "off";
  const set = (next: ScreenLockState) => {
    if (next === state) return;
    state = next;
    onState(next);
  };
  const letGo = () => {
    const was = held;
    held = null;
    if (was) void was.release().catch(() => undefined);
  };
  const take = async () => {
    if (!wanted || held || asking || !env.visible()) return;
    if (!env.wakeLock) {
      set("unsupported");
      return;
    }
    asking = true;
    try {
      const got = await env.wakeLock.request("screen");
      asking = false;
      if (!wanted) {
        void got.release().catch(() => undefined);
        return;
      }
      held = got;
      got.addEventListener?.("release", () => {
        if (held === got) held = null;
      });
      set("on");
    } catch {
      asking = false;
      set("refused");
    }
  };
  const stop = env.onVisibility(() => {
    if (env.visible()) void take();
  });
  return {
    want(on) {
      wanted = on;
      if (on) void take();
      else {
        letGo();
        set("off");
      }
    },
    state: () => state,
    dispose() {
      wanted = false;
      stop();
      letGo();
    },
  };
}

/** This page's screen lock environment (call it in an effect: the pages are prerendered). */
export function browserScreenLockEnv(): ScreenLockEnv {
  const nav = (typeof navigator === "undefined" ? null : navigator) as (Navigator & { wakeLock?: ScreenLockEnv["wakeLock"] }) | null;
  return {
    wakeLock: nav?.wakeLock ?? null,
    visible: () => typeof document === "undefined" || document.visibilityState === "visible",
    onVisibility: (listener) => {
      if (typeof document === "undefined") return () => undefined;
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

// ── Read aloud ────────────────────────────────────────────────────

export interface SpeechEnv {
  synth: { cancel(): void; speak(utterance: unknown): void } | null;
  /** `SpeechSynthesisUtterance`. */
  Utterance: (new (text: string) => unknown) | null;
}

/**
 * Read a step aloud (design §3.7): what was being said stops, then each
 * text in turn (the step, then its checkpoint). False where the phone can't.
 */
export function readAloud(texts: readonly string[], env: SpeechEnv = browserSpeech()): boolean {
  const said = texts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (!env.synth || !env.Utterance || said.length === 0) return false;
  try {
    env.synth.cancel();
    for (const text of said) env.synth.speak(new env.Utterance(text));
    return true;
  } catch {
    return false;
  }
}

/** Stop reading (leaving the step). */
export function stopReading(env: SpeechEnv = browserSpeech()): void {
  try {
    env.synth?.cancel();
  } catch {
    // Nothing was being read.
  }
}

export function browserSpeech(): SpeechEnv {
  if (typeof window === "undefined") return { synth: null, Utterance: null };
  const w = window as Window & { SpeechSynthesisUtterance?: new (text: string) => unknown };
  return { synth: w.speechSynthesis ?? null, Utterance: w.SpeechSynthesisUtterance ?? null };
}

// ── The bell ──────────────────────────────────────────────────────

/** The little of Web Audio a beep needs. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: string;
  resume?(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(to: unknown): void;
    start(at?: number): void;
    stop(at?: number): void;
  };
  createGain(): {
    gain: { value: number; setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
    connect(to: unknown): void;
  };
}

export interface BellEnv {
  /** Makes the audio context (once, during a tap: iOS lets a page sound only after one). */
  makeAudio: (() => AudioContextLike | null) | null;
  vibrate: ((pattern: number[]) => boolean) | null;
}

/** Three short beeps, a little apart. */
export const BEEPS: readonly { at: number; hz: number }[] = [
  { at: 0, hz: 880 },
  { at: 0.28, hz: 880 },
  { at: 0.56, hz: 1175 },
];
/** The vibration with it. */
export const VIBRATION: readonly number[] = [200, 100, 200, 100, 300];

let audio: AudioContextLike | null = null;

/**
 * Get the bell ready, during a tap (Start, Count a whistle): iOS plays sound
 * from a page only through an audio context made or resumed in one.
 */
export function primeBell(env: BellEnv = browserBell()): void {
  try {
    audio ??= env.makeAudio?.() ?? null;
    if (audio?.state === "suspended") void audio.resume?.().catch(() => undefined);
  } catch {
    audio = null;
  }
}

/** Ring a timer that ended in the page: the beeps and the vibration, where the phone has them. True when either went. */
export function ringBell(env: BellEnv = browserBell()): boolean {
  let rang = false;
  try {
    if (env.vibrate) rang = env.vibrate([...VIBRATION]) || rang;
  } catch {
    // No vibration here.
  }
  try {
    audio ??= env.makeAudio?.() ?? null;
    const ctx = audio;
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume?.().catch(() => undefined);
      const t0 = ctx.currentTime;
      for (const beep of BEEPS) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = beep.hz;
        gain.gain.setValueAtTime(0.0001, t0 + beep.at);
        gain.gain.exponentialRampToValueAtTime(0.4, t0 + beep.at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + beep.at + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0 + beep.at);
        osc.stop(t0 + beep.at + 0.24);
      }
      rang = true;
    }
  } catch {
    // No sound here.
  }
  return rang;
}

/** Forget the audio context (tests). */
export function resetBell(): void {
  audio = null;
}

export function browserBell(): BellEnv {
  if (typeof window === "undefined") return { makeAudio: null, vibrate: null };
  const w = window as Window & { webkitAudioContext?: new () => AudioContextLike; AudioContext?: new () => AudioContextLike };
  const Ctor = w.AudioContext ?? w.webkitAudioContext ?? null;
  const nav = typeof navigator === "undefined" ? null : navigator;
  return {
    makeAudio: Ctor ? () => new Ctor() : null,
    vibrate: nav && typeof nav.vibrate === "function" ? (pattern) => nav.vibrate(pattern) : null,
  };
}
