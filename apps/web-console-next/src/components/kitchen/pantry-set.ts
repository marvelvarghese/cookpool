/**
 * The new Pantry's set row (cookpool-pantry PN-5, design §1.1, §2.2) as pure
 * view-models: the item's **ladder** — the amounts its − [amount] + steps
 * through — the **suggestion** a row makes (contracts' `suggestUse`, fed by
 * the ladder and the caller's usual), the reason under the amount ("Morning
 * usual", "The rest"), the **Last** line from the item's moves, the cost
 * line for the faces, and the per-item **draft** the device keeps until Use.
 * Since PN-11 the open row, the sheet and the item page pick the amount with
 * unit chips (`amount-picker.ts`), starting at the ladder's suggestion; the
 * ladder itself still makes the row's chip, the Now strip and the shopping
 * run's steps. Dependency-free (contracts, the engine and other
 * pure kitchen modules), so it is unit-testable.
 *
 * The ladder is the Use screen's tiles (`useTiles`, SM-14) without Other,
 * fed with the bucket's usual when there is one (so its usual tile is the
 * amount the row suggests), plus the steps above the suggested amount up to
 * what is left — whole multiples of it ("2 glasses", "200 g": the canvas's
 * QuickLog steps from 1 glass to 2), or one more of a measure at a time
 * ("3 onions") — in order of amount, then The rest.
 */

import type { KitchenItem, KitchenMeasure, KitchenStockMove, KitchenUsual } from "@saas/contracts/kitchen";
import { suggestUse, type UseSuggestionReason, type UsualNow } from "@saas/contracts/kitchen-usuals";
import { buildUse } from "@saas/kitchen-engine/ledger";
import { formatMinor } from "./money";
import { amountCost } from "./item-use";
import { amountKey, amountWords, defaultConsumers, measureName, qtyText, useTiles, type UseTile } from "./quick-use";
import { measureAmount, parseLabel, measuresOf, pluralOf, type UseAmount } from "./measures";
import { eachText, faceOrder } from "./faces";
import { isDraftPick, type AmountPick, type DraftPick } from "./amount-picker";
import { joinNames } from "./pantry";
import { memberLabelInline, type MemberNames } from "./members";
import { dayAndTimeText } from "./when";

/** What the set row needs of an item. */
export type SetItem = Pick<
  KitchenItem,
  "dimension" | "qtyLeftMilli" | "qtyBoughtMilli" | "priceMinor" | "worthMinor" | "currency" | "displayUnit" | "daysToUseBy"
> & { measures?: readonly KitchenMeasure[] | undefined };

/** The usual fields the set row reads (a `KitchenUsual`). */
export type SetUsual = Pick<KitchenUsual, "lastQtyMilli" | "consumers" | "lastUnit"> & {
  lastLabel?: string | null | undefined;
  lastUsedAt?: string | undefined;
  now?: UsualNow | null | undefined;
};

// ── The ladder ────────────────────────────────────────────────────

/** One amount the set row's − and + step through. */
export interface LadderStep {
  /** `amountKey` of its amount ("u:250000", "m:onion:2"), or "rest". */
  key: string;
  /** What it logs: a count of one of the item's measures, or an amount in its unit. */
  amount: UseAmount;
  qtyMilli: number;
  /** In a sentence and in the box: "1 glass", "2 onions", "100 g"; The rest says what is left ("400 ml"). */
  words: string;
  /** Everything left. */
  rest: boolean;
}

/** How many steps above the suggested amount the ladder adds (×2 … ×7, or six more of a measure), below what is left. */
export const LADDER_MULTIPLES = 6;

/** The usual the tiles mark: the bucket's when there is one (design §2.2), else the last. */
export function tileUsual(usual: SetUsual | null | undefined): Pick<KitchenUsual, "lastQtyMilli" | "lastLabel"> | null {
  if (!usual) return null;
  const now = usual.now ?? null;
  if (now && now.qtyMilli > 0) return { lastQtyMilli: now.qtyMilli, lastLabel: now.label };
  return { lastQtyMilli: usual.lastQtyMilli, lastLabel: usual.lastLabel ?? null };
}

function tileStep(t: UseTile): LadderStep {
  return { key: amountKey(t.amount), amount: t.amount, qtyMilli: t.amount.qtyMilli, words: t.amount.kind === "measure" ? t.amount.label : t.words, rest: false };
}

function unitStep(qtyMilli: number, words: string): LadderStep {
  const amount: UseAmount = { kind: "unit", qtyMilli };
  return { key: amountKey(amount), amount, qtyMilli, words, rest: false };
}

/** The rest: exactly what is left, read as its amount ("400 ml", "2 pcs"). */
export function restStep(item: Pick<KitchenItem, "qtyLeftMilli" | "dimension">): LadderStep {
  return { key: "rest", amount: { kind: "unit", qtyMilli: item.qtyLeftMilli }, qtyMilli: item.qtyLeftMilli, words: qtyText(item.qtyLeftMilli, item.dimension), rest: true };
}

/** k of an amount in words: "2 glasses" from "1 glass" (a kitchen measure), "2 onions", else the amount ("200 g"). */
function multipleWords(base: LadderStep, k: number, qtyMilli: number, item: SetItem): string {
  const named = base.amount.kind === "unit" ? measureName(base.qtyMilli, item.dimension) : null;
  const one = named ? /^1 (.+)$/.exec(named) : null;
  if (one) return `${k} ${pluralOf(one[1]!)}`;
  return amountWords(qtyMilli, item.dimension);
}

/** Above `base`, each under what is left: one more of a measure at a time (3, 4 onions), else ×2 … of the amount. */
function multiplesOf(base: LadderStep, item: SetItem): LadderStep[] {
  const out: LadderStep[] = [];
  const left = item.qtyLeftMilli;
  for (let k = 2; k <= LADDER_MULTIPLES + 1; k++) {
    if (base.amount.kind === "measure") {
      const a = measureAmount(item, base.amount.measure, Math.floor(base.amount.quantity) + k - 1);
      if (!a || a.qtyMilli >= left) break;
      out.push({ key: amountKey(a), amount: a, qtyMilli: a.qtyMilli, words: a.label, rest: false });
    } else {
      const qtyMilli = base.qtyMilli * k;
      if (qtyMilli >= left) break;
      out.push(unitStep(qtyMilli, multipleWords(base, k, qtyMilli, item)));
    }
  }
  return out;
}

/** The amount suggested for a row, with why (design §2.2). */
export interface SetSuggestion {
  reason: UseSuggestionReason;
  step: LadderStep;
  /** "Morning usual", "The rest · only 2 left", "Your usual", "Use soon"; null for the first step. */
  why: string | null;
  /** Who had it the last time (the bucket's people for a bucket usual); null without a usual. */
  consumerIds: string[] | null;
}

export interface ItemLadder {
  /** The Use screen's tiles for it, with the bucket's usual marked (the sheet's How much). */
  tiles: UseTile[];
  /** Smallest first, then The rest. Empty when nothing is left. */
  steps: LadderStep[];
  suggestion: SetSuggestion | null;
}

/**
 * An item's ladder and its suggestion. Nothing left: no steps and no
 * suggestion. The suggested amount is always on the ladder.
 */
export function itemLadder(item: SetItem, usual: SetUsual | null | undefined): ItemLadder {
  const left = item.qtyLeftMilli;
  if (left <= 0) return { tiles: [], steps: [], suggestion: null };
  const tiles = useTiles(item, tileUsual(usual));
  const s = suggestUse({ item, usual: usual ?? null, now: usual?.now ?? null, ladder: tiles });
  const rest = restStep(item);
  const fromTiles = tiles.filter((t) => !t.rest).map(tileStep);

  // The suggested step: The rest, the tile of that amount, the usual's tile, or that amount in the unit.
  let suggested: LadderStep | null = null;
  if (s) {
    if (s.reason === "rest") suggested = rest;
    else {
      suggested =
        fromTiles.find((t) => t.qtyMilli === s.qtyMilli) ??
        (s.reason === "usual" || s.reason === "usual_now" ? (tiles.filter((t) => t.usual && !t.rest).map(tileStep)[0] ?? null) : null);
      if (!suggested) {
        const said = parseLabel(s.label, measuresOf(item));
        const counted = said ? measureAmount(item, said.measure, said.quantity) : null;
        suggested = counted && counted.qtyMilli < left
          ? { key: amountKey(counted), amount: counted, qtyMilli: counted.qtyMilli, words: counted.label, rest: false }
          : unitStep(s.qtyMilli, s.label ?? amountWords(s.qtyMilli, item.dimension));
      }
    }
  }

  const base = suggested && !suggested.rest ? suggested : (fromTiles[0] ?? null);
  const candidates = [...fromTiles, ...(suggested && !suggested.rest ? [suggested] : []), ...(base ? multiplesOf(base, item) : [])];
  const body: LadderStep[] = [];
  for (const c of candidates) {
    if (c.qtyMilli <= 0 || c.qtyMilli >= left) continue;
    if (body.some((b) => b.key === c.key || b.qtyMilli === c.qtyMilli)) continue;
    body.push(c);
  }
  body.sort((a, b) => a.qtyMilli - b.qtyMilli);
  const steps = [...body, rest];
  const step = suggested ? (steps.find((x) => x.key === suggested.key) ?? steps.find((x) => x.qtyMilli === suggested.qtyMilli) ?? rest) : null;
  return {
    tiles,
    steps,
    suggestion: s && step ? { reason: s.reason, step, why: s.why, consumerIds: s.consumerIds } : null,
  };
}

// ── − [amount] + ──────────────────────────────────────────────────

/** The step a key names, or null. */
export function stepOf(steps: readonly LadderStep[], key: string | null | undefined): LadderStep | null {
  return key ? (steps.find((s) => s.key === key) ?? null) : null;
}

/** One step down (−1) or up (+1) the ladder from `key`, stopping at either end. */
export function stepFrom(steps: readonly LadderStep[], key: string, delta: 1 | -1): LadderStep | null {
  const i = steps.findIndex((s) => s.key === key);
  if (i < 0) return steps[0] ?? null;
  return steps[Math.min(steps.length - 1, Math.max(0, i + delta))] ?? null;
}

/** Whether − (−1) or + (+1) moves from `key`. */
export function canStep(steps: readonly LadderStep[], key: string, delta: 1 | -1): boolean {
  const i = steps.findIndex((s) => s.key === key);
  if (i < 0) return steps.length > 0;
  return delta > 0 ? i < steps.length - 1 : i > 0;
}

// ── Last time ─────────────────────────────────────────────────────

/** "you and Anu", "you"; null for nobody. */
function peopleText(ids: readonly string[] | null | undefined, meId: string | null, names?: MemberNames | null): string | null {
  if (!ids || ids.length === 0) return null;
  return joinNames(faceOrder([...new Set(ids)], meId, names).map((id) => memberLabelInline(id, meId, names)));
}

/**
 * "Last: 1 glass · today, 8:10 am · you and Anu" — this item's latest use
 * still in effect (its words as logged; not a stock check's), else the usual's last use of the
 * food (an earlier pack, PN-2). Your own pantry's names nobody. Null when
 * there is neither.
 */
export function lastLine(input: {
  moves: readonly KitchenStockMove[] | null | undefined;
  usual: SetUsual | null | undefined;
  item: Pick<KitchenItem, "dimension" | "pantry">;
  meId: string | null;
  names?: MemberNames | null;
  now: Date;
}): string | null {
  const { item, meId, names, now } = input;
  const personal = item.pantry.kind === "personal";
  // A stock check's use (PN-4, `via: "check"`) fixes the level; it isn't a time someone had it.
  const use = (input.moves ?? []).filter((m) => m.kind === "use" && !m.undone && m.via !== "check").sort((a, b) => b.at.localeCompare(a.at))[0];
  let words: string;
  let at: string | null;
  let people: string | null;
  if (use) {
    words = use.label ?? amountWords(use.qtyMilli, item.dimension);
    at = use.at;
    people = personal ? null : peopleText(use.consumers && use.consumers.length > 0 ? use.consumers : [use.actor], meId, names);
  } else if (input.usual && input.usual.lastQtyMilli > 0) {
    words = input.usual.lastLabel ?? amountWords(input.usual.lastQtyMilli, item.dimension);
    at = input.usual.lastUsedAt ?? null;
    people = personal ? null : peopleText(input.usual.consumers, meId, names);
  } else {
    return null;
  }
  const when = at ? dayAndTimeText(at, now) : "";
  return ["Last: " + words, when || null, people].filter(Boolean).join(" · ");
}

// ── Who had it, and what it costs ─────────────────────────────────

/**
 * Who the row logs for to start with: the draft's people, else the
 * suggestion's (the people from last time), else just you — only those
 * still in the group once its members are known. Your own pantry's item
 * names nobody.
 */
export function setConsumers(input: {
  item: Pick<KitchenItem, "pantry">;
  draft: readonly string[] | null | undefined;
  suggestion: SetSuggestion | null;
  roster: readonly string[] | null;
  meId: string | null;
}): string[] {
  if (input.item.pantry.kind === "personal") return [];
  const from = input.draft && input.draft.length > 0 ? input.draft : (input.suggestion?.consumerIds ?? null);
  return defaultConsumers(from ? { consumers: [...from] } : null, input.roster, input.meId);
}

/** The cost line beside the faces: "₹17.00", "₹17.00 · ₹8.50 each" (the engine's split). */
export function setCostLine(item: SetItem & Pick<KitchenItem, "paidBy" | "pantry">, qtyMilli: number, consumers: readonly string[]): string {
  const costMinor = amountCost(item, qtyMilli);
  const cost = formatMinor(costMinor, item.currency);
  const people = item.pantry.kind === "personal" ? [] : [...new Set(consumers)];
  if (people.length < 2) return cost;
  // What each of the people owes (the buyer's own split, when they didn't have any, is not a share).
  const owed = new Map(buildUse({ costMinor, buyerId: item.paidBy, consumers: people }).map((x) => [x.subjectId, x.owedMinor] as const));
  const each = eachText(people.map((id) => owed.get(id) ?? 0), item.currency);
  return each ? `${cost} · ${each}` : cost;
}

// ── The draft, kept on the device until Use ───────────────────────

/**
 * What the set row was left at, per item, until Use (PN-11): the amount as
 * picked — its unit chip and how many — and the people. Shared by the open
 * row, the More… sheet and the item page.
 */
export interface UseDraft {
  /** The amount; null when only the people were changed (the amount then follows the suggestion). */
  pick: DraftPick | null;
  /** Who had it; null when the row was never changed there. */
  consumers: string[] | null;
  /** When it was left so (ISO). */
  at: string;
}

/** How many items' drafts the device keeps (the oldest go first). */
export const MAX_DRAFTS = 40;

export function draftOf(pick: AmountPick | null, consumers: readonly string[] | null, at: Date): UseDraft {
  return {
    pick: pick ? { unit: pick.unit, count: pick.count, rest: pick.rest, how: pick.how } : null,
    consumers: consumers ? [...consumers] : null,
    at: at.toISOString(),
  };
}

/** A stored draft; one kept before PN-11 (an amount by ladder step) keeps its people and drops its amount. */
function readDraft(v: unknown): UseDraft | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Record<string, unknown>;
  const people = d["consumers"];
  const peopleOk = people === null || (Array.isArray(people) && people.every((x) => typeof x === "string"));
  if (typeof d["at"] !== "string" || !peopleOk) return null;
  const pick = d["pick"];
  if (pick !== undefined && pick !== null && !isDraftPick(pick)) return null;
  return { pick: isDraftPick(pick) ? pick : null, consumers: people === null ? null : [...(people as string[])], at: d["at"] };
}

/** The device's drafts, by `itm_…`, from their stored text; anything unreadable is dropped. */
export function parseDrafts(raw: string | null | undefined): Record<string, UseDraft> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, UseDraft> = {};
  for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
    const d = /^itm_/.test(id) ? readDraft(v) : null;
    if (d) out[id] = d;
  }
  return out;
}

/** The drafts with one set (or, with null, cleared), keeping the newest MAX_DRAFTS. */
export function putDraft(drafts: Readonly<Record<string, UseDraft>>, itemId: string, draft: UseDraft | null): Record<string, UseDraft> {
  const next: Record<string, UseDraft> = { ...drafts };
  if (draft) next[itemId] = draft;
  else delete next[itemId];
  const ids = Object.keys(next);
  if (ids.length <= MAX_DRAFTS) return next;
  const keep = new Set(ids.sort((a, b) => next[b]!.at.localeCompare(next[a]!.at)).slice(0, MAX_DRAFTS));
  return Object.fromEntries(Object.entries(next).filter(([id]) => keep.has(id)));
}
