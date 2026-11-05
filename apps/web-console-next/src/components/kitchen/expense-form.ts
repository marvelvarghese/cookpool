/**
 * The Add expense form (Cookpool CP-8) as a pure model: the form's state, the
 * live per-person preview, the validation messages and the request it posts.
 *
 * Every amount is minor units. Each person's share comes from
 * `@saas/kitchen-engine` — the functions kitchen-worker splits the posted
 * expense with — over the same participants in the same order, so the preview
 * rounds exactly as the server will (largest remainder, ties to the earlier
 * person). Dependency-free apart from the engine and contract types, so it is
 * unit-testable.
 */

import type { CreateExpenseRequest, SplitMode } from "@saas/contracts/kitchen";
import { splitBy } from "@saas/kitchen-engine/money";
import { formatMinor, formatPercentHundredths, moneyInputMessage, parseMoney, parsePercentHundredths } from "./money";
import { faceOrder, whoLine } from "./faces";
import type { MemberNames } from "./members";

export const EXPENSE_TITLE_MAX = 200;
/** Shares per person on the − / + steppers. */
export const MAX_SHARES = 99;

export const SPLIT_MODE_OPTIONS: readonly { id: SplitMode; label: string; name: string }[] = [
  { id: "equal", label: "Equally", name: "Split equally" },
  { id: "exact", label: "Exact", name: "Exact amounts" },
  { id: "percent", label: "%", name: "By percentage" },
  { id: "shares", label: "Shares", name: "By shares" },
];

export interface ExpenseForm {
  title: string;
  /** The total as typed (rupees, decimal). */
  amount: string;
  /** False: one payer (`payerId`) paid it all. True: `payerAmounts`. */
  severalPayers: boolean;
  payerId: string | null;
  payerAmounts: Readonly<Record<string, string>>;
  mode: SplitMode;
  /** Equally: who shares it. */
  included: Readonly<Record<string, boolean>>;
  /** Exact: each person's amount as typed. */
  exact: Readonly<Record<string, string>>;
  /** %: each person's percentage as typed. */
  percent: Readonly<Record<string, string>>;
  /** Shares: each person's whole number of shares. */
  shares: Readonly<Record<string, number>>;
}

/** A new form: you paid, split equally between everyone, one share each. */
export function initialExpenseForm(memberIds: readonly string[], meId: string | null): ExpenseForm {
  const payerId = meId && memberIds.includes(meId) ? meId : (memberIds[0] ?? null);
  return {
    title: "",
    amount: "",
    severalPayers: false,
    payerId,
    payerAmounts: {},
    mode: "equal",
    included: Object.fromEntries(memberIds.map((id) => [id, true])),
    exact: {},
    percent: {},
    shares: Object.fromEntries(memberIds.map((id) => [id, 1])),
  };
}

/** The − / + steppers: shares stay within 0–99. */
export function stepShares(form: ExpenseForm, subjectId: string, delta: number): ExpenseForm {
  const current = form.shares[subjectId] ?? 0;
  const next = Math.min(MAX_SHARES, Math.max(0, current + delta));
  return { ...form, shares: { ...form.shares, [subjectId]: next } };
}

/** Everyone in, or (when everyone already is) everyone out. */
export function toggleEveryone(form: ExpenseForm, memberIds: readonly string[]): ExpenseForm {
  const all = memberIds.every((id) => form.included[id]);
  return { ...form, included: Object.fromEntries(memberIds.map((id) => [id, !all])) };
}

export type ExpenseField = "title" | "amount" | "payers" | "split";

export interface ExpenseCheck {
  /** What is accounted for so far. */
  assignedMinor: number;
  totalMinor: number;
  ok: boolean;
  /** "₹1,150.00 of ₹1,200.00 assigned". */
  text: string;
}

export interface PersonShare {
  subjectId: string;
  /** In the split (included, or a non-zero amount, percentage or share). */
  inSplit: boolean;
  /** What they owe, live; null while it can't be known (no total yet). */
  owedMinor: number | null;
  /** A problem with this person's input (an amount or percentage that isn't one). */
  error: string | null;
}

export interface ExpensePreview {
  totalMinor: number | null;
  people: PersonShare[];
  /** Paid by several: what each paid, and whether it adds up. */
  payerErrors: Readonly<Record<string, string>>;
  paid: ExpenseCheck | null;
  /** The split's check line; null until there is a total. */
  split: ExpenseCheck | null;
  /** The percentages so far (% mode), "90%". */
  percentText: string | null;
  errors: Partial<Record<ExpenseField, string>>;
  /** The body to post; null while anything is wrong. */
  request: CreateExpenseRequest | null;
}

function check(assignedMinor: number, totalMinor: number, ok: boolean, currency: string, verb: string): ExpenseCheck {
  return {
    assignedMinor,
    totalMinor,
    ok,
    text: `${formatMinor(assignedMinor, currency)} of ${formatMinor(totalMinor, currency)} ${verb}`,
  };
}

function gap(assigned: number, total: number, currency: string): string {
  return assigned < total
    ? `${formatMinor(total - assigned, currency)} still to assign`
    : `${formatMinor(assigned - total, currency)} more than the total`;
}

/**
 * Everything the form shows and posts, from its state. `memberIds` is the
 * group's people in display order; it is also the order participants and
 * payers are sent in, which the server's rounding follows.
 */
export function previewExpense(form: ExpenseForm, memberIds: readonly string[], currency = "INR"): ExpensePreview {
  const errors: Partial<Record<ExpenseField, string>> = {};

  // What for.
  const title = form.title.trim();
  if (!title) errors.title = "Say what it was for";
  else if (title.length > EXPENSE_TITLE_MAX) errors.title = `Keep it under ${EXPENSE_TITLE_MAX} characters`;

  // How much.
  const parsedTotal = parseMoney(form.amount);
  let totalMinor: number | null = null;
  if (!parsedTotal.ok) errors.amount = moneyInputMessage(parsedTotal)!;
  else if (parsedTotal.minor === 0) errors.amount = "The amount must be more than zero";
  else totalMinor = parsedTotal.minor;

  // Who paid.
  const payerErrors: Record<string, string> = {};
  let payers: { subjectId: string; amountMinor: number }[] = [];
  let paid: ExpenseCheck | null = null;
  if (!form.severalPayers) {
    if (!form.payerId || !memberIds.includes(form.payerId)) errors.payers = "Pick who paid";
    else if (totalMinor !== null) payers = [{ subjectId: form.payerId, amountMinor: totalMinor }];
  } else {
    let sum = 0;
    for (const id of memberIds) {
      const raw = form.payerAmounts[id] ?? "";
      if (raw.trim() === "") continue;
      const r = parseMoney(raw);
      if (!r.ok) {
        payerErrors[id] = moneyInputMessage(r)!;
        continue;
      }
      sum += r.minor;
      if (r.minor > 0) payers.push({ subjectId: id, amountMinor: r.minor });
    }
    const inputsOk = Object.keys(payerErrors).length === 0;
    if (totalMinor !== null) {
      const ok = inputsOk && payers.length > 0 && sum === totalMinor;
      paid = check(sum, totalMinor, ok, currency, "paid");
      if (!inputsOk) errors.payers = "Check the amounts paid";
      else if (payers.length === 0) errors.payers = "Enter what each person paid";
      else if (!ok) errors.payers = `What people paid must add up to the total: ${gap(sum, totalMinor, currency)}`;
    } else if (!inputsOk) {
      errors.payers = "Check the amounts paid";
    }
  }

  // How it is split.
  const people: PersonShare[] = memberIds.map((subjectId) => ({ subjectId, inSplit: false, owedMinor: null, error: null }));
  const at = new Map(people.map((p, i) => [p.subjectId, i] as const));
  let participants: { subjectId: string; value?: number }[] = [];
  let split: ExpenseCheck | null = null;
  let percentText: string | null = null;

  /** Fill in the engine's shares for the participants, in order. */
  const applyEngine = (values: number[]): number[] => {
    const owed = splitBy(form.mode, totalMinor!, values);
    participants.forEach((p, i) => {
      people[at.get(p.subjectId)!]!.owedMinor = owed[i]!;
    });
    return owed;
  };

  switch (form.mode) {
    case "equal": {
      participants = memberIds.filter((id) => form.included[id]).map((subjectId) => ({ subjectId }));
      for (const p of participants) people[at.get(p.subjectId)!]!.inSplit = true;
      for (const person of people) if (!person.inSplit) person.owedMinor = 0;
      if (participants.length === 0) errors.split = "Pick at least one person to share it";
      if (totalMinor !== null) {
        if (participants.length > 0) applyEngine(participants.map(() => 1));
        const ok = participants.length > 0;
        split = check(ok ? totalMinor : 0, totalMinor, ok, currency, "assigned");
      }
      break;
    }

    case "exact": {
      let sum = 0;
      let inputsOk = true;
      for (const person of people) {
        const raw = form.exact[person.subjectId] ?? "";
        if (raw.trim() === "") {
          person.owedMinor = 0;
          continue;
        }
        const r = parseMoney(raw);
        if (!r.ok) {
          person.error = moneyInputMessage(r);
          inputsOk = false;
          continue;
        }
        person.owedMinor = r.minor;
        sum += r.minor;
        if (r.minor > 0) {
          person.inSplit = true;
          participants.push({ subjectId: person.subjectId, value: r.minor });
        }
      }
      if (!inputsOk) errors.split = "Check the amounts";
      else if (participants.length === 0) errors.split = "Enter what each person owes";
      if (totalMinor !== null) {
        const ok = inputsOk && participants.length > 0 && sum === totalMinor;
        split = check(sum, totalMinor, ok, currency, "assigned");
        if (inputsOk && participants.length > 0 && !ok) {
          errors.split = `The amounts must add up to the total: ${gap(sum, totalMinor, currency)}`;
        }
      }
      break;
    }

    case "percent": {
      let sumHundredths = 0;
      let inputsOk = true;
      const hundredths: number[] = [];
      for (const person of people) {
        const raw = form.percent[person.subjectId] ?? "";
        if (raw.trim() === "") {
          person.owedMinor = totalMinor === null ? null : 0;
          continue;
        }
        const h = parsePercentHundredths(raw);
        if (h === null) {
          person.error = "Enter a percentage like 25 or 33.33";
          inputsOk = false;
          continue;
        }
        sumHundredths += h;
        if (h > 0) {
          person.inSplit = true;
          participants.push({ subjectId: person.subjectId, value: h / 100 });
          hundredths.push(h);
        } else {
          person.owedMinor = totalMinor === null ? null : 0;
        }
      }
      percentText = formatPercentHundredths(sumHundredths);
      const adds = sumHundredths === 10_000;
      if (!inputsOk) errors.split = "Check the percentages";
      else if (participants.length === 0) errors.split = "Enter each person's percentage";
      else if (!adds) errors.split = `The percentages must add up to 100% (now ${percentText})`;
      if (totalMinor !== null) {
        if (inputsOk && adds) {
          applyEngine(participants.map((p) => p.value!));
          split = check(totalMinor, totalMinor, true, currency, "assigned");
        } else {
          // Not 100% yet: show each person's part of the total, rounded down,
          // so the check line says how much is still unassigned.
          let assigned = 0;
          participants.forEach((p, i) => {
            const owed = Math.floor((totalMinor! * hundredths[i]!) / 10_000);
            people[at.get(p.subjectId)!]!.owedMinor = owed;
            assigned += owed;
          });
          split = check(assigned, totalMinor, false, currency, "assigned");
        }
      }
      break;
    }

    case "shares": {
      for (const person of people) {
        const n = form.shares[person.subjectId] ?? 0;
        if (n > 0) {
          person.inSplit = true;
          participants.push({ subjectId: person.subjectId, value: n });
        } else {
          person.owedMinor = 0;
        }
      }
      if (participants.length === 0) errors.split = "Give at least one person a share";
      if (totalMinor !== null) {
        if (participants.length > 0) applyEngine(participants.map((p) => p.value!));
        const ok = participants.length > 0;
        split = check(ok ? totalMinor : 0, totalMinor, ok, currency, "assigned");
      }
      break;
    }
  }

  const valid = Object.keys(errors).length === 0 && totalMinor !== null && payers.length > 0;
  const request: CreateExpenseRequest | null = valid
    ? {
        title,
        totalMinor: totalMinor!,
        currency,
        payers,
        mode: form.mode,
        participants,
      }
    : null;

  return { totalMinor, people, payerErrors, paid, split, percentText, errors, request };
}

/** The first problem to point at when Save is pressed, in the form's order. */
export function firstExpenseError(errors: Partial<Record<ExpenseField, string>>): ExpenseField | null {
  for (const f of ["title", "amount", "payers", "split"] as const) if (errors[f]) return f;
  return null;
}

/**
 * The main button (SM-7): what it adds — "Add · ₹1,200.00", or "Add expense"
 * before there is an amount — and who it is for, you first: "You + Anu ·
 * ₹600.00 each" split equally, "You + Anu + Dev" any other way.
 */
export function expenseButton(input: {
  preview: Pick<ExpensePreview, "totalMinor" | "people">;
  mode: SplitMode;
  meId: string | null;
  names?: MemberNames | null;
  currency: string;
}): { title: string; who: string | null } {
  const { preview, currency } = input;
  const title = preview.totalMinor === null ? "Add expense" : `Add · ${formatMinor(preview.totalMinor, currency)}`;
  const inSplit = preview.people.filter((p) => p.inSplit);
  const ids = faceOrder(
    inSplit.map((p) => p.subjectId),
    input.meId,
    input.names,
  );
  const amounts = input.mode === "equal" && preview.totalMinor !== null ? inSplit.map((p) => p.owedMinor ?? 0) : null;
  return { title, who: whoLine({ ids, meId: input.meId, names: input.names, amounts, currency }) };
}

/** The toast's second line once it is added: "₹1,200.00, split equally.", "₹1,200.00, by shares." */
export function expenseAddedText(request: Pick<CreateExpenseRequest, "totalMinor" | "mode">, currency: string): string {
  const how = SPLIT_MODE_OPTIONS.find((m) => m.id === request.mode)?.name.toLowerCase() ?? request.mode;
  return `${formatMinor(request.totalMinor, currency)}, ${how}.`;
}
