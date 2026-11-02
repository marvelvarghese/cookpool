// Splitting a dish among the people who ate it (CP-16): the shares a request
// sends, the split the engine makes of them (`buildDish`), what the unclaimed
// portions are worth (the cook's leftovers), and the netting with the cook
// inside the dish's group — everything a dish read says about its split. The
// writes that finalize or correct a dish are planned in handlers/dish-split.ts
// from these.
//
// The maths is the engine's, never re-done here: `buildDish` splits the total
// (exact amounts off the top, the rest by portions, largest remainder, the
// unclaimed portions to the cook), `splitByWeights` parts the cook's share
// between what they had and what nobody had, and `buildIngredientTake` and
// `pairLines` net the dish against what the cook took from the group's
// pantry.

import {
  KITCHEN_ERROR_REASONS,
  MAX_DISH_SHARES,
  type DishAmount,
  type DishNet,
  type KitchenDishShare,
} from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import type { KitchenDishRecord, KitchenDishShareRecord, NewDishShare } from "@saas/db/kitchen";
import { buildDish, buildIngredientTake, pairLines, type DishShare, type Split, type Txn } from "@saas/kitchen-engine/ledger";
import { formatMinor, splitByWeights } from "@saas/kitchen-engine/money";
import { conflict, errorResponse, validationError } from "./http.js";
import { toPublicId } from "./ids.js";
import { MAX_NAME } from "./pantry.js";
import { Fields, minor, subjectId as subjectIdOf } from "./validate.js";

/** A hundred portions is a feast; more is a typo. */
export const MAX_PORTIONS_HALF = 200;

/** One half portion of leftovers, in thousandths of a piece: a portion is one piece. */
export const HALF_PORTION_MILLI = 500;

/** The unit leftovers are counted in. */
export const LEFTOVERS_UNIT = "pcs";

// ── The request body ───────────────────────────────────────

/** One eater as a request names them: half portions, or an exact amount. */
export interface ParsedShare {
  subjectId: string;
  portionsHalf: number | null;
  exactMinor: number | null;
}

/** `portionsHalf`: a whole number of half portions from `min` to the most a dish has. */
export function portionsHalfOf(fields: Fields, name: string, value: unknown, min: number): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= MAX_PORTIONS_HALF) return value;
  return fields.add(name, `Must be half portions, a whole number from ${min} to ${MAX_PORTIONS_HALF}`);
}

/** `shares`: everyone who had some, once each — half portions (above zero) or an exact amount, not both. */
export function parseShares(fields: Fields, value: unknown): ParsedShare[] | undefined {
  if (!Array.isArray(value)) return fields.add("shares", "Must be a list");
  if (value.length > MAX_DISH_SHARES) return fields.add("shares", `At most ${MAX_DISH_SHARES} people`);
  const shares: ParsedShare[] = [];
  value.forEach((raw: unknown, i) => {
    const at = `shares[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fields.add(at, "Must be an object");
    const entry = raw as Record<string, unknown>;
    const subjectId = subjectIdOf(fields, `${at}.subjectId`, entry.subjectId);
    const hasPortions = entry.portionsHalf !== undefined && entry.portionsHalf !== null;
    const hasExact = entry.exactMinor !== undefined && entry.exactMinor !== null;
    if (hasPortions === hasExact) return fields.add(at, "Send portionsHalf or exactMinor, one of them");
    const portionsHalf = hasPortions ? portionsHalfOf(fields, `${at}.portionsHalf`, entry.portionsHalf, 1) : null;
    const exactMinor = hasExact ? minor(fields, `${at}.exactMinor`, entry.exactMinor) : null;
    if (subjectId === undefined || portionsHalf === undefined || exactMinor === undefined) return undefined;
    shares.push({ subjectId, portionsHalf, exactMinor });
    return undefined;
  });
  if (new Set(shares.map((s) => s.subjectId)).size !== shares.length) fields.add("shares", "Name each person once");
  return fields.ok ? shares : undefined;
}

/**
 * Do the shares fit the dish? Its portions (409 `claims_exceed_portions`)
 * and its total (422). Null when they do.
 */
export function sharesMisfit(requestId: string, dish: KitchenDishRecord, shares: readonly ParsedShare[]): Response | null {
  const portions = shares.reduce((sum, s) => sum + (s.portionsHalf ?? 0), 0);
  if (portions > dish.portionsHalf) {
    return conflict(requestId, `Only ${dish.portionsHalf / 2} portions were cooked`, KITCHEN_ERROR_REASONS.CLAIMS_EXCEED_PORTIONS, {
      portionsHalf: dish.portionsHalf,
      availableHalf: dish.portionsHalf,
    });
  }
  const exact = shares.reduce((sum, s) => sum + (s.exactMinor ?? 0), 0);
  if (exact > dish.totalMinor) {
    return validationError(requestId, {
      shares: [`The fixed amounts add up to ${formatMinor(exact, dish.currency)}, more than the dish cost (${formatMinor(dish.totalMinor, dish.currency)})`],
    });
  }
  return null;
}

/** The shares to write, each with a fresh id, in the order the request listed them. */
export function newShares(shares: readonly ParsedShare[]): NewDishShare[] {
  return shares.map((s) => ({ id: asUuid(crypto.randomUUID()), ...s }));
}

// ── The split ──────────────────────────────────────────────

type ShareLike = Pick<KitchenDishShareRecord, "subjectId" | "portionsHalf" | "exactMinor">;

/** The shares in split order: the cook's first, then as listed or claimed. Ties (the odd paisa) follow it. */
export function inSplitOrder<T extends ShareLike & { position?: number }>(cook: string, shares: readonly T[]): T[] {
  return [...shares].sort((a, b) => {
    if (a.subjectId === cook) return -1;
    if (b.subjectId === cook) return 1;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

export interface DishSplit {
  /** The dish transaction's splits: the cook paid the total, everyone owes their share. */
  splits: Split[];
  /** What each person owes, cook first, then the eaters in split order. */
  amounts: DishAmount[];
  claimedHalf: number;
  unclaimedHalf: number;
  /** What the unclaimed portions are worth: their part of the cook's share. */
  unclaimedMinor: number;
}

/**
 * The engine's split of a dish among `shares` (in split order). Throws the
 * engine's LedgerError when they cannot be split (more portions than were
 * cooked, fixed amounts over the total): the routes check both first.
 */
export function splitDish(
  dish: Pick<KitchenDishRecord, "cook" | "totalMinor" | "portionsHalf">,
  shares: readonly ShareLike[],
): DishSplit {
  const engineShares: DishShare[] = shares.map((s) =>
    s.exactMinor !== null ? { subjectId: s.subjectId, exactMinor: s.exactMinor } : { subjectId: s.subjectId, portionsHalf: s.portionsHalf ?? 0 },
  );
  const built = buildDish({ cookId: dish.cook, totalMinor: dish.totalMinor, portionsHalf: dish.portionsHalf, shares: engineShares });
  const cookShare = shares.find((s) => s.subjectId === dish.cook);
  const cookOwed = built.owedBy.get(dish.cook) ?? 0;
  // The cook's share holds their own claim and every unclaimed portion
  // (plus a fixed amount, if that is what they were assigned): the part the
  // unclaimed portions make up is what the leftovers are worth.
  const cookPortionsMinor = cookOwed - (cookShare?.exactMinor ?? 0);
  const unclaimedMinor =
    built.unclaimedHalf > 0 && cookPortionsMinor > 0
      ? splitByWeights(cookPortionsMinor, [cookShare?.portionsHalf ?? 0, built.unclaimedHalf])[1]!
      : 0;
  const amounts: DishAmount[] = [
    {
      subjectId: dish.cook,
      portionsHalf: cookShare ? cookShare.portionsHalf : 0,
      exactMinor: cookShare ? cookShare.exactMinor : null,
      owedMinor: cookOwed,
    },
    ...shares
      .filter((s) => s.subjectId !== dish.cook)
      .map((s) => ({
        subjectId: s.subjectId,
        portionsHalf: s.portionsHalf,
        exactMinor: s.exactMinor,
        owedMinor: built.owedBy.get(s.subjectId) ?? 0,
      })),
  ];
  return {
    splits: built.splits,
    amounts,
    claimedHalf: dish.portionsHalf - built.unclaimedHalf,
    unclaimedHalf: built.unclaimedHalf,
    unclaimedMinor,
  };
}

/**
 * Inside the dish's group, everyone the dish moves money with — eaters, and
 * buyers of what the cook took from the group's pantry — and what they owe
 * the cook net of what the cook owes them. The engine attributes both
 * transactions pairwise (`pairLines`); each person's lines with the cook add
 * up to their net.
 */
export function nettingOf(dish: KitchenDishRecord, split: DishSplit): DishNet[] {
  if (!dish.orgId) return [];
  // What the cook took from the shared group's pantry: its `use` transaction, as cooking posted it.
  const lines = dish.ingredients
    .filter((i) => i.orgId === dish.orgId && i.useTxnId !== null)
    .map((i) => ({ buyerId: i.paidBy, costMinor: i.costMinor }));
  const txns: Txn[] = [{ id: "dish", kind: "dish", title: dish.name, totalMinor: dish.totalMinor, splits: split.splits }];
  if (lines.length > 0) {
    const take = buildIngredientTake({ cookId: dish.cook, lines });
    txns.push({ id: "take", kind: "use", title: dish.name, totalMinor: take.totalMinor, splits: take.splits });
  }
  const order: string[] = [];
  const nets = new Map<string, { owesCookMinor: number; cookOwesMinor: number }>();
  const entry = (subjectId: string) => {
    let net = nets.get(subjectId);
    if (!net) {
      net = { owesCookMinor: 0, cookOwesMinor: 0 };
      nets.set(subjectId, net);
      order.push(subjectId);
    }
    return net;
  };
  // Eaters in split order first, then buyers who did not eat.
  for (const a of split.amounts) if (a.subjectId !== dish.cook) entry(a.subjectId);
  for (const line of pairLines(txns)) {
    if (line.creditorId === dish.cook) entry(line.debtorId).owesCookMinor += line.amountMinor;
    else if (line.debtorId === dish.cook) entry(line.creditorId).cookOwesMinor += line.amountMinor;
  }
  return order.map((subjectId) => {
    const net = nets.get(subjectId)!;
    return { subjectId, ...net, netMinor: net.owesCookMinor - net.cookOwesMinor };
  });
}

/** What a dish read says about its split (see KitchenDish in @saas/contracts/kitchen). */
export interface DishSplitView {
  shares: KitchenDishShare[];
  myClaimHalf: number;
  claimedHalf: number;
  unclaimedHalf: number;
  unclaimedMinor: number;
  amounts: DishAmount[];
  netting: DishNet[];
}

/** Half portions held so far: every share by portions (an exact amount holds none). */
export function claimedHalfOf(shares: readonly Pick<KitchenDishShareRecord, "portionsHalf">[]): number {
  return shares.reduce((sum, s) => sum + (s.portionsHalf ?? 0), 0);
}

export function dishSplitView(dish: KitchenDishRecord, viewer: string): DishSplitView {
  const ordered = inSplitOrder(dish.cook, dish.shares);
  const shares = ordered.map((s) => ({
    id: toPublicId("dsr", s.id),
    subjectId: s.subjectId,
    portionsHalf: s.portionsHalf,
    exactMinor: s.exactMinor,
    source: s.source,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }));
  const claimedHalf = claimedHalfOf(ordered);
  const myClaimHalf = ordered.find((s) => s.subjectId === viewer)?.portionsHalf ?? 0;
  const base = {
    shares,
    myClaimHalf,
    claimedHalf,
    unclaimedHalf: Math.max(0, dish.portionsHalf - claimedHalf),
    unclaimedMinor: 0,
    amounts: [],
    netting: [],
  };
  // A canceled dish moves no money.
  if (dish.state === "canceled") return base;
  let split: DishSplit;
  try {
    split = splitDish(dish, ordered);
  } catch {
    // Shares are checked before they are written, so this cannot happen; the read still answers.
    return base;
  }
  return { ...base, unclaimedMinor: split.unclaimedMinor, amounts: split.amounts, netting: nettingOf(dish, split) };
}

/** A refusal from the engine, should the routes' own checks have missed one. */
export function splitErrorResponse(requestId: string, err: unknown): Response {
  return errorResponse("internal_error", "The dish could not be split", 500, requestId, {
    reason: err instanceof Error ? err.message : String(err),
  });
}

/** "Leftovers: {dish}", within an item name's length. */
export function leftoversName(dishName: string): string {
  const name = `Leftovers: ${dishName}`;
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}
