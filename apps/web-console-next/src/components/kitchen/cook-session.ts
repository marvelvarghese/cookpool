/**
 * A cooking session (cookpool-recipes RC-6, design §4) as pure view-models:
 * the draft kept on the device — one session at a time, from a recipe or
 * blank — what each line shows (its pantry, last time, the tick, the amount
 * and its ± row with "≈ 225 g · ₹9"), the header and the bar, the Finish
 * sheet (unticked lines, who ate, post to, the save switch) and the writes
 * Finish makes: the existing cook write with `recipeId`, `recipeFactorMilli`
 * and each ingredient's `recipeLine`, the shares, and the recipe write.
 *
 * Dependency-free (contract types, the engine and the dish maker's own pure
 * helpers), so it is unit-testable; the localStorage adapter is
 * `lib/cook-session-store.ts`, the reads and writes `cook-session-data.ts`.
 *
 * Amounts are thousandths of a unit's base (grams, millilitres, pieces), as a
 * recipe line's are; what a line takes from each item is in that item's own
 * base unit. Money is the engine's, through the dish maker's `lineCost`.
 */

import {
  DEFAULT_KITCHEN_CURRENCY,
  MAX_DISH_INGREDIENTS,
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_MIN_FACTOR_MILLI,
  isRecipeUnit,
  lineQuantity,
  recipeUnitOf,
  scaleLine,
  scalePortions,
  type CookDishRequest,
  type CookIngredientRequest,
  type CookNewItemRequest,
  type KitchenDish,
  type KitchenItem,
  type KitchenRecipe,
  type MyGroupBalance,
  type Recipe,
  type RecipeLastCook,
  type RecipeLineInput,
  type RecipeMatchResponse,
  type SaveDishAsRecipeRequest,
  type SetDishSharesRequest,
  type UpdateRecipeRequest,
  type AskState,
  type AskToUseRequest,
  type KitchenAsk,
} from "@saas/contracts/kitchen";
import { dimensionOf, formatQuantity, isUnit, type Dimension } from "@saas/kitchen-engine/units";
import { formatMinor } from "./money";
import { AMOUNT_STEPS, milliToDecimal } from "./item-use";
import { parseItemRef, type ItemRef } from "./pantry";
import { memberLabelInline, type MemberNames } from "./members";
import { shortMoney } from "./from-before";
import {
  JUST_ME,
  NEW_ITEM_CATEGORY,
  cookRefusal,
  cookingGroups,
  costLine,
  currencyProblem,
  defaultShare,
  dishTotals,
  eaterShares,
  eaterView,
  lineCost,
  pantryLine,
  sharesRefusal,
  type DishLine,
  type DishTotals,
  type NewLine,
  type PantryLine,
} from "./dish-maker";
import { guideStepLog, parseGuide, type CookGuide } from "./cook-guide-draft";
import { isPendingId } from "@/lib/optimistic";
import { answererWords, firstName, lapsesIn } from "./ask-before-use";

/** The draft's shape on the device; a stored draft of another version is dropped. */
export const SESSION_VERSION = 1;

/** The session's page (design §4.2, §8). */
export const SESSION_PATH = "/cook/session";

/** Today's frame has no session: a visitor there goes Home (design §1.1). */
export const SESSION_PROD_REDIRECT = "/home";

/** Where minimize goes when nothing of the app's is behind the session. */
export const SESSION_PARENT = "/cook";

/** What Finish says offline (design §4.1: Finish needs signal, nothing is queued). */
export const FINISH_OFFLINE_TEXT = "You're offline. Finish needs signal — your session stays on this phone.";

// ── The draft ─────────────────────────────────────────────────────

/** An item a line takes from. */
export interface SessionTake {
  /** `itm_…` */
  itemId: string;
  /** The item page's ref: `me:itm_…` or `org:org_…:itm_…`. */
  ref: string;
  /** The group whose pantry it is in; null for your own. */
  orgId: string | null;
  /** The group's name; null for your own pantry. */
  pantryName: string | null;
  /** The item's dimension: what `matchMilli` counts. */
  dimension: Dimension;
  /** What the line takes from it at its matched amount (`SessionLine.baseMilli`), in the item's base unit. */
  matchMilli: number;
  /** The item as last read (its price, who paid, what is left); null until it is read. */
  item: KitchenItem | null;
  /** The item can't be read any more (used up and removed, moved, or no longer yours to use). */
  gone?: boolean;
}

/** A recipe line as written, for "Save today's amounts". */
export interface WrittenLine {
  foodKey: string | null;
  name: string;
  qtyMilli: number | null;
  unit: string | null;
  toTaste: boolean;
  isMain: boolean;
}

/** One line of the session: a recipe line, a dish cooked before's ingredient, or an item added. */
export interface SessionLine {
  /** `r:2` (recipe line 2), `p:0` (from before), `i:itm_…` (added), `b:1` (just bought). */
  key: string;
  /** The recipe line's position; null for a line the recipe doesn't have. */
  recipeLine: number | null;
  /** The food it is (`onion`), or null for a free-text line. */
  foodKey: string | null;
  /** Its words ("Onions"). */
  name: string;
  /** How much, in thousandths of the unit's base; null to taste. */
  qtyMilli: number | null;
  /** g, kg, ml, L, pcs, tsp, tbsp, cup, pack or a count word ("onion"); null to taste. */
  unit: string | null;
  /** The amount the takes were matched for: they follow the amount in proportion. */
  baseMilli: number | null;
  takes: SessionTake[];
  /** Bought during the session: it goes into your pantry, and the dish, in the same write. */
  bought: NewLine | null;
  /** "2 onions": what went in last time; null if never. */
  lastTime: string | null;
  ticked: boolean;
  /** Nothing in your pantries: kept, but left out. */
  missing: boolean;
  toTaste: boolean;
  /** The recipe's own line, as written; null for a line the recipe doesn't have. */
  written: WrittenLine | null;
  /**
   * Ask before use (cookpool-pantry PN-9, design §8.4): the ask this line
   * sent for an item the cook must ask for, as last read. While it waits or
   * once approved the line stays out of the dish (an approval is the cook's
   * own use). Absent on every other line, and on drafts written before.
   */
  ask?: SessionLineAsk;
}

/** A line's ask (PN-8's `KitchenAsk`, as the draft keeps it). */
export interface SessionLineAsk {
  /** `ask_…` (or a pending id while it is on its way). */
  id: string;
  orgId: string;
  itemId: string;
  /** "2 g". */
  amount: string;
  /** Who answers it (null once the buyer has left: an admin), with their name when the server gave it. */
  answerer: string | null;
  answererName: string | null;
  state: AskState;
  expiresAt: string;
  answeredBy: string | null;
}

export interface SessionStep {
  text: string;
  done: boolean;
}

export interface CookSession {
  v: typeof SESSION_VERSION;
  /** The recipe (`rcp_…`), or null for a blank session. */
  recipeId: string | null;
  /** Its factor in thousandths; null blank. */
  factorMilli: number | null;
  name: string;
  /** The recipe's serves × 2, for "For about 2"; null blank. */
  servesHalf: number | null;
  /** You own the recipe: you may save today's amounts to it. */
  mine: boolean;
  lines: SessionLine[];
  steps: SessionStep[];
  /** Where it posts: a group's `org_…`, JUST_ME, or null for the default. */
  postTo: string | null;
  /** When it started (ISO). */
  startedAt: string;
  /** The next number a line added by hand takes. */
  seq: number;
  /**
   * Guided mode (cookpool-guided GC-5): present when the session came from
   * a recipe with steps; absent for a blank session, a recipe without steps
   * and any draft written before it.
   */
  guide?: CookGuide;
}

/** A factor as the URL gives it (`?f=450`): a whole number of thousandths in range, else 1 (×1). */
export function factorParam(raw: string | null | undefined): number {
  if (!raw || !/^\d{1,6}$/.test(raw)) return 1000;
  const f = Number(raw);
  return f >= RECIPE_MIN_FACTOR_MILLI && f <= RECIPE_MAX_FACTOR_MILLI ? f : 1000;
}

/** A recipe's id as the URL gives it (`?recipe=rcp_…`), or null. */
export function recipeParam(raw: string | null | undefined): string | null {
  return raw && /^rcp_[A-Za-z0-9]{1,64}$/.test(raw) ? raw : null;
}

/** The session's address, blank or from a recipe at a factor (RC-5's Start cooking links here). */
export function sessionHref(recipe?: { recipeId: string; factorMilli?: number } | null): string {
  if (!recipe) return SESSION_PATH;
  const f = recipe.factorMilli ?? 1000;
  return `${SESSION_PATH}?recipe=${encodeURIComponent(recipe.recipeId)}&f=${f}`;
}

/** A blank session: the name is its first field. */
export function blankSession(now: Date): CookSession {
  return {
    v: SESSION_VERSION,
    recipeId: null,
    factorMilli: null,
    name: "",
    servesHalf: null,
    mine: false,
    lines: [],
    steps: [],
    postTo: null,
    startedAt: now.toISOString(),
    seq: 1,
  };
}

/** Nothing in it yet: a blank session with no name and no lines (the bar doesn't show it). */
export function isEmptySession(s: CookSession | null | undefined): boolean {
  return !s || (s.recipeId === null && s.name.trim() === "" && s.lines.length === 0);
}

function dimensionOfUnit(unit: string): Dimension {
  try {
    return dimensionOf(unit);
  } catch {
    return "count";
  }
}

/** "2 onions", "500 g": one ingredient of last time, in the words it was given. */
function lastCookText(l: RecipeLastCook["lines"][number]): string {
  if (l.label) return l.label;
  const dim = isUnit(l.unit) ? dimensionOfUnit(l.unit) : "count";
  return formatQuantity(l.qtyMilli, dim, isUnit(l.unit) ? l.unit : undefined);
}

/** What a recipe line took last time: one ingredient's words, or several summed when they share a unit. */
export function lastTimeText(lines: readonly RecipeLastCook["lines"][number][]): string | null {
  if (lines.length === 0) return null;
  if (lines.length === 1) return lastCookText(lines[0]!);
  const first = lines[0]!;
  const same = lines.every((l) => !l.label && l.unit === first.unit && isUnit(l.unit));
  if (same) return formatQuantity(lines.reduce((a, l) => a + l.qtyMilli, 0), dimensionOfUnit(first.unit), first.unit);
  return lines.map(lastCookText).join(" + ");
}

/**
 * A session from a recipe at the match's factor (design §4.2): one line per
 * recipe line, in order, its amount by `scaleLine`, taking the items the
 * match names (several when one isn't enough); last time from the caller's
 * last cook of it; a missing line is kept, but left out. To-taste lines tick
 * but have no amount; a line on Always have takes nothing.
 */
export function sessionFromRecipe(
  recipe: KitchenRecipe,
  lastCook: RecipeLastCook | null,
  match: RecipeMatchResponse,
  now: Date,
): CookSession {
  const f = match.factorMilli;
  const lines: SessionLine[] = recipe.lines.map((line) => {
    const m = match.lines.find((x) => x.position === line.position);
    const qtyMilli = line.toTaste ? null : scaleLine(line.qtyMilli, line.unit, f);
    const status = m?.status ?? (line.toTaste ? "always" : "missing");
    const takes: SessionTake[] =
      status === "missing"
        ? []
        : (m?.items ?? []).map((i) => ({
            itemId: i.itemId,
            ref: i.ref,
            orgId: i.orgId,
            pantryName: i.pantry.kind === "group" ? i.pantry.name : null,
            dimension: dimensionOfUnit(i.unit),
            matchMilli: i.takeMilli,
            item: null,
          }));
    const last = lastCook ? lastCook.lines.filter((l) => l.recipeLine === line.position) : [];
    return {
      key: `r:${line.position}`,
      recipeLine: line.position,
      foodKey: line.foodKey,
      name: line.name,
      qtyMilli,
      unit: line.toTaste ? null : line.unit,
      // The match's own need, when it says: its items were taken for exactly that.
      baseMilli: line.toTaste ? null : (m?.needMilli ?? qtyMilli),
      takes,
      bought: null,
      lastTime: lastTimeText(last),
      ticked: false,
      missing: status === "missing",
      toTaste: line.toTaste,
      written: { foodKey: line.foodKey, name: line.name, qtyMilli: line.qtyMilli, unit: line.unit, toTaste: line.toTaste, isMain: line.isMain },
    };
  });
  return {
    v: SESSION_VERSION,
    recipeId: recipe.id,
    factorMilli: f,
    name: recipe.name,
    servesHalf: recipe.servesHalf,
    mine: recipe.mine,
    lines,
    steps: recipe.steps.map((text) => ({ text, done: false })),
    postTo: null,
    startedAt: now.toISOString(),
    seq: 1,
  };
}

/**
 * Picking a dish cooked before (SM-3's "from before", cook again) in a blank
 * session: its name, and one line per ingredient at last time's amount, from
 * the item matched now (one with nothing to take it from is missing). The
 * lines a previous pick put in are replaced; lines added by hand stay. Who it
 * was for comes along, while you still cook in that group.
 */
export function fillFromBefore(
  s: CookSession,
  picked: Recipe,
  ctx: { groups: readonly MyGroupBalance[] },
): CookSession {
  const kept = s.lines.filter((l) => !l.key.startsWith("p:"));
  const filled: SessionLine[] = picked.ingredients.map((ing, index) => {
    const unit = AMOUNT_STEPS[ing.dimension].unit;
    const match = ing.match;
    const take: SessionTake | null =
      match && match.qtyLeftMilli > 0
        ? {
            itemId: match.itemId,
            ref: match.ref,
            orgId: match.pantry.kind === "group" ? match.pantry.orgId : null,
            pantryName: match.pantry.kind === "group" ? match.pantry.name : null,
            dimension: ing.dimension,
            matchMilli: Math.min(Math.max(ing.qtyMilli, 1), match.qtyLeftMilli),
            item: null,
          }
        : null;
    return {
      key: `p:${index}`,
      recipeLine: null,
      foodKey: null,
      name: ing.name,
      qtyMilli: Math.max(ing.qtyMilli, 1),
      unit,
      baseMilli: Math.max(ing.qtyMilli, 1),
      takes: take ? [take] : [],
      bought: null,
      lastTime: formatQuantity(ing.qtyMilli, ing.dimension, isUnit(ing.unit) ? ing.unit : unit),
      ticked: false,
      missing: take === null,
      toTaste: false,
      written: null,
    };
  });
  const cooking = cookingGroups(ctx.groups);
  const postTo = picked.orgId === null ? JUST_ME : cooking.some((g) => g.orgId === picked.orgId) ? picked.orgId : s.postTo;
  return { ...s, name: picked.name, lines: [...filled, ...kept], postTo };
}

// ── One session at a time ─────────────────────────────────────────

/**
 * What opening the session's page does (design §4.1: one session at a time):
 * `resume` the one on this device; `start` a new one (none is open, or it is
 * an empty blank one); or `ask` "Finish or discard Chicken curry?", when a
 * recipe is asked for and another session is open. Opening the page with no
 * recipe always resumes what is open.
 */
export function openChoice(current: CookSession | null, wanted: { recipeId: string } | null): "resume" | "start" | "ask" {
  if (!current) return "start";
  if (!wanted) return "resume";
  if (isEmptySession(current)) return "start";
  return current.recipeId === wanted.recipeId ? "resume" : "ask";
}

/** The sheet that asks, in words. */
export function discardPrompt(current: CookSession): { title: string; body: string; resume: string; discard: string } {
  const name = current.name.trim() || "this dish";
  return {
    title: `Finish or discard ${name}?`,
    body: "You can cook one thing at a time. Nothing is posted until you finish.",
    resume: "Resume",
    discard: "Discard and start",
  };
}

// ── Changing it ───────────────────────────────────────────────────

/**
 * Is this line counted in what was taken (and so can be ticked)? A missing
 * line can't be, nor one the cook must ask for (PN-9: it reads Ask Meera
 * instead of a tick, and stays out of the dish).
 */
export function tickable(line: SessionLine): boolean {
  return !line.missing && !lineAsks(line);
}

/** Tick a line in, or out again. A missing line stays unticked. */
export function tickLine(s: CookSession, key: string): CookSession {
  return {
    ...s,
    lines: s.lines.map((l) => (l.key === key && tickable(l) ? { ...l, ticked: !l.ticked } : l)),
  };
}

/** Tick a step done, or not. */
export function toggleStep(s: CookSession, index: number): CookSession {
  return { ...s, steps: s.steps.map((st, i) => (i === index ? { ...st, done: !st.done } : st)) };
}

/** Where it posts: a group's `org_…` or JUST_ME. */
export function setPostTo(s: CookSession, postTo: string): CookSession {
  return { ...s, postTo };
}

export function setName(s: CookSession, name: string): CookSession {
  return { ...s, name };
}

/**
 * One step of a line's amount, by its unit: 50 g or 50 ml (10 below 100,
 * where a dish takes a spoon of some things), half of one for pieces, spoons,
 * cups, packs and count words ("½ onion").
 */
export function amountStepMilli(unit: string, qtyMilli: number): number {
  switch (unit) {
    case "g":
    case "ml":
    case "kg":
    case "L":
      return qtyMilli < 100_000 ? 10_000 : 50_000;
    default:
      return recipeUnitOf(unit).factor * 500;
  }
}

/** The most one line goes up to (a bag of rice, not a typo's worth). */
const MAX_LINE_MILLI = 100_000_000;

/**
 * One step up or down, onto the step grid (130 g + 50 g → 150 g; 1½ onions
 * − ½ → 1); null when it can't go lower (one step is the least) or higher.
 */
export function stepAmount(qtyMilli: number, unit: string, delta: 1 | -1): number | null {
  if (delta > 0) {
    const step = amountStepMilli(unit, qtyMilli);
    const next = Math.floor(qtyMilli / step) * step + step;
    return next > MAX_LINE_MILLI ? null : next;
  }
  const step = amountStepMilli(unit, qtyMilli - 1);
  const next = Math.ceil(qtyMilli / step) * step - step;
  return next > 0 ? next : null;
}

/** A line at another amount; its takes follow in proportion (`lineTakes`). */
export function setLineAmount(s: CookSession, key: string, qtyMilli: number): CookSession {
  return {
    ...s,
    lines: s.lines.map((l) => {
      if (l.key !== key || l.qtyMilli === null) return l;
      if (l.bought) return { ...l, qtyMilli, bought: { ...l.bought, useMilli: Math.min(qtyMilli, l.bought.qtyMilli) } };
      return { ...l, qtyMilli };
    }),
  };
}

/** Step a line's amount (the ± in its row); the same session when it can't step. */
export function stepLine(s: CookSession, key: string, delta: 1 | -1): CookSession {
  const line = s.lines.find((l) => l.key === key);
  if (!line || line.qtyMilli === null || line.unit === null) return s;
  const next = stepAmount(line.qtyMilli, line.unit, delta);
  if (next === null) return s;
  const capped = line.bought ? Math.min(next, line.bought.qtyMilli) : next;
  return capped === line.qtyMilli ? s : setLineAmount(s, key, capped);
}

/** What a line takes from each of its items now: the matched amounts in proportion to the line's, each no more than is left (the rest falls to the next). */
export function lineTakes(line: SessionLine): { take: SessionTake; milli: number }[] {
  if (line.takes.length === 0) return [];
  const ratio = line.qtyMilli !== null && line.baseMilli !== null && line.baseMilli > 0 ? line.qtyMilli / line.baseMilli : 1;
  let carry = 0;
  return line.takes.map((take) => {
    const left = take.gone ? 0 : take.item ? Math.max(0, take.item.qtyLeftMilli) : Number.POSITIVE_INFINITY;
    const want = Math.max(0, Math.round(take.matchMilli * ratio)) + carry;
    const milli = Math.min(want, left);
    carry = want - milli;
    return { take, milli };
  });
}

/** The line wants more than its items have left. */
export function lineShort(line: SessionLine): boolean {
  if (line.takes.length === 0 || line.qtyMilli === null) return false;
  const ratio = line.baseMilli !== null && line.baseMilli > 0 ? line.qtyMilli / line.baseMilli : 1;
  const want = line.takes.reduce((a, t) => a + Math.round(t.matchMilli * ratio), 0);
  const got = lineTakes(line).reduce((a, t) => a + t.milli, 0);
  return got < want;
}

/**
 * Add an item to the session (Add an item: today's item picker): a line of
 * its own at its starting amount — one of its measure when it has one ("1
 * onion"), else a few steps of its unit. An item already added by hand is
 * not added twice.
 */
export function addItemLine(s: CookSession, item: KitchenItem): CookSession {
  const key = `i:${item.id}`;
  if (s.lines.some((l) => l.key === key)) return s;
  const start: PantryLine = pantryLine(item);
  const counted = start.counted ?? null;
  const unit = counted ? counted.measure.one : AMOUNT_STEPS[item.dimension].unit;
  const qtyMilli = counted ? Math.round(counted.quantity * 1000) : start.qtyMilli;
  const take: SessionTake = {
    itemId: item.id,
    ref: item.pantry.kind === "group" ? `org:${item.pantry.orgId}:${item.id}` : `me:${item.id}`,
    orgId: item.pantry.kind === "group" ? item.pantry.orgId : null,
    pantryName: item.pantry.kind === "group" ? item.pantry.name : null,
    dimension: item.dimension,
    matchMilli: start.qtyMilli,
    item,
  };
  const line: SessionLine = {
    key,
    recipeLine: null,
    foodKey: null,
    name: item.name,
    qtyMilli,
    unit,
    baseMilli: qtyMilli,
    takes: [take],
    bought: null,
    lastTime: null,
    ticked: false,
    missing: false,
    toTaste: false,
    written: null,
  };
  return { ...s, lines: [...s.lines, line] };
}

/** Add something just bought ("Bought it just now?" in the item picker): it goes in all of it, until the amount says less. */
export function addBoughtLine(s: CookSession, bought: NewLine): CookSession {
  const line: SessionLine = {
    key: `b:${s.seq}`,
    recipeLine: null,
    foodKey: null,
    name: bought.name,
    qtyMilli: bought.useMilli,
    unit: AMOUNT_STEPS[bought.dimension].unit,
    baseMilli: bought.useMilli,
    takes: [],
    bought,
    lastTime: null,
    ticked: false,
    missing: false,
    toTaste: false,
    written: null,
  };
  return { ...s, seq: s.seq + 1, lines: [...s.lines, line] };
}

/** The refs of the items the session takes from that `listed` (the usable-items list) doesn't hold: read each on its own. */
export function takeRefsToRead(s: CookSession, listed: ReadonlySet<string>): ItemRef[] {
  const seen = new Set<string>();
  const out: ItemRef[] = [];
  for (const line of s.lines) {
    for (const t of line.takes) {
      if (listed.has(t.itemId) || seen.has(t.itemId) || t.gone) continue;
      seen.add(t.itemId);
      const ref = parseItemRef(t.ref);
      if (ref) out.push(ref);
    }
  }
  return out;
}

function sameItem(a: KitchenItem, b: KitchenItem): boolean {
  return (
    a.version === b.version &&
    a.qtyLeftMilli === b.qtyLeftMilli &&
    a.worthMinor === b.worthMinor &&
    a.priceMinor === b.priceMinor &&
    a.state === b.state &&
    // Whether the cook must ask for it (PN-9) changes without a new version.
    (a.mustAsk ?? false) === (b.mustAsk ?? false)
  );
}

/**
 * The items as read now (someone may have used some meanwhile): each take's
 * item is the fresh read — by `itm_…`; null when it can't be read any more,
 * which leaves that take out. The same session when nothing changed.
 */
export function refreshTakes(s: CookSession, fresh: ReadonlyMap<string, KitchenItem | null>): CookSession {
  let changed = false;
  const lines = s.lines.map((line) => {
    let lineChanged = false;
    const takes = line.takes.map((t) => {
      if (!fresh.has(t.itemId)) return t;
      const f = fresh.get(t.itemId) ?? null;
      if (f === null) {
        if (t.gone) return t;
        lineChanged = true;
        return { ...t, item: null, gone: true };
      }
      const usable = f.state === "active";
      if (!usable) {
        if (t.gone) return t;
        lineChanged = true;
        return { ...t, item: f, gone: true };
      }
      if (t.item && sameItem(t.item, f) && !t.gone) return t;
      lineChanged = true;
      return { ...t, item: f, gone: false };
    });
    if (!lineChanged) return line;
    changed = true;
    return { ...line, takes };
  });
  return changed ? { ...s, lines } : s;
}

// ── What a line shows ─────────────────────────────────────────────

/** A count in halves where it is one ("1½", "½"), else to two decimals ("1.25"). */
export function halvesText(n: number): string {
  const twice = n * 2;
  if (Math.abs(twice - Math.round(twice)) < 1e-9) {
    const h = Math.round(twice);
    const whole = Math.floor(h / 2);
    const half = h % 2 === 1;
    if (whole === 0) return half ? "½" : "0";
    return `${whole}${half ? "½" : ""}`;
  }
  return String(Math.round(n * 100) / 100);
}

/** A count word for more than one: "onion" → "onions", "tomato" → "tomatoes", "pinch" → "pinches". */
export function pluralWord(word: string): string {
  if (/s$/i.test(word)) return word;
  if (/(x|z|ch|sh|o)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

function decimalText(n: number, places: number): string {
  const f = 10 ** places;
  return String(Math.round(n * f) / f);
}

/** A line's amount in its unit: "450 g", "0.45 kg", "1½ onions", "½ tsp", "2 pcs". */
export function amountText(qtyMilli: number, unit: string): string {
  const q = lineQuantity(qtyMilli, unit);
  switch (unit) {
    case "g":
    case "ml":
      return `${decimalText(q, 1)} ${unit}`;
    case "kg":
    case "L":
      return `${decimalText(q, 2)} ${unit}`;
    case "pcs":
      return `${halvesText(q)} ${q <= 1 ? "pc" : "pcs"}`;
    case "tsp":
    case "tbsp":
      return `${halvesText(q)} ${unit}`;
    case "cup":
      return `${halvesText(q)} ${q <= 1 ? "cup" : "cups"}`;
    default:
      return `${halvesText(q)} ${q <= 1 ? unit : pluralWord(unit)}`;
  }
}

/** What the line costs at its amount, by the engine; null while one of its items isn't read yet. 0 when it takes nothing. */
export function sessionLineCost(line: SessionLine): number | null {
  if (line.bought) return lineCost({ ...line.bought, useMilli: Math.min(line.qtyMilli ?? line.bought.useMilli, line.bought.qtyMilli) });
  let sum = 0;
  for (const { take, milli } of lineTakes(line)) {
    if (milli <= 0) continue;
    if (!take.item) return null;
    sum += lineCost({ kind: "pantry", key: take.itemId, item: take.item, qtyMilli: milli });
  }
  return sum;
}

/** The currency a line's money is in: its first read item's. */
function lineCurrency(line: SessionLine): string | null {
  for (const t of line.takes) if (t.item) return t.item.currency;
  return null;
}

/** Where a line comes from: "Your pantry", "Flat 4B · Meera paid", "Flat 4B + Your pantry", "Just bought", "Always have". */
export function linePantryText(line: SessionLine, meId: string | null, names?: MemberNames | null): string {
  if (line.bought) return "Just bought";
  if (line.takes.length === 0) return "Always have";
  const live = lineTakes(line).filter((t) => t.milli > 0);
  if (live.length === 0) return "None left now";
  const pantries = [...new Set(live.map((t) => t.take.pantryName ?? "Your kitchen"))];
  if (live.length === 1) {
    const t = live[0]!.take;
    if (t.pantryName && t.item) return `${t.pantryName} · ${memberLabelInline(t.item.paidBy, meId, names)} paid`;
  }
  return pantries.join(" + ");
}

export interface SessionLineView {
  key: string;
  name: string;
  /** "Flat 4B · Meera paid · last time 2 onions", or "Not in your kitchen · left out". */
  sub: string;
  /** "1½ onions", "To taste". */
  amount: string;
  /** The amount opens ± (not to taste, not missing). */
  canEdit: boolean;
  ticked: boolean;
  tickable: boolean;
  missing: boolean;
  toTaste: boolean;
  /** "Tick Onions" / "Untick Onions". */
  checkLabel: string;
  /** What it costs now; null while an item is read. */
  costMinor: number | null;
  /** Beside the ±: "≈ 225 g · ₹9", "₹126", "not counted". */
  costNote: string;
  lessLabel: string;
  moreLabel: string;
  canLess: boolean;
  canMore: boolean;
  short: boolean;
  /** Ask before use (PN-9): the line's ask, in place of the tick; null on a line the cook just ticks. */
  ask: SessionLineAskView | null;
}

export function sessionLineView(line: SessionLine, ctx: { meId: string | null; names?: MemberNames | null; now?: Date }): SessionLineView {
  // Short only while something is left to take: none left says so on its own.
  const short = lineTakes(line).some((t) => t.milli > 0) && lineShort(line);
  const amount = line.qtyMilli !== null && line.unit !== null ? amountText(line.qtyMilli, line.unit) : "To taste";
  const sub = line.missing
    ? "Not in your kitchen · left out"
    : [linePantryText(line, ctx.meId, ctx.names), short ? "short" : null, line.lastTime ? `last time ${line.lastTime}` : null]
        .filter((x): x is string => !!x)
        .join(" · ");
  const costMinor = line.missing ? 0 : sessionLineCost(line);
  const currency = line.bought ? null : lineCurrency(line);
  let costNote: string;
  if (line.takes.length === 0 && !line.bought) {
    costNote = "not counted";
  } else {
    const taken = lineTakes(line);
    const dims = new Set(line.takes.map((t) => t.dimension));
    const total = taken.reduce((a, t) => a + t.milli, 0);
    const lineDim = line.unit && isRecipeUnit(line.unit) ? recipeUnitOf(line.unit).dimension : null;
    const dim = dims.size === 1 ? [...dims][0]! : null;
    // The amount in the item's own unit, when the line counts in another ("2 onions" of a kilo of onions).
    const exact = line.bought || (dim !== null && lineDim === dim && line.unit !== "tsp" && line.unit !== "tbsp" && line.unit !== "cup");
    const amountPart = exact || dim === null ? null : `≈ ${formatQuantity(total, dim, AMOUNT_STEPS[dim].unit)}`;
    const money = costMinor === null ? null : shortMoney(costMinor, currency ?? DEFAULT_KITCHEN_CURRENCY);
    costNote = [amountPart, money, short ? "all there is" : null].filter((x): x is string => !!x).join(" · ") || "…";
  }
  const lower = line.name.toLowerCase();
  const ask = sessionLineAskView(line, { meId: ctx.meId, names: ctx.names ?? null, now: ctx.now ?? new Date() });
  // An ask on its way, or approved, holds the amount it asked for.
  const held = ask !== null && (ask.state === "waiting" || ask.state === "approved");
  const canEdit = !line.missing && !line.toTaste && line.qtyMilli !== null && line.unit !== null && !held;
  const less = canEdit ? stepAmount(line.qtyMilli!, line.unit!, -1) : null;
  const more = canEdit ? stepAmount(line.qtyMilli!, line.unit!, 1) : null;
  return {
    key: line.key,
    name: line.name,
    sub,
    amount,
    canEdit,
    ticked: line.ticked && ask === null,
    tickable: tickable(line),
    missing: line.missing,
    toTaste: line.toTaste,
    checkLabel: `${line.ticked ? "Untick" : "Tick"} ${line.name}`,
    costMinor,
    costNote,
    lessLabel: `Less ${lower}`,
    moreLabel: `More ${lower}`,
    canLess: less !== null,
    canMore: more !== null && (!line.bought || (line.qtyMilli ?? 0) < line.bought.qtyMilli),
    short,
    ask,
  };
}

// ── Ask before use (cookpool-pantry PN-9, design §8.4) ────────────

/**
 * What the line takes from an item the cook must ask for (`mustAsk`, a
 * group's item), and how much; null when it takes from none.
 */
export function lineAskTake(line: SessionLine): { take: SessionTake; milli: number } | null {
  if (line.bought || line.missing) return null;
  for (const t of lineTakes(line)) if (t.milli > 0 && t.take.orgId && t.take.item?.mustAsk) return t;
  return null;
}

/**
 * Does the line ask instead of being ticked? While its ask waits or once it
 * was approved (the approval is the cook's own use, so it is never taken
 * twice), and whenever it takes from an item the cook must ask for. A
 * declined or lapsed ask leaves it asking again only while that's still so.
 */
export function lineAsks(line: SessionLine): boolean {
  const a = line.ask;
  if (a && (a.state === "pending" || a.state === "approved")) return true;
  return lineAskTake(line) !== null;
}

export interface SessionLineAskView {
  state: "ask" | "waiting" | "approved" | "declined" | "lapsed";
  /** Who it asks: "Meera", "an admin". */
  who: string;
  /** The button in the tick's place: "Ask Meera", "Ask again"; null while it waits or once approved. */
  button: string | null;
  /** Its name: "Ask Meera for 2 g of Saffron". */
  buttonLabel: string | null;
  /** "Asked Meera · waiting · lapses in 24 h", "Meera said yes · logged as yours", "Meera said no", "Lapsed"; null before asking. */
  text: string | null;
  /** Cancel shows while it waits (once the server has it). */
  cancel: boolean;
}

/** Who a line asks: its ask's answerer, else the item's ("Meera", "an admin"). */
function lineAnswerer(line: SessionLine, names?: MemberNames | null): string {
  if (line.ask) return answererWords(line.ask.answerer, names, line.ask.answererName);
  const item = lineAskTake(line)?.take.item;
  return answererWords(item?.answerer ?? null, names);
}

/** The line's ask, as its row shows it; null for a line the cook just ticks. */
export function sessionLineAskView(line: SessionLine, ctx: { meId: string | null; names?: MemberNames | null; now: Date }): SessionLineAskView | null {
  const take = lineAskTake(line);
  const a = line.ask;
  if (!a && !take) return null;
  const who = lineAnswerer(line, ctx.names);
  const Who = who[0]!.toUpperCase() + who.slice(1);
  const by = a?.answeredBy && a.answeredBy !== a.answerer ? (firstName(a.answeredBy, ctx.names) ?? "An admin") : Who;
  const again = (state: "declined" | "lapsed", text: string): SessionLineAskView =>
    take
      ? { state, who, button: "Ask again", buttonLabel: `Ask ${who} again for ${line.name}`, text, cancel: false }
      : { state, who, button: null, buttonLabel: null, text, cancel: false };
  if (a?.state === "pending") {
    return { state: "waiting", who, button: null, buttonLabel: null, text: `Asked ${who} · waiting · lapses in ${lapsesIn(a.expiresAt, ctx.now)}`, cancel: !isPendingId(a.id) };
  }
  if (a?.state === "approved") return { state: "approved", who, button: null, buttonLabel: null, text: `${by} said yes · logged as yours`, cancel: false };
  if (a?.state === "declined") return again("declined", `${by} said no`);
  if (a?.state === "lapsed") return again("lapsed", "Lapsed");
  if (!take) return null;
  const amount = formatQuantity(take.milli, take.take.dimension, AMOUNT_STEPS[take.take.dimension].unit);
  return { state: "ask", who, button: `Ask ${who}`, buttonLabel: `Ask ${who} for ${amount} of ${line.name}`, text: null, cancel: false };
}

/**
 * The line's ask (PN-8's `askToUse`): what it takes from the item the cook
 * must ask for, in that item's base unit, for the cook, from a cook session.
 * Null when the line asks for nothing.
 */
export function cookAskRequest(line: SessionLine, meId: string): { orgId: string; itemId: string; body: AskToUseRequest; amount: string } | null {
  const t = lineAskTake(line);
  if (!t || !t.take.orgId) return null;
  const unit = AMOUNT_STEPS[t.take.dimension].unit;
  return {
    orgId: t.take.orgId,
    itemId: t.take.itemId,
    body: { quantity: milliToDecimal(t.milli), unit, consumers: [meId], source: "cook" },
    amount: formatQuantity(t.milli, t.take.dimension, unit),
  };
}

/** A server's ask as the draft keeps it. */
export function lineAskOf(ask: KitchenAsk): SessionLineAsk {
  return {
    id: ask.id,
    orgId: ask.orgId,
    itemId: ask.item.id,
    amount: ask.amount,
    answerer: ask.answerer,
    answererName: ask.answererName,
    state: ask.state,
    expiresAt: ask.expiresAt,
    answeredBy: ask.answeredBy,
  };
}

/** Put an ask on a line (it was sent), or take it off (cancelled, or refused). */
export function withLineAsk(s: CookSession, key: string, ask: SessionLineAsk | null): CookSession {
  return {
    ...s,
    lines: s.lines.map((l) => {
      if (l.key !== key) return l;
      if (ask) return { ...l, ask, ticked: false };
      const rest = { ...l };
      delete rest.ask;
      return rest;
    }),
  };
}

/**
 * The lines' asks as the server has them now (`asks().mine`): each one's
 * state and answer; a cancelled one comes off its line (it asks again); one
 * `mine` no longer holds lapses once past its time. The same session when
 * nothing changed.
 */
export function syncLineAsks(s: CookSession, mine: readonly KitchenAsk[], now: Date): CookSession {
  const byId = new Map(mine.map((a) => [a.id, a] as const));
  let changed = false;
  const lines = s.lines.map((l) => {
    const a = l.ask;
    if (!a || isPendingId(a.id)) return l;
    const fresh = byId.get(a.id);
    if (fresh?.state === "canceled") {
      changed = true;
      const rest = { ...l };
      delete rest.ask;
      return rest;
    }
    const next: SessionLineAsk = fresh
      ? lineAskOf(fresh)
      : a.state === "pending" && Date.parse(a.expiresAt) <= now.getTime()
        ? { ...a, state: "lapsed" }
        : a;
    if (next.state === a.state && next.answeredBy === a.answeredBy && next.expiresAt === a.expiresAt) return l;
    changed = true;
    return { ...l, ask: next };
  });
  return changed ? { ...s, lines } : s;
}

// ── The header and the bar ────────────────────────────────────────

/** How many lines are in, of those that can be: "3 of 7 in". */
export function progress(s: CookSession): { ticked: number; of: number } {
  const lines = s.lines.filter(tickable);
  return { ticked: lines.filter((l) => l.ticked).length, of: lines.length };
}

export function progressText(s: CookSession): string {
  const p = progress(s);
  return `${p.ticked} of ${p.of} in`;
}

function elapsedSeconds(startedAt: string, now: Date): number {
  const t = Date.parse(startedAt);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now.getTime() - t) / 1000));
}

/** The header's clock since the start: "12:04", "1:02:04". */
export function elapsedText(startedAt: string, now: Date): string {
  const s = elapsedSeconds(startedAt, now);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** The bar's minutes: "12 min", "1 h 5 min". */
export function minutesText(startedAt: string, now: Date): string {
  const m = Math.floor(elapsedSeconds(startedAt, now) / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

/** A factor as the chip writes it: 450 → "0.45", 1000 → "1", 1500 → "1.5". */
export function factorText(factorMilli: number): string {
  return String(Math.round(factorMilli / 10) / 100);
}

/** The dark chip: "For about 2 · ×0.45", opening the recipe at that size (RC-5's `?f=`); none for a blank session. */
export function scaleChip(s: CookSession): { label: string; href: string } | null {
  if (!s.recipeId || s.factorMilli === null) return null;
  const parts = s.servesHalf !== null ? [`For ${scalePortions(s.servesHalf, s.factorMilli).label}`] : [];
  parts.push(`×${factorText(s.factorMilli)}`);
  return { label: parts.join(" · "), href: `/recipes/${encodeURIComponent(s.recipeId)}?f=${s.factorMilli}` };
}

/** "Steps · 2 of 5". */
export function stepsTitle(s: CookSession): string {
  return `Steps · ${s.steps.filter((x) => x.done).length} of ${s.steps.length}`;
}

export interface SessionBarView {
  name: string;
  /** "Cooking · 12 min · 3 of 7 in". */
  meta: string;
  href: string;
}

/** The bar on every tab (design §4.4); null with no session, or an empty blank one. */
export function sessionBarView(s: CookSession | null, now: Date): SessionBarView | null {
  if (!s || isEmptySession(s)) return null;
  return {
    name: s.name.trim() || "Cooking",
    meta: `Cooking · ${minutesText(s.startedAt, now)} · ${progressText(s)}`,
    href: SESSION_PATH,
  };
}

/**
 * Pages whose own main button sits where the bar would (a form's sticky
 * button): the bar stays off them, as it does off the session itself.
 */
export const BAR_HIDDEN_PAGES: readonly RegExp[] = [
  /^\/cook\/session(?:\/|$)/,
  /^\/use(?:\/|$)/,
  /^\/pantry\/new(?:\/|$)/,
  /^\/pantry\/[^/]+$/,
  /^\/dishes\/[^/]+$/,
  /^\/groups\/[^/]+\/expense(?:\/|$)/,
  // The recipe screens (RC-5): a recipe's Start cooking, and its forms' Save.
  /^\/recipes(?:\/|$)/,
  // A recipe's link (RC-8): its Save to my recipes.
  /^\/r\/[^/]+$/,
];

/** Whether the bar shows on `pathname`: a session is open and this isn't the session (or a form with its own main button). */
export function sessionBarShows(pathname: string | null | undefined, s: CookSession | null): boolean {
  if (!s || isEmptySession(s)) return false;
  const path = pathname && pathname.length > 1 ? pathname.replace(/\/+$/, "") : (pathname ?? "");
  return !BAR_HIDDEN_PAGES.some((re) => re.test(path));
}

// ── Finish: what it asks ──────────────────────────────────────────

/** Unticked lines at Finish: Took them all (the default), or Leave them out. */
export type UntickedChoice = "all" | "out";

export const UNTICKED_CHOICES: readonly { id: UntickedChoice; label: string }[] = [
  { id: "all", label: "Took them all" },
  { id: "out", label: "Leave them out" },
];

/** Lines that could be ticked and aren't. */
export function untickedCount(s: CookSession): number {
  return s.lines.filter((l) => tickable(l) && !l.ticked).length;
}

/** "3 not ticked"; null when every line is in. */
export function untickedText(s: CookSession): string | null {
  const n = untickedCount(s);
  return n === 0 ? null : `${n} not ticked`;
}

/** What Finish posts: the ticked lines, and the unticked ones too when they took them all — never a missing one. */
export function includedLines(s: CookSession, unticked: UntickedChoice): SessionLine[] {
  // A line the cook asks for (PN-9) is never in the dish: an approval is their own use.
  return s.lines.filter((l) => !l.missing && !lineAsks(l) && (l.ticked || unticked === "all"));
}

/**
 * Lines as the dish maker's (one per item, amounts summed, no more than is
 * left; then what was just bought): what the cost, the currency checks, the
 * item picker's "added" and a refusal's words read.
 */
export function sessionDishLines(lines: readonly SessionLine[]): DishLine[] {
  const byItem = new Map<string, PantryLine>();
  const bought: NewLine[] = [];
  for (const line of lines) {
    if (line.bought) {
      const use = Math.min(line.qtyMilli ?? line.bought.useMilli, line.bought.qtyMilli);
      if (use > 0) bought.push({ ...line.bought, key: line.key, useMilli: use });
      continue;
    }
    for (const { take, milli } of lineTakes(line)) {
      if (milli <= 0 || !take.item) continue;
      const prev = byItem.get(take.itemId);
      const qtyMilli = Math.min((prev?.qtyMilli ?? 0) + milli, take.item.qtyLeftMilli);
      byItem.set(take.itemId, { kind: "pantry", key: take.itemId, item: take.item, qtyMilli });
    }
  }
  return [...byItem.values(), ...bought];
}

/** The session's currency: its first read item's, else the default. */
export function sessionCurrency(s: CookSession, groupCurrency?: string | null): string {
  if (groupCurrency) return groupCurrency;
  for (const l of s.lines) for (const t of l.takes) if (t.item) return t.item.currency;
  return DEFAULT_KITCHEN_CURRENCY;
}

/** What the ticked lines cost so far. */
export function soFarMinor(s: CookSession): number {
  return s.lines.filter((l) => l.ticked && !l.missing && !lineAsks(l)).reduce((a, l) => a + (sessionLineCost(l) ?? 0), 0);
}

/** Under Finish: "₹143.96 so far · post to Flat 4B" ("just for you" when it isn't shared). */
export function finishButtonText(s: CookSession, groupName: string | null, groupCurrency?: string | null): string {
  const where = groupName ? `post to ${groupName}` : "just for you";
  if (progress(s).ticked === 0) return `Nothing in yet · ${where}`;
  return `${formatMinor(soFarMinor(s), sessionCurrency(s, groupCurrency))} so far · ${where}`;
}

/**
 * Post to, until the cook picks (design §4.2): the group most of the
 * ingredients came from (by lines; groups you only view never), else the
 * group you opened last that counts in the dish's currency, else just you.
 */
export function defaultPostTo(s: CookSession, groups: readonly MyGroupBalance[], recentSlugs: readonly string[] = []): string {
  const cooking = new Set(cookingGroups(groups).map((g) => g.orgId));
  const counts = new Map<string, number>();
  for (const line of s.lines) {
    if (line.missing) continue;
    const orgs = new Set(line.takes.map((t) => t.orgId).filter((o): o is string => o !== null && cooking.has(o)));
    for (const o of orgs) counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  let best: string | null = null;
  let most = 0;
  for (const [org, n] of counts) {
    if (n > most) {
      best = org;
      most = n;
    }
  }
  if (best) return best;
  const currency = s.lines.flatMap((l) => l.takes).find((t) => t.item)?.item?.currency ?? null;
  return defaultShare(groups, { recentSlugs, currency });
}

/** Where it posts now: the cook's pick while it is still a group they cook in (or just them), else the default. */
export function postToOf(s: CookSession, groups: readonly MyGroupBalance[], recentSlugs: readonly string[] = []): string {
  if (s.postTo === JUST_ME) return JUST_ME;
  if (s.postTo && cookingGroups(groups).some((g) => g.orgId === s.postTo)) return s.postTo;
  return defaultPostTo(s, groups, recentSlugs);
}

/** The most half portions Who ate gives out in all (the server's 100 portions). */
export const MAX_EATEN_HALF = 200;

/** Who ate, to start with: you at 1, everyone else at 0. */
export function startingEaters(meId: string): Record<string, number> {
  return { [meId]: 2 };
}

/** The eaters' total in half portions. */
export function eatenHalf(halves: Readonly<Record<string, number>>): number {
  return Object.values(halves).reduce((a, h) => a + Math.max(0, h), 0);
}

/** Half a portion more or less for someone; never below 0, never past MAX_EATEN_HALF in all. */
export function stepEater(halves: Readonly<Record<string, number>>, subjectId: string, delta: 1 | -1): Record<string, number> {
  const now = halves[subjectId] ?? 0;
  if (delta < 0 && now <= 0) return { ...halves };
  if (delta > 0 && eatenHalf(halves) >= MAX_EATEN_HALF) return { ...halves };
  return { ...halves, [subjectId]: now + delta };
}

export interface FinishEaterRow {
  subjectId: string;
  /** "You", "Meera". */
  label: string;
  half: number;
  /** "1½" */
  portions: string;
  /** Their share of the dish. */
  amountMinor: number;
  canLess: boolean;
  canMore: boolean;
  lessLabel: string;
  moreLabel: string;
}

/**
 * Who ate, live: each person's half portions and share — the engine's split
 * (`buildDish`, you first, then the group's order) over a dish of exactly the
 * portions given out, so nothing falls to you unclaimed.
 */
export function finishEaters(input: {
  roster: readonly string[];
  meId: string;
  halves: Readonly<Record<string, number>>;
  totalMinor: number;
  names?: MemberNames | null;
}): { rows: FinishEaterRow[]; portionsHalf: number } {
  const portionsHalf = Math.max(1, eatenHalf(input.halves));
  const view = eaterView({ ...input, portionsHalf });
  const full = eatenHalf(input.halves) >= MAX_EATEN_HALF;
  const rows = view.rows.map((r) => ({
    subjectId: r.subjectId,
    label: r.label,
    half: r.half,
    portions: r.portions,
    amountMinor: r.amountMinor,
    canLess: r.half > 0,
    canMore: !full,
    lessLabel: `Half a portion less for ${r.label}`,
    moreLabel: `Half a portion more for ${r.label}`,
  }));
  return { rows, portionsHalf };
}

// ── Finish: the recipe ────────────────────────────────────────────

/** A recipe line's amount differs today from what the recipe says at this factor. */
function lineDiffers(line: SessionLine, factorMilli: number): boolean {
  const w = line.written;
  if (!w || w.toTaste || w.qtyMilli === null || w.unit === null || line.qtyMilli === null) return false;
  return line.qtyMilli !== scaleLine(w.qtyMilli, w.unit, factorMilli);
}

/** Today's amounts differ from the recipe's somewhere. */
export function amountsDiffer(s: CookSession): boolean {
  const f = s.factorMilli ?? 1000;
  return s.lines.some((l) => lineDiffers(l, f));
}

/**
 * The switch at Finish (design §4.2): "Save today's amounts to my recipe"
 * when you own the recipe and an amount differs; "Save as a recipe" for a
 * blank session; none otherwise. Off until it is turned on.
 */
export function saveSwitch(s: CookSession): { kind: "amounts" | "recipe"; label: string } | null {
  if (s.recipeId === null) return { kind: "recipe", label: "Save as a recipe" };
  if (s.mine && amountsDiffer(s)) return { kind: "amounts", label: "Save today's amounts to my recipe" };
  return null;
}

/**
 * The recipe's lines with today's amounts, for its PATCH (lines replace the
 * whole list): a line changed today is today's amount brought back to the
 * recipe's own size (÷ the factor, on its unit's grid); every other line is
 * exactly as written, to taste and main as they were.
 */
export function todaysRecipeLines(s: CookSession): RecipeLineInput[] {
  const f = s.factorMilli ?? 1000;
  const back = Math.round(1_000_000 / f);
  return s.lines
    .filter((l) => l.written !== null && l.recipeLine !== null)
    .sort((a, b) => a.recipeLine! - b.recipeLine!)
    .map((l) => {
      const w = l.written!;
      if (w.toTaste || w.qtyMilli === null || w.unit === null) {
        return { foodKey: w.foodKey, name: w.name, quantity: null, unit: null, toTaste: true, isMain: false };
      }
      const today = lineDiffers(l, f) && l.qtyMilli !== null ? (f === 1000 ? l.qtyMilli : (scaleLine(l.qtyMilli, w.unit, back) ?? w.qtyMilli)) : w.qtyMilli;
      return { foodKey: w.foodKey, name: w.name, quantity: lineQuantity(today, w.unit), unit: w.unit, toTaste: false, isMain: w.isMain };
    });
}

// ── Finish: what it posts ─────────────────────────────────────────

export interface FinishChoices {
  unticked: UntickedChoice;
  /** A group's `org_…`, or JUST_ME. */
  postTo: string;
  /** Who ate, in half portions; ignored for just you. */
  halves: Readonly<Record<string, number>>;
  /** The group's members, oldest first (the order shares are sent in); null for just you. */
  roster: readonly string[] | null;
  meId: string;
  /** The save switch is on. */
  save: boolean;
  /**
   * Just you: how many it made, in half portions (cookpool-community CM-9:
   * the new frame's Finish asks, so the dish can be split later). Absent, one
   * portion, as before.
   */
  portionsHalf?: number;
}

export type RecipeWrite =
  | { kind: "update"; recipeId: string; body: UpdateRecipeRequest }
  | { kind: "create"; body: Omit<SaveDishAsRecipeRequest, "fromDishId"> };

export interface FinishPlan {
  /** POST /v1/kitchen/me/dishes. */
  request: CookDishRequest;
  /** PUT …/dishes/{dsh}/shares, right after; null for just you or nobody named. */
  shares: SetDishSharesRequest | null;
  /** The recipe write after that, when the switch is on. */
  recipe: RecipeWrite | null;
  /** The lines as the dish maker's, for a refusal's words. */
  dishLines: DishLine[];
  /** Which line each item is for (the first that takes it), to point a refusal at it. */
  lineOfItem: Record<string, string>;
  totals: DishTotals;
}

export interface FinishProblem {
  message: string;
  /** The line it is about, or null. */
  lineKey: string | null;
  field: "name" | "lines" | "currency";
}

/** A just-bought line, as the cook write takes it (all of it unless less went in). */
function newItemRequest(line: SessionLine, recipeId: string | null): CookNewItemRequest {
  const b = line.bought!;
  const use = Math.min(line.qtyMilli ?? b.useMilli, b.qtyMilli);
  return {
    name: b.name,
    category: NEW_ITEM_CATEGORY,
    quantity: b.quantity,
    unit: b.unit,
    priceMinor: b.priceMinor,
    ...(use < b.qtyMilli ? { useQuantity: milliToDecimal(use), useUnit: AMOUNT_STEPS[b.dimension].unit } : {}),
    ...(recipeId ? { recipeLine: line.recipeLine } : {}),
  };
}

/**
 * Finish, worked out (design §4.3): one `POST /v1/kitchen/me/dishes` — the
 * name, the group (or just you), `portionsHalf` from Who ate's total (at
 * least ½; one portion just for you), `splitMode: "claims"` (just you:
 * "assign", as the server needs a group for claims), each item once in its
 * base unit with the recipe line it is for, and the recipe and its factor —
 * then the shares for each eater, and the recipe write when the switch is on.
 * With no amounts it still posts, a dish of no ingredients (RV-7). A problem
 * instead when it can't post: no name, too many items, mixed currencies.
 */
export function finishPlan(
  s: CookSession,
  choices: FinishChoices,
  ctx: { groups: readonly MyGroupBalance[] },
): { ok: true; plan: FinishPlan } | { ok: false; problem: FinishProblem } {
  const name = s.name.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, problem: { message: "Name the dish first.", lineKey: null, field: "name" } };
  const lines = includedLines(s, choices.unticked);
  const shared = choices.postTo !== JUST_ME;
  const group = shared ? (ctx.groups.find((g) => g.orgId === choices.postTo) ?? null) : null;

  const merged = new Map<string, { itemId: string; milli: number; dimension: Dimension; left: number; recipeLine: number | null }>();
  const lineOfItem: Record<string, string> = {};
  const newItems: CookNewItemRequest[] = [];
  for (const line of lines) {
    if (line.bought) {
      if ((line.qtyMilli ?? 0) > 0) newItems.push(newItemRequest(line, s.recipeId));
      continue;
    }
    for (const { take, milli } of lineTakes(line)) {
      if (milli <= 0) continue;
      lineOfItem[take.itemId] ??= line.key;
      const prev = merged.get(take.itemId);
      if (prev) prev.milli = Math.min(prev.milli + milli, prev.left);
      else {
        const left = take.item ? take.item.qtyLeftMilli : Number.POSITIVE_INFINITY;
        merged.set(take.itemId, { itemId: take.itemId, milli: Math.min(milli, left), dimension: take.item?.dimension ?? take.dimension, left, recipeLine: line.recipeLine });
      }
    }
  }
  const ingredients: CookIngredientRequest[] = [...merged.values()].map((m) => ({
    itemId: m.itemId,
    quantity: milliToDecimal(m.milli),
    unit: AMOUNT_STEPS[m.dimension].unit,
    ...(s.recipeId ? { recipeLine: m.recipeLine } : {}),
  }));
  // No amounts at all is no refusal (cookpool-revamp RV-7): the dish goes with no
  // ingredients, ₹0 and nothing taken from any pantry; a line without an amount is never charged.
  if (ingredients.length + newItems.length > MAX_DISH_INGREDIENTS) {
    return {
      ok: false,
      problem: { message: `A dish takes at most ${MAX_DISH_INGREDIENTS} items. Leave some out to post.`, lineKey: null, field: "lines" },
    };
  }
  const dishLines = sessionDishLines(lines);
  const currency = sessionCurrency(s, group?.currency ?? null);
  const odd = currencyProblem(dishLines, currency);
  if (odd) {
    const item = dishLines.find((l) => l.kind === "pantry" && l.item.currency !== currency);
    return { ok: false, problem: { message: odd, lineKey: item ? (lineOfItem[item.key] ?? null) : null, field: "currency" } };
  }

  const portionsHalf = shared
    ? Math.max(1, eatenHalf(choices.halves))
    : choices.portionsHalf !== undefined
      ? Math.max(1, Math.min(MAX_EATEN_HALF, Math.round(choices.portionsHalf)))
      : 2;
  // Guided mode's step log (GC-5): each cook step's start and tick, with the recipe.
  const stepLog = s.recipeId ? guideStepLog(s.guide) : [];
  const request: CookDishRequest = {
    name,
    orgId: shared ? choices.postTo : null,
    portionsHalf,
    splitMode: shared ? "claims" : "assign",
    ...(ingredients.length > 0 ? { ingredients } : {}),
    ...(newItems.length > 0 ? { newItems } : {}),
    ...(s.recipeId ? { recipeId: s.recipeId, recipeFactorMilli: s.factorMilli } : {}),
    ...(stepLog.length > 0 ? { stepLog } : {}),
  };
  const eaters = shared && choices.roster ? eaterShares(choices.halves, choices.roster, choices.meId) : [];
  const shares: SetDishSharesRequest | null =
    eaters.length > 0 ? { shares: eaters.map((e) => ({ subjectId: e.subjectId, portionsHalf: e.portionsHalf! })) } : null;

  const sw = saveSwitch(s);
  let recipe: RecipeWrite | null = null;
  if (choices.save && sw?.kind === "amounts" && s.recipeId) recipe = { kind: "update", recipeId: s.recipeId, body: { lines: todaysRecipeLines(s) } };
  else if (choices.save && sw?.kind === "recipe") recipe = { kind: "create", body: {} };

  const totals = dishTotals({ lines: dishLines, extrasMinor: 0, portionsHalf, meId: choices.meId, currency });
  return { ok: true, plan: { request, shares, recipe, dishLines, lineOfItem, totals } };
}

/** Post's words: "Post to Flat 4B", "Post · just you". */
export function postLabel(postTo: string, groupName: string | null): string {
  return postTo === JUST_ME ? "Post · just you" : `Post to ${groupName ?? "the group"}`;
}

/** A dish with no amounts (RV-7), in words: "₹0 · nothing taken from the pantry". */
export function nothingTakenText(currency: string): string {
  return `${shortMoney(0, currency)} · nothing taken from the pantry`;
}

/**
 * Under Post: the total, the portions and each ("₹143.96 · 2 portions · ₹71.98 each");
 * "₹0 · nothing taken from the pantry" when no line has an amount (`lineCount` 0).
 */
export function postSub(
  totals: Pick<DishTotals, "totalMinor" | "portionsHalf" | "perPortionMinor" | "perPortionExact" | "currency">,
  lineCount?: number,
): string {
  if (lineCount === 0) return nothingTakenText(totals.currency);
  return costLine(totals) ?? `${formatMinor(0, totals.currency)} · nothing costed`;
}

// ── Finish: posting ───────────────────────────────────────────────

/** An answer as `wrap` gives it (lib/api.ts). */
export type FinishAnswer<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      error: { code: string; message: string; reason?: string | undefined; details?: Record<string, unknown> | undefined };
    };

/** The writes Finish makes, as the client makes them (each idempotent on its own key). */
export interface FinishDeps {
  offline: () => boolean;
  cookDish: (request: CookDishRequest) => Promise<FinishAnswer<{ dish: KitchenDish }>>;
  setShares: (orgId: string, dishId: string, body: SetDishSharesRequest) => Promise<FinishAnswer<{ dish: KitchenDish }>>;
  updateRecipe: (recipeId: string, body: UpdateRecipeRequest) => Promise<FinishAnswer<unknown>>;
  createRecipe: (body: SaveDishAsRecipeRequest) => Promise<FinishAnswer<unknown>>;
}

export type FinishOutcome =
  | { ok: false; kind: "offline"; message: string }
  | {
      ok: false;
      kind: "refused";
      message: string;
      /** The line to point at, when the refusal names an item. */
      lineKey: string | null;
      /** The server answered: the next try needs a new idempotency key. */
      answered: boolean;
    }
  | {
      ok: true;
      dish: KitchenDish;
      /** The shares couldn't be set: the dish waits open, and people claim as they can. */
      sharesError: string | null;
      /** The recipe write was refused (the dish is cooked either way). */
      recipeError: string | null;
    };

/**
 * Post (design §4.3), in order: the cook write; then the shares, for each
 * eater; then the recipe — today's amounts, or a new one from the dish. Offline
 * nothing is sent and the session stays. A refused cook write says why and
 * points at the line; a failed shares or recipe write leaves the dish cooked.
 */
export async function runFinish(plan: FinishPlan, deps: FinishDeps): Promise<FinishOutcome> {
  if (deps.offline()) return { ok: false, kind: "offline", message: FINISH_OFFLINE_TEXT };
  const cooked = await deps.cookDish(plan.request);
  if (!cooked.ok) {
    if (cooked.error.reason === "offline") return { ok: false, kind: "offline", message: FINISH_OFFLINE_TEXT };
    const refusal = cookRefusal(cooked.error, plan.dishLines);
    const itemId = refusal.short?.itemId ?? refusal.itemIds[0] ?? null;
    return {
      ok: false,
      kind: "refused",
      message: refusal.message,
      lineKey: itemId ? (plan.lineOfItem[itemId] ?? null) : null,
      answered: cooked.status > 0 && cooked.status < 500,
    };
  }
  let dish = cooked.data.dish;
  let sharesError: string | null = null;
  if (plan.shares && dish.orgId) {
    const s = await deps.setShares(dish.orgId, dish.id, plan.shares);
    if (s.ok) dish = s.data.dish;
    else sharesError = sharesRefusal(s.error);
  }
  let recipeError: string | null = null;
  if (plan.recipe) {
    const r =
      plan.recipe.kind === "update"
        ? await deps.updateRecipe(plan.recipe.recipeId, plan.recipe.body)
        : await deps.createRecipe({ ...plan.recipe.body, fromDishId: dish.id });
    if (!r.ok) recipeError = r.error.message;
  }
  return { ok: true, dish, sharesError, recipeError };
}

// ── Keeping it on the device ──────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A stored draft, as read back: the session when it is one this version
 * wrote (the lines and steps as arrays, a start time), else null — a draft
 * from another version, or anything else in the key, is dropped.
 */
export function parseSession(raw: string | null | undefined): CookSession | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(v) || v["v"] !== SESSION_VERSION) return null;
  if (typeof v["name"] !== "string" || typeof v["startedAt"] !== "string" || Number.isNaN(Date.parse(v["startedAt"]))) return null;
  if (!Array.isArray(v["lines"]) || !Array.isArray(v["steps"])) return null;
  if (v["recipeId"] !== null && typeof v["recipeId"] !== "string") return null;
  const lines = v["lines"] as unknown[];
  if (!lines.every((l) => isObject(l) && typeof l["key"] === "string" && typeof l["name"] === "string" && Array.isArray(l["takes"]))) return null;
  // Guided mode's part (GC-5): one this version can't read is dropped, and the session reads as RC-6's.
  if ("guide" in v) {
    const guide = parseGuide(v["guide"]);
    if (guide) return { ...(v as unknown as CookSession), guide };
    const rest: Record<string, unknown> = { ...v };
    delete rest["guide"];
    return rest as unknown as CookSession;
  }
  return v as unknown as CookSession;
}

/** Inputs that bring up a phone's keyboard (the bar hides while one has focus); not a checkbox, a button or a range. */
export function opensKeyboard(el: { tagName: string; type?: string | null; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el.type ?? "text").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"].includes(type);
}
