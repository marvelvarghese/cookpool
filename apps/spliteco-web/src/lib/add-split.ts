// Add, keypad first (spliteco-calm design §4): what each person's row shows,
// the footer that says whether the split adds up, what the one keypad types
// into, and what Save says. Pure — the screen keeps an `ExpenseForm` and a
// `Selected`, and every tap goes through here. The maths stays `split-form.ts`
// and @saas/kitchen-engine: the keypad only writes the same text fields the
// old per-row inputs did, so Save sends the very same request.

import type { SplitecoSplitMethod } from "@saas/contracts/spliteco";
import { owedBySplit, type SplitProblem } from "@saas/kitchen-engine/splits";
import { formatShort, parseMoney } from "./money";
import { nameOf, type Names } from "./people";
import { problemText } from "./problems";
import { emptyItem, parsePct, splitInput, switchFromItems, toSpec, totalOf, type BuildOutcome, type ExpenseForm, type FormProblem } from "./split-form";
import { itemHasProblem } from "./carousel";

/** The six pills of the method strip, in order. */
export const METHODS: readonly SplitecoSplitMethod[] = ["equal", "exact", "pct", "shares", "adjust", "items"];

export const METHOD_PILLS: Record<SplitecoSplitMethod, string> = {
  equal: "Equally",
  exact: "Exact ₹",
  pct: "Percent",
  shares: "Shares",
  adjust: "+ / −",
  items: "Itemized",
};

/** The one line under the strip. */
export const METHOD_LINES: Record<SplitecoSplitMethod, string> = {
  equal: "Tap ✓ to leave someone out",
  exact: "Type what each person pays",
  pct: "Type each person’s %",
  shares: "More shares, bigger part · hold − + to repeat",
  adjust: "Equal split, then + or − per person",
  items: "Who had what, item by item",
};

// ── Selection: what the keypad types into ────────────────────────

export type Selected = { kind: "amount" } | { kind: "person"; id: string };
export const AMOUNT: Selected = { kind: "amount" };

type FieldKey = "exact" | "pct" | "adjust";

/** The per-person text field a method has, if any. */
export function fieldOf(method: SplitecoSplitMethod): FieldKey | null {
  return method === "exact" || method === "pct" || method === "adjust" ? method : null;
}

/** Choosing Exact, Percent or + / − selects the first person; the rest keep the amount. */
export function selectionFor(method: SplitecoSplitMethod, members: readonly string[]): Selected {
  const first = members[0];
  return fieldOf(method) && first ? { kind: "person", id: first } : AMOUNT;
}

export function isSelected(sel: Selected, id: string | "amount"): boolean {
  return id === "amount" ? sel.kind === "amount" : sel.kind === "person" && sel.id === id;
}

/** Choosing a method: Itemized starts from the amount and title; leaving it keeps the items, unused. */
export function chooseMethod(form: ExpenseForm, method: SplitecoSplitMethod): ExpenseForm {
  if (method === form.method) return form;
  if (method === "items") {
    return { ...form, method, items: form.items.length ? form.items : [{ ...emptyItem(), name: form.title, totalText: form.amountText }] };
  }
  if (form.method === "items") return switchFromItems(form, method, false);
  return { ...form, method };
}

/** Where a swipe on the strip lands: one pill per PILL_STEP px, or one on a flick. */
export const PILL_STEP = 112;
export function stripRelease(index: number, dx: number, vx: number, count = METHODS.length): number {
  let steps = Math.round(-dx / PILL_STEP);
  if (steps === 0 && Math.abs(vx) > 0.5 && Math.abs(dx) >= 24) steps = vx < 0 ? 1 : -1;
  return Math.max(0, Math.min(count - 1, index + steps));
}

// ── The keypad ───────────────────────────────────────────────────

export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "±" | "del";
export interface KeyCap {
  key: Key;
  label: string;
  aria: string;
}

/** Is the keypad typing into anything? (Itemized has no keypad; a tick or a stepper takes no digits.) */
export function keypadLive(form: ExpenseForm, sel: Selected): boolean {
  if (form.method === "items") return false;
  return sel.kind === "amount" || fieldOf(form.method) !== null;
}

/** 1–9, then "." (or "±" when a + / − field is selected), 0, ⌫. */
export function keypadKeys(form: ExpenseForm, sel: Selected): KeyCap[] {
  const signed = sel.kind === "person" && form.method === "adjust";
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
  return [
    ...digits.map((d) => ({ key: d, label: d, aria: d })),
    signed ? { key: "±" as const, label: "±", aria: "Switch plus or minus" } : { key: "." as const, label: ".", aria: "Point" },
    { key: "0", label: "0", aria: "0" },
    { key: "del", label: "⌫", aria: "Delete" },
  ];
}

/** A key from the hardware keyboard, or null when it is not one of the keypad's. */
export function keyFromKeyboard(key: string): Key | null {
  if (/^[0-9]$/.test(key)) return key as Key;
  if (key === "." || key === ",") return ".";
  if (key === "Backspace" || key === "Delete") return "del";
  if (key === "-" || key === "+" || key === "−") return "±";
  return null;
}

type TextKind = "money" | "pct" | "signed";
const INT_DIGITS: Record<TextKind, number> = { money: 7, pct: 3, signed: 7 };

/**
 * One key on one text: digits append (a lone 0 is replaced), "." once,
 * never a third decimal, ⌫ takes the last character off; on a signed field
 * "±" flips the sign and typing a digit with no sign makes it "+". Returns
 * the text unchanged when the key does nothing there.
 */
export function typeInto(text: string, key: Key, kind: TextKind): string {
  const lead = text.charAt(0);
  let sign = kind === "signed" && (lead === "-" || lead === "+") ? lead : "";
  let body = sign ? text.slice(1) : text;
  if (key === "±") {
    if (kind !== "signed") return text;
    sign = sign === "-" ? "+" : "-";
    return body === "" ? (sign === "-" ? "-" : "") : sign + body;
  }
  if (key === "del") {
    body = body.slice(0, -1);
    return body === "" ? "" : sign + body;
  }
  if (key === ".") {
    if (body.includes(".")) return text;
    body = (body || "0") + ".";
  } else {
    const [int, dec] = body.split(".");
    if (dec !== undefined && dec.length >= 2) return text;
    if (dec === undefined && (int ?? "").replace(/^0$/, "").length >= INT_DIGITS[kind]) return text;
    body = (body === "0" ? "" : body) + key;
  }
  if (kind === "signed" && !sign) sign = "+";
  return sign + body;
}

/** The keypad pressed: into the amount, or into the selected person's field. */
export function pressKey(form: ExpenseForm, sel: Selected, key: Key): ExpenseForm {
  if (!keypadLive(form, sel)) return form;
  if (sel.kind === "amount") {
    const next = typeInto(form.amountText, key, "money");
    return next === form.amountText ? form : { ...form, amountText: next };
  }
  const field = fieldOf(form.method)!;
  const cur = form[field][sel.id] ?? "";
  const next = typeInto(cur, key, field === "pct" ? "pct" : field === "adjust" ? "signed" : "money");
  return next === cur ? form : { ...form, [field]: { ...form[field], [sel.id]: next } };
}

// ── What is shown ────────────────────────────────────────────────

function digitsOf(text: string, currency: string): string {
  const [int = "", dec] = text.split(".");
  const whole = formatShort(Number(int || "0") * 100, currency).replace(/^[^\d]+/, "");
  return dec === undefined ? whole : `${whole}.${dec}`;
}

/** The big amount as typed: "2,400", "2,400.5", "0" when empty. */
export function amountShown(text: string, currency = "INR"): string {
  return text === "" ? "0" : digitsOf(text, currency);
}

/** "25.5" basis-point-free: 2550 → "25.5", 10000 → "100". */
export function pctText(bp: number): string {
  return String(Math.round(bp) / 100);
}

export interface Row {
  id: string;
  name: string;
  control: "tick" | "field" | "step";
  /** Equally: in or out. */
  on: boolean;
  /** Shares: how many. */
  shares: number;
  /** A field's text as shown ("600", "40", "+₹200", "−₹100"), and whether it is still empty. */
  field: string;
  pre: string;
  post: string;
  empty: boolean;
  /** + / −: the sign's tone. */
  tone: "plain" | "get" | "owe";
  /** What the share comes to ("₹480", "out", "—"); empty for Exact, where the field is the amount. */
  comes: string;
  /** Out (Equally), or no shares. */
  dim: boolean;
  /** The field's accessible name. */
  aria: string;
}

function owedMap(form: ExpenseForm, total: number): Map<string, number> | null {
  if (total <= 0) return null;
  const owed = owedBySplit(total, toSpec(splitInput(form)));
  return owed.ok ? new Map(owed.value.owed.map((o) => [o.subjectId, o.owedMinor])) : null;
}

function adjustOf(form: ExpenseForm, id: string): number | null {
  const t = (form.adjust[id] ?? "").trim();
  if (t === "" || t === "-" || t === "+") return 0;
  return parseMoney(t, { signed: true });
}

/** One row per person, as §4's table: the control, and what their share comes to. */
export function rowsOf(form: ExpenseForm, names: Names, me: string | null, currency = "INR"): Row[] {
  const total = totalOf(form) ?? 0;
  const owed = owedMap(form, total);
  const n = form.members.length;
  const net = form.members.reduce((s, id) => s + (adjustOf(form, id) ?? 0), 0);
  return form.members.map((id) => {
    const name = nameOf(names, id, me);
    const base: Row = { id, name, control: "field", on: true, shares: 0, field: "", pre: "", post: "", empty: false, tone: "plain", comes: "", dim: false, aria: name };
    const money = (minor: number | null | undefined) => (total > 0 && minor !== null && minor !== undefined ? formatShort(minor, currency) : "—");
    switch (form.method) {
      case "equal": {
        const on = !!form.equal[id];
        return { ...base, control: "tick", on, dim: !on, comes: on ? money(owed?.get(id) ?? 0) : "out", aria: `${name} ${on ? "is in — tap to leave out" : "is out — tap to add"}` };
      }
      case "exact": {
        const t = form.exact[id] ?? "";
        return { ...base, field: t === "" ? "0" : digitsOf(t, currency), pre: "₹", empty: t === "", aria: `${name} ${name === "You" ? "pay" : "pays"} exactly` };
      }
      case "pct": {
        const t = form.pct[id] ?? "";
        const bp = t === "" ? 0 : parsePct(t);
        const comes = owed?.get(id) ?? (bp === null ? null : Math.round((total * bp) / 10_000));
        return { ...base, field: t === "" ? "0" : t, post: "%", empty: t === "", comes: money(comes), aria: `${name}’s percent` };
      }
      case "shares": {
        const s = form.shares[id] ?? 0;
        return { ...base, control: "step", shares: s, dim: s === 0, comes: money(owed?.get(id) ?? 0) };
      }
      case "adjust": {
        const t = form.adjust[id] ?? "";
        const neg = t.startsWith("-");
        const body = t.replace(/^[+-]/, "");
        const field = body === "" ? (neg ? "−₹0" : "±0") : `${neg ? "−" : "+"}₹${digitsOf(body, currency)}`;
        const a = adjustOf(form, id);
        const comes = owed?.get(id) ?? (a === null || n === 0 ? null : Math.round((total - net) / n) + a);
        return { ...base, field, empty: body === "", tone: body === "" ? "plain" : neg ? "owe" : "get", comes: money(comes), aria: `${name} ${name === "You" ? "pay" : "pays"} more or less than equal` };
      }
      case "items":
        return { ...base, comes: money(owed?.get(id)) };
    }
  });
}

export interface Footer {
  /** The running context: "₹1,200 of ₹2,400", "80% of 100%", "5 shares", "4 of 4 in". */
  left: string;
  /** The verdict: "₹1,200 left", "₹200 over", "Adds up ✓", "₹480 a share". */
  right: string;
  ok: boolean;
}

/** The card's footer line for the method in force (§4). */
export function footerOf(form: ExpenseForm, names: Names, me: string | null, currency = "INR"): Footer {
  const total = totalOf(form) ?? 0;
  const m = form.members;
  const fmt = (minor: number) => formatShort(minor, currency);
  const owed = total > 0 ? owedBySplit(total, toSpec(splitInput(form))) : null;
  const engineOk = owed?.ok === true;
  const noAmount = total <= 0;
  const verdict = (good: string, bad: string, ok: boolean): Pick<Footer, "right" | "ok"> =>
    noAmount ? { right: "Type the amount", ok: false } : { right: ok ? good : bad, ok };
  switch (form.method) {
    case "equal": {
      const inn = m.filter((id) => form.equal[id]).length;
      return { left: `${inn} of ${m.length} in`, ...verdict(`${fmt(inn ? Math.round(total / inn) : 0)} each`, "Pick someone", inn > 0 && engineOk) };
    }
    case "exact": {
      const sum = m.reduce((s, id) => s + (parseMoney(form.exact[id] ?? "") ?? 0), 0);
      const left = total - sum;
      return { left: `${fmt(sum)} of ${fmt(total)}`, ...verdict("Adds up ✓", left > 0 ? `${fmt(left)} left` : `${fmt(-left)} over`, left === 0 && engineOk) };
    }
    case "pct": {
      const bp = m.reduce((s, id) => s + (parsePct(form.pct[id] ?? "") ?? 0), 0);
      const left = 10_000 - bp;
      return { left: `${pctText(bp)}% of 100%`, ...verdict("Adds up ✓", left > 0 ? `${pctText(left)}% left` : `${pctText(-left)}% over`, left === 0 && engineOk) };
    }
    case "shares": {
      const s = m.reduce((a, id) => a + (form.shares[id] ?? 0), 0);
      return { left: `${s} share${s === 1 ? "" : "s"}`, ...verdict(`${fmt(s ? Math.round(total / s) : 0)} a share`, "Add a share", s > 0 && engineOk) };
    }
    case "adjust": {
      const net = m.reduce((a, id) => a + (adjustOf(form, id) ?? 0), 0);
      const each = m.length ? Math.round((total - net) / m.length) : 0;
      const bad = owed && !owed.ok ? owed.problems.find((p) => p.kind === "invalid_value") : undefined;
      const why = bad && bad.kind === "invalid_value" ? `Check ${nameOf(names, bad.subjectId, me)}’s amount` : "Someone is below ₹0";
      return { left: `${fmt(each)} each, then ±`, ...verdict("Adds up ✓", why, engineOk) };
    }
    case "items": {
      const left = itemsLeft(form);
      return { left: `${form.items.length} item${form.items.length === 1 ? "" : "s"}`, right: left === 0 ? "Adds up ✓" : itemsLeftText(left), ok: left === 0 && engineOk };
    }
  }
}

// ── Itemized's count, and Save ───────────────────────────────────

/** Items that stop Save: no price, nobody on it, money left over or too much. */
export function itemsLeft(form: ExpenseForm): number {
  return form.items.filter((it) => itemHasProblem(it, form.members)).length;
}

export function itemsLeftText(n: number): string {
  return `${n} item${n === 1 ? "" : "s"} left to assign`;
}

/**
 * The one main button's label: "Save" when the request is ready; otherwise
 * what is missing — the amount first, then the split's verdict ("₹400 left",
 * "20% left", "Someone is below ₹0", "2 items left to assign"), then the title,
 * then whatever else the engine refuses (who paid).
 */
export function saveLabel(form: ExpenseForm, built: BuildOutcome, names: Names, me: string | null, currency = "INR"): string {
  if (built.ok) return "Save";
  const total = totalOf(form);
  if (form.method === "items") {
    if (form.items.length === 0) return "Add an item";
    const left = itemsLeft(form);
    if (left > 0) return itemsLeftText(left);
  } else {
    if (total === null || total <= 0) return "Type the amount";
    const foot = footerOf(form, names, me, currency);
    if (!foot.ok) return foot.right;
  }
  const problems: (SplitProblem | FormProblem)[] = built.problems;
  const first = problems.find((p) => p.kind !== "no_title") ?? problems[0];
  if (problems.some((p) => p.kind === "no_title")) return problemText({ kind: "no_title" }, names, me, currency);
  return first ? problemText(first, names, me, currency) : "Check the numbers";
}

// ── The rows' own taps ───────────────────────────────────────────

export function toggleIn(form: ExpenseForm, id: string): ExpenseForm {
  return { ...form, equal: { ...form.equal, [id]: !form.equal[id] } };
}

export const MAX_SHARES = 99;
export function stepShares(form: ExpenseForm, id: string, delta: number): ExpenseForm {
  const n = Math.max(0, Math.min(MAX_SHARES, (form.shares[id] ?? 0) + delta));
  return n === form.shares[id] ? form : { ...form, shares: { ...form.shares, [id]: n } };
}

/** The payer chip: "You paid", "Meera paid", "2 people paid". */
export function payerChip(form: ExpenseForm, names: Names, me: string | null): string {
  if (form.payerMode === "one") return `${nameOf(names, form.payer, me)} paid`;
  const n = form.members.filter((id) => (form.payerAmounts[id] ?? "").trim() !== "" && parseMoney(form.payerAmounts[id]!) !== 0).length;
  return n === 0 ? "Who paid?" : `${n} ${n === 1 ? "person" : "people"} paid`;
}
