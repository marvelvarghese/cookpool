/**
 * The Kitchen's title switcher, rows and Always have per pantry
 * (cookpool-revamp RV-21, the canvas's RvKitchenB), the pure half:
 *
 * - **The switcher:** "Kitchen ▾" (All) or "<pantry> ▾" opens a sheet of All
 *   kitchens and each pantry ("Mine", then each group), each "N items · N
 *   people" with its use-soon count, the current one checked. The choice is
 *   kept on the device; `?pantry=` still wins on arrival.
 * - **Rows:** use soon first in each section (pantry-list's order), the line
 *   under the name "Use by tomorrow" in amber or "Expired" in red, and a 3 px
 *   stock bar under the name (the accent; amber under a fifth; the expired
 *   tint once expired).
 * - **Always have:** a chip per staple with its dot (none, amber running
 *   low, red out); a tap opens Running low · Out · Got more, and Got more asks
 *   the price, then "₹60 each · You, Ana, Rohit" and "Split ₹180 equally"
 *   (your own: "Just you · no split", "Add ₹320").
 * - **The shopping list's count** (the header badge): staples running low or
 *   out and lines added by hand, in every pantry.
 *
 * Dependency-free (contracts, the engine and pure kitchen modules), so it is
 * unit-testable.
 */

import type { AiUsesResponse, KitchenItem, KitchenStaple, ReachableItem, Pantry, StapleOwner, StaplePantry, StapleStatus, StaplesResponse } from "@saas/contracts/kitchen";
import { shoppingLines, stapleListed } from "@saas/contracts/kitchen";
import { buildExpense } from "@saas/kitchen-engine/ledger";
import { UNITS, isUnit } from "@saas/kitchen-engine/units";
import { PERSONAL_PANTRY, pantryKey } from "./pantry";
import { MINE_LABEL, type ItemStatus, type PantryShow } from "./pantry-list";
import { memberLabel, type MemberNames } from "./members";
import type { TickMeta, TickState } from "./tick-row";
import { proposalPick } from "./say-it";
import { quantityInput, shortMoney } from "./from-before";

// ── The switcher ──────────────────────────────────────────────────

/** "all", or a pantry's key (`pantryKey`: "personal" or the group's `org_…`). */
export type KitchenView = string;
export const ALL_VIEW = "all";
/** Where the device keeps the choice. */
export const KITCHEN_VIEW_KEY = "cookpool.kitchen.view";

/** A kept or linked choice, when it is still one of your pantries; else All. */
export function parseView(raw: string | null | undefined, pantries: readonly Pantry[] | null | undefined): KitchenView {
  if (!raw || raw === ALL_VIEW) return ALL_VIEW;
  if (!pantries) return raw;
  return pantries.some((p) => pantryKey(p) === raw) ? raw : ALL_VIEW;
}

/** What the rows show for a view (pantry-list's `PantryShow`). */
export function viewShow(view: KitchenView): PantryShow {
  return view === ALL_VIEW ? { kind: "all" } : { kind: "pantry", key: view };
}

/** "Mine", or the group's name. */
export function pantryName(p: Pantry | StapleOwner): string {
  return p.kind === "personal" ? MINE_LABEL : p.name;
}

/** The large title: "Kitchen" on All, else the pantry's name. */
export function kitchenTitle(view: KitchenView, pantries: readonly Pantry[] | null | undefined): string {
  if (view === ALL_VIEW) return "Kitchen";
  const p = pantries?.find((x) => pantryKey(x) === view);
  return p ? pantryName(p) : "Kitchen";
}

export interface SwitcherOption {
  key: KitchenView;
  name: string;
  /** "13 items", "6 items · 3 people". */
  count: string;
  soon: number;
  /** "2 use soon". */
  soonText: string;
  on: boolean;
}

/** "1 item", "6 items". */
export function itemsText(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"}`;
}

/** The sheet's rows: All kitchens, then each pantry (yours first, then the groups in `order`). */
export function switcherOptions(input: {
  pantries: readonly Pantry[];
  rows: readonly { item: Pick<KitchenItem, "pantry">; status: Pick<ItemStatus, "soon" | "expired"> }[];
  staples: StaplesResponse | null | undefined;
  view: KitchenView;
  order?: readonly string[];
}): SwitcherOption[] {
  const count = (key: string | null) => {
    const its = key === null ? input.rows : input.rows.filter((r) => pantryKey(r.item.pantry) === key);
    return { n: its.length, soon: its.filter((r) => r.status.soon || r.status.expired).length };
  };
  const people = (key: string) => input.staples?.pantries.find((p) => stapleKey(p.owner) === key)?.splitAmong.length ?? 0;
  const order = input.order ?? [];
  const place = (p: Pantry) => (p.kind === "personal" ? -1 : order.indexOf(p.orgId) === -1 ? order.length : order.indexOf(p.orgId));
  const pantries = [...input.pantries].sort((a, b) => place(a) - place(b) || pantryName(a).localeCompare(pantryName(b)));
  const option = (key: string, name: string, n: number, soon: number, folks: number): SwitcherOption => ({
    key,
    name,
    count: itemsText(n) + (folks > 0 ? ` · ${folks} ${folks === 1 ? "person" : "people"}` : ""),
    soon,
    soonText: `${soon} use soon`,
    on: input.view === key,
  });
  const all = count(null);
  return [
    option(ALL_VIEW, "All kitchens", all.n, all.soon, 0),
    ...pantries.map((p) => {
      const key = pantryKey(p);
      const c = count(key);
      return option(key, pantryName(p), c.n, c.soon, p.kind === "group" ? people(key) : 0);
    }),
  ];
}

// ── Rows ──────────────────────────────────────────────────────────

/** The line under a row's name (the board's): "Expired" in red, "Use by tomorrow" in amber, else what it was. */
export function kitchenRowMeta(base: TickMeta, status: Pick<ItemStatus, "soon" | "expired">, useBy: string | null): TickMeta {
  if (base.tone === "logged") return base;
  if (status.expired) return { text: "Expired", tone: "expired" };
  if (status.soon && useBy) return { text: `Use by ${useBy}`, tone: "soon" };
  return base;
}

export type StockTone = "ok" | "low" | "expired";

/** The 3 px bar: how much is left (at least 4 %, so it shows), amber under a fifth, the expired tint once expired. */
export function stockBar(item: Pick<KitchenItem, "qtyLeftMilli" | "qtyBoughtMilli">, status: Pick<ItemStatus, "expired">): { pct: number; tone: StockTone; text: string } {
  const share = item.qtyBoughtMilli > 0 ? Math.min(1, Math.max(0, item.qtyLeftMilli / item.qtyBoughtMilli)) : 0;
  const pct = Math.max(4, Math.round(share * 100));
  const tone: StockTone = status.expired ? "expired" : share < 0.2 ? "low" : "ok";
  const text = tone === "expired" ? `Expired, ${pct} percent left` : `${tone === "low" ? "Running low, " : ""}${pct} percent left`;
  return { pct, tone, text };
}

// ── Always have ───────────────────────────────────────────────────

/** A staple pantry's key, as the Kitchen keys pantries. */
export function stapleKey(owner: StapleOwner): string {
  return owner.kind === "personal" ? PERSONAL_PANTRY : owner.orgId;
}

/** The SDK's `pantry` argument: null for yours, the group's `org_…`. */
export function stapleApiPantry(owner: StapleOwner): string | null {
  return owner.kind === "personal" ? null : owner.orgId;
}

export function staplePantryOf(res: StaplesResponse | null | undefined, key: string): StaplePantry | null {
  return res?.pantries.find((p) => stapleKey(p.owner) === key) ?? null;
}

export interface StapleChip {
  id: string;
  name: string;
  dot: "low" | "out" | null;
  /** "Tea, out, options". */
  label: string;
}

export function stapleChips(pantry: Pick<StaplePantry, "staples">): StapleChip[] {
  return pantry.staples.map((s) => ({
    id: s.id,
    name: s.name,
    dot: s.status === "ok" ? null : s.status,
    label: `${s.name}${s.status === "low" ? ", running low" : s.status === "out" ? ", out" : ""}, options`,
  }));
}

/** "· split equally" beside a group's Always have. */
export function stapleSub(pantry: Pick<StaplePantry, "owner">): string {
  return pantry.owner.kind === "group" ? "· split equally" : "";
}

/** What Running low and Out do: set it, or (pressed again) back to ok. */
export function nextStatus(current: StapleStatus, pressed: Exclude<StapleStatus, "ok">): StapleStatus {
  return current === pressed ? "ok" : pressed;
}

/** The toast after a status change: on the list, off it, or marked. */
export function statusToast(name: string, from: StapleStatus, to: StapleStatus): string {
  if (to === "ok") return `${name} · off the shopping list`;
  if (from === "ok") return `${name} · on the shopping list`;
  return `${name} · marked ${to === "out" ? "out" : "running low"}`;
}

export interface StapleSheet {
  name: string;
  /** "Flat 4B · split equally · out". */
  sub: string;
  subTone: "muted" | "soon" | "expired";
  lowOn: boolean;
  outOn: boolean;
  /** The price box's grey: last time's price, as typed. */
  pricePh: string;
  /** What Got more posts, in minor units: the typed price, else last time's; 0 when neither. */
  priceMinor: number;
  /** "₹60 each · You, Ana, Rohit"; yours: "Just you · no split". */
  splitLine: string;
  /** "Split ₹180 equally"; yours: "Add ₹320". */
  postLabel: string;
}

/** The staple's sheet, with what the price box holds (`priceMinor` parsed by the caller; null when empty or not a price). */
export function stapleSheet(staple: KitchenStaple, pantry: StaplePantry, ctx: { typedMinor: number | null; meId: string | null; names?: MemberNames | null }): StapleSheet {
  const group = pantry.owner.kind === "group";
  const currency = pantry.currency;
  const priceMinor = ctx.typedMinor ?? staple.lastPriceMinor ?? 0;
  const money = (m: number) => shortMoney(m, currency);
  const members = [...pantry.splitAmong].sort((a, b) => (a === ctx.meId ? -1 : b === ctx.meId ? 1 : 0));
  const status = staple.status === "low" ? " · running low" : staple.status === "out" ? " · out" : "";
  let each = 0;
  if (group && members.length > 0 && priceMinor > 0) {
    const parts = buildExpense({ totalMinor: priceMinor, payers: [{ subjectId: members[0]!, amountMinor: priceMinor }], mode: "equal", participants: members.map((subjectId) => ({ subjectId })) });
    each = Math.max(...parts.map((p) => p.owedMinor));
  }
  return {
    name: staple.name,
    sub: `${pantryName(pantry.owner)}${group ? " · split equally" : ""}${status}`,
    subTone: staple.status === "out" ? "expired" : staple.status === "low" ? "soon" : "muted",
    lowOn: staple.status === "low",
    outOn: staple.status === "out",
    pricePh: staple.lastPriceMinor !== null ? money(staple.lastPriceMinor).replace(/^[^\d]+/, "") : "",
    priceMinor,
    splitLine: group ? `${money(each)} each · ${members.map((m) => memberLabel(m, ctx.meId, ctx.names)).join(", ")}` : "Just you · no split",
    postLabel: group ? `Split ${money(priceMinor)} equally` : `Add ${money(priceMinor)}`,
  };
}

/** The toast after Got more: "Tea ₹180 · ₹60 each"; yours "Coffee · ₹320". */
export function boughtToast(sheet: Pick<StapleSheet, "name" | "priceMinor">, pantry: StaplePantry): string {
  const money = (m: number) => shortMoney(m, pantry.currency);
  const n = pantry.splitAmong.length;
  if (pantry.owner.kind === "group" && n > 0) return `${sheet.name} ${money(sheet.priceMinor)} · ${money(Math.round(sheet.priceMinor / n))} each`;
  return `${sheet.name} · ${money(sheet.priceMinor)}`;
}

// ── The shopping list ─────────────────────────────────────────────

/** The shopping list's page (a pushed screen: no tab bar). */
export const SHOPPING_LIST_HREF = "/pantry/list";

/** The header badge: every pantry's list lines (staples running low or out, and lines added by hand). */
export function shoppingCount(res: StaplesResponse | null | undefined): number {
  return (res?.pantries ?? []).reduce((n, p) => n + shoppingLines(p).length, 0);
}

/** "Shopping list, 5 items". */
export function shoppingLabel(n: number): string {
  return `Shopping list, ${itemsText(n)}`;
}

/** A staple's dot on the list: amber running low, red out. */
export function listedTone(staple: Pick<KitchenStaple, "status">): "low" | "out" | null {
  return stapleListed(staple) ? (staple.status as "low" | "out") : null;
}

/** An amount on the list: thousandths of the base unit, shown in its unit ("250 g", "2 kg", "1 packet"); null without one. */
export function listAmount(qtyMilli: number | null, unit: string | null): string | null {
  if (qtyMilli === null || !unit) return null;
  const factor = isUnit(unit) ? UNITS[unit].factor : 1;
  const n = Math.round((qtyMilli / 1000 / factor) * 1000) / 1000;
  return `${String(n)} ${unit}`;
}

export interface ListRow {
  /** `stp_…` or `shp_…`. */
  id: string;
  source: "staple" | "hand";
  name: string;
  /** "Out", "Running low"; a hand-added line: none. */
  dot: "low" | "out" | null;
  /** "Out · 250 g · ₹180", "Added by you · 1 kg", "Ana added". */
  fact: string;
}

export interface ListGroup {
  key: string;
  pantry: StaplePantry;
  title: string;
  /** "· split equally" for a group. */
  sub: string;
  rows: ListRow[];
}

/** The shopping list, by pantry (yours, then each group), each pantry's staples running low or out, then its hand-added lines. */
export function listGroups(res: StaplesResponse | null | undefined, ctx: { meId: string | null; names?: MemberNames | null }): ListGroup[] {
  return (res?.pantries ?? []).map((p) => ({
    key: stapleKey(p.owner),
    pantry: p,
    title: pantryName(p.owner),
    sub: stapleSub(p),
    rows: shoppingLines(p).map((l): ListRow => {
      const amount = listAmount(l.qtyMilli, l.unit);
      if (l.source === "staple") {
        const s = l.staple;
        const price = s.lastPriceMinor !== null ? shortMoney(s.lastPriceMinor, s.currency ?? p.currency) : null;
        return { id: s.id, source: "staple", name: s.name, dot: listedTone(s), fact: [s.status === "out" ? "Out" : "Running low", amount, price].filter(Boolean).join(" · ") };
      }
      const who = l.item.addedBy === ctx.meId ? "Added by you" : `${memberLabel(l.item.addedBy, ctx.meId, ctx.names)} added`;
      return { id: l.item.id, source: "hand", name: l.item.name, dot: null, fact: [who, amount].filter(Boolean).join(" · ") };
    }),
  }));
}

// ── Say it, ticking rows ──────────────────────────────────────────

/** What a read ticks: the rows it named that can be picked, each with its box. */
export function saidTicks(
  res: Pick<AiUsesResponse, "lines">,
  rows: ReadonlyMap<string, { item: ReachableItem; pickable: boolean }>,
): { id: string; box: TickState }[] {
  const out: { id: string; box: TickState }[] = [];
  for (const line of res.lines) {
    const row = rows.get(line.itemRef.itemId);
    if (!row || !row.pickable || out.some((o) => o.id === line.itemRef.itemId)) continue;
    const pick = proposalPick(row.item, line);
    if (!pick) continue;
    out.push({ id: line.itemRef.itemId, box: { typed: pick.rest ? "" : quantityInput(pick.count), unit: pick.unit } });
  }
  return out;
}

