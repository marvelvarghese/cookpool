# cookpool-community (CM) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| CM0 — the spec | | |
| CM1 — profiles and following | | |
| CM2 — sharing what you cooked | | |
| CM3 — photos | | |

## Departures from the design

Each task adds a section at the end, headed `### <milestone> — <title> (<KEY>)`.

### CM1 — Profiles, follows, blocks and search in the server (CM-2)

**Built** (kitchen-worker; design §1). Contracts in `packages/contracts/src/kitchen-community.ts` (re-exported from `@saas/contracts/kitchen`), storage in `packages/db/src/kitchen/community.ts` (spread into `KitchenRepository`), handlers in `apps/kitchen-worker/src/handlers/community-{profiles,follows,people}.ts`, shared helpers in `src/community.ts`, routes in `src/community-routes.ts` (spread first into the router's `/v1/kitchen` routes, so `/me/people/suggestions` wins over `/me/people/{usr}`). api-edge's kitchen facade already forwards everything under `/v1/kitchen/…`: no edge change.

**Migration 430** `430_kitchen_community`:
- `kitchen_profiles` (user_id PK; handle lowercase UNIQUE with the shape CHECK — 3–20 of `a–z0–9_.`, no leading/trailing/doubled dot; name 1–40; about ≤160 or NULL; privacy public|private default public; handle_changed_at NULL until the handle first changes, created_at, updated_at). Reserved words are kitchen-worker's (contracts' `handleProblem`), not a CHECK.
- `kitchen_follows` (follower_id, followee_id PK, state accepted|requested, created_at, accepted_at set exactly when accepted, never oneself); indexes `(followee_id, state, accepted_at)` and `(state, accepted_at)`.
- `kitchen_blocks` (blocker_id, blocked_id PK, created_at, never oneself); index `(blocked_id)`.
- `kitchen_mutes` (muter_id, muted_id PK, created_at, never oneself).
- `kitchen_recipes.listed` INTEGER NOT NULL DEFAULT 0, CHECK `listed IN (0,1) AND (listed = 0 OR visibility = 'link')`; partial index `kitchen_recipes_listed_idx (created_at) WHERE listed = 1 AND deleted_at IS NULL`.

**Routes** (all signed in; errors on pinned codes with `details.reason` from `KITCHEN_COMMUNITY_ERROR_REASONS`):
- `GET /v1/kitchen/me/profile` → `{ profile: MyProfile | null }` (MyProfile = `{ userId, handle, name, about, privacy, handleChangedAt, nextHandleChangeAt, createdAt, updatedAt }`).
- `PUT /v1/kitchen/me/profile` `{ handle, name, about?, privacy? }` → 201 made / 200 saved `{ profile }`. 422 `handle_shape` / `handle_reserved` (with `details.fields.handle`), 409 `handle_taken`, 409 `handle_too_soon` with `details.nextChangeAt`. The handle is normalized (trim, leading `@` off, lowercase).
- `GET /v1/kitchen/handles/{handle}` → `{ handle, available, reason? }` (your own handle is available to you).
- `GET /v1/kitchen/profiles/{handle}` → `{ profile: { userId, handle, name, about, privacy }, counts: { posts, recipes, followers, following }, relationship: { following: none|requested|accepted, followsYou, blocked: false, muted, isYou }, followedBy: [{ handle, name }] (≤3), canSee }`. A block either way, a missing or malformed handle: the opaque 404.
- `GET /v1/kitchen/profiles/{handle}/recipes?cursor=` → `{ recipes: RecipeSummary[], nextCursor }`; `…/followers` and `…/following` → `{ people: CommunityPerson[], nextCursor }`; 403 `private` when `canSee` is false. Pages of 30, newest first; `meta.cursor` carries the same cursor.
- `POST /v1/kitchen/me/follows/{handle}` → `{ state }` (201 new, 200 repeat); 403 `no_profile`, 422 `self`, 404 across a block, 429 `rate_limited` `follow_limit`. `DELETE` → `{ state: "none" }`.
- `GET /v1/kitchen/me/follow-requests?cursor=` → `{ people, nextCursor }`; `POST …/follow-requests/{usr}/accept` → `{ state: "accepted" }`; `…/decline` → `{ state: "none" }` (404 when there is no request).
- `DELETE /v1/kitchen/me/followers/{usr}` → `{ removed }`.
- `POST /v1/kitchen/me/blocks/{usr}` → `{ blocked: true }` (201/200; 422 `self`; 429 `block_limit`), `DELETE` → `{ blocked: false }`, `GET /v1/kitchen/me/blocks` → `{ blocks: [{ userId, handle|null, name|null, blockedAt }] }`.
- `POST /v1/kitchen/me/mutes/{usr}` → `{ muted: true }` (201/200), `DELETE` → `{ muted: false }`.
- `GET /v1/kitchen/people/search?q=` → `{ people: CommunityPerson[] }` (≤20; exact handle, then handle prefix, then name; private only by exact handle; a leading `@` matches handles only; never the caller).
- `GET /v1/kitchen/me/people/suggestions` → `{ fromGroups, fromRecipes, popular }`, each ≤10 `SuggestedPerson` (`CommunityPerson` + `why`: "In Flat 4B", "You saved their Rajma", "2 new followers"), nobody twice, nobody followed/requested or blocked.
- `PATCH /v1/kitchen/me/recipes/{rcp}` accepts `listed` (true mints a link when there is none; false unlists and keeps the link; `listed: true` beside a non-link visibility is 422). Recipe reads carry `listed`. Turning the link off, or any non-link visibility, unlists.
- `GET /v1/kitchen/recipes?source=public`: listed recipes whose owner has a public profile, not the caller's own, nobody with a block.

`CommunityPerson` = the profile plus `following` (the caller's follow of them). Names on every one of these reads come from `kitchen_profiles.name` only; none asks identity.

**Departures and additions**
- `relationship` also carries `muted` and `isYou`; people in lists, search and suggestions carry `following`. Additive to design §1's shapes.
- The profile read is `PersonProfileResponse` in contracts (`ProfileResponse` was taken by auth).
- Turning a private profile public accepts every waiting request in the same batch (the design doesn't say; otherwise those requests would hang on a profile that no longer asks).
- A public recipe can be opened (`GET /v1/kitchen/recipes/{rcp}`), matched, copied and cooked from by id by anyone `canSee` lets in on the profile (public, or an accepted follower of a private one, no block). Such a read names the owner and a copy's source by their profiles, never identity. Without this, Explore's Public would list recipes nobody could open.
- Public reads replace a copy's stored `source.ownerName` (saved from identity when it was copied) with the source owner's profile name, or null.
- `handleProblem` reports `handle_reserved` before `handle_shape` ("me" is both).
- Cookpool's own recipes can't be listed because no one may PATCH them (the opaque 404, as before), rather than a new refusal.
- **The first handle change is free.** `handle_changed_at` is NULL on a new profile and set only when the handle changes, so a typo made in HandleSetup can be fixed at once. The 30-day wait applies only once it is set: create, change once immediately: ok; change again: 409 `handle_too_soon`. `MyProfile.handleChangedAt` is null until that first change, and `nextHandleChangeAt` is null whenever a change is accepted now.
- **Limits:** follows (200/day) and blocks (50/day) are counted in the write's own statement over the last 24 hours of rows. Unfollowing deletes the row, so follow/unfollow churn isn't counted — a follow-up if it matters. Searches have no per-route counter: api-edge's kitchen bucket (60 a minute per person) is already tighter than 100 a minute.
- Posts are counted as 0 (`counts.posts`) and suggestions' `fromRecipes` covers only recipes the caller saved. CM-3 adds both (comments mark the seams), and the Activity rows for follows.

**Tests**
- `tests/kitchen-worker`: `community-profiles.test.ts` (39), `community-follows.test.ts` (12), `community-people.test.ts` (13), including the test that no CM-2 read carries an email or an identity display name and none calls identity. Whole suite: 38 suites, 862 tests.
- `tests/db`: `kitchen-community-migration.test.ts` (11). Whole suite: 33 suites, 856 tests (checksums included).
- `tests/contracts`: `kitchen-community.test.ts`. Whole suite: 28 suites, 293 tests.
- `packages/sdk`: `kitchen-community.test.ts` (7). Whole suite: 202 tests. Also fixed a type error in `kitchen-asks.test.ts` that already failed `pnpm --filter @saas/sdk typecheck` on main.
- `tests/api-edge`: the facade's route-matching cases gain the new paths (41 in that file).

**Deploy:** kitchen-worker's own files change, so it plans and redeploys. The new migration directory plans `db-migrate` by path. kitchen-worker reads `r.listed` in every recipe read, so migration 430 must apply before this worker serves; kitchen-worker's enforced `db-migrate` edge orders that. The console picks up the contracts and SDK only when its own files change (CM-5).

### CM1 — Profiles and following in the app (CM-5)

**Built** (web-console-next, new frame only; design §4, the canvas row "Community": `HandleSetup`, `PersonProfile`, `PeopleSearch`). Pure models in `components/kitchen/community.ts` (addresses, HandleSetup's note and request, the follow button, the lock, counts, the ⋯ menu's words, the first-time rule) and `community-people.ts` (search, suggestion groups, rows, the cache patches); reads and writes in `community-data.ts`; drawn parts in `community-views.tsx`; screens in `community-setup-ui.tsx` (HandleSetup), `community-profile-ui.tsx` (a profile) and `community-ui.tsx` (Community, search, blocked people, You's section, Activity and post shells). No SDK change: CM-2's methods cover it.

**Routes and navigation** (each a static page; `/u/:handle` and `/p/:postId` one file each, `usePathParam` with a `ParamShell` layout; each in `NEW_FRAME_ONLY`):
- `/community` — "Community", the bell (→ Activity), the search field (→ search), and a placeholder card where CM-6's Following | Discover goes. HandleSetup instead, the first time it opens without a profile (remembered in `localStorage` `cookpool.community.setupOffered`; afterwards a "Pick a handle" card links to it).
- `/community/search`, `/community/activity` (CM-6 fills it; for now your follow requests when private and one line), `/u/:handle`, `/p/:postId` (CM-6's; for now "This post isn't here" and a way back).
- `/you/profile` (HandleSetup) and `/you/blocked` (blocked people, each with Unblock).
- `nav.ts`: Cook's prefixes gain `/community`, `/u`, `/p`. `back.ts`: Community → Cook; search, Activity, a profile, a post → Community; HandleSetup → You; blocked → HandleSetup. In today's frame Community's five go to `/home`, the two You pages to `/you`.
- The Cook hub gains a **Community** row (above My recipes); You gains @handle (opens your profile) · Private/Public · Followers · Following (open the lists) · Edit, and with a private profile Follow requests with Accept · Decline. Without a profile, one card to HandleSetup.

**Screens**
- **HandleSetup:** Name, Handle (normalized and lowercased as typed; local checks for shape and reserved at once, then `handleAvailable` after 350 ms: "@x is yours · you can change it once a month", "@x is taken", "@x is reserved", "3–20 letters, numbers, _ or .", and "You can change your handle again on 5 Dec" from `nextHandleChangeAt`), About · optional, Who can follow you (Anyone · People I approve), Blocked people with its count, See your profile, Save ("Saving…", "Saved ✓"; a refusal's reason under the handle).
- **A profile:** Back · @handle · ⋯; an initials face on the person's colour; Posts · Recipes · Followers · Following (the last two open `?list=followers|following` when `canSee`); name, about, "Followed by Anu, Dev and Sam", "Follows you"; Follow / Follow back / Ask to follow / Requested / Following (Edit profile on your own) and Share (copies `<origin>/u/<handle>`); the lock when `canSee` is false; else Cooks | Recipes (`?list=`), Recipes from `profileRecipes`, each with Save (your copy). Lists: rows with Follow; on your own followers, Remove. ⋯: Mute/Unmute their posts, Block @handle with "Blocking hides you from each other everywhere. Kabir isn't told."; after Block the page says "You blocked @x" with Unblock.
- **People search:** the field (name or @handle) with Cancel; empty, From your groups · From recipes · Popular with each person's `why`; typed, People, or "Nobody by that name. Private profiles show by @handle only."; Follow from any row.
- **Writes** (SM-5, `beginWrite` + `useUndoToast`): follow / ask / unfollow / take back (Undo sends the other way), mute, block and unblock (Undo), accept (Undo removes the follower). Decline and Remove follower have no Undo (only they can ask or follow again) and say so. Without a profile, Follow sends you to HandleSetup first. Every write reads Community again once it lands.
- **Recipe share sheet:** a fourth row, **Public** — "Listed on your profile and in Discover" (globe) — after Anyone with the link. Choosing it PATCHes `{ visibility: "link", listed: true }`; the link from Public PATCHes `{ visibility: "link", listed: false }` and keeps the same code; Undo sends the level before. You's recipe rows say "Public" for a listed link recipe.
- **Explore** gains a third source, Public (`?source=public`, "Listed by cooks on their profiles", rows "by Kabir · …").

**Departures**
- **No cooks-a-week on someone's profile.** The app only knows dishes in your groups (`/me/dishes`), so a stranger's chart would be empty or wrong. The profile shows Recipes, and **Recipes is the default tab** until posts arrive (Cooks reads "No cooks shared yet"); CM-6 can flip `PROFILE_DEFAULT_LIST`.
- **Report is hidden** from the ⋯ menu until CM-3's `POST /v1/kitchen/reports` exists (CM-6 adds it).
- **Counts read "Posts"** (the server's `counts.posts`, 0 until CM-3) where the canvas says Cooks.
- **The canvas's "COOKS YOUR RECIPES OR YOU SAVE THEIRS"** is "From recipes" (today it is only recipes you saved), and "Popular this week" is "Popular" (the server counts 14 days).
- **"Followed by"** names up to three (the server's `followedBy`), without "and 2 others you know" (no total is sent).
- **A first profile's Name is prefilled** with your own display name (yours to change, shown only to you); nothing else from identity is used.
- **Following from search or suggestions keeps the row** (Following, with Undo): those two reads are marked stale rather than read again, or the server would drop whom you now follow from the suggestions under your finger.
- **Lists show their first page** (30): no "more" yet.
- **Public in the sheet is new-frame only** by where the sheet lives (recipe pages are new-frame only); `shareOptions(names)` without `{ public: true }` is unchanged.
- **Pull to refresh:** none of the seven new pages pulls (CM-6 decides for the feed).

**Tests** (`tests/web-console-next`)
- `kitchen-community.test.ts` (23): the handle's messages (shape, reserved, checking, taken, yours, too soon with the date) and refusals, the draft and what Save sends, relationship → button, follow target and toasts, the lock and counts, Followed by, the menu's words, the address and lists, the first-time rule, the hub entry, the pages' prefixes, files, back parents, and newFrame false sending each away.
- `kitchen-community-people.test.ts` (15): the search query and view, suggestion groups with why, rows, blocked rows; follow, block, mute, request and follower patches; Public's options, level, PATCH mapping, Undo, cache patch and drawing; Explore's Public source.
- Changed on purpose: `static-pages.test.ts` (two more redirect rules, 15 → 17), `gestures.test.ts` (the seven pages don't pull).
- Whole suite: 99 suites, 1989 tests. `typecheck` and `lint` clean for `@saas/web-console-next` and `@saas/web-console-next-tests`. `console-artifact.mjs build`: 38 pages served as files, 17 `_redirects` rules, every new page static (`/u/_`, `/p/_` prerendered).

**Browser check** (390 × 844, `next dev` behind the SM-2 proxy with PN-9's in-page mock plus a CM-5 overlay for the community and recipe routes; the network log shows only localhost; the mock was never committed):
- Cook showed the Community row under Start cooking; Community without a profile opened HandleSetup ("Rahul Varghese" prefilled). The handle read "@anucooks is taken", "@admin is reserved", then "@rahulcooks is yours · you can change it once a month"; Save → "You're on Community · @rahulcooks" and the shell.
- Search, empty: From your groups (Dev · "In Flat 4B"), From recipes (Kabir · "You saved their Besan ladoo"), Popular (Sam · "12 new followers"). Follow on Kabir (private) → "Requested" with "Asked to follow Kabir · Undo"; Follow on Dev then Undo → back to Follow, the mock's follows matching. "kab" → the private line; "@kabirbakes" → Kabir; "sam" → Sam.
- `/u/kabirbakes` while requested: Requested, 318 followers, "Followed by Anu", the lock. Accepted: Following, 319, Cooks | Recipes with Besan ladoo and Shrikhand each with Save; Followers opened the list. ⋯ → Mute Kabir's posts, Block @kabirbakes and the note; Block → "You blocked @kabirbakes" with "Blocked @kabirbakes · They aren't told · Undo"; Undo → the profile back, the follow gone (as the server does), Ask to follow and the lock.
- You: "@rahulcooks · Private · 2 Followers · 1 Following · Edit", Follow requests · 2; Accept took Priya off. Dal tadka's row read "Public · saved by 2".
- A recipe's share sheet had four rows; Public sent one PATCH with `listed: true` and kept the same link. Explore's Public listed Kabir's two recipes "by Kabir". HandleSetup with a handle changed 3 days ago read "You can change your handle again on 5 Dec" once the handle was edited. Blocked people: Sam, Unblock → "Nobody blocked" with Undo.
- Today's frame (`cookpool-prod.localhost`): `/community` and `/u/kabirbakes` went to `/home`, `/you` was today's You, and no community route was asked.

**Deploy:** console files only; the console picks up CM-2's contracts and SDK with this change. It needs CM-2's kitchen-worker (on main as #91) — without it the community reads are 404s and the pages show their errors.

### CM2 — Posts, the feed, reactions, safety and activity in the server (CM-3)

**Built** (kitchen-worker; design §2). Contracts in `packages/contracts/src/kitchen-posts.ts` (re-exported from `@saas/contracts/kitchen`); storage in `packages/db/src/kitchen/posts.ts` (spread into `KitchenRepository`) with the shared Activity insert in `packages/db/src/kitchen/activity-write.ts`; handlers in `apps/kitchen-worker/src/handlers/community-{posts,reactions,activity}.ts`, shared helpers in `src/posts.ts` (the stats whitelist `computeStats`, `linkOf`, shapes, cursors) and `src/social-push.ts`; routes added to `src/community-routes.ts`. api-edge forwards `/v1/kitchen/…` already: no edge change.

**Migration 440** `440_kitchen_posts`:
- `kitchen_posts` (id UUID — `pst_` in the API; author_id; dish_id FK; recipe_id FK; title 1–60; caption ≤500 or NULL; audience followers|public|me; stats a JSON object whose CHECK refuses any key but `size`, `minutes`, `ate`, `steps`; photo_key NULL for CM-4; **yum_pushed_at**; created_at, edited_at, deleted_at). Indexes: partial UNIQUE `(dish_id) WHERE dish_id IS NOT NULL AND deleted_at IS NULL`; `(author_id, created_at)`, `(audience, created_at)`, `(recipe_id)`, each over live posts.
- `kitchen_post_yums` (post_id FK, user_id PK pair, created_at).
- `kitchen_post_comments` (id `cmt_`, post_id FK, author_id, body 1–500, created_at, deleted_at and deleted_by set together); indexes `(post_id, created_at)`, `(author_id, created_at)`.
- `kitchen_reports` (id `rpt_`, reporter_id, target_kind post|comment|profile, target_id — the post's/comment's UUID or the profile's `usr_`, reason spam|abuse|unsafe|other, note ≤300, created_at, state open|closed default open; UNIQUE (reporter, kind, target)); index `(target_kind, target_id, state)`.
- `kitchen_activity` (id `act_`, user_id recipient, kind of the seven, actor_id ≠ user_id by CHECK, post_id, comment_id, recipe_id, created_at, read_at); indexes `(user_id, created_at)`, unread partial `(user_id, created_at) WHERE read_at IS NULL`, `(post_id, kind)`.

**Routes** (all signed in; refusals on pinned codes with `details.reason` from `KITCHEN_POSTS_ERROR_REASONS` / CM-2's reasons):
- `POST /v1/kitchen/me/posts` `{ dishId, caption?, audience, show?: { size?, time?, ate?, steps? } }` → 201 `{ post }`. Another person's dish (or none): 404. A group dish not finalized, or a canceled dish: 409 `not_postable`. A dish with a live post: 409 `already_posted` + `details.postId`. Beyond `me` without a profile: 403 `no_profile`. Missing `show` keys are false.
- `PATCH /v1/kitchen/me/posts/{pst}` `{ caption?, audience?, show? }` → `{ post }` (stats recomputed from the dish when `show` changes; `editedAt` set). `DELETE` → `{ deleted: true, restoreUntil }` (soft). `POST /v1/kitchen/me/posts/{pst}/restore` within 10 min → `{ post }`; after that, or never deleted: 409 `not_restorable`; the dish shared again since: 409 `already_posted`.
- `GET /v1/kitchen/posts/{pst}` → `{ post }`. `CommunityPost` = `{ id, author: CommunityProfile|null, title, caption, audience, show, stats, recipe: { id, name, linkCode }|null, yums: { count, mine, names }, comments: { count }, stepCompare?: { usualMinutes, cooks }, mine, createdAt, editedAt }`. Stats: `size { factorMilli|null, main { name, qtyMilli, unit }|null, portionsHalf }`, `minutes`, `ate`, `steps { done, total }`.
- `GET /v1/kitchen/me/feed?tab=following|discover&cursor=` → `{ tab, posts, nextCursor }` (20 a page). `GET /v1/kitchen/profiles/{handle}/posts?cursor=` → `{ posts, nextCursor }`; 403 `private` unless `canSee`.
- `POST|DELETE /v1/kitchen/posts/{pst}/yum` → `{ yums: { count, mine } }` (201 when new). `GET /v1/kitchen/posts/{pst}/comments?cursor=` → `{ comments, count, nextCursor }` (oldest first, 30 a page); `POST` `{ body }` → 201 `{ comment }` (`PostComment` = `{ id, postId, author, body, createdAt, mine, canRemove }`); 429 `rate_limited` `comment_limit` past 30 an hour. `DELETE /v1/kitchen/comments/{cmt}` → `{ removed: true }` for its author or the post's author, else the opaque 404.
- `POST /v1/kitchen/reports` `{ targetKind, targetId, reason, note? }` → 201 `{ report: { id, targetKind, targetId, reason, createdAt } }`, 200 with the first report on a repeat; a target the reporter can't see (or across a block): 404; oneself: 422 `self`. The report and its audit event `kitchen.report.created` (subject `kitchen_report`, under the system organization) are one batch.
- `GET /v1/kitchen/me/activity?cursor=` → `{ requests: { count, people (≤3) }, items, nextCursor }` (30 a page). `ActivityItem` = `{ id (act_… or yum_<pst hex>), kind, at, unread, actor, actors, others, post: { id, title }|null, comment: { id, body }|null, recipe: { id, name }|null }`. `POST /v1/kitchen/me/activity/read` `{ before }` → `{ marked }`. `GET /v1/kitchen/me/activity/unread` → `{ count }`.

**Visibility** is one SQL predicate, `visiblePostSql` (storage), carried by the post read, profile posts, comments, Yum, reports and Activity's post titles: live, and the author's — or, with no block either way, not `me` and either an accepted follow or a public post by a public profile. Following adds "not muted"; Discover is public posts by public profiles the viewer doesn't follow (accepted), not their own, in 14 days, without a post or author profile with ≥3 open reports (one report per reporter, so different people). Discover reads candidates newest first in batches of 100 and ranks them in the worker by `created_at + discoverBoostMs(yums)`; it stops reading once 20 rank above the oldest read + 24 h (no SQL `log2`, which D1 may not have). Its cursor is the last rank and id.

**Activity** rows are the same batch as their event, through `activityStatement` (refuses oneself and a block either way): `followed`/`follow_request` with CM-2's follow insert, `follow_accepted` with the accept, `yum` and `comment` on the post's author, `cooked_yours` with the post (or the PATCH that first takes it beyond Just me — once per post), `saved_yours` with RC's copy write (only while the source is public and the copier has a profile). A Yum taken back deletes its row; a removed comment deletes its row; rows about a deleted post, and from people with a block, are left out on read. Yums on one post are one item (latest 3 named, `others` counted).

**Pushes:** `kitchen.followed`, `kitchen.follow_request`, `kitchen.commented`, `kitchen.yum` and `kitchen.cooked_yours` join `NOTIFICATION_KINDS` and `KITCHEN_EMAILS`, and are `PUSH_ONLY_KINDS`: kitchen-worker enqueues them on the preference path (system organization, tagged with the recipient, address from identity only because an enqueue needs one), notifications-worker records the email as suppressed (`push_only`) whatever the preferences say and pushes it beside — opt-in, as every kind. Copy per design §2 (`templates/push.ts`; a comment is quoted to 40 characters). They are sent through `ctx.defer` after the write, only when its Activity row was written; a failed push never fails the write. A Yum pushes only when it claims the post's `yum_pushed_at` slot (NULL or ≥1 h old) in its own batch.

**Seams filled:** `counts.posts` (every live post for yourself; others' live posts but Just me), suggestions' `fromRecipes` adds "Cooked your …" (people whose posts wrote you `cooked_yours`), and CM-2's follow handlers write Activity and push.

**Departures and additions**
- `kitchen_posts.yum_pushed_at` (not in the design) holds the hourly Yum push exactly, in one statement.
- One post per dish is a partial UNIQUE over **live** posts, so a dish whose post was deleted can be posted again; restore refuses when a new post exists.
- The linked recipe is the dish's recipe when public (or Cookpool's), else the **public source** of the cook's own copy; reads show the link only while that recipe is still public and live. `cooked_yours` goes to the linked recipe's owner, or (for the cook's own public copy) its source owner; never Cookpool, never the cook; never for a Just me post.
- Yum and comments need a profile (403 `no_profile`): names outside groups come only from profiles. Reports don't.
- Follow requests aren't Activity items; they are `requests`. Unread counts a post's Yums once and a request only while it waits. Accepting a request writes no push (none of the five kinds).
- Stats: `ate` is the dish's share count (1 for a Just me dish); `steps.total` counts the recipe's **cook** steps (prep is never logged); `minutes` and `steps` appear only with a step log. `show` on a read is the stats present, so a chosen stat that couldn't be computed reads as not chosen.
- `stepCompare` is cheap: one query over the reader's own step times under the post dish's recipe root **at the same factor** (no rule scaling), median of their per-dish totals; only on the single post read, never in lists.
- The SDK names the Activity read `communityActivity` (`activity` is a group's ledger activity); everything else as listed.
- Discover shows no Cookpool recipe cards; the console can use Explore `source=cookpool` (risks CM-D). A follow-up if wanted.
- `FollowInput.activityId` and `acceptFollow`'s `activityId` are optional (a fresh UUID otherwise), so CM-2's storage callers keep working.

**Tests**
- `tests/kitchen-worker`: `community-posts.test.ts` (15: who posts and when, one per dish, no profile → Just me, 422s, the stats computed and whitelisted, **no price, group id or member list in the post, either feed, profile posts or the row**, the table CHECK, linking, stepCompare, PATCH, soft delete and restore), `community-feed.test.ts` (13: every audience, a private author, blocks both ways across post/feeds/profile/comments/Yum, mutes, profile posts and counts, Following order and paging, Discover's window, boost and cap, paging, reading past 100 candidates, report hiding), `community-reactions.test.ts` (12: Yum, names, comments, paging, limits, removal rights, blocks, reports and their audit), `community-activity.test.ts` (14: each kind, cooked_yours via a copy and directly, once on widening, saved_yours rules, nothing across a block, grouping, unread/read, paging, pushes incl. the hourly Yum cap and a failing enqueue, the seams). Whole suite: 42 suites, 916 tests.
- `tests/db`: `kitchen-posts-migration.test.ts` (8). Whole suite: 34 suites, 865 tests (checksums included).
- `tests/notifications-worker`: push-only enqueue (email suppressed even when turned on, pushed beside), the five push bodies, push per kind on/off. Whole suite: 154 tests.
- `tests/contracts`: `kitchen-posts.test.ts` (3) and the kinds pins updated on purpose (`NOTIFICATION_KINDS`, `KITCHEN_EMAILS`, `PUSH_ONLY_KINDS`). Whole suite: 29 suites, 297 tests.
- `packages/sdk`: `kitchen-posts.test.ts` (6). Whole suite: 208 tests. `tests/api-edge`: the facade's route cases gain the new paths (598).

**Deploy:** kitchen-worker and notifications-worker change their own files, so both plan; the migration directory plans `db-migrate`. Migration 440 must apply before this kitchen-worker serves — follows now write `kitchen_activity` — which kitchen-worker's enforced `db-migrate` edge orders. notifications-worker should deploy before (or with) kitchen-worker: an older notifications-worker would try to email a social kind (no template, a bounded send failure, no push). The console picks up the contracts and SDK only when its own files change (CM-6).

### CM2 — The feed, sharing, posts and activity in the app (CM-6)

**Built** (web-console-next, new frame only; design §4, the canvas row "Community": `CommunityFeed`, `ShareCook`, `PostDetail`, `CommunityActivity`). Pure models: `components/kitchen/community-posts.ts` (the feed tabs and empty states, the post card — who/when/for whom, stat tiles, recipe line, RC tile colours — Cook this, Yum, the Yum names, the step compare, comment rights and words, the ⋯ items, and every cache patch: Yum, a new/replaced/removed post, comments added/saved/removed, a muted or blocked author), `community-share.ts` (when Share is offered, Finish's landing, the step seed, the composer's preview, defaults, audiences, the request, toasts, refusals, the dish→post memory) and `community-activity.ts` (the bell, Activity's lines and day groups, mark-read, the report reasons and request). Reads and writes in `community-posts-data.ts`; drawn parts in `community-post-views.tsx`; screens in `community-feed-ui.tsx` (the feed, post lists, Cook this, a profile's Cooks), `community-post-ui.tsx` (`/p/[postId]`), `community-activity-ui.tsx` (`/community/activity`), `community-share-ui.tsx` (Share this cook?, the dish page's Share) and `community-report-ui.tsx` (the report sheet, a post's ⋯). No SDK change: CM-3's methods cover it (`communityActivity`, `markActivityRead`, `unreadActivity`, …). No new route: CM-5 laid every page.

**Query keys** (all under `kitchenCommunity`, so CM-5's follow/block/mute refresh them): `kitchenFeed(tab)`, `kitchenPost(id)`, `kitchenPostComments(id)`, `kitchenProfilePosts(handle)`, `kitchenCommunityActivity()` (`kitchenActivity` was taken by a group's ledger), `kitchenUnreadActivity()`. The feeds, comments, a profile's posts and Activity are infinite queries (cursor pages).

**Screens**
- **Share this cook?** — a tall bottom sheet over the dish page: "✓ Posted to Flat 4B · 4 ate" / "✓ Cooked · just you", the title, a disabled photo slot "Photos coming soon" (CM-4's seam), the dish name and recipe line ("Your recipe · cooked at 450 g", else the portions), SAY SOMETHING, WHAT IT SHOWS (Size, Time, How many ate, Steps done; previewed from the dish, its recipe's main line at the cooked factor, and the session's step log — "if timed" when the app doesn't know), "Never shown: prices, balances, your groups, who owes whom.", WHO SEES IT (Followers "12 people" · Public "anyone" · Just me "your profile"; a private profile's Public reads "Followers only — your profile is private"; without a profile only Just me and "Pick a handle to share" → `/you/profile`), Not now · Post ("Save to profile" for Just me). Post sends `{ dishId, caption?, audience, show }` (flags only), closes at once with "Posted · your 12 followers see it · Undo" (Undo deletes the post), puts it first in Following and on your profile; `already_posted` opens that post. The sheet doesn't focus the caption (no keyboard on open).
- **Where it opens**: RC-6's Finish and GC-5's Who ate both go to `afterFinishHref(dish, newFrame())` — `/dishes/<id>?share=1` when the dish can be posted now (a Just me dish), else the dish page as before; the session's step times go to sessionStorage (`cookpool.share.steps.<dsh>`) for the preview. On the dish page: `?share=1` opens it (and leaves the address); the cook's **Finalize** opens it once the dish is final; **Share this cook** (or **See your post**, once this browser knows the post) sits under Save as recipe for your own postable dish.
- **`/community`**: CM-5's placeholder is now Following · Discover (`?tab=`, links that replace), post cards, the next page read 600 px before the end (and a More button), "Follow cooks to see their cooks here" + Find cooks, Discover's "Nothing public this fortnight". The bell shows the unread count ("9+" past nine; read every minute while shown, only with a profile).
- **The post card**: face/name → `/u/<handle>`, "@anucooks · 2 h · Followers", ⋯, the hero (RC's tile colours by the recipe's id; the photo later) with the title and recipe line → the post, up to four stat tiles, the caption, Yum (instant toggle with the count), comments count → the post, Cook this (your own recipe opens; else RC's copy with its Undo toast, then opens the copy; "Saved ✓" opening your copy after).
- **`/p/[postId]`**: Back, author, ⋯; the hero, tiles, caption; "Steps took Anu 48 min · yours usually 55 min" (from `stepCompare`, someone else's post only) with Cook this; Yum and "You, Dev, Meera and 10 others"; COMMENTS · n oldest first with More comments; "Hold a comment to report it. Anu can remove any comment on their post."; a comment box held above the tab bar (Send; `comment_limit` → "That's 30 comments this hour. Try again later."; without a profile "Pick a handle to comment"). Each comment's ⋯ (or a long press, or right-click) opens Remove (its author or the post's author) and Report (anyone else's). The post's ⋯: Report this post · Mute Anu's posts · Block @anucooks (with the block note) on others'; Who sees it (the three audiences, PATCH with Undo) · Delete post (Undo restores it, within the server's 10 minutes) on yours.
- **Reports**: one sheet for posts, comments and profiles — Spam · Abuse · Unsafe · Something else, an optional note (≤300), Report; "Reported · They aren't told who reported it." CM-5's profile ⋯ gains **Report @handle**.
- **`/community/activity`**: WANTS TO FOLLOW YOU (the newest requests, No · Accept with CM-5's writes; "and 2 more · on You"), then Today · This week · Earlier, each line "**Meera and 11 others** said Yum to your Rajma" with when, an icon and a dot while unread, opening its post (Yum, comment, cooked yours), the recipe (saved yours) or the person (followed, accepted). Opening it marks everything up to the newest item read (`markActivityRead`); the bell goes to 0 at once. The canvas's note about pushes closes it.
- **Profile**: `PROFILE_DEFAULT_LIST` is now **cooks**: the bare `/u/<handle>` is Cooks (their posts from `profilePosts`, as cards), Recipes is `?list=recipes`.
- **Notifications**: `PUSH_ROWS` gains New followers · Follow requests · Comments · Yums · Cooked your recipe (each `newFrameOnly`); `pushRows(newFrame())` lists them only in the new frame, so today's screen keeps its three.
- **Writes** (SM-5): Yum (instant, refusal rolls back), comment send (shown at once as "sending", replaced by the server's), comment removal (off at once with Undo; the DELETE goes when the Undo has gone or on pagehide — the server has no restore), delete post (Undo = restore), audience (Undo = PATCH back), Post (Undo = delete), mute/block from a post (CM-5's writes, and the author's posts leave the feeds at once).

**Departures**
- **A group dish is offered Share after Finalize, not right after Who ate.** CM-3's server posts a group dish only once it's finalized (`not_postable` before), and RC-6's Who ate leaves it open for claims. So after Who ate on a group dish the cook lands on the dish page as before, and Share this cook? opens when they tap Finalize (and the dish page's Share is there from then on). A Just me dish gets it straight after Finish. Finalizing for the cook from the share sheet would move money from a social screen, so it isn't offered.
- **"Not yet posted" is remembered by this browser** (`localStorage cookpool.community.sharedPosts`, dish → post): the dish read doesn't say whether a dish was posted. Elsewhere Share still shows; Post then answers `already_posted` and the post opens (and is remembered).
- **The composer's values are a preview**: size and how many ate from the dish (and its recipe's main line), time and steps from the finished session's step log in this tab. Sharing later from another device shows "if timed" for Time/Steps; the server computes what it has.
- **The recipe line** says "Your recipe" (a recipe of yours) or "With the recipe": the post's recipe carries no owner, so the canvas's "Cookpool recipe" / "His own recipe · saved by 41" aren't drawn.
- **Yum has no toast**: the toggle is its own undo. **Reports have no Undo** (they are only stored).
- **Comment removal's Undo holds the DELETE for 10 s** (the server has no restore); closing the page sends it.
- **Pull to refresh**: `/community` and `/community/activity` pull (lists you read, PW-7's rule); `/p/[postId]` doesn't (its comment box), nor `/u/[handle]` (CM-5's choice).
- **Push rows are frame-gated** (`newFrameOnly` + `pushRows`), not just appended, so today's frame lists exactly what it did.
- **Discover shows no Cookpool recipe cards** (CM-3 sends none; Explore's Cookpool source covers it).

**Tests** (`tests/web-console-next`)
- `kitchen-community-posts.test.ts` (28): the feed tabs, empty states and pull; the card (who/when/audience words, tiles, recipe line, tile, caption, Yum), Cook this's four states, the card drawn; Yum toggle and its patch across the feed pages, the post and profile posts; Yum names; the step compare; comment rights, body and refusals; comment add/save/remove patches with counts; new post first in Following and on your profile, removal, mute and block patches; the ⋯ items; Share's offer rules and Finish's landing; composer defaults, preview, rows and top line; audiences (public, private, no profile); the request carrying only `show` flags; toasts and refusals (`already_posted` opens); the step seed and the shared-posts memory; report reasons, titles and request; Activity's lines, who, day groups, mark-read, "and 2 more"; the bell's badge and label drawn; push rows by frame; newFrame false (Finish to the dish, no Share, three push rows).
- Changed on purpose: `notify.test.ts` (today's three via `pushRows(false)`; the eight in the new frame; `kindsOn` now covers the five), `gestures.test.ts` (`/community` and `/community/activity` pull), `kitchen-community.test.ts` (the profile's default list is Cooks).
- Whole suite: 100 suites, 2017 tests. `typecheck` and `lint` clean for `@saas/web-console-next` and `@saas/web-console-next-tests`. `console-artifact.mjs build`: 38 pages served as files, 17 `_redirects` rules (unchanged).

**Browser check** (390 × 844, `next dev` behind the SM-2 proxy with CM-5's in-page mock plus a CM-6 overlay for posts, feeds, Yum, comments, reports, Activity and copies; the network log showed no request to any workers.dev host; the mock was never committed):
- A blank cook session "Paneer butter masala" with Paneer ticked, Post to Just me → the dish page with Share this cook? open: "✓ Cooked · just you", "Photos coming soon", "1 portion", Size and How many ate on, Time and Steps "if timed" off, the never-shown line, Followers "2 people" · Public "Followers only — your profile is private" · Just me. Caption typed, Post → "Posted · your 2 followers see it · Undo"; the dish page then read **See your post**.
- `/community` Following: my post first ("@rahulcooks · now · Followers", tiles 1 portion / 1 ate, the caption), then Anu's Chicken curry (450 g · 48 min · 3 · 9/9, Cook this). The bell read 5. Yum on Anu's → "Yum · 13" warm at once. Discover: Sam's Besan ladoo.
- Anu's post: "Steps took Anu 48 min · yours usually 55 min", "You, Dev, Meera and 10 others", 2 comments. Sent "Making this Sunday!" → "You · now", Comments · 3. ⋯ → Remove comment → "Comment removed · Undo" above the box; Undo brought it back and no DELETE was sent. Dev's comment ⋯ → Report comment → Spam → one `POST /v1/kitchen/reports` with `{ targetKind: "comment", targetId, reason: "spam" }`. The post's ⋯: Report this post · Mute Anu's posts · Block @anucooks with the note.
- Cook this → the copy opened ("from Anu", "Saved Chicken curry · Undo"); back on the post it read **Saved ✓**, linking the copy.
- Activity: WANTS TO FOLLOW YOU (Priya, Sam with No · Accept), Today (Dev cooked your Dal tadka; Meera and 11 others said Yum to your Rajma; Anu commented: "Roast the spices first next time, trust…"), This week (Sam started following you), Earlier (Dev saved your Dal tadka), the push note. Accept took Priya off; back on Community the bell had no count.
- `/u/anucooks` opened on Cooks with her post as a card (Saved ✓ there too).
- `/you/notifications` under the mock reads "Notifications aren't available yet" (no VAPID key), so the switches weren't drawn; the rows are unit-tested.
- Today's frame (`cookpool-prod.localhost`): `/community` went to `/home` and no post, feed or Activity route was asked.

**Deploy:** console files only; it needs CM-3's kitchen-worker (main as #93, deployed) — without it the feed, post and Activity reads are 404s and show their errors.

### CM2 — Cooked, then post or split, in the server (CM-8)

**Built** (kitchen-worker; design §2a, the owner's "posting and splitting are two different features"). Contracts in `packages/contracts/src/kitchen-split-later.ts` (re-exported from `@saas/contracts/kitchen`; `KitchenDish.splitAt?` and `InboxResponse.splitReminders?` added in `kitchen.ts`); storage in `packages/db/src/kitchen/split-later.ts` (spread into `KitchenRepository`; `dishes.ts` now exports `DISH_COLUMNS` and `dishesWithParts`, and every dish read carries `splitAt`); the handler in `apps/kitchen-worker/src/handlers/dish-split-later.ts`, the reminder's pure rules in `src/split-later.ts`, three routes in `router.ts` beside the cook's dish routes. api-edge forwards `/v1/kitchen/…` already: no edge change.

**Finishing without a group** already worked and is unchanged: `POST /v1/kitchen/me/dishes` with `orgId: null` (`splitMode: "assign"`) takes ingredients from any pantry the cook may use, charges each group item to the cook as a `use` in its group, and posts no dish transaction. No money code changed.

**Migration 460** `460_kitchen_split_later`: `kitchen_dishes.split_at` (TEXT, `CHECK (split_at IS NULL OR org_id IS NOT NULL)`) and `kitchen_dishes.split_dismissed_at` (TEXT). Both nullable, no default, no new index (the reminder reads through `kitchen_dishes_cook_idx`).

**Routes** (all signed in; refusals on pinned codes with `details.reason`):
- `POST /v1/kitchen/me/dishes/{dsh}/split` `{ orgId, splitMode?: "claims" | "assign" }` (default `claims`) → 200 `{ dish }`, the dish as a dish cooked into that group stands: `open` for claims (or a `draft` for the cook's shares), `orgId` set, `splitAt` now, `finalizedAt` null, money as cooked. One batch: the group's currency pinned to the dish's (as cooking in would), the guarded dish update (cook, no group, `draft` or `finalized`, at the version read, no `txn_id`/`leftover_item_id`, the group's currency — else the batch fails), and `kitchen.dish.split` (subject `kitchen_dish`, in that group only; payload dishId, name, cook, shared, portionsHalf, splitMode, totalMinor, currency, cookedAt). After the commit, `kitchen.dish_posted` emails the group as a dish cooked for claims does. A dish that changed in between (marked finalized) is read again and split once more; a second loss is 409 `stale`. Refusals, nothing written: another person's dish or none → 404; a group the cook isn't in, or where `kitchen.dish.cook` is denied (a viewer) → 404; a dish with a group (cooked in, or split before) → 409 `already_split` + `details.orgId`; canceled → 409 `dish_not_open` + `state`; a group whose settings count in another currency → 422 `currency_mismatch` + `currency`; a bad body → 422 with `orgId` / `splitMode`.
- `POST /v1/kitchen/me/dishes/{dsh}/split-reminder/dismiss` → `{ dishId, dismissed: true, dismissedAt }`; `POST …/split-reminder/restore` (Undo) → `{ dishId, dismissed: false, dismissedAt: null }`. The cook's dishes only (404 otherwise). Splitting clears it.
- `GET /v1/kitchen/me/inbox` gains `splitReminders: SplitReminderInboxItem[]` — `{ kind: "split_reminder", dish: { id, name, portionsHalf, totalMinor, currency, cookedAt, state: draft|finalized, groupItems }, suggest: { orgId, groupName, groupSlug, why: used_items|recent } }`, newest first, at most 10: the caller's own dishes with no group, not canceled, not dismissed, cooked in the last 7 days (`SPLIT_REMINDER_DAYS`), that took a group item or have ≥ 4 half portions (`SPLIT_REMINDER_MIN_PORTIONS_HALF`, two servings). The group: among the ones the cook cooks in (not viewer) that count in the dish's currency or have none yet, the one it took most from by cost (then item count, then name); else the group of their latest non-canceled group dish; else their first by name. No such group, no reminder.
- Posting (CM-3's rule, relaxed on purpose): `POST /v1/kitchen/me/posts` takes any of the cook's dishes but a canceled one (409 `not_postable` only then), before or after a split, open or finalized. `stats.ate` is the dish's **servings**, `max(1, ceil(portionsHalf / 2))`, not its shares.

**SDK:** `splitDish(dishId, { orgId, splitMode? })`, `dismissSplitReminder(dishId)`, `restoreSplitReminder(dishId)`; the types and constants re-exported (`SplitReminderInboxItem`, `KITCHEN_SPLIT_ERROR_REASONS`, `SPLIT_REMINDER_*`, …).

**Departures and additions**
- **The reminder is its own list, `splitReminders`, not an `items` kind**, as PN-8's `asks` is, and `counts` leaves it out. Today's console switches over `items`, and today's frame must render exactly what it does now; a new kind in `items` would also have changed `counts.total`. CM-9 reads `splitReminders`.
- **A "just me" dish its cook marked finalized can be split** and is reminded about: that finalize posted nothing (no transaction, no leftovers), so the split opens it again (`finalized_at` cleared). Only a dish with a dish transaction or leftovers is refused, which a dish with no group never has.
- **The `finalize_dish` card for a just-me draft is unchanged** (the server is additive), so such a dish shows that card in `items` and a reminder in `splitReminders`. CM-9 should drop "Finalize · Just for you" in the new frame, or hide it where a reminder exists, so Home shows one row.
- **Restore** (the dismissal's Undo) is a route of its own, not in the brief.
- **`ate` rounds up** to whole servings (1½ portions serve 2, ½ serves 1), so the stat stays a whole number.
- **The suggestion's "most recent group"** is the group of the cook's latest dish there (cooked in or split), else their first by name. Membership has no join time to read.
- The split checks the group's currency up front (422) and again in the batch's guard, and pins it the way cooking does. A group with no settings yet takes the dish's currency.
- `KitchenPostSource.shares` is still read and is no longer used for `ate` (documented, not removed).

**Tests**
- `tests/kitchen-worker`:
  - `split-later.test.ts` (16):
    - finishing without a group: uses charged per group, no dish transaction, the dish no one else's;
    - split later → claims → finalize posts the same dish transaction (title, total, currency, splits, creator), the same Flat 4B and Lunch club balances, and the same dish state, amounts and netting as the worked example cooked into the group (two harnesses, compared; design §3's numbers to the paisa);
    - nothing moves before finalize;
    - the split answer, the group's reads, the dish-posted email and the single audit event;
    - assign mode;
    - a marked-finalized just-me dish;
    - cancel after a split;
    - every refusal writes nothing: 404 ×3, `already_split` both ways, `dish_not_open`, 404 non-member/unknown/viewer, `currency_mismatch`, 422 fields;
    - the race read again (version 3, one event);
    - posting before a split (and the post kept), while open, once finalized, `ate` = servings (3, 2 for 1½, 4 with 2 eaters), and never a canceled dish.
  - `split-reminders.test.ts` (14):
    - group items at any size and the most-by-cost group;
    - newest first;
    - two servings or more, not 1 or 1½;
    - recent then first-by-name, and recent after a split;
    - the 7-day edge;
    - no group, viewer only, or another currency;
    - never others' or grouped dishes, and gone after a split;
    - a marked-finalized dish stays, a canceled one goes;
    - items and counts unchanged;
    - dismiss/restore and split after a dismissal;
    - 404s;
    - 401/405;
    - `suggestGroup` ties and fallbacks, and `servingsOf`.
  - Changed on purpose:
    - `community-posts.test.ts`: a group dish still open now posts (201); `ate` is 4 servings where it was 2 shares or 1.
    - `inbox.test.ts`: the empty inbox carries `splitReminders: []`; the bounded-reads count is 17 (+4: the unsplit list, its ingredients and shares, the latest group) and 18 with a third group.
  - Whole suite: 44 suites, 946 tests.
- `tests/db`: `kitchen-split-later-migration.test.ts` (7): registration and order, the text (two columns, nothing else), the CHECK, the split batch, every refusal writing nothing (including the pinned currency and the event), the unsplit list's filters and order, dismiss and Undo, the latest group. Whole suite: 35 suites, 873 tests (checksums included).
- `tests/contracts`: `kitchen-split-later.test.ts` (3). Whole suite: 30 suites, 300 tests.
- `packages/sdk`: `kitchen-split-later.test.ts` (4). Whole suite: 212 tests.
- `tests/api-edge`: the facade's route cases gain the three paths (601).
- `typecheck` and `lint` are clean for `@saas/db`, `@saas/contracts`, `@saas/sdk`, `@saas/kitchen-worker` and the four test packages, and `@saas/web-console-next` (+ tests) still typechecks.

**Deploy**
- Migration 460 must apply before this kitchen-worker serves: every dish read now selects `split_at`. kitchen-worker's enforced `db-migrate` edge orders that, and the migration directory plans `db-migrate`.
- kitchen-worker changes its own files, so it plans. The contracts and SDK reach the console only with CM-9.
- 450 (CM-4) may land after 460. The runner applies each id not yet applied, and the manifest stays sorted by id.
