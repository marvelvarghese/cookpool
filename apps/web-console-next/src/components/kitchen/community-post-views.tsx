"use client";

import * as React from "react";
import Link from "./link";
import { Bookmark, ChefHat, MessageCircle, MoreHorizontal, Smile, UserPlus } from "lucide-react";
import type { FeedTab } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileFace } from "./community-views";
import { FEED_TAB_LABELS, feedHref, type PostCard, type StatTile } from "./community-posts";
import type { ActivityLine } from "./community-activity";
import { FEED_TABS } from "@saas/contracts/kitchen";

/**
 * Posts' parts as they draw (cookpool-community CM-6, the canvas's
 * `CommunityFeed`, `PostDetail`, `CommunityActivity`), from what was read: no
 * reads or writes, so each renders in tests. The screens put them over the
 * data.
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Following · Discover: two tabs in a grey track; the choice is the address (`?tab=`). */
export function FeedTabs({ tab }: { tab: FeedTab }) {
  return (
    <nav aria-label="Feed" className="grid grid-cols-2 gap-1 rounded-[14px] bg-[#ECEEE9] p-1">
      {FEED_TABS.map((t) => {
        const on = t === tab;
        return (
          <Link
            key={t}
            href={feedHref(t)}
            replace
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center justify-center rounded-[11px] text-[15px] font-extrabold transition-colors",
              FOCUS,
              on ? "bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.1)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {FEED_TAB_LABELS[t]}
          </Link>
        );
      })}
    </nav>
  );
}

/** The chosen stats: up to four tiles, value over label ("450 g" / "size"); white with a border on the page's ground (`onGround`). */
export function StatTiles({ tiles, onGround = false }: { tiles: readonly StatTile[]; onGround?: boolean }) {
  if (tiles.length === 0) return null;
  return (
    <dl className="grid grid-cols-4 gap-1.5">
      {tiles.map((t) => (
        <div key={t.id} className={cn("flex min-w-0 flex-col-reverse rounded-xl px-2 py-1.5", onGround ? "border bg-card" : "bg-background")}>
          <dt className="truncate text-[11px] font-bold text-muted-foreground">{t.label}</dt>
          <dd className="truncate text-[15px] font-extrabold tabular-nums">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The recipe tile as a post's hero (a photo takes its place with CM-4): the dish's name and the recipe line on its colour. */
export function PostHero({ card, tall = false }: { card: Pick<PostCard, "title" | "tile" | "recipeLine">; tall?: boolean }) {
  return (
    <span
      style={{ background: `linear-gradient(160deg, ${card.tile.bg}, #FFFFFF)` }}
      className={cn("flex flex-col justify-end rounded-2xl border border-[#E3E6E0] p-3.5", tall ? "h-[200px]" : "h-[168px]")}
    >
      <span className="break-words text-[22px] font-extrabold leading-tight text-foreground">{card.title}</span>
      {card.recipeLine ? <span className="text-[13px] font-bold text-[#3F4842]">{card.recipeLine}</span> : null}
    </span>
  );
}

/** Yum: a toggle with its count, warm when it's yours. */
export function YumButton({ on, label, onClick, big = false }: { on: boolean; label: string; onClick: () => void; big?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-extrabold tabular-nums transition-colors",
        FOCUS,
        big && "px-3.5 text-[15px]",
        on ? "bg-[#FCE9DF] text-[#8C3517]" : big ? "border border-[#D5DAD2] bg-card text-foreground hover:bg-accent" : "text-[#3F4842] hover:bg-accent",
      )}
    >
      <Smile className={cn("h-[18px] w-[18px]", on && "fill-[#F5C6AE]")} strokeWidth={2.2} aria-hidden />
      {label}
    </button>
  );
}

/** One post in a feed or on a profile: who, the hero, the stats, the caption, then Yum · comments · Cook this. */
export function PostCardView({
  card,
  meId,
  onYum,
  onMore,
  cookThis,
}: {
  card: PostCard;
  meId: string | null;
  onYum: () => void;
  onMore?: (() => void) | undefined;
  /** Cook this / Saved ✓, when the post links a recipe. */
  cookThis?: React.ReactNode;
}) {
  const face = card.author.userId ? <ProfileFace userId={card.author.userId} meId={meId} initials={card.author.initials} /> : <ProfileFace userId={meId ?? "me"} meId={meId} initials="Y" />;
  return (
    <article aria-labelledby={`post-${card.id}`} className="overflow-hidden rounded-[22px] border bg-card">
      <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
        {card.author.href ? (
          <Link href={card.author.href} tabIndex={-1} aria-hidden className="shrink-0 rounded-full">
            {face}
          </Link>
        ) : (
          face
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          {card.author.href ? (
            <Link href={card.author.href} className={cn("truncate rounded text-[15px] font-extrabold hover:underline", FOCUS)}>
              {card.author.name}
            </Link>
          ) : (
            <span className="truncate text-[15px] font-extrabold">{card.author.name}</span>
          )}
          <span className="truncate text-xs font-semibold text-muted-foreground">{card.author.meta}</span>
        </span>
        {onMore ? (
          <button type="button" aria-label="More" aria-haspopup="dialog" onClick={onMore} className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-accent", FOCUS)}>
            <MoreHorizontal className="h-5 w-5" strokeWidth={2.2} aria-hidden />
          </button>
        ) : null}
      </div>
      <Link href={card.href} id={`post-${card.id}`} aria-label={card.title} className={cn("mx-3.5 block rounded-2xl", FOCUS)}>
        <PostHero card={card} />
      </Link>
      {card.tiles.length > 0 ? (
        <div className="px-3.5 pt-2.5">
          <StatTiles tiles={card.tiles} />
        </div>
      ) : null}
      {card.caption ? <p className="whitespace-pre-line break-words px-3.5 pt-2.5 text-[15px] font-medium leading-snug">{card.caption}</p> : null}
      <div className="flex items-center gap-1 px-2 pb-2.5 pt-2">
        <YumButton on={card.yum.on} label={card.yum.label} onClick={onYum} />
        <Link href={card.href} className={cn("flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-extrabold tabular-nums text-[#3F4842] hover:bg-accent", FOCUS)}>
          <MessageCircle className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
          {card.comments}
          <span className="sr-only"> {card.comments === 1 ? "comment" : "comments"}</span>
        </Link>
        <span className="flex-1" />
        {cookThis}
      </div>
    </article>
  );
}

/** Cook this (copy and open) or Saved ✓ (open your copy): herb-tinted, on the card's right. */
export const COOK_THIS_BUTTON = cn("flex min-h-11 shrink-0 items-center rounded-xl bg-cp-herb-tint px-3.5 text-sm font-extrabold text-[#165C3A] transition-colors hover:bg-[#D3EADC] disabled:opacity-70", FOCUS);

/** A feed loading: two grey cards. */
export function PostCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-[340px] w-full rounded-[22px]" />
      <Skeleton className="h-[340px] w-full rounded-[22px]" />
    </div>
  );
}

const ACTIVITY_ICONS = { cooked: ChefHat, yum: Smile, comment: MessageCircle, follow: UserPlus, saved: Bookmark } as const;

/** One Activity line: the face, "**Meera and 11 others** said Yum to your Chicken curry", when, and its icon; a dot when new. */
export function ActivityLineView({ line, meId }: { line: ActivityLine; meId: string | null }) {
  const Icon = ACTIVITY_ICONS[line.icon];
  return (
    <li>
      <Link href={line.href} className={cn("flex min-h-16 items-center gap-3 px-3 py-2.5 hover:bg-accent", FOCUS)}>
        <ProfileFace userId={line.faceId} meId={meId} initials={line.faceName.trim().charAt(0).toUpperCase() || "?"} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="break-words text-[15px] font-semibold leading-snug">
            <b className="font-extrabold">{line.who}</b> {line.what}
          </span>
          <span className="text-xs font-semibold text-muted-foreground">{line.when}</span>
        </span>
        {line.unread ? <span aria-label="New" className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#B4471F]" /> : null}
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      </Link>
    </li>
  );
}
