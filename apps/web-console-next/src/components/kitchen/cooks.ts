/**
 * Cooks — dishes as the new frame shows them (cookpool-recipes RC-2, design
 * §1.4): Home's "From your groups" (dishes finished in the last 7 days in any
 * of your groups, each with the cook's face, who and where, and three
 * numbers: portions, each, you had), your page's Cooks count, its "Cooks a
 * week" over the last 8 weeks and your recent cooks, and a person's recent
 * cooks in the groups you share.
 *
 * Everything comes from one read the app already has, `GET
 * /v1/kitchen/me/dishes` (dishes you cooked or that are shared with your
 * groups, newest cooked first), read a page at a time until it covers the
 * days a screen needs (`coversDays`). No new route was needed.
 *
 * Pure and dependency-free (contract types and the app's pure helpers), so it
 * is unit-testable.
 */

import type { KitchenDish } from "@saas/contracts/kitchen";
import { dishHref, halfText, perPortionText } from "./dish";
import { formatMinor } from "./money";
import { memberLabel, type MemberNames } from "./members";
import { agoText, dayText, localDayOffset } from "./when";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back Home's "From your groups" goes. */
export const FEED_DAYS = 7;
/** How many cards it shows at most. */
export const FEED_CARDS = 10;
/** How many weeks "Cooks a week" draws. */
export const COOK_WEEKS = 8;
/** How many recent cooks your page and a person's list. */
export const RECENT_COOKS = 5;

/**
 * How far back each screen reads the dishes: Home a week of finishing (a dish
 * is finished after it is cooked, so two weeks of cooking), your page and a
 * person's the 8 weeks of the chart.
 */
export const HOME_DISH_DAYS = 2 * FEED_DAYS;
export const PROFILE_DISH_DAYS = COOK_WEEKS * 7;

/**
 * Whether the dishes read so far (newest cooked first) reach back `days`
 * before `now`: there are no more, or the oldest read was cooked before then.
 */
export function coversDays(dishes: readonly Pick<KitchenDish, "cookedAt">[], hasMore: boolean, days: number, now: Date): boolean {
  if (!hasMore) return true;
  const oldest = dishes[dishes.length - 1];
  if (!oldest) return false;
  return Date.parse(oldest.cookedAt) < now.getTime() - days * DAY_MS;
}

// ── From your groups (Home) ───────────────────────────────────────

export interface FeedCard {
  dishId: string;
  /** The dish's page. */
  href: string;
  /** The cook's `usr_…` (their face). */
  cookId: string;
  /** "Meera cooked", "You cooked". */
  cookText: string;
  /** "Flat 4B". */
  groupName: string;
  /** The group's `org_…` (what the card opens is read ahead from it). */
  orgId: string;
  /** "3 h ago", "Yesterday", "28 Oct": when it was cooked. */
  when: string;
  /** "Egg fried rice". */
  name: string;
  /** "4", "2½". */
  portions: string;
  /** "₹31.20", "≈ ₹33.33": one portion. */
  each: string;
  /** "1½", "0"; an exact amount as money ("₹40.00"). */
  youHad: string;
}

/** What you had of a dish, as a number: your half portions, or the exact amount you were set. */
export function youHadText(dish: Pick<KitchenDish, "shares" | "currency">, meId: string | null): string {
  const mine = meId ? dish.shares.find((s) => s.subjectId === meId) : undefined;
  if (!mine) return "0";
  if (mine.portionsHalf !== null) return halfText(mine.portionsHalf);
  return mine.exactMinor !== null ? formatMinor(mine.exactMinor, dish.currency) : "0";
}

/**
 * Home's "From your groups": the dishes finished in the last `FEED_DAYS` in
 * any of your groups (`groupNames`), the most recently finished first, at most
 * `FEED_CARDS`. Finished cooks only (design §1.3): an open dish is a To do,
 * never also a card; a dish just for its cook is in no group.
 */
export function feedCards(
  dishes: readonly KitchenDish[],
  ctx: { meId: string | null; names?: MemberNames | null; groupNames: ReadonlyMap<string, string>; now: Date; limit?: number },
): FeedCard[] {
  const since = ctx.now.getTime() - FEED_DAYS * DAY_MS;
  const seen = new Set<string>();
  return dishes
    .filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return d.state === "finalized" && !!d.orgId && ctx.groupNames.has(d.orgId) && !!d.finalizedAt && Date.parse(d.finalizedAt) >= since;
    })
    .sort((a, b) => (b.finalizedAt ?? "").localeCompare(a.finalizedAt ?? "") || b.id.localeCompare(a.id))
    .slice(0, ctx.limit ?? FEED_CARDS)
    .map((d) => ({
      dishId: d.id,
      href: dishHref(d.id),
      cookId: d.cook,
      cookText: `${memberLabel(d.cook, ctx.meId, ctx.names)} cooked`,
      groupName: ctx.groupNames.get(d.orgId!)!,
      orgId: d.orgId!,
      when: agoText(d.cookedAt, ctx.now),
      name: d.name,
      portions: halfText(d.portionsHalf),
      each: perPortionText(d),
      youHad: youHadText(d, ctx.meId),
    }));
}

// ── Your page and a person's ──────────────────────────────────────

/** A cook that counts: one the person cooked that was not called off. */
function isCookBy(dish: Pick<KitchenDish, "cook" | "state">, cookId: string): boolean {
  return dish.cook === cookId && dish.state !== "canceled";
}

/** How many dishes someone cooked in what was read (not counting canceled ones). */
export function cookCount(dishes: readonly Pick<KitchenDish, "id" | "cook" | "state">[], cookId: string | null): number {
  if (!cookId) return 0;
  return new Set(dishes.filter((d) => isCookBy(d, cookId)).map((d) => d.id)).size;
}

/** The Cooks number: "12", or "400+" when the read stopped before the person's first dish. */
export function cookCountText(count: number, complete: boolean): string {
  return complete ? String(count) : `${count}+`;
}

/**
 * Cooks a week over the last `weeks` weeks (7-day windows ending today, in the
 * viewer's calendar), oldest first: the last number is this week's.
 */
export function cooksAWeek(
  dishes: readonly Pick<KitchenDish, "id" | "cook" | "state" | "cookedAt">[],
  cookId: string | null,
  now: Date,
  weeks = COOK_WEEKS,
): number[] {
  const counts: number[] = new Array<number>(weeks).fill(0);
  if (!cookId) return counts;
  const seen = new Set<string>();
  for (const d of dishes) {
    if (!isCookBy(d, cookId) || seen.has(d.id)) continue;
    seen.add(d.id);
    const at = new Date(d.cookedAt);
    if (Number.isNaN(at.getTime())) continue;
    const daysAgo = -localDayOffset(at, now);
    if (daysAgo < 0) continue;
    const week = Math.floor(daysAgo / 7);
    if (week < weeks) counts[weeks - 1 - week]! += 1;
  }
  return counts;
}

/** "Cooks a week" in words, for the chart's label: "3 this week · 14 in 8 weeks". */
export function cooksAWeekText(counts: readonly number[]): string {
  const total = counts.reduce((a, b) => a + b, 0);
  return `${counts[counts.length - 1] ?? 0} this week · ${total} in ${counts.length} weeks`;
}

export interface CookRow {
  dishId: string;
  href: string;
  name: string;
  /** "Flat 4B", "Just for you". */
  where: string;
  /** "today", "yesterday", "28 Oct". */
  when: string;
  /** "4 portions". */
  portions: string;
}

/**
 * Someone's recent cooks, newest first, at most `limit` (canceled ones left
 * out). With `inGroups`, only the dishes shared with those groups — a
 * person's page shows only what they cooked in the groups you share.
 */
export function recentCooks(
  dishes: readonly KitchenDish[],
  cookId: string | null,
  ctx: { groupNames: ReadonlyMap<string, string>; now: Date; inGroups?: ReadonlySet<string> | null; limit?: number },
): CookRow[] {
  if (!cookId) return [];
  const seen = new Set<string>();
  return dishes
    .filter((d) => {
      if (!isCookBy(d, cookId) || seen.has(d.id)) return false;
      seen.add(d.id);
      return !ctx.inGroups || (!!d.orgId && ctx.inGroups.has(d.orgId));
    })
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt) || b.id.localeCompare(a.id))
    .slice(0, ctx.limit ?? RECENT_COOKS)
    .map((d) => ({
      dishId: d.id,
      href: dishHref(d.id),
      name: d.name,
      where: d.orgId ? (ctx.groupNames.get(d.orgId) ?? "another group") : "Just for you",
      when: dayText(d.cookedAt, ctx.now),
      portions: `${halfText(d.portionsHalf)} ${d.portionsHalf > 0 && d.portionsHalf <= 2 ? "portion" : "portions"}`,
    }));
}

/** "In Flat 4B with you", "In Flat 4B and Lunch club with you", "In Flat 4B and 2 more with you". */
export function sharedGroupsLine(groups: readonly { name: string }[]): string | null {
  const names = groups.map((g) => g.name).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return `In ${names[0]} with you`;
  if (names.length === 2) return `In ${names[0]} and ${names[1]} with you`;
  return `In ${names[0]} and ${names.length - 1} more with you`;
}

/** Your groups under your name: "Flat 4B · Lunch club", "Flat 4B · Lunch club +2". */
export function yourGroupsLine(groups: readonly { name: string }[], shown = 2): string | null {
  const names = groups.map((g) => g.name).filter(Boolean);
  if (names.length === 0) return null;
  const head = names.slice(0, shown).join(" · ");
  return names.length > shown ? `${head} +${names.length - shown}` : head;
}
