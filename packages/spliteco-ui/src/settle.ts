// Settle up (SE2; shared by both apps since SE3), as the apps work it out: the
// UPI deep link, what each person can be paid, "All" or "Part of it", how a
// payment splits across a kitchen group's two balances, the reminder's words,
// and the steps of the Settle up screen. A payment is recorded only on the
// payer's own confirm ("I paid"): opening a UPI app records nothing.

import { isUpiVpa, type SplitecoSettlePlanResponse } from "@saas/contracts/spliteco";
import { formatMoney, formatShort } from "./money.js";

// ── The UPI link ──────────────────────────────────────────

/** Minor units as UPI's `am`: "620.00". */
export function upiAmount(minor: number): string {
  const abs = Math.abs(Math.trunc(minor));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** UPI's `tn` and `pn` are short, plain text: one line, at most `max` characters. */
function plain(text: string, max: number): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>` — opens the
 * person's UPI app with the payee, the amount and a note filled in. Null when
 * the payee has no valid UPI ID, the amount is not above zero, or the group
 * does not count in rupees (UPI pays INR only).
 */
export function upiLink(input: { vpa: string | null | undefined; name: string; amountMinor: number; note: string; currency?: string }): string | null {
  if (!isUpiVpa(input.vpa) || !(input.amountMinor > 0) || (input.currency ?? "INR") !== "INR") return null;
  const q = [
    `pa=${encodeURIComponent(input.vpa)}`,
    `pn=${encodeURIComponent(plain(input.name, 50) || "Spliteco")}`,
    `am=${upiAmount(input.amountMinor)}`,
    "cu=INR",
    `tn=${encodeURIComponent(plain(input.note, 50) || "Spliteco")}`,
  ];
  return `upi://pay?${q.join("&")}`;
}

/** Why UPI is off for this payment, or null when it can be used. */
export function upiUnavailable(input: { vpa: string | null | undefined; name: string; currency: string }): string | null {
  if (input.currency !== "INR") return "UPI pays in rupees only";
  if (!isUpiVpa(input.vpa)) return `${input.name} hasn't added a UPI ID yet — ask them to add one under You`;
  return null;
}

// ── Who can be paid, and how much ─────────────────────────

export interface PayOption {
  toSubjectId: string;
  owed: { kitchen: number; other: number };
  totalMinor: number;
}

/** Everyone the caller owes in a group's plan, largest first. */
export function payOptions(plan: Pick<SplitecoSettlePlanResponse, "mine">): PayOption[] {
  return plan.mine
    .map((m) => ({ toSubjectId: m.toSubjectId, owed: m.owed, totalMinor: Math.max(0, m.owed.kitchen) + Math.max(0, m.owed.other) }))
    .filter((o) => o.totalMinor > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

export type AmountCheck = { ok: true; amountMinor: number } | { ok: false; message: string };

/** "All" pays everything owed; "Part of it" must be above zero and no more than that. */
export function checkAmount(mode: "all" | "part", partMinor: number | null, owedMinor: number, currency: string): AmountCheck {
  if (mode === "all") return owedMinor > 0 ? { ok: true, amountMinor: owedMinor } : { ok: false, message: "Nothing to pay" };
  if (partMinor === null || partMinor <= 0) return { ok: false, message: "Type an amount" };
  if (partMinor > owedMinor) return { ok: false, message: `That's more than you owe (${formatMoney(owedMinor, currency)})` };
  return { ok: true, amountMinor: partMinor };
}

/** How a payment fills a kitchen group's balances unless the payer changes it: Kitchen first, then Other. */
export function kitchenFirst(amountMinor: number, owed: { kitchen: number; other: number }): { kitchen: number; other: number } {
  const kitchen = Math.min(amountMinor, Math.max(0, owed.kitchen));
  return { kitchen, other: amountMinor - kitchen };
}

// ── The screen's steps ────────────────────────────────────

export type PayMethod = "upi" | "cash" | "bank";

export interface SettleState {
  method: PayMethod;
  /** pick: choosing; confirm: back from the UPI app, asking whether it went through; saving; done. */
  step: "pick" | "confirm" | "saving" | "done";
  error: string | null;
}

export type SettleEvent =
  | { type: "pick"; method: PayMethod }
  /** The main button: UPI opens the app (no record), cash and bank record at once. */
  | { type: "go" }
  /** Back from the UPI app: "I paid ₹X". */
  | { type: "paid" }
  /** Back from the UPI app: "It didn't". */
  | { type: "didnt" }
  | { type: "saved" }
  | { type: "failed"; message: string };

export const initialSettle = (method: PayMethod = "upi"): SettleState => ({ method, step: "pick", error: null });

/** What the app does next: open the UPI link, record the payment, or nothing. */
export type SettleEffect = "open_upi" | "record" | null;

export function settleStep(state: SettleState, event: SettleEvent): { state: SettleState; effect: SettleEffect } {
  switch (event.type) {
    case "pick":
      if (state.step === "saving" || state.step === "done") return { state, effect: null };
      return { state: { method: event.method, step: "pick", error: null }, effect: null };
    case "go":
      if (state.step !== "pick") return { state, effect: null };
      if (state.method === "upi") return { state: { ...state, step: "confirm", error: null }, effect: "open_upi" };
      return { state: { ...state, step: "saving", error: null }, effect: "record" };
    case "paid":
      if (state.step !== "confirm") return { state, effect: null };
      return { state: { ...state, step: "saving", error: null }, effect: "record" };
    case "didnt":
      if (state.step !== "confirm") return { state, effect: null };
      return { state: { ...state, step: "pick", error: null }, effect: null };
    case "saved":
      return { state: { ...state, step: "done", error: null }, effect: null };
    case "failed":
      // Back to where the payer pressed: confirm for UPI (they did pay), pick otherwise.
      return { state: { ...state, step: state.method === "upi" ? "confirm" : "pick", error: event.message }, effect: null };
  }
}

/** The main button's words. */
export function ctaText(method: PayMethod, amountMinor: number, payee: string, currency: string): string {
  const amount = formatShort(amountMinor, currency);
  return method === "upi" ? `Open UPI app · ${amount}` : `Record ${amount} paid to ${payee}`;
}

// ── Reminders ─────────────────────────────────────────────

export const REMINDER_HOURS = 24;
const HOUR = 60 * 60 * 1000;

/** The words the person reminded gets, as the preview shows them. */
export function reminderPreview(input: { toName: string; amountMinor: number; currency: string; groupName: string | null }): string {
  const where = input.groupName ? ` for ${input.groupName}` : "";
  return `Hi ${input.toName} — a friendly nudge: ${formatShort(input.amountMinor, input.currency)}${where}. One tap to pay by UPI, cash or bank. No rush.`;
}

/** Can the caller remind them now (one per person per 24 hours)? */
export function canRemind(lastSentAt: string | null, now: Date): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - new Date(lastSentAt).getTime() >= REMINDER_HOURS * HOUR;
}

function ago(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "Last reminded 2 days ago · next nudge allowed now", "Last reminded 3 h ago · next nudge in 21 h", or "Not reminded yet". */
export function lastRemindedText(lastSentAt: string | null, now: Date): string {
  if (!lastSentAt) return "Not reminded yet";
  const since = now.getTime() - new Date(lastSentAt).getTime();
  const left = REMINDER_HOURS * HOUR - since;
  if (left <= 0) return `Last reminded ${ago(since)} · next nudge allowed now`;
  const h = Math.ceil(left / HOUR);
  return `Last reminded ${ago(since)} · next nudge in ${h} h`;
}
