/**
 * The stock check screen (cookpool-pantry PN-7, design §7, the canvas's
 * StockCheck) as pure view-models. Nobody logs everything: you set what is
 * really left, and say where the rest went.
 *
 *  - **The level**: a tall level you drag (`levelAt`), the marks Empty, ¼,
 *    ½, ¾ and Full of what was bought (`checkMarks`), and the arrow keys
 *    (`stepLevel`), on a grid of the item's size (`checkStep`). It never goes
 *    above Full, which the server would refuse (`more_than_bought`).
 *  - **The difference**: "Cookpool thinks 1 L · You say 750 ml"; for less,
 *    "Where did 250 ml go?" with its answers (`checkOptions`) and what each
 *    does to money — by the same engine helpers the use and waste previews
 *    use (`shareBreakdown`, `wastePreview`), so the odd paisa lands where the
 *    server puts it; for more, no money moves.
 *  - **Fix to 750 ml** (`fixButton`): the request it sends (`checkRequest`),
 *    what it changes on screen before the server answers (`checkWrite`), its
 *    toast (`checkToast`), and its Undo's refusal (`checkUndoRefusal`).
 *
 * Dependency-free (contracts, the engine and other pure kitchen modules), so
 * it is unit-testable.
 */

import type {
  CheckGroupItemRequest,
  CheckPersonalItemRequest,
  KitchenItem,
  KitchenStockMove,
  StockCheckGone,
} from "@saas/contracts/kitchen";
import { formatQuantity } from "@saas/kitchen-engine/units";
import { formatMinor } from "./money";
import { memberLabel, type MemberNames } from "./members";
import { amountCost, amountStep, milliToDecimal, shareBreakdown, wastePreview, type ShareLine } from "./item-use";
import { eachText } from "./faces";
import { answererWords } from "./ask-before-use";
import { pendingId } from "@/lib/optimistic";
import type { StockChange } from "./cache-patches";

/** What the check reads of an item. */
export type CheckItem = Pick<
  KitchenItem,
  | "id"
  | "name"
  | "pantry"
  | "dimension"
  | "displayUnit"
  | "qtyBoughtMilli"
  | "qtyLeftMilli"
  | "priceMinor"
  | "worthMinor"
  | "currency"
  | "paidBy"
  | "wastePolicy"
  | "wastePolicyOverride"
  | "mustAsk"
  | "answerer"
>;

// ── The level ─────────────────────────────────────────────────────

export interface CheckMark {
  key: "full" | "three-quarters" | "half" | "quarter" | "empty";
  label: string;
  /** Its level, in thousandths: a share of what was bought. */
  qtyMilli: number;
}

/** The marks beside the level, top to bottom: Full, ¾, ½, ¼, Empty — of what was bought. */
export function checkMarks(item: Pick<KitchenItem, "qtyBoughtMilli">): CheckMark[] {
  const b = item.qtyBoughtMilli;
  return [
    { key: "full", label: "Full", qtyMilli: b },
    { key: "three-quarters", label: "¾", qtyMilli: Math.round((b * 3) / 4) },
    { key: "half", label: "½", qtyMilli: Math.round(b / 2) },
    { key: "quarter", label: "¼", qtyMilli: Math.round(b / 4) },
    { key: "empty", label: "Empty", qtyMilli: 0 },
  ];
}

/**
 * One step of the level, in thousandths: the largest of 50, 25, 10, 5 or 1 g
 * (or ml) that gives at least 20 steps to Full; for things you count, a
 * whole piece or pack, else a half or a quarter, so there are at least 4.
 */
export function checkStep(item: Pick<KitchenItem, "dimension" | "qtyBoughtMilli">): number {
  const b = item.qtyBoughtMilli;
  const weighed = item.dimension === "mass" || item.dimension === "volume";
  const steps = weighed ? [50_000, 25_000, 10_000, 5_000, 1_000] : [1_000, 500, 250];
  const enough = weighed ? 20 : 4;
  return steps.find((s) => b / s >= enough) ?? steps[steps.length - 1]!;
}

/** A level on the screen: whole thousandths, from Empty to Full. */
export function clampLevel(item: Pick<KitchenItem, "qtyBoughtMilli">, milli: number): number {
  if (!Number.isFinite(milli)) return 0;
  return Math.max(0, Math.min(item.qtyBoughtMilli, Math.round(milli)));
}

/** The points a level settles on when it comes near: the marks, and what Cookpool thinks is left. */
function landmarks(item: Pick<KitchenItem, "qtyBoughtMilli" | "qtyLeftMilli">): number[] {
  return [...checkMarks(item).map((m) => m.qtyMilli), clampLevel(item, item.qtyLeftMilli)];
}

/**
 * The level at a point of the drag: `fraction` of the way up (0 is the
 * bottom, 1 the top), on the step grid — or on a mark, or on what Cookpool
 * thinks, within half a step of one — and never above Full.
 */
export function levelAt(item: Pick<KitchenItem, "dimension" | "qtyBoughtMilli" | "qtyLeftMilli">, fraction: number): number {
  const raw = clampLevel(item, (Number.isFinite(fraction) ? fraction : 0) * item.qtyBoughtMilli);
  const step = checkStep(item);
  const near = landmarks(item)
    .map((p) => ({ p, d: Math.abs(p - raw) }))
    .filter((x) => x.d <= step / 2)
    .sort((a, b) => a.d - b.d)[0];
  if (near) return near.p;
  return clampLevel(item, Math.round(raw / step) * step);
}

export type LevelKey = "up" | "down" | "page-up" | "page-down" | "home" | "end";

/** The slider's keys (WAI-ARIA): arrows a step, Page Up/Down to the next mark, Home Empty, End Full. */
export function levelKeyOf(key: string): LevelKey | null {
  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
      return "up";
    case "ArrowDown":
    case "ArrowLeft":
      return "down";
    case "PageUp":
      return "page-up";
    case "PageDown":
      return "page-down";
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      return null;
  }
}

/**
 * The level one key on: a step up or down the grid (stopping on what
 * Cookpool thinks on the way, so "It's right" is a key away), the next mark
 * for Page Up and Down, Empty for Home and Full for End.
 */
export function stepLevel(item: Pick<KitchenItem, "dimension" | "qtyBoughtMilli" | "qtyLeftMilli">, current: number, key: LevelKey): number {
  const at = clampLevel(item, current);
  const thinks = clampLevel(item, item.qtyLeftMilli);
  const step = checkStep(item);
  const marks = checkMarks(item).map((m) => m.qtyMilli);
  switch (key) {
    case "home":
      return 0;
    case "end":
      return item.qtyBoughtMilli;
    case "page-up":
      return Math.min(...marks.filter((m) => m > at), item.qtyBoughtMilli);
    case "page-down":
      return Math.max(...marks.filter((m) => m < at), 0);
    case "up": {
      const next = clampLevel(item, Math.floor(at / step) * step + step);
      return thinks > at && thinks < next ? thinks : next;
    }
    case "down": {
      const next = clampLevel(item, Math.ceil(at / step) * step - step);
      return thinks < at && thinks > next ? thinks : next;
    }
  }
}

/** How full the level is drawn, 0–100. */
export function levelPercent(item: Pick<KitchenItem, "qtyBoughtMilli">, milli: number): number {
  if (item.qtyBoughtMilli <= 0) return 0;
  return Math.max(0, Math.min(100, (clampLevel(item, milli) * 100) / item.qtyBoughtMilli));
}

/** A level in words: "750 ml", "1.5 L", "3 pcs"; "Empty" for none. */
export function levelText(item: Pick<KitchenItem, "dimension" | "displayUnit">, milli: number): string {
  return milli <= 0 ? "Empty" : formatQuantity(milli, item.dimension, item.displayUnit);
}

/** The slider's `aria-valuetext`: "750 ml of 2 L", "Empty". */
export function levelValueText(item: Pick<KitchenItem, "dimension" | "displayUnit" | "qtyBoughtMilli">, milli: number): string {
  return milli <= 0 ? "Empty" : `${levelText(item, milli)} of ${formatQuantity(item.qtyBoughtMilli, item.dimension, item.displayUnit)}`;
}

// ── The difference ────────────────────────────────────────────────

export type CheckDiff =
  | { kind: "same" }
  /** Less is left than Cookpool thought: `qtyMilli` went somewhere. */
  | { kind: "less"; qtyMilli: number; text: string }
  /** More is left: the check raises it by `qtyMilli`, and no money moves. */
  | { kind: "more"; qtyMilli: number; text: string };

export function checkDiff(item: Pick<KitchenItem, "dimension" | "displayUnit" | "qtyBoughtMilli" | "qtyLeftMilli">, says: number): CheckDiff {
  const d = clampLevel(item, says) - item.qtyLeftMilli;
  if (d === 0) return { kind: "same" };
  const qtyMilli = Math.abs(d);
  const text = formatQuantity(qtyMilli, item.dimension, item.displayUnit);
  return d < 0 ? { kind: "less", qtyMilli, text } : { kind: "more", qtyMilli, text };
}

/** "Cookpool thinks 1 L · You say 750 ml", as its two tiles. */
export function thinksAndSays(item: Pick<KitchenItem, "dimension" | "displayUnit" | "qtyLeftMilli">, says: number): { thinks: string; says: string } {
  return { thinks: levelText(item, item.qtyLeftMilli), says: levelText(item, says) };
}

/** For less: "Where did 250 ml go?". */
export function whereTitle(diff: Extract<CheckDiff, { kind: "less" }>): string {
  return `Where did ${diff.text} go?`;
}

/** For more. */
export const MORE_TEXT = "More than Cookpool thought. Fixing it moves no money.";

// ── Where it went ─────────────────────────────────────────────────

export interface CheckOption {
  gone: StockCheckGone;
  /** "Split with Flat 4B", "I used it", "It went bad". */
  title: string;
  /** What it does to money: "≈ ₹2.13 each", "₹8.50 to you · Meera gets it back", "Logged as yours"; null while the group's members load. */
  sub: string | null;
  /** What the difference costs (the engine's `costOfUse`, the last of it its rest of the price). */
  costMinor: number;
  /** Who pays what, in the order sent (a group's split and split waste). */
  lines: ShareLine[];
}

/** The answer chosen to start with: Split for a group's item (design §7), I used it for your own. */
export function defaultGone(item: Pick<KitchenItem, "pantry" | "mustAsk">): StockCheckGone {
  // Someone who must ask before using it (cookpool-pantry PN-9) can only say it went bad.
  if (item.pantry.kind === "group" && item.mustAsk) return "waste";
  return item.pantry.kind === "group" ? "split" : "me";
}

/**
 * For someone who must ask before using the item (cookpool-pantry PN-9): the
 * server refuses the check's I used it and Split for them (`ask_first`), so
 * only It went bad is offered, and one line says who logs a use — "Ask Meera
 * to log what was used". Null for everyone else.
 */
export function checkAskNote(item: Pick<KitchenItem, "pantry" | "mustAsk" | "answerer">, names?: MemberNames | null): string | null {
  if (item.pantry.kind !== "group" || !item.mustAsk) return null;
  return `Ask ${answererWords(item.answerer ?? null, names)} to log what was used`;
}

/**
 * The answers to "Where did 250 ml go?", in the canvas's order: for a group's
 * item **Split with <group>** (every current member, equally, by
 * `buildUse`: the odd paisa to the earliest), **I used it** (a use by you:
 * what you'd owe the buyer, or nothing when you bought it) and **It went
 * bad** (waste of the difference under the item's rule, as `wastePreview`
 * says it); for your own, I used it ("Logged as yours") and It went bad.
 * Empty unless less is left. `roster` is the group's members, oldest first
 * (null while they load: the subs that need them are null).
 */
export function checkOptions(input: {
  item: CheckItem;
  says: number;
  roster: readonly string[] | null;
  meId: string | null;
  names?: MemberNames | null;
}): CheckOption[] {
  const { item, meId, names } = input;
  const diff = checkDiff(item, input.says);
  if (diff.kind !== "less") return [];
  const d = diff.qtyMilli;
  const costMinor = amountCost(item, d);
  const cost = formatMinor(costMinor, item.currency);
  const roster = input.roster;

  const waste = wastePreview({ item: { ...item, qtyLeftMilli: d, worthMinor: costMinor }, members: roster ?? [], meId, names: names ?? null });
  const wasteEach = eachText(waste.lines.map((l) => l.amountMinor), item.currency);
  const wasteSub = item.pantry.kind === "group" && roster === null ? null : `Waste · ${waste.short ?? wasteEach ?? cost}`;
  const wentBad: CheckOption = { gone: "waste", title: "It went bad", sub: wasteSub, costMinor, lines: waste.lines };

  if (item.pantry.kind === "personal") {
    return [{ gone: "me", title: "I used it", sub: "Logged as yours", costMinor, lines: [] }, wentBad];
  }
  // You must ask before using it (PN-9): a use or a split is the answerer's to log.
  if (item.mustAsk) return [wentBad];

  const mine = shareBreakdown({ item, qtyMilli: d, consumers: meId ? [meId] : [], meId, names: names ?? null });
  const buyer = memberLabel(item.paidBy, meId, names);
  const meSub = item.paidBy === meId ? `${cost} · you paid, so no money moves` : `${cost} to you · ${buyer} gets it back`;
  const used: CheckOption = { gone: "me", title: "I used it", sub: meSub, costMinor, lines: mine.lines };

  let split: CheckOption = { gone: "split", title: `Split with ${item.pantry.name}`, sub: null, costMinor, lines: [] };
  if (roster !== null && roster.length > 0) {
    const shared = shareBreakdown({ item, qtyMilli: d, consumers: roster, meId, names: names ?? null });
    const each = eachText(shared.lines.map((l) => l.amountMinor), item.currency);
    split = { ...split, sub: each ?? cost, lines: shared.lines };
  } else if (roster !== null) {
    split = { ...split, sub: cost };
  }
  return [split, used, wentBad];
}

// ── Fix ───────────────────────────────────────────────────────────

/** The main button: "Fix to 750 ml" — or, at the level Cookpool thinks, "It's right", which writes nothing. */
export function fixButton(item: Pick<KitchenItem, "dimension" | "displayUnit" | "qtyBoughtMilli" | "qtyLeftMilli">, says: number): { label: string; same: boolean } {
  if (checkDiff(item, says).kind === "same") return { label: "It's right", same: true };
  const level = levelText(item, says);
  return { label: `Fix to ${level === "Empty" ? "empty" : level}`, same: false };
}

/**
 * The check's request (`checkGroupItem` / `checkPersonalItem`): the level in
 * the item's base unit (`{ quantity: "750", unit: "ml" }`, 0 for empty),
 * with `gone` only when less is left (a personal item never splits). Null at
 * the level Cookpool thinks: "It's right" sends nothing.
 */
export function checkRequest(
  item: Pick<KitchenItem, "dimension" | "displayUnit" | "qtyBoughtMilli" | "qtyLeftMilli" | "pantry">,
  says: number,
  gone: StockCheckGone,
): CheckGroupItemRequest | CheckPersonalItemRequest | null {
  const level = clampLevel(item, says);
  const diff = checkDiff(item, level);
  if (diff.kind === "same") return null;
  const left = { quantity: milliToDecimal(level), unit: amountStep(item).unit };
  if (diff.kind === "more") return { left };
  if (item.pantry.kind === "personal") return { left, gone: gone === "split" ? "me" : gone };
  return { left, gone };
}

/**
 * What a check changes on screen before the server answers (SM-5): for less,
 * a use (or waste) of the difference — its cost the engine's, its people
 * you, or every member for a split — and its history row; for more, the
 * level raised by the difference (no money), and its `adjust` row. Both rows
 * carry `via: "check"`, so history reads them as the check at once.
 */
export function checkWrite(input: {
  item: CheckItem;
  says: number;
  gone: StockCheckGone;
  roster: readonly string[] | null;
  meId: string;
  at: string;
}): { kind: "take"; change: StockChange; move: KitchenStockMove } | { kind: "raise"; change: StockChange; move: KitchenStockMove } | null {
  const { item, meId } = input;
  const diff = checkDiff(item, input.says);
  if (diff.kind === "same") return null;
  const unit = amountStep(item).unit;
  const move = (kind: KitchenStockMove["kind"], costMinor: number, consumers: string[] | null): KitchenStockMove => ({
    id: pendingId("mov"),
    itemId: item.id,
    kind,
    qtyMilli: diff.qtyMilli,
    quantity: Number(milliToDecimal(diff.qtyMilli)),
    unit,
    label: null,
    costMinor,
    actor: meId,
    consumers,
    txnId: null,
    reverses: null,
    at: input.at,
    undone: false,
    undoneBy: null,
    via: "check",
  });
  if (diff.kind === "more") {
    return { kind: "raise", change: { itemId: item.id, kind: "use", qtyMilli: diff.qtyMilli, costMinor: 0 }, move: move("adjust", 0, null) };
  }
  const costMinor = amountCost(item, diff.qtyMilli);
  const gone = item.pantry.kind === "personal" && input.gone === "split" ? "me" : input.gone;
  const kind = gone === "waste" ? "waste" : "use";
  const consumers = kind === "waste" || item.pantry.kind === "personal" ? null : gone === "split" ? [...(input.roster ?? [meId])] : [meId];
  return { kind: "take", change: { itemId: item.id, kind, qtyMilli: diff.qtyMilli, costMinor }, move: move(kind, costMinor, consumers) };
}

/**
 * The check's toast: "Fixed Milk to 750 ml", then what happened to the
 * difference — "250 ml split with Flat 4B · ≈ ₹2.13 each", "250 ml logged as
 * yours · ₹8.50 to Meera", "250 ml wasted · Meera absorbs it" — or, for
 * more, "No money moved."
 */
export function checkToast(input: {
  item: CheckItem;
  says: number;
  option: CheckOption | null;
  meId: string | null;
  names?: MemberNames | null;
}): { title: string; description: string } {
  const { item, option, meId, names } = input;
  const level = levelText(item, input.says);
  const title = `Fixed ${item.name} to ${level === "Empty" ? "empty" : level}`;
  const diff = checkDiff(item, input.says);
  if (diff.kind !== "less" || !option) return { title, description: "No money moved." };
  const cost = formatMinor(option.costMinor, item.currency);
  switch (option.gone) {
    case "split":
      return { title, description: `${diff.text} split with ${item.pantry.name} · ${option.sub ?? cost}` };
    case "me":
      if (item.pantry.kind === "personal" || item.paidBy === meId) return { title, description: `${diff.text} logged as yours` };
      return { title, description: `${diff.text} logged as yours · ${cost} to ${memberLabel(item.paidBy, meId, names)}` };
    case "waste":
      return { title, description: `${diff.text} wasted${option.sub ? ` · ${option.sub.replace(/^Waste · /, "")}` : ""}` };
  }
}

/**
 * An Undo the server refused, as a stock check says it: `insufficient_stock`
 * on undoing a raise means what the check added has been used since. Null
 * for anything else (the pantry's own words, `undoRefusal`).
 */
export function checkUndoRefusal(error: { reason?: string | undefined }): { ok: false; kind: "warning"; title: string; description: string } | null {
  if (error.reason !== "insufficient_stock") return null;
  return { ok: false, kind: "warning", title: "Already used", description: "What the check added has been used since." };
}

/** The screen's title and, under it, what is being checked: "How much is left?" · "Milk · Flat 4B" (a name reads anywhere: "Eggs", "Milk"). */
export function checkTitle(item: Pick<KitchenItem, "name" | "pantry">): { title: string; what: string } {
  return { title: "How much is left?", what: `${item.name} · ${item.pantry.kind === "group" ? item.pantry.name : "Personal"}` };
}

/** Why a check was refused, in one line. */
export function checkRefusal(error: { reason?: string | undefined; message: string }): string {
  switch (error.reason) {
    case "unchanged":
      return "That's what Cookpool has now — someone fixed it meanwhile.";
    case "more_than_bought":
      return "That's more than was bought.";
    case "stale":
      return "It changed while you were checking. Look again and fix it.";
    case "insufficient_stock":
      return "Someone used some meanwhile. Look again and fix it.";
    default:
      return error.message;
  }
}
