/**
 * The dish maker (Cookpool CP-15) as pure view-models: one dish from any mix
 * of pantries and things just bought — the ingredient lines and their
 * steppers, what each line costs (the engine's `costOfUse`, through the item
 * page's `amountCost`, so the last of an item costs what is left of its
 * price), the dish total and each portion, what the cook takes on from each
 * group (the engine's `buildIngredientTake` per group, read pairwise with
 * `pairLines`), who to share it with, who ate what (`buildDish`, the cook's
 * share first, as the server splits it), the green note that says what nets
 * against what, and the requests it posts (`cookDish`, then
 * `setDishShares` in assign mode). Dependency-free (contract types and the
 * engine), so it is unit-testable.
 *
 * Money is integer minor units and quantities thousandths of a base unit;
 * nothing here does arithmetic on money the engine does not.
 */

import {
  DEFAULT_KITCHEN_CURRENCY,
  MAX_DISH_INGREDIENTS,
  type CookDishRequest,
  type CookIngredientRequest,
  type CookNewItemRequest,
  type DishSplitMode,
  type KitchenItem,
  type KitchenMeasure,
  type MyGroupBalance,
  type SetDishSharesRequest,
} from "@saas/contracts/kitchen";
import { costOfUse, splitByWeights } from "@saas/kitchen-engine/money";
import { buildDish, buildIngredientTake, pairLines, type DishShare, type Txn } from "@saas/kitchen-engine/ledger";
import { dimensionOf, formatQuantity, type Dimension, type UnitKey } from "@saas/kitchen-engine/units";
import { formatMinor, moneyInputMessage, parseMoney } from "./money";
import { AMOUNT_STEPS, amountCost, milliToDecimal, type AmountStep } from "./item-use";
import { ITEM_NAME_MAX, parseQuantity, perUnitLine } from "./item-form";
import { countWords, itemHref, itemRefParam, joinNames, type ItemRef } from "./pantry";
import { memberLabel, memberLabelInline, type MemberNames } from "./members";
import { foldForSearch, roleFromKitchen, sortGroups } from "./groups";
import { countDecimal, countText, evenCount, isApprox, maxCount, measureAmount, measuresOf, nearestCount, stepCount, takeOf } from "./measures";

/** The most a dish takes: existing items and just-bought ones together (the server's limit). */
export { MAX_DISH_INGREDIENTS };

/** The server's limit on a dish's name. */
export const DISH_NAME_MAX = 120;

/** Portions are whole on the stepper (the API counts halves): 1 to 100. */
export const MAX_PORTIONS = 100;

/** Extras step by ₹5. */
export const EXTRAS_STEP_MINOR = 500;

/** Where the portions stepper starts. */
export const DEFAULT_PORTIONS = 4;

/** The share choice that splits nothing. */
export const JUST_ME = "me";

/** What a just-bought item is filed under (the add form's id for "Other"). */
export const NEW_ITEM_CATEGORY = "other";

/** The dish maker with an item already in the dish: `/cook?item=me:itm_…` (Cook with it, on the item page). */
export function cookHref(ref?: ItemRef | null): string {
  return ref ? `/cook?item=${itemRefParam(ref)}` : "/cook";
}

/** The dish's page (CP-17). */
export function dishHref(dishId: string): string {
  return `/dishes/${encodeURIComponent(dishId)}`;
}

// ── Lines ─────────────────────────────────────────────────────────

/** Something from a pantry: your own, or a group's. */
export interface PantryLine {
  kind: "pantry";
  /** The item's `itm_…`. */
  key: string;
  item: KitchenItem;
  /** How much goes in, in thousandths of the item's base unit (in a measure: what it takes, `measureTakeMilli`). */
  qtyMilli: number;
  /** Counted in one of the item's measures (SM-14): "3 onions" — sent as `measure`, kept as the ingredient's words. */
  counted?: { measure: KitchenMeasure; quantity: number } | null;
}

/** Bought just now: it goes into your pantry, paid by you, and (some of) it into the dish. */
export interface NewLine {
  kind: "new";
  /** `new:1`, `new:2` … */
  key: string;
  name: string;
  /** What was bought, as typed and normalized ("1.5"), in `unit`. */
  quantity: string;
  unit: UnitKey;
  dimension: Dimension;
  /** What was bought, in thousandths of the base unit. */
  qtyMilli: number;
  priceMinor: number;
  /** How much of it goes in (everything, to start with). */
  useMilli: number;
}

export type DishLine = PantryLine | NewLine;

/** How much of the line goes into the dish. */
export function lineQty(line: DishLine): number {
  return line.kind === "pantry" ? line.qtyMilli : line.useMilli;
}

/** The most the line can take: what is left of the item, or everything just bought. */
export function lineMax(line: DishLine): number {
  return line.kind === "pantry" ? line.item.qtyLeftMilli : line.qtyMilli;
}

export function lineDimension(line: DishLine): Dimension {
  return line.kind === "pantry" ? line.item.dimension : line.dimension;
}

/** The same line with another amount, in the unit. */
export function withQty<T extends DishLine>(line: T, qtyMilli: number): T {
  // An amount in the unit: a line counted in a measure goes back to the unit.
  return line.kind === "pantry" ? { ...line, qtyMilli, counted: null } : { ...line, useMilli: qtyMilli };
}

/**
 * The stepper for an ingredient: the base unit (g, ml, pcs, pack), in steps
 * sized to what was bought — 10 g of a small pack of something, 25 g of up to
 * a kilo, 50 g up to three, 100 g beyond; one piece; one pack (the item page's
 * steps, finer for small amounts, since a dish takes a spoon of some things).
 */
export function dishStep(dimension: Dimension, boughtMilli: number): AmountStep {
  const base = AMOUNT_STEPS[dimension];
  if (dimension !== "mass" && dimension !== "volume") return base;
  const bought = boughtMilli / 1000;
  const step = bought <= 250 ? 10 : bought <= 1000 ? 25 : bought <= 3000 ? 50 : 100;
  return { unit: base.unit, stepMilli: step * 1000 };
}

export function lineStep(line: DishLine): AmountStep {
  return line.kind === "pantry" ? dishStep(line.item.dimension, line.item.qtyBoughtMilli) : dishStep(line.dimension, line.qtyMilli);
}

/** Where an ingredient starts: four steps of a weight or volume, one piece or pack — never more than is left. */
export function startAmount(dimension: Dimension, boughtMilli: number, leftMilli: number): number {
  const { stepMilli } = dishStep(dimension, boughtMilli);
  const want = dimension === "mass" || dimension === "volume" ? stepMilli * 4 : stepMilli;
  return Math.max(0, Math.min(want, leftMilli));
}

/**
 * One step up or down, onto the step grid (130 g + 25 g → 150 g), never above
 * what is left; a step down from the smallest amount (one step, or all that is
 * left) is 0, which takes the ingredient out of the dish.
 */
export function stepDishAmount(current: number, delta: 1 | -1, step: AmountStep, leftMilli: number): number {
  const { stepMilli } = step;
  if (delta > 0) return Math.min(Math.floor(current / stepMilli) * stepMilli + stepMilli, leftMilli);
  const smallest = Math.min(stepMilli, leftMilli);
  if (current <= smallest) return 0;
  return Math.max(Math.ceil(current / stepMilli) * stepMilli - stepMilli, smallest);
}

/**
 * A line for an item from a pantry, at its starting amount: one of its first
 * measure when it has one that fits ("1 onion"), else a few steps of its unit.
 */
export function pantryLine(item: KitchenItem, qtyMilli?: number): PantryLine {
  const first = measuresOf(item)[0];
  const one = qtyMilli === undefined && first ? measureAmount(item, first, 1) : null;
  if (one) return { kind: "pantry", key: item.id, item, qtyMilli: one.qtyMilli, counted: { measure: first!, quantity: 1 } };
  return {
    kind: "pantry",
    key: item.id,
    item,
    qtyMilli: qtyMilli ?? startAmount(item.dimension, item.qtyBoughtMilli, item.qtyLeftMilli),
  };
}

// ── An ingredient in a measure (SM-14) ────────────────────────────

/** The line counted in `quantity` of its measure; null when that doesn't fit what is left. */
export function countLine(line: PantryLine, measure: KitchenMeasure, quantity: number): PantryLine | null {
  const a = measureAmount(line.item, measure, quantity);
  return a ? { ...line, qtyMilli: a.qtyMilli, counted: { measure, quantity } } : null;
}

/** One step of a counted line (½ ↔ 1, then whole ones); null when it steps below ½, which takes it out. */
export function stepLineCount(line: PantryLine, delta: 1 | -1): PantryLine | null {
  if (!line.counted) return line;
  const { measure, quantity } = line.counted;
  const next = stepCount(quantity, delta, maxCount(line.item, measure));
  if (next <= 0) return null;
  return countLine(line, measure, next) ?? line;
}

/**
 * The line in the item's measure or its unit — the same amount, as near as
 * the other side counts it: 450 g of onions at 150 g each is 3 onions, and 3
 * onions back in grams is 450 g (onto the stepper's grid).
 */
export function switchLine(line: PantryLine, side: "measure" | "unit"): PantryLine {
  const measure = measuresOf(line.item)[0];
  if (side === "measure") {
    if (!measure || line.counted) return line;
    const max = maxCount(line.item, measure);
    if (max <= 0) return line;
    return countLine(line, measure, nearestCount(line.qtyMilli, measure, max)) ?? line;
  }
  if (!line.counted) return line;
  const { stepMilli } = lineStep(line);
  const left = line.item.qtyLeftMilli;
  const qtyMilli = Math.min(Math.max(Math.round(line.qtyMilli / stepMilli) * stepMilli, Math.min(stepMilli, left)), left);
  return { ...line, qtyMilli, counted: null };
}

/**
 * An amount in the item's unit (a recipe's) in its measure when it divides
 * evenly into halves of one ("300 g" of 150 g onions → 2 onions); else as it
 * is, in the unit.
 */
export function lineInEvenMeasure(line: PantryLine): PantryLine {
  if (line.counted) return line;
  const even = evenCount(line.item, line.qtyMilli);
  return even ? { ...line, counted: even } : line;
}

/** Add an item, once: a second Add of the same item leaves the dish as it is. */
export function addPantryLine(lines: readonly DishLine[], item: KitchenItem): DishLine[] {
  if (lines.some((l) => l.kind === "pantry" && l.key === item.id)) return [...lines];
  return [...lines, pantryLine(item)];
}

/** The inline "Bought it just now?" form, as typed. */
export interface NewItemDraft {
  name: string;
  /** In `unit`: "1", "1.5". */
  quantity: string;
  unit: UnitKey;
  /** As typed: "40", "249.50". */
  price: string;
}

export function emptyNewItem(name = ""): NewItemDraft {
  return { name, quantity: "", unit: "g", price: "" };
}

export type NewItemField = "name" | "quantity" | "price";

export interface NewItemPreview {
  errors: Partial<Record<NewItemField, string>>;
  /** "₹380.00 per kg · ₹38.00 per 100 g", once quantity and price read. */
  perUnit: string | null;
  /** The line it becomes (all of it in the dish); null while anything is wrong. */
  line: NewLine | null;
}

/**
 * Check the "Bought it just now?" form (name, how much in a unit, what you
 * paid) — the quantity by the engine's `toMilli`, the price by its digits —
 * and make it a line: all of it goes in, until the stepper says less.
 */
export function previewNewItem(draft: NewItemDraft, key: string, currency: string): NewItemPreview {
  const errors: Partial<Record<NewItemField, string>> = {};
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (!name) errors.name = "Say what you bought";
  else if (name.length > ITEM_NAME_MAX) errors.name = `Keep it under ${ITEM_NAME_MAX} characters`;
  const qty = parseQuantity(draft.quantity, draft.unit);
  if (!qty.ok) errors.quantity = qty.message;
  const money = parseMoney(draft.price);
  const priceMessage = moneyInputMessage(money);
  if (priceMessage) errors.price = priceMessage === "Enter the amount" ? "Enter what you paid" : priceMessage;
  const perUnit = qty.ok && money.ok ? perUnitLine(money.minor, qty.milli, draft.unit, currency) : null;
  const line: NewLine | null =
    Object.keys(errors).length === 0 && qty.ok && money.ok
      ? {
          kind: "new",
          key,
          name,
          quantity: qty.text,
          unit: draft.unit,
          dimension: dimensionOf(draft.unit),
          qtyMilli: qty.milli,
          priceMinor: money.minor,
          useMilli: qty.milli,
        }
      : null;
  return { errors, perUnit, line };
}

/** What the line costs, by the engine: in proportion to what was paid, the last of an item what is left of its price. */
export function lineCost(line: DishLine): number {
  const qty = lineQty(line);
  if (line.kind === "pantry") {
    const take = Math.min(qty, line.item.qtyLeftMilli);
    return take > 0 ? amountCost(line.item, take) : 0;
  }
  if (qty <= 0) return 0;
  return costOfUse({ priceMinor: line.priceMinor, qtyBoughtMilli: line.qtyMilli, qtyLeftMilli: line.qtyMilli, costTakenMinor: 0 }, Math.min(qty, line.qtyMilli));
}

/** Who paid for the line's ingredient: its buyer, or you for something just bought. */
export function linePayer(line: DishLine, meId: string): string {
  return line.kind === "pantry" ? line.item.paidBy : meId;
}

/** The group pantry the line comes from, or null (your own pantry, or just bought). */
export function lineGroup(line: DishLine): { orgId: string; name: string } | null {
  if (line.kind !== "pantry" || line.item.pantry.kind !== "group") return null;
  return { orgId: line.item.pantry.orgId, name: line.item.pantry.name };
}

/** "from 3 pantries", "from your pantry": your own (and what you just bought) count as one. */
export function pantriesText(lines: readonly DishLine[]): string | null {
  if (lines.length === 0) return null;
  const keys = new Set(lines.map((l) => lineGroup(l)?.orgId ?? "personal"));
  if (keys.size === 1 && keys.has("personal")) return "from your pantry";
  return `from ${countWords(keys.size, "pantry", "pantries")}`;
}

// ── One line, as shown ────────────────────────────────────────────

export interface SourceChip {
  /** "Your pantry", "Just bought", "Flat 4B · Anu paid". */
  label: string;
  /** Green for what is yours, blue for a group's. */
  tone: "mine" | "group";
}

export function sourceChip(line: DishLine, meId: string, names?: MemberNames | null): SourceChip {
  if (line.kind === "new") return { label: "Just bought", tone: "mine" };
  const pantry = line.item.pantry;
  if (pantry.kind === "personal") return { label: "Your pantry", tone: "mine" };
  return { label: `${pantry.name} · ${memberLabelInline(line.item.paidBy, meId, names)} paid`, tone: "group" };
}

export interface LineView {
  key: string;
  name: string;
  chip: SourceChip;
  costMinor: number;
  /** "yours", "you owe Anu". */
  owe: string;
  /** You paid for it: "yours" in grey; else orange. */
  mine: boolean;
  /** The desktop table's "You owe": "—", or "Anu ₹12.00". */
  oweColumn: string;
  /** Who paid for it: "You", "Anu". */
  payer: string;
  qtyMilli: number;
  step: AmountStep;
  /** "300 g", in the stepper's unit. */
  amount: string;
  /** "100 g left", "uses it all", "800 g stays in your pantry". */
  leftNote: string;
  /** The most it can take. */
  max: number;
  /** Labels for the stepper's buttons: "Less tomatoes" / "Take out tomatoes", "More tomatoes". */
  lessLabel: string;
  moreLabel: string;
  /** At the smallest amount: one more step down takes the ingredient out (a tap does; a held − stops here, PW-8). */
  atSmallest: boolean;
  /** The item's page, for a pantry line. */
  href: string | null;
  dimension: Dimension;
  /** Counted in the item's measure: the count ("3", "1½") and its word ("onions"); null in the unit. */
  counted: { count: string; quantity: number; word: string; max: number } | null;
  /** The [onions | g] switch, when the item has a measure; null otherwise. */
  sides: { measure: string; unit: string; on: "measure" | "unit" } | null;
}

export function lineView(line: DishLine, ctx: { meId: string; names?: MemberNames | null; currency: string }): LineView {
  const { meId, names } = ctx;
  const qty = lineQty(line);
  const step = lineStep(line);
  const dimension = lineDimension(line);
  const max = lineMax(line);
  const costMinor = lineCost(line);
  const payer = linePayer(line, meId);
  const mine = payer === meId;
  const name = line.kind === "pantry" ? line.item.name : line.name;
  const lower = name.toLowerCase();
  const rest = max - qty;
  let leftNote: string;
  if (line.kind === "pantry") {
    leftNote = rest <= 0 ? "uses it all" : `${formatQuantity(rest, dimension, line.item.displayUnit)} left`;
  } else {
    leftNote = rest <= 0 ? "uses it all" : `${formatQuantity(rest, dimension, line.unit)} stays in your pantry`;
  }
  const measure = line.kind === "pantry" ? (measuresOf(line.item)[0] ?? null) : null;
  const counted = line.kind === "pantry" && line.counted ? line.counted : null;
  if (counted) {
    // The other side under a count: "≈ 450 g" (a weight or volume), "450 g" counted, nothing for slices of a pack.
    const amount = formatQuantity(qty, dimension, step.unit);
    leftNote = dimension === "pack" ? "" : isApprox(dimension) ? `≈ ${amount}` : amount;
  }
  const atSmallest = counted ? counted.quantity <= 0.5 : qty <= Math.min(step.stepMilli, max);
  return {
    key: line.key,
    name,
    chip: sourceChip(line, meId, names),
    costMinor,
    owe: mine ? "yours" : `you owe ${memberLabel(payer, meId, names)}`,
    mine,
    oweColumn: mine ? "—" : `${memberLabel(payer, meId, names)} ${formatMinor(costMinor, ctx.currency)}`,
    payer: memberLabel(payer, meId, names),
    qtyMilli: qty,
    step,
    amount: formatQuantity(qty, dimension, step.unit),
    leftNote,
    max,
    lessLabel: atSmallest ? `Take out ${lower}` : `Less ${lower}`,
    moreLabel: `More ${lower}`,
    atSmallest,
    href: line.kind === "pantry" ? itemHref(line.item) : null,
    dimension,
    counted:
      counted && line.kind === "pantry"
        ? {
            count: countText(counted.quantity),
            quantity: counted.quantity,
            word: counted.quantity <= 1 ? counted.measure.one : counted.measure.many,
            max: maxCount(line.item, counted.measure),
          }
        : null,
    sides: measure ? { measure: measure.many, unit: step.unit, on: counted ? "measure" : "unit" } : null,
  };
}

// ── The cost card: totals, portions and what you take on ──────────

export interface OweLine {
  orgId: string;
  groupName: string;
  buyerId: string;
  amountMinor: number;
}

export interface GroupTake {
  orgId: string;
  groupName: string;
  /** What the dish takes from this group's pantry, the cook's own purchases there included. */
  totalMinor: number;
  /** What the cook owes each buyer there, in the order the lines name them. */
  owes: OweLine[];
}

/**
 * What the cook takes on from each group pantry, by the engine: per group,
 * `buildIngredientTake` over its lines (each buyer is paid back, the cook owes
 * it all), read pairwise with `pairLines` — so a group item the cook paid for
 * themselves is no debt. Groups and buyers in the order the lines name them.
 */
export function groupTakes(lines: readonly DishLine[], meId: string): GroupTake[] {
  const byOrg = new Map<string, { name: string; lines: { buyerId: string; costMinor: number }[] }>();
  for (const line of lines) {
    const group = lineGroup(line);
    if (!group || line.kind !== "pantry") continue;
    const entry = byOrg.get(group.orgId) ?? { name: group.name, lines: [] };
    entry.lines.push({ buyerId: line.item.paidBy, costMinor: lineCost(line) });
    byOrg.set(group.orgId, entry);
  }
  return [...byOrg.entries()].map(([orgId, g]) => {
    const take = buildIngredientTake({ cookId: meId, lines: g.lines });
    const txn: Txn = { id: orgId, kind: "use", title: g.name, totalMinor: take.totalMinor, splits: take.splits };
    const owes = pairLines([txn])
      .filter((l) => l.debtorId === meId)
      .map((l) => ({ orgId, groupName: g.name, buyerId: l.creditorId, amountMinor: l.amountMinor }));
    return { orgId, groupName: g.name, totalMinor: take.totalMinor, owes };
  });
}

export interface DishTotals {
  currency: string;
  ingredientsMinor: number;
  extrasMinor: number;
  /** Ingredients plus extras. */
  totalMinor: number;
  /** What you paid for already: your own pantry, what you just bought, what you bought for a group. */
  fromMineMinor: number;
  /** Every line you paid for is from your own pantry or just bought (none is a group item you bought). */
  mineIsPantry: boolean;
  takes: GroupTake[];
  /** Every buyer you owe, group by group. fromMineMinor + Σ owes = ingredientsMinor. */
  owes: OweLine[];
  portionsHalf: number;
  /** One portion, to the nearest paisa; `perPortionExact` when the total divides evenly. */
  perPortionMinor: number;
  perPortionExact: boolean;
}

export function dishTotals(input: {
  lines: readonly DishLine[];
  extrasMinor: number;
  portionsHalf: number;
  meId: string;
  currency: string;
}): DishTotals {
  const { lines, meId } = input;
  let ingredientsMinor = 0;
  let fromMineMinor = 0;
  let mineIsPantry = true;
  for (const line of lines) {
    const cost = lineCost(line);
    ingredientsMinor += cost;
    if (linePayer(line, meId) === meId) {
      fromMineMinor += cost;
      if (lineGroup(line)) mineIsPantry = false;
    }
  }
  const takes = groupTakes(lines, meId);
  const totalMinor = ingredientsMinor + input.extrasMinor;
  const halves = Math.max(1, input.portionsHalf);
  return {
    currency: input.currency,
    ingredientsMinor,
    extrasMinor: input.extrasMinor,
    totalMinor,
    fromMineMinor,
    mineIsPantry,
    takes,
    owes: takes.flatMap((t) => t.owes),
    portionsHalf: halves,
    perPortionMinor: Math.round((totalMinor * 2) / halves),
    perPortionExact: (totalMinor * 2) % halves === 0,
  };
}

/** "₹52.75", or "about ₹33.33" when a portion is not a whole number of paise. */
export function perPortionText(totals: Pick<DishTotals, "perPortionMinor" | "perPortionExact" | "currency">): string {
  const money = formatMinor(totals.perPortionMinor, totals.currency);
  return totals.perPortionExact ? money : `about ${money}`;
}

/**
 * The cost on the main button, in one line (SM-15: the dark five-line cost
 * card is gone; each line already says whom you owe for it): "₹156.00 · 4
 * portions · ₹39.00 each" ("≈ ₹33.33 each" when a portion is not a whole
 * number of paise). Null while the dish costs nothing.
 */
export function costLine(totals: Pick<DishTotals, "totalMinor" | "portionsHalf" | "perPortionMinor" | "perPortionExact" | "currency">): string | null {
  if (totals.totalMinor <= 0) return null;
  const portions = portionsText(totals.portionsHalf);
  const each = `${totals.perPortionExact ? "" : "≈ "}${formatMinor(totals.perPortionMinor, totals.currency)} each`;
  return `${formatMinor(totals.totalMinor, totals.currency)} · ${portions} ${portions === "1" || portions === "½" ? "portion" : "portions"} · ${each}`;
}

// ── The dish's currency ───────────────────────────────────────────

/**
 * The currency every line must count in: the group a dish is shared with
 * decides, else the first ingredient from a pantry; what was just bought
 * takes the dish's. Null while nothing decides yet.
 */
export function linesCurrency(lines: readonly DishLine[]): string | null {
  for (const l of lines) if (l.kind === "pantry") return l.item.currency;
  return null;
}

/** The dish's currency, as the server works it out: the shared group's, else the first ingredient's, else INR. */
export function dishCurrency(lines: readonly DishLine[], groupCurrency: string | null): string {
  return groupCurrency ?? linesCurrency(lines) ?? DEFAULT_KITCHEN_CURRENCY;
}

/** The first line that counts in another currency than `currency`, as a sentence; null when all agree. */
export function currencyProblem(lines: readonly DishLine[], currency: string): string | null {
  const odd = lines.find((l) => l.kind === "pantry" && l.item.currency !== currency);
  if (!odd || odd.kind !== "pantry") return null;
  return `${odd.item.name} counts in ${odd.item.currency}, and this dish is in ${currency}. Take it out to cook.`;
}

// ── Taking from any pantry ────────────────────────────────────────

export interface PantryResult {
  key: string;
  item: KitchenItem;
  name: string;
  /** "Your pantry", "Flat 4B". */
  pantry: string;
  /** "Flat 4B · Anu paid · 400 g left", "Your pantry · 450 g left". */
  meta: string;
  /** Already in the dish. */
  added: boolean;
  /** Why it can't go in ("Counts in USD"), or null. */
  disabledReason: string | null;
}

/** A search match or pantry item as the "Take from any pantry" list shows it. */
export function pantryResult(
  item: KitchenItem,
  ctx: { lines: readonly DishLine[]; currency: string | null; meId: string; names?: MemberNames | null },
): PantryResult {
  const pantry = item.pantry.kind === "personal" ? "Your pantry" : item.pantry.name;
  const left = `${formatQuantity(item.qtyLeftMilli, item.dimension, item.displayUnit)} left`;
  const meta =
    item.pantry.kind === "personal"
      ? `${pantry} · ${left}`
      : `${pantry} · ${memberLabelInline(item.paidBy, ctx.meId, ctx.names)} paid · ${left}`;
  return {
    key: item.id,
    item,
    name: item.name,
    pantry,
    meta,
    added: ctx.lines.some((l) => l.kind === "pantry" && l.key === item.id),
    disabledReason: ctx.currency !== null && item.currency !== ctx.currency ? `Counts in ${item.currency}` : null,
  };
}

/** Items you may cook with (active, something left, not a viewer's group), as the list shows them. */
export function pantryResults<T extends KitchenItem & { canUse?: boolean }>(
  items: readonly T[],
  ctx: { lines: readonly DishLine[]; currency: string | null; meId: string; names?: MemberNames | null; limit?: number },
): PantryResult[] {
  const out = items
    .filter((i) => (i.canUse ?? true) && i.state === "active" && i.qtyLeftMilli > 0)
    .map((i) => pantryResult(i, ctx));
  return ctx.limit === undefined ? out : out.slice(0, ctx.limit);
}

// ── Share it with ─────────────────────────────────────────────────

/** The groups a dish can be shared with: those you cook in (not a viewer's). */
export function cookingGroups(groups: readonly MyGroupBalance[]): MyGroupBalance[] {
  return groups.filter((g) => {
    const role = roleFromKitchen(g.role);
    return role !== null && role !== "viewer";
  });
}

/** Groups as the shared recent-first sort takes them. */
function asGroupLike(g: MyGroupBalance) {
  return { id: g.orgId, name: g.name, slug: g.slug, createdAt: "" };
}

/** Recent first (then by name). */
export function orderCookingGroups(groups: readonly MyGroupBalance[], recentSlugs: readonly string[] = []): MyGroupBalance[] {
  const byId = new Map(groups.map((g) => [g.orgId, g] as const));
  return sortGroups(groups.map(asGroupLike), "recent", recentSlugs).map((g) => byId.get(g.id)!);
}

/**
 * Who the dish is for, until the cook picks: the group of the item they came
 * to cook with, else the group they opened last — one that counts in the
 * dish's currency, when its ingredients already fix one — else just them.
 */
export function defaultShare(
  groups: readonly MyGroupBalance[],
  opts: { linkedOrgId?: string | null; recentSlugs?: readonly string[]; currency?: string | null },
): string {
  const ok = (g: MyGroupBalance) => !opts.currency || g.currency === opts.currency;
  const cooking = cookingGroups(groups);
  const linked = opts.linkedOrgId ? cooking.find((g) => g.orgId === opts.linkedOrgId && ok(g)) : undefined;
  if (linked) return linked.orgId;
  const first = orderCookingGroups(cooking, opts.recentSlugs).find(ok);
  return first ? first.orgId : JUST_ME;
}

export interface ShareOption {
  /** JUST_ME, or the group's `org_…`. */
  key: string;
  kind: "me" | "group";
  name: string;
  /** "Don't split it", "5 people", "3 people · counts in USD". */
  meta: string;
  /** Why it can't be picked ("Counts in USD"), or null. */
  disabledReason: string | null;
  group: MyGroupBalance | null;
}

export interface ShareOptions {
  options: ShareOption[];
  /** Groups left out until a search. */
  more: number;
  /** "Recent · search to see all 8", "Matches", or null. */
  heading: string | null;
}

export const JUST_ME_OPTION: Omit<ShareOption, "disabledReason"> = {
  key: JUST_ME,
  kind: "me",
  name: "Just me",
  meta: "Don't split it",
  group: null,
};

function groupOption(g: MyGroupBalance, currency: string | null): ShareOption {
  const other = currency !== null && g.currency !== currency;
  return {
    key: g.orgId,
    kind: "group",
    name: g.name,
    meta: [countWords(g.memberCount, "person", "people"), other ? `counts in ${g.currency}` : null].filter(Boolean).join(" · "),
    disabledReason: other ? `Counts in ${g.currency}` : null,
    group: g,
  };
}

/**
 * "Share it with": Just me (don't split), then the groups you cook in, the
 * ones opened last first — five until a search, which matches every word of a
 * name. A group counting in another currency than the ingredients is shown
 * but can't be picked.
 */
export function shareOptions(
  groups: readonly MyGroupBalance[],
  opts: {
    query?: string;
    recentSlugs?: readonly string[];
    currency?: string | null;
    limit?: number;
    /** Groups only, no Just me (cookpool-community CM-9: splitting a dish of yours later). */
    groupsOnly?: boolean;
  } = {},
): ShareOptions {
  const currency = opts.currency ?? null;
  const ordered = orderCookingGroups(cookingGroups(groups), opts.recentSlugs);
  const words = foldForSearch(opts.query ?? "").split(" ").filter(Boolean);
  const me: ShareOption[] = opts.groupsOnly ? [] : [{ ...JUST_ME_OPTION, disabledReason: null }];
  if (words.length > 0) {
    const hit = (text: string) => words.every((w) => foldForSearch(text).includes(w));
    const options = [
      ...me.filter(() => hit("just me don't split")),
      ...ordered.filter((g) => hit(g.name)).map((g) => groupOption(g, currency)),
    ];
    return { options, more: 0, heading: "Matches" };
  }
  const limit = opts.limit ?? 5;
  const shown = ordered.slice(0, limit);
  const more = ordered.length - shown.length;
  return {
    options: [...me, ...shown.map((g) => groupOption(g, currency))],
    more,
    heading: more > 0 ? `Recent · search to see all ${ordered.length}` : null,
  };
}

/** The picker's button: the choice, and how many people are in it. */
export function shareChoice(share: string, groups: readonly MyGroupBalance[]): { name: string; meta: string; group: MyGroupBalance | null } {
  const g = share === JUST_ME ? undefined : groups.find((x) => x.orgId === share);
  if (!g) return { name: JUST_ME_OPTION.name, meta: JUST_ME_OPTION.meta, group: null };
  return { name: g.name, meta: countWords(g.memberCount, "person", "people"), group: g };
}

// ── Who ate? ──────────────────────────────────────────────────────

export interface SplitModeOption {
  id: DishSplitMode;
  label: string;
}

/** The two ways a shared dish is split, in two words each (the audit's Top 15, item 13). */
export const SPLIT_MODES: readonly SplitModeOption[] = [
  { id: "claims", label: "Everyone claims" },
  { id: "assign", label: "I'll assign" },
];

/** Half portions in words: 0 → "0", 1 → "½", 3 → "1½", 4 → "2". */
export function portionsText(half: number): string {
  const whole = Math.floor(half / 2);
  if (half % 2 === 0) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

/** Who can be named as having eaten: you first, then the group's order (oldest member first). */
export function eaterOrder(roster: readonly string[], meId: string): string[] {
  return [meId, ...roster.filter((id) => id !== meId)].filter((id, i, all) => all.indexOf(id) === i);
}

/** The shares as sent and as the server splits them: you first, then the group's order; nobody at zero. */
export function eaterShares(halves: Readonly<Record<string, number>>, roster: readonly string[], meId: string): DishShare[] {
  return eaterOrder(roster, meId)
    .filter((id) => (halves[id] ?? 0) > 0)
    .map((id) => ({ subjectId: id, portionsHalf: halves[id]! }));
}

/** PUT …/dishes/{dsh}/shares, right after cooking in assign mode. */
export function sharesRequest(halves: Readonly<Record<string, number>>, roster: readonly string[], meId: string): SetDishSharesRequest {
  return { shares: eaterShares(halves, roster, meId).map((s) => ({ subjectId: s.subjectId, portionsHalf: s.portionsHalf! })) };
}

/** Where assign mode starts: you, one portion (or all of it, when less). */
export function startingHalves(meId: string, portionsHalf: number): Record<string, number> {
  return { [meId]: Math.min(2, portionsHalf) };
}

export interface EaterRow {
  subjectId: string;
  /** "You", "Anu". */
  label: string;
  half: number;
  /** "1½" */
  portions: string;
  /** What they owe for the dish (yours without the portions nobody is down for). */
  amountMinor: number;
  canLess: boolean;
  canMore: boolean;
}

export interface EaterView {
  rows: EaterRow[];
  claimedHalf: number;
  /** Portions nobody is down for: they fall to you. */
  unclaimedHalf: number;
  /** What those are worth (part of your share, and the leftovers' price once finalized). */
  unclaimedMinor: number;
  /** More given out than cooked. */
  over: boolean;
}

/**
 * Who ate what, live: each person's half portions and what they owe — the
 * engine's `buildDish` over the shares as they will be sent (you first, then
 * the group's order), so the odd paisa lands where the server's does; the
 * portions nobody is down for fall to you and are shown apart.
 */
export function eaterView(input: {
  roster: readonly string[];
  meId: string;
  halves: Readonly<Record<string, number>>;
  totalMinor: number;
  portionsHalf: number;
  names?: MemberNames | null;
}): EaterView {
  const { meId, halves, totalMinor, portionsHalf } = input;
  const order = eaterOrder(input.roster, meId);
  const shares = eaterShares(halves, input.roster, meId);
  const claimedHalf = shares.reduce((a, s) => a + (s.portionsHalf ?? 0), 0);
  const over = claimedHalf > portionsHalf;
  const unclaimedHalf = over ? 0 : portionsHalf - claimedHalf;
  let owedBy = new Map<string, number>();
  if (!over && portionsHalf >= 1) owedBy = buildDish({ cookId: meId, totalMinor, portionsHalf, shares }).owedBy;
  const cookOwed = owedBy.get(meId) ?? 0;
  const myHalf = halves[meId] ?? 0;
  const unclaimedMinor = unclaimedHalf > 0 && cookOwed > 0 ? splitByWeights(cookOwed, [myHalf, unclaimedHalf])[1]! : 0;
  const rows = order.map((id) => {
    const half = halves[id] ?? 0;
    return {
      subjectId: id,
      label: memberLabel(id, meId, input.names),
      half,
      portions: portionsText(half),
      amountMinor: id === meId ? cookOwed - unclaimedMinor : (owedBy.get(id) ?? 0),
      canLess: half > 0,
      canMore: claimedHalf < portionsHalf,
    };
  });
  return { rows, claimedHalf, unclaimedHalf, unclaimedMinor, over };
}

// ── Cooking it ────────────────────────────────────────────────────

export interface DishForm {
  name: string;
  lines: readonly DishLine[];
  extrasMinor: number;
  portionsHalf: number;
  /** JUST_ME or the group's `org_…`. */
  share: string;
  mode: DishSplitMode;
}

/**
 * POST /v1/kitchen/me/dishes: each pantry ingredient in its base unit (as a
 * use is sent) or in its measure ("3" onions), then what was just bought — all of it unless less goes in;
 * a dish just for you is assigned (claims need a group).
 */
export function cookRequest(form: DishForm): CookDishRequest {
  const shared = form.share !== JUST_ME;
  const ingredients: CookIngredientRequest[] = [];
  const newItems: CookNewItemRequest[] = [];
  for (const line of form.lines) {
    if (line.kind === "pantry") {
      if (line.qtyMilli <= 0) continue;
      // In a measure (SM-14): its count and word; the server takes what `measureTakeMilli` says and keeps "3 onions".
      ingredients.push(
        line.counted
          ? { itemId: line.item.id, quantity: countDecimal(line.counted.quantity), measure: line.counted.measure.one }
          : { itemId: line.item.id, quantity: milliToDecimal(line.qtyMilli), unit: AMOUNT_STEPS[line.item.dimension].unit },
      );
    } else {
      if (line.useMilli <= 0) continue;
      newItems.push({
        name: line.name,
        category: NEW_ITEM_CATEGORY,
        quantity: line.quantity,
        unit: line.unit,
        priceMinor: line.priceMinor,
        ...(line.useMilli < line.qtyMilli
          ? { useQuantity: milliToDecimal(line.useMilli), useUnit: AMOUNT_STEPS[line.dimension].unit }
          : {}),
      });
    }
  }
  return {
    name: form.name.trim().replace(/\s+/g, " "),
    orgId: shared ? form.share : null,
    portionsHalf: form.portionsHalf,
    extrasMinor: form.extrasMinor,
    splitMode: shared ? form.mode : "assign",
    ...(ingredients.length > 0 ? { ingredients } : {}),
    ...(newItems.length > 0 ? { newItems } : {}),
  };
}

export interface DishProblem {
  field: "lines" | "name" | "currency" | "portions";
  /** What the button says while it can't cook: "Add an ingredient", "Name the dish". */
  label: string;
  /** The longer sentence, when there is one. */
  message: string | null;
}

/** What stops the dish from cooking, first thing first; null when it is ready. */
export function dishProblem(input: { form: DishForm; currency: string; eaters: EaterView | null }): DishProblem | null {
  const { form } = input;
  if (form.lines.length === 0) return { field: "lines", label: "Add an ingredient", message: null };
  if (form.lines.length > MAX_DISH_INGREDIENTS) {
    return { field: "lines", label: `At most ${MAX_DISH_INGREDIENTS} ingredients`, message: `A dish takes at most ${MAX_DISH_INGREDIENTS} ingredients, with what you just bought.` };
  }
  const empty = form.lines.find((l) => l.kind === "pantry" && l.item.qtyLeftMilli <= 0);
  if (empty && empty.kind === "pantry") {
    return { field: "lines", label: `None of ${empty.item.name} left`, message: `Someone used the last of ${empty.item.name}. Take it out to cook.` };
  }
  const name = form.name.trim();
  if (!name) return { field: "name", label: "Name the dish", message: null };
  if (name.length > DISH_NAME_MAX) return { field: "name", label: "Shorten the name", message: `Keep the name under ${DISH_NAME_MAX} characters.` };
  const currency = currencyProblem(form.lines, input.currency);
  if (currency) return { field: "currency", label: "Mixed currencies", message: currency };
  if (input.eaters?.over) {
    return {
      field: "portions",
      label: "Too many portions given out",
      message: `You've given out ${portionsText(input.eaters.claimedHalf)} portions of ${portionsText(form.portionsHalf)}. Take some back, or cook more.`,
    };
  }
  return null;
}

/** The sticky button: "Cook & post to Flat 4B", "Cook & post the split", "Cook it" — or what is missing. */
export function ctaLabel(input: { share: string; groupName: string | null; mode: DishSplitMode; problem: DishProblem | null }): string {
  if (input.problem) return input.problem.label;
  if (input.share === JUST_ME) return "Cook it";
  return input.mode === "claims" ? `Cook & post to ${input.groupName ?? "the group"}` : "Cook & post the split";
}

/** The toast after cooking, in one line: what was cooked, what it cost, and where it went. */
export function cookedText(input: {
  name: string;
  share: string;
  groupName: string | null;
  mode: DishSplitMode;
  totalMinor: number;
  currency: string;
}): { title: string } {
  const total = formatMinor(input.totalMinor, input.currency);
  if (input.share === JUST_ME) return { title: `Cooked ${input.name} · ${total}` };
  return { title: `Cooked ${input.name} · ${total} · ${input.groupName ?? "the group"}` };
}

export interface CookRefusal {
  message: string;
  /** The item that ran short, and how much of it is left now. */
  short: { itemId: string; qtyLeftMilli: number } | null;
  /** Items in another currency. */
  itemIds: string[];
}

/**
 * What to say when cooking is refused, in words: not that much of something
 * left any more (its line is cut to what is left), an ingredient in another
 * currency, something that changed under the write, an ingredient or a group
 * that is no longer yours to use (the opaque 404), or the server's message.
 */
export function cookRefusal(
  error: { code: string; reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined },
  lines: readonly DishLine[],
): CookRefusal {
  const details = error.details ?? {};
  const named = (id: unknown) => {
    const line = lines.find((l) => l.kind === "pantry" && l.key === id);
    return line && line.kind === "pantry" ? line.item : null;
  };
  switch (error.reason) {
    case "insufficient_stock": {
      const item = named(details["itemId"]);
      const left = typeof details["qtyLeftMilli"] === "number" ? (details["qtyLeftMilli"] as number) : 0;
      const what = item ? item.name : "an ingredient";
      const message = item
        ? left > 0
          ? `Only ${formatQuantity(left, item.dimension, item.displayUnit)} of ${what} left now — someone used some meanwhile. Check the amount and cook again.`
          : `None of ${what} left now — someone used the last of it. Take it out and cook again.`
        : "Not that much of an ingredient is left any more. Check the amounts and cook again.";
      return { message, short: typeof details["itemId"] === "string" ? { itemId: details["itemId"] as string, qtyLeftMilli: left } : null, itemIds: [] };
    }
    case "currency_mismatch": {
      const ids = Array.isArray(details["itemIds"]) ? (details["itemIds"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const currency = typeof details["currency"] === "string" ? (details["currency"] as string) : "the group's currency";
      const which = ids.map((id) => named(id)?.name).filter((x): x is string => !!x);
      return {
        message: `${which.length > 0 ? joinNames(which, which.length) : "Some ingredients"} ${which.length === 1 ? "counts" : "count"} in another currency. Everything in this dish has to be in ${currency}.`,
        short: null,
        itemIds: ids,
      };
    }
    case "stale":
      return { message: "Something changed while you were cooking. Check the amounts and cook again.", short: null, itemIds: [] };
    default:
      if (error.code === "not_found") {
        return {
          message: "An ingredient, or the group, isn't one you can use any more — it may have been used up or moved, or you may have left the group. Check and cook again.",
          short: null,
          itemIds: [],
        };
      }
      return { message: error.message, short: null, itemIds: [] };
  }
}

/** What to say when the split could not be posted after cooking (the dish is cooked: it is set on the dish page). */
export function sharesRefusal(error: { reason?: string | undefined; message: string }): string {
  switch (error.reason) {
    case "not_in_group":
      return "Someone you named has left the group. Set who ate on the dish page.";
    case "claims_exceed_portions":
      return "More portions were given out than cooked. Set who ate on the dish page.";
    case "dish_not_open":
      return "The dish can't take a split any more. Check it on the dish page.";
    default:
      return `${error.message} Set who ate on the dish page.`;
  }
}

// ── Keeping lines fresh ───────────────────────────────────────────

/**
 * The lines with each item replaced by a fresher read of it (someone used
 * some meanwhile), amounts cut to what is left; the same array when nothing
 * changed.
 */
export function refreshLines(lines: readonly DishLine[], fresh: ReadonlyMap<string, KitchenItem>): readonly DishLine[] {
  let changed = false;
  const out = lines.map((line) => {
    if (line.kind !== "pantry") return line;
    const f = fresh.get(line.key);
    if (
      !f ||
      (f.version === line.item.version &&
        f.qtyLeftMilli === line.item.qtyLeftMilli &&
        f.worthMinor === line.item.worthMinor &&
        JSON.stringify(measuresOf(f)) === JSON.stringify(measuresOf(line.item)))
    ) {
      return line;
    }
    changed = true;
    // Counted in a measure: the same count, taking what it takes now — or, if the measure went or no longer fits, the unit.
    const measure = line.counted ? measuresOf(f).find((m) => m.one === line.counted!.measure.one) : undefined;
    const take = measure && line.counted ? takeOf(f, measure, line.counted.quantity) : null;
    if (measure && line.counted && take !== null) return { ...line, item: f, qtyMilli: take, counted: { measure, quantity: line.counted.quantity } };
    return { ...line, item: f, qtyMilli: Math.min(line.qtyMilli, f.qtyLeftMilli), counted: null };
  });
  return changed ? out : lines;
}

/**
 * After an `insufficient_stock` refusal: the item's line takes at most the
 * `qtyLeftMilli` the server reported. The item itself stays as last read —
 * what is left of its price is not in the refusal — until the fresh read
 * that follows every refusal replaces it (`refreshLines`).
 */
export function withLeft(lines: readonly DishLine[], itemId: string, qtyLeftMilli: number): DishLine[] {
  return lines.map((line) =>
    line.kind === "pantry" && line.key === itemId ? { ...line, qtyMilli: Math.min(line.qtyMilli, qtyLeftMilli), counted: null } : line,
  );
}
