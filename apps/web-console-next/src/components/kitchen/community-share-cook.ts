/**
 * Community's floating "Share a cook" (cookpool-revamp RV-18, the `RvCommunity`
 * board). A post is always made from a dish (CM-6), so the button lists your
 * latest cooks, and each opens the existing Share this cook? on its dish page
 * (`shareHref`, `?share=1`). Pure, so it is unit-testable.
 */

import type { KitchenDish } from "@saas/contracts/kitchen";
import { dishPostable, shareHref } from "./community-share";
import { capitalFirst, dayText } from "./when";

export const SHARE_A_COOK = "Share a cook";
/** How many of your latest cooks the sheet lists. */
export const SHARE_COOK_CHOICES = 5;
export const NO_COOKS_TO_SHARE = "Nothing cooked yet";
export const COOK_SOMETHING = { label: "Cook something", href: "/cook" } as const;

export interface ShareCookChoice {
  id: string;
  name: string;
  /** "Today", "Yesterday", "Tue". */
  when: string;
  href: string;
}

/**
 * Your latest postable cooks, newest first (the read is newest cooked
 * first): dishes you cooked, not canceled (`dishPostable`), at most `limit`.
 */
export function shareCookChoices(
  dishes: readonly Pick<KitchenDish, "id" | "cook" | "name" | "orgId" | "state" | "cookedAt">[],
  meId: string | null,
  now: Date,
  limit = SHARE_COOK_CHOICES,
): ShareCookChoice[] {
  if (!meId) return [];
  return dishes
    .filter((d) => d.cook === meId && dishPostable(d))
    .slice(0, limit)
    .map((d) => ({ id: d.id, name: d.name, when: capitalFirst(dayText(d.cookedAt, now)), href: shareHref(d.id) }));
}
