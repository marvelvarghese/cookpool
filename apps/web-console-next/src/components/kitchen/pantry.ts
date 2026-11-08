/**
 * Pantries in the Cookpool app (CP-12) as pure view-models over the CP-10
 * reads: which pantry an item lives in and the URL of its page, the pantry
 * picker (All pantries, Personal, then groups — recent first), the summary
 * and filters on /pantry, the per-pantry sections, what each item row says
 * (how much is left, who paid, the use-by chip, price per unit, the bar, what
 * is left of the price) and Home's use-soon strip. Dependency-free (contract
 * types and the engine only), so it is unit-testable.
 *
 * Quantities are the engine's: `formatQuantity` prints every amount and
 * `pricePerUnit` works out a price per unit. Money is integer minor units,
 * printed by the engine's `formatMinor`, and never added across currencies.
 */

import {
  USE_SOON_DAYS,
  type GroupPantry,
  type KitchenItem,
  type Pantry,
  type PantryRef,
  type PantryTotals,
} from "@saas/contracts/kitchen";
import { UNITS, formatQuantity, isUnit, pricePerUnit, type Dimension, type UnitKey } from "@saas/kitchen-engine/units";
import { formatMinor } from "./money";
import { foldForSearch, groupInitials, sortGroups } from "./groups";
import { memberLabel, memberLabelInline, type MemberNames } from "./members";
import { dayMonthText } from "./when";
import { isPendingId } from "@/lib/optimistic";

// ── Which pantry ──────────────────────────────────────────────────

/** The picker's "All pantries" and the personal pantry's key (`?pantry=` on /pantry and /pantry/new). */
export const ALL_PANTRIES = "all";
export const PERSONAL_PANTRY = "personal";

/** What the app calls the caller's own pantry (the API names it "My pantry"). */
export const PERSONAL_LABEL = "Personal";

/** A pantry's key: "personal", or its group's `org_…` id. */
export function pantryKey(pantry: PantryRef | Pantry): string {
  return pantry.kind === "personal" ? PERSONAL_PANTRY : pantry.orgId;
}

/** "Personal", or the group's name. */
export function pantryLabel(pantry: PantryRef | Pantry): string {
  return pantry.kind === "personal" ? PERSONAL_LABEL : pantry.name;
}

/** What the pantry's badge says: "Me" for your own, the group's initials otherwise. */
export function pantryBadge(pantry: PantryRef | Pantry): string {
  return pantry.kind === "personal" ? "Me" : groupInitials(pantry.name);
}

/** A `?pantry=` value as a pantry key: "all", "personal" or an `org_…` id; anything else is "all". */
export function parsePantryParam(raw: string | null | undefined): string {
  if (raw === PERSONAL_PANTRY) return PERSONAL_PANTRY;
  if (raw && /^org_[A-Za-z0-9]{1,64}$/.test(raw)) return raw;
  return ALL_PANTRIES;
}

// ── An item's page: /pantry/me:itm_… or /pantry/org:org_…:itm_… ──

export type ItemRef = { kind: "personal"; itemId: string } | { kind: "group"; orgId: string; itemId: string };

const ITEM_ID_RE = /^itm_[A-Za-z0-9]{1,64}$/;
const ORG_ID_RE = /^org_[A-Za-z0-9]{1,64}$/;

export function itemRefOf(item: Pick<KitchenItem, "id" | "pantry">): ItemRef {
  return item.pantry.kind === "personal"
    ? { kind: "personal", itemId: item.id }
    : { kind: "group", orgId: item.pantry.orgId, itemId: item.id };
}

/** The item page's path segment: `me:itm_…` for your own, `org:org_…:itm_…` for a group's. */
export function itemRefParam(ref: ItemRef): string {
  return ref.kind === "personal" ? `me:${ref.itemId}` : `org:${ref.orgId}:${ref.itemId}`;
}

export function itemHref(item: Pick<KitchenItem, "id" | "pantry"> | ItemRef): string {
  const ref = "pantry" in item ? itemRefOf(item) : item;
  return `/pantry/${itemRefParam(ref)}`;
}

/** Quick use with the item already chosen (CP-13): `/use?item=me:itm_…`. */
export function quickUseHref(item: Pick<KitchenItem, "id" | "pantry"> | ItemRef): string {
  const ref = "pantry" in item ? itemRefOf(item) : item;
  return `/use?item=${itemRefParam(ref)}`;
}

/**
 * The item a `/pantry/[itemRef]` segment names, or null when it names none.
 * Tolerates a percent-encoded segment (`org%3Aorg_…`), as a router may pass it.
 */
export function parseItemRef(raw: string | null | undefined): ItemRef | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parts = value.split(":");
  if (parts.length === 2 && parts[0] === "me" && ITEM_ID_RE.test(parts[1]!)) {
    return { kind: "personal", itemId: parts[1]! };
  }
  if (parts.length === 3 && parts[0] === "org" && ORG_ID_RE.test(parts[1]!) && ITEM_ID_RE.test(parts[2]!)) {
    return { kind: "group", orgId: parts[1]!, itemId: parts[2]! };
  }
  return null;
}

// ── Counting in words ─────────────────────────────────────────────

/** "1 item", "3 items". */
export function countWords(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "you", "you and Dev", "you, Anu and Dev", "you, Anu and 2 others". */
export function joinNames(names: readonly string[], max = 3): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const rest = names.length - (max - 1);
  return `${names.slice(0, max - 1).join(", ")} and ${rest} others`;
}

/** The first letter in capitals: "you and Dev" → "You and Dev". */
export function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

// ── Stock in words ────────────────────────────────────────────────

/** Use soon and expired, as the server counts them (risks CP-P: UTC days). */
export type ItemFilter = "all" | "soon" | "expired";

export function isUseSoon(daysToUseBy: number | null): boolean {
  return daysToUseBy !== null && daysToUseBy >= 0 && daysToUseBy <= USE_SOON_DAYS;
}

export function isExpired(daysToUseBy: number | null): boolean {
  return daysToUseBy !== null && daysToUseBy < 0;
}

export function matchesFilter(item: Pick<KitchenItem, "daysToUseBy">, filter: ItemFilter): boolean {
  if (filter === "soon") return isUseSoon(item.daysToUseBy);
  if (filter === "expired") return isExpired(item.daysToUseBy);
  return true;
}

/** Items whose name has every word of `query` ("dal toor" finds "Toor dal"). */
export function matchesQuery(item: Pick<KitchenItem, "name">, query: string): boolean {
  const words = foldForSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const name = foldForSearch(item.name);
  return words.every((w) => name.includes(w));
}

/** "N items · N use soon · N expired" — the parts that are not zero after the first. */
export function stockMeta(totals: Pick<PantryTotals, "itemCount" | "useSoonCount" | "expiredCount">): string {
  const parts = [countWords(totals.itemCount, "item")];
  if (totals.useSoonCount > 0) parts.push(`${totals.useSoonCount} use soon`);
  if (totals.expiredCount > 0) parts.push(`${totals.expiredCount} expired`);
  return parts.join(" · ");
}

/** A group's waste rule, short: "waste split equally", "buyer absorbs waste". */
export function wasteRuleShort(pantry: Pantry): string | null {
  if (pantry.kind !== "group") return null;
  return pantry.wastePolicy === "buyer_absorbs" ? "buyer absorbs waste" : "waste split equally";
}

/** "₹1,240.00", or "₹1,240.00 and $12.00" across currencies (never added up). */
export function worthText(amounts: readonly { currency: string; worthMinor: number }[]): string {
  const byCurrency: { currency: string; minor: number }[] = [];
  for (const a of amounts) {
    const t = byCurrency.find((x) => x.currency === a.currency);
    if (t) t.minor += a.worthMinor;
    else byCurrency.push({ currency: a.currency, minor: a.worthMinor });
  }
  const shown = byCurrency.filter((x) => x.minor !== 0);
  const list = shown.length > 0 ? shown : byCurrency.slice(0, 1);
  if (list.length === 0) return formatMinor(0);
  return joinNames(list.map((x) => formatMinor(x.minor, x.currency)), list.length);
}

// ── The pantry picker ─────────────────────────────────────────────

export interface PantryOption {
  /** "all", "personal" or an `org_…` id. */
  key: string;
  kind: "all" | "personal" | "group";
  label: string;
  badge: string;
  /** "23 items · 5 use soon"; for All: "8 pantries · 23 items · 5 use soon". */
  meta: string;
  pantry: Pantry | null;
}

export interface PantryPickerList {
  options: PantryOption[];
  /** Groups left out because the list shows only the recent ones until you search. */
  moreGroups: number;
  /** "Recent · search to see all 8", "Matches", or null when every group shows. */
  heading: string | null;
}

/** Every pantry's totals added up (for "All pantries"). */
export function totalsOf(pantries: readonly Pantry[]): Pick<PantryTotals, "itemCount" | "useSoonCount" | "expiredCount"> {
  return pantries.reduce(
    (t, p) => ({
      itemCount: t.itemCount + p.itemCount,
      useSoonCount: t.useSoonCount + p.useSoonCount,
      expiredCount: t.expiredCount + p.expiredCount,
    }),
    { itemCount: 0, useSoonCount: 0, expiredCount: 0 },
  );
}

/** Groups as the shared recent-first sort takes them. */
function asGroupLike(p: GroupPantry) {
  return { id: p.orgId, name: p.name, slug: p.slug, createdAt: "" };
}

/** Personal first, then groups: the ones opened last first, then by name. */
export function orderPantries(pantries: readonly Pantry[], recentSlugs: readonly string[] = []): Pantry[] {
  const personal = pantries.filter((p) => p.kind === "personal");
  const groups = pantries.filter((p): p is GroupPantry => p.kind === "group");
  const byOrg = new Map(groups.map((g) => [g.orgId, g] as const));
  const sorted = sortGroups(groups.map(asGroupLike), "recent", recentSlugs).map((g) => byOrg.get(g.id)!);
  return [...personal, ...sorted];
}

export interface PantryMetaOptions {
  /** Describe each pantry by its stock ("stock") or by who it is for ("who", the add form). */
  meta?: "stock" | "who";
  /** People per group (`myBalances().groups[].memberCount`), for the "who" meta. */
  memberCounts?: ReadonlyMap<string, number>;
}

/** "23 items · 5 use soon"; or, for the add form, "Only you" / "4 people · waste split equally". */
export function pantryMeta(p: Pantry, opts: PantryMetaOptions = {}): string {
  if (opts.meta !== "who") return stockMeta(p);
  if (p.kind === "personal") return "Only you";
  const count = opts.memberCounts?.get(p.orgId);
  return [count !== undefined ? countWords(count, "person", "people") : null, wasteRuleShort(p)].filter(Boolean).join(" · ");
}

export function pantryOption(p: Pantry, opts: PantryMetaOptions = {}): PantryOption {
  return { key: pantryKey(p), kind: p.kind, label: pantryLabel(p), badge: pantryBadge(p), meta: pantryMeta(p, opts), pantry: p };
}

function allPantriesOption(pantries: readonly Pantry[]): PantryOption {
  return {
    key: ALL_PANTRIES,
    kind: "all",
    label: "All pantries",
    badge: "All",
    meta: `${countWords(pantries.length, "pantry", "pantries")} · ${stockMeta(totalsOf(pantries))}`,
    pantry: null,
  };
}

/**
 * The picker's rows: All pantries (when `includeAll`), Personal, then the
 * groups recent first — at most `recentLimit` of them until a search, which
 * matches every word in the name ("Search to see all N").
 */
export function pantryPickerList(
  pantries: readonly Pantry[],
  opts: PantryMetaOptions & {
    query?: string;
    recentSlugs?: readonly string[];
    includeAll?: boolean;
    recentLimit?: number;
  } = {},
): PantryPickerList {
  const query = opts.query?.trim() ?? "";
  const limit = opts.recentLimit ?? 5;
  const ordered = orderPantries(pantries, opts.recentSlugs);
  const groups = ordered.filter((p) => p.kind === "group");
  const option = (p: Pantry) => pantryOption(p, opts);
  const all = opts.includeAll ? allPantriesOption(pantries) : null;
  const options: PantryOption[] = [];

  if (query) {
    const words = foldForSearch(query).split(" ").filter(Boolean);
    const hit = (label: string) => {
      const name = foldForSearch(label);
      return words.every((w) => name.includes(w));
    };
    if (all && hit(all.label)) options.push(all);
    for (const p of ordered) if (hit(pantryLabel(p))) options.push(option(p));
    return { options, moreGroups: 0, heading: "Matches" };
  }

  if (all) options.push(all);
  for (const p of ordered) if (p.kind === "personal") options.push(option(p));
  const shownGroups = groups.slice(0, limit);
  for (const p of shownGroups) options.push(option(p));
  const moreGroups = groups.length - shownGroups.length;
  return {
    options,
    moreGroups,
    heading: moreGroups > 0 ? `Recent · search to see all ${groups.length}` : null,
  };
}

/** The picker's current choice, even when the list (recent only) leaves it out; All when the key is unknown. */
export function pantryChoice(pantries: readonly Pantry[], key: string, opts: PantryMetaOptions = {}): PantryOption {
  const p = key === ALL_PANTRIES ? undefined : pantries.find((x) => pantryKey(x) === key);
  return p ? pantryOption(p, opts) : allPantriesOption(pantries);
}

// ── One item row ──────────────────────────────────────────────────

export type ExpiryTone = "soon" | "expired" | "later";

export interface ExpiryChip {
  /** "Expired", "Today", "Tomorrow", "3 days", "12 Dec". */
  label: string;
  tone: ExpiryTone;
}

/** "4 Nov" for an ISO date (a calendar day: no time-zone shift) — the app's `dayMonthText` (CP-23). */
export function dayMonth(isoDate: string): string {
  return dayMonthText(isoDate);
}

/**
 * The use-by chip: red "Expired"; amber "Today", "Tomorrow", "N days" up to
 * USE_SOON_DAYS; grey "N days" for later, or the date beyond a month. Null
 * without a use-by date.
 */
export function expiryChip(item: Pick<KitchenItem, "daysToUseBy" | "expiresOn">): ExpiryChip | null {
  const d = item.daysToUseBy;
  if (d === null || !item.expiresOn) return null;
  if (d < 0) return { label: "Expired", tone: "expired" };
  if (d === 0) return { label: "Today", tone: "soon" };
  if (d === 1) return { label: "Tomorrow", tone: "soon" };
  if (d <= USE_SOON_DAYS) return { label: `${d} days`, tone: "soon" };
  if (d <= 30) return { label: `${d} days`, tone: "later" };
  return { label: dayMonth(item.expiresOn), tone: "later" };
}

/** The item page's longer chip: "Use by 4 Nov · 3 days", "Expired 2 Nov". */
export function expiryText(item: Pick<KitchenItem, "daysToUseBy" | "expiresOn">): string | null {
  const chip = expiryChip(item);
  if (!chip || !item.expiresOn) return null;
  const date = dayMonth(item.expiresOn);
  if (chip.tone === "expired") return `Expired ${date}`;
  return chip.label === date ? `Use by ${date}` : `Use by ${date} · ${chip.label}`;
}

function quantityText(milli: number, dimension: Dimension, unit: string): string {
  return formatQuantity(milli, dimension, unit);
}

/** What is left, by the engine: "600 g", "1.6 kg", "7 pcs". */
export function leftText(item: Pick<KitchenItem, "qtyLeftMilli" | "dimension" | "displayUnit">): string {
  return quantityText(item.qtyLeftMilli, item.dimension, item.displayUnit);
}

/** What was bought: "1 kg", "12 pcs". */
export function boughtText(item: Pick<KitchenItem, "qtyBoughtMilli" | "dimension" | "displayUnit">): string {
  return quantityText(item.qtyBoughtMilli, item.dimension, item.displayUnit);
}

/**
 * "600 g of 1 kg", "1.6 kg of 2 kg"; for things you count, "7 of 12 pcs" and
 * "3 of 6 packs" when both read in the same unit.
 */
export function leftOfBought(item: Pick<KitchenItem, "qtyLeftMilli" | "qtyBoughtMilli" | "dimension" | "displayUnit">): string {
  const left = leftText(item);
  const bought = boughtText(item);
  if (item.dimension !== "count" && item.dimension !== "pack") return `${left} of ${bought}`;
  const [leftNumber, ...leftUnit] = left.split(" ");
  const boughtUnit = bought.split(" ").slice(1).join(" ");
  const same = leftUnit.join(" ") === boughtUnit || (leftNumber === "1" && boughtUnit.startsWith(leftUnit.join(" ")));
  return same ? `${leftNumber} of ${bought}` : `${left} of ${bought}`;
}

/**
 * The unit a price reads in: what it was bought in, except that grams are
 * priced per kg and millilitres (and spoons and cups) per L — "₹560.00/kg",
 * not "₹0.56/g", which would round away most of the price.
 */
export function priceUnitOf(displayUnit: string): UnitKey | null {
  if (!isUnit(displayUnit)) return null;
  if (displayUnit === "g") return "kg";
  if (UNITS[displayUnit].dimension === "volume" && displayUnit !== "L") return "L";
  return displayUnit;
}

/** The price per unit, by the engine: "₹40.00/kg", "₹560.00/kg" for 500 g, "₹7.00/pc". */
export function unitPriceText(item: Pick<KitchenItem, "priceMinor" | "qtyBoughtMilli" | "unitPriceMinor" | "currency" | "displayUnit">): string {
  const unit = priceUnitOf(item.displayUnit);
  if (!unit) return `${formatMinor(item.unitPriceMinor, item.currency)}/${item.displayUnit}`;
  return `${formatMinor(pricePerUnit(item.priceMinor, item.qtyBoughtMilli, unit), item.currency)}/${UNITS[unit].singular}`;
}

/** How much is left, 0–100 (a sliver stays visible while anything is left). */
export function leftPercent(item: Pick<KitchenItem, "qtyLeftMilli" | "qtyBoughtMilli">): number {
  if (item.qtyBoughtMilli <= 0 || item.qtyLeftMilli <= 0) return 0;
  const pct = Math.round((item.qtyLeftMilli * 100) / item.qtyBoughtMilli);
  return Math.min(100, Math.max(2, pct));
}

export type BarTone = "ok" | "soon" | "expired";

export function barTone(item: Pick<KitchenItem, "daysToUseBy">): BarTone {
  if (isExpired(item.daysToUseBy)) return "expired";
  if (isUseSoon(item.daysToUseBy)) return "soon";
  return "ok";
}

/** The add form's categories (CP-12), by id. */
export const ITEM_CATEGORY_LABELS: Record<string, string> = {
  veg: "Veg",
  fruit: "Fruit",
  dairy: "Dairy",
  grains: "Grains",
  protein: "Protein",
  spices: "Spices",
  other: "Other",
};

/** A category's label: the add form's ids read as their chip ("veg" → "Veg"); anything else as typed. */
export function categoryLabel(category: string): string {
  const known = ITEM_CATEGORY_LABELS[category.toLowerCase()];
  return known ?? capitalize(category);
}

export interface ItemRowView {
  id: string;
  href: string;
  /** Use some of it: quick use with this item chosen (`/use?item=…`, CP-13). */
  useHref: string;
  name: string;
  /** Past its use-by date: the name is struck through. */
  struck: boolean;
  /** "600 g of 1 kg" */
  leftOfBought: string;
  /** "600 g" */
  left: string;
  /** "Anu", "You" */
  paidBy: string;
  /** "600 g of 1 kg · Anu paid" (a group's), "450 g of 500 g · Dairy" (your own). */
  sub: string;
  pantryKey: string;
  pantryLabel: string;
  chip: ExpiryChip | null;
  unitPrice: string;
  percent: number;
  bar: BarTone;
  /** What is left of the price. */
  worth: string;
  /** Show Use: the caller may use it (not a viewer) and some is left. */
  canUse: boolean;
  /** Just added, the server's answer still on its way (SM-5): listed, but nothing opens it yet. */
  pending: boolean;
  /** Its note under the name (RC-3): in the new frame only (`notes`), null without one. */
  note: string | null;
}

export function itemRowView(
  item: KitchenItem & { canUse?: boolean },
  ctx: { meId: string | null; names?: MemberNames | null; notes?: boolean },
): ItemRowView {
  const href = itemHref(item);
  const lob = leftOfBought(item);
  const paidBy = memberLabel(item.paidBy, ctx.meId, ctx.names);
  const sub =
    item.pantry.kind === "personal"
      ? [lob, item.category ? categoryLabel(item.category) : null].filter(Boolean).join(" · ")
      : `${lob} · ${memberLabelInline(item.paidBy, ctx.meId, ctx.names)} paid`;
  return {
    id: item.id,
    href,
    useHref: quickUseHref(item),
    name: item.name,
    struck: isExpired(item.daysToUseBy),
    leftOfBought: lob,
    left: leftText(item),
    paidBy,
    sub,
    pantryKey: pantryKey(item.pantry),
    pantryLabel: pantryLabel(item.pantry),
    chip: expiryChip(item),
    unitPrice: unitPriceText(item),
    percent: leftPercent(item),
    bar: barTone(item),
    worth: formatMinor(item.worthMinor, item.currency),
    canUse: !isPendingId(item.id) && (item.canUse ?? true) && item.state === "active" && item.qtyLeftMilli > 0,
    pending: isPendingId(item.id),
    note: ctx.notes ? (item.note ?? null) : null,
  };
}

// ── /pantry: summary, filters and sections ────────────────────────

export interface PantrySummary {
  /** "23 items · worth ₹1,240.00" */
  headline: string;
  subline: string;
  itemCount: number;
  useSoonCount: number;
  expiredCount: number;
}

/** The pantries a choice covers: every one for All, else the one chosen (none when it is unknown). */
export function pantriesInScope(pantries: readonly Pantry[], selected: string): Pantry[] {
  return selected === ALL_PANTRIES ? [...pantries] : pantries.filter((p) => pantryKey(p) === selected);
}

/**
 * "N items · worth ₹X" over the chosen pantries — worth is what is left of
 * what was paid, per currency — and a line saying whose they are.
 */
export function pantrySummary(
  pantries: readonly Pantry[],
  selected: string,
  memberCounts?: ReadonlyMap<string, number>,
): PantrySummary {
  const scope = pantriesInScope(pantries, selected);
  const t = totalsOf(scope);
  const headline = `${countWords(t.itemCount, "item")} · worth ${worthText(scope)}`;
  let subline: string;
  const only = selected === ALL_PANTRIES ? null : (scope[0] ?? null);
  if (!only) {
    subline = "Your own items plus every group pantry you're in. Worth is what's left of what was paid.";
  } else if (only.kind === "personal") {
    subline = "Only you can see these. Cook with them for any group.";
  } else {
    const count = memberCounts?.get(only.orgId);
    subline = [
      `Everyone in ${only.name} sees these`,
      count !== undefined ? countWords(count, "person", "people") : null,
      wasteRuleShort(only),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return { headline, subline, itemCount: t.itemCount, useSoonCount: t.useSoonCount, expiredCount: t.expiredCount };
}

export interface FilterChip {
  id: ItemFilter;
  label: string;
}

/** "All", "Soon · N", and "Expired · N" only when something has expired (SM-10, the canvas's chips). */
export function filterChips(summary: Pick<PantrySummary, "useSoonCount" | "expiredCount">): FilterChip[] {
  const chips: FilterChip[] = [
    { id: "all", label: "All" },
    { id: "soon", label: `Soon · ${summary.useSoonCount}` },
  ];
  if (summary.expiredCount > 0) chips.push({ id: "expired", label: `Expired · ${summary.expiredCount}` });
  return chips;
}

export function parseFilterParam(raw: string | null | undefined): ItemFilter {
  return raw === "soon" || raw === "expired" ? raw : "all";
}

export interface PantrySection<T extends KitchenItem> {
  key: string;
  pantry: Pantry;
  label: string;
  badge: string;
  /** "6 items · ₹718.05 · 2 use soon · 4 people · waste split equally" */
  meta: string;
  /** The items shown: in the pantry, matching the filter and search, soonest use-by first. */
  items: T[];
  /** Folded at first: past the first three sections, unless it has something to use soon. */
  startsOpen: boolean;
}

export interface PantrySections<T extends KitchenItem> {
  sections: PantrySection<T>[];
  /** Pantries with nothing in them, by label (All pantries, all items, no search only). */
  emptyHidden: string[];
}

/** How many sections start unfolded on All pantries. */
export const OPEN_SECTIONS = 3;

/**
 * The /pantry list: one section per pantry in scope (Personal, then groups
 * recent first), each with the loaded items that belong to it and match the
 * filter and search, in the order the server sent them (soonest use-by
 * first). On All pantries with no filter, empty pantries fold into one line
 * ("Empty pantries hidden: …"), and a filter or search drops sections it
 * leaves empty. One chosen pantry is always shown, even empty.
 */
export function pantrySections<T extends KitchenItem>(
  pantries: readonly Pantry[],
  items: readonly T[],
  opts: {
    selected: string;
    filter?: ItemFilter;
    query?: string;
    recentSlugs?: readonly string[];
    memberCounts?: ReadonlyMap<string, number>;
  },
): PantrySections<T> {
  const filter = opts.filter ?? "all";
  const query = opts.query ?? "";
  const narrowed = filter !== "all" || query.trim() !== "";
  const scope = orderPantries(pantriesInScope(pantries, opts.selected), opts.recentSlugs);
  const byPantry = new Map<string, T[]>();
  for (const item of items) {
    const key = pantryKey(item.pantry);
    const list = byPantry.get(key);
    if (list) list.push(item);
    else byPantry.set(key, [item]);
  }

  const sections: PantrySection<T>[] = [];
  const emptyHidden: string[] = [];
  const single = opts.selected !== ALL_PANTRIES;
  for (const pantry of scope) {
    const key = pantryKey(pantry);
    const all = byPantry.get(key) ?? [];
    const shown = all.filter((i) => matchesFilter(i, filter) && matchesQuery(i, query));
    if (!single) {
      if (!narrowed && all.length === 0 && pantry.itemCount === 0) {
        emptyHidden.push(pantryLabel(pantry));
        continue;
      }
      if (narrowed && shown.length === 0) continue;
      if (!narrowed && all.length === 0) continue;
    }
    const count = pantry.kind === "group" ? opts.memberCounts?.get(pantry.orgId) : undefined;
    const meta = [
      countWords(pantry.itemCount, "item"),
      formatMinor(pantry.worthMinor, pantry.currency),
      pantry.useSoonCount > 0 ? `${pantry.useSoonCount} use soon` : null,
      pantry.expiredCount > 0 ? `${pantry.expiredCount} expired` : null,
      pantry.kind === "personal" ? "only you" : count !== undefined ? countWords(count, "person", "people") : null,
      wasteRuleShort(pantry),
    ]
      .filter(Boolean)
      .join(" · ");
    sections.push({
      key,
      pantry,
      label: pantryLabel(pantry),
      badge: pantryBadge(pantry),
      meta,
      items: shown,
      startsOpen: false,
    });
  }
  sections.forEach((s, i) => {
    s.startsOpen = single || narrowed || i < OPEN_SECTIONS || s.pantry.useSoonCount + s.pantry.expiredCount > 0;
  });
  return { sections, emptyHidden };
}

/** The desktop table's rows: every loaded item in scope matching the filter and search, soonest first. */
export function pantryRows<T extends KitchenItem>(
  items: readonly T[],
  opts: { selected: string; filter?: ItemFilter; query?: string },
): T[] {
  return items.filter(
    (i) =>
      (opts.selected === ALL_PANTRIES || pantryKey(i.pantry) === opts.selected) &&
      matchesFilter(i, opts.filter ?? "all") &&
      matchesQuery(i, opts.query ?? ""),
  );
}

// ── The phone list (SM-10) ────────────────────────────────────────

/** A pantry's chip on /pantry: "Me" for your own (its badge), else the group's name. */
export function pantryChipLabel(pantry: PantryRef | Pantry): string {
  return pantry.kind === "personal" ? "Me" : pantry.name;
}

/** The pantry chips, in the picker's order: yours, then groups opened last first. */
export function pantryChips(pantries: readonly Pantry[], recentSlugs: readonly string[] = []): { key: string; label: string }[] {
  return orderPantries(pantries, recentSlugs).map((p) => ({ key: pantryKey(p), label: pantryChipLabel(p) }));
}

/** What a row's Use does: log your usual amount at once, or open Use with the item chosen. */
export type RowUse =
  | {
      kind: "log";
      qtyMilli: number;
      /** "1 glass" — the button says it. */
      words: string;
      /** "Log 1 glass of Milk for you" — the button's name. */
      label: string;
    }
  | { kind: "open"; href: string; label: string };

/**
 * One item on the phone's list (SM-10): its name, what is left, one chip
 * when it is due soon or past its date, the pantry's chip on All pantries —
 * and Use. Price, worth, who paid and the bar are the item page's.
 */
export interface PantryListRow {
  id: string;
  href: string;
  name: string;
  struck: boolean;
  /** "400 g" (never wrapped). */
  left: string;
  /** Only soon or expired: a later date is not a warning. */
  chip: ExpiryChip | null;
  /** "Me", "Flat 4B" — on All pantries only. */
  pantry: string | null;
  /** Null when you may not use it (a viewer), or nothing is left. */
  use: RowUse | null;
  pending: boolean;
  /** The third line (RC-3): its note, in the new frame only (`notes`); null without one. */
  note: string | null;
}

/**
 * A row of the phone list. Use logs your usual amount of the item for just
 * you, in one tap (with Undo), when you have one that fits what is left;
 * otherwise it opens Use with the item chosen. Never for others: nobody is
 * charged from a row they cannot see. In the new frame (`notes`) its note is
 * a third line.
 */
export function pantryListRow(
  item: KitchenItem & { canUse?: boolean },
  ctx: { showPantry: boolean; usualQtyMilli?: number | null; usualWords?: string | null; notes?: boolean },
): PantryListRow {
  const chip = expiryChip(item);
  const pending = isPendingId(item.id);
  const canUse = !pending && (item.canUse ?? true) && item.state === "active" && item.qtyLeftMilli > 0;
  const usual = ctx.usualQtyMilli ?? null;
  let use: RowUse | null = null;
  if (canUse) {
    use =
      usual !== null && usual > 0 && usual <= item.qtyLeftMilli && ctx.usualWords
        ? { kind: "log", qtyMilli: usual, words: ctx.usualWords, label: `Log ${ctx.usualWords} of ${item.name} for you` }
        : { kind: "open", href: quickUseHref(item), label: `Use some ${item.name}` };
  }
  return {
    id: item.id,
    href: itemHref(item),
    name: item.name,
    struck: isExpired(item.daysToUseBy),
    left: leftText(item),
    chip: chip && chip.tone !== "later" ? chip : null,
    pantry: ctx.showPantry ? pantryChipLabel(item.pantry) : null,
    use,
    pending,
    note: ctx.notes ? (item.note ?? null) : null,
  };
}

// ── Home: use soon ────────────────────────────────────────────────

/** How many items Home's strip shows. */
export const HOME_USE_SOON = 4;

/**
 * Home's "Use soon" strip: the soonest items still to use (today first),
 * then those already past their date — at most `limit`, each once, leaving
 * out `exclude` (what Home's inbox already lists, CP-23).
 */
export function soonStrip<T extends KitchenItem>(
  soon: readonly T[],
  expired: readonly T[],
  limit = HOME_USE_SOON,
  exclude: ReadonlySet<string> = new Set(),
): T[] {
  const seen = new Set<string>(exclude);
  const out: T[] = [];
  const ordered = [...soon]
    .filter((i) => isUseSoon(i.daysToUseBy))
    .sort((a, b) => (a.daysToUseBy ?? 0) - (b.daysToUseBy ?? 0));
  for (const item of [...ordered, ...expired.filter((i) => isExpired(i.daysToUseBy))]) {
    if (out.length >= limit) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
