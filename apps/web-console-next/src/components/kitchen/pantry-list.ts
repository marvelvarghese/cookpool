/**
 * The new Pantry (cookpool-pantry PN-5, design §1, §2.3, §4) as pure
 * view-models: what each row says — its tag, its level bar and colour, the
 * suggestion chip — the filter chips with their counts (All · Use soon N ·
 * Running low N · a pantry N), the sections (by pantry since RV-13: the
 * kinds only name a typed category now), the use-soon
 * card, `?filter=`/`?pantry=`/`?q=`/`?open=`, and where Home's field and
 * `/use` lead in the new frame. In the old frame none of this is used.
 * Dependency-free (contracts, the engine and the pure kitchen modules), so it
 * is unit-testable.
 */

import { LEFTOVERS_CATEGORY, type KitchenItem, type KitchenUsual, type Pantry } from "@saas/contracts/kitchen";
import { isRunningLow } from "@saas/contracts/kitchen-usuals";
import { isPendingId } from "@/lib/optimistic";
import {
  ALL_PANTRIES,
  categoryLabel,
  countWords,
  isExpired,
  isUseSoon,
  itemHref,
  itemRefOf,
  itemRefParam,
  leftOfBought,
  leftPercent,
  matchesQuery,
  pantryChipLabel,
  pantryChips,
  pantryKey,
  parseItemRef,
  parsePantryParam,
  PERSONAL_PANTRY,
  type ItemRef,
} from "./pantry";
import { itemLadder, type ItemLadder, type SetUsual } from "./pantry-set";
import { consumersText } from "./item-use";
import type { MemberNames } from "./members";
import { LIST_RUN_HREF } from "./shopping-list";

type ListItem = KitchenItem & { canUse?: boolean };

// ── Kinds (design §1.6) ───────────────────────────────────────────

export type PantryKind = "dairy" | "veg" | "fruit" | "grains" | "protein" | "spices" | "leftovers" | "other";

/** The sections, in the design's order. */
export const PANTRY_KINDS: readonly { key: PantryKind; label: string }[] = [
  { key: "dairy", label: "Dairy" },
  { key: "veg", label: "Veg" },
  { key: "fruit", label: "Fruit" },
  { key: "grains", label: "Grains" },
  { key: "protein", label: "Protein" },
  { key: "spices", label: "Spices" },
  { key: "leftovers", label: "Leftovers" },
  { key: "other", label: "Other" },
];

const KIND_KEYS = new Set<string>(PANTRY_KINDS.map((k) => k.key));

/** An item's kind is its category (the add form's ids, and the dish's Leftovers); anything else is Other. */
export function kindOf(category: string | null | undefined): PantryKind {
  const c = (category ?? "").trim().toLowerCase();
  if (c === LEFTOVERS_CATEGORY.toLowerCase()) return "leftovers";
  return KIND_KEYS.has(c) ? (c as PantryKind) : "other";
}

/** A category outside the list, as typed ("Snacks"); null for a known one. */
export function typedCategory(category: string | null | undefined): string | null {
  const c = (category ?? "").trim();
  if (!c || kindOf(c) !== "other" || c.toLowerCase() === "other") return null;
  return categoryLabel(c);
}

// ── What each item is: use soon, expired, running low ─────────────

export interface ItemStatus {
  /** Use-by from today to USE_SOON_DAYS ahead. */
  soon: boolean;
  expired: boolean;
  /** Under 20 % of what was bought, or under one usual amount (`isRunningLow`), with something left. */
  low: boolean;
}

export function itemStatus(item: Pick<KitchenItem, "daysToUseBy" | "qtyLeftMilli" | "qtyBoughtMilli">, usual: SetUsual | null | undefined): ItemStatus {
  return {
    soon: isUseSoon(item.daysToUseBy),
    expired: isExpired(item.daysToUseBy),
    low: item.qtyLeftMilli > 0 && isRunningLow({ item, usual: usual ?? null, now: usual?.now ?? null }),
  };
}

// ── The filter chips (design §1.4) ────────────────────────────────

/** What the list shows: everything, use soon (and expired), running low, or one pantry. */
export type PantryShow = { kind: "all" } | { kind: "soon" } | { kind: "low" } | { kind: "pantry"; key: string };

/** `?filter=` and `?pantry=` as one choice: a pantry first, then soon (the old frame's expired too) or low. */
export function parseShow(filter: string | null | undefined, pantry: string | null | undefined): PantryShow {
  const key = parsePantryParam(pantry);
  if (key !== ALL_PANTRIES) return { kind: "pantry", key };
  if (filter === "soon" || filter === "expired") return { kind: "soon" };
  if (filter === "low") return { kind: "low" };
  return { kind: "all" };
}

/** The address's query for a choice (others kept): `filter=soon`, `filter=low`, `pantry=org_…`, or neither. */
export function showParams(show: PantryShow, current: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(current);
  params.delete("filter");
  params.delete("pantry");
  if (show.kind === "soon" || show.kind === "low") params.set("filter", show.kind);
  if (show.kind === "pantry") params.set("pantry", show.key);
  return params;
}

export function sameShow(a: PantryShow, b: PantryShow): boolean {
  return a.kind === b.kind && (a.kind !== "pantry" || (b.kind === "pantry" && a.key === b.key));
}

/** Whether an item is shown under a choice. */
export function showsItem(show: PantryShow, item: Pick<KitchenItem, "pantry">, status: ItemStatus): boolean {
  if (show.kind === "soon") return status.soon || status.expired;
  if (show.kind === "low") return status.low;
  if (show.kind === "pantry") return pantryKey(item.pantry) === show.key;
  return true;
}

export interface ShowChip {
  id: string;
  show: PantryShow;
  label: string;
  count: number;
  on: boolean;
  /** The dot before it: amber for Use soon, orange for Running low. */
  dot: "soon" | "low" | null;
}

/**
 * All · Use soon N · Running low N · then each pantry N (yours first, then
 * groups opened last first; only with more than one pantry). A count of 0
 * hides its chip — except All, and the one chosen.
 */
export function showChips(input: {
  items: readonly ListItem[];
  statuses: ReadonlyMap<string, ItemStatus>;
  pantries: readonly Pantry[];
  recentSlugs?: readonly string[];
  show: PantryShow;
}): ShowChip[] {
  const { items, statuses, show } = input;
  const status = (i: ListItem) => statuses.get(i.id) ?? { soon: false, expired: false, low: false };
  const chip = (id: string, s: PantryShow, label: string, count: number, dot: ShowChip["dot"]): ShowChip => ({ id, show: s, label, count, on: sameShow(s, show), dot });
  const all: ShowChip[] = [
    chip("all", { kind: "all" }, "All", items.length, null),
    chip("soon", { kind: "soon" }, "Use soon", items.filter((i) => status(i).soon || status(i).expired).length, "soon"),
    chip("low", { kind: "low" }, "Running low", items.filter((i) => status(i).low).length, "low"),
  ];
  const chips = input.pantries.length > 1 ? pantryChips(input.pantries, input.recentSlugs) : [];
  for (const p of chips) {
    all.push(chip(`pantry:${p.key}`, { kind: "pantry", key: p.key }, p.label, items.filter((i) => pantryKey(i.pantry) === p.key).length, null));
  }
  return all.filter((c) => c.id === "all" || c.on || c.count > 0);
}

// ── A row (design §1, §2.3) ───────────────────────────────────────

export type RowTagTone = "pantry" | "soon" | "expired" | "low" | "ask";

export interface RowTag {
  /** "Flat 4B", "Use soon · Tue", "Expired", "Running low", "Ask Meera". */
  label: string;
  tone: RowTagTone;
}

export type LevelTone = "ok" | "low" | "expired";

/** The bar's colours (design §2.3), as the theme's tokens (RV-24): the accent, use soon when running low, expired once expired. */
export const LEVEL_COLORS: Readonly<Record<LevelTone, string>> = { ok: "hsl(var(--primary))", low: "hsl(var(--cp-soon))", expired: "hsl(var(--cp-expired))" };

export function levelTone(status: ItemStatus): LevelTone {
  if (status.expired) return "expired";
  if (status.low || status.soon) return "low";
  return "ok";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "today", "tomorrow", else the use-by's weekday ("Tue"), a UTC calendar day as the server counts it. */
export function useByDay(item: Pick<KitchenItem, "daysToUseBy" | "expiresOn">): string {
  if (item.daysToUseBy === 0) return "today";
  if (item.daysToUseBy === 1) return "tomorrow";
  const m = item.expiresOn ? /^(\d{4})-(\d{2})-(\d{2})/.exec(item.expiresOn) : null;
  if (!m) return `${item.daysToUseBy ?? 0} days`;
  return WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()]!;
}

/** The row's one tag: Ask (PN-9) first, then Expired, Use soon · Tue, Running low, and the pantry on All. */
export function rowTag(
  item: Pick<KitchenItem, "daysToUseBy" | "expiresOn" | "pantry">,
  status: ItemStatus,
  ctx: { showPantry: boolean; askName?: string | null },
): RowTag | null {
  if (ctx.askName) return { label: `Ask ${ctx.askName}`, tone: "ask" };
  if (status.expired) return { label: "Expired", tone: "expired" };
  if (status.soon) return { label: `Use soon · ${useByDay(item)}`, tone: "soon" };
  if (status.low) return { label: "Running low", tone: "low" };
  if (ctx.showPantry) return { label: pantryChipLabel(item.pantry), tone: "pantry" };
  return null;
}

/** What the row's end does: log the suggestion in one tap, or ("Use…") open the row. */
export type RowChip =
  | {
      kind: "log";
      /** "1 glass" — the chip says it. */
      words: string;
      /** "Log 1 glass of Milk for you and Anu" — the chip's name. */
      label: string;
      /** Who it logs for: the people from last time, else you (empty for your own pantry). */
      consumers: string[];
    }
  | { kind: "open"; label: string };

export interface PantryRow {
  id: string;
  ref: ItemRef;
  /** `me:itm_…` / `org:org_…:itm_…` (`?open=`). */
  refParam: string;
  href: string;
  name: string;
  /** Past its use-by: the name is struck through. */
  struck: boolean;
  tag: RowTag | null;
  /** 0–100, a sliver while anything is left. */
  percent: number;
  level: LevelTone;
  /** "1 L of 2 L", with "· Flat 4B" on All when the tag says something else, and a typed category. */
  levelText: string;
  note: string | null;
  chip: RowChip | null;
  /** The ladder and its suggestion (the set row and the sheet start there). */
  ladder: ItemLadder;
  status: ItemStatus;
  /** The caller may log from it (not a viewer, something left, on the server). */
  canUse: boolean;
  pending: boolean;
  /**
   * The row as everyone has it ("use"), or as one who must ask the buyer
   * first ("ask", cookpool-pantry PN-9: its tag reads "Ask Meera" and PN-9
   * draws its chip and set row). Always "use" until PN-9.
   */
  variant: "use" | "ask";
}

/**
 * One item's row: its tag, its level (the bar's width and colour, never the
 * only signal — the tag or the counts say it too), the note, and the
 * suggestion chip — `suggestUse`'s amount, logged in one tap for the people
 * from last time — or "Use…" when nothing fits, which opens the row.
 */
export function pantryRow(
  item: ListItem,
  ctx: { usual: KitchenUsual | null; showPantry: boolean; meId: string | null; names?: MemberNames | null; askName?: string | null },
): PantryRow {
  const status = itemStatus(item, ctx.usual);
  const pending = isPendingId(item.id);
  const canUse = !pending && (item.canUse ?? true) && item.state === "active" && item.qtyLeftMilli > 0;
  const ladder = itemLadder(item, ctx.usual);
  const tag = rowTag(item, status, { showPantry: ctx.showPantry, askName: ctx.askName ?? null });
  const typed = kindOf(item.category) === "other" ? typedCategory(item.category) : null;
  const levelText = [leftOfBought(item), ctx.showPantry && tag?.tone !== "pantry" ? pantryChipLabel(item.pantry) : null, typed].filter(Boolean).join(" · ");
  const variant = ctx.askName ? "ask" : "use";
  let chip: RowChip | null = null;
  if (canUse && variant === "use") {
    const s = ladder.suggestion;
    if (s) {
      const consumers = item.pantry.kind === "personal" ? [] : s.consumerIds && s.consumerIds.length > 0 ? [...new Set(s.consumerIds)] : ctx.meId ? [ctx.meId] : [];
      const who = item.pantry.kind === "personal" ? null : consumersText(consumers, ctx.meId, ctx.names);
      chip = { kind: "log", words: s.step.words, label: `Log ${s.step.words} of ${item.name}${who ? ` for ${who}` : ""}`, consumers };
    } else {
      chip = { kind: "open", label: `Use some ${item.name}` };
    }
  }
  const ref = itemRefOf(item);
  return {
    id: item.id,
    ref,
    refParam: itemRefParam(ref),
    href: itemHref(item),
    name: item.name,
    struck: status.expired,
    tag,
    percent: leftPercent(item),
    level: levelTone(status),
    levelText,
    note: item.note ?? null,
    chip,
    ladder,
    status,
    canUse,
    pending,
    variant,
  };
}

// ── Sections by pantry (RV-13, the canvas's RvKitchen) ───────────

/** The personal pantry's section title (the board's "Mine"). */
export const MINE_LABEL = "Mine";

export interface PantrySection<T> {
  /** `pantryKey`: "personal" or the group's `org_…`. */
  key: string;
  /** "Mine", or the group's name. */
  label: string;
  count: number;
  rows: T[];
}

/** Use soon (expired first) before running low before the rest; then by name. */
function rank(status: ItemStatus): number {
  if (status.expired || status.soon) return 0;
  if (status.low) return 1;
  return 2;
}

function byUrgencyThenName<T extends { item: Pick<KitchenItem, "name" | "daysToUseBy">; status: ItemStatus }>(a: T, b: T): number {
  const ra = rank(a.status);
  const rb = rank(b.status);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const da = a.item.daysToUseBy ?? 0;
    const db = b.item.daysToUseBy ?? 0;
    if (da !== db) return da - db;
  }
  return a.item.name.localeCompare(b.item.name, "en", { sensitivity: "base" });
}

/**
 * The Kitchen's one flat list (RV-13; "Tick to log — the rules" 7): the
 * items the chip and the search show, one section per pantry — each group by
 * its name, in `order` (the pantry chips' keys: groups opened last first),
 * then yours as "Mine", as the board has them — never folding and never by
 * kind. Each is use soon first (soonest, so expired, first), then running
 * low, then by name. `exclude` (the rows Usual now lists) are left out, so a
 * row shows once; empty pantries are left out.
 */
export function pantrySections<T extends { id: string; item: Pick<KitchenItem, "name" | "category" | "daysToUseBy" | "pantry">; status: ItemStatus }>(
  rows: readonly T[],
  opts: { show: PantryShow; query?: string; order?: readonly string[]; exclude?: ReadonlySet<string> },
): PantrySection<T>[] {
  const query = opts.query ?? "";
  const byKey = new Map<string, PantrySection<T>>();
  for (const r of rows) {
    if (opts.exclude?.has(r.id)) continue;
    if (!showsItem(opts.show, r.item, r.status) || !matchesQuery(r.item, query)) continue;
    const key = pantryKey(r.item.pantry);
    let section = byKey.get(key);
    if (!section) {
      section = { key, label: r.item.pantry.kind === "personal" ? MINE_LABEL : r.item.pantry.name, count: 0, rows: [] };
      byKey.set(key, section);
    }
    section.rows.push(r);
  }
  const order = opts.order ?? [];
  const place = (s: PantrySection<T>) => {
    if (s.key === PERSONAL_PANTRY) return Number.MAX_SAFE_INTEGER;
    const i = order.indexOf(s.key);
    return i === -1 ? order.length : i;
  };
  const out = [...byKey.values()];
  for (const s of out) {
    s.rows.sort(byUrgencyThenName);
    s.count = s.rows.length;
  }
  return out.sort((a, b) => place(a) - place(b) || a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
}

// ── The Kitchen list (cookpool-kitchen-calm KC-10, the canvas's Kitchen board) ──

/** The Kitchen's chips: All · Use soon · Running low. */
export type KitchenChip = "all" | "soon" | "low";

export const KITCHEN_CHIPS: readonly { key: KitchenChip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "soon", label: "Use soon" },
  { key: "low", label: "Running low" },
];

/** The chip `?filter=` names (the old frame's `expired` is Use soon); All otherwise. */
export function parseKitchenChip(filter: string | null | undefined): KitchenChip {
  if (filter === "soon" || filter === "expired") return "soon";
  if (filter === "low") return "low";
  return "all";
}

export interface KitchenSplit<T> {
  /** Due soon or past its date, the most urgent first. */
  useFirst: T[];
  /** Everything else, the most urgent first, then by name. */
  shelf: T[];
}

/**
 * The board's two sections: Use first (soon or expired) and Shelf (the rest),
 * narrowed to one pantry (`pantry`, null for all), to the chip and to the
 * search. A row running low but in date stays on the Shelf, with its tag.
 */
export function kitchenSplit<T extends { id: string; item: Pick<KitchenItem, "name" | "category" | "daysToUseBy" | "pantry">; status: ItemStatus }>(
  rows: readonly T[],
  opts: { chip: KitchenChip; pantry: string | null; query?: string },
): KitchenSplit<T> {
  const query = opts.query ?? "";
  const useFirst: T[] = [];
  const shelf: T[] = [];
  for (const r of rows) {
    if (opts.pantry !== null && pantryKey(r.item.pantry) !== opts.pantry) continue;
    if (!matchesQuery(r.item, query)) continue;
    const first = r.status.soon || r.status.expired;
    if (opts.chip === "soon" && !first) continue;
    if (opts.chip === "low" && !r.status.low) continue;
    (first ? useFirst : shelf).push(r);
  }
  useFirst.sort(byUrgencyThenName);
  shelf.sort(byUrgencyThenName);
  return { useFirst, shelf };
}

// ── The use-soon card (design §1.5) ───────────────────────────────

export interface UseSoonCard {
  /** "3 things to use soon" */
  title: string;
  /** "Paneer, milk and tomatoes · Cook with them" */
  sub: string;
  href: string;
}

/** On All with no search: the items to use soon that you can use, linking to Cook now; null with none. */
export function useSoonCard(rows: readonly { item: Pick<KitchenItem, "name">; status: ItemStatus; canUse: boolean }[], ctx: { show: PantryShow; query?: string }): UseSoonCard | null {
  if (ctx.show.kind !== "all" || (ctx.query ?? "").trim() !== "") return null;
  const soon = rows.filter((r) => r.status.soon && r.canUse);
  if (soon.length === 0) return null;
  const names = soon.slice(0, 3).map((r, i) => (i === 0 ? r.item.name : r.item.name.toLowerCase()));
  const more = soon.length - names.length;
  const list = more > 0 ? `${names.join(", ")} and ${more} more` : names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]!;
  return { title: `${countWords(soon.length, "thing")} to use soon`, sub: `${list} · Cook with them`, href: "/cook" };
}

// ── The address ───────────────────────────────────────────────────

/** `?open=me:itm_…`: the row to open, or null. */
export function parseOpenParam(raw: string | null | undefined): ItemRef | null {
  return parseItemRef(raw);
}

/**
 * Where `/use` goes in the new frame (design §4): the Pantry with its search
 * ready, or — `?item=` given — with that row open. A row opened from a link
 * is what to act on, so the search isn't focused over it (the keyboard would
 * cover the row on a phone).
 */
export function pantryHrefFromUse(itemParam: string | null | undefined): string {
  const ref = parseItemRef(itemParam);
  return ref ? `/pantry?open=${itemRefParam(ref)}` : "/pantry?focus=1";
}

/** Home's "What did you use?": the Pantry with its search ready in the new frame, Use in today's. */
export function quickUseFieldHref(isNewFrame: boolean): string {
  return isNewFrame ? "/pantry?focus=1" : "/use";
}

/**
 * + Groceries (design §1.1, RV-24): the shopping run from the list
 * (RvShoppingRun), even with nothing ticked — its Scan the receipt and
 * + Add something else are the way in. The plain run (`/pantry/run`, what
 * was finished or running low) stays for its own links.
 */
export function boughtHref(): string {
  return LIST_RUN_HREF;
}

/** The quiet + Groceries under a pantry that shows nothing: add one item there. */
export function addItemHref(show: PantryShow): string {
  return show.kind === "pantry" ? `/pantry/new?pantry=${encodeURIComponent(show.key)}` : "/pantry/new";
}
