# cookpool-community — design

The canvas row "Community" is the reference for every screen. The rules from earlier epics still apply:
- five tabs;
- Undo instead of "Are you sure?";
- static pages;
- stage first, behind `newFrame()`.

## 0. What exists

- **Names:** `identity_users.display_name`, which may be null, read by kitchen-worker through the identity lookup. `displayNameOf` falls back to the **email's local part**, which is fine inside a group but must never reach strangers.
  - There's no handle, avatar column or kitchen profile table.
  - Faces are initials on a colour from the id.
- **Profiles today:** `/you` (`profile-ui.tsx` `YourPage`) and `/people/[usr]` (`NewPerson`). The read behind `/people/[usr]` is `GET /v1/kitchen/me/people/{usr}`, which is co-members only (404 otherwise).
- **Recipes** (migration 350):
  - `visibility IN ('only_me','groups','link')`, with a `link_code` exactly when `link`;
  - copies record `source_recipe_id`, `source_owner_id` and `source_owner_name`, and "saved by" counts copies;
  - Explore is `GET /v1/kitchen/recipes?source=cookpool|groups`;
  - `GET /v1/kitchen/people/{usr}/recipes` is co-members only.
- **Dishes:** `kitchen_dishes` and `kitchen_dish_shares` (250/260), and GC's step log. A dish is seen by its cook or its group only. There's no photo and no server feed; Home's feed is client-side over `/me/dishes`.
- **Pushes:**
  - `PUSH_TO_SUBJECT_KINDS` (`kitchen.timer`, `kitchen.ask`) are for things a person asked for, and skip preferences.
  - Preference kinds are `NOTIFICATION_KINDS` (`kitchen.portion_set`, `kitchen.dish_posted`, `kitchen.paid_you`). They have to match `KITCHEN_EMAILS` template keys, push is opt-in, and the UI list lives in `lib/push.ts`.
- **Safety:** there's no block, report or moderation anywhere.
- **Images:** no R2 binding, no upload, no image columns. The Cloudflare connection has D1 and KV only.
- **Navigation:** the new frame's tabs are Home, Pantry, Cook, Money and You. Cook owns `/dishes`, `/recipes`, `/explore` and `/r`; Money owns `/people`.
- The latest migration is **420**.

## 1. Profiles (CM-2)

**Migration 430** `430_kitchen_community`:
- **`kitchen_profiles`:**
  - `user_id` is the primary key (`usr_…`);
  - `handle` (lowercase, unique) matches `^[a-z0-9_.]{3,20}$`, with no leading or trailing `.`, no `..`, and not reserved;
  - `name` is 1–40 characters, `about` up to 160 characters or null;
  - `privacy` is `public|private`, default `public`;
  - plus `handle_changed_at`, `created_at` and `updated_at`.
- **`kitchen_follows`:** `follower_id`, `followee_id`, `state` (`accepted|requested`), `created_at`, `accepted_at`. Primary key `(follower_id, followee_id)`, with indexes by followee and state.
- **`kitchen_blocks`:** `(blocker_id, blocked_id, created_at)`, primary key on the pair.
- **`kitchen_mutes`:** `(muter_id, muted_id, created_at)`, primary key on the pair.
- **`kitchen_recipes.listed`:** `INTEGER NOT NULL DEFAULT 0`. A **public** recipe is `visibility = 'link' AND listed = 1`. Setting `listed` mints a link if there isn't one. Turning the link off also unlists.

**Rules:**
- **Who has a public face:** only people with a profile appear outside their groups. Without one, you can follow no one, can't be found, and can't post beyond Just me. The console asks for a handle the first time Community opens (HandleSetup).
- **Handles:**
  - Reserved: `cookpool`, `admin`, `support`, `help`, `about`, `settings`, `me`, `you`, `explore`, `search`, `api`, `www`, plus any handle starting `cookpool`.
  - A handle can change **once per 30 days**. The old one isn't held.
- **Names outside your groups** always come from `kitchen_profiles.name`, never the identity display name or the email. Inside groups, today's names stay.
- **Following:**
  - Following a public profile is `accepted` at once; following a private profile is `requested`.
  - The followee accepts or declines a request, and can remove any follower.
  - Unfollowing deletes the row.
  - You can't follow yourself, or anyone with a block between you.
- **Blocking:** it deletes follows both ways in the same batch. Afterwards neither person can see, find or follow the other, or interact with the other's posts or comments, and every read in §1–§3 filters it out. The blocked person isn't told.
- **Muting:** it removes the person's posts from the muter's Following feed, nothing else.
- **Seeing a private profile:** non-followers see the name, handle, about, counts and the follow button, but no cooks, recipes or follower lists.

**Routes:**
- **Your profile:**
  - `GET` and `PUT /v1/kitchen/me/profile` take `{ handle, name, about?, privacy }`. Handle or rate refusals use `details.reason`: `handle_taken`, `handle_reserved`, `handle_shape` or `handle_too_soon` (with `nextChangeAt`).
  - `GET /v1/kitchen/handles/{handle}` returns `{ available, reason? }`.
- **Someone's profile:**
  - `GET /v1/kitchen/profiles/{handle}` returns `{ profile: { userId, handle, name, about, privacy }, counts: { posts, recipes, followers, following }, relationship: { following: none|requested|accepted, followsYou, blocked: false }, followedBy: [{ handle, name }] (≤3 people you follow), canSee }`. A block either way returns the opaque 404.
  - `GET /v1/kitchen/profiles/{handle}/recipes` lists their public recipes (cursor); when `canSee` is false the answer is 403 `private`.
  - `GET …/profiles/{handle}/followers` and `…/following` list profiles, under the same `canSee` rule.
- **Following:**
  - `POST /v1/kitchen/me/follows/{handle}` returns `{ state }`; `DELETE /v1/kitchen/me/follows/{handle}` unfollows.
  - `GET /v1/kitchen/me/follow-requests` lists your requests; `POST …/follow-requests/{usr}/accept` and `…/decline` answer one.
  - `DELETE /v1/kitchen/me/followers/{usr}` removes a follower.
- **Blocks and mutes:** `POST` and `DELETE /v1/kitchen/me/blocks/{usr}`, `GET /v1/kitchen/me/blocks`, and `POST`/`DELETE /v1/kitchen/me/mutes/{usr}`.
- **Finding people:**
  - `GET /v1/kitchen/people/search?q=` matches a handle prefix, or a name containing `q` for **public** profiles only. Private profiles match by exact handle only. At most 20 results, with no blocked people.
  - `GET /v1/kitchen/me/people/suggestions` returns `{ fromGroups, fromRecipes, popular }`, each at most 10 profiles with a `why`, excluding people you already follow or have blocked:
    - `fromGroups`: co-members with a profile;
    - `fromRecipes`: owners of recipes you saved, and (after CM-3) people who cooked yours;
    - `popular`: public profiles with the most new followers in 14 days.
- **Recipes:**
  - `PATCH /v1/kitchen/me/recipes/{rcp}` accepts `listed`. A system recipe can't be listed.
  - Explore gains `source=public`: listed recipes from public profiles, with nobody blocked.
- **Limits:** at most 200 follows a day, 50 blocks a day, and 100 searches a minute per person.

## 2. Posts, the feed and reactions (CM-3)

**Migration 440** `440_kitchen_posts`:
- **`kitchen_posts`:**
  - `pst_` id, `author_id`, `dish_id` (nullable, unique: one post per dish), `recipe_id` (nullable), `title` (1–60, the dish name), `caption` (≤500 or null);
  - `audience` is `followers|public|me`;
  - `stats` is a JSON object of only the chosen fields from `size`, `minutes`, `ate` and `steps`. **It never holds money, the group or people.**
  - `photo_key` is null, reserved for CM-4. Plus `created_at`, `edited_at` and `deleted_at`.
- **`kitchen_post_yums`:** `(post_id, user_id, created_at)`, primary key on the pair.
- **`kitchen_post_comments`:** `cmt_` id, `post_id`, `author_id`, `body` (1–500), `created_at`, `deleted_at`, `deleted_by`.
- **`kitchen_reports`:** `rpt_` id, `reporter_id`, `target_kind` (`post|comment|profile`), `target_id`, `reason` (`spam|abuse|unsafe|other`), `note` (≤300), `created_at`, `state` (`open|closed`).
- **`kitchen_activity`:** `act_` id, `user_id` (the recipient), `kind` (`followed|follow_request|follow_accepted|yum|comment|cooked_yours|saved_yours`), `actor_id`, `post_id`, `comment_id`, `recipe_id`, `created_at`, `read_at`.

**Posting:**
- `POST /v1/kitchen/me/posts` takes `{ dishId, caption?, audience, show: { size, time, ate, steps } }`.
- Only the dish's cook can post it, and only once the dish is finalized, or as a Just me dish. (CM-8 relaxes this: any of the cook's dishes but a canceled one; see §2a.)
- The server computes the stats from the dish and its step log. Size is the cook's size against the recipe; time is the step log's total; ate is the count of portions' people (since CM-8, the dish's servings; see §2a); steps is done of total.
- `recipe_id` links the recipe only when it's public, or is the cook's own copy of a public recipe. Otherwise the post shows the name with no link.
- An author without a profile can only post as `me`.
- `PATCH /v1/kitchen/me/posts/{pst}` changes the caption, audience or stat choices; `DELETE` removes the post (soft, with Undo).

**Who sees a post:**
- `me`: the author only.
- `followers`: the author and accepted followers.
- `public`: anyone signed in, except that **a private author's posts reach followers only**.
- Blocks hide posts both ways. Mutes hide them from the Following feed.

**Reads:**
- `GET /v1/kitchen/posts/{pst}` returns the post plus `author`, `recipe` (`{ id, name, linkCode }` or null), `yums: { count, mine, names (≤3, people you follow first) }`, `comments: { count }`, and, for the viewer, `stepCompare` (their usual time for that recipe at that size, when they have one).
- `GET /v1/kitchen/me/feed?tab=following|discover&cursor=`:
  - Following is newest first from people you follow, plus your own posts.
  - Discover is public posts from public profiles you don't follow, from the last 14 days. It's ordered by `created_at` with a boost of 2 h per log2(yums+1), up to 24 h. Cookpool's own recipes may appear as recipe cards.
  - Both return 20 posts per page.
- `GET /v1/kitchen/profiles/{handle}/posts?cursor=` follows the `canSee` rule.

**Yum and comments:**
- `POST` and `DELETE /v1/kitchen/posts/{pst}/yum`.
- `GET` and `POST /v1/kitchen/posts/{pst}/comments` (oldest first, cursor; at most 30 comments an hour per person).
- `DELETE /v1/kitchen/comments/{cmt}` works for the comment's author or the post's author.

**Reports:** `POST /v1/kitchen/reports` takes `{ targetKind, targetId, reason, note? }`. Reports are stored and audited (`kitchen.report.created`); there's no moderation console in v1. A target with 3 or more open reports from different people is hidden from Discover.

**Activity:**
- Rows are written in the same batch as the event:
  - `followed`, `follow_request` and `follow_accepted` (when CM-2's follow routes run — CM-3 adds this);
  - `yum` and `comment` on your post;
  - **`cooked_yours`** when a post links a recipe whose owner, or whose copy's `source_owner_id`, is someone else;
  - `saved_yours` when someone copies your public recipe.
- Nothing is written for yourself or across a block.
- `GET /v1/kitchen/me/activity?cursor=` returns `{ requests, items }`. Yums on one post group into one item ("Meera and 11 others"). `POST /v1/kitchen/me/activity/read` takes `{ before }`, and `GET …/activity/unread` returns `{ count }`.

**Pushes:** these are preference kinds, `kitchen.followed`, `kitchen.follow_request`, `kitchen.commented`, `kitchen.yum` and `kitchen.cooked_yours`.
- Push is opt-in, as today, and email is **off** for these. If the preference system requires a `KITCHEN_EMAILS` template per kind, add a minimal one that's never sent.
- A Yum push is sent at most once per post per hour.
- Copy:
  - "Sam started following you"
  - "Priya wants to follow you"
  - "Kabir commented: Roast the spices first…"
  - "Meera said Yum to your Chicken curry"
  - "Dev cooked your Chicken curry · 1 kg"

## 2a. Cooked, then post or split (CM-8 server, CM-9 console)

The owner: "the dish posting and the group splitting are two different features." Cooking ends at **Cooked!** with the dish saved as the cook's own; **Post to Community** and **Split with a group** are separate actions there and on the dish page, in any order or never. Canvas board `CookDone`.

- **Finishing without a group** is today's "just me" dish: `POST /v1/kitchen/me/dishes` with `orgId: null` still takes ingredients from any pantry the cook may use, and every group item is charged to the cook as a `use` in its group, as always. No dish transaction is posted.
- **Splitting later:** `POST /v1/kitchen/me/dishes/{dsh}/split { orgId, splitMode? }` (default `claims`) attaches the cook's own unsplit dish to one group they cook in and puts it exactly where a dish cooked into that group is: open for Who ate (or a draft for the cook's shares). Then claims, `…/shares` and `…/finalize` post the one `dish` transaction as they always have. The dish's money is what it was at cook time; nothing moves until finalize. One write: the dish row (`org_id`, `split_mode`, state, `split_at`), the group's currency pinned to the dish's, and the audit event `kitchen.dish.split` in that group. The group's members get the dish-posted email.
  - A dish is split once. Refusals: someone else's dish, a group the cook isn't in or only views → the opaque 404; a dish in a group already → 409 `already_split` (`details.orgId`); a canceled dish → 409 `dish_not_open`; a group counting in another currency → 422 `currency_mismatch`.
  - A "just me" dish its cook marked finalized (which posted nothing) can still be split: it opens again.
- **Posting any finished dish:** CM-3's rule is relaxed. Any of the cook's dishes that isn't canceled can be posted, before or after a split, open or finalized. The `ate` stat is the dish's **servings**: its portions, rounded up to whole servings, at least 1. It's no longer its shares.
- **Home's split reminder:** the inbox gains `splitReminders`, one `split_reminder` row per unsplit dish of the cook's own, cooked in the last 7 days, that took something from a group pantry or made 2+ servings. Each names a group to suggest: the one whose pantry it took most from (by cost), else the group the cook last cooked for, else their first group by name. The group must be one they cook in, in the dish's currency. The row stays until the dish is split, canceled or dismissed: `POST …/dishes/{dsh}/split-reminder/dismiss`, Undo `…/restore`. Migration **460** adds `kitchen_dishes.split_at` and `split_dismissed_at`.

## 3. Photos (CM-4)

- **Storage:** an R2 bucket per environment (`cookpool-photos-<env>`) via a new terraform module, bound to kitchen-worker as `PHOTOS`. **This needs R2 Edit on the Cloudflare connection, which the owner grants.**
- **Upload:** `POST /v1/kitchen/me/photos` takes a JPEG/PNG/WebP up to 5 MB, which the console resizes to at most 1600 px before sending. It's stored under `p/<usr>/<uuid>.webp`, and the route returns `{ key }`.
- **Where photos attach:** to a post (`photo_key`) and to a profile (`avatar_key` on `kitchen_profiles`, added by CM-4's migration).
- **Serving:** `GET /v1/kitchen/photos/{key}` applies the same visibility rule as the thing the photo is attached to, with long cache headers and an `ETag`. An unattached photo older than 24 h is swept.

## 4. Screens (CM-5, CM-6; after the owner approves the canvas)

- **Cook tab:**
  - Its hub gains a **Community** entry and the feed at `/community`, with `?tab=following|discover`.
  - People search is `/community/search`, Activity is `/community/activity`, a profile is `/u/[handle]`, and a post is `/p/[postId]`.
  - All of these count as Cook-tab pages for navigation (`nav.ts` prefixes).
- **You tab:** gains your handle, followers and following counts, and links to HandleSetup (`/you/profile`), follow requests and blocked people.
- **Share this cook?** comes after Who ate in the cook session (RC-6 and GC-5's Finish), and from a dish's page ("Share").
- **Recipe share sheet:** gains **Public** beside Only me / My groups / Anyone with the link.
- **Notifications** (`/you/notifications`): lists the five new kinds.

## 5. Out of scope

- Direct messages.
- Hashtags.
- Stories.
- An algorithmic feed.
- A moderation console: reports are stored for now.
- Video.
- Tagging people in a post.
- Public money of any kind.
- Following groups.
- Importing contacts.
