/**
 * Cooked, then post or split (cookpool-community CM-9, design §2a, the
 * canvas's `CookDone`), as data. The owner: "the dish posting and the group
 * splitting are two different features."
 *
 * - **Finish** (both cook-session paths, the new frame only) writes the dish
 *   as the cook's own — no group, no Who ate — at the servings the cook says,
 *   and lands on **Cooked!**: the dish page with `?cooked=1`.
 * - **Cooked!**: ✓, the name with the size and time, the stat tiles (steps,
 *   servings, cost · yours), the group-items note, then WHAT NEXT · ANY, IN
 *   ANY ORDER — Post to Community and Split with a group, each with its done
 *   state — and "Not now · done" / "Done".
 * - **Split with a group**: Who ate for this dish — the group picker
 *   (defaulting to the group whose items it used most), the eaters' steppers
 *   over the dish's servings — then CM-8's `splitDish` and the shares.
 * - **The dish page** offers Post and Split, whichever isn't done yet.
 * - **Home**: CM-8's `splitReminders` as "Split Chicken curry with Flat 4B?"
 *   with Split and Dismiss (Undo restores it); the just-me "Finalize" to-do
 *   is gone from the new frame.
 *
 * Pure (contract types, the engine and other pure modules), so unit-testable.
 */

import type {
  InboxResponse,
  KitchenDish,
  MyGroupBalance,
  SetDishSharesRequest,
  SplitDishRequest,
  SplitReminderInboxItem,
} from "@saas/contracts/kitchen";
import { scalePortions } from "@saas/contracts/kitchen";
import { formatMinor } from "@saas/kitchen-engine/money";
import { guideStepLog, type CookGuide } from "./cook-guide-draft";
import { cookingGroups, eaterShares, eaterView, orderCookingGroups, portionsText, startingHalves, type EaterView } from "./dish-maker";
import { dishHref } from "./dish";
import { shortMoney } from "./from-before";
import type { MemberNames } from "./members";
import { amountText, minutesText } from "./recipes";
import type { CachePatch } from "@/lib/optimistic";
import { qk } from "@/lib/query-keys";

// ── Where it lives ────────────────────────────────────────────────

/** Cooked! is a state of the dish page (static pages: no new route), at `?cooked=1`. */
export const COOKED_PARAM = "cooked";
/** The dish page with Split with a group open: `?split=1`, or `?split=org_…` to suggest that group (Home's reminder). */
export const SPLIT_PARAM = "split";

const ORG_ID = /^org_[A-Za-z0-9]{1,64}$/;

/** Where Finish lands in the new frame: Cooked! on the dish's page. */
export function cookedHref(dishId: string): string {
  return `${dishHref(dishId)}?${COOKED_PARAM}=1`;
}

/** The dish page with Split with a group open, suggesting `orgId` when given. */
export function splitHref(dishId: string, orgId?: string | null): string {
  return `${dishHref(dishId)}?${SPLIT_PARAM}=${orgId && ORG_ID.test(orgId) ? orgId : "1"}`;
}

/** `?split=` as read: open, with the group it suggests (or none). */
export function splitParam(raw: string | null | undefined): { open: boolean; orgId: string | null } {
  if (!raw) return { open: false, orgId: null };
  return { open: true, orgId: ORG_ID.test(raw) ? raw : null };
}

// ── Finish: the cook's own dish ───────────────────────────────────

/** Servings, as the server counts them for `ate` (CM-8): the portions rounded up, at least 1. */
export function servingsOf(portionsHalf: number): number {
  return Math.max(1, Math.ceil(portionsHalf / 2));
}

/** "1 serving", "4 servings", "1½ servings". */
export function servingsText(portionsHalf: number): string {
  const n = portionsText(Math.max(1, portionsHalf));
  return `${n} ${n === "1" || n === "½" ? "serving" : "servings"}`;
}

/** The most half portions a dish takes (the server's 100 portions). */
export const MAX_SERVINGS_HALF = 200;

/** How many it made, to start with: the recipe's serves at the size cooked, else one serving. */
export function startingServingsHalf(s: { servesHalf: number | null; factorMilli: number | null }): number {
  if (s.servesHalf === null || s.servesHalf <= 0) return 2;
  return Math.min(MAX_SERVINGS_HALF, scalePortions(s.servesHalf, s.factorMilli ?? 1000).portionsHalf);
}

/** Half a serving more or less: never below ½, never past MAX_SERVINGS_HALF. */
export function stepServings(half: number, delta: 1 | -1): number {
  return Math.max(1, Math.min(MAX_SERVINGS_HALF, half + delta));
}

/** Under Finish: "₹212.00 · 4 servings · yours" ("nothing costed" while it costs nothing). */
export function finishSub(totalMinor: number, currency: string, portionsHalf: number): string {
  const cost = totalMinor > 0 ? formatMinor(totalMinor, currency) : "Nothing costed";
  return `${cost} · ${servingsText(portionsHalf)} · yours`;
}

/** The guided Done screen's main button in the new frame (GC-5's "Who ate?" is now Split's, after Cooked). */
export const FINISH_TITLE = "Finish";

// ── What the session leaves for Cooked! ───────────────────────────

/** What the dish read doesn't carry: how long it took, and the steps done. */
export interface CookedSeed {
  /** Whole minutes (guided: the logged steps' total; else since the session started); null when unknown. */
  minutes: number | null;
  steps: { done: number; total: number } | null;
}

export const NO_SEED: CookedSeed = Object.freeze({ minutes: null, steps: null });

/** Longer than this since the session opened isn't a cooking time (a draft left overnight). */
const MAX_ELAPSED_MINUTES = 12 * 60;

/**
 * From a finished session: guided, the logged cook steps' time and how many
 * of its cook steps; otherwise the minutes since it started, and the recipe's
 * steps ticked (when it has any).
 */
export function cookedSeedOf(s: { startedAt: string; steps: readonly { done: boolean }[]; guide?: CookGuide | undefined }, now: Date): CookedSeed {
  const log = guideStepLog(s.guide);
  if (s.guide && log.length > 0) {
    const seconds = log.reduce((a, e) => a + Math.max(0, (Date.parse(e.doneAt) - Date.parse(e.startedAt)) / 1000), 0);
    const total = s.guide.steps.filter((st) => st.phase === "cook").length;
    return { minutes: Math.max(1, Math.round(seconds / 60)), steps: total > 0 ? { done: Math.min(log.length, total), total } : null };
  }
  const started = Date.parse(s.startedAt);
  const elapsed = Number.isNaN(started) ? null : Math.round((now.getTime() - started) / 60_000);
  const minutes = elapsed !== null && elapsed >= 1 && elapsed <= MAX_ELAPSED_MINUTES ? elapsed : null;
  const steps = s.steps.length > 0 ? { done: s.steps.filter((st) => st.done).length, total: s.steps.length } : null;
  return { minutes, steps };
}

/** Where Finish leaves the seed for Cooked! (this tab only: sessionStorage). */
export function cookedSeedKey(dishId: string): string {
  return `cookpool.cooked.${dishId}`;
}

/** A stored seed, as read back; NO_SEED for anything else. */
export function parseCookedSeed(raw: string | null | undefined): CookedSeed {
  if (!raw) return NO_SEED;
  try {
    const v = JSON.parse(raw) as Partial<CookedSeed>;
    const minutes = typeof v.minutes === "number" && v.minutes > 0 ? Math.round(v.minutes) : null;
    const s = v.steps;
    const steps = s && typeof s.done === "number" && typeof s.total === "number" && s.total > 0 ? { done: s.done, total: s.total } : null;
    return { minutes, steps };
  } catch {
    return NO_SEED;
  }
}

// ── Cooked! ───────────────────────────────────────────────────────

export const COOKED_TITLE = "Cooked!";
export const NEXT_HEADING = "What next · any, in any order";

export interface CookedTile {
  value: string;
  label: string;
}

export interface CookedView {
  /** "Chicken curry · 450 g · 48 min". */
  subtitle: string;
  /** Steps (when known), servings, cost · yours. */
  tiles: CookedTile[];
  /** "Saved as your dish. Onions and oil from Flat 4B's pantry are charged to you."; null when it took nothing from a group. */
  note: string | null;
}

/** The first letter in lower case, unless the word reads as a name ("MTR"). */
function softLower(name: string): string {
  return name.length > 1 && name.charAt(1) === name.charAt(1).toLowerCase() ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

/** "Onions", "Onions and oil", "Onions, oil and ginger", "Onions, oil and 2 more". */
function itemList(names: readonly string[]): string {
  const [first, ...rest] = names;
  if (first === undefined) return "";
  const all = [first, ...rest.map(softLower)];
  if (all.length === 1) return first;
  if (all.length <= 3) return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
  return `${all.slice(0, 2).join(", ")} and ${all.length - 2} more`;
}

/**
 * What the cook was charged from group pantries, in a sentence: each group's
 * items someone else bought, in the order the dish lists them. Null when
 * there are none, or once it is split (it is no longer only yours).
 */
export function groupItemsNote(
  dish: Pick<KitchenDish, "orgId" | "cook" | "ingredients">,
  groupNames: ReadonlyMap<string, string>,
): string | null {
  if (dish.orgId !== null) return null;
  const byGroup = new Map<string, string[]>();
  for (const i of dish.ingredients) {
    if (!i.orgId || i.paidBy === dish.cook) continue;
    const list = byGroup.get(i.orgId) ?? [];
    if (!list.includes(i.name)) list.push(i.name);
    byGroup.set(i.orgId, list);
  }
  if (byGroup.size === 0) return null;
  const parts = [...byGroup].map(([orgId, names], i) => {
    const list = itemList(names);
    return `${i === 0 ? list : softLower(list)} from ${groupNames.get(orgId) ?? "a group"}'s pantry`;
  });
  const sentence = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const items = [...byGroup.values()].reduce((a, l) => a + l.length, 0);
  return `Saved as your dish. ${sentence} ${items === 1 ? "is" : "are"} charged to you.`;
}

/** Cooked!'s words and numbers: the size cooked and the time, the tiles, the note. */
export function cookedView(
  dish: Pick<KitchenDish, "name" | "orgId" | "cook" | "ingredients" | "portionsHalf" | "totalMinor" | "currency">,
  ctx: { main: { qtyMilli: number; unit: string } | null; seed: CookedSeed; groupNames: ReadonlyMap<string, string> },
): CookedView {
  const subtitle = [dish.name, ctx.main ? amountText(ctx.main.qtyMilli, ctx.main.unit) : null, ctx.seed.minutes !== null ? minutesText(ctx.seed.minutes) : null]
    .filter((x): x is string => !!x)
    .join(" · ");
  const tiles: CookedTile[] = [];
  if (ctx.seed.steps) tiles.push({ value: `${ctx.seed.steps.done}/${ctx.seed.steps.total}`, label: "steps" });
  tiles.push({ value: portionsText(Math.max(1, dish.portionsHalf)), label: dish.portionsHalf <= 2 ? "serving" : "servings" });
  tiles.push({ value: shortMoney(dish.totalMinor, dish.currency), label: dish.orgId ? "cost" : "cost · yours" });
  return { subtitle, tiles, note: groupItemsNote(dish, ctx.groupNames) };
}

export type CookedActionId = "post" | "split";

export interface CookedAction {
  id: CookedActionId;
  title: string;
  sub: string;
  done: boolean;
  /** "Posted ✓", "Flat 4B ✓"; null until done. */
  doneText: string | null;
}

/**
 * WHAT NEXT: Post to Community (done once this browser knows its post) and
 * Split with a group (done once the dish has a group), always both, in that
 * order; each says when it's done.
 */
export function cookedActions(input: { postId: string | null; orgId: string | null; groupName: string | null }): CookedAction[] {
  const posted = input.postId !== null;
  const split = input.orgId !== null;
  return [
    {
      id: "post",
      title: "Post to Community",
      sub: "Followers, Public or Just me · caption, stats",
      done: posted,
      doneText: posted ? "Posted ✓" : null,
    },
    {
      id: "split",
      title: "Split with a group",
      sub: "Who ate · they pay you back their share",
      done: split,
      doneText: split ? `${input.groupName ?? "Split"} ✓` : null,
    },
  ];
}

/** The bottom button: "Not now · done" until one of them is done, then "Done". */
export function cookedDoneLabel(actions: readonly CookedAction[]): string {
  return actions.some((a) => a.done) ? "Done" : "Not now · done";
}

/** Cooked! shows for the cook's own dish that isn't canceled, in the new frame, at `?cooked=1`. */
export function showsCooked(isNewFrame: boolean, asked: boolean, dish: Pick<KitchenDish, "cook" | "state">, meId: string | null): boolean {
  return isNewFrame && asked && meId !== null && dish.cook === meId && dish.state !== "canceled";
}

/**
 * The dish page's next steps (the new frame, the cook's own dish, not
 * canceled): Post — "offer", or "posted" once this browser knows the post
 * (See your post) — and Split while it has no group. Either, both, in any order.
 */
export function dishNextActions(
  isNewFrame: boolean,
  dish: Pick<KitchenDish, "cook" | "orgId" | "state">,
  meId: string | null,
  postId: string | null,
): { post: "offer" | "posted" | null; split: boolean } {
  if (!isNewFrame || meId === null || dish.cook !== meId || dish.state === "canceled") return { post: null, split: false };
  return { post: postId ? "posted" : "offer", split: dish.orgId === null };
}

// ── Split with a group ────────────────────────────────────────────

/** Groups the dish can be split with: ones the cook cooks in (not viewer), counting in the dish's currency. */
export function splitGroups(groups: readonly MyGroupBalance[], currency: string): MyGroupBalance[] {
  return cookingGroups(groups).filter((g) => g.currency === currency);
}

/**
 * The group Split starts on: the one whose pantry the dish took most from
 * (by cost, then items, then name); else the one asked for (Home's
 * reminder, `?split=org_…`); else the one opened last; else none.
 */
export function suggestSplitGroup(
  dish: Pick<KitchenDish, "ingredients" | "currency">,
  groups: readonly MyGroupBalance[],
  opts: { hint?: string | null; recentSlugs?: readonly string[] } = {},
): string | null {
  const ok = splitGroups(groups, dish.currency);
  if (ok.length === 0) return null;
  const byId = new Map(ok.map((g) => [g.orgId, g] as const));
  const used = new Map<string, { cost: number; items: number }>();
  for (const i of dish.ingredients) {
    if (!i.orgId || !byId.has(i.orgId)) continue;
    const u = used.get(i.orgId) ?? { cost: 0, items: 0 };
    used.set(i.orgId, { cost: u.cost + i.costMinor, items: u.items + 1 });
  }
  const most = [...used]
    .sort(([a, x], [b, y]) => y.cost - x.cost || y.items - x.items || byId.get(a)!.name.localeCompare(byId.get(b)!.name))
    .at(0);
  if (most) return most[0];
  if (opts.hint && byId.has(opts.hint)) return opts.hint;
  return orderCookingGroups(ok, opts.recentSlugs).at(0)?.orgId ?? null;
}

/** Who ate, to start with: you, one serving (or all of it, when less). */
export function splitStartingHalves(meId: string, portionsHalf: number): Record<string, number> {
  return startingHalves(meId, portionsHalf);
}

/** Who ate, live, over the dish as cooked: its servings and its total don't change. */
export function splitEaters(input: {
  dish: Pick<KitchenDish, "portionsHalf" | "totalMinor">;
  roster: readonly string[];
  meId: string;
  halves: Readonly<Record<string, number>>;
  names?: MemberNames | null;
}): EaterView {
  return eaterView({ roster: input.roster, meId: input.meId, halves: input.halves, totalMinor: input.dish.totalMinor, portionsHalf: input.dish.portionsHalf, names: input.names ?? null });
}

/** What Split sends: `splitDish` (claims: the rest stays open for the group to claim), then the eaters' shares. */
export function splitPlan(
  orgId: string,
  input: { halves: Readonly<Record<string, number>>; roster: readonly string[]; meId: string },
): { split: SplitDishRequest; shares: SetDishSharesRequest | null } {
  const eaters = eaterShares(input.halves, input.roster, input.meId);
  return {
    split: { orgId, splitMode: "claims" },
    shares: eaters.length > 0 ? { shares: eaters.map((e) => ({ subjectId: e.subjectId, portionsHalf: e.portionsHalf! })) } : null,
  };
}

/** Split's main button: "Split with Flat 4B", "₹212.00 · 4 servings". */
export function splitButton(groupName: string | null, dish: Pick<KitchenDish, "totalMinor" | "currency" | "portionsHalf">): { title: string; sub: string } {
  return {
    title: groupName ? `Split with ${groupName}` : "Split",
    sub: `${formatMinor(dish.totalMinor, dish.currency)} · ${servingsText(dish.portionsHalf)}`,
  };
}

/** Under Who ate: what nobody is down for yet ("1½ left · Flat 4B can claim"); null when all of it is given out. */
export function splitLeftText(view: Pick<EaterView, "unclaimedHalf" | "over">, groupName: string | null): string | null {
  if (view.over || view.unclaimedHalf <= 0) return null;
  return `${portionsText(view.unclaimedHalf)} left · ${groupName ?? "the group"} can claim`;
}

/** The toast once it is split. Nothing moves until it is finalized. */
export function splitToast(name: string, groupName: string, eaters: number): { title: string; description: string } {
  return {
    title: `${name} split with ${groupName}`,
    description: eaters > 1 ? `${eaters} ate · nothing moves until you finalize` : "Open for claims · nothing moves until you finalize",
  };
}

/** A refused split, in words (CM-8's refusals). */
export function splitRefusalText(error: { code?: string | undefined; reason?: string | undefined; message: string; details?: Record<string, unknown> | undefined }, groupName: string | null): string {
  if (error.reason === "already_split") return "It's split already";
  if (error.reason === "dish_not_open") return "It was canceled";
  if (error.reason === "currency_mismatch") {
    const c = typeof error.details?.currency === "string" ? error.details.currency : null;
    return `${groupName ?? "That group"} counts in ${c ?? "another currency"}`;
  }
  if (error.code === "not_found") return `You can't cook in ${groupName ?? "that group"}`;
  return error.message;
}

// ── Home's reminder ───────────────────────────────────────────────

/** "Split Chicken curry with Flat 4B?" */
export function reminderTitle(r: Pick<SplitReminderInboxItem, "dish" | "suggest">): string {
  return `Split ${r.dish.name} with ${r.suggest.groupName}?`;
}

/** "4 servings · ₹212" */
export function reminderSub(r: Pick<SplitReminderInboxItem, "dish">): string {
  return `${servingsText(r.dish.portionsHalf)} · ${shortMoney(r.dish.totalMinor, r.dish.currency)}`;
}

/** Split, from the reminder: the dish page's Split, suggesting the reminder's group. */
export function reminderSplitHref(r: Pick<SplitReminderInboxItem, "dish" | "suggest">): string {
  return splitHref(r.dish.id, r.suggest.orgId);
}

/** Dismiss's toast (Undo restores it). */
export const REMINDER_DISMISSED = { title: "Won't remind you", description: "Split it any time from the dish" } as const;

/** The reminders Home shows, in the server's order (newest dish first). */
export function splitReminders(res: Pick<InboxResponse, "splitReminders"> | null | undefined): SplitReminderInboxItem[] {
  return res?.splitReminders ?? [];
}

/** The inbox without one dish's reminder (Dismiss, before the server answers; and once it is split). */
export function withoutReminder<T extends Pick<InboxResponse, "splitReminders">>(inbox: T, dishId: string): T {
  const list = inbox.splitReminders ?? [];
  return list.some((r) => r.dish.id === dishId) ? { ...inbox, splitReminders: list.filter((r) => r.dish.id !== dishId) } : inbox;
}

/** The inbox with a reminder back (Undo), newest dish first. */
export function withReminder<T extends Pick<InboxResponse, "splitReminders">>(inbox: T, item: SplitReminderInboxItem): T {
  const rest = (inbox.splitReminders ?? []).filter((r) => r.dish.id !== item.dish.id);
  const list = [...rest, item].sort((a, b) => b.dish.cookedAt.localeCompare(a.dish.cookedAt));
  return { ...inbox, splitReminders: list };
}

/**
 * The new frame's To do without any just-me "Finalize" (CM-9): finalizing a
 * dish of your own posts nothing, and splitting it is Home's reminder.
 */
export function withoutJustMeFinalize<T extends Pick<InboxResponse, "items">>(res: T): T {
  const items = res.items.filter((i) => !(i.kind === "finalize_dish" && i.dish.orgId === null));
  return items.length === res.items.length ? res : { ...res, items };
}

/** Dismiss, at once: Home's inbox without the reminder. */
export function reminderDismissPatches(dishId: string): CachePatch[] {
  return [{ prefix: qk.kitchenInbox(), update: (d) => (d ? withoutReminder(d as InboxResponse, dishId) : d) }];
}

/** Undo: the reminder back where it was. */
export function reminderRestorePatches(item: SplitReminderInboxItem): CachePatch[] {
  return [{ prefix: qk.kitchenInbox(), update: (d) => (d ? withReminder(d as InboxResponse, item) : d) }];
}
