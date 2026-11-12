"use client";

import * as React from "react";
import Link from "./link";
import { Bookmark, ChefHat, Heart, MessageCircle, Smile, UserPlus } from "lucide-react";
import type { FeedTab } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileFace } from "./community-views";
import { FEED_TAB_LABELS, feedHref, postNumbers, type PostCard, type StatTile } from "./community-posts";
import type { ActivityLine } from "./community-activity";
import { FEED_TABS } from "@saas/contracts/kitchen";
import { SEG_OFF, SEG_ON, SEG_TRACK } from "./rv-look";

/**
 * Posts' parts as they draw (cookpool-community CM-6, the canvas's
 * `CommunityFeed`, `PostDetail`, `CommunityActivity`), from what was read: no
 * reads or writes, so each renders in tests. The screens put them over the
 * data.
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Following · Everyone (`RvCommunity`): two tabs in a track, the chosen one on the card with no ring (RV-18); the choice is the address (`?tab=`). */
export function FeedTabs({ tab }: { tab: FeedTab }) {
  return (
    <nav aria-label="Feed" className={cn("grid grid-cols-2 gap-1", SEG_TRACK)}>
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
              "flex min-h-11 items-center justify-center rounded-xl text-[15px] font-medium transition-colors",
              FOCUS,
              on ? SEG_ON : SEG_OFF,
            )}
          >
            {FEED_TAB_LABELS[t]}
          </Link>
        );
      })}
    </nav>
  );
}

/** The chosen stats: up to four tiles, value over label ("450 g" / "size"); on the page's ground (`onGround`) each is a card with its shadow, no border. */
export function StatTiles({ tiles, onGround = false }: { tiles: readonly StatTile[]; onGround?: boolean }) {
  if (tiles.length === 0) return null;
  return (
    <dl className="grid grid-cols-4 gap-1.5">
      {tiles.map((t) => (
        <div key={t.id} className={cn("flex min-w-0 flex-col-reverse rounded-xl px-2 py-1.5", onGround ? "bg-card shadow-cp-card" : "bg-background")}>
          <dt className="truncate text-xs font-normal text-muted-foreground">{t.label}</dt>
          <dd className="truncate text-[15px] font-medium tabular-nums">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The recipe tile as a post's hero (a photo takes its place with CM-4): the dish's name and the recipe line on its colour. */
export function PostHero({ card, tall = false }: { card: Pick<PostCard, "title" | "tile" | "recipeLine">; tall?: boolean }) {
  return (
    <span
      style={{ "--tile-bg": card.tile.bg } as React.CSSProperties}
      className={cn(
        "flex flex-col justify-end rounded-2xl bg-[linear-gradient(160deg,var(--tile-bg),hsl(var(--card)))] p-3.5",
        // Dark (the new frame): the tile is the line colour, as the boards draw it.
        "[@media(prefers-color-scheme:dark)]:[.cookpool-new_&]:bg-cp-line",
        tall ? "h-[200px]" : "h-[168px]",
      )}
    >
      <span className="break-words text-[22px] font-medium leading-tight text-foreground">{card.title}</span>
      {card.recipeLine ? <span className="text-[13px] font-normal text-muted-foreground">{card.recipeLine}</span> : null}
    </span>
  );
}

/** Yum: a toggle with its count, in the accent when it's yours (a heart, as `RvCommunity` draws it). */
export function YumButton({ on, label, onClick, big = false }: { on: boolean; label: string; onClick: () => void; big?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium tabular-nums transition-colors",
        FOCUS,
        big && "px-3.5 text-[15px]",
        on ? "bg-cp-accent-tint text-cp-accent-text" : big ? "bg-secondary text-foreground hover:bg-accent" : "text-muted-foreground hover:bg-accent",
      )}
    >
      <Heart className={cn("h-[18px] w-[18px]", on && "fill-current")} strokeWidth={2.2} aria-hidden />
      {label}
    </button>
  );
}

/**
 * One post in a feed or on a profile, compact (`RvCommunity`): one link
 * (RV-18) holding the recipe's tile, the dish, who and when, and the numbers
 * ("450 g · 48 min · 12 likes"), opening the post; then two icons — Like and the
 * save (`cookThis`, Cook this's copy). The author, the caption, the comments
 * and the ⋯ menu are on the post's page.
 */
export function PostCardView({
  card,
  onYum,
  cookThis,
}: {
  card: PostCard;
  meId?: string | null;
  onYum: () => void;
  onMore?: (() => void) | undefined;
  /** The save icon (`CookThisIcon`), when the post links a recipe. */
  cookThis?: React.ReactNode;
}) {
  return (
    <article aria-labelledby={`post-${card.id}`} className="flex items-center gap-3 rounded-cp-card bg-card py-2.5 pl-2.5 pr-1.5 shadow-cp-card">
      <Link href={card.href} className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-2xl", FOCUS)}>
        <PostTile tile={card.tile} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={`post-${card.id}`} className="truncate text-base font-medium">
            {card.title}
          </span>
          <span className="truncate text-[13px] font-normal text-muted-foreground">{card.byline}</span>
          <span className="truncate text-[13px] font-normal tabular-nums text-foreground">{postNumbers(card)}</span>
        </span>
      </Link>
      <span className="flex shrink-0 flex-col">
        <button
          type="button"
          aria-pressed={card.yum.on}
          aria-label={`${card.yum.on ? "Liked" : "Like"} ${card.title}`}
          onClick={onYum}
          className={cn("grid h-11 w-11 place-items-center rounded-[14px] hover:bg-accent", FOCUS, card.yum.on ? "text-cp-accent-text" : "text-muted-foreground")}
        >
          <Heart className={cn("h-5 w-5", card.yum.on && "fill-current")} strokeWidth={2} aria-hidden />
        </button>
        {cookThis}
      </span>
    </article>
  );
}

/** The recipe's tile on a compact card: its colour and the board's dish glyph, a plate (the line colour in dark; RV-23). */
function PostTile({ tile }: { tile: PostCard["tile"] }) {
  return (
    <span
      aria-hidden
      style={{ "--tile-bg": tile.bg, "--tile-fg": tile.fg } as React.CSSProperties}
      className={cn(
        "grid h-[76px] w-[76px] shrink-0 place-items-center rounded-2xl bg-[var(--tile-bg)] text-[var(--tile-fg)]",
        "[@media(prefers-color-scheme:dark)]:[.cookpool-new_&]:bg-cp-line [@media(prefers-color-scheme:dark)]:[.cookpool-new_&]:text-muted-foreground",
      )}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="13" r="7" />
        <circle cx="12" cy="13" r="3.5" />
        <path d="M3 4v5M3 9h0M21 4v16" />
      </svg>
    </span>
  );
}

/** The save icon on a compact card: outlined to save a copy, filled once it is yours or saved. */
export const SAVE_ICON_BUTTON = cn("grid h-11 w-11 place-items-center rounded-[14px] hover:bg-accent disabled:opacity-70", FOCUS);

/** Cook this (copy and open) or Saved ✓ (open your copy): herb-tinted, on the card's right. */
export const COOK_THIS_BUTTON = cn("flex min-h-11 shrink-0 items-center rounded-xl bg-cp-accent-tint px-3.5 text-sm font-medium text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 disabled:opacity-70", FOCUS);

/** A feed loading: two grey cards. */
export function PostCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-24 w-full rounded-cp-card" />
      <Skeleton className="h-24 w-full rounded-cp-card" />
      <Skeleton className="h-24 w-full rounded-cp-card" />
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
          <span className="break-words text-[15px] font-normal leading-snug">
            <b className="font-medium">{line.who}</b> {line.what}
          </span>
          <span className="text-[13px] font-normal text-muted-foreground">{line.when}</span>
        </span>
        {line.unread ? <span aria-label="New" className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" /> : null}
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
      </Link>
    </li>
  );
}
