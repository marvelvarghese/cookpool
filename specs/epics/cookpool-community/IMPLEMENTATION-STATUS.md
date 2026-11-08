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
