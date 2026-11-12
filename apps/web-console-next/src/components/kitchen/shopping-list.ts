/**
 * The shopping list, `/pantry/list` (cookpool-revamp RV-22, the board
 * RvShopping), as pure view-models: what every pantry needs — its Always
 * have running low or out ("Always have" with the Low/Out dot) and the lines
 * people added (who added it) — each with an amount box (the saved amount in
 * grey, a unit picker of its own family) and one tick for "got it". Ticks
 * live on this device (`GOT_KEY`); a line added while something is ticked
 * comes in ticked. "Add what we need…" suggests names bought before (with
 * their pantry, last amount and when) and foods, and a new name offers Mine
 * or each group. Done shopping · N items opens the run with the ticked rows.
 * Dependency-free (contracts, the engine and pure kitchen modules), so it is
 * unit-testable.
 */

import type { FoodMatch, ItemHistoryEntry, ShoppingLine, StaplePantry, StaplesResponse } from "@saas/contracts/kitchen";
import { shoppingLines } from "@saas/contracts/kitchen";
import { UNITS, isUnit, type UnitKey } from "@saas/kitchen-engine/units";
import type { AmountUnit } from "./amount-picker";
import { memberLabel, type MemberNames } from "./members";
import { pantryName, stapleKey } from "./kitchen-staples";
import { calendarWeekdayText, nameKeyOf } from "./restock";
import type { TickAmount, TickState } from "./tick-row";

// ── Units: each family converts into itself ───────────────────────

/** The units a list line is kept in: the engine's, in families that convert. */
export type ListUnit = Extract<UnitKey, "pcs" | "dozen" | "g" | "kg" | "ml" | "L" | "pack">;

export const LIST_FAMILIES: readonly (readonly ListUnit[])[] = [["g", "kg"], ["ml", "L"], ["pcs", "dozen"], ["pack"]];

/** A stored unit as a list unit: an engine unit of a family (spoons and cups count as ml), else pieces. */
export function listUnitOf(raw: string | null | undefined): ListUnit {
  if (raw === "tsp" || raw === "tbsp" || raw === "cup") return "ml";
  return LIST_FAMILIES.some((f) => f.includes(raw as ListUnit)) ? (raw as ListUnit) : "pcs";
}

export function familyOf(unit: ListUnit): readonly ListUnit[] {
  return LIST_FAMILIES.find((f) => f.includes(unit)) ?? [unit];
}

const factorOf = (unit: string) => (isUnit(unit) ? UNITS[unit].factor : 1);

/** An amount's number in its unit: thousandths of the base unit → "250", "1.5", "0.25". */
export function amountNumber(qtyMilli: number, unit: string): string {
  const n = Math.round((qtyMilli / 1000 / factorOf(unit)) * 1000) / 1000;
  return String(n);
}

/** A number in a unit as thousandths of the base unit (rounded to whole thousandths). */
export function qtyMilliOf(n: number, unit: string): number {
  return Math.round(n * 1000 * factorOf(unit));
}

/** "250 g", "1 L", "4 pcs"; null without an amount. */
export function amountText(qtyMilli: number | null, unit: string | null): string | null {
  if (qtyMilli === null || !(qtyMilli > 0)) return null;
  const u = listUnitOf(unit);
  return `${amountNumber(qtyMilli, u)} ${u}`;
}

/** What a line asks for when it names no amount: one piece. */
export const DEFAULT_AMOUNT = { qtyMilli: 1000, unit: "pcs" as ListUnit };

/** A plain number as typed: "1.5", "1,5", "½"; null when it isn't one above 0. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(",", ".").replace("¼", ".25").replace("½", ".5").replace("¾", ".75");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unitChip(unit: ListUnit): AmountUnit {
  const def = UNITS[unit];
  return { id: `u:${unit}`, kind: "unit", measure: null, unit, one: def.singular, many: def.plural, step: 1, min: 1, perOneMilli: def.factor * 1000 };
}

const unitIdOf = (id: string | null) => (id && id.startsWith("u:") ? (id.slice(2) as ListUnit) : null);

/**
 * The box (TickRow's amount, RV-10) for a line's amount: the saved amount in
 * grey, in the unit chosen (converted within the family), what was typed
 * over it, and the chips of its family only.
 */
export function listBox(saved: { qtyMilli: number | null; unit: string | null }, state: TickState): TickAmount {
  const base = saved.qtyMilli !== null && saved.qtyMilli > 0 ? { qtyMilli: saved.qtyMilli, unit: listUnitOf(saved.unit) } : DEFAULT_AMOUNT;
  const family = familyOf(base.unit);
  const chosen = unitIdOf(state.unit);
  const unit = chosen && family.includes(chosen) ? chosen : base.unit;
  const ghost = amountNumber(base.qtyMilli, unit);
  const typed = state.typed.trim() ? parseAmount(state.typed) : null;
  const number = typed !== null ? String(typed) : ghost;
  const qtyMilli = typed !== null ? qtyMilliOf(typed, unit) : qtyMilliOf(Number(ghost), unit);
  const chip = unitChip(unit);
  const pick = { unit: chip.id, count: Number(number), rest: false, how: typed !== null ? ("typed" as const) : ("suggested" as const) };
  return {
    units: family.map(unitChip),
    unit: chip,
    ghost,
    ghostPick: { ...pick, count: Number(ghost), how: "suggested" },
    pick,
    typed: typed !== null,
    invalid: state.typed.trim() !== "" && typed === null,
    number,
    word: unit,
    words: `${number} ${unit}`,
    qtyMilli,
  };
}

/** What a box saves: its amount and unit, or null when it says what is already saved. */
export function boxChange(saved: { qtyMilli: number | null; unit: string | null }, box: Pick<TickAmount, "qtyMilli" | "unit" | "invalid">): { qtyMilli: number; unit: ListUnit } | null {
  if (box.invalid || !(box.qtyMilli > 0)) return null;
  const unit = box.unit.unit as ListUnit;
  if (saved.qtyMilli === box.qtyMilli && listUnitOf(saved.unit) === unit) return null;
  return { qtyMilli: box.qtyMilli, unit };
}

// ── Got it, on this device ────────────────────────────────────────

/** Where the device keeps what was ticked as got (the run reads it). */
export const GOT_KEY = "cookpool.shopping.got";
/** The most ticks kept; the oldest go first. */
export const GOT_MAX = 200;

/** One line's tick: its pantry, its source and its name (the same before and after the server's id). */
export function gotKey(pantryKey: string, source: ShoppingLine["source"], name: string): string {
  return `${pantryKey}|${source}|${nameKeyOf(name)}`;
}

export function parseGot(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-GOT_MAX) : [];
  } catch {
    return [];
  }
}

/** Tick or untick one key. Never mutates `got`. */
export function toggleGot(got: readonly string[], key: string): string[] {
  return got.includes(key) ? got.filter((k) => k !== key) : [...got, key].slice(-GOT_MAX);
}

// ── The list ──────────────────────────────────────────────────────

export interface NeedRow {
  /** `gotKey`. */
  key: string;
  /** `stp_…` or `shp_…`. */
  id: string;
  source: ShoppingLine["source"];
  name: string;
  /** The Always have tag. */
  always: boolean;
  /** The staple's dot: amber Low, red Out. */
  dot: "low" | "out" | null;
  /** "Out", "Low"; who added a hand line ("You", "Ana"). */
  fact: string;
  qtyMilli: number | null;
  unit: string | null;
  got: boolean;
}

export interface NeedGroup {
  key: string;
  pantry: StaplePantry;
  title: string;
  /** "· split equally" for a group. */
  sub: string;
  /** "2 of 3 got"; empty while none is. */
  done: string;
  /** Not a viewer: the rows can be changed and ticked. */
  canEdit: boolean;
  rows: NeedRow[];
}

/** Every pantry with something on its list, in the read's order (yours, then each group). */
export function needGroups(
  res: StaplesResponse | null | undefined,
  ctx: { meId: string | null; names?: MemberNames | null; got: readonly string[]; canEdit: (pantry: StaplePantry) => boolean },
): NeedGroup[] {
  const got = new Set(ctx.got);
  return (res?.pantries ?? [])
    .map((p): NeedGroup => {
      const pk = stapleKey(p.owner);
      const canEdit = ctx.canEdit(p);
      const rows = shoppingLines(p).map((l): NeedRow => {
        const name = l.source === "staple" ? l.staple.name : l.item.name;
        const key = gotKey(pk, l.source, name);
        const base = { key, source: l.source, name, qtyMilli: l.qtyMilli, unit: l.unit, got: canEdit && got.has(key) };
        if (l.source === "staple") {
          const out = l.staple.status === "out";
          return { ...base, id: l.staple.id, always: true, dot: out ? "out" : "low", fact: out ? "Out" : "Low" };
        }
        return { ...base, id: l.item.id, always: false, dot: null, fact: l.item.addedBy === ctx.meId ? "You" : memberLabel(l.item.addedBy, ctx.meId, ctx.names) };
      });
      const n = rows.filter((r) => r.got).length;
      return { key: pk, pantry: p, title: pantryName(p.owner), sub: p.owner.kind === "group" ? "· split equally" : "", done: n > 0 ? `${n} of ${rows.length} got` : "", canEdit, rows };
    })
    .filter((g) => g.rows.length > 0);
}

/** "· 5": every line on the list. */
export function needCountText(groups: readonly NeedGroup[]): string {
  return `· ${groups.reduce((n, g) => n + g.rows.length, 0)}`;
}

/** The tick's name: "Got it: 250 g of Tea"; once ticked, "Got 250 g of Tea, untick". */
export function gotLabel(words: string, name: string, on: boolean): string {
  return on ? `Got ${words} of ${name}, untick` : `Got it: ${words} of ${name}`;
}

/** The main button: "Done shopping · 3 items", and under it what was got ("Tea 250 g · Cooking oil 1 L"); null while nothing is ticked. */
export function doneBar(rows: readonly { name: string; amount: string; got: boolean }[]): { title: string; sub: string; count: number } | null {
  const got = rows.filter((r) => r.got);
  if (got.length === 0) return null;
  return {
    title: `Done shopping · ${got.length} ${got.length === 1 ? "item" : "items"}`,
    sub: got.map((r) => `${r.name} ${r.amount}`).join(" · "),
    count: got.length,
  };
}

/** The run's address with the ticked rows (they are read from this device). */
export const LIST_RUN_HREF = "/pantry/run?from=list";

/** Whether the run was opened from the list (Done shopping). */
export function fromList(search: string | URLSearchParams | null | undefined): boolean {
  const params = typeof search === "string" || !search ? new URLSearchParams(search ?? "") : search;
  return params.get("from") === "list";
}

// ── Add what we need… ─────────────────────────────────────────────

/** A pantry a line can be added to: yours, or a group you add to. */
export interface ListPantry {
  key: string;
  pantry: StaplePantry;
  label: string;
}

export interface NeedSuggestion {
  key: string;
  name: string;
  /** "100 g · Flat 4B · 5 days ago", "Food · to Mine", "New · to Flat 4B". */
  fact: string;
  /** "Add Ginger, 100 g, to Flat 4B". */
  label: string;
  pantryKey: string;
  qtyMilli: number | null;
  unit: ListUnit | null;
}

/** The most suggestions from what was bought before and the food list. */
export const SUGGESTIONS_MAX = 3;

/** "Ginger" from "ginger": the first letter up, the rest as typed. */
export function niceName(typed: string): string {
  const t = typed.trim().replace(/\s+/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/**
 * What the quick add offers for `q`: names bought before (their pantry, last
 * amount and when, in a pantry you add to), then foods from the food list
 * (to the first pantry, which is yours), at most SUGGESTIONS_MAX, none
 * already on that pantry's list; then, unless one of them is exactly `q`,
 * the new name to Mine and to each group.
 */
export function needSuggestions(
  q: string,
  ctx: {
    history: readonly ItemHistoryEntry[];
    foods: readonly (Pick<FoodMatch, "key" | "name"> & { matchedName?: string })[];
    pantries: readonly ListPantry[];
    /** `gotKey`-style `pantryKey|nameKey` of what is listed already. */
    listed: ReadonlySet<string>;
    today: string;
  },
): NeedSuggestion[] {
  const typed = q.trim().toLowerCase();
  if (!typed || ctx.pantries.length === 0) return [];
  const onList = (pk: string, name: string) => ctx.listed.has(`${pk}|${nameKeyOf(name)}`);
  const byKey = new Map(ctx.pantries.map((p) => [p.key, p] as const));
  const out: NeedSuggestion[] = [];
  const seen = new Set<string>();
  // The reads keep their last answer while the next loads: only what matches what is typed now.
  const matches = (...names: (string | undefined)[]) => names.some((n) => !!n && n.toLowerCase().includes(typed));
  for (const h of ctx.history) {
    if (out.length >= SUGGESTIONS_MAX) break;
    if (!matches(h.name)) continue;
    const pk = h.pantry.kind === "personal" ? stapleKey({ kind: "personal" }) : h.pantry.orgId;
    const p = byKey.get(pk);
    if (!p || onList(pk, h.name) || seen.has(nameKeyOf(h.name))) continue;
    seen.add(nameKeyOf(h.name));
    const unit = listUnitOf(h.unit);
    const amount = amountText(h.qtyMilli, unit);
    const when = calendarWeekdayText(h.lastBoughtOn, ctx.today);
    out.push({
      key: `h:${pk}:${nameKeyOf(h.name)}`,
      name: h.name,
      fact: [amount, p.label, when].filter(Boolean).join(" · "),
      label: `Add ${h.name}${amount ? `, ${amount},` : ""} to ${p.label}`,
      pantryKey: pk,
      qtyMilli: h.qtyMilli > 0 ? h.qtyMilli : null,
      unit: h.qtyMilli > 0 ? unit : null,
    });
  }
  const first = ctx.pantries[0]!;
  for (const f of ctx.foods) {
    if (out.length >= SUGGESTIONS_MAX) break;
    if (!matches(f.name, f.matchedName)) continue;
    if (seen.has(nameKeyOf(f.name)) || onList(first.key, f.name)) continue;
    seen.add(nameKeyOf(f.name));
    out.push({ key: `f:${f.key}`, name: f.name, fact: `Food · to ${first.label}`, label: `Add ${f.name} to ${first.label}`, pantryKey: first.key, qtyMilli: null, unit: null });
  }
  const nice = niceName(q);
  if (!seen.has(typed)) {
    for (const p of ctx.pantries) {
      if (onList(p.key, nice)) continue;
      out.push({ key: `n:${p.key}`, name: nice, fact: `New · to ${p.label}`, label: `Add ${nice} to ${p.label}`, pantryKey: p.key, qtyMilli: null, unit: null });
    }
  }
  return out;
}

/** What a list holds already, for the suggestions: `pantryKey|nameKey` of every line. */
export function listedNames(res: StaplesResponse | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const p of res?.pantries ?? []) {
    for (const l of shoppingLines(p)) out.add(`${stapleKey(p.owner)}|${nameKeyOf(l.source === "staple" ? l.staple.name : l.item.name)}`);
  }
  return out;
}

/** The toast for an added line: "Ginger · Flat 4B", with " · got it" when it came in ticked. */
export function addedToast(name: string, pantryLabel: string, ticked: boolean): string {
  return `${name} · ${pantryLabel}${ticked ? " · got it" : ""}`;
}
