# cookpool-community — implementation plan

Each task is one pull request on `orun/CM-k-<slug>`, with its contract in `tasks/CM-k.TaskContract.yaml`. Screens are behind `newFrame()` and start only after the owner approves the canvas row.

## CM0 — the spec

- **CM-1:** this doc set and the contracts for CM-2 to CM-7.

**Done when**
- merged

## CM1 — profiles and following

- **CM-2: profiles, follows, blocks and search in the server** (design §1, migration 430):
  - profiles and handles;
  - privacy;
  - follows and requests;
  - blocks and mutes;
  - search and suggestions;
  - public recipes (`listed`, `source=public`);
  - the SDK and tests.
- **CM-5: profiles and following in the app** (design §4):
  - HandleSetup at `/you/profile`;
  - the profile at `/u/[handle]`;
  - people search;
  - follow, request, accept, remove and block;
  - the You tab's counts and lists;
  - Public in the recipe share sheet.

**Done when**
- on stage, Meera picks @meeracooks and Kabir finds her by handle and follows
- with her profile private, Kabir sees only the lock until she accepts
- blocking hides them from each other in search and on profiles

## CM2 — sharing what you cooked

- **CM-3: posts, the feed, reactions, safety and activity in the server** (design §2, migration 440):
  - posts from dishes, with stats computed in the server;
  - who sees a post;
  - Following and Discover;
  - Yum and comments;
  - reports;
  - activity, including `cooked_yours`;
  - the five preference pushes;
  - the SDK and tests.
- **CM-6: the feed, sharing, posts and activity in the app** (design §4):
  - Share this cook? after Who ate and on the dish page;
  - `/community` with Following and Discover;
  - the post card and `/p/[postId]` with Yum and comments;
  - report, mute and block menus;
  - Activity with requests;
  - the notification list.

**Done when**
- on stage, Anu posts her Chicken curry to followers after Who ate
- Dev sees it in Following, says Yum, comments and taps Cook this
- Meera's Activity reads "Anu cooked your Chicken curry" and her phone gets the push when she has turned it on

## CM3 — photos

- **CM-4: photos** (design §3):
  - the R2 bucket per environment (terraform) and kitchen-worker's binding;
  - upload, serve and sweep;
  - `photo_key` and `avatar_key`;
  - the photo on Share this cook?, the post card and the profile.
  - **It needs the owner to add R2 Edit to the Cloudflare connection first.**
- **CM-7: close-out.**

**Done when**
- on stage, a post shows the photo taken after Who ate, and a profile shows its avatar

## Sequencing

- **CM-2 first:** CM-3's feed and visibility read its follows and blocks.
- **CM-3** starts when CM-2 is on main.
- **CM-5 and CM-6** start when the owner approves the canvas and their server task is on main.
- **CM-4** waits for the R2 permission.
- **CM-7** comes last.
- **Migrations:** 430 is CM-2, 440 is CM-3, and 450 is CM-4.
