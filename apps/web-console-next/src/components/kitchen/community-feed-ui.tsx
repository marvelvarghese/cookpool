"use client";

import * as React from "react";
import Link from "./link";
import { Bookmark } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { CommunityPost, FeedTab, PostRecipe } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { KCard, K_BUTTON_QUIET, K_SECTION } from "./kit";
import { useProfile } from "./data";
import { useKitchenRouter } from "./transition-ui";
import { savedCopyOf } from "./cook-hub";
import { recipeHref } from "./recipes";
import { useCopyRecipe, useMyRecipes } from "./recipes-data";
import { EmptyLine, GREEN_BUTTON } from "./community-views";
import { NO_COOKS_TEXT } from "./community";
import { EXPLORE_HREF } from "./explore";
import { FEED_HEADINGS, cookThis, feedEmpty, feedTabFrom, postCard } from "./community-posts";
import { COOK_THIS_BUTTON, FeedTabs, PostCardSkeleton, PostCardView, SAVE_ICON_BUTTON } from "./community-post-views";
import { useFeed, useProfilePosts, useYum, type PagedRead } from "./community-posts-data";
import { PostMenuSheet, ReportSheet, type ReportTarget } from "./community-report-ui";

/**
 * The feed in the app (cookpool-community CM-6, the canvas's
 * `CommunityFeed`): Following · Discover (`?tab=`), post cards, the next
 * page read as you near the end, and each tab's empty state; the same cards
 * fill a profile's Cooks. A card's Yum is instant; Cook this saves your copy
 * of the recipe (RC's copy, with Undo) and opens it, and reads "Saved ✓"
 * after.
 */

/** Your recipes' ids, and your copies by source, for Cook this. */
function useMine() {
  const mine = useMyRecipes();
  return React.useMemo(() => ({ data: mine.data, ownIds: new Set((mine.data ?? []).filter((r) => r.mine && !r.source).map((r) => r.id)) }), [mine.data]);
}

/** Cook this: your recipe opens; your copy opens ("Saved ✓"); else copy it, then open the copy. */
export function CookThisButton({ recipe, mine, icon = false }: { recipe: PostRecipe; mine: ReturnType<typeof useMine>; icon?: boolean }) {
  const router = useKitchenRouter();
  const copy = useCopyRecipe();
  const [state, setState] = React.useState<{ kind: "idle" } | { kind: "saving" } | { kind: "saved"; id: string }>({ kind: "idle" });
  const copyId = state.kind === "saved" ? state.id : savedCopyOf(recipe.id, mine.data);
  const what = cookThis(recipe, { ownIds: mine.ownIds, copyId: state.kind === "saving" ? null : copyId, saving: state.kind === "saving" });
  if (what.kind === "none") return null;
  // On a compact card (`RvCommunity`): a bookmark, filled once the recipe is yours or saved.
  const mark = icon ? <Bookmark className={cn("h-5 w-5", what.kind !== "copy" && "fill-current")} strokeWidth={2} aria-hidden /> : null;
  const iconClass = cn(SAVE_ICON_BUTTON, what.kind === "copy" ? "text-muted-foreground" : "text-cp-accent-text");
  if (what.kind === "open" || what.kind === "saved") {
    return (
      <Link href={recipeHref(what.recipeId)} aria-label={icon ? `${what.label} · ${recipe.name}` : undefined} className={icon ? iconClass : COOK_THIS_BUTTON}>
        {mark ?? (
          <>
            {what.label}
            <span className="sr-only"> · {recipe.name}</span>
          </>
        )}
      </Link>
    );
  }
  return (
    <button
      type="button"
      disabled={what.kind === "saving"}
      onClick={() => {
        setState({ kind: "saving" });
        void copy({ recipe, code: recipe.linkCode, onUndone: () => setState({ kind: "idle" }) }).then((r) => {
          if (!r.ok) {
            setState({ kind: "idle" });
            return;
          }
          setState({ kind: "saved", id: r.data.recipe.id });
          router.push(recipeHref(r.data.recipe.id));
        });
      }}
      aria-label={icon ? `${what.label} · save ${recipe.name} to your recipes` : undefined}
      className={icon ? iconClass : COOK_THIS_BUTTON}
    >
      {mark ?? (
        <>
          {what.label}
          <span className="sr-only"> · save {recipe.name} to your recipes</span>
        </>
      )}
    </button>
  );
}

/** Cards over a paged read: each with Yum, ⋯ (report, mute, block; yours: who sees it, delete) and Cook this; the next page near the end. */
export function PostList({ read, empty }: { read: PagedRead<CommunityPost>; empty: React.ReactNode }) {
  const me = useProfile();
  const meId = me.data?.id ?? null;
  const mine = useMine();
  const yum = useYum();
  const [now] = React.useState(() => new Date());
  const [menu, setMenu] = React.useState<CommunityPost | null>(null);
  const [report, setReport] = React.useState<ReportTarget | null>(null);
  const end = React.useRef<HTMLDivElement>(null);
  const { hasMore, loadMore } = read;

  // Near the end (600 px before it), the next page.
  React.useEffect(() => {
    const el = end.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  if (read.loading) return <PostCardSkeleton />;
  if (read.failed) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the posts.</p>
        <Button variant="outline" className={K_BUTTON_QUIET} onClick={read.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  if (read.items.length === 0) return <>{empty}</>;
  return (
    <>
      <div className="flex flex-col gap-2.5">
        {read.items.map((post) => (
          <PostCardView
            key={post.id}
            card={postCard(post, now, mine.ownIds)}
            meId={meId}
            onYum={() => yum(post)}
            onMore={() => setMenu(post)}
            cookThis={post.recipe ? <CookThisButton recipe={post.recipe} mine={mine} icon /> : null}
          />
        ))}
      </div>
      <div ref={end} aria-hidden className="h-px" />
      {hasMore ? (
        <button type="button" onClick={loadMore} disabled={read.loadingMore} className="min-h-11 self-center rounded-xl px-4 text-[15px] font-medium text-cp-accent-text hover:bg-accent disabled:opacity-60">
          {read.loadingMore ? "Loading…" : "More"}
        </button>
      ) : null}
      <PostMenuSheet post={menu} onClose={() => setMenu(null)} onReport={setReport} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </>
  );
}

/** Following · Everyone, under Community's header, with the tab's heading over its cards. */
export function CommunityFeed() {
  const params = useSearchParams();
  const tab = feedTabFrom(params?.get("tab"));
  return (
    <>
      <FeedTabs tab={tab} />
      <section aria-labelledby="feed-h" className="flex flex-col gap-2.5">
        {/* The tab's heading, with See all beside it: Explore (RvCommunity, RV-23). */}
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id="feed-h" className={K_SECTION}>
            {FEED_HEADINGS[tab]}
          </h2>
          <Link href={EXPLORE_HREF} className="flex min-h-11 shrink-0 items-center rounded-md text-sm font-medium text-cp-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            See all
          </Link>
        </div>
        <FeedTabBody key={tab} tab={tab} />
      </section>
    </>
  );
}

function FeedTabBody({ tab }: { tab: FeedTab }) {
  const read = useFeed(tab);
  const e = feedEmpty(tab);
  return (
    <PostList
      read={read}
      empty={
        <section aria-label="Feed" className="flex flex-col items-center gap-1.5 rounded-cp-card bg-card px-6 py-10 text-center shadow-cp-card">
          <p className="text-base font-medium">{e.title}</p>
          <p className="text-sm font-normal text-muted-foreground">{e.sub}</p>
          {e.action ? (
            <Link href={e.action.href} className={cn("mt-2 flex min-h-11 items-center rounded-xl px-5 text-[15px] font-medium", GREEN_BUTTON)}>
              {e.action.label}
            </Link>
          ) : null}
        </section>
      }
    />
  );
}

/** A profile's Cooks: their posts you may see, as cards. */
export function ProfileCooks({ handle }: { handle: string }) {
  const read = useProfilePosts(handle, true);
  return (
    <div className="flex flex-col gap-3">
      <PostList read={read} empty={<EmptyLine>{NO_COOKS_TEXT}</EmptyLine>} />
    </div>
  );
}
