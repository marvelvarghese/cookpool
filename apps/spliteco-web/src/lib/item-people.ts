// Who is on an itemized item, for big groups: a card shows only the people on
// it, and "+ Add" opens a picker over the rest of the group. Pure.

import type { BreakdownLine } from "@saas/kitchen-engine/splits";
import { DEFAULT_SHARE } from "./itemized";
import type { ItemForm } from "./split-form";

/** The people on an item, in the group's order. */
export function peopleOn(item: ItemForm, members: readonly string[]): string[] {
  return members.filter((m) => item.shares[m]);
}

/** Members not yet on the item whose name matches the search (case-insensitive, any part). */
export function pickable(item: ItemForm, members: readonly string[], nameOf: (id: string) => string, query: string): string[] {
  const q = query.trim().toLowerCase();
  return members.filter((m) => !item.shares[m] && (!q || nameOf(m).toLowerCase().includes(q)));
}

/** "Everyone": add every member not on it yet at one portion; people already on it keep their share. */
export function addEveryone(item: ItemForm, members: readonly string[]): ItemForm {
  const shares = { ...item.shares };
  for (const m of members) shares[m] ??= { ...DEFAULT_SHARE };
  return { ...item, shares };
}

/** "Same as last item": the previous item's people and shares, copied; null on the first item. */
export function sameAsLast(items: readonly ItemForm[], index: number, members: readonly string[]): ItemForm | null {
  const prev = items[index - 1];
  const item = items[index];
  if (!prev || !item) return null;
  const shares: ItemForm["shares"] = {};
  for (const m of members) if (prev.shares[m]) shares[m] = { ...prev.shares[m]! };
  return { ...item, shares };
}

/** The line under a card's faces. */
export function peopleLine(onCount: number, groupSize: number): string {
  if (onCount === 0) return "No one yet — tap Add";
  return `${onCount} of ${groupSize} ${groupSize === 1 ? "person" : "people"} in the group`;
}

/** Each person's share at the bottom: only people who owe something. */
export function sharesToShow(breakdown: readonly BreakdownLine[]): BreakdownLine[] {
  return breakdown.filter((b) => b.owedMinor > 0);
}
