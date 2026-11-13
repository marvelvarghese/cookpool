/**
 * Home in each frame (cookpool-recipes RC-2, design §1.3–§1.4), as data: the
 * sections each frame's Home shows, in order, and the new frame's To do
 * order. `/home` picks its component when it renders (`newFrame()`); both
 * read their sections from here, so what each frame shows is unit-tested.
 *
 * The new Home (`NewHome`; since cookpool-home HM-2 the calm boards): "Hi,
 * Rahul" and the pill; the quick actions; Needs you; one Cook tonight card.
 * It has no money card (money lives in Money, and a debt that needs you is a
 * To do) and no groups feed (HM-3 puts it on Kitchen).
 *
 * Dependency-free (contract types only), so it is unit-testable.
 */

import type { InboxItem, InboxResponse } from "@saas/contracts/kitchen";

export type HomeSection =
  /** "Hi, Rahul". */
  | "greeting"
  /** The one invitation to install the app (PW-2): from the device's second day, never once installed. */
  | "install"
  /** Today's money card: "You get back ₹62.50". */
  | "money"
  /** "What did you use?" and the row of your usuals. */
  | "quick-use"
  /** The calm Home's tiles (HM-2): Scan bill, Log use, Cook, Groceries. */
  | "quick-actions"
  /** One card: the first thing you can cook now (HM-2). */
  | "cook-tonight"
  /** What needs you: a dish to say how much you had, someone to pay, food to use soon. */
  | "todo"
  /** What you can cook now (RC-5/RC-8 fill it; nothing until then). */
  | "cook-now"
  /** Dishes finished in your groups in the last week. */
  | "from-groups"
  /** Today's Recent: the newest entries of your groups. */
  | "recent";

/** Today's Home (what prod shows): greeting, install, money, usuals, To do, Recent. */
export const TODAY_HOME_SECTIONS: readonly HomeSection[] = ["greeting", "install", "money", "quick-use", "todo", "recent"];

/**
 * The new frame's Home, in the calm boards' order (cookpool-home HM-2):
 * greeting, the quick actions (under the cooking session's strip), install,
 * Needs you, Cook tonight — no money, no groups feed.
 */
export const NEW_HOME_SECTIONS: readonly HomeSection[] = ["greeting", "quick-actions", "install", "todo", "cook-tonight"];

/** The sections Home shows in a frame, in order. */
export function homeSections(newFrame: boolean): readonly HomeSection[] {
  return newFrame ? NEW_HOME_SECTIONS : TODAY_HOME_SECTIONS;
}

/**
 * The new frame's To do order (the canvas): dishes first — an open dish to
 * claim, with its ½-step chips in the row, and your own to finalize — then
 * someone to pay, then food to use soon or past its date, then flags. Within
 * each, the server's order (most urgent first) is kept.
 */
const NEW_TODO_RANK: Record<InboxItem["kind"], number> = {
  claim_dish: 0,
  finalize_dish: 0,
  payment_due: 1,
  use_soon: 2,
  flag: 3,
};

export function newHomeTodoOrder<T extends Pick<InboxResponse, "items">>(res: T): T {
  const rank = (item: InboxItem) => NEW_TODO_RANK[item.kind] ?? 4;
  const items = res.items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map((x) => x.item);
  return { ...res, items };
}
