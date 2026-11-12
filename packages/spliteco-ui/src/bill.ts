// Add a bill (cookpool-spliteco SE3): the simple form both apps can draw —
// what it was, how much, who paid, split equally between the people ticked —
// checked here and turned into spliteco-worker's expense request. The maths
// (equal split, largest-remainder rounding) is the engine's, on the server.

import type { SplitecoExpenseRequest } from "@saas/contracts/spliteco";
import { parseMoney } from "./money.js";

export interface BillDraft {
  title: string;
  /** As typed: "860", "1,234.50". */
  amount: string;
  payerId: string;
  /** Who shares it equally. */
  between: string[];
}

export type BillErrors = Partial<Record<"title" | "amount" | "payer" | "between", string>>;

export type BillCheck = { ok: true; request: SplitecoExpenseRequest } | { ok: false; errors: BillErrors };

/** The title Spliteco keeps (SPLITECO_LIMITS.title is 120). */
export const BILL_TITLE_MAX = 120;

/** A fresh draft: the caller pays, everyone in the group shares. */
export function newBill(me: string, memberIds: readonly string[]): BillDraft {
  return { title: "", amount: "", payerId: me, between: [...memberIds] };
}

/** Tick or untick someone in "Split between". */
export function toggleBetween(draft: BillDraft, subjectId: string): BillDraft {
  const on = draft.between.includes(subjectId);
  return { ...draft, between: on ? draft.between.filter((id) => id !== subjectId) : [...draft.between, subjectId] };
}

/**
 * The request a valid draft saves: an equal split, paid in full by one
 * person, in the group's currency. `bucket` is `kitchen` for a bill added in
 * Cookpool (it counts toward the Kitchen balance there and in Spliteco).
 */
export function billRequest(draft: BillDraft, memberIds: readonly string[], opts: { bucket?: "kitchen" | null } = {}): BillCheck {
  const errors: BillErrors = {};
  const title = draft.title.trim().replace(/\s+/g, " ");
  if (!title) errors.title = "Say what it was";
  else if (title.length > BILL_TITLE_MAX) errors.title = `At most ${BILL_TITLE_MAX} characters`;
  const totalMinor = parseMoney(draft.amount);
  if (totalMinor === null || totalMinor <= 0) errors.amount = "Type the amount";
  const members = new Set(memberIds);
  if (!members.has(draft.payerId)) errors.payer = "Pick who paid";
  const between = [...new Set(draft.between)].filter((id) => members.has(id));
  if (between.length === 0) errors.between = "Pick at least one person";
  if (Object.keys(errors).length > 0 || totalMinor === null) return { ok: false, errors };
  return {
    ok: true,
    request: {
      title,
      totalMinor,
      payers: [{ subjectId: draft.payerId, amountMinor: totalMinor }],
      split: { method: "equal", participants: memberIds.filter((id) => between.includes(id)) },
      ...(opts.bucket ? { bucket: opts.bucket } : {}),
    },
  };
}

/** "₹286.67 each" under the form, as an even split of the typed amount (the server rounds the leftover paise). */
export function eachText(draft: Pick<BillDraft, "amount" | "between">, currency: string, money: (minor: number, currency: string) => string): string | null {
  const total = parseMoney(draft.amount);
  const n = new Set(draft.between).size;
  if (total === null || total <= 0 || n === 0) return null;
  if (n === 1) return `${money(total, currency)} for one`;
  return `${money(Math.floor(total / n), currency)} each`;
}
