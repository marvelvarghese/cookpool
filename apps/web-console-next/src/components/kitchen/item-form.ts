/**
 * Add an item (Cookpool CP-12) as a pure view-model: the form's state, its
 * inline errors, the live "₹X per kg · ₹Y per 100 g" line, the "Who paid?"
 * chips, the waste-rule choices, and the request it posts — to your own
 * pantry (`createPersonalItem`) or a group's (`createGroupItem`, with who paid
 * and the item's own waste rule). Quantities go through the engine's
 * `toMilli`, the same parse the server stores them with, and the price through
 * `parseMoney` (by its digits, never as a float). In the new frame (RC-3) it
 * also takes a note, trimmed and sent only when there is one. Dependency-free,
 * so it is unit-testable.
 */

import {
  ITEM_NOTE_MAX,
  itemNoteLength,
  normalizeItemNote,
  type CreateGroupItemRequest,
  type CreatePersonalItemRequest,
  type WastePolicy,
} from "@saas/contracts/kitchen";
import { UNITS, UnitError, pricePerUnit, toMilli, type UnitKey } from "@saas/kitchen-engine/units";
import { formatMinor, moneyInputMessage, parseMoney } from "./money";
import { ITEM_CATEGORY_LABELS, PERSONAL_PANTRY } from "./pantry";
import { memberLabel, sortMembers, type MemberNames } from "./members";

/** The category chips, in order (ids are what the item stores). */
export const ITEM_CATEGORIES: readonly { id: string; label: string }[] = Object.entries(ITEM_CATEGORY_LABELS).map(
  ([id, label]) => ({ id, label }),
);

/** The unit chips; the cooking measures sit behind "more". */
export const MAIN_UNITS: readonly UnitKey[] = ["pcs", "g", "kg", "ml", "L", "dozen", "pack"];
export const MORE_UNITS: readonly UnitKey[] = ["tsp", "tbsp", "cup"];

/** The server's limit on a name. */
export const ITEM_NAME_MAX = 120;

/** "Use the group rule", or the item's own. */
export type WasteChoice = "group" | WastePolicy;

export interface ItemForm {
  name: string;
  /** A category id ("veg"), or "" until one is picked. */
  category: string;
  /** As typed, in `unit`: "1", "1.5". */
  quantity: string;
  unit: UnitKey;
  /** As typed: "40", "249.50". */
  price: string;
  /** YYYY-MM-DD */
  boughtOn: string;
  /** YYYY-MM-DD, or "" for none. */
  expiresOn: string;
  /** "personal" or a group's `org_…` id. */
  pantry: string;
  /** Who paid, for a group item (`usr_…`). */
  paidBy: string | null;
  waste: WasteChoice;
  /** As typed (RC-3, the new frame's Note field); "" for none. Never filled from last time. */
  note: string;
}

/** Today's calendar date where the person is, YYYY-MM-DD. */
export function localIsoDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function initialItemForm(opts: { today: string; pantry?: string | null; meId: string | null }): ItemForm {
  return {
    name: "",
    category: "",
    quantity: "",
    unit: "pcs",
    price: "",
    boughtOn: opts.today,
    expiresOn: "",
    pantry: opts.pantry || PERSONAL_PANTRY,
    paidBy: opts.meId,
    waste: "group",
    note: "",
  };
}

export type ItemField = "name" | "category" | "quantity" | "price" | "boughtOn" | "expiresOn" | "paidBy" | "note";

/** Fields in the order the form shows them (the first with an error gets focus). */
export const ITEM_FIELDS: readonly ItemField[] = ["name", "quantity", "price", "category", "paidBy", "expiresOn", "boughtOn", "note"];

/** The parts of "Bought", top to bottom. */
export type BoughtSection = "pantry" | "name" | "amount" | "category" | "paidBy" | "waste" | "useBy" | "note";

/**
 * "Bought" in order (SM-15, the audit's §5): **where it goes first** — it
 * changes the form (a group asks who paid and who pays for waste) — then what,
 * how much and the price, its category, the group's two questions, and when
 * to use it by. When it was bought is a quiet "Bought today · Change" under
 * the use-by, not a field. In the new frame (`notes`, RC-3) an optional Note
 * sits under all of them.
 */
export function boughtSections(group: boolean, notes = false): BoughtSection[] {
  const sections: BoughtSection[] = group
    ? ["pantry", "name", "amount", "category", "paidBy", "waste", "useBy"]
    : ["pantry", "name", "amount", "category", "useBy"];
  return notes ? [...sections, "note"] : sections;
}

export type ItemRequest =
  | { kind: "personal"; body: CreatePersonalItemRequest }
  | { kind: "group"; orgId: string; body: CreateGroupItemRequest };

export interface ItemFormPreview {
  errors: Partial<Record<ItemField, string>>;
  /** The quantity in thousandths of the unit's base (by the engine), or null while it is not a quantity. */
  qtyMilli: number | null;
  priceMinor: number | null;
  /** "₹40.00 per kg · ₹4.00 per 100 g", or null until both quantity and price read. */
  perUnit: string | null;
  /** What to post; null while anything is wrong. */
  request: ItemRequest | null;
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: string): boolean {
  if (!ISO_DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** A typed quantity as the engine reads it: "1.5", ".5" → "0.5", "2." → "2". Null when it is not a plain decimal. */
export function normalizeQuantity(input: string): string | null {
  let text = input.trim();
  if (text.startsWith(".")) text = `0${text}`;
  if (text.endsWith(".")) text = text.slice(0, -1);
  return /^\d+(?:\.\d+)?$/.test(text) ? text : null;
}

export type QuantityParse = { ok: true; text: string; milli: number } | { ok: false; message: string };

/** A typed quantity in `unit`, by the engine's `toMilli`. */
export function parseQuantity(input: string, unit: UnitKey): QuantityParse {
  if (input.trim() === "") return { ok: false, message: "Enter how much you bought" };
  const text = normalizeQuantity(input);
  if (text === null) return { ok: false, message: "Enter a number like 1 or 1.5" };
  try {
    return { ok: true, text, milli: toMilli(text, unit) };
  } catch (err) {
    if (err instanceof UnitError) {
      return { ok: false, message: /large/.test(err.message) ? "That's more than a pantry holds" : "Enter more than zero" };
    }
    throw err;
  }
}

/** A price per `count` of `unit`, by the engine (`count` 100 for "per 100 g"). */
export function pricePer(priceMinor: number, qtyMilli: number, unit: UnitKey, count = 1): number {
  return pricePerUnit(priceMinor * count, qtyMilli, unit);
}

/**
 * The live price line: per kg and per 100 g for weights, per L and per 100 ml
 * for volumes, per piece (and per dozen) for counts, per pack for packs.
 */
export function perUnitLine(priceMinor: number, qtyMilli: number, unit: UnitKey, currency = "INR"): string {
  const money = (minor: number) => formatMinor(minor, currency);
  switch (UNITS[unit].dimension) {
    case "mass":
      return `${money(pricePer(priceMinor, qtyMilli, "kg"))} per kg · ${money(pricePer(priceMinor, qtyMilli, "g", 100))} per 100 g`;
    case "volume":
      return `${money(pricePer(priceMinor, qtyMilli, "L"))} per L · ${money(pricePer(priceMinor, qtyMilli, "ml", 100))} per 100 ml`;
    case "count":
      return unit === "dozen"
        ? `${money(pricePer(priceMinor, qtyMilli, "dozen"))} per dozen · ${money(pricePer(priceMinor, qtyMilli, "pcs"))} per piece`
        : `${money(pricePer(priceMinor, qtyMilli, "pcs"))} per piece`;
    default:
      return `${money(pricePer(priceMinor, qtyMilli, "pack"))} per pack`;
  }
}

/**
 * Check the form and build its request. `today` is the person's calendar
 * date (bought-on cannot be after it); `currency` is the chosen pantry's (a
 * personal item is sent in it; a group item takes its group's).
 */
export function previewItemForm(form: ItemForm, ctx: { today: string; currency?: string; meId: string | null }): ItemFormPreview {
  const errors: Partial<Record<ItemField, string>> = {};
  const currency = ctx.currency ?? "INR";

  const name = form.name.trim().replace(/\s+/g, " ");
  if (!name) errors.name = "Say what you bought";
  else if (name.length > ITEM_NAME_MAX) errors.name = `Keep it under ${ITEM_NAME_MAX} characters`;

  if (!form.category) errors.category = "Pick a category";

  const qty = parseQuantity(form.quantity, form.unit);
  if (!qty.ok) errors.quantity = qty.message;

  const money = parseMoney(form.price);
  const priceMessage = moneyInputMessage(money);
  if (priceMessage) errors.price = priceMessage === "Enter the amount" ? "Enter what you paid" : priceMessage;

  if (!validDay(form.boughtOn)) errors.boughtOn = "Pick the day you bought it";
  else if (form.boughtOn > ctx.today) errors.boughtOn = "That's in the future";

  const expiresOn = form.expiresOn.trim();
  if (expiresOn) {
    if (!validDay(expiresOn)) errors.expiresOn = "Pick a date, or leave it empty";
    else if (validDay(form.boughtOn) && expiresOn < form.boughtOn) errors.expiresOn = "Use-by can't be before the day you bought it";
  }

  const group = form.pantry !== PERSONAL_PANTRY;
  if (group && !form.paidBy) errors.paidBy = "Pick who paid";

  // The field holds 80 (its maxLength); only a paste of wide characters can say more.
  const note = normalizeItemNote(form.note);
  if (note !== null && itemNoteLength(note) > ITEM_NOTE_MAX) errors.note = `Keep it to ${ITEM_NOTE_MAX} characters`;

  const qtyMilli = qty.ok ? qty.milli : null;
  const priceMinor = money.ok ? money.minor : null;
  const perUnit = qtyMilli !== null && priceMinor !== null ? perUnitLine(priceMinor, qtyMilli, form.unit, currency) : null;

  let request: ItemRequest | null = null;
  if (Object.keys(errors).length === 0 && qty.ok && money.ok) {
    const base: CreatePersonalItemRequest = {
      name,
      category: form.category,
      quantity: qty.text,
      unit: form.unit,
      priceMinor: money.minor,
      boughtOn: form.boughtOn,
      ...(expiresOn ? { expiresOn } : {}),
      ...(note ? { note } : {}),
    };
    if (group) {
      request = {
        kind: "group",
        orgId: form.pantry,
        body: {
          ...base,
          paidBy: form.paidBy!,
          ...(form.waste === "group" ? {} : { wastePolicy: form.waste }),
        },
      };
    } else {
      request = { kind: "personal", body: { ...base, currency } };
    }
  }
  return { errors, qtyMilli, priceMinor, perUnit, request };
}

export function firstItemError(errors: Partial<Record<ItemField, string>>): ItemField | null {
  return ITEM_FIELDS.find((f) => errors[f]) ?? null;
}

// ── Chips for people ──────────────────────────────────────────────

export interface ChipWindow {
  /** The people shown, in order. */
  shown: string[];
  /** How many more sit behind "N more". */
  more: number;
}

/**
 * The first `max` people (you first, then by name), plus anyone chosen
 * further down, until "N more" is pressed (`expanded`).
 */
export function chipWindow(
  people: readonly string[],
  opts: { meId: string | null; names?: MemberNames | null; chosen?: Iterable<string>; expanded?: boolean; max?: number },
): ChipWindow {
  const sorted = sortMembers(people, opts.meId, opts.names);
  const max = opts.max ?? 5;
  if (opts.expanded || sorted.length <= max) return { shown: sorted, more: 0 };
  const first = sorted.slice(0, max);
  const chosen = new Set(opts.chosen ?? []);
  const extra = sorted.slice(max).filter((id) => chosen.has(id));
  const shown = [...first, ...extra];
  return { shown, more: sorted.length - shown.length };
}

// ── Group-only choices ────────────────────────────────────────────

export interface WasteOption {
  id: WastePolicy;
  label: string;
}

/**
 * "If it goes to waste" in two choices (SM-15; the audit found "Use the group
 * rule" and "Split it equally" were one choice twice): split equally, or the
 * payer absorbs it. The group's own rule is picked to start with.
 */
export function wasteOptions(opts: { paidBy: string | null; meId: string | null; names?: MemberNames | null }): WasteOption[] {
  const payerIsMe = !!opts.paidBy && opts.paidBy === opts.meId;
  const payer = opts.paidBy ? memberLabel(opts.paidBy, opts.meId, opts.names) : "The buyer";
  return [
    { id: "split_equally", label: "Split equally" },
    { id: "buyer_absorbs", label: payerIsMe ? "I absorb it" : `${payer} absorbs it` },
  ];
}

/** Which of the two is on: the form's own choice, or — following the group — the group's rule. */
export function wasteShown(choice: WasteChoice, groupRule: WastePolicy): WastePolicy {
  return choice === "group" ? groupRule : choice;
}

/** A tap on one of the two: the group's own rule follows the group (nothing sent), the other overrides it. */
export function wastePick(id: WastePolicy, groupRule: WastePolicy): WasteChoice {
  return id === groupRule ? "group" : id;
}

// ── Use by ─────────────────────────────────────────────────────────

export type UseByChoice = "3d" | "5d" | "14d" | "none" | "date";

/** The canvas's quick picks: 3 days · 5 days · 2 wks · None, and a date of your own. */
export const USE_BY_CHOICES: readonly { id: UseByChoice; label: string; days: number | null }[] = [
  { id: "3d", label: "3 days", days: 3 },
  { id: "5d", label: "5 days", days: 5 },
  { id: "14d", label: "2 wks", days: 14 },
  { id: "none", label: "None", days: null },
  { id: "date", label: "Date", days: null },
];

function plusDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Which pick a use-by is: a quick pick when it is that many days after buying, else a date (or none). */
export function useByChoice(form: Pick<ItemForm, "boughtOn" | "expiresOn">): UseByChoice {
  if (!form.expiresOn) return "none";
  if (validDay(form.boughtOn)) {
    for (const c of USE_BY_CHOICES) if (c.days !== null && plusDays(form.boughtOn, c.days) === form.expiresOn) return c.id;
  }
  return "date";
}

/** The use-by a quick pick sets (counted from the day it was bought); "date" keeps what is there. */
export function useByFor(choice: UseByChoice, form: Pick<ItemForm, "boughtOn" | "expiresOn">): string {
  const pick = USE_BY_CHOICES.find((c) => c.id === choice);
  if (choice === "none") return "";
  if (!pick || pick.days === null) return form.expiresOn;
  return validDay(form.boughtOn) ? plusDays(form.boughtOn, pick.days) : form.expiresOn;
}

// ── The one main button ───────────────────────────────────────────

/** "Filled from last time": the one hint once a name bought before is picked (the canvas). */
export const FILLED_FROM_BEFORE = "Filled from last time · change anything";

/**
 * The button names what it adds and what it cost — "Add Milk · ₹68.00" (the
 * canvas) — and, under it, where it goes ("to Flat 4B"); "Add" until a name
 * is typed.
 */
export function addMainLabel(input: { name: string; priceMinor: number | null; currency: string; pantryName: string | null }): {
  title: string;
  who: string;
} {
  const name = input.name.trim().replace(/\s+/g, " ");
  const short = name.length > 28 ? `${name.slice(0, 27)}…` : name;
  const price = input.priceMinor !== null ? formatMinor(input.priceMinor, input.currency) : null;
  return {
    title: [short ? `Add ${short}` : "Add", price].filter(Boolean).join(" · "),
    who: input.pantryName ? `to ${input.pantryName}` : "to your pantry",
  };
}
