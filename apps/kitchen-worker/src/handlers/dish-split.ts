import { KITCHEN_ERROR_REASONS, LEFTOVERS_CATEGORY } from "@saas/contracts/kitchen";
import { asUuid, type Uuid } from "@saas/db/ids";
import type {
  CorrectDishInput,
  DishLeftoverChange,
  FinalizeDishInput,
  KitchenDishError,
  KitchenDishRecord,
  KitchenDishScope,
  KitchenRepository,
  KitchenSplit,
  NewKitchenItem,
  NewKitchenTxn,
} from "@saas/db/kitchen";
import { reverseSplits } from "@saas/kitchen-engine/ledger";
import { formatMinor } from "@saas/kitchen-engine/money";
import { groupAllows, requireGroupAction, requireOrgAction } from "../authz.js";
import type { OrgContext, RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { dishAudits, dishErrorResponse } from "../dishes.js";
import { conflict, forbidden, notFound, readJsonObject, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { isoDay } from "../pantry.js";
import { notInGroup } from "../roster-client.js";
import {
  HALF_PORTION_MILLI,
  LEFTOVERS_UNIT,
  inSplitOrder,
  leftoversName,
  newShares,
  parseShares,
  portionsHalfOf,
  sharesMisfit,
  splitDish,
  splitErrorResponse,
  type DishSplit,
  type ParsedShare,
} from "../split.js";
import { Fields, text } from "../validate.js";
import { dishResponse, myGroups, readable } from "./dishes.js";

// Splitting a dish shared with a group (CP-16), /v1/organizations/{org}/kitchen/dishes/{dsh}/…
//
//   PUT  …/claims/me   kitchen.dish.claim (members — not viewers): claim half portions of an open dish
//   PUT  …/shares      its cook, or kitchen.dish.finalize_any: replace every share of a draft or open dish
//   POST …/finalize    its cook, or kitchen.dish.finalize_any: the dish transaction, leftovers, finalized
//   POST …/correct     its cook, or kitchen.dish.finalize_any: reversal + a new dish transaction
//
// and POST /v1/kitchen/me/dishes/{dsh}/finalize — its cook, for a dish just
// for them (nothing to split: it is only marked finalized) or one shared
// with a group (the same write as the group's route).
//
// A dish not shared with the path's group is the opaque 404, as is a role
// without the route's grant (a viewer); a member who is not the cook gets 403
// `not_creator`. Every write is ONE batch, guarded by the dish's state and,
// for finalize and correct, by the version the split was planned from: a
// claim landing in between fails the batch, and the write is planned once
// more from a fresh read (409 `stale` on a second loss). Finalize and correct
// are idempotent: a finalized dish answers as it is, and a retried correction
// finds the transaction it posted.

/** The dishes shared with the request's group. */
function inGroup(ctx: OrgContext): KitchenDishScope {
  return { cook: null, orgIds: [ctx.orgId] };
}

/** The dish as the path names it, shared with the path's group; or the response to send instead. */
async function groupDish(
  ctx: OrgContext,
  repo: KitchenRepository,
  dishId: Uuid,
): Promise<{ ok: true; dish: KitchenDishRecord } | { ok: false; response: Response }> {
  const found = await ctx.timings.measure("db", () => repo.getDish(dishId, inGroup(ctx)));
  if (found.ok) return { ok: true, dish: found.value };
  return { ok: false, response: found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId) };
}

/** Its cook, or an owner or admin (`kitchen.dish.finalize_any`); null when allowed. */
async function cookOrAdmin(ctx: OrgContext, dish: KitchenDishRecord, doing: string): Promise<Response | null> {
  if (dish.cook === ctx.actor.subjectId || (await groupAllows(ctx, "kitchen.dish.finalize_any"))) return null;
  return forbidden(ctx.requestId, `Only whoever cooked a dish, or an owner or admin, can ${doing} it`, KITCHEN_ERROR_REASONS.NOT_CREATOR);
}

/** Everyone a set of shares names must be in the group; null when they are. */
async function eatersInGroup(ctx: OrgContext, shares: readonly ParsedShare[]): Promise<Response | null> {
  if (shares.length === 0) return null;
  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
  if (!roster.ok) return unavailable(ctx.requestId);
  const outsiders = notInGroup(roster.members, shares.map((s) => s.subjectId));
  if (outsiders.length === 0) return null;
  return unprocessable(ctx.requestId, "Everyone who had some must be in the group", KITCHEN_ERROR_REASONS.NOT_IN_GROUP, {
    subjectIds: outsiders,
  });
}

/** A refused split write. */
function refused(ctx: RequestContext, error: KitchenDishError, doing: string): Response {
  if (error.kind === "stale" || error.kind === "conflict") {
    return conflict(ctx.requestId, "The dish kept changing while this was written; read it again and retry", KITCHEN_ERROR_REASONS.STALE);
  }
  if (error.kind === "invalid") return splitErrorResponse(ctx.requestId, new Error(error.reason));
  return dishErrorResponse(ctx.requestId, error, doing);
}

/** The shares body of `…/shares` and `…/correct`, and the correction's note. */
function parseSharesBody(body: Record<string, unknown>, withNote: boolean): { ok: true; shares: ParsedShare[]; note: string | null } | { ok: false; fields: Fields } {
  const fields = new Fields();
  const shares = parseShares(fields, body.shares);
  const note = withNote ? text(fields, "note", body.note, 500, true) : null;
  if (!fields.ok || shares === undefined || note === undefined) return { ok: false, fields };
  return { ok: true, shares, note };
}

// ── Claims ─────────────────────────────────────────────────

export async function handleClaimDish(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.dish.claim");
  if (denied) return denied;
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const portionsHalf = portionsHalfOf(fields, "portionsHalf", body.portionsHalf, 0);
  if (portionsHalf === undefined) return validationError(ctx.requestId, fields.errors);

  return withKitchenRepo(ctx, async (repo) => {
    const read = await groupDish(ctx, repo, dishId);
    if (!read.ok) return read.response;
    const dish = read.dish;
    // Claims are made on an open dish; an assigned one (a draft) is the cook's to split.
    if (dish.state !== "open") return dishErrorResponse(ctx.requestId, { kind: "dish_not_open", state: dish.state }, "claimed");

    const result = await ctx.timings.measure("db", () =>
      repo.claimDish({
        dishId,
        subjectId: ctx.actor.subjectId,
        portionsHalf,
        shareId: asUuid(crypto.randomUUID()),
        now: ctx.now(),
      }),
    );
    return result.ok ? dishResponse(ctx, result.value) : refused(ctx, result.error, "claimed");
  });
}

// ── The cook's assignment ──────────────────────────────────

export async function handleSetDishShares(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.dish.finalize");
  if (denied) return denied;
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseSharesBody(body, false);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields.errors);

  return withKitchenRepo(ctx, async (repo) => {
    const read = await groupDish(ctx, repo, dishId);
    if (!read.ok) return read.response;
    const dish = read.dish;
    const notTheirs = await cookOrAdmin(ctx, dish, "split");
    if (notTheirs) return notTheirs;
    if (dish.state !== "draft" && dish.state !== "open") {
      return dishErrorResponse(ctx.requestId, { kind: "dish_not_open", state: dish.state }, "split again (correct it instead)");
    }
    const outsiders = await eatersInGroup(ctx, parsed.shares);
    if (outsiders) return outsiders;
    const misfit = sharesMisfit(ctx.requestId, dish, parsed.shares);
    if (misfit) return misfit;

    const result = await ctx.timings.measure("db", () =>
      repo.setDishShares({ dish, shares: newShares(parsed.shares), now: ctx.now() }),
    );
    return result.ok ? dishResponse(ctx, result.value) : refused(ctx, result.error, "split again");
  });
}

// ── Planning finalize and correct ──────────────────────────

/** The longest ledger title a dish transaction gets. */
const MAX_TITLE = 200;

/** The dish's id without its prefix: what its ledger keys are built from. */
function dishHex(dish: KitchenDishRecord): string {
  return toPublicId("dsh", dish.id).slice(4);
}

/** The dish transaction: the cook paid the total, every eater owes their share. None for a dish that cost nothing. */
function dishTxn(
  ctx: RequestContext,
  dish: KitchenDishRecord,
  split: DishSplit,
  idemKey: string,
  now: Date,
): { txn: NewKitchenTxn; splits: KitchenSplit[] } | null {
  if (!dish.orgId || dish.totalMinor === 0) return null;
  const actor = ctx.actor.subjectId;
  return {
    txn: {
      id: asUuid(crypto.randomUUID()),
      orgId: dish.orgId as Uuid,
      kind: "dish",
      title: dish.name.length > MAX_TITLE ? `${dish.name.slice(0, MAX_TITLE - 1)}…` : dish.name,
      totalMinor: dish.totalMinor,
      currency: dish.currency,
      occurredAt: now,
      createdBy: actor,
      sourceKind: "dish",
      sourceId: dish.id,
      idemKey,
      now,
    },
    splits: split.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.paidMinor, owedMinor: s.owedMinor })),
  };
}

/** The leftovers: the unclaimed portions, in the cook's own pantry, priced at what they cost the cook. */
function leftoversItem(ctx: RequestContext, dish: KitchenDishRecord, split: DishSplit, idemKey: string, now: Date): NewKitchenItem {
  const actor = ctx.actor.subjectId;
  return {
    id: asUuid(crypto.randomUUID()),
    owner: { kind: "user", subjectId: dish.cook },
    name: leftoversName(dish.name),
    category: LEFTOVERS_CATEGORY,
    dimension: "count",
    displayUnit: LEFTOVERS_UNIT,
    qtyMilli: split.unclaimedHalf * HALF_PORTION_MILLI,
    priceMinor: split.unclaimedMinor,
    currency: dish.currency,
    paidBy: dish.cook,
    boughtOn: isoDay(now),
    expiresOn: null,
    wastePolicy: null,
    createdBy: actor,
    idemKey,
    now,
    sourceDishId: dish.id,
  };
}

/** What the dish's audit events say about its split. */
function splitPayload(dish: KitchenDishRecord, split: DishSplit): Record<string, unknown> {
  return {
    dishId: toPublicId("dsh", dish.id),
    name: dish.name,
    cook: dish.cook,
    totalMinor: dish.totalMinor,
    currency: dish.currency,
    portionsHalf: dish.portionsHalf,
    unclaimedHalf: split.unclaimedHalf,
    amounts: split.amounts.map((a) => ({ subjectId: a.subjectId, owedMinor: a.owedMinor })),
  };
}

function describeSplit(dish: KitchenDishRecord, split: DishSplit): string {
  return split.amounts.map((a) => `${a.subjectId} ${formatMinor(a.owedMinor, dish.currency)}`).join(", ");
}

/**
 * Finalizing a draft or open dish: the dish transaction in its group, the
 * leftovers item when portions went unclaimed, the audit event. A dish for
 * just its cook has nothing to split: it is only marked finalized.
 */
function planFinalize(ctx: RequestContext, dish: KitchenDishRecord, idemKey: string): FinalizeDishInput | Response {
  const now = ctx.now();
  if (!dish.orgId) return { dish, txn: null, leftover: null, now, audits: [] };
  let split: DishSplit;
  try {
    split = splitDish(dish, inSplitOrder(dish.cook, dish.shares));
  } catch (err) {
    return splitErrorResponse(ctx.requestId, err);
  }
  const hex = dishHex(dish);
  // One dish transaction and one leftovers item per finalize: fixed keys, so a race posts neither twice.
  const txn = dishTxn(ctx, dish, split, `dish_${hex}_finalize`, now);
  const leftover = split.unclaimedHalf > 0 ? leftoversItem(ctx, dish, split, `dish_${hex}_leftovers`, now) : null;
  const audits = dishAudits(ctx, {
    type: "kitchen.dish.finalized",
    dishId: dish.id,
    idemKey,
    sharedWith: dish.orgId,
    sourceGroups: [],
    describe: () => ({
      description:
        `Dish ${toPublicId("dsh", dish.id)} "${dish.name}" finalized by ${ctx.actor.subjectId}: ${describeSplit(dish, split)}` +
        (leftover ? `; ${split.unclaimedHalf / 2} portions left over for the cook` : ""),
      payload: {
        ...splitPayload(dish, split),
        txnId: txn ? toPublicId("txn", txn.txn.id) : null,
        leftoverItemId: leftover ? toPublicId("itm", leftover.id) : null,
      },
    }),
  });
  return { dish, txn, leftover, now, audits };
}

/**
 * Correcting a finalized dish with `shares`: the reversal of its dish
 * transaction, a new one, the shares replaced, and its leftovers adjusted —
 * while the cook has not touched them (eaten some, wasted, moved or removed
 * them), which leaves them as they are.
 */
async function planCorrect(
  ctx: RequestContext,
  repo: KitchenRepository,
  dish: KitchenDishRecord,
  input: { shares: readonly ParsedShare[]; note: string | null; idemKey: string },
): Promise<CorrectDishInput | Response> {
  const now = ctx.now();
  const actor = ctx.actor.subjectId;
  const shares = newShares(input.shares);
  let split: DishSplit;
  try {
    split = splitDish(dish, inSplitOrder(dish.cook, shares.map((s, position) => ({ ...s, position }))));
  } catch (err) {
    return splitErrorResponse(ctx.requestId, err);
  }
  const hex = dishHex(dish);
  // Keys from the request's: a retried correction finds the transaction it posted, and writes nothing.
  const key = `dish_${hex}_correct_${input.idemKey}`;

  let reversal: CorrectDishInput["reversal"] = null;
  if (dish.txnId && dish.orgId) {
    const found = await ctx.timings.measure("db", () => repo.getTxn(dish.orgId as Uuid, dish.txnId as Uuid));
    if (!found.ok) return unavailable(ctx.requestId);
    const original = found.value;
    reversal = {
      original,
      id: asUuid(crypto.randomUUID()),
      title: `Reversal: ${original.title}`,
      createdBy: actor,
      note: input.note ?? "The dish was corrected",
      idemKey: `${key}_reversal`,
      splits: reverseSplits(original.splits),
    };
  }
  const txn = dishTxn(ctx, dish, split, key, now);

  let leftover: DishLeftoverChange = { kind: "keep" };
  const wanted = split.unclaimedHalf * HALF_PORTION_MILLI;
  if (dish.leftoverItemId) {
    const found = await ctx.timings.measure("db", () =>
      repo.getItem({ kind: "user", subjectId: dish.cook }, dish.leftoverItemId as Uuid),
    );
    if (!found.ok && found.error.kind !== "not_found") return unavailable(ctx.requestId);
    const item = found.ok ? found.value : null;
    // "Untouched" is what an item edit calls unused: nothing taken, nothing charged.
    if (item && item.state === "active" && item.qtyLeftMilli === item.qtyBoughtMilli && item.costTakenMinor === 0) {
      if (wanted === 0) leftover = { kind: "remove", itemId: item.id, expectedVersion: item.version };
      else if (item.qtyBoughtMilli !== wanted || item.priceMinor !== split.unclaimedMinor) {
        leftover = { kind: "update", itemId: item.id, expectedVersion: item.version, qtyMilli: wanted, priceMinor: split.unclaimedMinor };
      }
    }
  } else if (wanted > 0) {
    leftover = { kind: "create", item: leftoversItem(ctx, dish, split, `dish_${hex}_leftovers_v${dish.version}`, now) };
  }
  const leftoverItemId =
    leftover.kind === "create" ? leftover.item.id : leftover.kind === "remove" ? null : dish.leftoverItemId;

  const audits = dishAudits(ctx, {
    type: "kitchen.dish.corrected",
    dishId: dish.id,
    idemKey: input.idemKey,
    sharedWith: dish.orgId,
    sourceGroups: [],
    describe: () => ({
      description: `Dish ${toPublicId("dsh", dish.id)} "${dish.name}" corrected by ${actor}: ${describeSplit(dish, split)}`,
      payload: {
        ...splitPayload(dish, split),
        reversalId: reversal ? toPublicId("txn", reversal.id) : null,
        reverses: reversal ? toPublicId("txn", reversal.original.id) : null,
        txnId: txn ? toPublicId("txn", txn.txn.id) : null,
        leftoverItemId: leftoverItemId ? toPublicId("itm", leftoverItemId) : null,
        note: input.note,
      },
    }),
  });
  return { dish, reversal, txn, leftover, shares, now, audits };
}

// ── Finalize ───────────────────────────────────────────────

/**
 * Finalize `dish` (read through `scope`): answered as it is once finalized,
 * refused once canceled, else planned and written — once more from a fresh
 * read if a claim or assignment landed in between.
 */
async function finalize(
  ctx: RequestContext,
  repo: KitchenRepository,
  first: KitchenDishRecord,
  scope: KitchenDishScope,
  idemKey: string,
): Promise<Response> {
  let dish = first;
  for (let attempt = 0; ; attempt += 1) {
    if (dish.state === "finalized") return dishResponse(ctx, dish);
    if (dish.state === "canceled") return dishErrorResponse(ctx.requestId, { kind: "dish_not_open", state: dish.state }, "finalized");
    const plan = planFinalize(ctx, dish, idemKey);
    if (plan instanceof Response) return plan;
    const result = await ctx.timings.measure("db", () => repo.finalizeDish(plan));
    if (result.ok) return dishResponse(ctx, result.value.dish);
    if (result.error.kind !== "stale" || attempt > 0) return refused(ctx, result.error, "finalized");
    const fresh = await ctx.timings.measure("db", () => repo.getDish(dish.id as Uuid, scope));
    if (!fresh.ok) return fresh.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    dish = fresh.value;
  }
}

export async function handleFinalizeDish(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.dish.finalize");
  if (denied) return denied;
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;

  return withKitchenRepo(ctx, async (repo) => {
    const read = await groupDish(ctx, repo, dishId);
    if (!read.ok) return read.response;
    const notTheirs = await cookOrAdmin(ctx, read.dish, "finalize");
    if (notTheirs) return notTheirs;
    return finalize(ctx, repo, read.dish, inGroup(ctx), idem.key);
  });
}

/** POST /v1/kitchen/me/dishes/{dsh}/finalize — the cook's own route, for a dish shared or not. */
export async function handleFinalizeMyDish(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const scope = readable(ctx, groups);

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getDish(dishId, scope));
    if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    const dish = found.value;
    if (dish.cook !== ctx.actor.subjectId) {
      return forbidden(ctx.requestId, "Only whoever cooked a dish can finalize it here", KITCHEN_ERROR_REASONS.NOT_CREATOR);
    }
    if (dish.orgId) {
      // Shared with a group: finalizing it there is cooking's own grant.
      const orgId = dish.orgId as Uuid;
      const denied = await ctx.timings.measure("authz", () =>
        requireOrgAction(ctx.env, ctx.requestId, ctx.actor, orgId, "kitchen.dish.finalize"),
      );
      if (denied) return denied;
    }
    return finalize(ctx, repo, dish, scope, idem.key);
  });
}

// ── Correct ────────────────────────────────────────────────

export async function handleCorrectDish(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.dish.finalize");
  if (denied) return denied;
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseSharesBody(body, true);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields.errors);

  return withKitchenRepo(ctx, async (repo) => {
    const read = await groupDish(ctx, repo, dishId);
    if (!read.ok) return read.response;
    let dish = read.dish;
    const notTheirs = await cookOrAdmin(ctx, dish, "correct");
    if (notTheirs) return notTheirs;
    const outsiders = await eatersInGroup(ctx, parsed.shares);
    if (outsiders) return outsiders;
    const misfit = sharesMisfit(ctx.requestId, dish, parsed.shares);
    if (misfit) return misfit;

    for (let attempt = 0; ; attempt += 1) {
      // Until it is finalized, its shares are changed directly (…/shares, …/claims/me).
      if (dish.state !== "finalized") {
        return dishErrorResponse(ctx.requestId, { kind: "dish_not_open", state: dish.state }, "corrected until it is finalized");
      }
      const plan = await planCorrect(ctx, repo, dish, { shares: parsed.shares, note: parsed.note, idemKey: idem.key });
      if (plan instanceof Response) return plan;
      const result = await ctx.timings.measure("db", () => repo.correctDish(plan));
      if (result.ok) return dishResponse(ctx, result.value.dish);
      if (result.error.kind !== "stale" || attempt > 0) return refused(ctx, result.error, "corrected until it is finalized");
      const fresh = await groupDish(ctx, repo, dishId);
      if (!fresh.ok) return fresh.response;
      dish = fresh.dish;
    }
  });
}
