// Posts, the feed, Yum, comments, reports and Activity (Cookpool CM-3,
// cookpool-community design §2): the audiences, the four stats a post can
// show, the limits, Discover's window and boost, the report and Activity
// kinds, and the refusals' reasons — all through `@saas/contracts/kitchen`.

import {
  ACTIVITY_ACTORS_MAX,
  ACTIVITY_KINDS,
  COMMENTS_PER_HOUR,
  COMMENT_BODY_MAX,
  DEFAULT_POST_AUDIENCE,
  DISCOVER_BOOST_MAX_HOURS,
  DISCOVER_DAYS,
  FEED_PAGE_SIZE,
  FEED_TABS,
  KITCHEN_POSTS_ERROR_REASONS,
  KITCHEN_REPORT_EVENT,
  POST_AUDIENCES,
  POST_CAPTION_MAX,
  POST_SHOW_KEYS,
  POST_TITLE_MAX,
  POST_UNDO_MS,
  REPORTS_TO_HIDE,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  REPORT_TARGET_KINDS,
  YUM_NAMES_MAX,
  YUM_PUSH_EVERY_MS,
  discoverBoostMs,
  type PostStats,
} from "@saas/contracts/kitchen";

const HOUR = 60 * 60 * 1000;

describe("posts (CM-3)", () => {
  it("are Just me, followers or public, followers by default, and show only size, time, ate and steps", () => {
    expect(POST_AUDIENCES).toEqual(["followers", "public", "me"]);
    expect(DEFAULT_POST_AUDIENCE).toBe("followers");
    expect(POST_SHOW_KEYS).toEqual(["size", "time", "ate", "steps"]);
    // The stats type has the four keys and nothing else: no price, no group, no people.
    const stats: Required<PostStats> = { size: { factorMilli: 1000, main: null, portionsHalf: 4 }, minutes: 30, ate: 2, steps: { done: 2, total: 3 } };
    expect(Object.keys(stats)).toEqual(["size", "minutes", "ate", "steps"]);
    expect([POST_TITLE_MAX, POST_CAPTION_MAX, POST_UNDO_MS]).toEqual([60, 500, 10 * 60 * 1000]);
  });

  it("feed 20 a page; Discover reads 14 days with 2 h per log2(yums + 1), at most 24 h", () => {
    expect(FEED_TABS).toEqual(["following", "discover"]);
    expect(FEED_PAGE_SIZE).toBe(20);
    expect(DISCOVER_DAYS).toBe(14);
    expect(DISCOVER_BOOST_MAX_HOURS).toBe(24);
    expect([0, 1, 3, 7, 4095, 1e9].map(discoverBoostMs)).toEqual([0, 2, 4, 6, 24, 24].map((h) => h * HOUR));
    expect(discoverBoostMs(-1)).toBe(0);
    expect(discoverBoostMs(Number.NaN)).toBe(0);
    expect(REPORTS_TO_HIDE).toBe(3);
  });

  it("limit comments, Yum names and pushes, and name the report and Activity kinds", () => {
    expect([COMMENT_BODY_MAX, COMMENTS_PER_HOUR, YUM_NAMES_MAX, ACTIVITY_ACTORS_MAX, REPORT_NOTE_MAX]).toEqual([500, 30, 3, 3, 300]);
    expect(YUM_PUSH_EVERY_MS).toBe(HOUR);
    expect(REPORT_TARGET_KINDS).toEqual(["post", "comment", "profile"]);
    expect(REPORT_REASONS).toEqual(["spam", "abuse", "unsafe", "other"]);
    expect(KITCHEN_REPORT_EVENT).toBe("kitchen.report.created");
    expect(ACTIVITY_KINDS).toEqual(["followed", "follow_request", "follow_accepted", "yum", "comment", "cooked_yours", "saved_yours"]);
    expect(KITCHEN_POSTS_ERROR_REASONS).toEqual({
      NOT_POSTABLE: "not_postable",
      ALREADY_POSTED: "already_posted",
      NOT_RESTORABLE: "not_restorable",
      COMMENT_LIMIT: "comment_limit",
    });
  });
});
