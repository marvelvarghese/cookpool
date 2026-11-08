/**
 * Scan a receipt (cookpool-ai AI-8, design §3, the canvas's AiReceipt) as
 * pure view-models: when the shopping run offers it (AI available, the
 * server's receipt feature on, this device's "Scan receipts" switch on, and
 * the new frame); a receipt read (`POST /v1/kitchen/me/ai/receipt`) mapped
 * into the run's own lines — MATCHED (sure, ticked, buying again what the
 * server matched), CHECK (a question each, unticked until answered) and the
 * non-food lines left out — each still a PN-6 run line (the ladder from the
 * receipt's amount, its price scaled, the pantry chip); the receipt card
 * ("DMart · today 6:40 pm", "9 lines · bill ₹642", and whether the ticked
 * lines add up to the bill); and the refusals in one line each.
 * Dependency-free, so it is unit-testable.
 */

import { AI_RECEIPT_NOT_FOOD, type AiReceiptLine, type AiReceiptResponse, type AiStatus, type Pantry, type PantryRef, type RestockLine, type RestockResponse } from "@saas/contracts/kitchen";
import { dimensionOf, formatQuantity, isUnit, toMilli, type UnitKey } from "@saas/kitchen-engine/units";
import { shortMoney } from "./from-before";
import { PERSONAL_PANTRY, pantryChipLabel, pantryKey } from "./pantry";
import { nameKeyOf } from "./restock";
import { pantryRefOf, startStep, type RunLine, type RunPicks, type TickedLine } from "./shopping-run";

// ── Where Scan a receipt shows ────────────────────────────────────

/**
 * Scan a receipt (the run's button, the Pantry's camera beside + Bought)
 * shows only in the new frame, once `GET /me/ai` says AI is available and
 * the server reads receipts, and while this device's switch is on.
 */
export function receiptScanShows(o: { isNewFrame: boolean; status: AiStatus | null | undefined; switchOn: boolean }): boolean {
  return o.isNewFrame && o.switchOn && o.status?.available === true && o.status.features?.receipt === true;
}

/** Where the Pantry's camera goes: the run, opening the camera at once. */
export const RECEIPT_SCAN_HREF = "/pantry/run?scan=1";

/** Whether the run was opened to scan straight away (`?scan=1`). */
export function scanRequested(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("scan") === "1";
}

// ── Refusals ──────────────────────────────────────────────────────

export type ReceiptErrorKind = "unavailable" | "limit" | "failed";

export interface ReceiptError {
  kind: ReceiptErrorKind;
  /** One line: what happened · what to do. */
  title: string;
}

/**
 * A refusal of the read, by its `details.reason` (design §1): no key on the
 * server hides Scan a receipt; today's limit says to come back tomorrow;
 * anything else (the model failed, the network, a photo that couldn't be
 * shrunk) offers Retake or adding by hand.
 */
export function receiptError(error: { code?: string; reason?: string | undefined; details?: Record<string, unknown> | undefined } | null, status = 0): ReceiptError {
  const reason = error?.reason ?? (typeof error?.details?.["reason"] === "string" ? (error.details["reason"] as string) : undefined);
  if (reason === "ai_unavailable" || (status === 503 && reason === undefined)) return { kind: "unavailable", title: "AI isn't set up yet · add by hand" };
  if (reason === "ai_daily_limit" || error?.code === "rate_limited") return { kind: "limit", title: "You've used today's AI scans · try tomorrow" };
  return { kind: "failed", title: "Couldn't read this receipt · Retake or add by hand" };
}

// ── Reading a receipt into the run ────────────────────────────────

/** The `reason` that means a line isn't food (AI-3's `AI_RECEIPT_NOT_FOOD`). */
export const RECEIPT_NON_FOOD_REASONS: readonly string[] = [AI_RECEIPT_NOT_FOOD];

export function isNonFood(line: Pick<AiReceiptLine, "reason">): boolean {
  return line.reason !== undefined && RECEIPT_NON_FOOD_REASONS.includes(line.reason);
}

const UNIT_SPELLINGS: Readonly<Record<string, UnitKey>> = {
  l: "L", ltr: "L", ltrs: "L", litre: "L", litres: "L", liter: "L", liters: "L",
  ml: "ml", g: "g", gm: "g", gms: "g", gram: "g", grams: "g", gr: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs", no: "pcs", nos: "pcs", n: "pcs", ea: "pcs", each: "pcs",
  dozen: "dozen", dz: "dozen", doz: "dozen",
  pack: "pack", packs: "pack", pkt: "pack", pkts: "pack", packet: "pack", packets: "pack",
  tsp: "tsp", tbsp: "tbsp", cup: "cup", cups: "cup",
};

/** A receipt's unit as the kitchen spells it ("Kg" → kg, "ltr" → L, "nos" → pcs); null when it isn't one. */
export function receiptUnit(raw: string | null | undefined): UnitKey | null {
  if (!raw) return null;
  const t = raw.trim();
  if (isUnit(t)) return t;
  return UNIT_SPELLINGS[t.toLowerCase()] ?? null;
}

function positiveNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function allRestockLines(restock: RestockResponse | null | undefined): RestockLine[] {
  return restock ? [...restock.finished, ...restock.runningLow, ...restock.usual] : [];
}

/** A line's pantry key ("personal" or `org_…`), from its PantryRef (or, defensively, a key); null when it names none. */
export function receiptPantryKey(line: Pick<AiReceiptLine, "pantry">): string | null {
  const p = line.pantry as AiReceiptLine["pantry"] | string | undefined | null;
  if (!p) return null;
  return typeof p === "string" ? p : pantryKey(p);
}

/** The restock line a receipt's line buys again: by the item it matched, else by name (in its pantry when it has one). */
function restockMatch(line: AiReceiptLine, restock: readonly RestockLine[]): RestockLine | null {
  if (line.fromItemId) {
    const byItem = restock.find((r) => r.last.itemId === line.fromItemId || ("itemId" in r.why && r.why.itemId === line.fromItemId));
    if (byItem) return byItem;
  }
  if (!line.name) return null;
  const key = nameKeyOf(line.name);
  const pantry = receiptPantryKey(line);
  return restock.find((r) => r.nameKey === key && (!pantry || pantryKey(r.pantry) === pantry)) ?? null;
}

export interface ReceiptContext {
  /** The restock read: a matched line takes its kind, use-by gap and waste rule from last time. */
  restock: RestockResponse | null | undefined;
  /** The pantries a line can go to (yours, and groups you add to), in the picker's order. */
  pantries: readonly Pantry[];
  meId: string | null;
  /** Each line's category, by its index, looked up from its `fromItemId` item or `foodId` food (`categoryLookups`). */
  categories?: Readonly<Record<number, string>>;
  /** The receipt's currency (the response's), when it says. */
  currency?: string | undefined;
}

/** What to look up for a line's category: its item (`fromItemId`, in its pantry) or its food (`foodId`, searched by name). */
export type CategoryLookup =
  | { index: number; kind: "item"; itemId: string; pantry: PantryRef }
  | { index: number; kind: "food"; foodId: string; q: string };

/**
 * The lookups a receipt needs for its lines' categories (AI-3's lines carry
 * none): lines the restock read already knows, and non-food lines, need
 * none; the rest are read from their item, else their food.
 */
export function categoryLookups(res: Pick<AiReceiptResponse, "lines">, restock: RestockResponse | null | undefined): CategoryLookup[] {
  const known = allRestockLines(restock);
  const out: CategoryLookup[] = [];
  (res.lines ?? []).forEach((line, index) => {
    if (isNonFood(line) || restockMatch(line, known)) return;
    const pantry = line.pantry as AiReceiptLine["pantry"] | string | undefined;
    if (line.fromItemId && pantry && typeof pantry === "object") out.push({ index, kind: "item", itemId: line.fromItemId, pantry });
    else if (line.foodId) out.push({ index, kind: "food", foodId: line.foodId, q: (line.name ?? line.foodId).trim() });
  });
  return out;
}

/** A food's category from a search's answer, by its key; null when the food isn't among them. */
export function foodCategory(foods: readonly { key: string; category: string }[], foodId: string): string | null {
  return foods.find((f) => f.key === foodId)?.category ?? null;
}

/** A receipt's line, as a run line: `last` is the receipt's own amount and price, in the pantry's currency. */
export function receiptRunLine(line: AiReceiptLine, index: number, ctx: ReceiptContext & { restockLines?: readonly RestockLine[] }): RunLine {
  const match = restockMatch(line, ctx.restockLines ?? allRestockLines(ctx.restock));
  const wanted = receiptPantryKey(line) ?? (match ? pantryKey(match.pantry) : PERSONAL_PANTRY);
  const target = ctx.pantries.find((p) => pantryKey(p) === wanted) ?? ctx.pantries.find((p) => p.kind === "personal") ?? ctx.pantries[0] ?? null;
  const pantryRef = target ? pantryRefOf(target) : { kind: "personal" as const, name: "My pantry" };
  const unit = receiptUnit(line.unit) ?? (match && isUnit(match.last.unit) ? match.last.unit : "pcs");
  const qty = positiveNumber(line.quantity) ?? 1;
  let quantityMilli: number;
  try {
    quantityMilli = toMilli(qty, unit);
  } catch {
    quantityMilli = toMilli(1, unit);
  }
  const priced = typeof line.priceMinor === "number" && Number.isInteger(line.priceMinor) && line.priceMinor >= 0;
  const same = match !== null && target !== null && pantryKey(match.pantry) === pantryKey(target);
  const name = (line.name ?? "").trim();
  return {
    key: `rcpt:${index}`,
    group: "receipt",
    name,
    why: "",
    like: "",
    tickable: true,
    locked: null,
    line: {
      name,
      nameKey: nameKeyOf(name),
      category: match?.category ?? ctx.categories?.[index] ?? "other",
      pantry: pantryRef,
      canAdd: true,
      last: {
        itemId: line.fromItemId ?? "",
        quantityMilli,
        unit,
        priceMinor: priced ? line.priceMinor! : 0,
        // The receipt's prices are in its own currency: a pantry counting in another starts with an empty price.
        currency: ctx.currency ?? target?.currency ?? "INR",
        wastePolicy: same ? match.last.wastePolicy : null,
        expiresAfterDays: match ? match.last.expiresAfterDays : null,
        paidBy: ctx.meId ?? "",
      },
    },
    receipt: { text: line.text, fromItemId: line.fromItemId ?? null, sendRule: same, priced },
  };
}

export interface ReceiptRun {
  store: string | null;
  /** The bill's printed total, in minor units; null when it wasn't read. */
  totalMinor: number | null;
  /** The bill's currency: the response's (the one most of its lines' pantries count in). */
  currency: string;
  /**
   * The receipt's own adjustments (tax, a discount, round-off): what the bill
   * differs from its lines by when the server says they reconcile
   * (`totalMatches`); 0 otherwise.
   */
  adjustMinor: number;
  /** Every line read. */
  lineCount: number;
  /** Sure and food: ticked to start with. */
  matched: RunLine[];
  /** Food the server isn't sure of: a question each. */
  check: RunLine[];
  /** Not food: left out, behind Show. */
  nonFood: RunLine[];
  /** All of them, in the run's order (matched, check, non-food). */
  lines: RunLine[];
}

function mostCommon(values: readonly string[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = fallback;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/** The receipt as the run's lines, in its own order within each group. */
export function receiptRun(res: AiReceiptResponse, ctx: ReceiptContext): ReceiptRun {
  const restockLines = allRestockLines(ctx.restock);
  const read = (res.lines ?? []).map((l, i) => ({ src: l, line: receiptRunLine(l, i, { ...ctx, currency: ctx.currency ?? (res.currency || undefined), restockLines }) }));
  const matched = read.filter((r) => !isNonFood(r.src) && r.src.confidence === "sure").map((r) => r.line);
  const check = read.filter((r) => !isNonFood(r.src) && r.src.confidence !== "sure").map((r) => r.line);
  const nonFood = read.filter((r) => isNonFood(r.src)).map((r) => r.line);
  const personal = ctx.pantries.find((p) => p.kind === "personal")?.currency ?? "INR";
  const total = typeof res.total === "number" && Number.isInteger(res.total) && res.total >= 0 ? res.total : null;
  const linesSum = read.reduce((sum, r) => sum + (typeof r.src.priceMinor === "number" ? r.src.priceMinor : 0), 0);
  return {
    store: res.store?.trim() || null,
    totalMinor: total,
    adjustMinor: total !== null && res.totalMatches ? total - linesSum : 0,
    currency: res.currency || mostCommon(read.map((r) => r.line.line.last.currency), personal),
    lineCount: read.length,
    matched,
    check,
    nonFood,
    lines: [...matched, ...check, ...nonFood],
  };
}

/** What the run starts with: every matched line ticked, at the receipt's amount, price and pantry. */
export function receiptStartPicks(run: Pick<ReceiptRun, "matched">): RunPicks {
  const picks: Record<string, RunPicks[string]> = {};
  for (const l of run.matched) {
    const start = startStep(l.line.last);
    if (start) picks[l.key] = { step: start.key, price: null, pantry: pantryKey(l.line.pantry) };
  }
  return picks;
}

// ── Answering a CHECK question ────────────────────────────────────

/** The check lines answered (Yes or Change): they read as ordinary run lines from then on. */
export type ReceiptAnswers = Readonly<Record<string, "yes" | "change">>;

export interface ReceiptState {
  picks: RunPicks;
  answers: ReceiptAnswers;
}

function ticked(picks: RunPicks, line: RunLine, name?: string): RunPicks {
  const start = startStep(line.line.last);
  if (!start) return picks;
  const pick = picks[line.key] ?? { step: start.key, price: null, pantry: pantryKey(line.line.pantry) };
  return { ...picks, [line.key]: name === undefined ? pick : { ...pick, name } };
}

/** Yes, <item>: the line is ticked as read. Only a line with a name can be answered yes. */
export function answerYes(state: ReceiptState, line: RunLine): ReceiptState {
  if (!line.name) return state;
  return { picks: ticked(state.picks, line), answers: { ...state.answers, [line.key]: "yes" } };
}

/** Change (Name it, for a line read without a name): ticked, with its name open to type. */
export function answerChange(state: ReceiptState, line: RunLine): ReceiptState {
  return { picks: ticked(state.picks, line, state.picks[line.key]?.name ?? line.name), answers: { ...state.answers, [line.key]: "change" } };
}

/** The name, as typed after Change. */
export function renamePick(picks: RunPicks, key: string, name: string): RunPicks {
  const pick = picks[key];
  return pick ? { ...picks, [key]: { ...pick, name } } : picks;
}

// ── How a receipt's line reads ────────────────────────────────────

/** "2 L", "200 g", "12 pcs": the amount read. */
export function receiptQuantity(line: RunLine): string {
  const { last } = line.line;
  return formatQuantity(last.quantityMilli, isUnit(last.unit) ? dimensionOf(last.unit) : "count", last.unit);
}

/** "₹95", or null when the receipt's line had no price. */
export function receiptPrice(line: RunLine): string | null {
  return line.receipt?.priced ? shortMoney(line.line.last.priceMinor, line.line.last.currency) : null;
}

/** What a line is called on screen: its name, else its printed text. */
export function receiptLineName(line: RunLine): string {
  return line.name || line.receipt?.text.trim() || "This line";
}

export interface CheckQuestion {
  /** "Is this Paneer · 200 g · ₹95?", or "What is this · ₹95?" for a line read without a name. */
  question: string;
  /** "Yes, paneer"; null when there's nothing to say yes to. */
  yes: string | null;
  /** "Change", or "Name it". */
  change: string;
}

export function checkQuestion(line: RunLine): CheckQuestion {
  const price = receiptPrice(line);
  if (!line.name) return { question: price ? `What is this · ${price}?` : "What is this?", yes: null, change: "Name it" };
  const parts = [line.name, receiptQuantity(line), ...(price ? [price] : [])];
  return { question: `Is this ${parts.join(" · ")}?`, yes: `Yes, ${line.name.charAt(0).toLowerCase()}${line.name.slice(1)}`, change: "Change" };
}

/** "1 non-food line left out · Dish soap ₹44", "3 non-food lines left out"; null when there are none. */
export function nonFoodText(lines: readonly RunLine[]): string | null {
  if (lines.length === 0) return null;
  if (lines.length > 1) return `${lines.length} non-food lines left out`;
  const only = lines[0]!;
  const price = receiptPrice(only);
  return `1 non-food line left out · ${receiptLineName(only)}${price ? ` ${price}` : ""}`;
}

// ── The receipt card ──────────────────────────────────────────────

/** "6:40 pm" in the viewer's clock. */
export function clockText(at: Date): string {
  const h = at.getHours();
  const m = String(at.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "am" : "pm"}`;
}

export interface ReceiptCard {
  /** "DMart · today 6:40 pm" */
  title: string;
  /** "9 lines · bill ₹642" */
  sub: string;
  /** Whether the ticked lines add up to the bill; null when no total was read. */
  total: { ok: boolean; text: string } | null;
}

/**
 * The card above the lines. The bill is compared with what is ticked, plus
 * the non-food lines left out (they're on the bill, just not in a pantry):
 * "Lines add up to the bill ✓", or the difference — "₹95 of the bill isn't
 * ticked", "₹12 more than the bill". When the server found the lines
 * reconcile with the bill through its own adjustments (a tax, a discount,
 * round-off), those count as on the bill. Lines moved to a pantry in another
 * currency don't count.
 */
export function receiptCard(run: ReceiptRun, ticks: readonly Pick<TickedLine, "key" | "priceMinor" | "currency">[], scannedAt: Date): ReceiptCard {
  const lines = `${run.lineCount} ${run.lineCount === 1 ? "line" : "lines"}`;
  const sub = run.totalMinor !== null ? `${lines} · bill ${shortMoney(run.totalMinor, run.currency)}` : lines;
  const title = `${run.store ?? "Receipt"} · today ${clockText(scannedAt)}`;
  if (run.totalMinor === null) return { title, sub, total: null };
  const tickedKeys = new Set(ticks.map((t) => t.key));
  const tickedSum = ticks.reduce((s, t) => (t.currency === run.currency && t.priceMinor !== null ? s + t.priceMinor : s), 0);
  const leftOut = run.nonFood.reduce((s, l) => (!tickedKeys.has(l.key) && l.receipt?.priced ? s + l.line.last.priceMinor : s), 0);
  const diff = run.totalMinor - run.adjustMinor - tickedSum - leftOut;
  if (diff === 0) return { title, sub, total: { ok: true, text: "Lines add up to the bill ✓" } };
  const money = shortMoney(Math.abs(diff), run.currency);
  return { title, sub, total: { ok: false, text: diff > 0 ? `${money} of the bill isn't ticked` : `${money} more than the bill` } };
}

/** While it is read: "Reading the lines…", then "Found 9 lines · matching to your pantries…". */
export function readingText(found: number | null): string {
  return found === null ? "Reading the lines…" : `Found ${found} ${found === 1 ? "line" : "lines"} · matching to your pantries…`;
}

/** The pantry chip's words for a line. */
export function receiptPantryLabel(line: RunLine): string {
  return pantryChipLabel(line.line.pantry);
}
