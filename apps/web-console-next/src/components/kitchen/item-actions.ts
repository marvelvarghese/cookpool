/**
 * What a held item offers (Cookpool PW-8, design §5, the canvas's
 * AppGestures): press and hold a Pantry row or one of Home's use-soon rows
 * and a sheet lists Use [your usual] · Use some… · Cook with it · Wasted ·
 * Open. Its twin is opening the item, whose page has all of them. Pure, so
 * it is unit-testable.
 */

import type { KitchenItem } from "@saas/contracts/kitchen";
import { itemHref, parseItemRef, quickUseHref, type ItemRef } from "./pantry";
import { cookHref } from "./dish-maker";

export type ItemActionId = "use" | "use-some" | "cook" | "waste" | "open";

export interface ItemAction {
  id: ItemActionId;
  /** "Use 2 onions", "Use some…", "Cook with it", "Wasted", "Open". */
  label: string;
  /** Where a link goes; null for what happens in place (the use, the waste confirm). */
  href: string | null;
}

/** What swiping a pantry row left says: "Use 2 onions" (your usual, logged at once), or "Use" (opens Use). */
export function swipeUseLabel(usualWords: string | null | undefined): string {
  return usualWords ? `Use ${usualWords}` : "Use";
}

/**
 * The held item's menu, in the canvas's order. Using, cooking and wasting
 * need something left that you may use (not a viewer's item, not one used
 * up or already wasted); "Use [usual]" needs a usual that fits, which is
 * exactly what the row's own Use button logs. Open is always there. An item
 * not read yet (Home, a moment after it loads) offers what needs no item.
 */
export function itemActions(input: {
  item: (Pick<KitchenItem, "state" | "qtyLeftMilli"> & { canUse?: boolean }) | null;
  ref: ItemRef;
  /** "2 onions" when the row's button logs your usual at once; null when it opens Use. */
  usualWords: string | null;
}): ItemAction[] {
  const { item, ref, usualWords } = input;
  const open: ItemAction = { id: "open", label: "Open", href: itemHref(ref) };
  if (!item || item.state !== "active" || item.qtyLeftMilli <= 0 || item.canUse === false) return [open];
  const out: ItemAction[] = [];
  if (usualWords) out.push({ id: "use", label: swipeUseLabel(usualWords), href: null });
  out.push(
    { id: "use-some", label: "Use some…", href: quickUseHref(ref) },
    { id: "cook", label: "Cook with it", href: cookHref(ref) },
    { id: "waste", label: "Wasted", href: null },
    open,
  );
  return out;
}

/** The item an item page's address names (`/pantry/me:itm_…`), or null for any other address. */
export function itemRefFromHref(href: string): ItemRef | null {
  const m = /^\/pantry\/([^/?#]+)/.exec(href);
  return m ? parseItemRef(m[1]) : null;
}
