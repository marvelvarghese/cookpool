// Ask before use (PN-8, cookpool-pantry design §8): what the ask routes
// (./handlers/asks.ts) and every guarded write share — an ask-first item's
// rule (who may use it, who answers), the `ask_first` refusal the use, waste,
// dish and stock-check routes give, an ask as the API shows it, the ask's
// request body, and the two pushes.
//
// The rule, for one ask-first group item:
//   * its answerer is its buyer while they are in the group; once they have
//     left, the group's owners and admins (`kitchen.item.manage`) answer —
//     and set `askFirst` and `allowed`;
//   * who must ask: anyone else who is not in `allowed`.
// Reads say it without a policy hop (the caller's role: MANAGE_ROLES);
// writes ask the policy engine (`kitchen.item.manage`), only when the answer
// depends on it.

import {
  KITCHEN_ASK_ERROR_REASONS,
  KITCHEN_ASK_PUSH_KIND,
  ASK_SOURCES,
  askPushUrl,
  type AskSource,
  type AskState,
  type KitchenAsk,
  type KitchenItem,
} from "@saas/contracts/kitchen";
import type { PushToSubjectRequest } from "@saas/contracts/notifications";
import type { Uuid } from "@saas/db/ids";
import { askIsLive, type KitchenAskRead, type KitchenItemRecord, type KitchenRepository } from "@saas/db/kitchen";
import { buildUse } from "@saas/kitchen-engine/ledger";
import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import { formatQuantity } from "@saas/kitchen-engine/units";
import { requireOrgAction } from "./authz.js";
import type { RequestContext } from "./context.js";
import type { MemberGroup } from "./groups-client.js";
import { errorResponse, unavailable } from "./http.js";
import type { DisplayName } from "./identity-client.js";
import { toPublicId } from "./ids.js";
import { displayQuantity, groupPantryRef } from "./pantry.js";
import { parseUse, type ParsedUse } from "./stock.js";
import { Fields, type FieldErrors } from "./validate.js";

/**
 * The group roles whose grant holds `kitchen.item.manage` (design.md §6):
 * owner and admin. Reads say from this who answers once the buyer has left;
 * writes ask the policy engine. tests/kitchen-worker pins it against the engine.
 */
export const MANAGE_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

// ── The rule ───────────────────────────────────────────────

/** An ask-first item's rule, as a request resolves it. */
export interface AskRule {
  /** Who never needs to ask (`usr_…`), oldest first. */
  allowed: string[];
  /** Its buyer while they are in the group; null once they have left (owners and admins answer). */
  answerer: string | null;
}

/** Does `who` answer for the item? `manager`: may they manage the group's items (owner, admin)? */
export function answers(rule: AskRule, who: string, manager: boolean): boolean {
  return rule.answerer !== null ? who === rule.answerer : manager;
}

/** Must `who` ask before using the item? */
export function mustAsk(item: Pick<KitchenItemRecord, "askFirst" | "paidBy">, rule: AskRule, who: string, manager: boolean): boolean {
  return item.askFirst === true && who !== item.paidBy && !rule.allowed.includes(who) && !answers(rule, who, manager);
}

/** Is someone in the group still? Null when the roster could not be read. */
async function inGroup(ctx: Pick<RequestContext, "roster" | "timings">, orgId: string, who: string): Promise<boolean | null> {
  const roster = await ctx.timings.measure("roster", () => ctx.roster.members(orgId as Uuid));
  return roster.ok ? roster.members.some((m) => m.subjectId === who) : null;
}

/**
 * The rules of the ask-first group items among `records`: their allowed lists
 * in ONE statement, and each group's roster (once per group per request) for
 * whether the buyer is still in it. Items that do not ask first, and personal
 * items, have none: no read at all when nothing asks first. Null on a failed
 * read.
 */
export async function readAskRules(
  ctx: Pick<RequestContext, "roster" | "timings">,
  repo: KitchenRepository,
  records: readonly KitchenItemRecord[],
): Promise<((record: KitchenItemRecord) => AskRule | null) | null> {
  const guarded = records.filter((r) => r.ownerKind === "group" && r.orgId !== null && r.askFirst === true);
  if (guarded.length === 0) return () => null;
  const allowed = await ctx.timings.measure("db", () => repo.listAllowed(guarded.map((r) => r.id)));
  if (!allowed.ok) return null;
  const byItem = new Map<string, string[]>();
  for (const row of allowed.value) byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row.memberId]);
  const answerers = new Map<string, string | null>();
  for (const record of guarded) {
    const member = await inGroup(ctx, record.orgId!, record.paidBy);
    if (member === null) return null;
    answerers.set(record.id, member ? record.paidBy : null);
  }
  return (record) =>
    answerers.has(record.id) ? { allowed: byItem.get(record.id) ?? [], answerer: answerers.get(record.id) ?? null } : null;
}

/** One item's rule (see readAskRules); null when it does not ask first, undefined on a failed read. */
export async function askRuleOf(
  ctx: Pick<RequestContext, "roster" | "timings">,
  repo: KitchenRepository,
  item: KitchenItemRecord,
): Promise<AskRule | null | undefined> {
  const rules = await readAskRules(ctx, repo, [item]);
  return rules ? rules(item) : undefined;
}

/** What an item read adds for an ask-first group item: who may use it, whether `viewer` must ask, and who answers. */
export function itemAskFields(
  record: KitchenItemRecord,
  rule: AskRule | null,
  viewer: string,
  viewerRole: string | null,
): Pick<KitchenItem, "allowed" | "mustAsk" | "answerer"> {
  if (!rule || record.askFirst !== true) return {};
  const manager = viewerRole !== null && MANAGE_ROLES.has(viewerRole);
  return { allowed: [...rule.allowed], mustAsk: mustAsk(record, rule, viewer, manager), answerer: rule.answerer };
}

/** May the caller manage the group's items (owner, admin)? The policy engine's answer; false on any failed hop. */
export async function managesItems(ctx: RequestContext, orgId: string): Promise<boolean> {
  const denied = await ctx.timings.measure("authz", () =>
    requireOrgAction(ctx.env, ctx.requestId, ctx.actor, orgId as Uuid, "kitchen.item.manage"),
  );
  return denied === null;
}

/** 403: the caller must ask first. Nothing was written. */
export function askFirstRefused(requestId: string, item: KitchenItemRecord, rule: AskRule): Response {
  return errorResponse("forbidden", "Ask first: whoever bought this asks to be asked before it is used", 403, requestId, {
    reason: KITCHEN_ASK_ERROR_REASONS.ASK_FIRST,
    itemId: toPublicId("itm", item.id),
    answerer: rule.answerer,
  });
}

/**
 * The refusal for a caller who must ask before using `item` (403
 * `ask_first`), or null when they may use it: not ask-first, theirs, allowed,
 * or theirs to answer. With `managers`, an owner or admin may always (the
 * stock check). The policy engine is asked only when the answer depends on it.
 */
export async function askFirstRefusal(
  ctx: RequestContext,
  repo: KitchenRepository,
  item: KitchenItemRecord,
  options: { managers?: boolean } = {},
): Promise<Response | null> {
  if (item.ownerKind !== "group" || item.orgId === null || item.askFirst !== true) return null;
  const actor = ctx.actor.subjectId;
  if (actor === item.paidBy) return null;
  const rule = await askRuleOf(ctx, repo, item);
  if (rule === undefined) return unavailable(ctx.requestId);
  if (!rule || rule.allowed.includes(actor)) return null;
  if ((rule.answerer === null || options.managers) && (await managesItems(ctx, item.orgId))) return null;
  return askFirstRefused(ctx.requestId, item, rule);
}

// ── An ask, as the API shows it ────────────────────────────

/** What an ask reads as at `now`: what was decided, or lapsed for a pending one that can no longer be answered. */
export function askStateOf(read: KitchenAskRead, now: Date): AskState {
  if (read.ask.state === "pending" && !askIsLive(read.ask, read.item, now)) return "lapsed";
  return read.ask.state;
}

/** What using `qtyMilli` of the item costs now: of what is left, at most all of it; nothing once it is finished. */
function costNow(item: KitchenItemRecord, qtyMilli: number): number {
  const take = Math.min(qtyMilli, item.qtyLeftMilli);
  return item.state === "active" && take > 0 ? costOfUse(item, take) : 0;
}

/** Of a use's cost, what comes back to the buyer: the cost less their own share when they had some. */
export function backToBuyer(costMinor: number, buyer: string, consumers: readonly string[], weights: readonly number[] | null): number {
  if (costMinor <= 0 || consumers.length === 0) return 0;
  const splits = buildUse({ costMinor, buyerId: buyer, consumers, ...(weights ? { weights } : {}) });
  const own = splits.find((s) => s.subjectId === buyer);
  return own ? own.paidMinor - own.owedMinor : 0;
}

/** How an ask's amount reads: its measure's words, else the quantity in its unit ("250 ml"). */
export function askAmount(read: KitchenAskRead): string {
  return read.ask.label ?? formatQuantity(read.ask.qtyMilli, read.item.dimension, read.ask.unit);
}

/** What a read needs beside the ask: the clock, the group, the item's answerer and everyone's names. */
export interface AskView {
  now: Date;
  group: MemberGroup;
  /** The item's answerer now (AskRule.answerer). */
  answerer: string | null;
  names: ReadonlyMap<string, DisplayName>;
}

export function toKitchenAsk(read: KitchenAskRead, view: AskView): KitchenAsk {
  const { ask, item } = read;
  const costMinor = ask.moveCostMinor ?? costNow(item, ask.qtyMilli);
  const itemId = toPublicId("itm", item.id);
  const name = (who: string | null) => (who ? (view.names.get(who) ?? null) : null);
  return {
    id: toPublicId("ask", ask.id),
    orgId: view.group.publicId,
    item: {
      id: itemId,
      ref: `org:${view.group.publicId}:${itemId}`,
      name: item.name,
      pantry: groupPantryRef(view.group),
      displayUnit: item.displayUnit,
      qtyLeftMilli: item.qtyLeftMilli,
      qtyLeft: displayQuantity(item.qtyLeftMilli, item.displayUnit),
      state: item.state,
    },
    asker: ask.askerId,
    askerName: name(ask.askerId),
    qtyMilli: ask.qtyMilli,
    quantity: displayQuantity(ask.qtyMilli, ask.unit),
    unit: ask.unit,
    label: ask.label,
    amount: askAmount(read),
    consumers: [...ask.consumers],
    consumerNames: ask.consumers.map(name),
    weights: ask.weights ? [...ask.weights] : null,
    source: ask.source,
    state: askStateOf(read, view.now),
    createdAt: ask.createdAt.toISOString(),
    expiresAt: ask.expiresAt.toISOString(),
    answeredAt: ask.answeredAt ? ask.answeredAt.toISOString() : null,
    answeredBy: ask.answeredBy,
    answerer: view.answerer,
    answererName: name(view.answerer),
    paidBy: item.paidBy,
    costMinor,
    backMinor: backToBuyer(costMinor, item.paidBy, ask.consumers, ask.weights),
    currency: item.currency,
    enough: item.state === "active" && ask.qtyMilli <= item.qtyLeftMilli,
    moveId: ask.moveId ? toPublicId("mov", ask.moveId) : null,
    txnId: ask.txnId ? toPublicId("txn", ask.txnId) : null,
  };
}

/** Everyone an ask names, for one names lookup: the asker, who will have it, the buyer and whoever answered. */
export function askPeople(read: KitchenAskRead, answerer: string | null): string[] {
  const { ask, item } = read;
  return [ask.askerId, ...ask.consumers, item.paidBy, ...(answerer ? [answerer] : []), ...(ask.answeredBy ? [ask.answeredBy] : [])];
}

// ── The request ────────────────────────────────────────────

export interface ParsedAsk {
  use: Pick<ParsedUse, "quantity" | "unit" | "measure">;
  /** Null: the caller. */
  consumers: string[] | null;
  weights: number[] | null;
  source: AskSource;
}

/** A POST …/items/{itm}/asks body: an amount and who will have it, as a use takes them, and where it was asked from. */
export function parseAsk(body: Record<string, unknown>): { ok: true; value: ParsedAsk } | { ok: false; fields: FieldErrors } {
  const use = parseUse(body, { group: true });
  const fields = new Fields();
  let source: AskSource = "pantry";
  if (body.source !== undefined && body.source !== null) {
    if (typeof body.source === "string" && (ASK_SOURCES as readonly string[]).includes(body.source)) source = body.source as AskSource;
    else fields.add("source", `Must be one of: ${ASK_SOURCES.join(", ")}`);
  }
  if (!use.ok) return { ok: false, fields: { ...use.fields, ...fields.errors } };
  if (!fields.ok) return { ok: false, fields: fields.errors };
  const { quantity, unit, measure, consumers, weights } = use.value;
  return { ok: true, value: { use: { quantity, unit, measure }, consumers, weights, source } };
}

// ── Pushes ─────────────────────────────────────────────────

/** "₹12" for a whole amount, else "₹12.50". */
function money(minor: number, currency: string): string {
  return formatMinor(minor, currency).replace(/\.00$/, "");
}

/** "saffron" for "Saffron"; a name in capitals ("MDH masala") stays as it is. */
function itemWord(name: string): string {
  const second = name.charAt(1);
  return second && second === second.toLowerCase() && second !== second.toUpperCase() ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

/** "Dev", "Dev and Anu", "Dev, Anu and you". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** A person's name in a push: their display name, "you" for whoever hears it, else "Someone". */
function nameIn(who: string, hearer: string, names: ReadonlyMap<string, DisplayName>, you = "you"): string {
  if (who === hearer) return you;
  return names.get(who) ?? "Someone";
}

/**
 * The push an answerer hears when someone asks: "Dev asks for 1 pinch of
 * your saffron", "For Dev and Anu · ₹12 to you", opening /home?ask=<id>. An
 * owner or admin answering for a buyer who has left hears "… of the saffron"
 * and "₹12 to Meera".
 */
export function askedPush(read: KitchenAskRead, ask: KitchenAsk, hearer: string, names: ReadonlyMap<string, DisplayName>): PushToSubjectRequest {
  const buyer = read.item.paidBy;
  const whose = hearer === buyer ? "your" : "the";
  const asker = names.get(ask.asker) ?? "Someone";
  const forWhom = joinNames(ask.consumers.map((c) => nameIn(c, hearer, names)));
  const back = ask.backMinor > 0 ? ` · ${money(ask.backMinor, ask.currency)} to ${hearer === buyer ? "you" : (names.get(buyer) ?? "the buyer")}` : "";
  return {
    subjectId: hearer,
    message: {
      kind: KITCHEN_ASK_PUSH_KIND,
      title: clip(`${asker} asks for ${ask.amount} of ${whose} ${itemWord(read.item.name)}`, 100),
      body: clip(`For ${forWhom}${back}`, 200),
      url: askPushUrl(ask.id),
      tag: ask.id,
    },
  };
}

/**
 * The push the asker hears when their ask is answered: "Meera said yes · 1
 * pinch of saffron logged", or "Meera said no to the saffron"; its text is
 * the group's name, and it opens the item.
 */
export function answeredPush(read: KitchenAskRead, ask: KitchenAsk, approved: { amount: string } | null, names: ReadonlyMap<string, DisplayName>): PushToSubjectRequest {
  const who = (ask.answeredBy ? names.get(ask.answeredBy) : null) ?? "Someone";
  const what = itemWord(read.item.name);
  return {
    subjectId: ask.asker,
    message: {
      kind: KITCHEN_ASK_PUSH_KIND,
      title: clip(approved ? `${who} said yes · ${approved.amount} of ${what} logged` : `${who} said no to the ${what}`, 100),
      body: clip(ask.item.pantry.name, 200),
      url: `/pantry/${ask.item.ref}`,
      tag: ask.id,
    },
  };
}
