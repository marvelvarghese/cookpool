import {
  KITCHEN_CHECK_ERROR_REASONS,
  STOCK_CHECK_GONE,
  type StockCheckGone,
} from "@saas/contracts/kitchen";
import { asUuid, type Uuid } from "@saas/db/ids";
import type { AdjustStockInput, KitchenItemRecord, KitchenPantryOwner } from "@saas/db/kitchen";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import { formatQuantity, isUnit, UNITS, type UnitKey } from "@saas/kitchen-engine/units";
import { requireGroupAction } from "../authz.js";
import type { OrgContext, RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { notFound, readJsonObject, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { ledgerAudit } from "../ledger.js";
import { quantityOf, takeStock, type StockWrite } from "../stock.js";
import { Fields, type FieldErrors } from "../validate.js";
import { thisGroup } from "./group-items.js";
import { moved as movedMine, planPersonalUse, planPersonalWaste } from "./my-uses.js";
import { emailUse, moved as movedInGroup, planGroupUse, planGroupWaste } from "./uses.js";

// The stock check (PN-4, cookpool-pantry design §7): set what is really left
// of an item, and say where the difference went.
//
//   POST /v1/kitchen/me/items/{itm}/check                   the caller's own item (keyed by subject, as every personal write)
//   POST /v1/organizations/{org}/kitchen/items/{itm}/check  kitchen.item.use — whoever may use the item may check it
//
//   { left: { quantity, unit? }, gone?: "me" | "split" | "waste" }
//
// Less than is left writes exactly what …/uses or …/waste would have written
// for the difference — the same planners (uses.ts, my-uses.ts), so the move,
// its cost, the transaction, the audit event, the email and the Undo are
// theirs: `me` is a use by the caller, `split` a use with every current
// member as a consumer in equal shares (group items only), `waste` waste
// under the item's rule. More than is left is an `adjust` move raising the
// level by the difference: no money, no transaction, and a used-up or wasted
// item is active again. Every move a check writes says `via: check`.
//
// The level is read against the item as it is when the check writes (one
// retry when it moved on, as every stock write): a check says how much is
// there, so a use landing first only shrinks the difference.

function personal(ctx: RequestContext): KitchenPantryOwner {
  return { kind: "user", subjectId: ctx.actor.subjectId };
}

function group(ctx: OrgContext): KitchenPantryOwner {
  return { kind: "group", orgId: ctx.orgId };
}

// ── The request ────────────────────────────────────────────

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

export interface ParsedCheck {
  /** What is left, as given: a decimal (0 for empty) and a unit (null: the item's own). */
  left: { quantity: string | number; unit: UnitKey | null };
  /** Where the difference went, when less is left; null when not given. */
  gone: StockCheckGone | null;
}

/** A POST …/check body. `split` is a group item's only. */
export function parseCheck(body: Record<string, unknown>, options: { group: boolean }): Parsed<ParsedCheck> {
  const fields = new Fields();
  let quantity: string | number | null = null;
  let unit: UnitKey | null = null;
  const left = body.left;
  if (left === null || typeof left !== "object" || Array.isArray(left)) {
    fields.add("left", 'Say what is left: { "quantity": "0.75", "unit": "L" }');
  } else {
    const level = left as Record<string, unknown>;
    if (typeof level.quantity === "string" || typeof level.quantity === "number") quantity = level.quantity;
    else fields.add("left.quantity", level.quantity === undefined ? "Required" : 'Must be a decimal such as "0.75"');
    if (level.unit !== undefined && level.unit !== null) {
      if (isUnit(level.unit)) unit = level.unit;
      else fields.add("left.unit", `Must be one of: ${Object.keys(UNITS).join(", ")}`);
    }
    // A level is a quantity in a unit: a measure ("2 onions") would be read as the item's unit.
    if (level.measure !== undefined && level.measure !== null) fields.add("left.measure", "Say the level in a unit");
  }
  let gone: StockCheckGone | null = null;
  if (body.gone !== undefined && body.gone !== null) {
    const allowed: readonly string[] = options.group ? STOCK_CHECK_GONE : STOCK_CHECK_GONE.filter((g) => g !== "split");
    if (typeof body.gone === "string" && allowed.includes(body.gone)) gone = body.gone as StockCheckGone;
    else if (body.gone === "split") fields.add("gone", "A personal item is yours alone: say me or waste");
    else fields.add("gone", `Must be one of: ${allowed.join(", ")}`);
  }
  if (!fields.ok || quantity === null) return { ok: false, fields: fields.errors };
  return { ok: true, value: { left: { quantity, unit }, gone } };
}

const ZERO_RE = /^0+(?:\.0+)?$/;

/** The level in thousandths of the item's base unit (0 for empty), in a unit of its dimension. */
function levelOf(item: KitchenItemRecord, left: ParsedCheck["left"]): Parsed<{ qtyMilli: number; unit: string }> {
  const empty = typeof left.quantity === "number" ? left.quantity === 0 : ZERO_RE.test(left.quantity.trim());
  // quantityOf reads only quantities above zero; an empty level still checks its unit.
  const read = quantityOf(item, empty ? "1" : left.quantity, left.unit);
  if (!read.ok) {
    const errors: FieldErrors = {};
    if (read.fields.unit) errors["left.unit"] = read.fields.unit;
    if (read.fields.quantity) errors["left.quantity"] = ['Must be what is left, 0 or more, such as "0.75"'];
    return { ok: false, fields: errors };
  }
  return { ok: true, value: empty ? { qtyMilli: 0, unit: read.value.unit } : read.value };
}

// ── The difference ─────────────────────────────────────────

/** What a check writes for `item`: take the difference (less is left) or raise by it (more). */
type Difference =
  | { kind: "less"; qtyMilli: number; unit: string; gone: StockCheckGone; levelMilli: number }
  | { kind: "more"; qtyMilli: number; unit: string; levelMilli: number };

/**
 * The difference the level makes to `item`, or the refusal (422, nothing
 * written): above what was bought (`more_than_bought`), what is left already
 * (`unchanged`), or less without saying where the rest went (field `gone`).
 */
function differenceOf(requestId: string, item: KitchenItemRecord, check: ParsedCheck): Difference | Response {
  const level = levelOf(item, check.left);
  if (!level.ok) return validationError(requestId, level.fields);
  const { qtyMilli: levelMilli, unit } = level.value;
  if (levelMilli > item.qtyBoughtMilli) {
    return unprocessable(requestId, "That is more than was bought", KITCHEN_CHECK_ERROR_REASONS.MORE_THAN_BOUGHT, {
      qtyBoughtMilli: item.qtyBoughtMilli,
    });
  }
  if (levelMilli === item.qtyLeftMilli) {
    return unprocessable(requestId, "That is what is left already: nothing to fix", KITCHEN_CHECK_ERROR_REASONS.UNCHANGED, {
      qtyLeftMilli: item.qtyLeftMilli,
    });
  }
  if (levelMilli > item.qtyLeftMilli) return { kind: "more", qtyMilli: levelMilli - item.qtyLeftMilli, unit, levelMilli };
  if (!check.gone) return validationError(requestId, { gone: ["Say where the rest went: me, split or waste"] });
  return { kind: "less", qtyMilli: item.qtyLeftMilli - levelMilli, unit, gone: check.gone, levelMilli };
}

/**
 * The `adjust` raising `item` to the level: it costs nothing and posts no
 * transaction (the database refuses above what was bought, and wakes a
 * finished item).
 */
function planAdjust(
  ctx: RequestContext,
  owner: KitchenPantryOwner,
  item: KitchenItemRecord,
  more: Extract<Difference, { kind: "more" }>,
  idemKey: string,
  audit?: (moveId: Uuid) => AppendEventWithAuditInput,
): AdjustStockInput {
  const id = asUuid(crypto.randomUUID());
  return {
    owner,
    itemId: item.id as Uuid,
    expectedVersion: item.version,
    move: { id, kind: "adjust", qtyMilli: more.qtyMilli, unit: more.unit, via: "check", actor: ctx.actor.subjectId, idemKey, now: ctx.now() },
    ...(audit ? { audit: audit(id) } : {}),
  };
}

/**
 * PN-8's seam (ask before use, design §8.2): on an ask-first item, the
 * check's `me` and `split` are the buyer's and admins' only — anyone else is
 * refused here with `details.reason: "ask_first"`, before anything is
 * planned. Until PN-8 adds ask-first items, whoever may use an item may
 * check it.
 */
function groupCheckRefusal(_ctx: OrgContext, _item: KitchenItemRecord, _gone: StockCheckGone | null): Response | null {
  return null;
}

// ── The routes ─────────────────────────────────────────────

export async function handleCheckMyItem(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseCheck(body, { group: false });
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const check = parsed.value;

  return withKitchenRepo(ctx, async (repo) => {
    const result = await takeStock(
      ctx,
      repo,
      { owner: personal(ctx), itemId, kind: "check", idemKey: idem.key },
      async (item): Promise<StockWrite | Response> => {
        const diff = differenceOf(ctx.requestId, item, check);
        if (diff instanceof Response) return diff;
        if (diff.kind === "more") return planAdjust(ctx, personal(ctx), item, diff, idem.key);
        const take = { qtyMilli: diff.qtyMilli, unit: diff.unit, idemKey: idem.key, via: "check" as const };
        // A personal item's difference is the owner's: theirs, or wasted (parseCheck refused split).
        return diff.gone === "waste" ? planPersonalWaste(ctx, item, take) : planPersonalUse(ctx, item, { ...take, label: null });
      },
    );
    return result instanceof Response ? result : movedMine(ctx, repo, result);
  });
}

export async function handleCheckGroupItem(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  // The same grant as using it: members, owners and admins, not viewers.
  const denied = await requireGroupAction(ctx, "kitchen.item.use");
  if (denied) return denied;
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseCheck(body, { group: true });
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const check = parsed.value;
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(ctx.orgId));
    if (!settings.ok) return unavailable(ctx.requestId);
    const actor = ctx.actor.subjectId;

    const result = await takeStock(
      ctx,
      repo,
      { owner: group(ctx), itemId, kind: "check", idemKey: idem.key },
      async (item): Promise<StockWrite | Response> => {
        const diff = differenceOf(ctx.requestId, item, check);
        if (diff instanceof Response) return diff;
        const refused = groupCheckRefusal(ctx, item, diff.kind === "less" ? diff.gone : null);
        if (refused) return refused;

        if (diff.kind === "more") {
          return planAdjust(ctx, group(ctx), item, diff, idem.key, (moveId) => {
            const what = formatQuantity(diff.qtyMilli, item.dimension, diff.unit);
            return ledgerAudit(ctx, {
              type: "kitchen.item.adjusted",
              subjectKind: "kitchen_item",
              subjectId: item.id,
              idemKey: idem.key,
              description:
                `Stock check ${toPublicId("mov", moveId)} of item ${toPublicId("itm", item.id)} "${item.name}": ` +
                `${what} more than was logged, now ${formatQuantity(diff.levelMilli, item.dimension, diff.unit)}; no money moved`,
              payload: {
                itemId: toPublicId("itm", item.id),
                moveId: toPublicId("mov", moveId),
                qtyMilli: diff.qtyMilli,
                unit: diff.unit,
                qtyLeftMilli: diff.levelMilli,
                via: "check",
              },
            });
          });
        }

        const take = { qtyMilli: diff.qtyMilli, unit: diff.unit, idemKey: idem.key, via: "check" as const };
        switch (diff.gone) {
          case "me":
            return planGroupUse(ctx, item, { ...take, label: null, consumers: [actor] });
          case "split": {
            // Everyone in the group now, oldest first: equal shares, the odd paisa to the earliest.
            const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
            if (!roster.ok || roster.members.length === 0) return unavailable(ctx.requestId);
            return planGroupUse(ctx, item, { ...take, label: null, consumers: roster.members.map((m) => m.subjectId) });
          }
          case "waste":
            return planGroupWaste(ctx, item, take, settings.value);
        }
      },
    );
    if (result instanceof Response) return result;
    await emailUse(ctx, result, here.group);
    return movedInGroup(ctx, repo, here.group, settings.value, result);
  });
}
