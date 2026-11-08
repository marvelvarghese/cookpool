import {
  KITCHEN_ERROR_REASONS,
  type KitchenAction,
  type PurchaseResponse,
  type UndoPurchaseResponse,
} from "@saas/contracts/kitchen";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import { asUuid, type Uuid } from "@saas/db/ids";
import type { KitchenPantryOwner, NewKitchenItem } from "@saas/db/kitchen";
import { formatMinor } from "@saas/kitchen-engine/money";
import { formatQuantity } from "@saas/kitchen-engine/units";
import { requireOrgAction } from "../authz.js";
import type { OrgContext, RequestContext } from "../context.js";
import type { MemberGroup } from "../groups-client.js";
import { notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { idempotencyKeyReused, ledgerAudit } from "../ledger.js";
import { isoDay, itemErrorResponse } from "../pantry.js";
import { inheritedSettings, lineCurrency, parsePurchase, presentItems, type ParsedLine } from "../purchases.js";
import { withRestockRepos } from "../restock.js";

// Shopping runs (PN-3, cookpool-pantry design §6.3–§6.4):
//
//   POST   /v1/kitchen/me/purchases         self: 1–30 lines → 201 { purchaseId, items }
//   DELETE /v1/kitchen/me/purchases/{pur}   self: the Undo → 200 { purchaseId, removed, kept }
//
// One run, one payer: the caller, on every line. Each line keeps its own
// pantry and price. The caller must be able to add to every pantry — the
// same `kitchen.item.create` decision Add item asks the policy engine for,
// once per group — or nothing is written: one refusal refuses the run (422,
// each line out of reach named on `lines[i].pantry`, the same words whether
// the group does not exist, the caller is not in it, or may only read it).
// Then ONE db.batch writes every item under one purchase id, with each group
// item's `kitchen.item.added` audit event. Buying moves no money (CP-10).
//
// Retries: every item's key is the request's Idempotency-Key and its line
// (unique per pantry, as Add item's), so a retried run adds nothing and
// answers with the purchase it made — and a key someone else used is 409.
//
// The Undo removes the purchase's items still unused (nothing taken, nothing
// charged: the rule removing one item follows) in ONE statement, and answers
// with what was removed and what was kept. Only the purchaser can: anyone
// else, like an unknown id, reads the opaque 404. A group item is removed
// only while the caller may still change items there (`kitchen.item.edit`).

/** Joins the request's key and a line's position into that line's key: "·" never appears in a client's (printable ASCII) key. */
const LINE_KEY_SEPARATOR = "·";

/** The caller's groups by stored id; null when membership could not be read. */
async function myGroups(ctx: RequestContext): Promise<Map<string, MemberGroup> | null> {
  const result = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  return result.ok ? new Map(result.groups.map((g) => [g.orgId, g])) : null;
}

/**
 * Which of `orgIds` the policy engine lets the caller take `action` in, one
 * decision per group, side by side; null when a binding is missing (503).
 * Any other denial — not a member, a role without the grant, a failed hop —
 * is a no.
 */
async function allowedGroups(ctx: RequestContext, orgIds: readonly Uuid[], action: KitchenAction): Promise<Set<string> | null> {
  const decisions = await ctx.timings.measure("authz", () =>
    Promise.all(orgIds.map((orgId) => requireOrgAction(ctx.env, ctx.requestId, ctx.actor, orgId, action))),
  );
  if (decisions.some((d) => d !== null && d.status === 503)) return null;
  return new Set(orgIds.filter((_orgId, i) => decisions[i] === null));
}

function ownerOf(ctx: RequestContext, line: ParsedLine): KitchenPantryOwner {
  return line.pantry.kind === "group" ? { kind: "group", orgId: line.pantry.orgId } : { kind: "user", subjectId: ctx.actor.subjectId };
}

/** Add item's `kitchen.item.added`, under the line's group, naming the purchase. */
function addedAudit(ctx: RequestContext, orgId: Uuid, item: NewKitchenItem, purchaseId: string): AppendEventWithAuditInput {
  const orgCtx: OrgContext = { ...ctx, orgId };
  const quantityText = formatQuantity(item.qtyMilli, item.dimension, item.displayUnit);
  const itemId = toPublicId("itm", item.id);
  return ledgerAudit(orgCtx, {
    type: "kitchen.item.added",
    subjectKind: "kitchen_item",
    subjectId: item.id,
    idemKey: item.idemKey,
    description: `Item ${itemId} "${item.name}": ${quantityText} for ${formatMinor(item.priceMinor, item.currency)}, paid by ${item.paidBy} (purchase ${purchaseId})`,
    payload: {
      itemId,
      name: item.name,
      category: item.category,
      qtyMilli: item.qtyMilli,
      displayUnit: item.displayUnit,
      priceMinor: item.priceMinor,
      currency: item.currency,
      paidBy: item.paidBy,
      purchaseId,
    },
  });
}

export async function handleCreatePurchase(ctx: RequestContext, request: Request): Promise<Response> {
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parsePurchase(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const lines = parsed.value;
  const me = ctx.actor.subjectId;

  // Every pantry in reach, or nothing at all.
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const orgIds = [...new Set(lines.flatMap((l) => (l.pantry.kind === "group" ? [l.pantry.orgId] : [])))];
  const allowed = await allowedGroups(ctx, orgIds, "kitchen.item.create");
  if (!allowed) return unavailable(ctx.requestId);
  const outOfReach: Record<string, string[]> = {};
  for (const line of lines) {
    if (line.pantry.kind === "group" && !(allowed.has(line.pantry.orgId) && groups.has(line.pantry.orgId))) {
      outOfReach[`lines[${line.index}].pantry`] = ["Must be a pantry you can add to"];
    }
  }
  if (Object.keys(outOfReach).length > 0) return validationError(ctx.requestId, outOfReach);

  return withRestockRepos(ctx, async ({ kitchen, purchases }) => {
    const fromIds = [...new Set(lines.flatMap((l) => (l.fromItemId ? [l.fromItemId] : [])))];
    const [settings, from] = await ctx.timings.measure("db", () =>
      Promise.all([
        kitchen.listGroupSettings(orgIds),
        purchases.itemsById({ ownerSubjectId: me, orgIds: [...groups.keys()] }, fromIds),
      ]),
    );
    if (!settings.ok || !from.ok) return unavailable(ctx.requestId);
    const currencies = new Map(settings.value.map((s) => [s.orgId, s.currency]));
    const fromById = new Map(from.value.map((r) => [r.id, r]));
    // Who may use an ask-first item a line buys again without asking (PN-8): one read, only when one asks first.
    const guarded = from.value.filter((r) => r.askFirst === true).map((r) => r.id);
    const allowedRows = await ctx.timings.measure("db", () => kitchen.listAllowed(guarded));
    if (!allowedRows.ok) return unavailable(ctx.requestId);
    const allowedOf = (itemId: string) => allowedRows.value.filter((r) => r.itemId === itemId).map((r) => r.memberId);

    const missing: Record<string, string[]> = {};
    for (const line of lines) {
      if (line.fromItemId && !fromById.has(line.fromItemId)) missing[`lines[${line.index}].fromItemId`] = ["Must be an item in one of your pantries"];
    }
    if (Object.keys(missing).length > 0) return validationError(ctx.requestId, missing);
    for (const line of lines) {
      const currency = lineCurrency(line, currencies);
      if (line.pantry.kind === "group" && line.item.currency !== null && line.item.currency !== currency) {
        return unprocessable(ctx.requestId, `The group counts in ${currency}`, KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH, {
          currency,
          line: line.index,
        });
      }
    }

    const purchaseId = asUuid(crypto.randomUUID());
    const publicPurchaseId = toPublicId("pur", purchaseId);
    const now = ctx.now();
    const today = isoDay(now);
    const items: NewKitchenItem[] = lines.map((line) => {
      const inherited = inheritedSettings(
        line,
        line.fromItemId ? fromById.get(line.fromItemId)! : null,
        line.fromItemId ? allowedOf(line.fromItemId) : [],
      );
      return {
        id: asUuid(crypto.randomUUID()),
        owner: ownerOf(ctx, line),
        name: line.item.name,
        category: line.item.category,
        dimension: line.item.dimension,
        displayUnit: line.item.displayUnit,
        qtyMilli: line.item.qtyMilli,
        priceMinor: line.item.priceMinor,
        currency: lineCurrency(line, currencies),
        paidBy: me,
        boughtOn: today,
        expiresOn: line.item.expiresOn,
        wastePolicy: inherited.wastePolicy,
        askFirst: inherited.askFirst,
        allowed: inherited.allowed,
        createdBy: me,
        idemKey: `${idem.key}${LINE_KEY_SEPARATOR}${line.index}`,
        now,
        note: line.item.note,
        purchaseId,
      };
    });
    const audits = items.flatMap((item) =>
      item.owner.kind === "group" ? [addedAudit(ctx, item.owner.orgId as Uuid, item, publicPurchaseId)] : [],
    );

    const result = await ctx.timings.measure("db", () => purchases.createPurchase({ purchaseId, items, audits }));
    if (!result.ok) {
      if (result.error.kind === "conflict") return idempotencyKeyReused(ctx.requestId);
      if (result.error.kind === "currency_mismatch") {
        return unprocessable(ctx.requestId, `The group counts in ${result.error.currency}`, KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH, {
          currency: result.error.currency,
        });
      }
      return itemErrorResponse(ctx.requestId, result.error);
    }
    const made = result.value;
    // A replay answers with the purchase the key made — the caller's own, or it is someone else's key.
    if (made.replayed && (made.items.length === 0 || made.items.some((i) => i.createdBy !== me))) {
      return idempotencyKeyReused(ctx.requestId);
    }
    const shown = await presentItems(ctx, kitchen, groups, made.items);
    if (!shown) return unavailable(ctx.requestId);
    return successResponse<PurchaseResponse>({ purchaseId: toPublicId("pur", made.purchaseId), items: shown }, ctx.requestId, 201);
  });
}

export async function handleUndoPurchase(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const purchaseId = parsePublicId("pur", params[0]!);
  if (!purchaseId) return notFound(ctx.requestId);
  const me = ctx.actor.subjectId;
  const groups = await myGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const scope = { ownerSubjectId: me, orgIds: [...groups.keys()] };

  return withRestockRepos(ctx, async ({ kitchen, purchases }) => {
    const found = await ctx.timings.measure("db", () => purchases.purchaseItems(purchaseId, me, scope));
    if (!found.ok) return unavailable(ctx.requestId);
    if (found.value.length === 0) return notFound(ctx.requestId);

    const orgIds = [...new Set(found.value.flatMap((r) => (r.orgId ? [r.orgId as Uuid] : [])))];
    const allowed = await allowedGroups(ctx, orgIds, "kitchen.item.edit");
    if (!allowed) return unavailable(ctx.requestId);

    const undone = await ctx.timings.measure("db", () =>
      purchases.undoPurchase({ purchaseId, createdBy: me, scope: { ownerSubjectId: me, orgIds: [...allowed] }, now: ctx.now() }),
    );
    if (!undone.ok) return unavailable(ctx.requestId);
    const after = await ctx.timings.measure("db", () => purchases.purchaseItems(purchaseId, me, scope));
    if (!after.ok) return unavailable(ctx.requestId);

    const shown = await presentItems(ctx, kitchen, groups, after.value);
    if (!shown) return unavailable(ctx.requestId);
    return successResponse<UndoPurchaseResponse>(
      {
        purchaseId: toPublicId("pur", purchaseId),
        removed: shown.filter((i) => i.state === "removed"),
        kept: shown.filter((i) => i.state !== "removed"),
      },
      ctx.requestId,
    );
  });
}
