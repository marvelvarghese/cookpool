import {
  DISH_SPLIT_MODES,
  KITCHEN_DISH_SPLIT_EVENT,
  KITCHEN_ERROR_REASONS,
  KITCHEN_SPLIT_ERROR_REASONS,
  type SplitReminderDismissResponse,
} from "@saas/contracts/kitchen";
import type { Uuid } from "@saas/db/ids";
import type { KitchenDishRecord, KitchenRepository } from "@saas/db/kitchen";
import { formatMinor } from "@saas/kitchen-engine/money";
import { requireOrgAction } from "../authz.js";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { dishErrorResponse } from "../dishes.js";
import { emailDishPosted } from "../emails.js";
import { conflict, notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parseOrgPublicId, parsePublicId, toPublicId } from "../ids.js";
import { ledgerAudit } from "../ledger.js";
import { Fields, oneOf } from "../validate.js";
import { dishResponse, myGroups } from "./dishes.js";

// Cooked, then split later (Cookpool CM-8, cookpool-community design §2a):
//
//   POST /v1/kitchen/me/dishes/{dsh}/split                   its cook: { orgId, splitMode? } → { dish }
//   POST /v1/kitchen/me/dishes/{dsh}/split-reminder/dismiss  its cook: Home stops reminding
//   POST /v1/kitchen/me/dishes/{dsh}/split-reminder/restore  its cook: the dismissal's Undo
//
// Splitting moves the cook's own dish (no group) into one group they cook in
// — `kitchen.dish.cook` there, the grant cooking into it takes — exactly as a
// dish cooked into that group would stand: open for claims (default), or a
// draft for the cook's shares. One write (the dish row, the group's currency
// pinned to the dish's, the `kitchen.dish.split` audit event in that group);
// no money moves, and the dish's total is what it was at cook time. The
// group's members are told as a dish cooked for claims tells them (CP-18).
// From then on the group's claim, shares, finalize and correct routes take it
// as any dish of theirs. Anyone else's dish is the opaque 404, as is a group
// the cook isn't in or may not cook in.

/** The cook's own dishes only: someone else's reads as one that does not exist. */
async function ownDish(ctx: RequestContext, repo: KitchenRepository, dishId: Uuid): Promise<KitchenDishRecord | Response> {
  const found = await ctx.timings.measure("db", () => repo.getDish(dishId, { cook: ctx.actor.subjectId, orgIds: [] }));
  if (found.ok) return found.value.cook === ctx.actor.subjectId ? found.value : notFound(ctx.requestId);
  return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
}

function alreadySplit(ctx: RequestContext, dish: KitchenDishRecord): Response {
  return conflict(ctx.requestId, "This dish is in a group already", KITCHEN_SPLIT_ERROR_REASONS.ALREADY_SPLIT, {
    orgId: dish.orgId ? toPublicId("org", dish.orgId) : null,
  });
}

export async function handleSplitMyDish(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const orgId = typeof body.orgId === "string" ? parseOrgPublicId(body.orgId) : null;
  if (!orgId) fields.add("orgId", "Must be a group's org_ id");
  const splitMode = body.splitMode === undefined || body.splitMode === null ? "claims" : oneOf(fields, "splitMode", body.splitMode, DISH_SPLIT_MODES);
  if (!fields.ok || !orgId || !splitMode) return validationError(ctx.requestId, fields.errors);

  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const group = groups.find((g) => g.orgId === orgId);

  return withKitchenRepo(ctx, async (repo) => {
    const read = await ownDish(ctx, repo, dishId);
    if (read instanceof Response) return read;
    let dish = read;
    if (dish.state === "canceled") return dishErrorResponse(ctx.requestId, { kind: "dish_not_open", state: dish.state }, "split");
    if (dish.orgId) return alreadySplit(ctx, dish);

    // A group the cook isn't in, or may not cook in: the opaque 404, as cooking into it would be.
    if (!group) return notFound(ctx.requestId);
    const denied = await ctx.timings.measure("authz", () =>
      requireOrgAction(ctx.env, ctx.requestId, ctx.actor, orgId, "kitchen.dish.cook"),
    );
    if (denied) return denied;
    const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(orgId));
    if (!settings.ok) return unavailable(ctx.requestId);
    if (settings.value && settings.value.currency !== dish.currency) {
      return unprocessable(
        ctx.requestId,
        `${group.name} counts in ${settings.value.currency}; this dish is in ${dish.currency}`,
        KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH,
        { currency: settings.value.currency },
      );
    }

    for (let attempt = 0; ; attempt += 1) {
      const audit = ledgerAudit(
        { ...ctx, orgId },
        {
          type: KITCHEN_DISH_SPLIT_EVENT,
          subjectKind: "kitchen_dish",
          subjectId: dish.id,
          idemKey: idem.key,
          description:
            `Dish ${toPublicId("dsh", dish.id)} "${dish.name}" cooked by ${dish.cook} on ${dish.cookedAt.toISOString()} ` +
            `split with the group: ${formatMinor(dish.totalMinor, dish.currency)} for ${dish.portionsHalf / 2} portions`,
          payload: {
            dishId: toPublicId("dsh", dish.id),
            name: dish.name,
            cook: dish.cook,
            shared: true,
            portionsHalf: dish.portionsHalf,
            splitMode,
            totalMinor: dish.totalMinor,
            currency: dish.currency,
            cookedAt: dish.cookedAt.toISOString(),
          },
        },
      );
      const result = await ctx.timings.measure("db", () =>
        repo.splitDishLater({ dish, orgId, splitMode, now: ctx.now(), audit }),
      );
      if (result.ok) {
        // Committed: a dish now open for claims tells the group, as cooking it there would (CP-18).
        const split = result.value;
        await ctx.defer(() => emailDishPosted(ctx, split));
        return dishResponse(ctx, split);
      }
      const error = result.error;
      if (error.kind === "conflict") {
        const now = await ctx.timings.measure("db", () => repo.getDish(dish.id as Uuid, { cook: ctx.actor.subjectId, orgIds: [] }));
        return now.ok ? alreadySplit(ctx, now.value) : alreadySplit(ctx, dish);
      }
      if (error.kind === "stale" && attempt === 0) {
        // Finalized (as just the cook's) in between: read it again and split that.
        const fresh = await ownDish(ctx, repo, dishId);
        if (fresh instanceof Response) return fresh;
        if (fresh.state === "canceled") return dishErrorResponse(ctx.requestId, { kind: "dish_not_open", state: fresh.state }, "split");
        if (fresh.orgId) return alreadySplit(ctx, fresh);
        dish = fresh;
        continue;
      }
      if (error.kind === "stale") {
        return conflict(ctx.requestId, "The dish kept changing while it was split; read it again", KITCHEN_ERROR_REASONS.STALE);
      }
      return dishErrorResponse(ctx.requestId, error, "split");
    }
  });
}

// ── Home's split reminder ──────────────────────────────────

async function setDismissed(ctx: RequestContext, params: readonly string[], dismiss: boolean): Promise<Response> {
  const dishId = parsePublicId("dsh", params[0]!);
  if (!dishId) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const result = await ctx.timings.measure("db", () =>
      repo.setSplitReminderDismissed(ctx.actor.subjectId, dishId, dismiss ? ctx.now() : null),
    );
    if (!result.ok) return result.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    return successResponse<SplitReminderDismissResponse>(
      {
        dishId: toPublicId("dsh", dishId),
        dismissed: result.value.dismissedAt !== null,
        dismissedAt: result.value.dismissedAt?.toISOString() ?? null,
      },
      ctx.requestId,
    );
  });
}

/** POST …/split-reminder/dismiss — Home stops reminding the cook to split this dish. */
export function handleDismissSplitReminder(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return setDismissed(ctx, params, true);
}

/** POST …/split-reminder/restore — the dismissal's Undo. */
export function handleRestoreSplitReminder(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return setDismissed(ctx, params, false);
}
