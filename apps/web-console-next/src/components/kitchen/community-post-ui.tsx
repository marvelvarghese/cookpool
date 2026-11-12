"use client";

import * as React from "react";
import Link from "./link";
import { MoreHorizontal } from "lucide-react";
import { COMMENT_BODY_MAX, type CommunityPost, type PostComment } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { usePathParam } from "@/lib/page-param";
import { isPendingId } from "@/lib/optimistic";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CLOSE_44, KCard, K_BUTTON_QUIET } from "./kit";
import { BackButton } from "./back-ui";
import { useProfile } from "./data";
import { useKitchenRouter } from "./transition-ui";
import { useMyRecipes } from "./recipes-data";
import { COMMUNITY_HREF, HANDLE_SETUP_HREF, profileHref, profileInitials } from "./community";
import {
  COMMENT_PLACEHOLDER,
  commentBody,
  commentRights,
  commentsHeading,
  postCard,
  shortAgo,
  stepCompareText,
  yumNamesText,
} from "./community-posts";
import { EmptyLine, GREEN_BUTTON, ProfileFace, SectionLabel } from "./community-views";
import { PostHero, StatTiles, YumButton } from "./community-post-views";
import { CookThisButton } from "./community-feed-ui";
import { useAddComment, useComments, usePost, useRemoveComment, useYum } from "./community-posts-data";
import { useMyCommunityProfile } from "./community-data";
import { PostMenuSheet, ReportSheet, type ReportTarget } from "./community-report-ui";

/**
 * A post (cookpool-community CM-6, the canvas's `PostDetail`): `/p/<id>`.
 * Back, who and when, ⋯; the recipe tile, the stats, the caption; "Steps took
 * Anu 48 min · yours usually 55 min" with Cook this; Yum and who said it;
 * the comments, oldest first, with More; and the comment box. Hold a comment
 * (or its ⋯) to remove it — yours, or any on your post, with Undo — or to
 * report it.
 */

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PostScreen() {
  const raw = usePathParam("/p/:postId", "postId");
  const postId = raw && /^pst_[A-Za-z0-9]{1,64}$/.test(raw) ? raw : null;
  const read = usePost(postId);
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      {read.loading ? (
        <PostSkeleton />
      ) : !postId || read.error?.code === "not_found" ? (
        <>
          <div className="-ml-2.5 flex min-h-11 items-center">
            <BackButton />
          </div>
          <KCard className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <h1 className="text-lg font-medium tracking-tight">This post isn&apos;t here</h1>
            <p className="text-sm text-muted-foreground">It was deleted, or it isn&apos;t shared with you.</p>
            <Link href={COMMUNITY_HREF} className={cn("flex min-h-11 items-center rounded-xl px-5 text-[15px] font-medium", GREEN_BUTTON)}>
              Community
            </Link>
          </KCard>
        </>
      ) : read.error || !read.data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this post.</p>
          <Button variant="outline" className={K_BUTTON_QUIET} onClick={read.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <PostBody post={read.data.post} />
      )}
    </div>
  );
}

function PostSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-[200px] w-full rounded-[20px]" />
      <Skeleton className="h-14 w-full rounded-xl" />
    </div>
  );
}

function PostBody({ post }: { post: CommunityPost }) {
  const me = useProfile();
  const meId = me.data?.id ?? null;
  const mineRecipes = useMyRecipes();
  const ownIds = React.useMemo(() => new Set((mineRecipes.data ?? []).filter((r) => r.mine && !r.source).map((r) => r.id)), [mineRecipes.data]);
  const myProfile = useMyCommunityProfile().data?.profile ?? null;
  const router = useKitchenRouter();
  const yum = useYum();
  const [now] = React.useState(() => new Date());
  const [menu, setMenu] = React.useState<CommunityPost | null>(null);
  const [report, setReport] = React.useState<ReportTarget | null>(null);
  const card = postCard(post, now, ownIds);
  const compare = stepCompareText(post);
  const names = yumNamesText(post.yums, myProfile?.name ?? null);
  const face = card.author.userId ? <ProfileFace userId={card.author.userId} meId={meId} initials={card.author.initials} /> : null;

  return (
    <>
      <div className="-ml-2.5 flex min-h-11 items-center gap-2">
        <BackButton />
        {card.author.href ? (
          <Link href={card.author.href} className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-xl", FOCUS)}>
            {face}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[15px] font-medium">{card.author.name}</span>
              <span className="truncate text-[13px] font-normal text-muted-foreground">{card.author.meta}</span>
            </span>
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-medium">{card.author.name}</span>
            <span className="truncate text-[13px] font-normal text-muted-foreground">{card.author.meta}</span>
          </span>
        )}
        <button type="button" aria-label="More" aria-haspopup="dialog" onClick={() => setMenu(post)} className={cn("-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-accent", FOCUS)}>
          <MoreHorizontal className="h-6 w-6" strokeWidth={2.2} aria-hidden />
        </button>
      </div>

      <h1 className="sr-only">{post.title}</h1>
      <PostHero card={card} tall />
      <StatTiles tiles={card.tiles} onGround />
      {card.caption ? <p className="whitespace-pre-line break-words text-[15px] font-normal leading-relaxed">{card.caption}</p> : null}

      {compare || post.recipe ? (
        <div className="flex items-center gap-2.5 rounded-2xl bg-card px-3 py-2.5 shadow-cp-card">
          <span className="min-w-0 flex-1 text-sm font-normal text-muted-foreground">{compare ?? post.recipe?.name}</span>
          {post.recipe ? <CookThisButton recipe={post.recipe} mine={{ data: mineRecipes.data, ownIds }} /> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <YumButton big on={card.yum.on} label={card.yum.label} onClick={() => yum(post)} />
        {names ? <span className="text-[13px] font-normal text-muted-foreground">{names}</span> : null}
      </div>

      <Comments post={post} meId={meId} onReport={setReport} />

      <PostMenuSheet post={menu} onClose={() => setMenu(null)} onReport={setReport} onGone={() => router.replace(COMMUNITY_HREF)} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
      {myProfile ? (
        <CommentBox post={post} author={myProfile} />
      ) : (
        <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-30 -mx-4 bg-card px-4 py-3 shadow-cp-nav min-[900px]:bottom-6 min-[900px]:mx-0 min-[900px]:rounded-[22px]">
          <Link href={HANDLE_SETUP_HREF} className="flex min-h-11 items-center justify-center rounded-[14px] text-[15px] font-medium text-cp-accent-text hover:underline">
            Pick a handle to comment
          </Link>
        </div>
      )}
    </>
  );
}

function Comments({ post, meId, onReport }: { post: CommunityPost; meId: string | null; onReport: (t: ReportTarget) => void }) {
  const read = useComments(post.id);
  const [open, setOpen] = React.useState<PostComment | null>(null);
  const [now] = React.useState(() => new Date());
  const count = read.count ?? post.comments.count;
  return (
    <section aria-labelledby="comments-h" className="flex flex-col gap-2.5 pt-1">
      <SectionLabel id="comments-h">{commentsHeading(count)}</SectionLabel>
      {read.loading ? (
        <Skeleton className="h-14 w-full rounded-2xl" />
      ) : read.failed ? (
        <EmptyLine>Couldn&apos;t load the comments.</EmptyLine>
      ) : read.items.length === 0 ? (
        <p className="text-sm font-normal text-muted-foreground">No comments yet</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {read.items.map((c) => (
            <CommentRow key={c.id} comment={c} meId={meId} now={now} onOpen={() => setOpen(c)} />
          ))}
        </ul>
      )}
      {read.hasMore ? (
        <button type="button" onClick={read.loadMore} disabled={read.loadingMore} className="min-h-11 self-start rounded-xl px-1 text-[15px] font-medium text-cp-accent-text hover:underline disabled:opacity-60">
          {read.loadingMore ? "Loading…" : "More comments"}
        </button>
      ) : null}
      <CommentSheet comment={open} post={post} onClose={() => setOpen(null)} onReport={onReport} />
    </section>
  );
}

const HOLD_MS = 500;

/** A comment: face, name · when, the words. Held (or its ⋯) opens remove / report. */
function CommentRow({ comment, meId, now, onOpen }: { comment: PostComment; meId: string | null; now: Date; onOpen: () => void }) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const pending = isPendingId(comment.id);
  return (
    <li
      className={cn("flex items-start gap-2.5", pending && "opacity-70")}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" || pending) return;
        clear();
        timer.current = setTimeout(onOpen, HOLD_MS);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => {
        if (pending) return;
        e.preventDefault();
        onOpen();
      }}
    >
      <Link href={profileHref(comment.author.handle)} tabIndex={-1} aria-hidden className="shrink-0 rounded-full">
        <span className="[&>span]:h-8 [&>span]:w-8 [&>span]:text-[13px]">
          <ProfileFace userId={comment.author.userId} meId={meId} initials={profileInitials(comment.author)} />
        </span>
      </Link>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-2xl bg-card px-3 py-2 shadow-cp-card">
        <span className="text-[13px] font-medium">
          <Link href={profileHref(comment.author.handle)} className="hover:underline">
            {comment.mine ? "You" : comment.author.name}
          </Link>{" "}
          <span className="font-normal text-muted-foreground">· {pending ? "sending" : shortAgo(comment.createdAt, now)}</span>
        </span>
        <span className="whitespace-pre-line break-words text-[15px] font-normal">{comment.body}</span>
      </span>
      {pending ? null : (
        <button type="button" aria-label="Comment options" aria-haspopup="dialog" onClick={onOpen} className={cn("grid h-11 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-accent", FOCUS)}>
          <MoreHorizontal className="h-5 w-5" strokeWidth={2.2} aria-hidden />
        </button>
      )}
    </li>
  );
}

/** A comment's options: Remove (yours, or on your post; with Undo) and Report (anyone else's). */
function CommentSheet({ comment, post, onClose, onReport }: { comment: PostComment | null; post: CommunityPost; onClose: () => void; onReport: (t: ReportTarget) => void }) {
  const remove = useRemoveComment();
  const rights = comment ? commentRights(comment, post) : null;
  const item = cn("min-h-[52px] w-full rounded-[14px] text-base font-medium transition-colors", FOCUS);
  return (
    <Sheet open={comment !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn("mx-auto max-w-xl gap-2 rounded-t-[24px] border-x-0 bg-card px-5 pb-6 pt-3 min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border", CLOSE_44)}>
        <SheetTitle className="flex min-h-11 items-center pr-12 text-lg font-medium">Comment</SheetTitle>
        {comment && rights ? (
          <div className="flex flex-col gap-2">
            <p className="line-clamp-3 break-words rounded-2xl bg-background px-3 py-2 text-[15px] font-normal">{comment.body}</p>
            {rights.remove ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  remove(comment);
                }}
                className={cn(item, "bg-cp-expired-tint text-destructive hover:bg-cp-expired-tint/80")}
              >
                Remove comment
              </button>
            ) : null}
            {rights.report ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReport({ kind: "comment", id: comment.id });
                }}
                className={cn(item, "bg-secondary hover:bg-accent")}
              >
                Report comment
              </button>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The comment box, above the tab bar: the field and Send. */
function CommentBox({ post, author }: { post: CommunityPost; author: PostComment["author"] }) {
  const add = useAddComment();
  const read = useComments(post.id);
  const [draft, setDraft] = React.useState("");
  const body = commentBody(draft, COMMENT_BODY_MAX);
  const send = () => {
    if (!body) return;
    const kept = draft;
    setDraft("");
    void add({ postId: post.id, body, author, lastPageLoaded: !read.hasMore }).then((ok) => {
      if (!ok) setDraft((cur) => cur || kept);
    });
  };
  return (
    <form
      data-toast-above=""
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-30 -mx-4 flex gap-2 bg-card px-4 py-2.5 shadow-cp-nav min-[900px]:bottom-6 min-[900px]:mx-0 min-[900px]:rounded-[22px]"
    >
      <input
        aria-label={COMMENT_PLACEHOLDER}
        value={draft}
        maxLength={COMMENT_BODY_MAX}
        enterKeyHint="send"
        placeholder={COMMENT_PLACEHOLDER}
        onChange={(e) => setDraft(e.target.value)}
        className="min-h-12 min-w-0 flex-1 rounded-[14px] bg-secondary px-3.5 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button type="submit" disabled={!body} className={cn("min-h-12 min-w-[72px] rounded-[14px] px-3 text-[15px] font-medium disabled:opacity-50", GREEN_BUTTON, FOCUS)}>
        Send
      </button>
    </form>
  );
}
