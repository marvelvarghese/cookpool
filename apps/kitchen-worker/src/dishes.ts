// What the dish handlers share (CP-14): the request body of a dish, planning
// the write from the items as read (what each ingredient costs, what the cook
// owes in each group, the items just bought), the public shape of a dish (with
// its split, CP-16: see ./split.ts), the list's cursor, and how a refused dish
// write becomes a response.

import {
  DEFAULT_KITCHEN_CURRENCY,
  DISH_SPLIT_MODES,
  DISH_STATES,
  KITCHEN_ERROR_REASONS,
  MAX_DISH_INGREDIENTS,
  type DishOwed,
  type DishSplitMode,
  type KitchenDish,
  type KitchenDishState,
} from "@saas/contracts/kitchen";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import { asUuid, isUuid, type Uuid } from "@saas/db/ids";
import type {
  CookDishInput,
  CookIngredient,
  KitchenDishError,
  KitchenDishRecord,
  KitchenDishesCursor,
  KitchenItemRecord,
  NewKitchenItem,
  NewKitchenTxn,
  KitchenSplit,
} from "@saas/db/kitchen";
import { buildIngredientTake } from "@saas/kitchen-engine/ledger";
import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import { UNITS, UnitError, dimensionOf, formatQuantity, isUnit, toMilli, type UnitKey } from "@saas/kitchen-engine/units";
import type { RequestContext } from "./context.js";
import { conflict, unprocessable, validationError } from "./http.js";
import { parseOrgPublicId, parsePublicId, toPublicId } from "./ids.js";
import { ledgerAudit } from "./ledger.js";
import { MAX_NAME, displayQuantity, isoDay, parseNewItem } from "./pantry.js";
import { takeInMeasure, type MeasureBook } from "./measures.js";
import { MAX_PORTIONS_HALF, dishSplitView } from "./split.js";
import { measureField, quantityOf, stockErrorResponse } from "./stock.js";
import { Fields, minor, oneOf, text, type FieldErrors } from "./validate.js";

/** What an item bought for a dish is filed under when the cook names nothing. */
export const DEFAULT_NEW_ITEM_CATEGORY = "Other";

export const DEFAULT_DISHES_LIMIT = 25;
export const MAX_DISHES_LIMIT = 100;

/** The longest ledger title a dish's charge gets (its name and what went into it). */
const MAX_TITLE = 200;

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

// ── The request body ───────────────────────────────────────

/** An existing item to take: `quantity` in `unit` (null: the item's own, checked against it when planning). */
export interface ParsedIngredient {
  itemId: Uuid;
  quantity: string | number;
  unit: UnitKey | null;
  /** Instead of a unit, one of the item's measures (SM-13): its word, and `quantity` as a count of it. */
  measure: { word: string; quantity: number } | null;
}

/** An item just bought: what was bought, and how much of it goes in. */
export interface ParsedNewDishItem {
  name: string;
  category: string;
  dimension: NewKitchenItem["dimension"];
  displayUnit: string;
  qtyMilli: number;
  priceMinor: number;
  boughtOn: string | null;
  expiresOn: string | null;
  useMilli: number;
  useUnit: string;
}

export interface ParsedDish {
  name: string;
  orgId: Uuid | null;
  portionsHalf: number;
  extrasMinor: number;
  splitMode: DishSplitMode;
  ingredients: ParsedIngredient[];
  newItems: ParsedNewDishItem[];
}

/** `errors` with every field name under `prefix` (`ingredients[2].quantity`). */
function prefixed(prefix: string, errors: FieldErrors): FieldErrors {
  return Object.fromEntries(Object.entries(errors).map(([field, messages]) => [`${prefix}${field}`, messages]));
}

function merge(fields: Fields, errors: FieldErrors): void {
  for (const [field, messages] of Object.entries(errors)) for (const message of messages) fields.add(field, message);
}

function parseIngredient(fields: Fields, at: string, value: unknown): ParsedIngredient | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fields.add(at, "Must be an object");
  const raw = value as Record<string, unknown>;
  const itemId = typeof raw.itemId === "string" ? parsePublicId("itm", raw.itemId) : null;
  if (!itemId) fields.add(`${at}.itemId`, "Must be an item's itm_ id");
  let quantity: string | number | undefined;
  if (typeof raw.quantity === "string" || typeof raw.quantity === "number") quantity = raw.quantity;
  else fields.add(`${at}.quantity`, 'Must be a decimal such as "0.25"');
  let unit: UnitKey | null = null;
  if (raw.unit !== undefined && raw.unit !== null) {
    if (isUnit(raw.unit)) unit = raw.unit;
    else fields.add(`${at}.unit`, `Must be one of: ${Object.keys(UNITS).join(", ")}`);
  }
  const measure = measureField(fields, `${at}.measure`, { measure: raw.measure, quantity, unit: raw.unit }, `${at}.quantity`);
  return itemId && quantity !== undefined ? { itemId, quantity, unit, measure } : undefined;
}

function parseNewDishItem(fields: Fields, at: string, value: unknown): ParsedNewDishItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fields.add(at, "Must be an object");
  const raw = value as Record<string, unknown>;
  // What was bought is validated as any personal item is; it is in the dish's currency.
  const bought = parseNewItem(
    { ...raw, category: raw.category ?? DEFAULT_NEW_ITEM_CATEGORY, currency: undefined },
    { group: false },
  );
  if (!bought.ok) {
    merge(fields, prefixed(`${at}.`, bought.fields));
    return undefined;
  }
  const item = bought.value;
  let useMilli = item.qtyMilli;
  let useUnit = item.displayUnit;
  if (raw.useQuantity !== undefined && raw.useQuantity !== null) {
    const unit = raw.useUnit ?? item.displayUnit;
    if (!isUnit(unit) || dimensionOf(unit) !== item.dimension) {
      return fields.add(`${at}.useUnit`, `Must measure what the item does (${item.dimension})`);
    }
    if (typeof raw.useQuantity !== "string" && typeof raw.useQuantity !== "number") {
      return fields.add(`${at}.useQuantity`, 'Must be a decimal such as "0.25"');
    }
    try {
      useMilli = toMilli(raw.useQuantity, unit);
    } catch (err) {
      if (err instanceof UnitError) return fields.add(`${at}.useQuantity`, 'Must be a quantity above zero, such as "0.25"');
      throw err;
    }
    useUnit = unit;
    if (useMilli > item.qtyMilli) return fields.add(`${at}.useQuantity`, "Must be at most what was bought");
  } else if (raw.useUnit !== undefined && raw.useUnit !== null) {
    return fields.add(`${at}.useUnit`, "Send useUnit with useQuantity");
  }
  return {
    name: item.name,
    category: item.category,
    dimension: item.dimension,
    displayUnit: item.displayUnit,
    qtyMilli: item.qtyMilli,
    priceMinor: item.priceMinor,
    boughtOn: item.boughtOn,
    expiresOn: item.expiresOn,
    useMilli,
    useUnit,
  };
}

/** Validate a POST /v1/kitchen/me/dishes body. Unknown fields are ignored, as on every baseline route. */
export function parseDish(body: Record<string, unknown>): Parsed<ParsedDish> {
  const fields = new Fields();
  const name = text(fields, "name", body.name, MAX_NAME);

  let orgId: Uuid | null = null;
  if (body.orgId !== undefined && body.orgId !== null) {
    orgId = typeof body.orgId === "string" ? parseOrgPublicId(body.orgId) : null;
    if (!orgId) fields.add("orgId", "Must be a group's org_ id, or null for just you");
  }
  const portionsHalf =
    typeof body.portionsHalf === "number" && Number.isSafeInteger(body.portionsHalf) &&
    body.portionsHalf >= 1 && body.portionsHalf <= MAX_PORTIONS_HALF
      ? body.portionsHalf
      : fields.add("portionsHalf", `Must be portions × 2, a whole number from 1 to ${MAX_PORTIONS_HALF}`);
  const extrasMinor = body.extrasMinor === undefined ? 0 : minor(fields, "extrasMinor", body.extrasMinor);
  const splitMode = oneOf(fields, "splitMode", body.splitMode, DISH_SPLIT_MODES);
  if (splitMode === "claims" && (body.orgId === undefined || body.orgId === null)) {
    fields.add("splitMode", "Claims are made by a group: share the dish with one, or assign it");
  }

  const ingredients: ParsedIngredient[] = [];
  if (body.ingredients !== undefined) {
    if (!Array.isArray(body.ingredients)) fields.add("ingredients", "Must be a list");
    else body.ingredients.forEach((value: unknown, i) => {
      const parsed = parseIngredient(fields, `ingredients[${i}]`, value);
      if (parsed) ingredients.push(parsed);
    });
  }
  const newItems: ParsedNewDishItem[] = [];
  if (body.newItems !== undefined) {
    if (!Array.isArray(body.newItems)) fields.add("newItems", "Must be a list");
    else body.newItems.forEach((value: unknown, i) => {
      const parsed = parseNewDishItem(fields, `newItems[${i}]`, value);
      if (parsed) newItems.push(parsed);
    });
  }
  const listed =
    (Array.isArray(body.ingredients) ? body.ingredients.length : 0) + (Array.isArray(body.newItems) ? body.newItems.length : 0);
  if (listed === 0) fields.add("ingredients", "Add at least one ingredient, or something you just bought");
  if (listed > MAX_DISH_INGREDIENTS) {
    fields.add("ingredients", `At most ${MAX_DISH_INGREDIENTS} ingredients, together with what you just bought`);
  }
  if (new Set(ingredients.map((i) => i.itemId)).size !== ingredients.length) {
    fields.add("ingredients", "Name each item once");
  }

  if (!fields.ok || name === undefined || portionsHalf === undefined || extrasMinor === undefined || splitMode === undefined) {
    return { ok: false, fields: fields.errors };
  }
  return { ok: true, value: { name, orgId, portionsHalf, extrasMinor, splitMode, ingredients, newItems } };
}

/** `?state=`, or null when absent. */
export function stateParam(fields: Fields, url: URL): KitchenDishState | null {
  const raw = url.searchParams.get("state");
  if (raw === null || raw === "") return null;
  return oneOf(fields, "state", raw, DISH_STATES) ?? null;
}

// ── Planning the write ─────────────────────────────────────

export interface DishPlanInput {
  cook: string;
  dishId: Uuid;
  idemKey: string;
  now: Date;
  /** The group it is shared with, and the currency that group counts in. */
  shared: { orgId: Uuid; currency: string } | null;
  /** Every item `dish.ingredients` names, as just read, by id. */
  items: ReadonlyMap<string, KitchenItemRecord>;
  /** Their measures (SM-13): read only when an ingredient is given in one. */
  measures: MeasureBook;
}

type MutableIngredient = { -readonly [K in keyof CookIngredient]: CookIngredient[K] } & { name: string; what: string };

/**
 * The write a dish makes, from the items as just read — or the refusal: a
 * unit that does not measure what its item does (422), an ingredient in
 * another currency (422 `currency_mismatch`), more than is left (409
 * `insufficient_stock`). What an ingredient costs depends on what is left of
 * it (the last of an item takes what is left of its price), so the write
 * applies only at the versions read here.
 */
export function planDish(ctx: RequestContext, dish: ParsedDish, input: DishPlanInput): CookDishInput | Response {
  const { cook, dishId, idemKey, now, items } = input;
  const mine = { kind: "user", subjectId: cook } as const;

  // Quantities, in each item's own dimension — or in one of its measures
  // (SM-13), which only decides how much is taken; the item's unit shows it.
  const fields = new Fields();
  const taken: Array<{ item: KitchenItemRecord; qtyMilli: number; unit: string; label: string | null }> = [];
  let short: KitchenItemRecord | null = null;
  dish.ingredients.forEach((ingredient, i) => {
    const item = items.get(ingredient.itemId)!;
    if (ingredient.measure) {
      const inMeasure = takeInMeasure(item, input.measures(item), ingredient.measure, `ingredients[${i}].measure`);
      if (inMeasure.kind === "taken") taken.push({ item, qtyMilli: inMeasure.qtyMilli, unit: item.displayUnit, label: inMeasure.label });
      else if (inMeasure.kind === "unknown") merge(fields, inMeasure.fields);
      else short ??= item;
      return;
    }
    const qty = quantityOf(item, ingredient.quantity, ingredient.unit);
    if (qty.ok) taken.push({ item, ...qty.value, label: null });
    else merge(fields, prefixed(`ingredients[${i}].`, qty.fields));
  });
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);

  // One currency: the shared group's, else the ingredients'.
  const currency = input.shared?.currency ?? taken[0]?.item.currency ?? DEFAULT_KITCHEN_CURRENCY;
  const elsewhere = taken.filter((t) => t.item.currency !== currency).map((t) => toPublicId("itm", t.item.id));
  if (elsewhere.length > 0) {
    return unprocessable(
      ctx.requestId,
      `Every ingredient must be in ${currency}${input.shared ? ", the group's currency" : ""}`,
      KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH,
      { currency, itemIds: elsewhere },
    );
  }

  // Enough of each.
  const over = short ?? taken.find(({ item, qtyMilli }) => qtyMilli > item.qtyLeftMilli)?.item;
  if (over) {
    return conflict(ctx.requestId, `Not that much ${over.name} is left`, KITCHEN_ERROR_REASONS.INSUFFICIENT_STOCK, {
      itemId: toPublicId("itm", over.id),
      qtyLeftMilli: over.qtyLeftMilli,
    });
  }

  const ingredients = taken.map(({ item, qtyMilli, unit, label }): MutableIngredient => ({
    owner: item.orgId ? { kind: "group", orgId: item.orgId as Uuid } : mine,
    itemId: item.id as Uuid,
    expectedVersion: item.version,
    qtyMilli,
    unit,
    label,
    // A measure only decides how much is taken: the cost is any take's.
    costMinor: costOfUse(item, qtyMilli),
    paidBy: item.paidBy,
    useTxnId: null,
    moveId: asUuid(crypto.randomUUID()),
    name: item.name,
    // In the words it was given in: "Onions (2 onions)", else "Rice (250 g)".
    what: label ?? formatQuantity(qtyMilli, item.dimension, unit),
  }));

  // Just bought: into the cook's own pantry, paid by them, then into the dish.
  const dishHex = toPublicId("dsh", dishId).slice(4);
  const newItems: NewKitchenItem[] = dish.newItems.map((n, i) => ({
    id: asUuid(crypto.randomUUID()),
    owner: mine,
    name: n.name,
    category: n.category,
    dimension: n.dimension,
    displayUnit: n.displayUnit,
    qtyMilli: n.qtyMilli,
    priceMinor: n.priceMinor,
    currency,
    paidBy: cook,
    boughtOn: n.boughtOn ?? isoDay(now),
    expiresOn: n.expiresOn,
    wastePolicy: null,
    createdBy: cook,
    // Unique per pantry, and never one a request could have sent.
    idemKey: `dish_${dishHex}_${i}`,
    now,
  }));
  newItems.forEach((item, i) => {
    const n = dish.newItems[i]!;
    ingredients.push({
      owner: mine,
      itemId: item.id,
      expectedVersion: 1,
      qtyMilli: n.useMilli,
      unit: n.useUnit,
      costMinor: costOfUse({ priceMinor: n.priceMinor, qtyBoughtMilli: n.qtyMilli, qtyLeftMilli: n.qtyMilli, costTakenMinor: 0 }, n.useMilli),
      paidBy: cook,
      useTxnId: null,
      moveId: asUuid(crypto.randomUUID()),
      name: n.name,
      what: formatQuantity(n.useMilli, n.dimension, n.useUnit),
    });
  });

  // In each source group, one `use` transaction: every buyer is paid back,
  // the cook owes it all. What the cook bought themselves nets to nothing,
  // so it is left out — and a group where nobody else is owed posts none.
  const byGroup = new Map<string, MutableIngredient[]>();
  for (const ingredient of ingredients) {
    if (ingredient.owner.kind !== "group") continue;
    const list = byGroup.get(ingredient.owner.orgId) ?? [];
    list.push(ingredient);
    byGroup.set(ingredient.owner.orgId, list);
  }
  const txns: CookDishInput["txns"][number][] = [];
  for (const [orgId, list] of byGroup) {
    const owed = list.filter((i) => i.paidBy !== cook && i.costMinor > 0);
    if (owed.length === 0) continue;
    const take = buildIngredientTake({ cookId: cook, lines: owed.map((i) => ({ buyerId: i.paidBy, costMinor: i.costMinor })) });
    const txnId = asUuid(crypto.randomUUID());
    for (const ingredient of owed) ingredient.useTxnId = txnId;
    const title = `${dish.name}: ${owed.map((i) => `${i.name} (${i.what})`).join(", ")}`;
    const txn: NewKitchenTxn = {
      id: txnId,
      orgId: orgId as Uuid,
      kind: "use",
      title: title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title,
      totalMinor: take.totalMinor,
      currency,
      occurredAt: now,
      createdBy: cook,
      sourceKind: "dish",
      sourceId: dishId,
      // One per group per dish; the dish's own key (unique per cook) is what makes cooking idempotent.
      idemKey: `dish_${dishHex}`,
      now,
    };
    const splits: KitchenSplit[] = take.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor }));
    txns.push({ txn, splits });
  }

  const ingredientsMinor = ingredients.reduce((sum, i) => sum + i.costMinor, 0);
  const totalMinor = ingredientsMinor + dish.extrasMinor;
  const audits = dishAudits(ctx, {
    type: "kitchen.dish.cooked",
    dishId,
    idemKey,
    sharedWith: input.shared?.orgId ?? null,
    sourceGroups: [...byGroup.keys()],
    describe(orgId) {
      // Each group's log says its own part: the dish itself only where it is
      // shared, so a group it merely took from learns nothing of another.
      const shared = orgId === input.shared?.orgId;
      const here = ingredients.filter((i) => i.owner.kind === "group" && i.owner.orgId === orgId);
      const charge = txns.find((t) => t.txn.orgId === orgId);
      const parts = [`Dish ${toPublicId("dsh", dishId)} "${dish.name}" cooked by ${cook}`];
      if (shared) {
        parts.push(`shared with the group: ${formatMinor(totalMinor, currency)} for ${dish.portionsHalf / 2} portions`);
      }
      if (here.length > 0) {
        parts.push(
          `took ${here.map((i) => `${i.name} (${i.what})`).join(", ")} from the group's pantry` +
            (charge ? `, ${formatMinor(charge.txn.totalMinor, currency)} back to their buyers` : ""),
        );
      }
      return {
        description: parts.join("; "),
        payload: {
          dishId: toPublicId("dsh", dishId),
          name: dish.name,
          cook,
          shared,
          ...(shared ? { portionsHalf: dish.portionsHalf, splitMode: dish.splitMode, totalMinor } : {}),
          currency,
          txnId: charge ? toPublicId("txn", charge.txn.id) : null,
          ingredients: here.map((i) => ({
            itemId: toPublicId("itm", i.itemId),
            qtyMilli: i.qtyMilli,
            unit: i.unit,
            label: i.label ?? null,
            costMinor: i.costMinor,
            paidBy: i.paidBy,
          })),
        },
      };
    },
  });

  return {
    dish: {
      id: dishId,
      cook,
      orgId: input.shared?.orgId ?? null,
      name: dish.name,
      portionsHalf: dish.portionsHalf,
      extrasMinor: dish.extrasMinor,
      currency,
      splitMode: dish.splitMode,
      // Claims open the dish to the group at once; an assigned dish waits for its cook's shares (CP-16).
      state: dish.splitMode === "claims" ? "open" : "draft",
      idemKey,
      now,
    },
    newItems,
    ingredients: ingredients.map(({ name: _name, what: _what, ...ingredient }) => ingredient),
    txns,
    audits,
  };
}

/**
 * One audit event per group a dish touches — the group it is shared with and
 * every group whose pantry it took from — each saying that group's part. A
 * dish of the cook's own pantry alone touches no group, so it writes none:
 * the event log is per organization.
 */
export function dishAudits(
  ctx: RequestContext,
  input: {
    type: "kitchen.dish.cooked" | "kitchen.dish.canceled" | "kitchen.dish.finalized" | "kitchen.dish.corrected";
    dishId: string;
    idemKey: string;
    sharedWith: string | null;
    sourceGroups: readonly string[];
    describe(orgId: string): { description: string; payload: Record<string, unknown> };
  },
): AppendEventWithAuditInput[] {
  const groups = [...new Set([...(input.sharedWith ? [input.sharedWith] : []), ...input.sourceGroups])];
  return groups.map((orgId) => {
    const { description, payload } = input.describe(orgId);
    return ledgerAudit(
      { ...ctx, orgId: orgId as Uuid },
      { type: input.type, subjectKind: "kitchen_dish", subjectId: input.dishId, idemKey: input.idemKey, description, payload },
    );
  });
}

// ── Public shapes ──────────────────────────────────────────

/** A dish as `viewer` reads it (`myClaimHalf` is theirs). */
export function toKitchenDish(record: KitchenDishRecord, viewer: string): KitchenDish {
  // What the cook owes, per group and buyer, in the order the ingredients
  // name them: exactly the ingredients a use transaction charged.
  const owes = new Map<string, DishOwed>();
  for (const i of record.ingredients) {
    if (!i.useTxnId || !i.orgId) continue;
    const key = `${i.orgId}|${i.paidBy}`;
    const entry = owes.get(key) ?? { orgId: toPublicId("org", i.orgId), buyerId: i.paidBy, amountMinor: 0 };
    entry.amountMinor += i.costMinor;
    owes.set(key, entry);
  }
  const owed = [...owes.values()].reduce((sum, o) => sum + o.amountMinor, 0);
  return {
    id: toPublicId("dsh", record.id),
    cook: record.cook,
    orgId: record.orgId ? toPublicId("org", record.orgId) : null,
    name: record.name,
    portionsHalf: record.portionsHalf,
    portions: record.portionsHalf / 2,
    extrasMinor: record.extrasMinor,
    ingredientsMinor: record.ingredientsMinor,
    totalMinor: record.totalMinor,
    currency: record.currency,
    splitMode: record.splitMode,
    state: record.state,
    txnId: record.txnId ? toPublicId("txn", record.txnId) : null,
    leftoverItemId: record.leftoverItemId ? toPublicId("itm", record.leftoverItemId) : null,
    cookedAt: record.cookedAt.toISOString(),
    finalizedAt: record.finalizedAt?.toISOString() ?? null,
    canceledAt: record.canceledAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    ingredients: record.ingredients.map((i) => ({
      itemId: toPublicId("itm", i.itemId),
      name: i.name,
      orgId: i.orgId ? toPublicId("org", i.orgId) : null,
      paidBy: i.paidBy,
      qtyMilli: i.qtyMilli,
      quantity: isUnit(i.unit) ? displayQuantity(i.qtyMilli, i.unit) : i.qtyMilli / 1000,
      unit: i.unit,
      label: i.label,
      costMinor: i.costMinor,
      useTxnId: i.useTxnId ? toPublicId("txn", i.useTxnId) : null,
    })),
    fromMineMinor: record.ingredientsMinor - owed,
    owes: [...owes.values()],
    ...dishSplitView(record, viewer),
  };
}

// ── List cursor ────────────────────────────────────────────

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function encodeDishesCursor(cursor: KitchenDishesCursor): string {
  return btoa(JSON.stringify([cursor.cookedAt, cursor.id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeDishesCursor(token: string): KitchenDishesCursor | null {
  if (token.length > 200) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (token.length % 4)) % 4)));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [cookedAt, id] = parsed as unknown[];
  if (typeof cookedAt !== "string" || !ISO_INSTANT_RE.test(cookedAt)) return null;
  if (typeof id !== "string" || !isUuid(id)) return null;
  return { cookedAt, id };
}

/** `?cursor=`, or null when absent. */
export function cursorParam(fields: Fields, url: URL): KitchenDishesCursor | null {
  const raw = url.searchParams.get("cursor");
  if (raw === null || raw === "") return null;
  const cursor = decodeDishesCursor(raw);
  if (!cursor) fields.add("cursor", "Must be a nextCursor this route returned");
  return cursor;
}

// ── Outcomes ───────────────────────────────────────────────

/**
 * The response to a refused dish write. Nothing was written. `refused` says
 * what a dish in the wrong state cannot have done to it ("canceled",
 * "claimed" …).
 */
export function dishErrorResponse(requestId: string, error: KitchenDishError, refused = "canceled"): Response {
  switch (error.kind) {
    case "ingredient_short":
      return conflict(requestId, "Not that much of an ingredient is left", KITCHEN_ERROR_REASONS.INSUFFICIENT_STOCK, {
        itemId: toPublicId("itm", error.itemId),
        qtyLeftMilli: error.qtyLeftMilli,
      });
    case "dish_not_open":
      return conflict(requestId, `This dish is ${error.state}: it cannot be ${refused}`, KITCHEN_ERROR_REASONS.DISH_NOT_OPEN, {
        state: error.state,
      });
    case "claims_exceed_portions":
      return conflict(
        requestId,
        `Only ${error.portionsHalf / 2} portions were cooked, and ${error.availableHalf / 2} are free`,
        KITCHEN_ERROR_REASONS.CLAIMS_EXCEED_PORTIONS,
        { portionsHalf: error.portionsHalf, availableHalf: error.availableHalf },
      );
    default:
      return stockErrorResponse(requestId, error);
  }
}
