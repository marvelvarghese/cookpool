/**
 * Activity and reports in the app (cookpool-community CM-6, design §4, the
 * canvas's `CommunityActivity`), as data:
 *
 * - **Activity**: WANTS TO FOLLOW YOU (the requests, with Accept · No), then
 *   what happened, grouped by day (Today, This week, Earlier), each line
 *   "**Meera and 11 others** liked your Chicken curry" opening its
 *   post, a profile or a recipe; the bell's unread count.
 * - **Reports**: the reasons (spam, abuse, unsafe, other) and what is sent,
 *   for a post, a comment or a profile.
 *
 * Pure (contract types and helpers), so unit-testable.
 */

import {
  REPORT_NOTE_MAX,
  type ActivityActor,
  type ActivityItem,
  type CreateReportRequest,
  type ReportReason,
  type ReportTargetKind,
} from "@saas/contracts/kitchen";
import { firstNameOf, recipeHref } from "./recipes";
import { localDayOffset } from "./when";
import { postHref, profileHref } from "./community";
import { shortAgo } from "./community-posts";

// ── The bell ──────────────────────────────────────────────────────

/** The bell's badge: nothing for 0, "9+" past nine. */
export function unreadBadge(count: number | null | undefined): string | null {
  const n = Math.max(0, Math.floor(count ?? 0));
  if (n === 0) return null;
  return n > 9 ? "9+" : String(n);
}

/** The bell's name for screen readers: "Activity", "Activity, 3 new". */
export function bellLabel(count: number | null | undefined): string {
  const n = Math.max(0, Math.floor(count ?? 0));
  return n > 0 ? `Activity, ${n} new` : "Activity";
}

// ── Items ─────────────────────────────────────────────────────────

const first = (a: ActivityActor): string => firstNameOf(a.name) ?? `@${a.handle}`;

/** Who did it: "Sam"; a like item "Meera and Dev", "Meera, Dev and 10 others". */
export function activityWho(item: Pick<ActivityItem, "actor" | "actors" | "others">): string {
  const names = (item.actors.length > 0 ? item.actors : [item.actor]).map(first);
  if (item.others > 0) return `${names.join(", ")} and ${item.others} ${item.others === 1 ? "other" : "others"}`;
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A comment quoted to this many characters. */
export const QUOTE_MAX = 40;

function quote(body: string): string {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length <= QUOTE_MAX ? one : `${one.slice(0, QUOTE_MAX - 1).trimEnd()}…`;
}

export interface ActivityLine {
  id: string;
  who: string;
  what: string;
  when: string;
  /** What it opens: the post, the person, or the recipe. */
  href: string;
  /** The face it shows: the (latest) actor. */
  faceId: string;
  faceName: string;
  unread: boolean;
  icon: "cooked" | "yum" | "comment" | "follow" | "saved";
}

/**
 * One item as a line: who, what ("cooked your Chicken curry", "liked
 * your Chicken curry", "commented: "Roast the spices first…"", "started
 * following you", "accepted your follow request", "saved your Masala
 * chai"), and where it goes — the post when there is one, else the
 * recipe (saved yours), else the person.
 */
export function activityLine(item: ActivityItem, now: Date): ActivityLine {
  const title = item.post?.title ?? item.recipe?.name ?? "your post";
  const person = profileHref(item.actor.handle);
  const base = { id: item.id, who: activityWho(item), when: shortAgo(item.at, now), faceId: item.actor.userId, faceName: item.actor.name, unread: item.unread };
  switch (item.kind) {
    case "yum":
      return { ...base, what: `liked your ${title}`, href: item.post ? postHref(item.post.id) : person, icon: "yum" };
    case "comment":
      return { ...base, what: item.comment ? `commented: “${quote(item.comment.body)}”` : `commented on your ${title}`, href: item.post ? postHref(item.post.id) : person, icon: "comment" };
    case "cooked_yours":
      return { ...base, what: `cooked your ${item.recipe?.name ?? title}`, href: item.post ? postHref(item.post.id) : person, icon: "cooked" };
    case "saved_yours":
      return { ...base, what: `saved your ${item.recipe?.name ?? "recipe"}`, href: item.recipe ? recipeHref(item.recipe.id) : person, icon: "saved" };
    case "follow_accepted":
      return { ...base, what: "accepted your follow request", href: person, icon: "follow" };
    case "followed":
    default:
      return { ...base, what: "started following you", href: person, icon: "follow" };
  }
}

export interface ActivityGroup {
  id: "today" | "week" | "earlier";
  title: string;
  lines: ActivityLine[];
}

const GROUP_TITLES: Record<ActivityGroup["id"], string> = { today: "Today", week: "This week", earlier: "Earlier" };

/** Items newest first, grouped by day: Today, This week (the 6 days before), Earlier. Empty groups are left out. */
export function activityGroups(items: readonly ActivityItem[], now: Date): ActivityGroup[] {
  const groups: Record<ActivityGroup["id"], ActivityLine[]> = { today: [], week: [], earlier: [] };
  for (const item of items) {
    const at = new Date(item.at);
    const offset = Number.isNaN(at.getTime()) ? -999 : localDayOffset(at, now);
    const id: ActivityGroup["id"] = offset >= 0 ? "today" : offset >= -6 ? "week" : "earlier";
    groups[id].push(activityLine(item, now));
  }
  return (["today", "week", "earlier"] as const).filter((id) => groups[id].length > 0).map((id) => ({ id, title: GROUP_TITLES[id], lines: groups[id] }));
}

/** What opening Activity marks read: everything up to the newest item (or now, with none). */
export function markReadBefore(items: readonly Pick<ActivityItem, "at">[], now: Date): string {
  let latest = 0;
  for (const i of items) {
    const t = Date.parse(i.at);
    if (!Number.isNaN(t) && t > latest) latest = t;
  }
  return new Date(Math.max(latest, now.getTime())).toISOString();
}

/** The line under the list (the canvas's). */
export const ACTIVITY_PUSH_NOTE = "Pushes for each of these can be turned off in You → Notifications.";
export const ACTIVITY_EMPTY = "Follows, likes and comments show here";
export const REQUESTS_TITLE = "Wants to follow you";

/** "and 4 more" under the requests, when the server names only the newest few. */
export function moreRequestsText(count: number, shown: number): string | null {
  const more = count - shown;
  return more > 0 ? `and ${more} more` : null;
}

// ── Reports ───────────────────────────────────────────────────────

export const REPORT_REASON_ROWS: readonly { id: ReportReason; title: string; sub: string }[] = [
  { id: "spam", title: "Spam", sub: "Ads, scams or the same thing again and again" },
  { id: "abuse", title: "Abuse", sub: "Harassment, hate or threats" },
  { id: "unsafe", title: "Unsafe", sub: "Food advice that could hurt someone" },
  { id: "other", title: "Something else", sub: "Tell us in the note" },
];

/** The sheet's title: "Report this post", "Report this comment", "Report @kabirbakes". */
export function reportTitle(kind: ReportTargetKind, handle?: string | null): string {
  if (kind === "profile") return handle ? `Report @${handle}` : "Report this profile";
  return kind === "post" ? "Report this post" : "Report this comment";
}

/** What Report sends: the target, the reason, the note trimmed (none when empty). */
export function reportRequest(targetKind: ReportTargetKind, targetId: string, reason: ReportReason, note: string): CreateReportRequest {
  const n = note.trim().slice(0, REPORT_NOTE_MAX);
  const out: CreateReportRequest = { targetKind, targetId, reason };
  if (n) out.note = n;
  return out;
}

/** After Report: thanks, and that it stays private. */
export const REPORTED_TOAST = { title: "Reported", description: "Thanks. They aren't told who reported it." } as const;
export { REPORT_NOTE_MAX };
