// One Activity row as words: who did what, and what it did to you.

import type { SplitecoActivityEntry, SplitecoCategory } from "@saas/contracts/spliteco";
import { formatMoney, formatShort } from "./money";

export interface ActivityLine {
  /** Bold, first: "Anu", "You", "Cookpool". */
  actor: string;
  /** The rest of the sentence. */
  text: string;
  /** "You owe ₹600.00", "You get back ₹320.00", "No change for you". */
  effect: string;
  tone: "get" | "owe" | "muted";
}

export function activityLine(entry: SplitecoActivityEntry, actorName: string): ActivityLine {
  const q = `“${entry.title}”`;
  const where = entry.groupName;
  const money = (m: number) => formatShort(m, entry.currency);
  let actor = actorName;
  let text: string;
  switch (entry.action) {
    case "added":
      text = `added ${q} in ${where}`;
      break;
    case "edited":
      text =
        entry.previousTotalMinor !== null && entry.previousTotalMinor !== entry.totalMinor
          ? `changed ${q} from ${money(entry.previousTotalMinor)} to ${money(entry.totalMinor)}`
          : `edited ${q} in ${where}`;
      break;
    case "deleted":
      text = `deleted ${q} from ${where}`;
      break;
    case "restored":
      text = `restored ${q} in ${where}`;
      break;
    case "moved_in":
      text = `moved ${q} into ${where}${entry.otherGroupName ? ` from ${entry.otherGroupName}` : ""}`;
      break;
    case "moved_out":
      text = `moved ${q} out of ${where}${entry.otherGroupName ? ` into ${entry.otherGroupName}` : ""}`;
      break;
    case "reversed":
      text = `reversed ${q} in ${where}`;
      break;
    case "settled":
      text = `recorded a payment in ${where}`;
      break;
    case "cookpool":
      actor = "Cookpool";
      text = `posted ${q} in ${where}${actorName && actorName !== "Someone" ? ` for ${actorName}` : ""}`;
      break;
  }
  const e = entry.myEffectMinor;
  const effect =
    e > 0 ? `You get back ${formatMoney(e, entry.currency)}` : e < 0 ? `You owe ${formatMoney(-e, entry.currency)}` : "No change for you";
  return { actor, text, effect, tone: e > 0 ? "get" : e < 0 ? "owe" : "muted" };
}

/** "12 min ago", "3 h ago", "yesterday", "8 Nov". */
export function timeAgo(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86_400) return "yesterday";
  return shortDate(iso);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function longDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2026-11" → "Nov" / "November 2026". */
export function periodLabel(month: string, long = false): string {
  const [y, m] = month.split("-").map(Number);
  return long ? `${MONTHS_LONG[(m ?? 1) - 1]} ${y}` : MONTHS[(m ?? 1) - 1]!;
}

export function monthShort(iso: string): string {
  return MONTHS[new Date(iso).getMonth()]!.toUpperCase();
}

export const CATEGORY_LABELS: Record<SplitecoCategory | "cookpool", string> = {
  food: "Food & drink",
  groceries: "Groceries",
  stay: "Stay",
  transport: "Transport",
  shopping: "Shopping",
  entertainment: "Fun",
  bills: "Bills",
  other: "Other",
  cookpool: "Groceries (Cookpool)",
};

export const CATEGORY_TINTS: Record<SplitecoCategory | "cookpool" | "payment", { tint: string; ink: string; glyph: string }> = {
  food: { tint: "rgba(255,200,87,0.14)", ink: "#FFC857", glyph: "🍽" },
  groceries: { tint: "rgba(127,216,176,0.14)", ink: "#7FD8B0", glyph: "🛒" },
  stay: { tint: "rgba(211,166,255,0.14)", ink: "#D3A6FF", glyph: "🛏" },
  transport: { tint: "rgba(94,234,212,0.14)", ink: "#5EEAD4", glyph: "🚕" },
  shopping: { tint: "rgba(242,155,183,0.14)", ink: "#F29BB7", glyph: "🛍" },
  entertainment: { tint: "rgba(255,179,138,0.14)", ink: "#FFB38A", glyph: "🎬" },
  bills: { tint: "rgba(96,165,250,0.16)", ink: "#93C5FD", glyph: "🧾" },
  other: { tint: "#16243A", ink: "#A8B6CA", glyph: "•" },
  cookpool: { tint: "rgba(76,201,138,0.14)", ink: "#4CC98A", glyph: "🥕" },
  payment: { tint: "rgba(127,216,176,0.14)", ink: "#7FD8B0", glyph: "₹" },
};

/** A guess at the category from the title, so most expenses need no tap. */
export function guessCategory(title: string): SplitecoCategory | null {
  const t = title.toLowerCase();
  const rules: [SplitecoCategory, RegExp][] = [
    ["food", /dinner|lunch|breakfast|brunch|cafe|coffee|restaurant|pizza|beer|drinks|shack|snack|food|thali|biryani/],
    ["groceries", /grocer|vegetable|milk|supermarket|kirana|fruit/],
    ["entertainment", /movie|cinema|concert|ticket|game|show/],
    ["stay", /villa|hotel|hostel|airbnb|stay|room|night/],
    ["transport", /cab|taxi|uber|ola|scooter|bus|train|flight|fuel|petrol|metro|auto|ride/],
    ["bills", /rent|electricity|wifi|internet|bill|gas|water|maid/],
    ["shopping", /shopping|clothes|gift|amazon/],
  ];
  for (const [c, re] of rules) if (re.test(t)) return c;
  return null;
}
