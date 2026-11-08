/**
 * Home in each frame (cookpool-recipes RC-2, design §1.3–§1.4), as data: the
 * sections each frame's Home shows, in order, and the new frame's To do
 * order. `/home` picks its component when it renders (`newFrame()`); both
 * read their sections from here, so what each frame shows is unit-tested.
 *
 * The new Home (`NewHome`, the canvas): "Hi, Rahul"; What did you use?; To
 * do; Cook now (hidden until RC-5 and RC-8 fill it); From your groups. It has
 * no money card: money lives in Money, and a debt that needs you is a To do.
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

/** The new frame's Home: greeting, install, What did you use?, To do, Cook now, From your groups — no money. */
export const NEW_HOME_SECTIONS: readonly HomeSection[] = ["greeting", "install", "quick-use", "todo", "cook-now", "from-groups"];

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
