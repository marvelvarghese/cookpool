import {
  ASK_LAPSE_MS,
  ASK_MINE_HOURS,
  ASKS_LIST_MAX,
  KITCHEN_ASK_ERROR_REASONS,
  KITCHEN_ERROR_REASONS,
  type ApproveAskResponse,
  type AskResponse,
  type AsksResponse,
  type KitchenAsk,
} from "@saas/contracts/kitchen";
import { asUuid, type Uuid } from "@saas/db/ids";
import type {
  ApprovedAsk,
  AskWriteError,
  KitchenAskAnswer,
  KitchenAskRead,
  KitchenItemRecord,
  KitchenPantryOwner,
  KitchenRepository,
} from "@saas/db/kitchen";
import { formatQuantity } from "@saas/kitchen-engine/units";
import { requireGroupAction } from "../authz.js";
import {
  MANAGE_ROLES,
  answeredPush,
  askPeople,
  askRuleOf,
  askStateOf,
  askedPush,
  managesItems,
  parseAsk,
  toKitchenAsk,
  type AskView,
} from "../asks.js";
import type { OrgContext, RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import type { MemberGroup } from "../groups-client.js";
import { conflict, forbidden, notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import type { DisplayName } from "../identity-client.js";
import { requestIdempotencyKey } from "../idempotency.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { idempotencyKeyReused } from "../ledger.js";
import { readMeasures } from "../measures.js";
import { itemErrorResponse } from "../pantry.js";
import { pushToSubject } from "../push-client.js";
import { notInGroup } from "../roster-client.js";
import { insufficientStock, stockErrorResponse, useAmount } from "../stock.js";
import { Fields } from "../validate.js";
import { thisGroup } from "./group-items.js";
import { emailUse, movedData, planGroupUse } from "./uses.js";

// Ask before use (PN-8, cookpool-pantry design §8; the contract is
// @saas/contracts/kitchen-asks.ts):
//
//   POST …/items/{itm}/asks       kitchen.item.use, and must ask       → 201 { ask }
//   POST …/asks/{ask}/approve     kitchen.pantry.read, the answerer    → 201 { ask, item, move, txn }
//   POST …/asks/{ask}/decline     kitchen.pantry.read, the answerer    → 200 { ask }
//   POST …/asks/{ask}/reopen      kitchen.pantry.read, the answerer    → 200 { ask }
//   POST …/asks/{ask}/cancel      kitchen.pantry.read, the asker       → 200 { ask }
//   GET  /v1/kitchen/me/asks      the caller's groups                  → 200 { toAnswer, mine }
//
// The answerer is the item's buyer while they are in the group, else whoever
// manages the group's items (owner, admin). An ask in another group, or a
// malformed id, is the opaque 404. Pushes go after the write has committed,
// best-effort: a failed push is logged by the push client and never fails
// the write.

function owner(ctx: OrgContext): KitchenPantryOwner {
  return { kind: "group", orgId: ctx.orgId };
}

/** The item's answerer now: its buyer while they are in the group, else null (owners and admins). Undefined on a failed read. */
async function answererOf(ctx: OrgContext, item: KitchenItemRecord): Promise<string | null | undefined> {
  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
  if (!roster.ok) return undefined;
  return roster.members.some((m) => m.subjectId === item.paidBy) ? item.paidBy : null;
}

/** May the caller answer for this item? Null when they may; else the 403 (or a 503 on a failed read). */
async function mayAnswer(ctx: OrgContext, answerer: string | null | undefined): Promise<Response | null> {
  if (answerer === undefined) return unavailable(ctx.requestId);
  const may = answerer !== null ? ctx.actor.subjectId === answerer : await managesItems(ctx, ctx.orgId);
  if (may) return null;
  return forbidden(
    ctx.requestId,
    "Only whoever bought it answers, or an owner or admin once they have left the group",
    KITCHEN_ERROR_REASONS.NOT_BUYER,
  );
}

/** Everyone's names, in one lookup; a failed lookup names nobody. */
async function namesOf(ctx: RequestContext, people: readonly string[]): Promise<ReadonlyMap<string, DisplayName>> {
  return people.length > 0 ? ctx.timings.measure("identity", () => ctx.people.names(people)) : new Map();
}

async function viewOf(ctx: OrgContext, read: KitchenAskRead, group: MemberGroup, answerer: string | null, also: readonly string[] = []): Promise<AskView> {
  const names = await namesOf(ctx, [...askPeople(read, answerer), ...also]);
  return { now: ctx.now(), group, answerer, names };
}

/** 409: the ask has lapsed, or is not in a state this answer moves from. */
function notAnswerable(ctx: OrgContext, read: KitchenAskRead): Response {
  const state = askStateOf(read, ctx.now());
  if (state === "lapsed") {
    return conflict(ctx.requestId, "This ask has lapsed", KITCHEN_ASK_ERROR_REASONS.LAPSED, { state });
  }
  return conflict(ctx.requestId, `This ask is ${state}`, KITCHEN_ASK_ERROR_REASONS.NOT_PENDING, { state });
}

/** Push, after the response; the client logs a failure and never throws. */
async function push(ctx: RequestContext, request: Parameters<typeof pushToSubject>[2]): Promise<void> {
  await ctx.defer(() => pushToSubject(ctx.env, { requestId: ctx.requestId, actor: ctx.actor }, request));
}

// ── POST …/items/{itm}/asks ────────────────────────────────

export async function handleAskToUse(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  // Asking is the way to use it: the same grant as using it.
  const denied = await requireGroupAction(ctx, "kitchen.item.use");
  if (denied) return denied;
  const itemId = parsePublicId("itm", params[0]!);
  if (!itemId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseAsk(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const asked = parsed.value;

  const actor = ctx.actor.subjectId;
  const consumers = asked.consumers ?? [actor];
  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
  if (!roster.ok) return unavailable(ctx.requestId);
  const outsiders = notInGroup(roster.members, consumers);
  if (outsiders.length > 0) {
    return unprocessable(ctx.requestId, "Everyone who will have it must be in the group", KITCHEN_ERROR_REASONS.NOT_IN_GROUP, {
      subjectIds: outsiders,
    });
  }
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getItem(owner(ctx), itemId));
    if (!found.ok) return itemErrorResponse(ctx.requestId, found.error);
    const item = found.value;

    // Only someone who must ask asks: the console uses the item directly otherwise.
    const rule = await askRuleOf(ctx, repo, item);
    if (rule === undefined) return unavailable(ctx.requestId);
    const needless =
      !rule ||
      actor === item.paidBy ||
      rule.allowed.includes(actor) ||
      (rule.answerer === null && (await managesItems(ctx, ctx.orgId)));
    if (needless) {
      return conflict(ctx.requestId, "You needn't ask: use it directly", KITCHEN_ASK_ERROR_REASONS.NO_NEED, {
        itemId: toPublicId("itm", item.id),
      });
    }

    // The amount, as a use of it would read it now: a unit of its dimension or one of its measures, and no more than is left.
    const qty = await useAmount(ctx.requestId, item, asked.use, () => readMeasures(ctx, repo, [item]));
    if (qty instanceof Response) return qty;

    const now = ctx.now();
    const made = await ctx.timings.measure("db", () =>
      repo.createAsk({
        id: asUuid(crypto.randomUUID()),
        orgId: ctx.orgId,
        itemId: item.id,
        askerId: actor,
        qtyMilli: qty.qtyMilli,
        unit: qty.unit,
        label: qty.label,
        consumers,
        weights: asked.weights,
        source: asked.source,
        idemKey: idem.key,
        now,
        expiresAt: new Date(now.getTime() + ASK_LAPSE_MS),
      }),
    );
    if (!made.ok) return made.error.kind === "conflict" ? idempotencyKeyReused(ctx.requestId) : unavailable(ctx.requestId);
    const { read, replayed } = made.value;
    if (replayed && read.ask.askerId !== actor) return idempotencyKeyReused(ctx.requestId);

    // Who hears it: the buyer, or every owner and admin once the buyer has left.
    const hearers = rule.answerer
      ? [rule.answerer]
      : roster.members.filter((m) => m.role !== null && MANAGE_ROLES.has(m.role) && m.subjectId !== actor).map((m) => m.subjectId);
    const view = await viewOf(ctx, read, here.group, rule.answerer, hearers);
    const ask = toKitchenAsk(read, view);
    if (!replayed) {
      for (const hearer of hearers) await push(ctx, askedPush(read, ask, hearer, view.names));
    }
    return successResponse<AskResponse>({ ask }, ctx.requestId, 201);
  });
}

// ── POST …/asks/{ask}/approve ──────────────────────────────

function flag(fields: Fields, name: string, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  fields.add(name, "Must be true or false");
  return false;
}

/** A refused approval: the ask moved on, or the stock write was refused as any use's is. */
function approvalRefused(ctx: OrgContext, error: AskWriteError, item: KitchenItemRecord): Response {
  if (error.kind === "ask_not_pending") return notAnswerable(ctx, { ask: error.ask, item });
  return stockErrorResponse(ctx.requestId, error);
}

export async function handleApproveAsk(ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> {
  const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
  if (denied) return denied;
  const askId = parsePublicId("ask", params[0]!);
  if (!askId) return notFound(ctx.requestId);
  const idem = requestIdempotencyKey(request, ctx.requestId);
  if (!idem.ok) return idem.response;
  const body = await readJsonObject(request, { optional: true });
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object, or empty"] });
  const fields = new Fields();
  const alwaysAllow = flag(fields, "alwaysAllow", body.alwaysAllow);
  const takeWhatsLeft = flag(fields, "takeWhatsLeft", body.takeWhatsLeft);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  const here = await thisGroup(ctx);
  if (!here.ok) return here.response;
  const actor = ctx.actor.subjectId;

  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getAsk(ctx.orgId, askId));
    if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    let read = found.value;
    const answerer = await answererOf(ctx, read.item);
    const refused = await mayAnswer(ctx, answerer);
    if (refused) return refused;

    const settings = await ctx.timings.measure("db", () => repo.getGroupSettings(ctx.orgId));
    if (!settings.ok) return unavailable(ctx.requestId);
    /** 201 with the approved ask and the use it posted, as the caller reads them. */
    const approvedResponse = async (approved: ApprovedAsk): Promise<Response> => {
      const current = { ask: approved.ask, item: approved.item };
      const [data, view] = await Promise.all([
        movedData(ctx, repo, here.group, settings.value, approved),
        viewOf(ctx, current, here.group, answerer ?? null),
      ]);
      if (!data) return unavailable(ctx.requestId);
      return successResponse<ApproveAskResponse>({ ...data, ask: toKitchenAsk(current, view) }, ctx.requestId, 201);
    };

    // This very approval again (its key made its move): answer with what it wrote.
    if (read.ask.state === "approved" && read.ask.answeredBy === actor && read.ask.moveId) {
      const prior = await ctx.timings.measure("db", () => repo.getMove(owner(ctx), read.ask.moveId as Uuid));
      if (!prior.ok) return stockErrorResponse(ctx.requestId, prior.error);
      if (prior.value.move.idemKey === idem.key) {
        let txn = null;
        if (prior.value.move.txnId) {
          const posted = await ctx.timings.measure("db", () => repo.getTxn(ctx.orgId, prior.value.move.txnId as Uuid));
          if (!posted.ok) return unavailable(ctx.requestId);
          txn = posted.value;
        }
        return approvedResponse({ ask: read.ask, item: prior.value.item, move: prior.value.move, txn, replayed: true });
      }
    }
    if (askStateOf(read, ctx.now()) !== "pending") return notAnswerable(ctx, read);

    // The use is the asker's, for the people they named — who must all still be in the group.
    const { ask } = read;
    const roster = await ctx.timings.measure("roster", () => ctx.roster.members(ctx.orgId));
    if (!roster.ok) return unavailable(ctx.requestId);
    const outsiders = notInGroup(roster.members, [ask.askerId, ...ask.consumers]);
    if (outsiders.length > 0) {
      return unprocessable(ctx.requestId, "Whoever asked, and everyone it is for, must still be in the group", KITCHEN_ERROR_REASONS.NOT_IN_GROUP, {
        subjectIds: outsiders,
      });
    }
    const asker: OrgContext = { ...ctx, actor: { subjectId: ask.askerId, subjectType: "user" } };

    for (let attempt = 0; ; attempt += 1) {
      const item = read.item;
      // At this moment's stock: less left than asked is refused, unless the answerer approves what is left.
      let take = { qtyMilli: ask.qtyMilli, unit: ask.unit, label: ask.label };
      if (ask.qtyMilli > item.qtyLeftMilli) {
        if (!takeWhatsLeft) return insufficientStock(ctx.requestId, item.qtyLeftMilli);
        take = { qtyMilli: item.qtyLeftMilli, unit: item.displayUnit, label: null };
      }
      const plan = planGroupUse(asker, item, {
        ...take,
        consumers: ask.consumers,
        weights: ask.weights,
        idemKey: idem.key,
        via: "ask",
      });
      // The use is the asker's; the audit says who approved it, and that it was asked for.
      if (plan.audit) {
        plan.audit = {
          ...plan.audit,
          event: {
            ...plan.audit.event,
            actorType: ctx.actor.subjectType,
            actorId: actor,
            payload: { ...plan.audit.event.payload, askId: toPublicId("ask", ask.id), askedBy: ask.askerId, approvedBy: actor },
          },
          audit: { ...plan.audit.audit, description: `${plan.audit.audit.description}, asked by ${ask.askerId} and approved by ${actor}` },
        };
      }
      const result = await ctx.timings.measure("db", () =>
        repo.approveAsk({ orgId: ctx.orgId, askId: ask.id, answeredBy: actor, now: ctx.now(), take: plan, grant: alwaysAllow }),
      );
      if (!result.ok) {
        if (result.error.kind === "stale" && attempt === 0) {
          // The item moved on between the read and the write: read both again and plan once more.
          const again = await ctx.timings.measure("db", () => repo.getAsk(ctx.orgId, askId));
          if (!again.ok) return again.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
          read = again.value;
          if (askStateOf(read, ctx.now()) !== "pending") return notAnswerable(ctx, read);
          continue;
        }
        return approvalRefused(ctx, result.error, item);
      }
      if (result.value.replayed && result.value.ask.answeredBy !== actor) return idempotencyKeyReused(ctx.requestId);

      const approved = result.value;
      if (!approved.replayed) {
        // Committed: the people it was logged for hear by email, as for any use; the asker hears by push.
        await emailUse(asker, approved, here.group);
        const amount = approved.move.label ?? formatQuantity(approved.move.qtyMilli, approved.item.dimension, approved.move.unit ?? approved.item.displayUnit);
        const current = { ask: approved.ask, item: approved.item };
        const view = await viewOf(ctx, current, here.group, answerer ?? null);
        await push(ctx, answeredPush(current, toKitchenAsk(current, view), { amount }, view.names));
      }
      return approvedResponse(approved);
    }
  });
}

// ── POST …/asks/{ask}/decline · reopen · cancel ────────────

/** Where each answer leads. */
const ANSWERED: Readonly<Record<KitchenAskAnswer, "declined" | "pending" | "canceled">> = {
  decline: "declined",
  reopen: "pending",
  cancel: "canceled",
};

function answerHandler(answer: KitchenAskAnswer) {
  return async (ctx: OrgContext, request: Request, params: readonly string[]): Promise<Response> => {
    const denied = await requireGroupAction(ctx, "kitchen.pantry.read");
    if (denied) return denied;
    const askId = parsePublicId("ask", params[0]!);
    if (!askId) return notFound(ctx.requestId);
    const idem = requestIdempotencyKey(request, ctx.requestId);
    if (!idem.ok) return idem.response;
    const here = await thisGroup(ctx);
    if (!here.ok) return here.response;
    const actor = ctx.actor.subjectId;

    return withKitchenRepo(ctx, async (repo) => {
      const found = await ctx.timings.measure("db", () => repo.getAsk(ctx.orgId, askId));
      if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
      const read = found.value;
      const answerer = await answererOf(ctx, read.item);
      if (answer === "cancel") {
        if (read.ask.askerId !== actor) {
          return forbidden(ctx.requestId, "Only whoever asked can cancel it", KITCHEN_ERROR_REASONS.NOT_CREATOR);
        }
      } else {
        const refused = await mayAnswer(ctx, answerer);
        if (refused) return refused;
      }
      const answered = async (current: KitchenAskRead) =>
        successResponse<AskResponse>({ ask: toKitchenAsk(current, await viewOf(ctx, current, here.group, answerer ?? null)) }, ctx.requestId);

      // This answer again: the ask is where it leads already (a decline or cancel by this very person, a reopened ask still live).
      const state = askStateOf(read, ctx.now());
      const target = ANSWERED[answer];
      if (state === target && (target === "pending" || read.ask.answeredBy === actor)) return answered(read);

      const result = await ctx.timings.measure("db", () =>
        repo.answerAsk({ orgId: ctx.orgId, askId, answer, actor, now: ctx.now() }),
      );
      if (!result.ok) return unavailable(ctx.requestId);
      if (!result.value) {
        // It moved on, or it was never where this answer moves from: say what it is now.
        const now = await ctx.timings.measure("db", () => repo.getAsk(ctx.orgId, askId));
        if (!now.ok) return unavailable(ctx.requestId);
        // A declined ask can be reopened only while it could still be answered.
        if (answer === "reopen" && now.value.ask.state === "declined") {
          return conflict(ctx.requestId, "This ask has lapsed", KITCHEN_ASK_ERROR_REASONS.LAPSED, { state: "declined" });
        }
        return notAnswerable(ctx, now.value);
      }
      const current = result.value;
      const response = await answered(current);
      // The asker hears a no; a reopen (the answerer's Undo) and a cancel (the asker's own) push nothing.
      if (answer === "decline") {
        const view = await viewOf(ctx, current, here.group, answerer ?? null);
        await push(ctx, answeredPush(current, toKitchenAsk(current, view), null, view.names));
      }
      return response;
    });
  };
}

export const handleDeclineAsk = answerHandler("decline");
export const handleReopenAsk = answerHandler("reopen");
export const handleCancelAsk = answerHandler("cancel");

// ── GET /v1/kitchen/me/asks ────────────────────────────────

/**
 * The caller's asks across their groups: the pending ones they answer
 * (`toAnswer`, oldest first) and their own from the last ASK_MINE_HOURS
 * (`mine`, newest first). An owner or admin answers on an item whose buyer
 * has left the group: those groups' rosters are read, once each. Null on a
 * failed read. Home's inbox reads `toAnswer` through this too.
 */
export async function readMyAsks(
  ctx: RequestContext,
  repo: KitchenRepository,
  groups: readonly MemberGroup[],
  options: { mine?: boolean } = {},
): Promise<AsksResponse | null> {
  const me = ctx.actor.subjectId;
  const now = ctx.now();
  const byOrg = new Map<string, MemberGroup>(groups.map((g) => [g.orgId, g]));
  const read = await ctx.timings.measure("db", () =>
    repo.listAsks({
      orgIds: groups.map((g) => g.orgId),
      now,
      answer: { paidBy: me, adminOrgIds: groups.filter((g) => MANAGE_ROLES.has(g.role)).map((g) => g.orgId) },
      ...(options.mine === false ? {} : { mine: { askerId: me, since: new Date(now.getTime() - ASK_MINE_HOURS * 3_600_000) } }),
      limit: ASKS_LIST_MAX,
    }),
  );
  if (!read.ok) return null;

  // Each item's answerer: its buyer while they are in the group, else null (owners and admins).
  const members = new Map<string, ReadonlySet<string>>();
  for (const orgId of new Set([...read.value.toAnswer, ...read.value.mine].map((r) => r.ask.orgId))) {
    const roster = await ctx.timings.measure("roster", () => ctx.roster.members(orgId as Uuid));
    if (!roster.ok) return null;
    members.set(orgId, new Set(roster.members.map((m) => m.subjectId)));
  }
  const answererOfRead = (r: KitchenAskRead) => (members.get(r.ask.orgId)?.has(r.item.paidBy) ? r.item.paidBy : null);
  // An owner or admin answers only once the buyer has left; the buyer always answers their own.
  const toAnswer = read.value.toAnswer.filter((r) => r.item.paidBy === me || answererOfRead(r) === null);
  const all = [...toAnswer, ...read.value.mine];
  const names = await namesOf(ctx, all.flatMap((r) => askPeople(r, answererOfRead(r))));
  const shown = (r: KitchenAskRead): KitchenAsk[] => {
    const group = byOrg.get(r.ask.orgId);
    return group ? [toKitchenAsk(r, { now, group, answerer: answererOfRead(r), names })] : [];
  };
  return { toAnswer: toAnswer.flatMap(shown), mine: read.value.mine.flatMap(shown) };
}

export async function handleMyAsks(ctx: RequestContext): Promise<Response> {
  const groups = await ctx.timings.measure("groups", () => ctx.groups.of(ctx.actor.subjectId));
  if (!groups.ok) return unavailable(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const asks = await readMyAsks(ctx, repo, groups.groups);
    return asks ? successResponse<AsksResponse>(asks, ctx.requestId) : unavailable(ctx.requestId);
  });
}
