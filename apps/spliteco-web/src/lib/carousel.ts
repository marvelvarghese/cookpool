// The Itemized carousel's moves, as pure functions: one item per slide.

import { itemStatus } from "./itemized";
import type { ItemForm } from "./split-form";

/** A swipe of at least this many px moves to the next or previous item. */
export const SWIPE_THRESHOLD = 50;

/** Keep an index inside a list of `count` items (0 when empty). */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index));
}

/** Left (negative dx) is the next item, right the previous; under the threshold nothing. */
export function swipeDirection(dx: number, threshold = SWIPE_THRESHOLD): -1 | 0 | 1 {
  if (dx <= -threshold) return 1;
  if (dx >= threshold) return -1;
  return 0;
}

/** Where the carousel stands after removing the item at `removed`. */
export function indexAfterRemove(current: number, removed: number, countAfter: number): number {
  return clampIndex(removed < current ? current - 1 : current, countAfter);
}

/** Does this item stop Save (nobody on it, money left, more than it costs, no price)? */
export function itemHasProblem(item: ItemForm, members: readonly string[]): boolean {
  return itemStatus(item, members).tone === "bad";
}
