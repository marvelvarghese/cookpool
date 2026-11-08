// Cooked, then split later (Cookpool CM-8, cookpool-community design §2a):
// which group Home's split reminder suggests for one of the cook's own
// dishes, and the reminder itself — pure functions over what the inbox read.
//
// A group can take the dish when the cook cooks there (their role holds
// kitchen.dish.cook — every role but viewer, the same set as USE_ROLES) and
// it counts in the dish's currency, or has no currency yet (splitting pins it
// to the dish's, as cooking into it would). Among those: the group whose
// pantry the dish took most from, by cost (then by how many items, then by
// name); else the group the cook last cooked a dish for; else their first
// group by name. No group, no reminder: there is nowhere to split it.

import type { SplitReminderInboxItem, SplitSuggestReason } from "@saas/contracts/kitchen";
import type { KitchenDishRecord } from "@saas/db/kitchen";
import { canUseIn, type MemberGroup } from "./groups-client.js";
import { toPublicId } from "./ids.js";

/**
 * The groups `dish` could be split with, in the caller's order (by name):
 * where they cook, counting in its currency or in none yet. `currencies`
 * holds the groups that have settings.
 */
export function splitTargets(
  dish: Pick<KitchenDishRecord, "currency">,
  groups: readonly MemberGroup[],
  currencies: ReadonlyMap<string, string>,
): MemberGroup[] {
  return groups.filter((g) => canUseIn(g) && (currencies.get(g.orgId) ?? dish.currency) === dish.currency);
}

/** The group to suggest for `dish` among `targets`, and why; null when there is none. */
export function suggestGroup(
  dish: Pick<KitchenDishRecord, "ingredients">,
  targets: readonly MemberGroup[],
  latestOrg: string | null,
): { group: MemberGroup; why: SplitSuggestReason } | null {
  if (targets.length === 0) return null;
  const used = new Map<string, { cost: number; count: number }>();
  for (const i of dish.ingredients) {
    if (!i.orgId) continue;
    const entry = used.get(i.orgId) ?? { cost: 0, count: 0 };
    entry.cost += i.costMinor;
    entry.count += 1;
    used.set(i.orgId, entry);
  }
  let best: { group: MemberGroup; cost: number; count: number } | null = null;
  for (const group of targets) {
    const u = used.get(group.orgId);
    if (!u) continue;
    // Strictly more wins, so equal groups keep the caller's (name) order.
    if (!best || u.cost > best.cost || (u.cost === best.cost && u.count > best.count)) best = { group, ...u };
  }
  if (best) return { group: best.group, why: "used_items" };
  const recent = latestOrg ? targets.find((g) => g.orgId === latestOrg) : undefined;
  return { group: recent ?? targets[0]!, why: "recent" };
}

/** Home's reminder to split `dish` with `suggest`. */
export function splitReminderItem(
  dish: KitchenDishRecord,
  suggest: { group: MemberGroup; why: SplitSuggestReason },
): SplitReminderInboxItem {
  return {
    kind: "split_reminder",
    dish: {
      id: toPublicId("dsh", dish.id),
      name: dish.name,
      portionsHalf: dish.portionsHalf,
      totalMinor: dish.totalMinor,
      currency: dish.currency,
      cookedAt: dish.cookedAt.toISOString(),
      state: dish.state === "finalized" ? "finalized" : "draft",
      groupItems: dish.ingredients.filter((i) => i.orgId !== null).length,
    },
    suggest: {
      orgId: suggest.group.publicId,
      groupName: suggest.group.name,
      groupSlug: suggest.group.slug,
      why: suggest.why,
    },
  };
}

/**
 * Every reminder for `dishes` (the cook's own unsplit dishes worth one,
 * newest first), each with its group; a dish with nowhere to go has none.
 * `latestOrg` is read only when some dish took nothing from a target group.
 */
export async function splitReminders(
  dishes: readonly KitchenDishRecord[],
  groups: readonly MemberGroup[],
  currencies: ReadonlyMap<string, string>,
  latestOrg: (orgIds: readonly string[]) => Promise<string | null>,
): Promise<SplitReminderInboxItem[]> {
  const planned = dishes.map((dish) => ({ dish, targets: splitTargets(dish, groups, currencies) }));
  const needsRecent = planned.some(
    ({ dish, targets }) => targets.length > 0 && !dish.ingredients.some((i) => i.orgId && targets.some((g) => g.orgId === i.orgId)),
  );
  const cookable = groups.filter(canUseIn).map((g) => g.orgId);
  const latest = needsRecent ? await latestOrg(cookable) : null;
  return planned.flatMap(({ dish, targets }) => {
    const suggest = suggestGroup(dish, targets, latest);
    return suggest ? [splitReminderItem(dish, suggest)] : [];
  });
}

