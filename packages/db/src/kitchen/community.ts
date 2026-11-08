// Profiles, follows, blocks and mutes (Cookpool CM-2, migration 430_kitchen_community).
//
// A person's public face — a handle, a name, a line about them, public or
// private — and the edges between people: follows (requested until a private
// profile accepts), blocks and mutes. Who may see what is kitchen-worker's
// business; the reads here take the viewer and leave out, IN SQL, everyone
// with a block between them and the viewer (`notBlockedSql`), so no list,
// search or suggestion ever carries a blocked person.
//
// Every write that a race could double is ONE statement or ONE batch, so it
// holds without a transaction (D1 has none):
//
//   saveProfile   one upsert: a new profile, or an edit whose handle change
//                 is refused in the same statement when the last one was too
//                 recent; a taken handle is the UNIQUE index refusing it. Going
//                 public accepts every waiting request in the same batch.
//   follow        the insert counts the follower's follows of the last day
//                 and checks for a block either way in the same statement
//   block         the insert (counted the same way) and the delete of the
//                 follows both ways are one batch, the delete guarded by the
//                 block row, so a block and its follows' end land together
//
// Kept beside the rest of the kitchen's storage and spread into
// KitchenRepository, as the asks are.

import { executeBatch, type SqlExecutor } from "../d1/executor.js";
import { isUniqueViolation } from "../d1/errors.js";
import { activityStatement } from "./activity-write.js";
import type { KitchenResult } from "./types.js";

export type KitchenProfilePrivacy = "public" | "private";

/** One profile, as stored. */
export interface KitchenProfileRecord {
  /** The person (`usr_…`). */
  userId: string;
  /** Lowercase. */
  handle: string;
  name: string;
  about: string | null;
  privacy: KitchenProfilePrivacy;
  /** When the handle last changed; null until the first change (which is free). */
  handleChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type KitchenFollowState = "accepted" | "requested";

export interface KitchenFollowRecord {
  followerId: string;
  followeeId: string;
  state: KitchenFollowState;
  createdAt: Date;
  acceptedAt: Date | null;
}

export interface SaveProfileInput {
  userId: string;
  /** Lowercase, already checked for shape and reserved words. */
  handle: string;
  name: string;
  about: string | null;
  privacy: KitchenProfilePrivacy;
  now: Date;
  /** A handle change waits this long after the last one. */
  handleCooldownMs: number;
}

export type SaveProfileResult =
  | { kind: "saved"; profile: KitchenProfileRecord; created: boolean }
  | { kind: "handle_taken" }
  | { kind: "handle_too_soon"; nextChangeAt: Date };

export interface FollowInput {
  followerId: string;
  followeeId: string;
  /** accepted for a public profile, requested for a private one. */
  state: KitchenFollowState;
  now: Date;
  /** The most follows one person may make in a day; this one is refused at the limit. */
  maxPerDay: number;
  /** The id of the Activity row (CM-3) a new follow writes for the followee: `followed`, or `follow_request` (a fresh UUID when left out). */
  activityId?: string;
}

export type FollowResult =
  | { kind: "followed" | "existing"; follow: KitchenFollowRecord }
  | { kind: "blocked" }
  | { kind: "limited" };

export interface BlockInput {
  blockerId: string;
  blockedId: string;
  now: Date;
  /** The most blocks one person may make in a day; this one is refused at the limit. */
  maxPerDay: number;
}

export type BlockResult = { kind: "blocked" | "existing" } | { kind: "limited" };

/** Where a page of people ends: the time it is ordered by, then the person. */
export interface KitchenPeopleCursor {
  at: string;
  userId: string;
}

export interface KitchenPeopleQuery {
  /** Whose blocks hide people from the page. */
  viewer: string;
  cursor: KitchenPeopleCursor | null;
  limit: number;
}

export interface KitchenPersonAt {
  profile: KitchenProfileRecord;
  /** When they followed (followers), were followed (following) or asked (requests). */
  at: Date;
}

export interface KitchenPeoplePage {
  people: KitchenPersonAt[];
  nextCursor: KitchenPeopleCursor | null;
}

export interface KitchenProfileCounts {
  /** Listed link recipes, live, not Cookpool's. */
  recipes: number;
  /** Accepted followers. */
  followers: number;
  /** Accepted follows. */
  following: number;
}

export interface SearchProfilesQuery {
  viewer: string;
  /** Lowercase, without a leading @: a public profile's handle starting with it, or any profile's handle equal to it. */
  handle: string;
  /** A public profile's name containing it (case-insensitively for ASCII); null to match handles only. */
  name: string | null;
  limit: number;
}

export interface SuggestQuery {
  viewer: string;
  limit: number;
}

export interface KitchenRecipeOwnerSuggestion {
  profile: KitchenProfileRecord;
  /** The latest of their recipes the viewer saved a copy of. */
  recipeName: string;
}

export interface KitchenPopularProfile {
  profile: KitchenProfileRecord;
  /** Accepted follows since the cut-off. */
  newFollowers: number;
}

export interface KitchenBlockRecord {
  blockedId: string;
  createdAt: Date;
  /** Their profile, when they have one. */
  profile: KitchenProfileRecord | null;
}

export interface CommunityRepository {
  getProfile(userId: string): Promise<KitchenResult<KitchenProfileRecord | null>>;
  getProfileByHandle(handle: string): Promise<KitchenResult<KitchenProfileRecord | null>>;
  /** The profiles of these people that exist, with nobody who has a block with `viewer`; with `unfollowedOnly`, nobody `viewer` follows or asked to. */
  profilesFor(query: { userIds: readonly string[]; viewer: string; unfollowedOnly: boolean; limit: number }): Promise<KitchenResult<KitchenProfileRecord[]>>;
  saveProfile(input: SaveProfileInput): Promise<KitchenResult<SaveProfileResult>>;
  profileCounts(userId: string): Promise<KitchenResult<KitchenProfileCounts>>;
  /** `followerId`'s follows of these people (either state). */
  followsFrom(followerId: string, followeeIds: readonly string[]): Promise<KitchenResult<KitchenFollowRecord[]>>;
  /** The follow from one person to another, when there is one. */
  getFollow(followerId: string, followeeId: string): Promise<KitchenResult<KitchenFollowRecord | null>>;
  /** Up to `limit` people `viewer` follows who follow `target` (both accepted), with profiles, the latest follow first. */
  followedBy(viewer: string, target: string, limit: number): Promise<KitchenResult<KitchenProfileRecord[]>>;
  follow(input: FollowInput): Promise<KitchenResult<FollowResult>>;
  /** True when there was a follow (either state) to delete. */
  unfollow(followerId: string, followeeId: string): Promise<KitchenResult<boolean>>;
  /**
   * The follow after accepting; null when there was no follow at all. An
   * accepted one comes back as it is. Accepting a request writes the
   * follower's `follow_accepted` Activity row (CM-3, id `activityId`) in the
   * same batch.
   */
  acceptFollow(followeeId: string, followerId: string, now: Date, activityId?: string): Promise<KitchenResult<KitchenFollowRecord | null>>;
  /** True when there was a request to decline. */
  declineFollow(followeeId: string, followerId: string): Promise<KitchenResult<boolean>>;
  /** True when there was a follow (either state) to remove. */
  removeFollower(followeeId: string, followerId: string): Promise<KitchenResult<boolean>>;
  /** Requests waiting on `query.viewer`, newest first. */
  followRequests(query: KitchenPeopleQuery): Promise<KitchenResult<KitchenPeoplePage>>;
  /** `userId`'s accepted followers, the latest first, without anyone who has a block with the viewer. */
  listFollowers(userId: string, query: KitchenPeopleQuery): Promise<KitchenResult<KitchenPeoplePage>>;
  /** Whom `userId` follows (accepted), the latest first, without anyone who has a block with the viewer. */
  listFollowing(userId: string, query: KitchenPeopleQuery): Promise<KitchenResult<KitchenPeoplePage>>;
  /** Is there a block between the two, either way? */
  isBlockedEither(a: string, b: string): Promise<KitchenResult<boolean>>;
  block(input: BlockInput): Promise<KitchenResult<BlockResult>>;
  /** True when there was a block to lift. Follows are not restored. */
  unblock(blockerId: string, blockedId: string): Promise<KitchenResult<boolean>>;
  /** Whom `blockerId` blocked, newest first. */
  listBlocks(blockerId: string, limit: number): Promise<KitchenResult<KitchenBlockRecord[]>>;
  /** True when the mute is new. */
  mute(muterId: string, mutedId: string, now: Date): Promise<KitchenResult<boolean>>;
  /** True when there was a mute to lift. */
  unmute(muterId: string, mutedId: string): Promise<KitchenResult<boolean>>;
  isMuted(muterId: string, mutedId: string): Promise<KitchenResult<boolean>>;
  /** People search: exact handle first, then handle prefix, then name; private profiles by exact handle only. */
  searchProfiles(query: SearchProfilesQuery): Promise<KitchenResult<KitchenProfileRecord[]>>;
  /** Owners of recipes the viewer saved copies of (live copies), with profiles, unfollowed and unblocked, the latest copy first. */
  recipeOwnersSavedBy(query: SuggestQuery): Promise<KitchenResult<KitchenRecipeOwnerSuggestion[]>>;
  /** Public profiles with the most accepted follows since `since`, unfollowed by and unblocked with the viewer. */
  popularProfiles(query: SuggestQuery & { since: Date }): Promise<KitchenResult<KitchenPopularProfile[]>>;
}

// ── Rows ───────────────────────────────────────────────────

type Row = Record<string, unknown>;

const PROFILE_COLUMNS = "user_id, handle, name, about, privacy, handle_changed_at, created_at, updated_at";
const profileColumns = (alias: string) =>
  PROFILE_COLUMNS.split(", ")
    .map((c) => `${alias}.${c}`)
    .join(", ");

const DAY_MS = 24 * 60 * 60 * 1000;

export function mapProfile(row: Row): KitchenProfileRecord {
  return {
    userId: row.user_id as string,
    handle: row.handle as string,
    name: row.name as string,
    about: (row.about as string | null) ?? null,
    privacy: row.privacy as KitchenProfilePrivacy,
    handleChangedAt: row.handle_changed_at ? new Date(row.handle_changed_at as string) : null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapFollow(row: Row): KitchenFollowRecord {
  return {
    followerId: row.follower_id as string,
    followeeId: row.followee_id as string,
    state: row.state as KitchenFollowState,
    createdAt: new Date(row.created_at as string),
    acceptedAt: row.accepted_at ? new Date(row.accepted_at as string) : null,
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

/**
 * No block between the viewer (placeholder `viewer`) and the person in
 * column `person`, either way: the filter every people read carries.
 */
export function notBlockedSql(viewer: string, person: string): string {
  return `NOT EXISTS (SELECT 1 FROM kitchen_blocks kb
            WHERE (kb.blocker_id = ${viewer} AND kb.blocked_id = ${person})
               OR (kb.blocker_id = ${person} AND kb.blocked_id = ${viewer}))`;
}

/** The viewer (placeholder `viewer`) has no follow, of either state, of the person in column `person`. */
function notFollowedSql(viewer: string, person: string): string {
  return `NOT EXISTS (SELECT 1 FROM kitchen_follows kf WHERE kf.follower_id = ${viewer} AND kf.followee_id = ${person})`;
}

/** A page from rows ordered by `at` descending, one more than `limit` read to know there is a next. */
function page(rows: readonly Row[], limit: number): KitchenPeoplePage {
  const people = rows.slice(0, limit).map((row) => ({ profile: mapProfile(row), at: new Date(row.page_at as string) }));
  const last = people[people.length - 1];
  return {
    people,
    nextCursor: rows.length > limit && last ? { at: last.at.toISOString(), userId: last.profile.userId } : null,
  };
}

// ── Repository ─────────────────────────────────────────────

export function createCommunityRepository(executor: SqlExecutor): CommunityRepository {
  async function one<T>(text: string, params: unknown[], map: (row: Row) => T): Promise<KitchenResult<T | null>> {
    try {
      const result = await executor.execute(text, params);
      const row = result.rows[0];
      return { ok: true, value: row ? map(row) : null };
    } catch (err) {
      return internal(err);
    }
  }

  async function many<T>(text: string, params: unknown[], map: (row: Row) => T): Promise<KitchenResult<T[]>> {
    try {
      const result = await executor.execute(text, params);
      return { ok: true, value: result.rows.map(map) };
    } catch (err) {
      return internal(err);
    }
  }

  /** True when the statement returned a row. */
  async function changed(text: string, params: unknown[]): Promise<KitchenResult<boolean>> {
    try {
      const result = await executor.execute(text, params);
      return { ok: true, value: result.rows.length > 0 };
    } catch (err) {
      return internal(err);
    }
  }

  const getProfile = (userId: string) =>
    one(`SELECT ${PROFILE_COLUMNS} FROM kitchen_profiles WHERE user_id = $1`, [userId], mapProfile);

  const getFollow = (followerId: string, followeeId: string) =>
    one(
      `SELECT follower_id, followee_id, state, created_at, accepted_at FROM kitchen_follows
       WHERE follower_id = $1 AND followee_id = $2`,
      [followerId, followeeId],
      mapFollow,
    );

  async function isBlockedEither(a: string, b: string): Promise<KitchenResult<boolean>> {
    return changed(
      `SELECT 1 FROM kitchen_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
      [a, b],
    );
  }

  /** Followers (`side` follower) or following (`side` followee) of `userId`, as a page. */
  async function edges(userId: string, side: "follower" | "followee", query: KitchenPeopleQuery): Promise<KitchenResult<KitchenPeoplePage>> {
    const them = side === "follower" ? "followee_id" : "follower_id";
    const person = side === "follower" ? "follower_id" : "followee_id";
    const params: unknown[] = [userId, query.viewer, query.limit + 1];
    let after = "";
    if (query.cursor) {
      params.push(query.cursor.at, query.cursor.userId);
      after = `AND (f.accepted_at < $4 OR (f.accepted_at = $4 AND f.${person} < $5))`;
    }
    try {
      const result = await executor.execute(
        `SELECT ${profileColumns("p")}, f.accepted_at AS page_at
         FROM kitchen_follows f JOIN kitchen_profiles p ON p.user_id = f.${person}
         WHERE f.${them} = $1 AND f.state = 'accepted' AND ${notBlockedSql("$2", "p.user_id")} ${after}
         ORDER BY f.accepted_at DESC, f.${person} DESC
         LIMIT $3`,
        params,
      );
      return { ok: true, value: page(result.rows, query.limit) };
    } catch (err) {
      return internal(err);
    }
  }

  return {
    getProfile,
    getFollow,
    isBlockedEither,

    getProfileByHandle: (handle) =>
      one(`SELECT ${PROFILE_COLUMNS} FROM kitchen_profiles WHERE handle = $1`, [handle], mapProfile),

    profilesFor({ userIds, viewer, unfollowedOnly, limit }) {
      if (userIds.length === 0) return Promise.resolve({ ok: true, value: [] });
      return many(
        `SELECT ${profileColumns("p")} FROM kitchen_profiles p
         WHERE p.user_id IN (SELECT value FROM json_each($1)) AND ${notBlockedSql("$2", "p.user_id")}
           ${unfollowedOnly ? `AND ${notFollowedSql("$2", "p.user_id")}` : ""}
         ORDER BY p.handle
         LIMIT $3`,
        [JSON.stringify([...new Set(userIds)]), viewer, limit],
        mapProfile,
      );
    },

    async saveProfile(input) {
      const cutoff = new Date(input.now.getTime() - input.handleCooldownMs);
      // Whether this makes the profile (201) or edits it (200): read first, since an upsert can't say.
      const before = await getProfile(input.userId);
      if (!before.ok) return before;
      let saved: Row | undefined;
      try {
        const [upsert] = await executeBatch(executor, [
          {
            // A new profile, or an edit; a different handle when it never changed (the first change is free) or its last change is old enough.
            text: `INSERT INTO kitchen_profiles (${PROFILE_COLUMNS})
                   VALUES ($1, $2, $3, $4, $5, NULL, $6, $6)
                   ON CONFLICT (user_id) DO UPDATE SET
                     handle = excluded.handle,
                     name = excluded.name,
                     about = excluded.about,
                     privacy = excluded.privacy,
                     handle_changed_at = CASE WHEN kitchen_profiles.handle = excluded.handle
                                              THEN kitchen_profiles.handle_changed_at ELSE excluded.updated_at END,
                     updated_at = excluded.updated_at
                   WHERE kitchen_profiles.handle = excluded.handle
                      OR kitchen_profiles.handle_changed_at IS NULL OR kitchen_profiles.handle_changed_at <= $7
                   RETURNING ${PROFILE_COLUMNS}`,
            params: [input.userId, input.handle, input.name, input.about, input.privacy, input.now, cutoff],
          },
          {
            // Going public: whoever was waiting is in. Only when the upsert above applied (updated_at is this write's).
            text: `UPDATE kitchen_follows SET state = 'accepted', accepted_at = $2
                   WHERE followee_id = $1 AND state = 'requested'
                     AND EXISTS (SELECT 1 FROM kitchen_profiles WHERE user_id = $1 AND privacy = 'public' AND updated_at = $2)`,
            params: [input.userId, input.now],
          },
        ]);
        saved = upsert?.rows[0];
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: true, value: { kind: "handle_taken" } };
        return internal(err);
      }
      if (saved) {
        const profile = mapProfile(saved);
        return { ok: true, value: { kind: "saved", profile, created: before.value === null } };
      }
      const current = await getProfile(input.userId);
      if (!current.ok) return current;
      if (!current.value) return internal("kitchen: profile upsert returned no row");
      if (!current.value.handleChangedAt) return internal("kitchen: a first handle change was refused");
      const nextChangeAt = new Date(current.value.handleChangedAt.getTime() + input.handleCooldownMs);
      return { ok: true, value: { kind: "handle_too_soon", nextChangeAt } };
    },

    async profileCounts(userId) {
      try {
        const result = await executor.execute(
          `SELECT
             (SELECT COUNT(*) FROM kitchen_recipes
               WHERE owner_id = $1 AND listed = 1 AND visibility = 'link' AND deleted_at IS NULL AND is_system = 0) AS recipes,
             (SELECT COUNT(*) FROM kitchen_follows WHERE followee_id = $1 AND state = 'accepted') AS followers,
             (SELECT COUNT(*) FROM kitchen_follows WHERE follower_id = $1 AND state = 'accepted') AS following`,
          [userId],
        );
        const row = result.rows[0] ?? {};
        return { ok: true, value: { recipes: Number(row.recipes ?? 0), followers: Number(row.followers ?? 0), following: Number(row.following ?? 0) } };
      } catch (err) {
        return internal(err);
      }
    },

    followsFrom(followerId, followeeIds) {
      if (followeeIds.length === 0) return Promise.resolve({ ok: true, value: [] });
      return many(
        `SELECT follower_id, followee_id, state, created_at, accepted_at FROM kitchen_follows
         WHERE follower_id = $1 AND followee_id IN (SELECT value FROM json_each($2))`,
        [followerId, JSON.stringify([...new Set(followeeIds)])],
        mapFollow,
      );
    },

    followedBy: (viewer, target, limit) =>
      many(
        `SELECT ${profileColumns("p")}
         FROM kitchen_follows mine
         JOIN kitchen_follows theirs ON theirs.follower_id = mine.followee_id
         JOIN kitchen_profiles p ON p.user_id = mine.followee_id
         WHERE mine.follower_id = $1 AND mine.state = 'accepted'
           AND theirs.followee_id = $2 AND theirs.state = 'accepted'
           AND ${notBlockedSql("$1", "p.user_id")}
         ORDER BY theirs.accepted_at DESC, p.user_id
         LIMIT $3`,
        [viewer, target, limit],
        mapProfile,
      ),

    async follow(input) {
      const since = new Date(input.now.getTime() - DAY_MS);
      let made: KitchenFollowRecord | null = null;
      try {
        const [inserted] = await executeBatch(executor, [
          {
            text: `INSERT INTO kitchen_follows (follower_id, followee_id, state, created_at, accepted_at)
                   SELECT $1, $2, $3, $4, CASE WHEN $3 = 'accepted' THEN $4 ELSE NULL END
                   WHERE (SELECT COUNT(*) FROM kitchen_follows WHERE follower_id = $1 AND created_at > $5) < $6
                     AND NOT EXISTS (SELECT 1 FROM kitchen_blocks
                                     WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1))
                   ON CONFLICT (follower_id, followee_id) DO NOTHING
                   RETURNING follower_id, followee_id, state, created_at, accepted_at`,
            params: [input.followerId, input.followeeId, input.state, input.now, since, input.maxPerDay],
          },
          // The followee's Activity (CM-3): only when the follow above is the one this batch wrote.
          activityStatement(
            {
              id: input.activityId ?? crypto.randomUUID(),
              userId: input.followeeId,
              kind: input.state === "accepted" ? "followed" : "follow_request",
              actorId: input.followerId,
              now: input.now,
            },
            `EXISTS (SELECT 1 FROM kitchen_follows nf WHERE nf.follower_id = $4 AND nf.followee_id = $2 AND nf.created_at = $8)`,
          ),
        ]);
        const row = inserted?.rows[0];
        made = row ? mapFollow(row) : null;
      } catch (err) {
        return internal(err);
      }
      if (made) return { ok: true, value: { kind: "followed", follow: made } };
      const existing = await getFollow(input.followerId, input.followeeId);
      if (!existing.ok) return existing;
      if (existing.value) return { ok: true, value: { kind: "existing", follow: existing.value } };
      const blocked = await isBlockedEither(input.followerId, input.followeeId);
      if (!blocked.ok) return blocked;
      return { ok: true, value: { kind: blocked.value ? "blocked" : "limited" } };
    },

    unfollow: (followerId, followeeId) =>
      changed(`DELETE FROM kitchen_follows WHERE follower_id = $1 AND followee_id = $2 RETURNING follower_id`, [followerId, followeeId]),

    async acceptFollow(followeeId, followerId, now, activityId) {
      let accepted: KitchenFollowRecord | null = null;
      try {
        const [updated] = await executeBatch(executor, [
          {
            text: `UPDATE kitchen_follows SET state = 'accepted', accepted_at = $3
                   WHERE followee_id = $1 AND follower_id = $2 AND state = 'requested'
                   RETURNING follower_id, followee_id, state, created_at, accepted_at`,
            params: [followeeId, followerId, now],
          },
          // The follower's Activity (CM-3): only when this batch accepted it.
          activityStatement(
            { id: activityId ?? crypto.randomUUID(), userId: followerId, kind: "follow_accepted", actorId: followeeId, now },
            `EXISTS (SELECT 1 FROM kitchen_follows af WHERE af.follower_id = $2 AND af.followee_id = $4 AND af.accepted_at = $8)`,
          ),
        ]);
        const row = updated?.rows[0];
        accepted = row ? mapFollow(row) : null;
      } catch (err) {
        return internal(err);
      }
      if (accepted) return { ok: true, value: accepted };
      return getFollow(followerId, followeeId);
    },

    declineFollow: (followeeId, followerId) =>
      changed(
        `DELETE FROM kitchen_follows WHERE followee_id = $1 AND follower_id = $2 AND state = 'requested' RETURNING follower_id`,
        [followeeId, followerId],
      ),

    removeFollower: (followeeId, followerId) =>
      changed(`DELETE FROM kitchen_follows WHERE followee_id = $1 AND follower_id = $2 RETURNING follower_id`, [followeeId, followerId]),

    async followRequests(query) {
      const params: unknown[] = [query.viewer, query.limit + 1];
      let after = "";
      if (query.cursor) {
        params.push(query.cursor.at, query.cursor.userId);
        after = "AND (f.created_at < $3 OR (f.created_at = $3 AND f.follower_id < $4))";
      }
      try {
        const result = await executor.execute(
          `SELECT ${profileColumns("p")}, f.created_at AS page_at
           FROM kitchen_follows f JOIN kitchen_profiles p ON p.user_id = f.follower_id
           WHERE f.followee_id = $1 AND f.state = 'requested' AND ${notBlockedSql("$1", "p.user_id")} ${after}
           ORDER BY f.created_at DESC, f.follower_id DESC
           LIMIT $2`,
          params,
        );
        return { ok: true, value: page(result.rows, query.limit) };
      } catch (err) {
        return internal(err);
      }
    },

    listFollowers: (userId, query) => edges(userId, "follower", query),
    listFollowing: (userId, query) => edges(userId, "followee", query),

    async block(input) {
      const since = new Date(input.now.getTime() - DAY_MS);
      let inserted = false;
      try {
        const [made] = await executeBatch(executor, [
          {
            text: `INSERT INTO kitchen_blocks (blocker_id, blocked_id, created_at)
                   SELECT $1, $2, $3
                   WHERE (SELECT COUNT(*) FROM kitchen_blocks WHERE blocker_id = $1 AND created_at > $4) < $5
                   ON CONFLICT (blocker_id, blocked_id) DO NOTHING
                   RETURNING blocker_id`,
            params: [input.blockerId, input.blockedId, input.now, since, input.maxPerDay],
          },
          {
            // The follows both ways end with the block — and only when the block is there.
            text: `DELETE FROM kitchen_follows
                   WHERE ((follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1))
                     AND EXISTS (SELECT 1 FROM kitchen_blocks WHERE blocker_id = $1 AND blocked_id = $2)`,
            params: [input.blockerId, input.blockedId],
          },
        ]);
        inserted = (made?.rows.length ?? 0) > 0;
      } catch (err) {
        return internal(err);
      }
      if (inserted) return { ok: true, value: { kind: "blocked" } };
      const existing = await changed(`SELECT 1 FROM kitchen_blocks WHERE blocker_id = $1 AND blocked_id = $2`, [input.blockerId, input.blockedId]);
      if (!existing.ok) return existing;
      return { ok: true, value: { kind: existing.value ? "existing" : "limited" } };
    },

    unblock: (blockerId, blockedId) =>
      changed(`DELETE FROM kitchen_blocks WHERE blocker_id = $1 AND blocked_id = $2 RETURNING blocker_id`, [blockerId, blockedId]),

    listBlocks: (blockerId, limit) =>
      many(
        `SELECT b.blocked_id, b.created_at AS blocked_at, ${profileColumns("p")}
         FROM kitchen_blocks b LEFT JOIN kitchen_profiles p ON p.user_id = b.blocked_id
         WHERE b.blocker_id = $1
         ORDER BY b.created_at DESC, b.blocked_id
         LIMIT $2`,
        [blockerId, limit],
        (row) => ({
          blockedId: row.blocked_id as string,
          createdAt: new Date(row.blocked_at as string),
          profile: row.user_id ? mapProfile(row) : null,
        }),
      ),

    mute: (muterId, mutedId, now) =>
      changed(
        `INSERT INTO kitchen_mutes (muter_id, muted_id, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (muter_id, muted_id) DO NOTHING RETURNING muter_id`,
        [muterId, mutedId, now],
      ),

    unmute: (muterId, mutedId) =>
      changed(`DELETE FROM kitchen_mutes WHERE muter_id = $1 AND muted_id = $2 RETURNING muter_id`, [muterId, mutedId]),

    isMuted: (muterId, mutedId) =>
      changed(`SELECT 1 FROM kitchen_mutes WHERE muter_id = $1 AND muted_id = $2`, [muterId, mutedId]),

    searchProfiles({ viewer, handle, name, limit }) {
      // The handle is a–z, 0–9, _ and . only, so it is matched as text, never as a pattern.
      const nameMatch = name ? "OR instr(lower(p.name), lower($3)) > 0" : "";
      return many(
        `SELECT ${profileColumns("p")} FROM kitchen_profiles p
         WHERE p.user_id <> $1 AND ${notBlockedSql("$1", "p.user_id")}
           AND (p.handle = $2 OR (p.privacy = 'public' AND (substr(p.handle, 1, length($2)) = $2 ${nameMatch})))
         ORDER BY (p.handle = $2) DESC, (substr(p.handle, 1, length($2)) = $2) DESC, p.handle
         LIMIT $4`,
        [viewer, handle, name, limit],
        mapProfile,
      );
    },

    recipeOwnersSavedBy: ({ viewer, limit }) =>
      many(
        `SELECT ${profileColumns("p")}, c.name AS recipe_name, MAX(c.created_at) AS saved_at
         FROM kitchen_recipes c JOIN kitchen_profiles p ON p.user_id = c.source_owner_id
         WHERE c.owner_id = $1 AND c.source_owner_id IS NOT NULL AND c.source_owner_id <> $1 AND c.deleted_at IS NULL
           AND ${notBlockedSql("$1", "p.user_id")} AND ${notFollowedSql("$1", "p.user_id")}
         GROUP BY c.source_owner_id
         ORDER BY saved_at DESC, p.user_id
         LIMIT $2`,
        [viewer, limit],
        (row) => ({ profile: mapProfile(row), recipeName: row.recipe_name as string }),
      ),

    popularProfiles: ({ viewer, limit, since }) =>
      many(
        `SELECT ${profileColumns("p")}, COUNT(*) AS new_followers
         FROM kitchen_follows f JOIN kitchen_profiles p ON p.user_id = f.followee_id
         WHERE f.state = 'accepted' AND f.accepted_at >= $2 AND p.privacy = 'public' AND p.user_id <> $1
           AND ${notBlockedSql("$1", "p.user_id")} AND ${notFollowedSql("$1", "p.user_id")}
         GROUP BY f.followee_id
         ORDER BY new_followers DESC, p.handle
         LIMIT $3`,
        [viewer, since, limit],
        (row) => ({ profile: mapProfile(row), newFollowers: Number(row.new_followers) }),
      ),
  };
}
