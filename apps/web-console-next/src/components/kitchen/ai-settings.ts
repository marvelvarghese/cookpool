/**
 * You → Cookpool AI (cookpool-ai AI-7, design §7, the canvas's AiSettings),
 * the pure half: the page's state, the switches this device keeps (AI-8's
 * `lib/ai-switches.ts`), today's use against the limits as bars, the
 * month's budget and what is sent. Dependency-free but for the contracts'
 * types, so it is unit-testable.
 */

import type { AiStatus } from "@saas/contracts/kitchen";
import { AI_DAILY_ACTIONS, AI_DAILY_RECEIPTS, AI_DAILY_VOICE_SECONDS } from "@saas/contracts/kitchen";
import type { AiSwitchKey } from "@/lib/ai-switches";

export const AI_SETTINGS_HREF = "/you/ai";
/** The page's title and You's row (RV-18: one name for both; You's group is "Cookpool AI"). */
export const AI_SETTINGS_TITLE = "AI settings";
export const AI_SETTINGS_HEADING = "Help from AI";
export const AI_SETTINGS_LEAD = "Every AI answer is a suggestion. Nothing is saved until you tap.";

export interface AiSwitchRow {
  key: AiSwitchKey;
  label: string;
  sub: string;
}

/**
 * Every switch, in the page's order. Say what you used and Scan receipts
 * are always listed; the others only once the server offers them
 * (`features`), so a switch never stands for something that isn't there.
 */
export const AI_SWITCH_ROWS: readonly (AiSwitchRow & { always: boolean })[] = [
  { key: "sayIt", label: "Say what you used", sub: "Type a sentence to log", always: true },
  { key: "receipt", label: "Scan receipts", sub: "Fill a shopping run from a photo", always: true },
  { key: "import", label: "Recipe from a photo", sub: "Turn a photo into a recipe to check", always: false },
  { key: "voice", label: "Voice while cooking", sub: "Listens briefly after each step", always: false },
  { key: "swaps", label: "Swaps", sub: "Ideas for what you're missing", always: false },
];

export type AiPageState = "loading" | "failed" | "unset" | "resting" | "ready";

export interface UseBar {
  label: string;
  /** "9 of 50". */
  text: string;
  /** 0–100, the bar's fill. */
  pct: number;
  /** At or over the limit: the bar turns amber. */
  full: boolean;
}

export interface AiSettingsView {
  state: AiPageState;
  /** One line when AI is off: "AI isn't set up yet", "Cookpool AI is resting until the 1st". */
  notice: string | null;
  switches: (AiSwitchRow & { on: boolean })[];
  today: UseBar[];
  /** "This month's AI budget · OK" or "… · resting until the 1st". */
  budget: string | null;
  sent: readonly string[];
}

/** What is sent (design §1, §2's first-name exception, AI-2's receipts and AI-4's photos). */
export const AI_SENT_LINES: readonly string[] = [
  "Item names, amounts and the sentence you typed.",
  "First names of people in your groups, to read “Anu and I”.",
  "Never: money, balances, group names or full names.",
  "Receipt and recipe photos and voice clips are read, then deleted.",
];

function bar(label: string, used: number, limit: number): UseBar {
  const safeLimit = limit > 0 ? limit : 1;
  const pct = Math.max(0, Math.min(100, Math.round((used / safeLimit) * 100)));
  return { label, text: `${used} of ${limit}`, pct, full: used >= limit };
}

/** Voice seconds as minutes started: 10 s is 1 minute of the 30. */
export function voiceMinutes(seconds: number): number {
  return Math.ceil(Math.max(0, seconds) / 60);
}

/** Today's use against the limits: AI actions, receipts and voice minutes (the last only once voice is offered). */
export function todayBars(status: AiStatus): UseBar[] {
  const t = status.today;
  const bars = [bar("AI actions", t.actions, t.actionsLimit || AI_DAILY_ACTIONS)];
  if (t.receipts !== undefined || t.receiptsLimit !== undefined) bars.push(bar("Receipts", t.receipts ?? 0, t.receiptsLimit ?? AI_DAILY_RECEIPTS));
  if (status.features.voice || t.voiceSeconds > 0) bars.push(bar("Voice minutes", voiceMinutes(t.voiceSeconds), voiceMinutes(t.voiceSecondsLimit || AI_DAILY_VOICE_SECONDS)));
  return bars;
}

/**
 * The page from the status read and this device's switches. While AI isn't
 * available it says why — no key ("AI isn't set up yet"), or the month's
 * budget spent ("resting until the 1st") — and the switches still show, as
 * they are this device's.
 */
export function aiSettingsView(
  status: AiStatus | null | undefined,
  o: { loading: boolean; switchOn: (key: AiSwitchKey) => boolean },
): AiSettingsView {
  const state: AiPageState = status ? (status.budget === "reached" ? "resting" : status.available ? "ready" : "unset") : o.loading ? "loading" : "failed";
  const switches = AI_SWITCH_ROWS.filter((r) => r.always || status?.features[r.key] === true).map(({ key, label, sub }) => ({ key, label, sub, on: o.switchOn(key) }));
  const notice = state === "unset" ? "AI isn't set up yet" : state === "resting" ? "Cookpool AI is resting until the 1st" : null;
  const budget = !status || status.budget === undefined ? null : `This month's AI budget · ${status.budget === "reached" ? "resting until the 1st" : "OK"}`;
  return { state, notice, switches, today: status ? todayBars(status) : [], budget, sent: AI_SENT_LINES };
}
