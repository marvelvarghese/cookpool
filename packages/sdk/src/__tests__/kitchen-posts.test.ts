// The SDK's posts, feed, Yum, comments, reports and Activity (Cookpool
// CM-3): every route's path and method, the bodies as given, tab and cursor
// passed as queries, odd ids encoded, the refusals decoded with their
// reasons, and the re-exports.

import { describe, expect, it, vi } from "vitest";

import { Cookpool, COMMENTS_PER_HOUR, KITCHEN_POSTS_ERROR_REASONS, PUSH_ONLY_KINDS, discoverBoostMs } from "../index.js";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError } from "../errors.js";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function capture(response: Response): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fn: typeof fetch = vi.fn(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response.clone();
  });
  return { fetch: fn, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ok = <T>(data: T, status = 200) => json({ data, meta: { requestId: "req_test", cursor: null } }, status);
const failed = (code: string, status: number, details: Record<string, unknown> = {}) =>
  json({ error: { code, message: `synthetic ${code}`, details, requestId: "req_err" } }, status);

const client = (f: typeof fetch) => new Cookpool({ baseUrl: "https://api.test", fetch: f }).kitchen;
const BASE = "https://api.test/v1/kitchen";

describe("KitchenClient — posts, the feed, reactions and Activity (Cookpool CM-3)", () => {
  it("creates, edits, deletes, restores and reads a post", async () => {
    const f = capture(ok({ post: {} }));
    const k = client(f.fetch);
    await k.createPost({ dishId: "dsh_1", audience: "followers", caption: "Sunday", show: { size: true, time: true } });
    await k.updatePost("pst_1", { audience: "public" });
    await k.deletePost("pst_1");
    await k.restorePost("pst_1");
    await k.post("pst 1");
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", `${BASE}/me/posts`],
      ["PATCH", `${BASE}/me/posts/pst_1`],
      ["DELETE", `${BASE}/me/posts/pst_1`],
      ["POST", `${BASE}/me/posts/pst_1/restore`],
      ["GET", `${BASE}/posts/pst%201`],
    ]);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ dishId: "dsh_1", audience: "followers", caption: "Sunday", show: { size: true, time: true } });
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ audience: "public" });
  });

  it("reads the feeds and a profile's posts, with tab and cursor", async () => {
    const f = capture(ok({ tab: "following", posts: [], nextCursor: null }));
    const k = client(f.fetch);
    await k.feed();
    await k.feed({ tab: "discover", cursor: "abc" });
    await k.profilePosts("meeracooks", { cursor: "def" });
    expect(f.calls.map((c) => c.url)).toEqual([
      `${BASE}/me/feed`,
      `${BASE}/me/feed?tab=discover&cursor=abc`,
      `${BASE}/profiles/meeracooks/posts?cursor=def`,
    ]);
  });

  it("says Yum, comments, removes a comment and reports", async () => {
    const f = capture(ok({ yums: { count: 1, mine: true } }));
    const k = client(f.fetch);
    await k.yum("pst_1");
    await k.unyum("pst_1");
    await k.comments("pst_1", { cursor: "c" });
    await k.addComment("pst_1", { body: "Roast the spices first" });
    await k.deleteComment("cmt_1");
    await k.report({ targetKind: "comment", targetId: "cmt_1", reason: "abuse", note: "rude" });
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", `${BASE}/posts/pst_1/yum`],
      ["DELETE", `${BASE}/posts/pst_1/yum`],
      ["GET", `${BASE}/posts/pst_1/comments?cursor=c`],
      ["POST", `${BASE}/posts/pst_1/comments`],
      ["DELETE", `${BASE}/comments/cmt_1`],
      ["POST", `${BASE}/reports`],
    ]);
    expect(JSON.parse(String(f.calls[3]!.init.body))).toEqual({ body: "Roast the spices first" });
    expect(JSON.parse(String(f.calls[5]!.init.body))).toEqual({ targetKind: "comment", targetId: "cmt_1", reason: "abuse", note: "rude" });
  });

  it("reads Activity, marks it read and counts what is unread", async () => {
    const f = capture(ok({ count: 2 }));
    const k = client(f.fetch);
    await k.communityActivity({ cursor: "x" });
    await k.markActivityRead("2026-11-08T08:00:00.000Z");
    expect((await k.unreadActivity()).count).toBe(2);
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([
      ["GET", `${BASE}/me/activity?cursor=x`],
      ["POST", `${BASE}/me/activity/read`],
      ["GET", `${BASE}/me/activity/unread`],
    ]);
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ before: "2026-11-08T08:00:00.000Z" });
  });

  it("decodes the refusals with their reasons", async () => {
    const cases: Array<[Response, unknown, string]> = [
      [failed("conflict", 409, { reason: "already_posted", postId: "pst_1" }), ConflictError, "already_posted"],
      [failed("conflict", 409, { reason: "not_postable" }), ConflictError, "not_postable"],
      [failed("forbidden", 403, { reason: "no_profile" }), ForbiddenError, "no_profile"],
      [failed("rate_limited", 429, { reason: "comment_limit", max: COMMENTS_PER_HOUR }), RateLimitError, "comment_limit"],
      [failed("not_found", 404), NotFoundError, ""],
    ];
    for (const [response, type, reason] of cases) {
      const err = await client(capture(response).fetch).createPost({ dishId: "dsh_1", audience: "me" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(type as new () => Error);
      if (reason) expect((err as { details: Record<string, unknown> }).details.reason).toBe(reason);
    }
  });

  it("re-exports the limits, the boost and the push-only kinds", () => {
    expect(KITCHEN_POSTS_ERROR_REASONS.ALREADY_POSTED).toBe("already_posted");
    expect(discoverBoostMs(1)).toBe(2 * 60 * 60 * 1000);
    expect(PUSH_ONLY_KINDS).toContain("kitchen.yum");
  });
});
