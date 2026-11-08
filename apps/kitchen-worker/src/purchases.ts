// Shopping runs (PN-3, cookpool-pantry design §6.4): reading a run's lines,
// what a line copies from the item it buys again, and its items as the API
// shows them.

import {
  DEFAULT_KITCHEN_CURRENCY,
  PURCHASE_MAX_LINES,
  type KitchenItem,
  type WastePolicy,
} from "@saas/contracts/kitchen";
import type { Uuid } from "@saas/db/ids";
import type { KitchenItemRecord, KitchenRepository } from "@saas/db/kitchen";
import type { RequestContext } from "./context.js";
import type { MemberGroup } from "./groups-client.js";
import { parseOrgPublicId, parsePublicId } from "./ids.js";
import { readMeasures } from "./measures.js";
import { groupPantryRef, isoDay, parseNewItem, personalPantryRef, toKitchenItem, wastePolicyOf, type ParsedNewItem } from "./pantry.js";
import { Fields, type FieldErrors } from "./validate.js";
import { itemAskFields, readAskRules } from "./asks.js";

/** A line's pantry: the caller's own, or a group (by its stored UUID). */
export type LinePantry = { kind: "personal" } | { kind: "group"; orgId: Uuid };

/** One line of a run, read and checked. */
export interface ParsedLine {
  /** Its position in `lines`: field errors and keys name it. */
  index: number;
  pantry: LinePantry;
  /** As Add item reads it; `paidBy` and `boughtOn` are never taken from a line. */
  item: ParsedNewItem;
  /** Did the line send `wastePolicy` (null included)? Otherwise it may be copied. */
  wastePolicySent: boolean;
  fromItemId: Uuid | null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

function linePantry(fields: Fields, at: string, value: unknown): LinePantry | undefined {
  if (value === "personal") return { kind: "personal" };
  const orgId = typeof value === "string" ? parseOrgPublicId(value) : null;
  if (orgId) return { kind: "group", orgId };
  return fields.add(`${at}.pantry`, "Must be personal, or a group's org_ id");
}

/**
 * The body of POST /v1/kitchen/me/purchases: `lines`, 1 to
 * PURCHASE_MAX_LINES, each as Add item takes it plus `pantry` and an
 * optional `fromItemId`. Every line is paid by the caller and bought today:
 * a line's `paidBy` and `boughtOn` are ignored. Every field that fails is
 * named under `lines[i].`.
 */
export function parsePurchase(body: Record<string, unknown>): Parsed<ParsedLine[]> {
  const fields = new Fields();
  const raw = body.lines;
  if (!Array.isArray(raw)) {
    fields.add("lines", `Must be a list of 1 to ${PURCHASE_MAX_LINES} lines`);
    return { ok: false, fields: fields.errors };
  }
  if (raw.length === 0 || raw.length > PURCHASE_MAX_LINES) {
    fields.add("lines", `Must have 1 to ${PURCHASE_MAX_LINES} lines`);
    return { ok: false, fields: fields.errors };
  }
  const lines: ParsedLine[] = [];
  raw.forEach((value: unknown, index) => {
    const at = `lines[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) return fields.add(at, "Must be an object");
    const line = value as Record<string, unknown>;
    const pantry = linePantry(fields, at, line.pantry);
    const group = pantry?.kind === "group";
    // A line's settings come from the item it buys again (fromItemId), never from the line: askFirst and allowed are not read.
    const item = parseNewItem({ ...line, paidBy: undefined, boughtOn: undefined, askFirst: undefined, allowed: undefined }, { group });
    if (!item.ok) {
      for (const [field, messages] of Object.entries(item.fields)) for (const message of messages) fields.add(`${at}.${field}`, message);
    }
    let fromItemId: Uuid | null = null;
    if (line.fromItemId !== undefined && line.fromItemId !== null) {
      fromItemId = typeof line.fromItemId === "string" ? parsePublicId("itm", line.fromItemId) : null;
      if (!fromItemId) fields.add(`${at}.fromItemId`, "Must be an item's itm_ id, or null");
    }
    if (!pantry || !item.ok || (line.fromItemId !== undefined && line.fromItemId !== null && !fromItemId)) return;
    lines.push({ index, pantry, item: item.value, wastePolicySent: group && line.wastePolicy !== undefined, fromItemId });
  });
  return fields.ok ? { ok: true, value: lines } : { ok: false, fields: fields.errors };
}

/** The settings a line's item is created with, beyond what the line itself says. */
export interface InheritedSettings {
  /** Group items only: null follows the group. */
  wastePolicy: WastePolicy | null;
  /** Ask before use (PN-8): the new pack asks first too. */
  askFirst: boolean;
  /** …and lets the same people use it without asking. */
  allowed: string[];
}

/**
 * What a line copies from the item it buys again (`fromItemId`). Settings
 * are a pantry's, so they are copied only when that item is in the line's
 * own group: its waste rule, unless the line sends its own, and — from an
 * ask-first item (PN-8, design §8.1) — "Ask me first" and who never needs to
 * ask (`allowed`, that item's list). The new pack is the caller's: they pay
 * for it, so they are the one asked. A personal line has none.
 */
export function inheritedSettings(line: ParsedLine, from: KitchenItemRecord | null, allowed: readonly string[] = []): InheritedSettings {
  const none: InheritedSettings = { wastePolicy: null, askFirst: false, allowed: [] };
  if (line.pantry.kind !== "group") return none;
  const sameGroup = from !== null && from.ownerKind === "group" && from.orgId === line.pantry.orgId;
  const asks = sameGroup && from.askFirst === true ? { askFirst: true, allowed: [...allowed] } : { askFirst: false, allowed: [] };
  if (line.wastePolicySent) return { wastePolicy: line.item.wastePolicy, ...asks };
  return { wastePolicy: sameGroup ? from.wastePolicy : null, ...asks };
}

/** The currency a line's item is in: its group's, or what a personal line names (INR by default). */
export function lineCurrency(line: ParsedLine, groupCurrencies: ReadonlyMap<string, string>): string {
  if (line.pantry.kind === "group") return groupCurrencies.get(line.pantry.orgId) ?? DEFAULT_KITCHEN_CURRENCY;
  return line.item.currency ?? DEFAULT_KITCHEN_CURRENCY;
}

/**
 * Items as the API shows them, each with its pantry: their groups' waste
 * rules in one read and their measures in one more, side by side. Items in a
 * group the caller is no longer in are left out. Null on a read failure.
 */
export async function presentItems(
  ctx: RequestContext,
  repo: KitchenRepository,
  groups: ReadonlyMap<string, MemberGroup>,
  records: readonly KitchenItemRecord[],
): Promise<KitchenItem[] | null> {
  const visible = records.filter((r) => r.orgId === null || groups.has(r.orgId));
  const orgIds = [...new Set(visible.flatMap((r) => (r.orgId ? [r.orgId] : [])))];
  const [settings, measures, asks] = await Promise.all([
    ctx.timings.measure("db", () => repo.listGroupSettings(orgIds)),
    readMeasures(ctx, repo, visible),
    readAskRules(ctx, repo, visible),
  ]);
  if (!settings.ok || !measures || !asks) return null;
  const rules = new Map(settings.value.map((s) => [s.orgId, s.wastePolicy]));
  const today = isoDay(ctx.now());
  return visible.map((record) => {
    if (record.orgId === null) return toKitchenItem(record, personalPantryRef(), null, today, measures(record));
    const group = groups.get(record.orgId)!;
    const ask = itemAskFields(record, asks(record), ctx.actor.subjectId, group.role);
    return toKitchenItem(record, groupPantryRef(group), rules.get(record.orgId) ?? wastePolicyOf(null), today, measures(record), ask);
  });
}
