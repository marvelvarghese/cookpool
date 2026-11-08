// Restocking (PN-3, cookpool-pantry design §6.4): what the restock read and
// the shopping run share — which pantries the caller may add to, the read's
// names sorted into its three groups, the shape of "last time", and the
// repositories over the request's D1.

import {
  RESTOCK_MAX_LINES,
  RESTOCK_USUAL_MIN_TIMES,
  type FinishedRestockLine,
  type PantryRef,
  type RestockLast,
  type RestockResponse,
  type RunningLowRestockLine,
  type UsualRestockLine,
} from "@saas/contracts/kitchen";
import { createSqlExecutor } from "@saas/db/d1";
import {
  createKitchenRepository,
  createPurchasesRepository,
  type KitchenItemRecord,
  type KitchenRepository,
  type KitchenRestockName,
  type PurchasesRepository,
} from "@saas/db/kitchen";
import type { RequestContext } from "./context.js";
import { USE_ROLES, type MemberGroup } from "./groups-client.js";
import { unavailable } from "./http.js";
import { toPublicId } from "./ids.js";
import { daysBetween, groupPantryRef, personalPantryRef } from "./pantry.js";

export interface RestockRepos {
  kitchen: KitchenRepository;
  purchases: PurchasesRepository;
}

/**
 * Run `fn` with the kitchen and purchases repositories over one executor on
 * the request's D1 binding. A missing binding or anything `fn` throws is a
 * 503; the executor is always disposed.
 */
export async function withRestockRepos(
  ctx: Pick<RequestContext, "env" | "requestId">,
  fn: (repos: RestockRepos) => Promise<Response>,
): Promise<Response> {
  if (!ctx.env.PLATFORM_DB) return unavailable(ctx.requestId);
  const executor = createSqlExecutor(ctx.env.PLATFORM_DB);
  try {
    return await fn({ kitchen: createKitchenRepository(executor), purchases: createPurchasesRepository(executor) });
  } catch {
    return unavailable(ctx.requestId);
  } finally {
    await executor.dispose();
  }
}

/**
 * May someone with this membership add to the group's pantry? The policy
 * engine grants `kitchen.item.create` to the same roles as
 * `kitchen.item.use` (owner, admin, builder; tests/kitchen-worker pins it),
 * so the read says it without a policy hop per group. The shopping run
 * itself still asks the policy engine for every group it writes to.
 */
export function canAddIn(group: Pick<MemberGroup, "role">): boolean {
  return USE_ROLES.has(group.role);
}

/** A pantry as the caller reaches it. */
export interface Reach {
  pantry: PantryRef;
  canAdd: boolean;
}

/** Where a stored name is, as the caller reaches it: their own pantry, or one of `groups`; null otherwise. */
export function reachIn(groups: ReadonlyMap<string, MemberGroup>): (orgId: string | null) => Reach | null {
  return (orgId) => {
    if (orgId === null) return { pantry: personalPantryRef(), canAdd: true };
    const group = groups.get(orgId);
    return group ? { pantry: groupPantryRef(group), canAdd: canAddIn(group) } : null;
  };
}

/** The latest purchase as a line fills itself from it ("like last time"). */
export function restockLast(record: KitchenItemRecord): RestockLast {
  return {
    itemId: toPublicId("itm", record.id),
    quantityMilli: record.qtyBoughtMilli,
    unit: record.displayUnit,
    priceMinor: record.priceMinor,
    currency: record.currency,
    wastePolicy: record.ownerKind === "group" ? record.wastePolicy : null,
    expiresAfterDays: record.expiresOn ? daysBetween(record.boughtOn, record.expiresOn) : null,
    paidBy: record.paidBy,
  };
}

/** The median of the gaps, in days, between consecutive days (oldest first); null with fewer than two days. */
export function medianGap(days: readonly string[]): number | null {
  if (days.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) gaps.push(daysBetween(days[i - 1]!, days[i]!));
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

/**
 * A usual purchase that is due: bought on at least RESTOCK_USUAL_MIN_TIMES
 * days, and at least the median gap (rounded, at least a day) since the
 * last. Null otherwise.
 */
export function dueUsual(
  days: readonly string[],
  lastBoughtOn: string,
  today: string,
): { everyDays: number; lastBoughtAt: string; times: number; overdue: number } | null {
  if (days.length < RESTOCK_USUAL_MIN_TIMES) return null;
  const median = medianGap(days);
  if (median === null) return null;
  const everyDays = Math.max(1, Math.round(median));
  const elapsed = daysBetween(lastBoughtOn, today);
  if (elapsed < everyDays) return null;
  return { everyDays, lastBoughtAt: lastBoughtOn, times: days.length, overdue: elapsed / everyDays };
}

const byName = (a: { name: string; pantry: PantryRef }, b: { name: string; pantry: PantryRef }) =>
  a.name.localeCompare(b.name) || a.pantry.name.localeCompare(b.pantry.name);

/**
 * The read's names in the three groups: each name and pantry once, in the
 * first it qualifies for — finished, then running low, then usual (only in
 * a pantry the caller can add to). Names outside `reach` are left out.
 */
export function restockLines(
  names: readonly KitchenRestockName[],
  reach: (orgId: string | null) => Reach | null,
  today: string,
): RestockResponse {
  const finished: FinishedRestockLine[] = [];
  const runningLow: Array<RunningLowRestockLine & { share: number }> = [];
  const usual: Array<UsualRestockLine & { overdue: number }> = [];
  for (const name of names) {
    const where = reach(name.orgId);
    if (!where) continue;
    const base = {
      name: name.last.name,
      nameKey: name.nameKey,
      category: name.last.category,
      pantry: where.pantry,
      canAdd: where.canAdd,
      last: restockLast(name.last),
    };
    if (name.finished) {
      const { item, at } = name.finished;
      finished.push({
        ...base,
        reason: "finished",
        why: { finishedAt: at.toISOString(), how: item.state === "wasted" ? "wasted" : "used_up", itemId: toPublicId("itm", item.id) },
      });
    } else if (name.low) {
      const low = name.low;
      runningLow.push({
        ...base,
        reason: "running_low",
        why: { leftQtyMilli: low.qtyLeftMilli, boughtQtyMilli: low.qtyBoughtMilli, itemId: toPublicId("itm", low.id) },
        share: low.qtyLeftMilli / low.qtyBoughtMilli,
      });
    } else if (where.canAdd && name.aboveLow === 0) {
      const due = dueUsual(name.boughtDays, name.last.boughtOn, today);
      if (due) {
        const { overdue, ...why } = due;
        usual.push({ ...base, reason: "usual", why, overdue });
      }
    }
  }
  finished.sort((a, b) => b.why.finishedAt.localeCompare(a.why.finishedAt) || byName(a, b));
  runningLow.sort((a, b) => a.share - b.share || byName(a, b));
  usual.sort((a, b) => b.overdue - a.overdue || byName(a, b));
  return {
    finished: finished.slice(0, RESTOCK_MAX_LINES),
    runningLow: runningLow.slice(0, RESTOCK_MAX_LINES).map(({ share: _share, ...line }) => line),
    usual: usual.slice(0, RESTOCK_MAX_LINES).map(({ overdue: _overdue, ...line }) => line),
  };
}
