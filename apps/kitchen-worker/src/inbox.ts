// The Home inbox (CP-19), as pure functions over what the handler read: the
// caller's open and draft dishes and those open in their groups, the items
// near their use-by date, each group's ledger and the open flags on their
// transactions. Each becomes one card with what its one-tap action needs;
// then the cards are put in order of urgency (see InboxResponse in
// @saas/contracts/kitchen). Money comes from the engine: a group's payments
// are its settle plan's, a portion's price is the engine's split of the total.

import type {
  ClaimDishInboxItem,
  FinalizeDishInboxItem,
  FlagInboxItem,
  InboxCounts,
  InboxDish,
  InboxItem,
  PaymentDueInboxItem,
  UseSoonInboxItem,
} from "@saas/contracts/kitchen";
import { INBOX_KINDS } from "@saas/contracts/kitchen";
import type { KitchenDishRecord, KitchenItemRecord, KitchenOpenFlagRecord, KitchenUsualRecord } from "@saas/db/kitchen";
import type { Payment } from "@saas/kitchen-engine/ledger";
import { splitByWeights } from "@saas/kitchen-engine/money";
import { isUnit } from "@saas/kitchen-engine/units";
import type { MemberGroup } from "./groups-client.js";
import type { DisplayName } from "./identity-client.js";
import { toPublicId } from "./ids.js";
import { daysBetween, displayQuantity, groupPantryRef, personalPantryRef } from "./pantry.js";
import { claimedHalfOf } from "./split.js";

/** The most open (and, separately, draft) dishes one inbox read takes, newest first. */
export const INBOX_DISHES_LIMIT = 50;
/** The most open flags one inbox read takes, oldest first. */
export const INBOX_FLAGS_LIMIT = 50;
/** How many of the caller's usuals are read to find the usual amount of each item close to its date. */
export const INBOX_USUALS_LIMIT = 100;

/**
 * The group roles whose grant holds `kitchen.dish.finalize` (design.md §6):
 * every role but viewer. A cook's own dish is offered for finalizing only
 * where they may still finalize it. tests/kitchen-worker pins it against the
 * engine.
 */
export const FINALIZE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "builder"]);

/**
 * The group roles whose grant holds `kitchen.settlement.create`: every role
 * but viewer. A payment due says whether the caller may record it.
 * tests/kitchen-worker pins it against the engine.
 */
export const SETTLE_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "builder"]);

// ── Dishes ─────────────────────────────────────────────────

/**
 * What one whole portion costs at a dish's price: two half portions' share
 * of the total by the engine's largest remainder (₹211.00 for 4 portions is
 * ₹52.75). A dish of half a portion has no whole one; its rate is twice its
 * total.
 */
export function perPortionMinor(totalMinor: number, portionsHalf: number): number {
  if (portionsHalf < 2) return totalMinor * 2;
  return splitByWeights(totalMinor, [2, portionsHalf - 2])[0]!;
}

function inboxDish(
  record: KitchenDishRecord,
  group: MemberGroup | null,
  names: ReadonlyMap<string, DisplayName>,
): InboxDish {
  const claimedHalf = claimedHalfOf(record.shares);
  return {
    id: toPublicId("dsh", record.id),
    orgId: record.orgId ? toPublicId("org", record.orgId) : null,
    groupName: group?.name ?? null,
    groupSlug: group?.slug ?? null,
    name: record.name,
    cook: record.cook,
    cookName: names.get(record.cook) ?? null,
    state: record.state as InboxDish["state"],
    splitMode: record.splitMode,
    portionsHalf: record.portionsHalf,
    claimedHalf,
    unclaimedHalf: Math.max(0, record.portionsHalf - claimedHalf),
    perPortionMinor: perPortionMinor(record.totalMinor, record.portionsHalf),
    totalMinor: record.totalMinor,
    currency: record.currency,
    cookedAt: record.cookedAt.toISOString(),
  };
}

/**
 * A dish the caller can claim: open, shared with a group where they may
 * claim (`claimGroups`), cooked by someone else, with no share of theirs yet
 * (a claim, or an amount the cook assigned them) and portions still free.
 */
export function isClaimable(record: KitchenDishRecord, me: string, claimGroups: ReadonlySet<string>): boolean {
  return (
    record.state === "open" &&
    record.orgId !== null &&
    claimGroups.has(record.orgId) &&
    record.cook !== me &&
    !record.shares.some((s) => s.subjectId === me) &&
    claimedHalfOf(record.shares) < record.portionsHalf
  );
}

/**
 * The caller's own dish waiting to be finalized: open or a draft, just for
 * them or shared with a group they are still in with a role that may
 * finalize it.
 */
export function isFinalizable(record: KitchenDishRecord, me: string, groups: ReadonlyMap<string, MemberGroup>): boolean {
  if (record.cook !== me || (record.state !== "open" && record.state !== "draft")) return false;
  if (record.orgId === null) return true;
  const group = groups.get(record.orgId);
  return group !== undefined && FINALIZE_ROLES.has(group.role);
}

export function claimDishItem(
  record: KitchenDishRecord,
  groups: ReadonlyMap<string, MemberGroup>,
  names: ReadonlyMap<string, DisplayName>,
): ClaimDishInboxItem {
  return { kind: "claim_dish", dish: inboxDish(record, groups.get(record.orgId!) ?? null, names) };
}

export function finalizeDishItem(
  record: KitchenDishRecord,
  groups: ReadonlyMap<string, MemberGroup>,
  names: ReadonlyMap<string, DisplayName>,
): FinalizeDishInboxItem {
  const group = record.orgId ? (groups.get(record.orgId) ?? null) : null;
  return { kind: "finalize_dish", dish: inboxDish(record, group, names) };
}

// ── Items to use soon ──────────────────────────────────────

/**
 * An item close to its use-by date, with the caller's usual amount of it.
 * `group` is the item's group (null for the caller's own pantry); the caller
 * may use it — the read only covers pantries they may use.
 */
export function useSoonItem(
  record: KitchenItemRecord,
  group: MemberGroup | null,
  usual: KitchenUsualRecord | undefined,
  today: string,
): UseSoonInboxItem {
  const id = toPublicId("itm", record.id);
  const usualUnit = usual?.lastUnit && isUnit(usual.lastUnit) ? usual.lastUnit : record.displayUnit;
  return {
    kind: "use_soon",
    item: {
      id,
      ref: group ? `org:${group.publicId}:${id}` : `me:${id}`,
      name: record.name,
      pantry: group ? groupPantryRef(group) : personalPantryRef(),
      orgId: group?.publicId ?? null,
      qtyLeftMilli: record.qtyLeftMilli,
      quantity: displayQuantity(record.qtyLeftMilli, record.displayUnit),
      unit: record.displayUnit,
      expiresOn: record.expiresOn!,
      daysToUseBy: daysBetween(today, record.expiresOn!),
      canUse: true,
    },
    usual: usual
      ? { quantity: displayQuantity(usual.lastQtyMilli, usualUnit), unit: usualUnit, qtyMilli: usual.lastQtyMilli }
      : null,
  };
}

// ── Payments due ───────────────────────────────────────────

/** The payments in a group's settle plan (the engine's `settlePlan`) that `me` makes. */
export function paymentsDue(
  me: string,
  group: MemberGroup,
  currency: string,
  payments: readonly Payment[],
  names: ReadonlyMap<string, DisplayName>,
): PaymentDueInboxItem[] {
  return payments
    .filter((p) => p.fromId === me && p.amountMinor > 0)
    .map((p) => ({
      kind: "payment_due",
      orgId: group.publicId,
      groupName: group.name,
      groupSlug: group.slug,
      toSubjectId: p.toId,
      toName: names.get(p.toId) ?? null,
      amountMinor: p.amountMinor,
      currency,
      canRecord: SETTLE_ROLES.has(group.role),
    }));
}

// ── Flags ──────────────────────────────────────────────────

export function flagItem(
  flag: KitchenOpenFlagRecord,
  group: MemberGroup,
  names: ReadonlyMap<string, DisplayName>,
): FlagInboxItem {
  return {
    kind: "flag",
    flagId: toPublicId("flg", flag.flagId),
    txnId: toPublicId("txn", flag.txnId),
    orgId: group.publicId,
    groupName: group.name,
    groupSlug: group.slug,
    title: flag.title,
    txnKind: flag.txnKind,
    totalMinor: flag.totalMinor,
    currency: flag.currency,
    dishId: flag.sourceKind === "dish" && flag.sourceId ? toPublicId("dsh", flag.sourceId) : null,
    flaggedBy: flag.flaggedBy,
    flaggedByName: names.get(flag.flaggedBy) ?? null,
    reason: flag.reason,
    flaggedAt: flag.flaggedAt.toISOString(),
  };
}

// ── Order and counts ───────────────────────────────────────

/** How urgent a card is: lower first (InboxResponse in @saas/contracts/kitchen lists the order). */
function urgency(item: InboxItem, today: string): number {
  switch (item.kind) {
    case "use_soon":
      return item.item.expiresOn <= today ? 0 : 3;
    case "claim_dish":
      return 1;
    case "finalize_dish":
      return 2;
    case "payment_due":
      return 4;
    case "flag":
      return 5;
  }
}

/** Within one urgency: the time (or amount) that orders it; ties keep the order the cards were read in. */
function within(a: InboxItem, b: InboxItem): number {
  if (a.kind === "use_soon" && b.kind === "use_soon") return a.item.expiresOn.localeCompare(b.item.expiresOn);
  if ((a.kind === "claim_dish" || a.kind === "finalize_dish") && (b.kind === "claim_dish" || b.kind === "finalize_dish")) {
    return a.dish.cookedAt.localeCompare(b.dish.cookedAt) || (a.dish.id < b.dish.id ? -1 : a.dish.id > b.dish.id ? 1 : 0);
  }
  if (a.kind === "payment_due" && b.kind === "payment_due") return b.amountMinor - a.amountMinor;
  if (a.kind === "flag" && b.kind === "flag") return a.flaggedAt.localeCompare(b.flaggedAt);
  return 0;
}

/** The cards most urgent first, then by time; a stable sort, so equal cards keep the order they were read in. */
export function inOrder(items: readonly InboxItem[], today: string): InboxItem[] {
  return items
    .map((item, index) => ({ item, index, rank: urgency(item, today) }))
    .sort((a, b) => a.rank - b.rank || within(a.item, b.item) || a.index - b.index)
    .map((x) => x.item);
}

export function countsOf(items: readonly InboxItem[]): InboxCounts {
  const counts = Object.fromEntries(INBOX_KINDS.map((k) => [k, 0])) as InboxCounts;
  counts.total = items.length;
  for (const item of items) counts[item.kind] += 1;
  return counts;
}
