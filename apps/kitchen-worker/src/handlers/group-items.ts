import { KITCHEN_ERROR_REASONS, type ItemsPage, type KitchenItem } from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import type { KitchenItemRecord, KitchenPantryOwner, KitchenRepository } from "@saas/db/kitchen";
import { formatMinor } from "@saas/kitchen-engine/money";
import { formatQuantity } from "@saas/kitchen-engine/units";
import { groupAllows, requireGroupAction } from "../authz.js";
import type { OrgContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import type { MemberGroup } from "../groups-client.js";
import {
  forbidden,
  notFound,
  readJsonObject,
  successResponse,
  unavailable,
  unprocessable,
  validationError,
} from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { groupCurrency, idempotencyKeyReused, ledgerAudit } from "../ledger.js";
import {
  encodeItemsCursor,
  expectedVersion,
  expiresFilter,
  groupPantryRef,
  isoDay,
  itemChanges,
  itemErrorResponse,
  parseItemEdit,
  parseItemsListParams,
  parseNewItem,
  resolveQuantity,
  todayOf,
  toKitchenItem,
  wastePolicyOf,
} from "../pantry.js";
import { notInGroup } from "../roster-client.js";
import { Fields } from "../validate.js";

// A group's pantry, /v1/organizations/{org}/kitchen/items…
//
//   GET    …/items             kitchen.pantry.read   (every member)
//   POST   …/items             kitchen.item.create   (members, owners, admins)
//   GET    …/items/{itm}       kitchen.pantry.read
//   PATCH  …/items/{itm}       kitchen.item.edit, and the buyer — or kitchen.item.manage (owner, admin)
//   DELETE …/items/{itm}       the same
//
// An item is in the group's currency; adding the group's first item fixes it
// (the ledger's first transaction does the same). Buying splits nothing: the
// add writes the item and `kitchen.item.added` in one batch, and no ledger
// transaction. A member who may edit items but did not buy this one gets a
// 403 `not_buyer`; anyone without the route's grant the opaque 404.

/** This group as the caller's membership sees it (its name and slug), for the item's pantry. */
async function thisGroup(ctx: OrgContext): Promise<{ ok: true; group: MemberGroup } | { ok: false; response: Response }> {
  const groups = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  if (!groups.ok) return { ok: false, response: unavailable(ctx.requestId) };
  const group = groups.groups.find((g) => g.orgId === ctx.orgId);
  // Authorized a moment ago, gone now: they left in between.
  return group ? { ok: true, group } : { ok: false, response: notFound(ctx.requestId) };
}

function owner(ctx: OrgContext): KitchenPantryOwner {
  return { kind: "group", orgId: ctx.orgId };
}

/** The group's items as the API shows them, with its waste rule read once. */
async function present(
  ctx: OrgContext,
  repo: KitchenRepository,
  group: MemberGroup,
  records: readonly KitchenItemRecord[],
): Promise<KitchenItem[] | null> {
  const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(ctx.orgId));
  if (!settings.ok) return null;
  const pantry = groupPantryRef(group);
  const today = isoDay(ctx.now());
  return records.map((r) => toKitchenItem(r, pantry, wastePolicyOf(settings.value), today));
}

async function itemResponse(
  ctx: OrgContext,
  repo: KitchenRepository,
  group: MemberGroup,
  record: KitchenItemRecord,
  status = 200,
): Promise<Response> {
  const items = await present(ctx, repo, group, [record]);
  return items ? successResponse({ item: items[0]! }, ctx.requestId, status) : unavailable(ctx.requestId);
}

export async function handleListGroupItems(ctx: OrgContext, request: Request): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
  if (denied) return denied;

  const fields = new Fields();
  const params = parseItemsListParams(fields, new URL(request.url));
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const page = await ctx.timings.measure("db", () =>
      repo.listItems({
        ownerSubjectId: null,
        orgIds: [ctx.orgId],
        q: params.q,
        expires: expiresFilter(params.filter, todayOf(ctx.now())),
        cursor: params.cursor,
        limit: params.limit,
      }),
    );
    if (!page.ok) return unavailable(ctx.requestId);
    const items = await present(ctx, repo, here.group, page.value.items);
    if (!items) return unavailable(ctx.requestId);
    const nextCursor = page.value.nextCursor ? encodeItemsCursor(page.value.nextCursor) : null;
    return successResponse<ItemsPage>({ items, nextCursor }, ctx.requestId, 200, nextCursor);
  });
}

export async function handleCreateGroupItem(ctx: OrgContext, request: Request): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.item.create");
  if (denied) return denied;

  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseNewItem(body, { group: true });
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const input = parsed.value;

  const actor = ctx.actor.subjectId;
  const paidBy = input.paidBy ?? actor;
  if (paidBy !== actor) {
    const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
    if (!roster.ok) return unavailable(ctx.requestId);
    if (notInGroup(roster.members, [paidBy]).length > 0) {
      return unprocessable(ctx.requestId, "Whoever paid must be in the group", KITCHEN_ERROR_REASONS.NOT_IN_GROUP, {
        subjectIds: [paidBy],
      });
    }
  }
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const currency = await groupCurrency(repo, ctx);
    if (!currency) return unavailable(ctx.requestId);
    if (input.currency !== null && input.currency !== currency) {
      return unprocessable(ctx.requestId, `The group counts in ${currency}`, KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH, {
        currency,
      });
    }

    const id = asUuid(crypto.randomUUID());
    const now = ctx.now();
    const quantityText = formatQuantity(input.qtyMilli, input.dimension, input.displayUnit);
    const result = await ctx.timings.measure("db", () =>
      repo.createItem({
        item: {
          id,
          owner: owner(ctx),
          name: input.name,
          category: input.category,
          dimension: input.dimension,
          displayUnit: input.displayUnit,
          qtyMilli: input.qtyMilli,
          priceMinor: input.priceMinor,
          currency,
          paidBy,
          boughtOn: input.boughtOn ?? isoDay(now),
          expiresOn: input.expiresOn,
          wastePolicy: input.wastePolicy,
          createdBy: actor,
          idemKey: idem.key,
          now,
        },
        audit: ledgerAudit(ctx, {
          type: "kitchen.item.added",
          subjectKind: "kitchen_item",
          subjectId: id,
          idemKey: idem.key,
          description: `Item ${toPublicId("itm", id)} "${input.name}": ${quantityText} for ${formatMinor(input.priceMinor, currency)}, paid by ${paidBy}`,
          payload: {
            itemId: toPublicId("itm", id),
            name: input.name,
            category: input.category,
            qtyMilli: input.qtyMilli,
            displayUnit: input.displayUnit,
            priceMinor: input.priceMinor,
            currency,
            paidBy,
          },
        }),
      }),
    );
    if (!result.ok) return itemErrorResponse(ctx.requestId, result.error);
    const { item, replayed } = result.value;
    if (replayed && item.createdBy !== actor) return idempotencyKeyReused(ctx.requestId);
    return itemResponse(ctx, repo, here.group, item, 201);
  });
}

export async function handleGetGroupItem(ctx: OrgContext, _request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
  if (denied) return denied;
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getItem(owner(ctx), itemId));
    if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
    return itemResponse(ctx, repo, here.group, found.value);
  });
}

/** May the caller change this item? Its buyer may, and so may whoever holds kitchen.item.manage. */
async function mayChange(ctx: OrgContext, item: KitchenItemRecord): Promise<Response | null> {
  if (item.paidBy === ctx.actor.subjectId || (await groupAllows(ctx, "kitchen.item.manage"))) return null;
  return forbidden(
    ctx.requestId,
    "Only whoever bought an item, or an owner or admin, can change or remove it",
    KITCHEN_ERROR_REASONS.NOT_BUYER,
  );
}

export async function handleUpdateGroupItem(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.item.edit");
  if (denied) return denied;
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);

  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseItemEdit(body, { group: true });
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const edit = parsed.value;
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getItem(owner(ctx), itemId));
    if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
    const refused = await mayChange(ctx, found.value);
    if (refused) return refused;
    const quantity = resolveQuantity(edit, found.value);
    if (!quantity.ok) return validationError(ctx.requestId, quantity.fields);

    const updated = await ctx.timings.measure("db", () =>
      repo.updateItem({
        owner: owner(ctx),
        itemId,
        changes: itemChanges(edit, quantity.value),
        ...expectedVersion(edit),
        now: ctx.now(),
      }),
    );
    if (!updated.ok) return itemErrorResponse(ctx.requestId, updated.error);
    return itemResponse(ctx, repo, here.group, updated.value);
  });
}

export async function handleRemoveGroupItem(ctx: OrgContext, _request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.item.edit");
  if (denied) return denied;
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getItem(owner(ctx), itemId));
    if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
    const refused = await mayChange(ctx, found.value);
    if (refused) return refused;

    const removed = await ctx.timings.measure("db", () => repo.removeItem(owner(ctx), itemId, ctx.now()));
    if (!removed.ok) return itemErrorResponse(ctx.requestId, removed.error);
    return itemResponse(ctx, repo, here.group, removed.value);
  });
}
