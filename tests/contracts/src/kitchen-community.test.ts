// Profiles and following in the contract (Cookpool CM-2, cookpool-community
// design §1): the handle rules the server and the console share, the
// reserved words, the limits, the refusals' reasons (on the pinned error
// codes), Explore's Public, `listed` on a recipe, and the shapes of the
// routes — none of which has room for an email.

import { ERROR_CODES } from "@saas/contracts/errors";
import {
  BLOCKS_PER_DAY,
  COMMUNITY_PAGE_SIZE,
  EXPLORE_SOURCES,
  FOLLOWED_BY_MAX,
  FOLLOWS_PER_DAY,
  FOLLOW_STATES,
  HANDLE_CHANGE_DAYS,
  HANDLE_CHANGE_MS,
  HANDLE_RE,
  KITCHEN_COMMUNITY_ERROR_REASONS,
  KITCHEN_ERROR_REASONS,
  PEOPLE_SEARCH_MAX,
  POPULAR_DAYS,
  PROFILE_ABOUT_MAX,
  PROFILE_NAME_MAX,
  PROFILE_PRIVACIES,
  RESERVED_HANDLES,
  SEARCHES_PER_MINUTE,
  SUGGESTIONS_MAX,
  handleProblem,
  normalizeHandle,
  type CommunityPerson,
  type PersonProfileResponse,
  type UpdateRecipeRequest,
} from "@saas/contracts/kitchen";

describe("handles", () => {
  it("normalize as typed: trimmed, without a leading @, lowercase", () => {
    expect(normalizeHandle("  @MeeraCooks ")).toBe("meeracooks");
    expect(normalizeHandle("@@x")).toBe("@x");
  });

  it.each(["abc", "meera_cooks", "m.e.e.r.a", "a".repeat(20), "007"])("take %j", (handle) => {
    expect(HANDLE_RE.test(handle)).toBe(true);
    expect(handleProblem(handle)).toBeNull();
  });

  it.each(["ab", "a".repeat(21), "Meera", "meera-cooks", "meera cooks", ".meera", "meera.", "mee..ra", "mééra", ""])("refuse %j as handle_shape", (handle) => {
    expect(handleProblem(handle)).toBe("handle_shape");
  });

  it("reserve the design's words and anything starting cookpool", () => {
    expect([...RESERVED_HANDLES]).toEqual(["cookpool", "admin", "support", "help", "about", "settings", "me", "you", "explore", "search", "api", "www"]);
    for (const handle of [...RESERVED_HANDLES, "cookpool_team", "cookpool.in", "cookpoolhq"]) expect(handleProblem(handle)).toBe("handle_reserved");
    expect(handleProblem("mycookpool")).toBeNull();
  });

  it("change once in 30 days", () => {
    expect(HANDLE_CHANGE_DAYS).toBe(30);
    expect(HANDLE_CHANGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("the community's limits and sizes", () => {
  it("are the design's", () => {
    expect({ FOLLOWS_PER_DAY, BLOCKS_PER_DAY, SEARCHES_PER_MINUTE, PEOPLE_SEARCH_MAX, SUGGESTIONS_MAX, POPULAR_DAYS, FOLLOWED_BY_MAX }).toEqual({
      FOLLOWS_PER_DAY: 200,
      BLOCKS_PER_DAY: 50,
      SEARCHES_PER_MINUTE: 100,
      PEOPLE_SEARCH_MAX: 20,
      SUGGESTIONS_MAX: 10,
      POPULAR_DAYS: 14,
      FOLLOWED_BY_MAX: 3,
    });
    expect({ PROFILE_NAME_MAX, PROFILE_ABOUT_MAX, COMMUNITY_PAGE_SIZE }).toEqual({ PROFILE_NAME_MAX: 40, PROFILE_ABOUT_MAX: 160, COMMUNITY_PAGE_SIZE: 30 });
    expect([...PROFILE_PRIVACIES]).toEqual(["public", "private"]);
    expect([...FOLLOW_STATES]).toEqual(["none", "requested", "accepted"]);
  });
});

describe("refusals", () => {
  it("pin their reasons, none of them a new error code or an existing kitchen reason", () => {
    expect(KITCHEN_COMMUNITY_ERROR_REASONS).toEqual({
      HANDLE_SHAPE: "handle_shape",
      HANDLE_RESERVED: "handle_reserved",
      HANDLE_TAKEN: "handle_taken",
      HANDLE_TOO_SOON: "handle_too_soon",
      NO_PROFILE: "no_profile",
      PRIVATE: "private",
      SELF: "self",
      FOLLOW_LIMIT: "follow_limit",
      BLOCK_LIMIT: "block_limit",
    });
    const codes = new Set<string>(Object.values(ERROR_CODES));
    const kitchen = new Set<string>(Object.values(KITCHEN_ERROR_REASONS));
    for (const reason of Object.values(KITCHEN_COMMUNITY_ERROR_REASONS)) {
      expect(codes.has(reason)).toBe(false);
      expect(kitchen.has(reason)).toBe(false);
    }
  });
});

describe("recipes and Explore", () => {
  it("gain Public as a source and `listed` on the edit", () => {
    expect([...EXPLORE_SOURCES]).toEqual(["cookpool", "groups", "public"]);
    const edit: UpdateRecipeRequest = { listed: true };
    expect(edit.listed).toBe(true);
  });
});

describe("the shapes", () => {
  it("carry a profile's name and handle, never an email", () => {
    const person: CommunityPerson = { userId: "usr_meera", handle: "meeracooks", name: "Meera K", about: null, privacy: "public", following: "none" };
    const read: PersonProfileResponse = {
      profile: { userId: "usr_meera", handle: "meeracooks", name: "Meera K", about: null, privacy: "public" },
      counts: { posts: 0, recipes: 0, followers: 0, following: 0 },
      relationship: { following: "none", followsYou: false, blocked: false, muted: false, isYou: false },
      followedBy: [],
      canSee: true,
    };
    for (const shape of [person, read.profile]) expect(Object.keys(shape).some((k) => /email|display/i.test(k))).toBe(false);
  });
});
