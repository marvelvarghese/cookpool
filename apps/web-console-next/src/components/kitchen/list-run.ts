/**
 * The shopping run from the list (cookpool-revamp RV-22, the board
 * RvShoppingRun), `/pantry/run?from=list`, as pure view-models: the rows
 * ticked as got on the list, by where each goes — a group's Always have
 * "split equally" (RV-21's Bought: one expense, equal parts), a group's
 * pantry "by use" (an item), Mine — each with its amount and ₹ price (last
 * time's in grey until typed or read off the receipt); a tap on the name
 * moves it to another pantry; "+ Add something else". Scan the receipt
 * (AI-8's read) fills the prices of the lines it finds, ticks them, and
 * adds what else it lists under "Also on the receipt" (each removable). The
 * receipt's taxes, charges and discounts are ONE question — Include in item
 * costs? Yes/No — spread over the priced lines by price (AI-14's
 * `spreadAdjustment`). Paid by is a face per person in every group the run
 * pays into. **Add to kitchen · ₹1,240** saves:
 *
 * - items (by use, Mine, a staple moved elsewhere, the receipt's extras) in
 *   ONE purchase (PN-3's `POST /me/purchases`, the old run's write path);
 * - a group staple kept "split equally" through `…/staples/{stp}/bought`
 *   (equal split, paid by the payer); your own staple kept in Mine records
 *   its price there;
 * - then each pantry's `shopping/clear` with the list lines it saved.
 *
 * Dependency-free (contracts, the engine and pure kitchen modules), so it is
 * unit-testable.
 */

import type { AiReceiptResponse, PurchaseLine, ShoppingItem, StaplePantry, StaplesResponse, StapleBoughtRequest } from "@saas/contracts/kitchen";
import { PURCHASE_MAX_LINES, shoppingLines } from "@saas/contracts/kitchen";
import { parseMinor } from "./money";
import { shortMoney } from "./from-before";
import { nameKeyOf, purchaseQuantity } from "./restock";
import { includedAdjustMinor, receiptAdjustments, spreadAdjustment } from "./receipt-adjust";
import { clockText, isNonFood, receiptPantryKey, receiptUnit } from "./receipt-run";
import { pantryName, stapleApiPantry, stapleKey } from "./kitchen-staples";
import { PERSONAL_PANTRY } from "./pantry";
import { memberLabel, type MemberNames } from "./members";
import { DEFAULT_AMOUNT, amountNumber, familyOf, gotKey, listUnitOf, parseAmount, qtyMilliOf, type ListUnit } from "./shopping-list";

// ── The rows ──────────────────────────────────────────────────────

export type RunOrigin =
  | { kind: "staple"; stapleId: string; home: string; status: "low" | "out" }
  | { kind: "hand"; item: ShoppingItem; home: string }
  /** A receipt's line not on the list (its index in the read). */
  | { kind: "receipt"; index: number }
  /** "+ Add something else". */
  | { kind: "extra" };

/** Where a row goes: its own Always have (a group's equal split, or your own price), or an item in a pantry. */
export type RunDest = { kind: "staple" } | { kind: "item"; pantry: string };

export interface RunRow {
  key: string;
  name: string;
  origin: RunOrigin;
  dest: RunDest;
  qtyMilli: number;
  unit: ListUnit;
  /** Last time's price, the grey ghost; null when there is none. */
  lastPriceMinor: number | null;
  /** The food a staple links to (it finds its receipt line by it). */
  foodKey: string | null;
  /** The item's kind, when known (a receipt's, from its category read). */
  category: string | null;
  /** The receipt's price for a receipt row. */
  receiptPriceMinor: number | null;
}

const isList = (r: RunRow) => r.origin.kind === "staple" || r.origin.kind === "hand";

/** The rows ticked as got on the list (this device's ticks), in the list's order: a staple to its Always have, a hand line to its pantry. */
export function runStartRows(res: StaplesResponse | null | undefined, got: readonly string[]): RunRow[] {
  const ticked = new Set(got);
  const out: RunRow[] = [];
  for (const p of res?.pantries ?? []) {
    const home = stapleKey(p.owner);
    for (const l of shoppingLines(p)) {
      const name = l.source === "staple" ? l.staple.name : l.item.name;
      const key = gotKey(home, l.source, name);
      if (!ticked.has(key)) continue;
      const amount = l.qtyMilli !== null && l.qtyMilli > 0 ? { qtyMilli: l.qtyMilli, unit: listUnitOf(l.unit) } : DEFAULT_AMOUNT;
      if (l.source === "staple") {
        const s = l.staple;
        out.push({
          key,
          name,
          origin: { kind: "staple", stapleId: s.id, home, status: s.status === "out" ? "out" : "low" },
          dest: { kind: "staple" },
          ...amount,
          lastPriceMinor: s.lastPriceMinor,
          foodKey: s.foodKey,
          category: null,
          receiptPriceMinor: null,
        });
      } else {
        out.push({ key, name, origin: { kind: "hand", item: l.item, home }, dest: { kind: "item", pantry: home }, ...amount, lastPriceMinor: null, foodKey: null, category: null, receiptPriceMinor: null });
      }
    }
  }
  return out;
}

/** "+ Add something else": one piece into Mine, no price yet. */
export function extraRow(name: string, n: number): RunRow {
  const nice = name.trim().charAt(0).toUpperCase() + name.trim().slice(1);
  return { key: `x:${n}:${nameKeyOf(nice)}`, name: nice, origin: { kind: "extra" }, dest: { kind: "item", pantry: PERSONAL_PANTRY }, ...DEFAULT_AMOUNT, lastPriceMinor: null, foodKey: null, category: null, receiptPriceMinor: null };
}

// ── The receipt ───────────────────────────────────────────────────

export interface RunReceipt {
  res: AiReceiptResponse;
  at: Date;
  categories: Readonly<Record<number, string>>;
}

const words = (name: string) => nameKeyOf(name).split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/** Whether a receipt's line is this list row: the same name, the same food, or a word of one in the other ("Tea" in "Tata Tea Gold"). */
function sameThing(row: Pick<RunRow, "name" | "foodKey">, line: AiReceiptResponse["lines"][number]): boolean {
  if (row.foodKey && line.foodId && row.foodKey === line.foodId) return true;
  const name = line.name ?? line.text;
  if (nameKeyOf(name) === nameKeyOf(row.name)) return true;
  const a = words(row.name);
  const b = words(name);
  return a.length > 0 && a.every((w) => b.includes(w));
}

/** Which list row each receipt line is (each used once), and the food lines that are none of them. */
export function matchReceipt(rows: readonly RunRow[], res: Pick<AiReceiptResponse, "lines">): { matched: Map<string, number>; extra: number[] } {
  const matched = new Map<string, number>();
  const extra: number[] = [];
  res.lines.forEach((line, i) => {
    if (isNonFood(line)) return;
    const row = rows.find((r) => isList(r) && !matched.has(r.key) && sameThing(r, line));
    if (row) matched.set(row.key, i);
    else extra.push(i);
  });
  return { matched, extra };
}

/** A receipt's line as an "Also on the receipt" row: its amount, its price, the pantry the read chose (else Mine). */
export function receiptRow(res: AiReceiptResponse, index: number, ctx: { categories: Readonly<Record<number, string>>; pantries: readonly string[] }): RunRow {
  const line = res.lines[index]!;
  const name = (line.name ?? line.text).trim() || "Something";
  const unit = listUnitOf(receiptUnit(line.unit));
  const qty = typeof line.quantity === "number" && line.quantity > 0 ? qtyMilliOf(line.quantity, receiptUnit(line.unit) ?? unit) : DEFAULT_AMOUNT.qtyMilli;
  const pk = receiptPantryKey(line);
  return {
    key: `rcpt:${index}`,
    name,
    origin: { kind: "receipt", index },
    dest: { kind: "item", pantry: pk && ctx.pantries.includes(pk) ? pk : PERSONAL_PANTRY },
    qtyMilli: qty,
    unit: receiptUnit(line.unit) && familyOf(unit).includes(receiptUnit(line.unit) as ListUnit) ? (receiptUnit(line.unit) as ListUnit) : unit,
    lastPriceMinor: null,
    foodKey: line.foodId ?? null,
    category: ctx.categories[index] ?? null,
    receiptPriceMinor: typeof line.priceMinor === "number" && line.priceMinor >= 0 ? line.priceMinor : null,
  };
}

/** "GST ₹42 · Delivery ₹30 · −₹50 off": the receipt's own amounts, as printed (round-off left out). */
export function adjustText(res: Pick<AiReceiptResponse, "adjustments" | "currency">): string {
  return (res.adjustments ?? [])
    .filter((a) => a.kind !== "roundoff" && Number.isSafeInteger(a.amountMinor) && a.amountMinor !== 0)
    .map((a) => (a.kind === "discount" ? `−${shortMoney(Math.abs(a.amountMinor), res.currency)} off` : `${a.label} ${shortMoney(Math.abs(a.amountMinor), res.currency)}`))
    .join(" · ");
}

// ── What the screen holds ─────────────────────────────────────────

/** A row's edits: its pantry, the amount and unit typed, the price typed. */
export interface RowEdit {
  dest?: RunDest;
  qty?: string;
  unit?: ListUnit;
  price?: string;
}

export interface RunInput {
  /** The list's rows (runStartRows) and what was added by hand (extraRow). */
  rows: readonly RunRow[];
  extras: readonly RunRow[];
  receipt: RunReceipt | null;
  edits: Readonly<Record<string, RowEdit>>;
  /** Rows taken off ("Also on the receipt", added by hand). */
  removed: ReadonlySet<string>;
  /** Include the receipt's taxes, charges and discounts in item costs. */
  adjustIn: boolean;
  /** Every pantry you add to (the staples read's, viewers' left out). */
  pantries: readonly StaplePantry[];
  meId: string | null;
  names?: MemberNames | null;
  /** Who paid, as picked; null: you. */
  payer: string | null;
}

export interface DestChoice {
  id: string;
  label: string;
  dest: RunDest;
  on: boolean;
}

export interface RunRowView {
  key: string;
  name: string;
  /** On the receipt: ✓ beside the name, the price on the tint. */
  matched: boolean;
  /** "Flat 4B", "Mine": the pantry chip under the name. */
  chip: string;
  /** "not on receipt" once scanned. */
  note: string;
  qty: string;
  qtyGhost: string;
  unit: ListUnit;
  units: readonly ListUnit[];
  /** The price box: what was typed, else the receipt's price; empty shows `priceGhost`. */
  price: string;
  priceGhost: string;
  removable: boolean;
  choices: DestChoice[];
  /** What it is saved at (before the receipt's adjustments). */
  priceMinor: number;
  qtyMilli: number;
  /** The amount box isn't an amount. */
  qtyInvalid: boolean;
}

export interface RunSection {
  key: string;
  title: string;
  sub: string;
  total: string;
  rows: RunRowView[];
}

const PRICE_TEXT = (minor: number) => {
  const whole = minor % 100 === 0;
  return whole ? String(minor / 100) : (minor / 100).toFixed(2);
};

function pantryOf(pantries: readonly StaplePantry[], key: string): StaplePantry | null {
  return pantries.find((p) => stapleKey(p.owner) === key) ?? null;
}

/** The choices a row's name opens: its own Always have first (for a staple), then each pantry you add to. */
export function destChoices(row: Pick<RunRow, "origin">, current: RunDest, pantries: readonly StaplePantry[]): DestChoice[] {
  const out: DestChoice[] = [];
  const o = row.origin;
  const homeIsMine = o.kind === "staple" && o.home === PERSONAL_PANTRY;
  if (o.kind === "staple") {
    const home = pantryOf(pantries, o.home);
    if (home) out.push({ id: "staple", label: homeIsMine ? "Mine" : `${pantryName(home.owner)} · equally`, dest: { kind: "staple" }, on: current.kind === "staple" });
  }
  for (const p of pantries) {
    const key = stapleKey(p.owner);
    // Your own staple kept in Mine is its Always have; there is no second Mine.
    if (homeIsMine && key === PERSONAL_PANTRY) continue;
    out.push({
      id: `item:${key}`,
      label: p.owner.kind === "personal" ? "Mine" : `${p.owner.name} · by use`,
      dest: { kind: "item", pantry: key },
      on: current.kind === "item" && current.pantry === key,
    });
  }
  return out;
}

/** The pantry a row goes to, by key (a staple's is its home). */
export function destPantry(row: Pick<RunRow, "origin">, dest: RunDest): string {
  return dest.kind === "staple" && row.origin.kind === "staple" ? row.origin.home : dest.kind === "item" ? dest.pantry : PERSONAL_PANTRY;
}

/** Which section a row sits in, by where it goes. */
function sectionOf(row: Pick<RunRow, "origin">, dest: RunDest, pantries: readonly StaplePantry[]): { key: string; title: string; sub: string; order: number } {
  const pk = destPantry(row, dest);
  const i = Math.max(0, pantries.findIndex((p) => stapleKey(p.owner) === pk));
  const p = pantries[i];
  if (!p || p.owner.kind === "personal") return { key: PERSONAL_PANTRY, title: "Mine", sub: "", order: i * 2 };
  return dest.kind === "staple"
    ? { key: `eq:${pk}`, title: p.owner.name, sub: "· split equally", order: i * 2 }
    : { key: `use:${pk}`, title: p.owner.name, sub: "· by use", order: i * 2 + 1 };
}

/** Every row on screen: the list's, the receipt's extras (once read), what was added by hand; less what was taken off. */
export function runRows(input: Pick<RunInput, "rows" | "extras" | "receipt" | "removed" | "pantries">): { rows: RunRow[]; matched: Map<string, number> } {
  const match = input.receipt ? matchReceipt(input.rows, input.receipt.res) : { matched: new Map<string, number>(), extra: [] };
  const keys = input.pantries.map((p) => stapleKey(p.owner));
  const fromReceipt = input.receipt ? match.extra.map((i) => receiptRow(input.receipt!.res, i, { categories: input.receipt!.categories, pantries: keys })) : [];
  const rows = [...input.rows, ...fromReceipt, ...input.extras].filter((r) => !input.removed.has(r.key));
  return { rows, matched: match.matched };
}

function rowView(row: RunRow, input: RunInput, matched: Map<string, number>): RunRowView {
  const e = input.edits[row.key] ?? {};
  const dest = e.dest ?? row.dest;
  const scanned = input.receipt !== null;
  const lineIndex = matched.get(row.key);
  const receiptMinor = lineIndex !== undefined ? (input.receipt!.res.lines[lineIndex]!.priceMinor ?? null) : row.receiptPriceMinor;
  const family = familyOf(row.unit);
  const unit = e.unit && family.includes(e.unit) ? e.unit : row.unit;
  const qtyGhost = amountNumber(row.qtyMilli, unit);
  const typedQty = e.qty?.trim() ? parseAmount(e.qty) : null;
  const typedPrice = e.price !== undefined && e.price.trim() !== "" ? e.price : null;
  const priceMinor = typedPrice !== null ? (parseMinor(typedPrice) ?? 0) : (receiptMinor ?? row.lastPriceMinor ?? 0);
  const pk = destPantry(row, dest);
  const p = pantryOf(input.pantries, pk);
  const removable = !isList(row);
  return {
    key: row.key,
    name: row.name,
    matched: lineIndex !== undefined,
    chip: p ? pantryName(p.owner) : "Mine",
    note: scanned && isList(row) && lineIndex === undefined ? "not on receipt" : "",
    qty: e.qty ?? "",
    qtyGhost,
    unit,
    units: family,
    price: typedPrice ?? (receiptMinor !== null ? PRICE_TEXT(receiptMinor) : ""),
    priceGhost: row.lastPriceMinor !== null ? PRICE_TEXT(row.lastPriceMinor) : "0",
    removable,
    choices: destChoices(row, dest, input.pantries),
    priceMinor,
    qtyMilli: typedQty !== null ? qtyMilliOf(typedQty, unit) : qtyMilliOf(Number(qtyGhost), unit),
    qtyInvalid: !!e.qty?.trim() && typedQty === null,
  };
}

// ── Paid by ───────────────────────────────────────────────────────

/**
 * Who can have paid: you, and whoever is in every group the run pays into
 * (each group's current members, `splitAmong`); only you when it pays into
 * no group. You first, then by name.
 */
export function payerChoices(dests: readonly string[], pantries: readonly StaplePantry[], meId: string | null, names?: MemberNames | null): string[] {
  if (!meId) return [];
  const groups = [...new Set(dests)].map((k) => pantryOf(pantries, k)).filter((p): p is StaplePantry => !!p && p.owner.kind === "group");
  if (groups.length === 0) return [meId];
  const common = groups.reduce<string[]>((acc, g, i) => (i === 0 ? [...g.splitAmong] : acc.filter((x) => g.splitAmong.includes(x))), []);
  const others = common.filter((x) => x !== meId).sort((a, b) => memberLabel(a, meId, names).localeCompare(memberLabel(b, meId, names)));
  return [meId, ...others];
}

// ── The plan the button saves ─────────────────────────────────────

export interface StapleWrite {
  key: string;
  name: string;
  /** The SDK's pantry: null for yours, a group's `org_…`. */
  pantry: string | null;
  stapleId: string;
  body: StapleBoughtRequest;
}

export interface ClearWrite {
  pantry: string | null;
  itemIds: string[];
  stapleIds: string[];
}

export interface SavePlan {
  /** One purchase of every item row, in row order; null when there are none. */
  purchase: { lines: PurchaseLine[]; keys: string[]; paidBy?: string } | null;
  staples: StapleWrite[];
  /** Each pantry's list lines the run saved (a staple's Bought already sets it ok; it is cleared too). */
  clears: ClearWrite[];
  /** What Undo puts back on the list: staples to their status, hand lines added again. */
  restore: { staples: { pantry: string | null; stapleId: string; status: "low" | "out" }[]; items: { pantry: string | null; item: ShoppingItem }[] };
  /** The device ticks the run used up. */
  gotKeys: string[];
}

export interface RunView {
  sections: RunSection[];
  count: number;
  totalMinor: number;
  currency: string;
  /** "Add to kitchen · ₹1,240" */
  mainLabel: string;
  /** "Added 6 · ₹1,240" */
  toast: string;
  /** Why it can't be saved yet, in one line; null when it can. */
  problem: string | null;
  plan: SavePlan | null;
  receipt: { title: string; fact: string; adjust: string; asks: boolean } | null;
  payers: string[];
  payer: string | null;
}

const itemsWord = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/** The whole screen and what it saves. */
export function runView(input: RunInput): RunView {
  const { rows, matched } = runRows(input);
  const views = rows.map((r) => rowView(r, input, matched));
  const dests = rows.map((r) => input.edits[r.key]?.dest ?? r.dest);
  const currencyOf = (i: number) => pantryOf(input.pantries, destPantry(rows[i]!, dests[i]!))?.currency ?? "INR";
  const currency = rows.length > 0 ? currencyOf(0) : (input.receipt?.res.currency ?? "INR");

  // The receipt's adjustments, when included, spread over its own priced lines (matched or added from it) in its currency, by price.
  const prices = views.map((v) => v.priceMinor);
  if (input.receipt && input.adjustIn) {
    const adj = includedAdjustMinor(receiptAdjustments(input.receipt.res), { taxes: true, discounts: true });
    const onReceipt = (i: number) => views[i]!.matched || rows[i]!.origin.kind === "receipt";
    const at = prices.flatMap((p, i) => (p > 0 && onReceipt(i) && currencyOf(i) === input.receipt!.res.currency ? [i] : []));
    const spread = spreadAdjustment(at.map((i) => prices[i]!), adj);
    at.forEach((i, n) => (prices[i] = spread[n]!));
  }
  const totalMinor = prices.reduce((a, b) => a + b, 0);

  // Sections: the list's rows by where they go; the receipt's and the added ones together after.
  const bySection = new Map<string, RunSection & { order: number }>();
  views.forEach((v, i) => {
    if (v.removable) return;
    const s = sectionOf(rows[i]!, dests[i]!, input.pantries);
    const sec = bySection.get(s.key) ?? { key: s.key, title: s.title, sub: s.sub, total: "", rows: [], order: s.order };
    sec.rows.push(v);
    bySection.set(s.key, sec);
  });
  const sumOf = (vs: readonly RunRowView[]) => shortMoney(vs.reduce((a, v) => a + v.priceMinor, 0), currency);
  const sections: RunSection[] = [...bySection.values()].sort((a, b) => a.order - b.order).map(({ order: _o, ...s }) => ({ ...s, total: sumOf(s.rows) }));
  const others = views.filter((v) => v.removable);
  if (others.length > 0) {
    sections.push({ key: "others", title: input.receipt ? "Also on the receipt" : "Not on the list", sub: `· ${others.length}`, total: sumOf(others), rows: others });
  }

  const payers = payerChoices(rows.map((r, i) => destPantry(r, dests[i]!)), input.pantries, input.meId, input.names);
  const payer = input.payer && payers.includes(input.payer) ? input.payer : input.meId;
  const total = shortMoney(totalMinor, currency);

  // Why it can't be saved yet.
  let problem: string | null = null;
  const bad = views.find((v) => v.qtyInvalid || !(v.qtyMilli > 0));
  const items = rows.flatMap((r, i) => (dests[i]!.kind === "item" || r.origin.kind !== "staple" ? [i] : []));
  rows.forEach((r, i) => {
    if (problem) return;
    if (dests[i]!.kind === "staple" && r.origin.kind === "staple" && r.origin.home !== PERSONAL_PANTRY && !(prices[i]! > 0)) problem = `${r.name} needs a price · it's split equally`;
  });
  if (!problem && bad) problem = `${bad.name} needs an amount`;
  if (!problem && items.length > PURCHASE_MAX_LINES) problem = `At most ${PURCHASE_MAX_LINES} items in one run`;

  const receipt = input.receipt
    ? (() => {
        const r = input.receipt;
        const added = rows.filter((x) => x.origin.kind === "receipt").length;
        const adj = receiptAdjustments(r.res);
        return {
          title: `${r.res.store?.trim() || "Receipt"} · today ${clockText(r.at)}`,
          fact: `${matched.size} matched · ${added} added · ${total}`,
          adjust: adjustText(r.res),
          asks: adj.asks,
        };
      })()
    : null;

  return {
    sections,
    count: rows.length,
    totalMinor,
    currency,
    mainLabel: rows.length > 0 ? `Add to kitchen · ${total}` : "Add to kitchen",
    toast: `Added ${itemsWord(rows.length)} · ${total}`,
    problem,
    plan: rows.length > 0 && !problem ? savePlan(rows, dests, views, prices, { ...input, payer }) : null,
    receipt,
    payers,
    payer,
  };
}

/**
 * What Add to kitchen writes, from the rows as shown and their prices after
 * the receipt's adjustments: the items in one purchase (paid by the payer
 * on the group lines), each staple kept in its Always have through its
 * Bought (a group's paid by the payer, split equally), and per pantry the
 * list lines to clear.
 */
export function savePlan(
  rows: readonly RunRow[],
  dests: readonly RunDest[],
  views: readonly Pick<RunRowView, "qtyMilli" | "unit">[],
  prices: readonly number[],
  ctx: Pick<RunInput, "pantries" | "meId" | "payer">,
): SavePlan {
  const lines: PurchaseLine[] = [];
  const keys: string[] = [];
  const staples: StapleWrite[] = [];
  const clears = new Map<string, ClearWrite>();
  const restore: SavePlan["restore"] = { staples: [], items: [] };
  const someoneElse = ctx.payer && ctx.payer !== ctx.meId ? ctx.payer : null;
  const apiOf = (key: string) => {
    const p = pantryOf(ctx.pantries, key);
    return p ? stapleApiPantry(p.owner) : null;
  };
  const clearOf = (home: string) => {
    const c = clears.get(home) ?? { pantry: apiOf(home), itemIds: [], stapleIds: [] };
    clears.set(home, c);
    return c;
  };
  rows.forEach((r, i) => {
    const dest = dests[i]!;
    const v = views[i]!;
    const priceMinor = Math.max(0, prices[i] ?? 0);
    const o = r.origin;
    if (dest.kind === "staple" && o.kind === "staple") {
      const group = o.home !== PERSONAL_PANTRY;
      const currency = pantryOf(ctx.pantries, o.home)?.currency;
      staples.push({
        key: r.key,
        name: r.name,
        pantry: apiOf(o.home),
        stapleId: o.stapleId,
        body: { priceMinor, ...(currency ? { currency } : {}), qtyMilli: v.qtyMilli, unit: v.unit, ...(group && someoneElse ? { paidBy: someoneElse } : {}) },
      });
    } else {
      const pk = dest.kind === "item" ? dest.pantry : PERSONAL_PANTRY;
      const p = pantryOf(ctx.pantries, pk);
      lines.push({
        pantry: p && p.owner.kind === "group" ? p.owner.orgId : "personal",
        name: r.name,
        category: r.category ?? "other",
        quantity: purchaseQuantity(v.qtyMilli, v.unit),
        unit: v.unit,
        priceMinor,
        ...(p ? { currency: p.currency } : {}),
      });
      keys.push(r.key);
    }
    if (o.kind === "staple") {
      clearOf(o.home).stapleIds.push(o.stapleId);
      restore.staples.push({ pantry: apiOf(o.home), stapleId: o.stapleId, status: o.status });
    }
    if (o.kind === "hand") {
      clearOf(o.home).itemIds.push(o.item.id);
      restore.items.push({ pantry: apiOf(o.home), item: o.item });
    }
  });
  const groupLine = lines.some((l) => l.pantry !== "personal");
  return {
    purchase: lines.length > 0 ? { lines, keys, ...(someoneElse && groupLine ? { paidBy: someoneElse } : {}) } : null,
    staples,
    clears: [...clears.values()],
    restore,
    gotKeys: rows.filter(isList).map((r) => r.key),
  };
}
