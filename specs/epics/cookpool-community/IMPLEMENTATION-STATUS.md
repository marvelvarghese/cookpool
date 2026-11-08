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
