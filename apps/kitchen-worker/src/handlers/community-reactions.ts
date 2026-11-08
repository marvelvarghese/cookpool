import {
  COMMENTS_PAGE_SIZE,
  COMMENTS_PER_HOUR,
  COMMENT_BODY_MAX,
  KITCHEN_COMMUNITY_ERROR_REASONS,
  KITCHEN_EMAILS,
  KITCHEN_POSTS_ERROR_REASONS,
  KITCHEN_REPORT_EVENT,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  REPORT_TARGET_KINDS,
  YUM_PUSH_EVERY_MS,
  type CommentResponse,
  type CommentsResponse,
  type DeleteCommentResponse,
  type ReportResponse,
  type YumResponse,
} from "@saas/contracts/kitchen";
import type { AppendEventWithAuditInput } from "@saas/db/events";
import type { KitchenPostRecord, KitchenReportRecord, KitchenRepository } from "@saas/db/kitchen";
import { decodeCursor, encodeCursor, subjectParam } from "../community.js";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { SYSTEM_ORG_ID } from "../emails.js";
import { errorResponse, forbidden, notFound, readJsonObject, successResponse, unavailable, unprocessable, validationError } from "../http.js";
import { toPublicId } from "../ids.js";
import { commentParam, isPostKey, postParam, toPostComment } from "../posts.js";
import { deferSocialPush } from "../social-push.js";
import { Fields, oneOf, text } from "../validate.js";

// Yum, comments and reports (CM-3, cookpool-community design §2):
//
//   POST   /v1/kitchen/posts/{pst}/yum          with a profile → { yums } (201 when new)
//   DELETE /v1/kitchen/posts/{pst}/yum          → { yums }
//   GET    /v1/kitchen/posts/{pst}/comments     → { comments, count, nextCursor } (oldest first)
//   POST   /v1/kitchen/posts/{pst}/comments     with a profile: { body } → 201 { comment }
//   DELETE /v1/kitchen/comments/{cmt}           its author or the post's → { removed: true }
//   POST   /v1/kitchen/reports                  { targetKind, targetId, reason, note? } → 201 { report } (200 a repeat)
//
// Each acts on a post the caller may see (storage's `visiblePostSql`): any
// other is the opaque 404, a block either way included. The Yum and the
// comment write their Activity in their own batch; the push follows only
// once that row was written (never to oneself or across a block), and a Yum
// pushes at most once an hour per post (the slot is claimed in the batch).

const R = KITCHEN_POSTS_ERROR_REASONS;
const HOUR_MS = 60 * 60 * 1000;

/** The post `{pst}` names, when the caller may see it — or the 404 / 503. */
async function visiblePost(ctx: RequestContext, repo: KitchenRepository, raw: string | undefined): Promise<KitchenPostRecord | Response> {
  const postId = postParam(raw);
  if (!postId) return notFound(ctx.requestId);
  const found = await ctx.timings.measure("db", () => repo.getPost(postId, ctx.actor.subjectId));
  if (!found.ok) return unavailable(ctx.requestId);
  return found.value ?? notFound(ctx.requestId);
}

/** The caller's profile name, or the 403 `no_profile` (Yum and comments need one), or a 503. */
async function myName(ctx: RequestContext, repo: KitchenRepository): Promise<string | Response> {
  const mine = await ctx.timings.measure("db", () => repo.getProfile(ctx.actor.subjectId));
  if (!mine.ok) return unavailable(ctx.requestId);
  if (!mine.value) return forbidden(ctx.requestId, "Choose a handle and a name first", KITCHEN_COMMUNITY_ERROR_REASONS.NO_PROFILE);
  return mine.value.name;
}

async function yumResponse(ctx: RequestContext, repo: KitchenRepository, postId: string, status: number): Promise<Response> {
  const state = await ctx.timings.measure("db", () => repo.yumState(postId, ctx.actor.subjectId));
  if (!state.ok) return unavailable(ctx.requestId);
  return successResponse<YumResponse>({ yums: state.value }, ctx.requestId, status);
}

export async function handleYum(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const name = await myName(ctx, repo);
    if (name instanceof Response) return name;
    const post = await visiblePost(ctx, repo, params[0]);
    if (post instanceof Response) return post;
    const now = ctx.now();
    const me = ctx.actor.subjectId;
    const yummed = await ctx.timings.measure("db", () =>
      repo.yum({
        postId: post.id,
        userId: me,
        now,
        pushCutoff: new Date(now.getTime() - YUM_PUSH_EVERY_MS),
        activity: { id: crypto.randomUUID(), userId: post.authorId, kind: "yum", actorId: me, now },
      }),
    );
    if (!yummed.ok) return unavailable(ctx.requestId);
    if (yummed.value.push) {
      const pst = toPublicId("pst", post.id);
      await deferSocialPush(ctx, {
        kind: KITCHEN_EMAILS.YUM,
        to: post.authorId,
        data: { actorName: name, postTitle: post.title },
        path: `/p/${pst}`,
        // One per post per claimed slot: the slot's time names it.
        keyParts: [pst, String(now.getTime())],
      });
    }
    return yumResponse(ctx, repo, post.id, yummed.value.created ? 201 : 200);
  });
}

export async function handleUnyum(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const post = await visiblePost(ctx, repo, params[0]);
    if (post instanceof Response) return post;
    const removed = await ctx.timings.measure("db", () => repo.unyum(post.id, ctx.actor.subjectId));
    if (!removed.ok) return unavailable(ctx.requestId);
    return yumResponse(ctx, repo, post.id, 200);
  });
}

export async function handleComments(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const cursor = decodeCursor(new URL(request.url), isPostKey);
  if (cursor === null) return validationError(ctx.requestId, { cursor: ["Must be a nextCursor this route returned"] });
  return withKitchenRepo(ctx, async (repo) => {
    const post = await visiblePost(ctx, repo, params[0]);
    if (post instanceof Response) return post;
    const me = ctx.actor.subjectId;
    const page = await ctx.timings.measure("db", () =>
      repo.listComments(post.id, me, cursor ? { at: cursor.at, id: cursor.key } : null, COMMENTS_PAGE_SIZE),
    );
    if (!page.ok) return unavailable(ctx.requestId);
    const nextCursor = page.value.nextCursor ? encodeCursor({ at: page.value.nextCursor.at, key: page.value.nextCursor.id }) : null;
    return successResponse<CommentsResponse>(
      { comments: page.value.comments.map((c) => toPostComment(c, me, post.authorId)), count: post.commentCount, nextCursor },
      ctx.requestId,
      200,
      nextCursor,
    );
  });
}

export async function handleAddComment(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const said = text(fields, "body", body.body, COMMENT_BODY_MAX);
  if (!fields.ok || said === undefined) return validationError(ctx.requestId, fields.errors);
  return withKitchenRepo(ctx, async (repo) => {
    const mine = await ctx.timings.measure("db", () => repo.getProfile(ctx.actor.subjectId));
    if (!mine.ok) return unavailable(ctx.requestId);
    if (!mine.value) return forbidden(ctx.requestId, "Choose a handle and a name first", KITCHEN_COMMUNITY_ERROR_REASONS.NO_PROFILE);
    const post = await visiblePost(ctx, repo, params[0]);
    if (post instanceof Response) return post;
    const now = ctx.now();
    const me = ctx.actor.subjectId;
    const id = crypto.randomUUID();
    const added = await ctx.timings.measure("db", () =>
      repo.addComment({
        id,
        postId: post.id,
        authorId: me,
        body: said,
        now,
        maxPerHour: COMMENTS_PER_HOUR,
        since: new Date(now.getTime() - HOUR_MS),
        activity: { id: crypto.randomUUID(), userId: post.authorId, kind: "comment", actorId: me, now },
      }),
    );
    if (!added.ok) return unavailable(ctx.requestId);
    if (added.value.kind === "limited") {
      const response = errorResponse("rate_limited", `You can comment ${COMMENTS_PER_HOUR} times an hour`, 429, ctx.requestId, {
        reason: R.COMMENT_LIMIT,
        max: COMMENTS_PER_HOUR,
        retryAfterSeconds: 3600,
      });
      response.headers.set("retry-after", "3600");
      return response;
    }
    if (added.value.activity) {
      const pst = toPublicId("pst", post.id);
      const cmt = toPublicId("cmt", id);
      await deferSocialPush(ctx, {
        kind: KITCHEN_EMAILS.COMMENTED,
        to: post.authorId,
        data: { actorName: mine.value.name, excerpt: said, postTitle: post.title },
        path: `/p/${pst}`,
        keyParts: [cmt],
      });
    }
    const comment = { ...added.value.comment, author: mine.value };
    return successResponse<CommentResponse>({ comment: toPostComment(comment, me, post.authorId) }, ctx.requestId, 201);
  });
}

export async function handleDeleteComment(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  const commentId = commentParam(params[0]);
  if (!commentId) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const removed = await ctx.timings.measure("db", () => repo.removeComment(commentId, ctx.actor.subjectId, ctx.now()));
    if (!removed.ok) return unavailable(ctx.requestId);
    // Neither its author nor its post's: the opaque 404, as for one that isn't there.
    if (!removed.value) return notFound(ctx.requestId);
    return successResponse<DeleteCommentResponse>({ removed: true }, ctx.requestId);
  });
}

// ── Reports ────────────────────────────────────────────────

function toReport(r: KitchenReportRecord) {
  const targetId = r.targetKind === "post" ? toPublicId("pst", r.targetId) : r.targetKind === "comment" ? toPublicId("cmt", r.targetId) : r.targetId;
  return { id: toPublicId("rpt", r.id), targetKind: r.targetKind, targetId, reason: r.reason, createdAt: r.createdAt.toISOString() };
}

/** The stored id of a target the caller can see — or the 404 / 422 / 503. */
async function reportTarget(ctx: RequestContext, repo: KitchenRepository, kind: (typeof REPORT_TARGET_KINDS)[number], raw: string): Promise<string | Response> {
  const me = ctx.actor.subjectId;
  if (kind === "profile") {
    const userId = subjectParam(raw);
    if (!userId) return notFound(ctx.requestId);
    if (userId === me) return unprocessable(ctx.requestId, "You can't report yourself", KITCHEN_COMMUNITY_ERROR_REASONS.SELF);
    const [profile, blocked] = await ctx.timings.measure("db", () => Promise.all([repo.getProfile(userId), repo.isBlockedEither(me, userId)]));
    if (!profile.ok || !blocked.ok) return unavailable(ctx.requestId);
    return profile.value && !blocked.value ? userId : notFound(ctx.requestId);
  }
  if (kind === "post") {
    const post = await visiblePost(ctx, repo, raw);
    return post instanceof Response ? post : post.id;
  }
  const commentId = commentParam(raw);
  if (!commentId) return notFound(ctx.requestId);
  const comment = await ctx.timings.measure("db", () => repo.getComment(commentId));
  if (!comment.ok) return unavailable(ctx.requestId);
  if (!comment.value) return notFound(ctx.requestId);
  const c = comment.value;
  const [post, blocked] = await ctx.timings.measure("db", () => Promise.all([repo.getPost(c.postId, me), repo.isBlockedEither(me, c.authorId)]));
  if (!post.ok || !blocked.ok) return unavailable(ctx.requestId);
  return post.value && !blocked.value ? c.id : notFound(ctx.requestId);
}

export async function handleReport(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const fields = new Fields();
  const targetKind = oneOf(fields, "targetKind", body.targetKind, REPORT_TARGET_KINDS);
  const reason = oneOf(fields, "reason", body.reason, REPORT_REASONS);
  const targetRaw = typeof body.targetId === "string" && body.targetId.length > 0 ? body.targetId : fields.add("targetId", "Required: a pst_, cmt_ or usr_ id");
  const note = body.note === undefined || body.note === null || (typeof body.note === "string" && body.note.trim() === "")
    ? null
    : text(fields, "note", body.note, REPORT_NOTE_MAX);
  if (!fields.ok || !targetKind || !reason || targetRaw === undefined || note === undefined) return validationError(ctx.requestId, fields.errors);

  return withKitchenRepo(ctx, async (repo) => {
    const me = ctx.actor.subjectId;
    const targetId = await reportTarget(ctx, repo, targetKind, targetRaw);
    if (targetId instanceof Response) return targetId;
    const existing = await ctx.timings.measure("db", () => repo.getReport(me, targetKind, targetId));
    if (!existing.ok) return unavailable(ctx.requestId);
    if (existing.value) return successResponse<ReportResponse>({ report: toReport(existing.value) }, ctx.requestId, 200);

    const id = crypto.randomUUID();
    const rpt = toPublicId("rpt", id);
    const now = ctx.now();
    const publicTarget = targetKind === "post" ? toPublicId("pst", targetId) : targetKind === "comment" ? toPublicId("cmt", targetId) : targetId;
    // Reports belong to no group: audited under the system organization, as the digest's emails are sent.
    const audit: AppendEventWithAuditInput = {
      event: {
        id: crypto.randomUUID().replace(/-/g, ""),
        type: KITCHEN_REPORT_EVENT,
        version: 1,
        source: "kitchen-worker",
        occurredAt: now,
        actorType: ctx.actor.subjectType,
        actorId: me,
        orgId: SYSTEM_ORG_ID,
        subjectKind: "kitchen_report",
        subjectId: rpt,
        requestId: ctx.requestId,
        payload: { reportId: rpt, targetKind, targetId: publicTarget, reason },
      },
      audit: { id: crypto.randomUUID().replace(/-/g, ""), category: "kitchen", description: `Reported a ${targetKind} (${reason})` },
    };
    const made = await ctx.timings.measure("db", () =>
      repo.createReport({ id, reporterId: me, targetKind, targetId, reason, note, now, audit }),
    );
    if (!made.ok) return unavailable(ctx.requestId);
    return successResponse<ReportResponse>({ report: toReport(made.value.report) }, ctx.requestId, made.value.kind === "created" ? 201 : 200);
  });
}
