"use client";

import * as React from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  ActivityResponse,
  CommentsResponse,
  CommunityPost,
  CreatePostRequest,
  FeedResponse,
  FeedTab,
  PostAudience,
  PostComment,
  PostResponse,
  ProfilePostsResponse,
  ReportReason,
  ReportTargetKind,
  UnreadActivityResponse,
} from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { applyPatches, pendingId, trackWrite } from "@/lib/optimistic";
import { afterWrites, qk, type AsyncState } from "@/lib/query";
import { isOffline, refuseIfOffline } from "@/lib/connection";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { UNDO_MS, refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { AUDIENCE_WORDS, authorHiddenPatches, commentAddedPatches, commentRefusalText, commentRemovedPatches, commentSavedPatches, postAddedPatches, postRemovedPatches, postReplacedPatches, yumAnsweredPatches, yumPatches } from "./community-posts";
import { REPORTED_TOAST, reportRequest } from "./community-activity";
import { useBlock, useMute } from "./community-data";

/**
 * Posts in the app (cookpool-community CM-6): the reads and writes behind
 * the feed, a post, its comments, a profile's posts and Activity, over
 * CM-3's routes. Yum, comments, removing a comment, deleting a post and
 * changing its audience are SM-5's instant writes: the screen changes first,
 * a refusal puts it back and says why, and Undo (where there is one) sends
 * the other way. Share this cook's Post is `useCreatePost`.
 */

type Paged<T> = { pages: T[]; pageParams: unknown[] };

export interface PagedRead<T> {
  items: T[];
  /** Until the first page answers. */
  loading: boolean;
  /** The first page couldn't be read. */
  failed: boolean;
  error: ApiErrorBody | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

function usePaged<P, T>(key: readonly unknown[], load: (cursor: string | null) => Promise<ApiResult<P>>, itemsOf: (page: P) => T[], cursorOf: (page: P) => string | null, enabled = true): PagedRead<T> & { pages: P[] } {
  const qc = useQueryClient();
  const q = useInfiniteQuery<P, ApiErrorBody>({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      afterWrites(qc, key, async () => {
        const r = await load(typeof pageParam === "string" ? pageParam : null);
        if (!r.ok) throw r.error;
        return r.data;
      })(),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => cursorOf(last) ?? undefined,
    enabled,
    retry: (count, error) => error.code !== "not_found" && error.code !== "forbidden" && count < 1,
  });
  const pages = React.useMemo(() => q.data?.pages ?? [], [q.data]);
  const items = React.useMemo(() => pages.flatMap(itemsOf), [pages, itemsOf]);
  const { fetchNextPage, refetch, hasNextPage, isFetchingNextPage } = q;
  return {
    pages,
    items,
    loading: q.isLoading,
    failed: q.isError && !q.data,
    error: q.error ?? null,
    hasMore: !!hasNextPage,
    loadingMore: isFetchingNextPage,
    loadMore: React.useCallback(() => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]),
    reload: React.useCallback(() => void refetch(), [refetch]),
  };
}

const feedPosts = (p: FeedResponse | ProfilePostsResponse) => p.posts;
const nextOf = (p: { nextCursor: string | null }) => p.nextCursor;

// ── Reads ─────────────────────────────────────────────────────────

/** Following or Discover (`GET /v1/kitchen/me/feed`), 20 a page; `loadMore` reads the next. */
export function useFeed(tab: FeedTab): PagedRead<CommunityPost> {
  const { client } = useSession();
  return usePaged(qk.kitchenFeed(tab), (cursor) => wrap(() => client.kitchen.feed(cursor ? { tab, cursor } : { tab })), feedPosts, nextOf);
}

/** Someone's posts (`GET …/profiles/{handle}/posts`), when `canSee`. */
export function useProfilePosts(handle: string, enabled: boolean): PagedRead<CommunityPost> {
  const { client } = useSession();
  return usePaged(qk.kitchenProfilePosts(handle), (cursor) => wrap(() => client.kitchen.profilePosts(handle, cursor ? { cursor } : {})), feedPosts, nextOf, enabled && !!handle);
}

/** A post (`GET /v1/kitchen/posts/{pst}`): 404 for none, or one you can't see. Not retried then. */
export function usePost(postId: string | null): AsyncState<PostResponse> {
  const { client } = useSession();
  const qc = useQueryClient();
  const key = qk.kitchenPost(postId ?? "");
  const q = useQuery<PostResponse, ApiErrorBody>({
    queryKey: key,
    queryFn: afterWrites(qc, key, async () => {
      const r = await wrap(() => client.kitchen.post(postId ?? ""));
      if (!r.ok) throw r.error;
      return r.data;
    }),
    enabled: !!postId,
    retry: (count, error) => error.code !== "not_found" && count < 1,
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.error ? { code: q.error.code ?? "error", message: q.error.message ?? "Request failed" } : null,
    reload: () => void q.refetch(),
  };
}

const commentsOfPage = (p: CommentsResponse) => p.comments;

/** A post's comments, oldest first, 30 a page; `count` is every comment you can see. */
export function useComments(postId: string, enabled = true): PagedRead<PostComment> & { count: number | null } {
  const { client } = useSession();
  const read = usePaged(qk.kitchenPostComments(postId), (cursor) => wrap(() => client.kitchen.comments(postId, cursor ? { cursor } : {})), commentsOfPage, nextOf, enabled && !!postId);
  const last = read.pages[read.pages.length - 1];
  return { ...read, count: last ? last.count : null };
}

const activityItems = (p: ActivityResponse) => p.items;

/** Activity (`GET /v1/kitchen/me/activity`): the requests (from the first page) and the items, 30 a page. */
export function useActivity(): PagedRead<ActivityResponse["items"][number]> & { requests: ActivityResponse["requests"] | null } {
  const { client } = useSession();
  const read = usePaged(qk.kitchenCommunityActivity(), (cursor) => wrap(() => client.kitchen.communityActivity(cursor ? { cursor } : {})), activityItems, nextOf);
  return { ...read, requests: read.pages[0]?.requests ?? null };
}

/** The bell's count (`GET …/activity/unread`): read again every minute while a page shows it. */
export function useUnreadActivity(enabled: boolean): number | null {
  const { client } = useSession();
  const q = useQuery<UnreadActivityResponse, ApiErrorBody>({
    queryKey: qk.kitchenUnreadActivity(),
    queryFn: async () => {
      const r = await wrap(() => client.kitchen.unreadActivity());
      if (!r.ok) throw r.error;
      return r.data;
    },
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
  return q.data?.count ?? null;
}

/** Opening Activity: everything up to `before` is read — the bell goes to 0 at once, the items lose their dot once it lands. */
export function useMarkActivityRead() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    (before: string): void => {
      if (isOffline()) return;
      qc.setQueryData<UnreadActivityResponse>(qk.kitchenUnreadActivity(), { count: 0 });
      void trackWrite(qc, wrap(() => client.kitchen.markActivityRead(before))).then((r) => {
        if (!r.ok) void qc.invalidateQueries({ queryKey: qk.kitchenUnreadActivity() });
      });
    },
    [client, qc],
  );
}

// ── Refreshing ────────────────────────────────────────────────────

/** Every post read: both feeds, posts, profiles' posts (once a write lands). */
export function refreshPosts(qc: QueryClient, postId?: string): void {
  void qc.invalidateQueries({ queryKey: ["kitchenCommunity", "feed"] });
  void qc.invalidateQueries({ queryKey: ["kitchenCommunity", "posts"] });
  if (postId) void qc.invalidateQueries({ queryKey: qk.kitchenPost(postId) });
}

function noProfileWhy(error: ApiErrorBody, doing: string): string {
  return error.reason === "no_profile" ? `Pick a handle to ${doing}` : error.message;
}

// ── Yum ───────────────────────────────────────────────────────────

/** Yum or take it back, at once; the button is its own undo. */
export function useYum() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    (post: Pick<CommunityPost, "id" | "yums">): void => {
      const on = !post.yums.mine;
      const write = beginWrite(qc, yumPatches(post.id, on));
      void write.track(wrap(() => (on ? client.kitchen.yum(post.id) : client.kitchen.unyum(post.id)))).then((r) => {
        if (!r.ok) {
          write.rollback();
          toast(refusedToast(on ? "Couldn't say Yum" : "Couldn't take it back", noProfileWhy(r.error, "say Yum")));
          return;
        }
        applyPatches(queryCacheOf(qc), yumAnsweredPatches(post.id, r.data.yums));
      });
    },
    [client, qc, toast],
  );
}

// ── Comments ──────────────────────────────────────────────────────

/** Send a comment: on the list at once (yours, with your face), the server's in its place once it answers. */
export function useAddComment() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    (input: { postId: string; body: string; author: PostComment["author"]; lastPageLoaded: boolean }): Promise<boolean> => {
      const tempId = pendingId("cmt");
      const shown: PostComment = { id: tempId, postId: input.postId, author: input.author, body: input.body, createdAt: new Date().toISOString(), mine: true, canRemove: true };
      const write = beginWrite(qc, commentAddedPatches(input.postId, shown, input.lastPageLoaded));
      return write.track(wrap(() => client.kitchen.addComment(input.postId, { body: input.body }, { idempotencyKey: crypto.randomUUID() }))).then((r) => {
        if (!r.ok) {
          write.rollback();
          toast(refusedToast("Couldn't send it", commentRefusalText(r.error)));
          return false;
        }
        applyPatches(queryCacheOf(qc), commentSavedPatches(input.postId, tempId, r.data.comment));
        return true;
      });
    },
    [client, qc, toast],
  );
}

/**
 * Remove a comment (yours, or any on your post): off at once, with Undo. The
 * server has no restore, so the DELETE goes when the Undo has gone — or at
 * once if the page is closed meanwhile.
 */
export function useRemoveComment() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const { toast } = useToast();
  return React.useCallback(
    (comment: Pick<PostComment, "id" | "postId">): void => {
      if (refuseIfOffline()) return;
      const write = beginWrite(qc, commentRemovedPatches(comment.postId, comment.id));
      let undone = false;
      let sent: Promise<ApiResult<unknown>> | null = null;
      const send = (): void => {
        if (undone || sent) return;
        window.removeEventListener("pagehide", send);
        sent = write.track(wrap(() => client.kitchen.deleteComment(comment.id)));
        void sent.then((r) => {
          if (r.ok || r.error.code === "not_found") return;
          write.rollback();
          toast(refusedToast("Couldn't remove it", r.error.message));
        });
      };
      const timer = setTimeout(send, UNDO_MS);
      window.addEventListener("pagehide", send);
      offer({
        title: "Comment removed",
        undo: async (): Promise<UndoResult> => {
          if (!sent) return { ok: true };
          const r = await sent;
          return r.ok ? { ok: false, kind: "warning", title: "Already removed" } : { ok: true };
        },
        restore: () => {
          if (sent) return;
          undone = true;
          clearTimeout(timer);
          window.removeEventListener("pagehide", send);
          write.restore();
        },
      });
    },
    [client, qc, offer, toast],
  );
}

// ── Your posts ────────────────────────────────────────────────────

/** Delete your post: out of the feeds at once; Undo restores it (the server keeps it 10 minutes). */
export function useDeletePost() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (post: Pick<CommunityPost, "id" | "title">, onGone?: () => void): void => {
      const write = beginWrite(qc, postRemovedPatches(post.id));
      const sent = write.track(wrap(() => client.kitchen.deletePost(post.id)));
      const toast = offer({
        title: `Deleted ${post.title}`,
        description: "Off your profile and every feed",
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await trackWrite(qc, wrap(() => client.kitchen.restorePost(post.id)));
          if (u.ok) qc.setQueryData(qk.kitchenPost(post.id), u.data);
          refreshPosts(qc, post.id);
          return u.ok ? { ok: true, description: `${post.title} is back` } : { ok: false, kind: "error", title: "Couldn't put it back", description: u.error.message };
        },
        restore: () => write.restore(),
      });
      void sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          toast.refuse(refusedToast(`Couldn't delete ${post.title}`, r.error.message));
          return;
        }
        onGone?.();
        refreshPosts(qc);
      });
    },
    [client, qc, offer],
  );
}

/** Change who sees your post, at once; Undo sends the one before. */
export function useEditAudience() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (post: CommunityPost, audience: PostAudience): void => {
      if (post.audience === audience) return;
      const before = post.audience;
      const send = (to: PostAudience) => wrap(() => client.kitchen.updatePost(post.id, { audience: to }));
      const write = beginWrite(qc, postReplacedPatches({ ...post, audience }));
      const sent = write.track(send(audience));
      const toast = offer({
        title: `Now ${AUDIENCE_WORDS[audience]}`,
        description: post.title,
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await trackWrite(qc, send(before));
          if (u.ok) applyPatches(queryCacheOf(qc), postReplacedPatches(u.data.post));
          refreshPosts(qc, post.id);
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
        restore: () => write.restore(postReplacedPatches({ ...post, audience: before })),
      });
      void sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          toast.refuse(refusedToast("Couldn't change who sees it", noProfileWhy(r.error, "share beyond Just me")));
          return;
        }
        applyPatches(queryCacheOf(qc), postReplacedPatches(r.data.post));
        refreshPosts(qc, post.id);
      });
    },
    [client, qc, offer],
  );
}

// ── Reports, mutes and blocks from a post ─────────────────────────

/** Report a post, a comment or a profile. No Undo: a report is only stored. */
export function useReport() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    async (target: { kind: ReportTargetKind; id: string }, reason: ReportReason, note: string): Promise<boolean> => {
      if (refuseIfOffline()) return false;
      const r = await trackWrite(qc, wrap(() => client.kitchen.report(reportRequest(target.kind, target.id, reason, note), { idempotencyKey: crypto.randomUUID() })));
      if (!r.ok) {
        toast(refusedToast("Couldn't report it", r.error.message));
        return false;
      }
      toast({ kind: "success", ...REPORTED_TOAST });
      return true;
    },
    [client, qc, toast],
  );
}

/** Mute or block a post's author from the post's ⋯: their posts leave the feeds at once (CM-5's writes, with Undo). */
export function usePostAuthorActions() {
  const qc = useQueryClient();
  const mute = useMute();
  const block = useBlock();
  return React.useMemo(
    () => ({
      mute: (author: { userId: string; handle: string; name: string }) => {
        mute(author, true);
        if (!isOffline()) applyPatches(queryCacheOf(qc), authorHiddenPatches(author.userId, "mute"));
      },
      block: (author: { userId: string; handle: string; name: string }, onDone?: (stands: boolean) => void) => {
        block(author, true, onDone);
        if (!isOffline()) applyPatches(queryCacheOf(qc), authorHiddenPatches(author.userId, "block"));
      },
    }),
    [qc, mute, block],
  );
}

// ── Share this cook? ──────────────────────────────────────────────

export type CreatePostOutcome = { kind: "posted"; post: CommunityPost } | { kind: "open"; postId: string } | { kind: "refused" } | { kind: "held" };

/**
 * Post (Share this cook?): the toast at once — "Posted · your 12 followers
 * see it" — with Undo, which deletes the post; once it answers, the post is
 * first in Following and on your profile. A dish already shared answers
 * `already_posted`: the toast closes and the caller opens that post.
 */
export function useCreatePost() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: { body: CreatePostRequest; toast: { title: string; description: string }; myHandle: string | null; refusedText: (e: ApiErrorBody) => { kind: "open"; postId: string } | { kind: "say"; text: string } }): Promise<CreatePostOutcome> => {
      if (refuseIfOffline()) return Promise.resolve({ kind: "held" });
      const sent = trackWrite(qc, wrap(() => client.kitchen.createPost(input.body, { idempotencyKey: crypto.randomUUID() })));
      let undone = false;
      const toast = offer({
        title: input.toast.title,
        description: input.toast.description,
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          applyPatches(queryCacheOf(qc), postRemovedPatches(r.data.post.id));
          const d = await trackWrite(qc, wrap(() => client.kitchen.deletePost(r.data.post.id)));
          refreshPosts(qc, r.data.post.id);
          return d.ok ? { ok: true, description: "Not shared" } : { ok: false, kind: "error", title: "Couldn't undo it", description: d.error.message };
        },
        restore: () => {
          undone = true;
        },
      });
      return sent.then((r): CreatePostOutcome => {
        if (!r.ok) {
          const why = input.refusedText(r.error);
          if (why.kind === "open") {
            toast.close();
            return why;
          }
          toast.refuse(refusedToast("Couldn't share it", why.text));
          return { kind: "refused" };
        }
        if (!undone) {
          qc.setQueryData(qk.kitchenPost(r.data.post.id), r.data);
          applyPatches(queryCacheOf(qc), postAddedPatches(r.data.post, input.myHandle));
          refreshPosts(qc);
        }
        return { kind: "posted", post: r.data.post };
      });
    },
    [client, qc, offer],
  );
}

export type { Paged };
