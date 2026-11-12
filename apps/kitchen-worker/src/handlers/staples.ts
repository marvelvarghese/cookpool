import {
  DEFAULT_KITCHEN_CURRENCY,
  KITCHEN_ERROR_REASONS,
  MAX_SHOPPING_ITEMS,
  MAX_STAPLES,
  STAPLE_ERROR_REASONS,
  type ClearShoppingResponse,
  type ShoppingItemResponse,
  type StapleBoughtResponse,
  type StapleOwner,
  type StaplePantry,
  type StapleResponse,
  type StaplesResponse,
} from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import {
  DEFAULT_STAPLE_FOODS,
  boughtStatement,
  defaultStapleId,
  type KitchenRepository,
  type KitchenStapleRecord,
  type StapleOwnerKey,
  type StapleResult,
} from "@saas/db/kitchen";
import { buildExpense } from "@saas/kitchen-engine/ledger";
import { formatMinor } from "@saas/kitchen-engine/money";
import { requireGroupAction } from "../authz.js";
import type { OrgContext, RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { emailLoggedForYou } from "../emails.js";
import { conflict, notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { groupCurrency, idempotencyKeyReused, ledgerAudit, postedTxnResponse, toKitchenTxn } from "../ledger.js";
import type { MemberGroup } from "../groups-client.js";
import {
  parseAddShoppingItem,
  parseAddStaple,
  parseClearShopping,
  parseBought,
  parseUpdateShoppingItem,
  parseUpdateStaple,
  toShoppingItem,
  toStaple,
} from "../staples.js";

// Always have per pantry and the shopping list (cookpool-revamp RV-21; the
// routes and their shapes: contracts' kitchen-staples.ts).
//
// Your own: /v1/kitchen/me/staples… and /v1/kitchen/me/shopping…, only ever
// your own rows (owner usr_…). Every write first runs `seedPersonal`, so a
// list still at its default (salt and water) is written out before it
// changes. A group's: /v1/organizations/{org}/kitchen/staples… and …/shopping…,
// read by any member (kitchen.pantry.read), changed by those who add items
// (kitchen.item.create, not a viewer), and Bought by those who add bills
// (kitchen.expense.create): one equal expense among the group's current
// members, paid by the caller, with the staple back to ok in the same batch.

const meOwner = (ctx: RequestContext): StapleOwnerKey => ({ kind: "user", id: ctx.actor.subjectId });
const groupOwner = (ctx: OrgContext): StapleOwnerKey => ({ kind: "group", id: ctx.orgId });

/** A refusal from the staples repository as a response; null when it is not one of the expected ones. */
function refusal(ctx: RequestContext, result: StapleResult<unknown>): Response {
  if (result.ok) throw new Error("not a refusal");
  if (result.error.kind === "not_found") return notFound(ctx.requestId);
  if (result.error.kind === "already_listed") return conflict(ctx.requestId, "This pantry already has that name", STAPLE_ERROR_REASONS.ALREADY_LISTED);
  return unavailable(ctx.requestId);
}

async function body(ctx: RequestContext, request: Request): Promise<Record<string, unknown> | Response> {
  const parsed = await readJsonObject(request);
  return parsed ?? validationError(ctx.requestId, { body: ["Must be a JSON object"] });
}

/** A person's default staples (salt and water) as records, under the ids a write will find. */
async function defaultStaples(repo: KitchenRepository, userId: string): Promise<KitchenStapleRecord[] | null> {
  const foods = await repo.getFoods(DEFAULT_STAPLE_FOODS);
  if (!foods.ok) return null;
  const at = new Date(0);
  return Promise.all(
    foods.value.map(async (f) => ({
      id: await defaultStapleId(userId, f.key),
      ownerKind: "user" as const,
      ownerId: userId,
      name: f.name,
      nameKey: f.name.trim().toLowerCase(),
      foodKey: f.key,
      status: "ok" as const,
      lastPriceMinor: null,
      currency: null,
      lastQtyMilli: null,
      lastUnit: null,
      wantQtyMilli: null,
      wantUnit: null,
      lastTxnId: null,
      boughtAt: null,
      createdBy: userId,
      createdAt: at,
      updatedBy: userId,
      updatedAt: at,
    })),
  );
}

/** The group's current members, oldest first; null when membership could not be read. */
async function membersOf(ctx: RequestContext, orgId: string): Promise<string[] | null> {
  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(asUuid(orgId)));
  return roster.ok ? roster.members.map((m) => m.subjectId) : null;
}

function groupOwnerView(g: Pick<MemberGroup, "publicId" | "slug" | "name">): StapleOwner {
  return { kind: "group", orgId: g.publicId, slug: g.slug, name: g.name };
}

// ── Reads ────────────────────────────────────────────────────────

export async function handleMyStaples(ctx: RequestContext): Promise<Response> {
  const groupsRead = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  if (!groupsRead.ok) return unavailable(ctx.requestId);
  const groups = [...groupsRead.groups].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  const me = meOwner(ctx);
  const owners: StapleOwnerKey[] = [me, ...groups.map((g) => ({ kind: "group" as const, id: g.orgId }))];

  return withKitchenRepo(ctx, async (repo) => {
    const [staples, items, isSet, settings, members] = await Promise.all([
      ctx.timings.measure("db", () => repo.listStaples(owners)),
      ctx.timings.measure("db", () => repo.listShoppingItems(owners)),
      ctx.timings.measure("db", () => repo.personalListSet(ctx.actor.subjectId)),
      ctx.timings.measure("db", () => repo.listGroupSettings(groups.map((g) => g.orgId))),
      Promise.all(groups.map((g) => membersOf(ctx, g.orgId))),
    ]);
    if (!staples.ok || !items.ok || !isSet.ok || !settings.ok) return unavailable(ctx.requestId);
    const of = <T extends { ownerKind: string; ownerId: string }>(rows: readonly T[], o: StapleOwnerKey) => rows.filter((r) => r.ownerKind === o.kind && r.ownerId === o.id);
    const mine = isSet.value ? of(staples.value, me) : await defaultStaples(repo, ctx.actor.subjectId);
    if (!mine) return unavailable(ctx.requestId);
    const currencyOf = new Map(settings.value.map((s) => [s.orgId as string, s.currency]));

    const pantries: StaplePantry[] = [
      {
        owner: { kind: "personal" },
        currency: DEFAULT_KITCHEN_CURRENCY,
        splitAmong: [],
        staples: mine.map(toStaple),
        isSet: isSet.value,
        items: of(items.value, me).map(toShoppingItem),
      },
      ...groups.map((g, i) => {
        const o: StapleOwnerKey = { kind: "group", id: g.orgId };
        return {
          owner: groupOwnerView(g),
          currency: currencyOf.get(g.orgId) ?? DEFAULT_KITCHEN_CURRENCY,
          splitAmong: members[i] ?? [],
          staples: of(staples.value, o).map(toStaple),
          isSet: true,
          items: of(items.value, o).map(toShoppingItem),
        };
      }),
    ];
    return successResponse<StaplesResponse>({ pantries }, ctx.requestId);
  });
}

export async function handleGroupStaples(ctx: OrgContext): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
  if (denied) return denied;
  const groupsRead = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  const group = groupsRead.ok ? groupsRead.groups.find((g) => g.orgId === ctx.orgId) : undefined;
  if (!group) return groupsRead.ok ? notFound(ctx.requestId) : unavailable(ctx.requestId);
  const o = groupOwner(ctx);
  return withKitchenRepo(ctx, async (repo) => {
    const [staples, items, currency, members] = await Promise.all([
      ctx.timings.measure("db", () => repo.listStaples([o])),
      ctx.timings.measure("db", () => repo.listShoppingItems([o])),
      groupCurrency(repo, ctx),
      membersOf(ctx, ctx.orgId),
    ]);
    if (!staples.ok || !items.ok || !currency || !members) return unavailable(ctx.requestId);
    return successResponse<StaplePantry>(
      { owner: groupOwnerView(group), currency, splitAmong: members, staples: staples.value.map(toStaple), isSet: true, items: items.value.map(toShoppingItem) },
      ctx.requestId,
    );
  });
}

// ── Staple writes (both pantries) ────────────────────────────────

interface Scope {
  ctx: RequestContext;
  owner: StapleOwnerKey;
  /** Writes the person's default list first (their own pantry only). */
  personal: boolean;
}

async function seeded(repo: KitchenRepository, s: Scope): Promise<boolean> {
  if (!s.personal) return true;
  return (await repo.seedPersonal(s.ctx.actor.subjectId, s.ctx.now())).ok;
}

function stapleId(raw: string | undefined): string | null {
  return raw ? parsePublicId("stp", raw) : null;
}

async function addStaple(s: Scope, request: Request): Promise<Response> {
  const { ctx } = s;
  const b = await body(ctx, request);
  if (b instanceof Response) return b;
  const parsed = parseAddStaple(b);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  return withKitchenRepo(ctx, async (repo) => {
    let foodKey = parsed.value.foodKey;
    if (foodKey) {
      const foods = await ctx.timings.measure("db", () => repo.getFoods([foodKey!]));
      if (!foods.ok) return unavailable(ctx.requestId);
      if (foods.value.length === 0) return validationError(ctx.requestId, { foodKey: [`No food "${foodKey}" on the food list`] });
    } else {
      const match = await ctx.timings.measure("db", () => repo.matchFood(parsed.value.name));
      if (!match.ok) return unavailable(ctx.requestId);
      foodKey = match.value?.key ?? null;
    }
    if (!(await seeded(repo, s))) return unavailable(ctx.requestId);
    const now = await ctx.timings.measure("db", () => repo.listStaples([s.owner]));
    if (!now.ok) return unavailable(ctx.requestId);
    if (now.value.length >= MAX_STAPLES) return validationError(ctx.requestId, { name: [`A pantry keeps at most ${MAX_STAPLES} staples`] });
    const added = await ctx.timings.measure("db", () =>
      repo.addStaple({ owner: s.owner, id: crypto.randomUUID(), name: parsed.value.name, foodKey, actor: ctx.actor.subjectId, now: ctx.now() }),
    );
    if (!added.ok) return refusal(ctx, added);
    return successResponse<StapleResponse>({ staple: toStaple(added.value) }, ctx.requestId, 201);
  });
}

async function updateStaple(s: Scope, request: Request, raw: string | undefined): Promise<Response> {
  const { ctx } = s;
  const id = stapleId(raw);
  if (!id) return notFound(ctx.requestId);
  const b = await body(ctx, request);
  if (b instanceof Response) return b;
  const parsed = parseUpdateStaple(b);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  return withKitchenRepo(ctx, async (repo) => {
    if (!(await seeded(repo, s))) return unavailable(ctx.requestId);
    const r = await ctx.timings.measure("db", () => repo.updateStaple({ owner: s.owner, id, patch: parsed.value, actor: ctx.actor.subjectId, now: ctx.now() }));
    return r.ok ? successResponse<StapleResponse>({ staple: toStaple(r.value) }, ctx.requestId) : refusal(ctx, r);
  });
}

async function removeStaple(s: Scope, raw: string | undefined): Promise<Response> {
  const { ctx } = s;
  const id = stapleId(raw);
  if (!id) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    if (!(await seeded(repo, s))) return unavailable(ctx.requestId);
    const r = await ctx.timings.measure("db", () => repo.removeStaple({ owner: s.owner, id }));
    return r.ok ? successResponse<StapleResponse>({ staple: toStaple(r.value) }, ctx.requestId) : refusal(ctx, r);
  });
}

export const handleAddMyStaple = (ctx: RequestContext, request: Request) => addStaple({ ctx, owner: meOwner(ctx), personal: true }, request);
export const handleUpdateMyStaple = (ctx: RequestContext, request: Request, params: readonly string[]) =>
  updateStaple({ ctx, owner: meOwner(ctx), personal: true }, request, params[0]);
export const handleRemoveMyStaple = (ctx: RequestContext, _request: Request, params: readonly string[]) =>
  removeStaple({ ctx, owner: meOwner(ctx), personal: true }, params[0]);

/** Your own Bought: the price recorded, back to ok. Nothing is split. */
export async function handleMyStapleBought(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const id = stapleId(params[0]);
  if (!id) return notFound(ctx.requestId);
  const b = await body(ctx, request);
  if (b instanceof Response) return b;
  const parsed = parseBought(b, false);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const { priceMinor, currency, qtyMilli, unit } = parsed.value;
  return withKitchenRepo(ctx, async (repo) => {
    if (!(await seeded(repo, { ctx, owner: meOwner(ctx), personal: true }))) return unavailable(ctx.requestId);
    const r = await ctx.timings.measure("db", () =>
      repo.recordBought({
        owner: meOwner(ctx),
        id,
        bought: { priceMinor, currency: currency ?? DEFAULT_KITCHEN_CURRENCY, qtyMilli, unit, txnId: null },
        actor: ctx.actor.subjectId,
        now: ctx.now(),
      }),
    );
    return r.ok ? successResponse<StapleBoughtResponse>({ staple: toStaple(r.value), txn: null }, ctx.requestId) : refusal(ctx, r);
  });
}

async function groupWrite(ctx: OrgContext, run: () => Promise<Response>): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.item.create");
  return denied ?? run();
}

export const handleAddGroupStaple = (ctx: OrgContext, request: Request) => groupWrite(ctx, () => addStaple({ ctx, owner: groupOwner(ctx), personal: false }, request));
export const handleUpdateGroupStaple = (ctx: OrgContext, request: Request, params: readonly string[]) =>
  groupWrite(ctx, () => updateStaple({ ctx, owner: groupOwner(ctx), personal: false }, request, params[0]));
export const handleRemoveGroupStaple = (ctx: OrgContext, _request: Request, params: readonly string[]) =>
  groupWrite(ctx, () => removeStaple({ ctx, owner: groupOwner(ctx), personal: false }, params[0]));

/**
 * A group's Bought: ONE expense for the price, paid by the caller (or
 * `paidBy`, a member: RV-22's Paid by), split
 * equally among the group's current members (the engine's largest
 * remainder: the parts add up to the total), and the staple back to ok with
 * the price recorded — in one batch. The same Idempotency-Key posts once.
 */
export async function handleGroupStapleBought(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.expense.create");
  if (denied) return denied;
  const id = stapleId(params[0]);
  if (!id) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const b = await body(ctx, request);
  if (b instanceof Response) return b;
  const parsed = parseBought(b, true);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const { priceMinor, qtyMilli, unit } = parsed.value;
  const members = await membersOf(ctx, ctx.orgId);
  if (!members) return unavailable(ctx.requestId);
  const actor = ctx.actor.subjectId;
  // The caller holds kitchen.expense.create here, so they are a member; the roster is who shares it.
  // Who paid (RV-22's Paid by) is the caller unless named, and must be on that roster.
  const payer = parsed.value.paidBy ?? actor;
  if (!members.includes(payer)) {
    return unprocessable(ctx.requestId, "Whoever paid must be in the group", KITCHEN_ERROR_REASONS.NOT_IN_GROUP, { subjectIds: [payer] });
  }
  const splits = buildExpense({ totalMinor: priceMinor, payers: [{ subjectId: payer, amountMinor: priceMinor }], mode: "equal", participants: members.map((subjectId) => ({ subjectId })) });

  return withKitchenRepo(ctx, async (repo) => {
    const staple = await ctx.timings.measure("db", () => repo.getStaple(groupOwner(ctx), id));
    if (!staple.ok) return refusal(ctx, staple);
    const currency = await groupCurrency(repo, ctx);
    if (!currency) return unavailable(ctx.requestId);
    if (parsed.value.currency !== null && parsed.value.currency !== currency) {
      return unprocessable(ctx.requestId, `The group's ledger counts in ${currency}`, KITCHEN_ERROR_REASONS.CURRENCY_MISMATCH, { currency });
    }
    const txnId = asUuid(crypto.randomUUID());
    const now = ctx.now();
    const title = staple.value.name;
    const result = await ctx.timings.measure("db", () =>
      repo.postTxn({
        txn: { id: txnId, orgId: ctx.orgId, kind: "expense", title, totalMinor: priceMinor, currency, occurredAt: now, createdBy: actor, note: null, idemKey: idem.key, now },
        splits,
        extra: [boughtStatement({ owner: groupOwner(ctx), id, bought: { priceMinor, currency, qtyMilli, unit, txnId }, actor, now })],
        audit: ledgerAudit(ctx, {
          type: "kitchen.expense.added",
          subjectKind: "kitchen_txn",
          subjectId: txnId,
          idemKey: idem.key,
          description: `Expense ${toPublicId("txn", txnId)} "${title}" for ${formatMinor(priceMinor, currency)}, split equal (Always have)`,
          payload: {
            txnId: toPublicId("txn", txnId),
            title,
            totalMinor: priceMinor,
            currency,
            mode: "equal",
            subjectIds: splits.map((s) => s.subjectId),
            stapleId: toPublicId("stp", id),
          },
        }),
      }),
    );
    if (!result.ok) return postedTxnResponse(ctx, result, () => false);
    const txn = result.value.txn;
    if (result.value.replayed && !(txn.kind === "expense" && txn.createdBy === actor && txn.title === title)) return idempotencyKeyReused(ctx.requestId);
    const after = await ctx.timings.measure("db", () => repo.getStaple(groupOwner(ctx), id));
    if (!after.ok) return refusal(ctx, after);
    if (!result.value.replayed) await ctx.defer(() => emailLoggedForYou(ctx, { kind: "expense", txn }));
    return successResponse<StapleBoughtResponse>({ staple: toStaple(after.value), txn: toKitchenTxn(txn) }, ctx.requestId, 201);
  });
}

// ── Hand-added list lines (both pantries) ────────────────────────

function itemId(raw: string | undefined): string | null {
  return raw ? parsePublicId("shp", raw) : null;
}

async function addItem(ctx: RequestContext, owner: StapleOwnerKey, request: Request): Promise<Response> {
  const b = await body(ctx, request);
  if (b instanceof Response) return b;
  const parsed = parseAddShoppingItem(b);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  return withKitchenRepo(ctx, async (repo) => {
    const listed = await ctx.timings.measure("db", () => repo.listShoppingItems([owner]));
    if (!listed.ok) return unavailable(ctx.requestId);
    if (listed.value.length >= MAX_SHOPPING_ITEMS) return validationError(ctx.requestId, { name: [`A list keeps at most ${MAX_SHOPPING_ITEMS} lines`] });
    const r = await ctx.timings.measure("db", () =>
      repo.addShoppingItem({ owner, id: crypto.randomUUID(), ...parsed.value, actor: ctx.actor.subjectId, now: ctx.now() }),
    );
    return r.ok ? successResponse<ShoppingItemResponse>({ item: toShoppingItem(r.value) }, ctx.requestId, 201) : refusal(ctx, r);
  });
}

async function updateItem(ctx: RequestContext, owner: StapleOwnerKey, request: Request, raw: string | undefined): Promise<Response> {
  const id = itemId(raw);
  if (!id) return notFound(ctx.requestId);
  const b = await body(ctx, request);
  if (b instanceof Response) return b;
  const parsed = parseUpdateShoppingItem(b);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  return withKitchenRepo(ctx, async (repo) => {
    const r = await ctx.timings.measure("db", () => repo.updateShoppingItem({ owner, id, ...parsed.value }));
    return r.ok ? successResponse<ShoppingItemResponse>({ item: toShoppingItem(r.value) }, ctx.requestId) : refusal(ctx, r);
  });
}

async function removeItem(ctx: RequestContext, owner: StapleOwnerKey, raw: string | undefined): Promise<Response> {
  const id = itemId(raw);
  if (!id) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const r = await ctx.timings.measure("db", () => repo.removeShoppingItem({ owner, id }));
    return r.ok ? successResponse<ShoppingItemResponse>({ item: toShoppingItem(r.value) }, ctx.requestId) : refusal(ctx, r);
  });
}

export const handleAddMyShoppingItem = (ctx: RequestContext, request: Request) => addItem(ctx, meOwner(ctx), request);
export const handleUpdateMyShoppingItem = (ctx: RequestContext, request: Request, params: readonly string[]) => updateItem(ctx, meOwner(ctx), request, params[0]);
export const handleRemoveMyShoppingItem = (ctx: RequestContext, _request: Request, params: readonly string[]) => removeItem(ctx, meOwner(ctx), params[0]);
export const handleAddGroupShoppingItem = (ctx: OrgContext, request: Request) => groupWrite(ctx, () => addItem(ctx, groupOwner(ctx), request));
export const handleUpdateGroupShoppingItem = (ctx: OrgContext, request: Request, params: readonly string[]) =>
  groupWrite(ctx, () => updateItem(ctx, groupOwner(ctx), request, params[0]));
export const handleRemoveGroupShoppingItem = (ctx: OrgContext, _request: Request, params: readonly string[]) =>
  groupWrite(ctx, () => removeItem(ctx, groupOwner(ctx), params[0]));

/** A saved shopping run: its hand-added lines deleted and its staples back to ok, in one batch. */
async function clearItems(ctx: RequestContext, owner: StapleOwnerKey, request: Request, personal: boolean): Promise<Response> {
  const b = await body(ctx, request);
  if (b instanceof Response) return b;
  const parsed = parseClearShopping(b, (prefix, id) => parsePublicId(prefix, id));
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  return withKitchenRepo(ctx, async (repo) => {
    if (personal && parsed.value.stapleIds.length > 0 && !(await seeded(repo, { ctx, owner, personal }))) return unavailable(ctx.requestId);
    const r = await ctx.timings.measure("db", () => repo.clearShopping({ owner, ...parsed.value, actor: ctx.actor.subjectId, now: ctx.now() }));
    if (!r.ok) return unavailable(ctx.requestId);
    return successResponse<ClearShoppingResponse>({ items: r.value.items.map(toShoppingItem), staples: r.value.staples.map(toStaple) }, ctx.requestId);
  });
}

export const handleClearMyShopping = (ctx: RequestContext, request: Request) => clearItems(ctx, meOwner(ctx), request, true);
export const handleClearGroupShopping = (ctx: OrgContext, request: Request) => groupWrite(ctx, () => clearItems(ctx, groupOwner(ctx), request, false));
