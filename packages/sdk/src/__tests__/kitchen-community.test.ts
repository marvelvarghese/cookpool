// The SDK's profiles and following (Cookpool CM-2): every route's path and
// method, the bodies as given, cursors and q passed as queries, odd ids and
// handles encoded, `listed` on the recipe edit and `source: "public"` on
// Explore, the refusals decoded with their reasons, and the re-exports.

import { describe, expect, it, vi } from "vitest";

import { Cookpool, FOLLOWS_PER_DAY, KITCHEN_COMMUNITY_ERROR_REASONS, handleProblem, normalizeHandle } from "../index.js";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from "../errors.js";

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

describe("KitchenClient — profiles and following (Cookpool CM-2)", () => {
  it("reads and saves your profile, and checks a handle", async () => {
    const f = capture(ok({ profile: null }));
    const k = client(f.fetch);
    await k.myProfile();
    await k.saveMyProfile({ handle: "meeracooks", name: "Meera K", privacy: "private" });
    await k.handleAvailable("Meera Cooks");
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([
      ["GET", `${BASE}/me/profile`],
      ["PUT", `${BASE}/me/profile`],
      ["GET", `${BASE}/handles/Meera%20Cooks`],
    ]);
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ handle: "meeracooks", name: "Meera K", privacy: "private" });
  });

  it("reads a profile and its lists, with cursors", async () => {
    const f = capture(ok({ people: [], nextCursor: null }));
    const k = client(f.fetch);
    await k.profile("meeracooks");
    await k.profileRecipes("meeracooks", { cursor: "abc" });
    await k.followers("meeracooks");
    await k.following("meeracooks", { cursor: "def" });
    await k.followRequests({ cursor: "ghi" });
    expect(f.calls.map((c) => c.url)).toEqual([
      `${BASE}/profiles/meeracooks`,
      `${BASE}/profiles/meeracooks/recipes?cursor=abc`,
      `${BASE}/profiles/meeracooks/followers`,
      `${BASE}/profiles/meeracooks/following?cursor=def`,
      `${BASE}/me/follow-requests?cursor=ghi`,
    ]);
  });

  it("follows, answers requests, removes followers, blocks and mutes at the design's paths", async () => {
    const f = capture(ok({ state: "accepted" }));
    const k = client(f.fetch);
    await k.follow("meeracooks", { idempotencyKey: "ikey_follow" });
    await k.unfollow("meeracooks");
    await k.acceptFollow("usr_kabir");
    await k.declineFollow("usr_kabir");
    await k.removeFollower("usr_kabir");
    await k.block("usr_a/b");
    await k.unblock("usr_kabir");
    await k.blocks();
    await k.mute("usr_kabir");
    await k.unmute("usr_kabir");
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", `${BASE}/me/follows/meeracooks`],
      ["DELETE", `${BASE}/me/follows/meeracooks`],
      ["POST", `${BASE}/me/follow-requests/usr_kabir/accept`],
      ["POST", `${BASE}/me/follow-requests/usr_kabir/decline`],
      ["DELETE", `${BASE}/me/followers/usr_kabir`],
      ["POST", `${BASE}/me/blocks/usr_a%2Fb`],
      ["DELETE", `${BASE}/me/blocks/usr_kabir`],
      ["GET", `${BASE}/me/blocks`],
      ["POST", `${BASE}/me/mutes/usr_kabir`],
      ["DELETE", `${BASE}/me/mutes/usr_kabir`],
    ]);
    expect(new Headers(f.calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ikey_follow");
  });

  it("searches people and reads suggestions", async () => {
    const f = capture(ok({ people: [] }));
    const k = client(f.fetch);
    await k.searchPeople("@meera cooks");
    await k.peopleSuggestions();
    expect(f.calls.map((c) => c.url)).toEqual([`${BASE}/people/search?q=%40meera+cooks`, `${BASE}/me/people/suggestions`]);
  });

  it("lists a recipe and reads Explore's Public", async () => {
    const f = capture(ok({ recipes: [] }));
    const k = client(f.fetch);
    await k.updateRecipe("rcp_1", { listed: true });
    await k.exploreRecipes({ source: "public" });
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ listed: true });
    expect(f.calls[1]!.url).toBe(`${BASE}/recipes?source=public`);
  });

  it("decodes the refusals with their reasons", async () => {
    const cases: Array<[Response, unknown, string]> = [
      [failed("validation_failed", 422, { reason: "handle_reserved" }), ValidationError, "handle_reserved"],
      [failed("conflict", 409, { reason: "handle_too_soon", nextChangeAt: "2026-12-08T08:00:00.000Z" }), ConflictError, "handle_too_soon"],
      [failed("forbidden", 403, { reason: "no_profile" }), ForbiddenError, "no_profile"],
      [failed("rate_limited", 429, { reason: "follow_limit", max: FOLLOWS_PER_DAY }), RateLimitError, "follow_limit"],
      [failed("not_found", 404), NotFoundError, ""],
    ];
    for (const [response, type, reason] of cases) {
      const err = await client(capture(response).fetch).follow("meeracooks").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(type as new () => Error);
      if (reason) expect((err as { details: Record<string, unknown> }).details.reason).toBe(reason);
    }
  });

  it("re-exports the handle rules and the reasons", () => {
    expect(normalizeHandle("@Meera")).toBe("meera");
    expect(handleProblem("cookpool_x")).toBe("handle_reserved");
    expect(KITCHEN_COMMUNITY_ERROR_REASONS.NO_PROFILE).toBe("no_profile");
  });
});
