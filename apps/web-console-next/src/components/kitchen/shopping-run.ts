/**
 * The shopping run (cookpool-pantry PN-6, design §6.3, the canvas's
 * BuyAgain) as pure view-models: the restock read's lines in three groups —
 * Finished, Running low, You usually buy (no caps, RV-24) — each "Like last time: 2 L · ₹136 ·
 * Flat 4B" until ticked (then its why: "Finished Tue", "600 g of 5 kg left",
 * "Every 4 days · last Wed"); what ticking opens — the quantity's − / +
 * (the last amount, then its ladder: half of it when that is a whole
 * amount, then ×2 … like PN-5's set row), the price (last time's, scaled to
 * the quantity, editable, in minor units) and the pantry (another one you
 * add to); and the footer's one write — "Add 3 · ₹449", one
 * `POST /v1/kitchen/me/purchases`, paid by you — with its toast. Nothing is
 * ticked to start with. Lines in a pantry you only view can't be ticked.
 * Dependency-free (contracts, the engine and the pure kitchen modules), so
 * it is unit-testable.
 */

import type { CreatePurchaseRequest, Pantry, PantryRef, PurchaseLine, RestockLast, RestockLine, RestockResponse } from "@saas/contracts/kitchen";
import { PURCHASE_MAX_LINES } from "@saas/contracts/kitchen";
import { dimensionOf, formatQuantity, isUnit, type Dimension } from "@saas/kitchen-engine/units";
import { currencyPrefix, parseMinor } from "./money";
import { addDays, priceInput, shortMoney } from "./from-before";
import { pantryChipLabel, pantryKey } from "./pantry";
import { LADDER_MULTIPLES, canStep, stepFrom, stepOf, type LadderStep } from "./pantry-set";
import { calendarWeekdayText, finishedWhen, purchaseQuantity, restockKey } from "./restock";

export type RunGroupId = "finished" | "running_low" | "usual";

/** The groups, in the canvas's order and words. */
export const RUN_GROUPS: readonly { id: RunGroupId; title: string }[] = [
  { id: "finished", title: "Finished" },
  { id: "running_low", title: "Running low" },
  { id: "usual", title: "You usually buy" },
];

/**
 * What a run line buys like: a restock line, or (cookpool-ai AI-8) a
 * receipt's line read into the same shape — its `last` is then the receipt's
 * own amount and price.
 */
export type RunSource = Pick<RestockLine, "name" | "nameKey" | "category" | "pantry" | "canAdd" | "last">;

/**
 * A line read from a receipt (cookpool-ai AI-8): its printed text, the item
 * it buys again when the server matched one, and whether last time's waste
 * rule is sent (only when it came from a restock line in the same pantry;
 * otherwise the server copies `fromItemId`'s rule itself).
 */
export interface RunLineReceipt {
  text: string;
  fromItemId: string | null;
  sendRule: boolean;
  /** Whether the receipt gave its price; without one the box starts empty. */
  priced: boolean;
}

export interface RunLine {
  /** `restockKey`: one name in one pantry (a receipt's line: `rcpt:<n>`). */
  key: string;
  group: RunGroupId | "receipt";
  line: RunSource;
  name: string;
  /** "Finished Tue", "600 g of 5 kg left", "Every 4 days · last Wed" — shown once ticked. */
  why: string;
  /** "Like last time: 2 L · ₹136 · Flat 4B" — shown until ticked. */
  like: string;
  /** Only a pantry you add to takes a line. */
  tickable: boolean;
  /** Why it can't be ticked: "You only view Flat 4B". */
  locked: string | null;
  /** Read from a receipt (AI-8). */
  receipt?: RunLineReceipt;
}

export interface RunGroup {
  id: RunGroupId;
  title: string;
  lines: RunLine[];
}

function dimensionOfLast(last: Pick<RestockLast, "unit">): Dimension {
  return isUnit(last.unit) ? dimensionOf(last.unit) : "count";
}

/** "Every day", "Every 4 days", "Every week", "Every 2 weeks". */
export function everyText(days: number): string {
  if (days <= 1) return "Every day";
  if (days === 7) return "Every week";
  if (days % 7 === 0) return `Every ${days / 7} weeks`;
  return `Every ${days} days`;
}

/** A line's why, as the design writes it. */
export function runWhy(line: RestockLine, ctx: { now: Date; today: string }): string {
  if (line.reason === "finished") return finishedWhen(line, ctx.now);
  const dim = dimensionOfLast(line.last);
  if (line.reason === "running_low") {
    return `${formatQuantity(line.why.leftQtyMilli, dim, line.last.unit)} of ${formatQuantity(line.why.boughtQtyMilli, dim, line.last.unit)} left`;
  }
  const when = calendarWeekdayText(line.why.lastBoughtAt, ctx.today);
  return `${everyText(line.why.everyDays)} · ${when === "today" || when === "yesterday" ? when : `last ${when}`}`;
}

/** "Like last time: 2 L · ₹136 · Flat 4B". */
export function likeLastTime(line: Pick<RestockLine, "last" | "pantry">): string {
  const { last } = line;
  return `Like last time: ${formatQuantity(last.quantityMilli, dimensionOfLast(last), last.unit)} · ${shortMoney(last.priceMinor, last.currency)} · ${pantryChipLabel(line.pantry)}`;
}

function runLine(group: RunGroupId, line: RestockLine, ctx: { now: Date; today: string }): RunLine {
  return {
    key: restockKey(line),
    group,
    line,
    name: line.name,
    why: runWhy(line, ctx),
    like: likeLastTime(line),
    tickable: line.canAdd,
    locked: line.canAdd ? null : `You only view ${pantryChipLabel(line.pantry)}`,
  };
}

/** The run's groups, in the server's order inside each; empty groups left out. */
export function runGroups(restock: RestockResponse | null | undefined, ctx: { now: Date; today: string }): RunGroup[] {
  if (!restock) return [];
  const lists: Record<RunGroupId, readonly RestockLine[]> = { finished: restock.finished, running_low: restock.runningLow, usual: restock.usual };
  return RUN_GROUPS.map((g) => ({ id: g.id, title: g.title, lines: lists[g.id].map((l) => runLine(g.id, l, ctx)) })).filter((g) => g.lines.length > 0);
}

/** Every line, in the run's order. */
export function runLines(groups: readonly RunGroup[]): RunLine[] {
  return groups.flatMap((g) => g.lines);
}

// ── The quantity's ladder ─────────────────────────────────────────

function buyStep(qtyMilli: number, dim: Dimension, unit: string): LadderStep {
  return { key: `u:${qtyMilli}`, amount: { kind: "unit", qtyMilli }, qtyMilli, words: formatQuantity(qtyMilli, dim, unit), rest: false };
}

/** Half is offered when it is a whole amount: a gram or millilitre or more, or whole pieces and packs. */
function halfFits(halfMilli: number, dim: Dimension): boolean {
  if (!Number.isInteger(halfMilli) || halfMilli <= 0) return false;
  return dim === "mass" || dim === "volume" ? halfMilli >= 1000 : halfMilli % 1000 === 0;
}

/**
 * What − and + step through: last time's amount, half of it when that is a
 * whole amount, and ×2 … ×(LADDER_MULTIPLES + 1) — the set row's ladder,
 * upwards, since a purchase isn't capped by what is left. In the unit it was
 * bought in ("2 L", "500 g", "12 pcs").
 */
export function buyLadder(last: Pick<RestockLast, "quantityMilli" | "unit">): LadderStep[] {
  const dim = dimensionOfLast(last);
  const base = last.quantityMilli;
  if (base <= 0) return [];
  const amounts = halfFits(base / 2, dim) ? [base / 2] : [];
  for (let k = 1; k <= LADDER_MULTIPLES + 1; k++) amounts.push(base * k);
  return amounts.map((q) => buyStep(q, dim, last.unit));
}

/** The step a line starts at: last time's amount. */
export function startStep(last: Pick<RestockLast, "quantityMilli" | "unit">): LadderStep | null {
  return stepOf(buyLadder(last), `u:${last.quantityMilli}`);
}

/** Last time's price for this much: scaled by the quantity, to the paisa. */
export function scaledPrice(last: Pick<RestockLast, "priceMinor" | "quantityMilli">, qtyMilli: number): number {
  if (last.quantityMilli <= 0) return last.priceMinor;
  return Math.round((last.priceMinor * qtyMilli) / last.quantityMilli);
}

// ── Ticking ───────────────────────────────────────────────────────

/** What a ticked line was left at. */
export interface RunPick {
  /** The ladder step's key ("u:2000000"). */
  step: string;
  /** The price as typed; null while it is last time's, scaled. */
  price: string | null;
  /** Where it goes: "personal" or a group's `org_…`. */
  pantry: string;
  /** The name as typed (a receipt's line, after Change); absent while it is the line's own. */
  name?: string;
}

export type RunPicks = Readonly<Record<string, RunPick>>;

/** Tick a line (last time's amount, price and pantry) or untick it. A line you can't add to stays as it is. */
export function toggleTick(picks: RunPicks, line: RunLine): RunPicks {
  if (picks[line.key]) {
    const next = { ...picks };
    delete next[line.key];
    return next;
  }
  if (!line.tickable) return picks;
  const start = startStep(line.line.last);
  if (!start) return picks;
  return { ...picks, [line.key]: { step: start.key, price: null, pantry: pantryKey(line.line.pantry) } };
}

/** − (−1) or + (+1): the next amount; the price goes back to last time's, scaled. */
export function stepPick(picks: RunPicks, line: RunLine, delta: 1 | -1): RunPicks {
  const pick = picks[line.key];
  if (!pick) return picks;
  const next = stepFrom(buyLadder(line.line.last), pick.step, delta);
  if (!next || next.key === pick.step) return picks;
  return { ...picks, [line.key]: { ...pick, step: next.key, price: null } };
}

/** The price, as typed. */
export function pricePick(picks: RunPicks, key: string, text: string): RunPicks {
  const pick = picks[key];
  if (!pick) return picks;
  return { ...picks, [key]: { ...pick, price: text } };
}

/** Another pantry. A price typed in another currency doesn't carry over. */
export function pantryPick(picks: RunPicks, key: string, pantry: string, pantries: readonly Pantry[]): RunPicks {
  const pick = picks[key];
  if (!pick || pick.pantry === pantry) return picks;
  const from = pantries.find((p) => pantryKey(p) === pick.pantry);
  const to = pantries.find((p) => pantryKey(p) === pantry);
  const same = !from || !to || from.currency === to.currency;
  return { ...picks, [key]: { ...pick, pantry, price: same ? pick.price : null } };
}

/** A pantry as an item's `pantry`. */
export function pantryRefOf(p: Pantry): PantryRef {
  return p.kind === "personal" ? { kind: "personal", name: p.name } : { kind: "group", orgId: p.orgId, slug: p.slug, name: p.name };
}

export interface TickedLine {
  key: string;
  /** The name it is added as: the line's, or as typed. */
  name: string;
  step: LadderStep;
  canLess: boolean;
  canMore: boolean;
  /** What the price box holds: last time's, scaled ("136"), or what was typed. */
  priceText: string;
  /** Null while the box doesn't read as an amount. */
  priceMinor: number | null;
  currency: string;
  /** "₹" before the box. */
  prefix: string;
  pantry: string;
  /** "Flat 4B", "Me". */
  pantryLabel: string;
  /** Where it goes, as an item's `pantry`. */
  pantryRef: PantryRef;
  /** The line as the write sends it; null while its price doesn't read (or its name is blank). */
  request: PurchaseLine | null;
}

/**
 * A ticked line, opened: the amount and its − / +, the price (last time's
 * scaled to the amount, unless typed — none when the pantry counts in
 * another currency), the pantry, and the purchase line it sends: the waste
 * rule only into its own group, `fromItemId` always (the server copies the
 * item's settings only into its own pantry), and the use-by gap from today.
 */
export function tickedLine(line: RunLine, pick: RunPick, ctx: { pantries: readonly Pantry[]; today: string }): TickedLine {
  const { last } = line.line;
  const ladder = buyLadder(last);
  const step = stepOf(ladder, pick.step) ?? startStep(last) ?? ladder[0]!;
  const target = ctx.pantries.find((p) => pantryKey(p) === pick.pantry) ?? null;
  const own = pick.pantry === pantryKey(line.line.pantry);
  const pantryRef = target ? pantryRefOf(target) : line.line.pantry;
  const currency = target?.currency ?? last.currency;
  const auto = currency === last.currency && (line.receipt?.priced ?? true) ? scaledPrice(last, step.qtyMilli) : null;
  const priceText = pick.price ?? (auto !== null ? priceInput(auto) : "");
  const priceMinor = parseMinor(priceText);
  const name = (pick.name ?? line.name).trim();
  // A receipt's line buys again only what the server matched; a restock line always its last purchase.
  const fromItemId = line.receipt ? line.receipt.fromItemId : last.itemId;
  const sendRule = line.receipt ? line.receipt.sendRule : true;
  let request: PurchaseLine | null = null;
  if (priceMinor !== null && name !== "") {
    request = {
      pantry: pick.pantry,
      name,
      category: line.line.category,
      quantity: purchaseQuantity(step.qtyMilli, last.unit),
      unit: last.unit,
      priceMinor,
      currency,
    };
    if (fromItemId) request.fromItemId = fromItemId;
    if (own && sendRule && pantryRef.kind === "group") request.wastePolicy = last.wastePolicy;
    if (last.expiresAfterDays !== null) request.expiresOn = addDays(ctx.today, Math.max(0, last.expiresAfterDays));
  }
  return {
    key: line.key,
    name,
    step,
    canLess: canStep(ladder, step.key, -1),
    canMore: canStep(ladder, step.key, 1),
    priceText,
    priceMinor,
    currency,
    prefix: currencyPrefix(currency),
    pantry: pick.pantry,
    pantryLabel: target ? pantryChipLabel(target) : pantryChipLabel(line.line.pantry),
    pantryRef,
    request,
  };
}

// ── The footer, the write, the toast ──────────────────────────────

export interface RunSummary {
  /** Lines ticked. */
  count: number;
  /** "₹449", "₹449 + $12" — what the ticked lines cost, per currency. */
  totalText: string;
  /** "Add 3 · ₹449"; "Add to kitchen" with none (RV-24: the list run's words). */
  label: string;
  /** Every ticked line reads and there are 1–PURCHASE_MAX_LINES of them. */
  ready: boolean;
  /** What is wrong, when ticked lines aren't ready: "Price for Milk", "At most 30 at once". */
  problem: string | null;
  /** The one write's body, in the run's order; null until ready. */
  request: CreatePurchaseRequest | null;
  /** The ticked lines, opened, in the run's order. */
  ticked: TickedLine[];
}

/** "₹449", or several currencies joined: "₹449 + $12". */
export function totalText(lines: readonly Pick<TickedLine, "priceMinor" | "currency">[]): string {
  const totals = new Map<string, number>();
  for (const l of lines) if (l.priceMinor !== null) totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.priceMinor);
  if (totals.size === 0) return shortMoney(0, lines[0]?.currency ?? "INR");
  return [...totals].map(([c, m]) => shortMoney(m, c)).join(" + ");
}

export function runSummary(lines: readonly RunLine[], picks: RunPicks, ctx: { pantries: readonly Pantry[]; today: string }): RunSummary {
  const ticked = lines.filter((l) => l.tickable && picks[l.key]).map((l) => tickedLine(l, picks[l.key]!, ctx));
  const count = ticked.length;
  const total = totalText(ticked);
  const unread = ticked.find((t) => t.request === null);
  const name = unread ? unread.name || (lines.find((l) => l.key === unread.key)?.receipt?.text ?? "it") : null;
  const problem =
    count > PURCHASE_MAX_LINES
      ? `At most ${PURCHASE_MAX_LINES} at once`
      : unread && unread.name === ""
        ? `A name for ${name}`
        : name
          ? `Price for ${name}`
          : null;
  const ready = count > 0 && problem === null;
  return {
    count,
    totalText: total,
    label: count === 0 ? "Add to kitchen" : `Add ${count} · ${total}`,
    ready,
    problem: count > 0 ? problem : null,
    request: ready ? { lines: ticked.map((t) => t.request!) } : null,
    ticked,
  };
}

/** The write's toast: "Added 3 to your kitchen · ₹449". */
export function runToast(summary: Pick<RunSummary, "count" | "totalText">): string {
  return `Added ${summary.count} to your kitchen · ${summary.totalText}`;
}
