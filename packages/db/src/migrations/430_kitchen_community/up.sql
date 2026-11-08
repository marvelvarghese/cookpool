-- 430_kitchen_community: public profiles with handles and privacy, follows
-- with requests, blocks, mutes, and listed (public) recipes.
--
-- Context: kitchen
-- Epic: cookpool-community (CM-2, design §1) — a person chooses a handle and
--       a name to have a public face outside their groups. They can follow
--       anyone with a profile (a private profile approves each follower),
--       block and mute, and list a link recipe on their profile and in
--       Explore's Public.
--
-- Design rules:
--   * Additive and idempotent: four new tables, CREATE … IF NOT EXISTS, and
--     one column on kitchen_recipes (SQLite has no ADD COLUMN IF NOT EXISTS,
--     so the runner's applied ledger keeps it from running twice).
--   * A profile is keyed by the person (user_id, usr_…), one each. Its handle
--     is stored lowercase and unique, so uniqueness is case-insensitive: 3–20
--     of a–z, 0–9, _ and ., no leading or trailing dot and no two dots in a
--     row. The CHECK holds the shape; the reserved words (cookpool…, admin,
--     support, …) are kitchen-worker's, so the list can grow without a table
--     rebuild. handle_changed_at is when the handle last CHANGED: NULL on a
--     new profile, so the first change (a typo fixed after HandleSetup) is
--     free; once it is set, the next change waits 30 days after it.
--   * Names outside a person's groups come from kitchen_profiles.name alone,
--     never the identity display name or the email.
--   * A follow is one row per (follower, followee): requested until a
--     private profile accepts it, accepted at once for a public one;
--     accepted_at is set exactly when it is accepted. Unfollowing, declining
--     and removing a follower delete the row. Nobody follows themselves.
--   * A block is one row per (blocker, blocked) and hides the two from each
--     other everywhere; blocking deletes the follows both ways in the same
--     batch (kitchen-worker). A mute is one row per (muter, muted) and only
--     takes the muted person's posts out of the muter's Following feed.
--   * kitchen_recipes.listed is 0 or 1, 0 for every recipe there is. A public
--     recipe is visibility = 'link' AND listed = 1: the CHECK lets listed be 1
--     only on a link recipe, so turning the link off has to unlist it too.
--   * Indexes: follows by followee and state (followers, follow requests,
--     counts) and by state and acceptance time (popular: new followers in 14
--     days); blocks by the blocked person (a block either way); listed
--     recipes by time (Explore's Public).
--   * Every time is an ISO 8601 UTC instant as toISOString() writes it, so
--     text order is time order. Subject ids are public ids (usr_…) with no
--     cross-context FK.

CREATE TABLE IF NOT EXISTS kitchen_profiles (
  user_id            TEXT PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 128),
  handle             TEXT NOT NULL UNIQUE CHECK (
                       length(handle) BETWEEN 3 AND 20
                       AND handle NOT GLOB '*[^a-z0-9_.]*'
                       AND substr(handle, 1, 1) <> '.'
                       AND substr(handle, -1, 1) <> '.'
                       AND instr(handle, '..') = 0
                     ),
  name               TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  about              TEXT CHECK (about IS NULL OR length(about) BETWEEN 1 AND 160),
  privacy            TEXT NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'private')),
  handle_changed_at  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kitchen_follows (
  follower_id  TEXT NOT NULL CHECK (length(follower_id) BETWEEN 1 AND 128),
  followee_id  TEXT NOT NULL CHECK (length(followee_id) BETWEEN 1 AND 128),
  state        TEXT NOT NULL CHECK (state IN ('accepted', 'requested')),
  created_at   TEXT NOT NULL,
  accepted_at  TEXT,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id),
  -- Accepted is exactly the state with an acceptance time.
  CHECK ((state = 'accepted') = (accepted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS kitchen_follows_followee_idx
  ON kitchen_follows (followee_id, state, accepted_at);

CREATE INDEX IF NOT EXISTS kitchen_follows_state_idx
  ON kitchen_follows (state, accepted_at);

CREATE TABLE IF NOT EXISTS kitchen_blocks (
  blocker_id  TEXT NOT NULL CHECK (length(blocker_id) BETWEEN 1 AND 128),
  blocked_id  TEXT NOT NULL CHECK (length(blocked_id) BETWEEN 1 AND 128),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS kitchen_blocks_blocked_idx
  ON kitchen_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS kitchen_mutes (
  muter_id    TEXT NOT NULL CHECK (length(muter_id) BETWEEN 1 AND 128),
  muted_id    TEXT NOT NULL CHECK (length(muted_id) BETWEEN 1 AND 128),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (muter_id, muted_id),
  CHECK (muter_id <> muted_id)
);

ALTER TABLE kitchen_recipes ADD COLUMN listed INTEGER NOT NULL DEFAULT 0
  CHECK (listed IN (0, 1) AND (listed = 0 OR visibility = 'link'));

CREATE INDEX IF NOT EXISTS kitchen_recipes_listed_idx
  ON kitchen_recipes (created_at) WHERE listed = 1 AND deleted_at IS NULL;

-- table kitchen_profiles: A person's public face (Cookpool CM-2): a handle, a chosen name, a line about them and their privacy; only people with one appear outside their groups, and its name is the only name shown there.
-- column kitchen_profiles.user_id: The person (usr_…), one profile each.
-- column kitchen_profiles.handle: Their @handle, lowercase and unique: 3–20 of a–z, 0–9, _ and ., no leading, trailing or doubled dot; the reserved words are kitchen-worker's.
-- column kitchen_profiles.name: The name they chose to show outside their groups, 1–40 characters.
-- column kitchen_profiles.about: A line about them, up to 160 characters; NULL for none.
-- column kitchen_profiles.privacy: public (anyone may follow at once) or private (each follower is approved, and only followers see their recipes and lists).
-- column kitchen_profiles.handle_changed_at: When the handle last changed; NULL until the first change, which is free. Once set, the next change waits 30 days after it.
-- column kitchen_profiles.created_at: When the profile was made.
-- column kitchen_profiles.updated_at: When it last changed.
-- table kitchen_follows: Who follows whom (Cookpool CM-2): accepted at once for a public profile, requested for a private one until it is accepted; unfollowing, declining and removing delete the row.
-- column kitchen_follows.follower_id: Who follows (usr_…).
-- column kitchen_follows.followee_id: Whom they follow (usr_…), never themselves.
-- column kitchen_follows.state: accepted or requested.
-- column kitchen_follows.created_at: When they followed or asked to.
-- column kitchen_follows.accepted_at: When it was accepted; NULL exactly while requested.
-- table kitchen_blocks: Blocks (Cookpool CM-2): the two people are hidden from each other everywhere, and blocking deleted the follows between them; the blocked person is not told.
-- column kitchen_blocks.blocker_id: Who blocked (usr_…).
-- column kitchen_blocks.blocked_id: Whom they blocked (usr_…).
-- column kitchen_blocks.created_at: When.
-- table kitchen_mutes: Mutes (Cookpool CM-2): the muted person's posts leave the muter's Following feed, nothing else.
-- column kitchen_mutes.muter_id: Who muted (usr_…).
-- column kitchen_mutes.muted_id: Whom they muted (usr_…).
-- column kitchen_mutes.created_at: When.
-- column kitchen_recipes.listed: 1 when its owner lists it (Cookpool CM-2): a link recipe that is also listed is public — on their profile and in Explore's Public; only a link recipe can be listed, and turning the link off unlists it.
