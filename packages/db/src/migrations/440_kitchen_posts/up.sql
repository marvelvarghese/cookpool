-- 440_kitchen_posts: posts from dishes with whitelisted stats, Yum, comments,
-- reports and the Activity a person reads.
--
-- Context: kitchen
-- Epic: cookpool-community (CM-3, design §2) — a cook shares what they
--       cooked with their followers, the public or just themselves; people
--       say Yum and comment; anyone can report a post, a comment or a
--       profile; and each person reads what happened to them in Activity.
--
-- Design rules:
--   * Additive and idempotent: five new tables, CREATE … IF NOT EXISTS.
--   * A post's stats are a JSON object holding only the stats its author
--     chose, from size, minutes, ate and steps — the CHECK refuses any other
--     key, so money, a group or people can never be stored there.
--     kitchen-worker computes them from the dish and its step log.
--   * One live post per dish: a partial UNIQUE index over dish_id while the
--     post is not deleted. Deleting is soft (deleted_at) so it can be undone;
--     a dish whose post was deleted can be posted again.
--   * recipe_id is the recipe the post links — a public recipe (or
--     Cookpool's), never a private one; NULL shows the name with no link.
--   * yum_pushed_at is when the author was last pushed a Yum on the post: a
--     Yum pushes only when it is NULL or an hour old, claimed in the Yum's
--     own batch, so a post pushes at most once an hour.
--   * A Yum is one row per (post, person). A comment is soft-deleted by its
--     author or the post's author (deleted_by says which). A report is one
--     per reporter and target; three open reports from different people
--     hide the target from Discover.
--   * Activity is one row per thing that happened to its recipient (user_id),
--     written in the same batch as the event, never for oneself (the CHECK);
--     read_at is set when they read up to it.
--   * Indexes: posts by author and time (Following, a profile's posts), by
--     audience and time (Discover), by recipe (cooked yours); comments by
--     post and time and by author and time (the hourly limit); reports by
--     target; activity by recipient and time, its unread rows, and by post
--     (a Yum taken back removes its row).
--   * Every time is an ISO 8601 UTC instant as toISOString() writes it, so
--     text order is time order. Subject ids are public ids (usr_…) with no
--     cross-context FK; post, comment, report and activity ids are UUIDs
--     (pst_, cmt_, rpt_ and act_ in the API).

CREATE TABLE IF NOT EXISTS kitchen_posts (
  id             TEXT PRIMARY KEY,
  author_id      TEXT NOT NULL CHECK (length(author_id) BETWEEN 1 AND 128),
  dish_id        TEXT REFERENCES kitchen_dishes(id),
  recipe_id      TEXT REFERENCES kitchen_recipes(id),
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  caption        TEXT CHECK (caption IS NULL OR length(caption) BETWEEN 1 AND 500),
  audience       TEXT NOT NULL CHECK (audience IN ('followers', 'public', 'me')),
  -- Only the chosen stats, and only these four keys.
  stats          TEXT NOT NULL DEFAULT '{}' CHECK (
                   json_valid(stats) AND json_type(stats) = 'object'
                   AND json_remove(stats, '$.size', '$.minutes', '$.ate', '$.steps') = '{}'
                 ),
  photo_key      TEXT CHECK (photo_key IS NULL OR length(photo_key) BETWEEN 1 AND 200),
  yum_pushed_at  TEXT,
  created_at     TEXT NOT NULL,
  edited_at      TEXT,
  deleted_at     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS kitchen_posts_dish_uq
  ON kitchen_posts (dish_id) WHERE dish_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS kitchen_posts_author_idx
  ON kitchen_posts (author_id, created_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS kitchen_posts_audience_idx
  ON kitchen_posts (audience, created_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS kitchen_posts_recipe_idx
  ON kitchen_posts (recipe_id) WHERE recipe_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS kitchen_post_yums (
  post_id     TEXT NOT NULL REFERENCES kitchen_posts(id),
  user_id     TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS kitchen_post_comments (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES kitchen_posts(id),
  author_id   TEXT NOT NULL CHECK (length(author_id) BETWEEN 1 AND 128),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  deleted_by  TEXT CHECK (deleted_by IS NULL OR length(deleted_by) BETWEEN 1 AND 128),
  -- Removed exactly when someone removed it.
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

CREATE INDEX IF NOT EXISTS kitchen_post_comments_post_idx
  ON kitchen_post_comments (post_id, created_at);

CREATE INDEX IF NOT EXISTS kitchen_post_comments_author_idx
  ON kitchen_post_comments (author_id, created_at);

CREATE TABLE IF NOT EXISTS kitchen_reports (
  id           TEXT PRIMARY KEY,
  reporter_id  TEXT NOT NULL CHECK (length(reporter_id) BETWEEN 1 AND 128),
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('post', 'comment', 'profile')),
  target_id    TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 128),
  reason       TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'unsafe', 'other')),
  note         TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 300),
  created_at   TEXT NOT NULL,
  state        TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  UNIQUE (reporter_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS kitchen_reports_target_idx
  ON kitchen_reports (target_kind, target_id, state);

CREATE TABLE IF NOT EXISTS kitchen_activity (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL CHECK (length(user_id) BETWEEN 1 AND 128),
  kind        TEXT NOT NULL CHECK (kind IN ('followed', 'follow_request', 'follow_accepted', 'yum', 'comment', 'cooked_yours', 'saved_yours')),
  actor_id    TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
  post_id     TEXT,
  comment_id  TEXT,
  recipe_id   TEXT,
  created_at  TEXT NOT NULL,
  read_at     TEXT,
  -- Nothing is written for yourself.
  CHECK (user_id <> actor_id)
);

CREATE INDEX IF NOT EXISTS kitchen_activity_user_idx
  ON kitchen_activity (user_id, created_at);

CREATE INDEX IF NOT EXISTS kitchen_activity_unread_idx
  ON kitchen_activity (user_id, created_at) WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS kitchen_activity_post_idx
  ON kitchen_activity (post_id, kind) WHERE post_id IS NOT NULL;

-- table kitchen_posts: A cook shared (Cookpool CM-3): from one of their dishes, with a caption, an audience and only the stats they chose; never money, a group or people.
-- column kitchen_posts.id: The post (pst_ in the API).
-- column kitchen_posts.author_id: Who posted it (usr_…): the dish's cook.
-- column kitchen_posts.dish_id: The dish it shares; one live post per dish.
-- column kitchen_posts.recipe_id: The recipe it links — public, or Cookpool's; NULL shows the name with no link.
-- column kitchen_posts.title: The dish's name, 1–60 characters.
-- column kitchen_posts.caption: What the cook wrote, up to 500 characters; NULL for none.
-- column kitchen_posts.audience: followers, public or me (just the author); a private author's public post reaches followers only.
-- column kitchen_posts.stats: A JSON object of only the chosen stats: size, minutes, ate and steps — no other key.
-- column kitchen_posts.photo_key: The photo (CM-4); NULL until photos arrive.
-- column kitchen_posts.yum_pushed_at: When its author was last pushed a Yum on it; at most one an hour.
-- column kitchen_posts.created_at: When it was posted.
-- column kitchen_posts.edited_at: When its caption, audience or stats last changed; NULL if never.
-- column kitchen_posts.deleted_at: When its author deleted it (soft, with Undo); NULL while live.
-- table kitchen_post_yums: Yum on a post (Cookpool CM-3), one per person.
-- column kitchen_post_yums.post_id: The post.
-- column kitchen_post_yums.user_id: Who said Yum (usr_…).
-- column kitchen_post_yums.created_at: When.
-- table kitchen_post_comments: Comments on a post (Cookpool CM-3), removed by their author or the post's author.
-- column kitchen_post_comments.id: The comment (cmt_ in the API).
-- column kitchen_post_comments.post_id: The post.
-- column kitchen_post_comments.author_id: Who wrote it (usr_…).
-- column kitchen_post_comments.body: What they wrote, 1–500 characters.
-- column kitchen_post_comments.created_at: When.
-- column kitchen_post_comments.deleted_at: When it was removed; NULL while shown.
-- column kitchen_post_comments.deleted_by: Who removed it: its author or the post's author.
-- table kitchen_reports: Reports of a post, a comment or a profile (Cookpool CM-3), stored and audited; three open ones from different people hide the target from Discover.
-- column kitchen_reports.id: The report (rpt_ in the API).
-- column kitchen_reports.reporter_id: Who reported (usr_…); one report per target each.
-- column kitchen_reports.target_kind: post, comment or profile.
-- column kitchen_reports.target_id: The post's or comment's UUID, or the profile's person (usr_…).
-- column kitchen_reports.reason: spam, abuse, unsafe or other.
-- column kitchen_reports.note: What the reporter added, up to 300 characters; NULL for none.
-- column kitchen_reports.created_at: When.
-- column kitchen_reports.state: open until someone closes it (no moderation console yet).
-- table kitchen_activity: What happened to a person (Cookpool CM-3): follows, requests, Yums, comments, cooks and copies of their recipes; written with the event, never for oneself or across a block.
-- column kitchen_activity.id: The row (act_ in the API).
-- column kitchen_activity.user_id: Whom it happened to (usr_…).
-- column kitchen_activity.kind: followed, follow_request, follow_accepted, yum, comment, cooked_yours or saved_yours.
-- column kitchen_activity.actor_id: Who did it (usr_…), never the recipient.
-- column kitchen_activity.post_id: The post it is about, for yum, comment and cooked_yours.
-- column kitchen_activity.comment_id: The comment, for comment.
-- column kitchen_activity.recipe_id: The recipe, for cooked_yours (the one cooked) and saved_yours (the copy's source).
-- column kitchen_activity.created_at: When.
-- column kitchen_activity.read_at: When its recipient read up to it; NULL while unread.
