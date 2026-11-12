// The Add expense form, as plain data, and what it sends. Pure: the screens
// keep an `ExpenseForm` in state, and Save sends `buildRequest(form)` — which
// runs the very maths spliteco-worker splits with (@saas/kitchen-engine), so
// Save is only on when the server will accept the split.

import type {
  SplitecoAdjustmentKind,
  SplitecoCategory,
  SplitecoExpenseRequest,
  SplitecoItemShareMode,
  SplitecoSplitInput,
  SplitecoSplitMethod,
} from "@saas/contracts/spliteco";
import { buildSplitecoSplits, type SplitProblem, type SplitSpec } from "@saas/kitchen-engine/splits";
import { moneyInput, parseMoney } from "./money";
import { guessCategory } from "./activity-text";

export interface ItemShareForm {
  mode: SplitecoItemShareMode;
  /** portion ×1000, basis points, or paise. */
  value: number;
}

export interface ItemForm {
  key: string;
  name: string;
  qtyText: string;
  /** The price of one, as typed (optional). */
  unitText: string;
  /** The line's total, as typed; worked out from qty × unit when empty. */
  totalText: string;
  /** Who had it; a person not in the map is not on the item. */
  shares: Record<string, ItemShareForm>;
}

export interface AdjustmentForm {
  key: string;
  kind: SplitecoAdjustmentKind;
  label: string;
  /** A percentage of the items' subtotal, or an amount. */
  mode: "pct" | "amount";
  valueText: string;
}

export interface ExpenseForm {
  title: string;
  amountText: string;
  category: SplitecoCategory | null;
  /** YYYY-MM-DD, the day it happened. */
  occurredOn: string;
  note: string;
  /** The group's members, in the order the screens list them. */
  members: string[];
  payerMode: "one" | "many";
  payer: string;
  payerAmounts: Record<string, string>;
  method: SplitecoSplitMethod;
  equal: Record<string, boolean>;
  exact: Record<string, string>;
  pct: Record<string, string>;
  shares: Record<string, number>;
  adjust: Record<string, string>;
  items: ItemForm[];
  adjustments: AdjustmentForm[];
}

let keySeq = 0;
export function newKey(prefix = "k"): string {
  keySeq += 1;
  return `${prefix}${keySeq}`;
}

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function emptyItem(): ItemForm {
  return { key: newKey("itm"), name: "", qtyText: "1", unitText: "", totalText: "", shares: {} };
}

/** A fresh form for a group: the caller paid, split equally between everyone. */
export function newForm(members: string[], me: string, method: SplitecoSplitMethod = "equal"): ExpenseForm {
  const all = <T,>(v: T) => Object.fromEntries(members.map((m) => [m, v])) as Record<string, T>;
  return {
    title: "",
    amountText: "",
    category: null,
    occurredOn: todayIso(),
    note: "",
    members,
    payerMode: "one",
    payer: members.includes(me) ? me : (members[0] ?? me),
    payerAmounts: all(""),
    method,
    equal: all(true),
    exact: all(""),
    pct: all(""),
    shares: all(1),
    adjust: all(""),
    items: method === "items" ? [emptyItem()] : [],
    adjustments: [],
  };
}

/** "33.33" → 3333 basis points; null when not a percentage with at most two decimals. */
export function parsePct(text: string): number | null {
  const t = text.replace(/[\s%]/g, "");
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(t);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bp <= 10_000 ? bp : null;
}

export function pctInput(bp: number): string {
  if (!bp) return "";
  return bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace(/0$/, "");
}

/** An item line's total: as typed, else qty × unit. */
export function itemTotal(item: ItemForm): number | null {
  const typed = parseMoney(item.totalText);
  if (typed !== null) return typed;
  const unit = parseMoney(item.unitText);
  const qty = Number(item.qtyText);
  if (unit === null || !Number.isFinite(qty) || qty <= 0) return null;
  return Math.round(unit * qty);
}

export function itemsSubtotal(form: ExpenseForm): number {
  return form.items.reduce((s, it) => s + (itemTotal(it) ?? 0), 0);
}

/** One adjustment in minor units (a % of the subtotal is rounded to the paisa). */
export function adjustmentAmount(adj: AdjustmentForm, subtotal: number): number | null {
  if (adj.mode === "amount") return parseMoney(adj.valueText);
  const bp = parsePct(adj.valueText);
  return bp === null ? null : Math.round((subtotal * bp) / 10_000);
}

export function adjustmentsTotal(form: ExpenseForm): number {
  const subtotal = itemsSubtotal(form);
  return form.adjustments.reduce((s, a) => {
    const v = adjustmentAmount(a, subtotal) ?? 0;
    return s + (a.kind === "discount" ? -v : v);
  }, 0);
}

/** The expense's total: typed, or — itemized — the items plus tax and service, less discount. */
export function totalOf(form: ExpenseForm): number | null {
  if (form.method === "items") {
    const t = itemsSubtotal(form) + adjustmentsTotal(form);
    return form.items.length > 0 ? t : null;
  }
  return parseMoney(form.amountText);
}

/** The split as the wire sends it. */
export function splitInput(form: ExpenseForm): SplitecoSplitInput {
  const m = form.members;
  switch (form.method) {
    case "equal":
      return { method: "equal", participants: m.filter((id) => form.equal[id]) };
    case "exact":
      return {
        method: "exact",
        participants: m
          .filter((id) => (form.exact[id] ?? "").trim() !== "")
          .map((id) => ({ subjectId: id, amountMinor: parseMoney(form.exact[id]!) ?? -1 })),
      };
    case "pct":
      return {
        method: "pct",
        participants: m
          .filter((id) => (form.pct[id] ?? "").trim() !== "")
          .map((id) => ({ subjectId: id, basisPoints: parsePct(form.pct[id]!) ?? -1 })),
      };
    case "shares":
      return {
        method: "shares",
        participants: m.filter((id) => (form.shares[id] ?? 0) > 0).map((id) => ({ subjectId: id, shares: form.shares[id]! })),
      };
    case "adjust":
      return {
        method: "adjust",
        participants: m.map((id) => ({
          subjectId: id,
          adjustMinor: (form.adjust[id] ?? "").trim() === "" ? 0 : (parseMoney(form.adjust[id]!, { signed: true }) ?? Number.NaN),
        })),
      };
    case "items": {
      const subtotal = itemsSubtotal(form);
      return {
        method: "items",
        items: form.items.map((it) => {
          const qty = Number(it.qtyText);
          return {
            name: it.name.trim() || "Item",
            qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
            unitMinor: parseMoney(it.unitText),
            totalMinor: itemTotal(it) ?? -1,
            shares: m.filter((id) => it.shares[id]).map((id) => ({ subjectId: id, mode: it.shares[id]!.mode, value: it.shares[id]!.value })),
          };
        }),
        adjustments: form.adjustments
          .map((a) => ({ kind: a.kind, label: a.label.trim() || defaultAdjustmentLabel(a), amountMinor: adjustmentAmount(a, subtotal) ?? -1 }))
          .filter((a) => a.amountMinor !== 0),
      };
    }
  }
}

export function defaultAdjustmentLabel(a: Pick<AdjustmentForm, "kind" | "mode" | "valueText">): string {
  const base = a.kind === "tax" ? "Tax" : a.kind === "service" ? "Service charge" : "Discount";
  return a.mode === "pct" && a.valueText.trim() ? `${base} ${a.valueText.trim()}%` : base;
}

/** The engine's form of the wire split (its field names are the same). */
export function toSpec(split: SplitecoSplitInput): SplitSpec {
  if (split.method === "items") {
    return {
      method: "items",
      items: split.items.map((it) => ({ totalMinor: it.totalMinor, shares: it.shares })),
      adjustments: split.adjustments.map((a) => ({ kind: a.kind, amountMinor: a.amountMinor })),
    };
  }
  return split as SplitSpec;
}

/** Who paid, as the wire sends it. */
export function payersOf(form: ExpenseForm, total: number): { subjectId: string; amountMinor: number }[] {
  if (form.payerMode === "one") return [{ subjectId: form.payer, amountMinor: total }];
  return form.members
    .filter((id) => (form.payerAmounts[id] ?? "").trim() !== "" && parseMoney(form.payerAmounts[id]!) !== 0)
    .map((id) => ({ subjectId: id, amountMinor: parseMoney(form.payerAmounts[id]!) ?? -1 }));
}

export function paidTotal(form: ExpenseForm): number {
  return payersOf(form, 0).reduce((s, p) => s + Math.max(0, p.amountMinor), 0);
}

export type BuildOutcome = { ok: true; request: SplitecoExpenseRequest } | { ok: false; problems: (SplitProblem | FormProblem)[] };

export type FormProblem = { kind: "no_title" } | { kind: "no_amount" };

/** The request Save sends, or every reason Save is off. */
export function buildRequest(form: ExpenseForm, currency?: string): BuildOutcome {
  const problems: (SplitProblem | FormProblem)[] = [];
  const total = totalOf(form);
  if (!form.title.trim()) problems.push({ kind: "no_title" });
  if (total === null || total <= 0) problems.push({ kind: "no_amount" });
  if (total === null || total <= 0) return { ok: false, problems };
  const split = splitInput(form);
  const payers = payersOf(form, total);
  const built = buildSplitecoSplits(total, payers, toSpec(split));
  if (!built.ok) problems.push(...built.problems);
  if (problems.length > 0) return { ok: false, problems };
  const request: SplitecoExpenseRequest = {
    title: form.title.trim(),
    totalMinor: total,
    category: form.category ?? guessCategory(form.title),
    occurredAt: `${form.occurredOn}T12:00:00.000Z`,
    note: form.note.trim() ? form.note.trim() : null,
    payers,
    split,
  };
  if (currency) request.currency = currency;
  return { ok: true, request };
}

/** The "adds up" bar under Split: how much of the total the split assigns. */
export interface SplitStatus {
  totalMinor: number;
  assignedMinor: number;
  ok: boolean;
  /** "Adds up", "₹120.00 left to assign", "₹40.00 too much", "Percentages reach 90%" … */
  kind: "adds_up" | "left" | "over" | "pct" | "invalid" | "empty";
  /** For `pct`: basis points assigned. */
  basisPoints?: number;
}

export function splitStatus(form: ExpenseForm): SplitStatus {
  const total = totalOf(form) ?? 0;
  if (total <= 0) return { totalMinor: 0, assignedMinor: 0, ok: false, kind: "empty" };
  const split = splitInput(form);
  const built = buildSplitecoSplits(total, [{ subjectId: "_total", amountMinor: total }], toSpec(split));
  if (built.ok) return { totalMinor: total, assignedMinor: total, ok: true, kind: "adds_up" };
  const p = built.problems;
  const pct = p.find((x) => x.kind === "pct_not_100");
  if (pct && pct.kind === "pct_not_100") {
    return { totalMinor: total, assignedMinor: Math.round((total * pct.basisPoints) / 10_000), ok: false, kind: "pct", basisPoints: pct.basisPoints };
  }
  const mismatch = p.find((x) => x.kind === "total_mismatch");
  if (mismatch && mismatch.kind === "total_mismatch") {
    const assigned = mismatch.assignedMinor;
    return { totalMinor: total, assignedMinor: assigned, ok: false, kind: assigned < total ? "left" : "over" };
  }
  const items = p.filter((x) => x.kind === "item_unassigned" || x.kind === "item_over");
  if (items.length > 0) {
    let assigned = total;
    for (const x of items) if (x.kind === "item_unassigned") assigned -= x.amountMinor; else if (x.kind === "item_over") assigned += x.amountMinor;
    return { totalMinor: total, assignedMinor: assigned, ok: false, kind: assigned <= total ? "left" : "over" };
  }
  if (p.some((x) => x.kind === "no_one" || x.kind === "item_empty")) return { totalMinor: total, assignedMinor: 0, ok: false, kind: "left" };
  return { totalMinor: total, assignedMinor: 0, ok: false, kind: "invalid" };
}

/** Who paid, summed against the total, for the Who paid sheet's bar. */
export function payersStatus(form: ExpenseForm): { totalMinor: number; paidMinor: number; ok: boolean } {
  const total = totalOf(form) ?? 0;
  if (form.payerMode === "one") return { totalMinor: total, paidMinor: total, ok: total > 0 };
  const paid = paidTotal(form);
  const valid = payersOf(form, total).every((p) => p.amountMinor >= 0);
  return { totalMinor: total, paidMinor: paid, ok: valid && total > 0 && paid === total };
}

/** The form an Edit starts from: the request the expense was saved with. */
export function formFromInput(input: SplitecoExpenseRequest, members: string[], me: string): ExpenseForm {
  const named = new Set<string>(members);
  for (const p of input.payers) named.add(p.subjectId);
  const split = input.split;
  if (split.method === "equal") split.participants.forEach((id) => named.add(id));
  else if (split.method === "items") split.items.forEach((it) => it.shares.forEach((s) => named.add(s.subjectId)));
  else split.participants.forEach((p) => named.add(p.subjectId));
  const people = [...named];
  const form = newForm(people, me, split.method);
  form.title = input.title;
  form.amountText = moneyInput(input.totalMinor);
  form.category = input.category ?? null;
  form.occurredOn = (input.occurredAt ?? "").slice(0, 10) || todayIso();
  form.note = input.note ?? "";
  if (input.payers.length === 1) {
    form.payerMode = "one";
    form.payer = input.payers[0]!.subjectId;
  } else {
    form.payerMode = "many";
    for (const p of input.payers) form.payerAmounts[p.subjectId] = moneyInput(p.amountMinor);
  }
  switch (split.method) {
    case "equal":
      for (const id of people) form.equal[id] = split.participants.includes(id);
      break;
    case "exact":
      for (const p of split.participants) form.exact[p.subjectId] = moneyInput(p.amountMinor) || "0";
      break;
    case "pct":
      for (const p of split.participants) form.pct[p.subjectId] = pctInput(p.basisPoints) || "0";
      break;
    case "shares":
      for (const id of people) form.shares[id] = 0;
      for (const p of split.participants) form.shares[p.subjectId] = p.shares;
      break;
    case "adjust":
      for (const p of split.participants) form.adjust[p.subjectId] = p.adjustMinor ? moneyInput(p.adjustMinor) : "";
      break;
    case "items":
      form.items = split.items.map((it) => ({
        key: newKey("itm"),
        name: it.name,
        qtyText: String(it.qty ?? 1),
        unitText: it.unitMinor ? moneyInput(it.unitMinor) : "",
        totalText: moneyInput(it.totalMinor) || "0",
        shares: Object.fromEntries(it.shares.map((s) => [s.subjectId, { mode: s.mode, value: s.value }])),
      }));
      form.adjustments = split.adjustments.map((a) => ({
        key: newKey("adj"),
        kind: a.kind,
        label: a.label,
        mode: "amount" as const,
        valueText: moneyInput(a.amountMinor),
      }));
      break;
  }
  return form;
}

export const METHOD_LABELS: Record<SplitecoSplitMethod, { glyph: string; tab: string; phrase: string; tag: string | null }> = {
  equal: { glyph: "=", tab: "Equal", phrase: "equally", tag: null },
  exact: { glyph: "₹", tab: "Exact", phrase: "by exact amounts", tag: "Exact" },
  pct: { glyph: "%", tab: "Percent", phrase: "by percentages", tag: "Percent" },
  shares: { glyph: "÷", tab: "Shares", phrase: "by shares", tag: "Shares" },
  adjust: { glyph: "±", tab: "Adjust", phrase: "with adjustments", tag: "Adjusted" },
  items: { glyph: "≡", tab: "Items", phrase: "item by item", tag: "Itemized" },
};

export const METHOD_HINTS: Record<SplitecoSplitMethod, string> = {
  equal: "Everyone ticked pays the same. Untick anyone who was not there.",
  exact: "Type what each person owes. Done unlocks when it adds up to the total.",
  pct: "Give each person a percentage. It has to reach 100%.",
  shares: "Someone had more? Give them more shares — the total is split by shares.",
  adjust: "Split equally, then add or take off for someone. The rest re-balances.",
  items: "For restaurant bills and receipts: who had which item. Tax, service and discounts spread by what each person had.",
};

/** Items that hold something someone entered (a name, a price or a person). */
export function enteredItems(form: ExpenseForm): number {
  return form.items.filter((it) => it.name.trim() || it.totalText.trim() || it.unitText.trim() || Object.keys(it.shares).length > 0).length;
}

/**
 * Leave Itemized for another method: the bill total becomes the typed amount,
 * with the same people. `clear` drops the items and the tax/discount lines
 * (the Itemized screen's "Change"); without it they are kept, unused, in case
 * the person comes back to Items.
 */
export function switchFromItems(form: ExpenseForm, method: Exclude<SplitecoSplitMethod, "items">, clear = true): ExpenseForm {
  const total = form.method === "items" ? totalOf(form) : null;
  const next: ExpenseForm = { ...form, method };
  if (total !== null && total > 0) next.amountText = moneyInput(total);
  if (clear) {
    next.items = [];
    next.adjustments = [];
  }
  return next;
}
