/**
 * The revamped Home's words (cookpool-revamp RV-3, the canvas's
 * `HomeRevamp`), as data: the balance pill beside "Hi, Rahul", the resume
 * strip's second line, Cook now's tag, and the one line under each dish in
 * "Your groups cooked". Also the rule every revamped list follows: three
 * rows, then "See all N".
 *
 * Dependency-free (contract types only), so it is unit-testable.
 */

import type { CookNowEntry, KitchenDish } from "@saas/contracts/kitchen";
import type { HomeMoney } from "./home";
import { shortMoney } from "./from-before";

// ── Three, then See all ──────────────────────────────────────────

/** A revamped list shows this many rows, then "See all N". */
export const SEE_ALL_AFTER = 3;

export interface FirstThree<T> {
  rows: T[];
  /** Whether there are more than three: the list offers See all (or Show less). */
  more: boolean;
  /** "See all 13", or "Show less" while all are shown. */
  label: string;
}

/** The first three rows (all of them with `all`), and the See all button's words. */
export function firstThree<T>(rows: readonly T[], all: boolean, after: number = SEE_ALL_AFTER): FirstThree<T> {
  const more = rows.length > after;
  return {
    rows: all || !more ? [...rows] : rows.slice(0, after),
    more,
    label: all ? "Show less" : `See all ${rows.length}`,
  };
}

// ── The balance pill ─────────────────────────────────────────────

export interface BalancePill {
  /** "+₹62.50" (money back) or "−₹25.00" (money you owe). */
  text: string;
  /** Its name: "You get back ₹62.50". */
  label: string;
  tone: "owed" | "owe";
}

/**
 * The pill beside "Hi, Rahul": your main balance as a signed number, opening
 * Money. Nothing while settled up, in no group, or before it is read.
 */
export function balancePill(money: Pick<HomeMoney, "main" | "noGroups"> | null): BalancePill | null {
  if (!money || money.noGroups) return null;
  const { main } = money;
  if (main.tone === "settled" || !main.amount) return null;
  // Whole rupees, as the board writes it (RV-24): "+₹1,240", never "+₹1,240.00".
  return { text: `${main.tone === "owed" ? "+" : "−"}${main.amount.replace(/\.00$/, "")}`, label: main.text, tone: main.tone };
}

// ── The resume strip ─────────────────────────────────────────────

/**
 * The strip's second line, without the bar's "Cooking · ": "12 min · 3 of 7 in";
 * with the step it is on (RV-24, the board), "Step 3 of 7 · 12 min".
 */
export function resumeMeta(meta: string, step: string | null = null): string {
  const rest = meta.replace(/^Cooking · /, "");
  if (!step) return rest;
  return `${step} · ${rest.split(" · ")[0]}`;
}

/** What a session's steps need to say where it is. */
export interface ResumeSteps {
  steps: readonly { done: boolean }[];
  guide?: { screen: string; current: string | null; steps: readonly { key: string; phase: string }[] } | null | undefined;
}

/**
 * "Step 3 of 7": the guided cook step on screen (of the cook steps), else
 * the first step not done of the session's steps; null with no steps.
 */
export function resumeStep(s: ResumeSteps): string | null {
  const g = s.guide;
  if (g && g.screen === "step" && g.current) {
    const cook = g.steps.filter((st) => st.phase === "cook");
    const i = cook.findIndex((st) => st.key === g.current);
    if (i >= 0) return `Step ${i + 1} of ${cook.length}`;
  }
  if (s.steps.length === 0) return null;
  const done = s.steps.filter((x) => x.done).length;
  return `Step ${Math.min(done + 1, s.steps.length)} of ${s.steps.length}`;
}

/** Home shows the session as its own strip, so the floating bar stays off Home. */
export function homeShowsResume(pathname: string | null | undefined): boolean {
  const path = pathname && pathname.length > 1 ? pathname.replace(/\/+$/, "") : (pathname ?? "");
  return path === "/home";
}

// ── Cook now ─────────────────────────────────────────────────────

export interface CookNowTag {
  /** "Have all", "Need yogurt", "Need 2". */
  text: string;
  tone: "have" | "need";
}

/**
 * A Cook now card's tag: "Have all · 30 min" in the accent (the board), "Have
 * all" when the recipe gives no time; else what you need in the owe colour
 * (since RV-20 the server lists only what you can make, so that is a newer
 * server's).
 */
export function cookNowTag(entry: Pick<CookNowEntry, "match"> & { recipe?: { minutes: number | null } }): CookNowTag {
  const missing = entry.match.missing;
  const minutes = entry.recipe?.minutes ?? null;
  if (missing === 0) return { text: minutes && minutes > 0 ? `Have all · ${minutes} min` : "Have all", tone: "have" };
  const first = entry.match.missingNames[0]?.trim();
  if (missing === 1 && first) return { text: `Need ${first.charAt(0).toLowerCase()}${first.slice(1)}`, tone: "need" };
  return { text: `Need ${missing}`, tone: "need" };
}

// ── Your groups cooked ───────────────────────────────────────────

/**
 * One line under a dish your groups cooked: "Anu · you had 1 · ₹54" — what
 * you paid (RV-15, the board) — or, without it, "Anu · you had 1 · ₹31.20
 * each"; "Anu · Flat 4B · 3 h ago" when you had none.
 */
export function groupsCookedMeta(card: { groupName: string; when: string; each: string; youHad: string }, cook: string, paid?: string | null): string {
  if (card.youHad === "0") return `${cook} · ${card.groupName} · ${card.when}`;
  // An exact amount is already money ("₹40.00"): no "each" after it.
  if (/[^\d½\s]/.test(card.youHad)) return `${cook} · you had ${card.youHad}`;
  if (paid) return `${cook} · you had ${card.youHad} · ${paid}`;
  return `${cook} · you had ${card.youHad} · ${card.each} each`;
}

/** What you paid for each dish, from your line of its split ("₹54", "₹31.20"); none where you had nothing. */
export function youPaid(dishes: readonly Pick<KitchenDish, "id" | "amounts" | "currency">[], meId: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!meId) return out;
  for (const d of dishes) {
    const mine = (d.amounts ?? []).find((a) => a.subjectId === meId);
    if (mine && mine.owedMinor > 0) out.set(d.id, shortMoney(mine.owedMinor, d.currency));
  }
  return out;
}
