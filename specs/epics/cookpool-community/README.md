# Epic: cookpool-community (CM)

**Cookpool knows what you cooked, for whom, and how long each step took. This epic lets you share that with people outside your groups, the way a workout app shares a workout: follow cooks, see what they made, cook their recipes, and hear when someone cooks yours.**
- **A public profile:** a handle, a name, a line about you, your cooks and your public recipes, followers and following. Your email never shows, and money never does.
- **Following:** follow anyone, or ask to follow a private profile. Find people from your groups, from recipes you've saved, or by @handle.
- **Share this cook?** After Who ate, one card offers a caption and which stats to show (size, time, how many ate, steps), then the audience: Followers, Public or Just me. It's never automatic.
- **The feed** lives in the Cook tab as Community: Following and Discover. Each post has Yum, comments, and Cook this, which saves the recipe.
- **"Dev cooked your Chicken curry"** reaches you when someone posts a cook of your recipe.
- **Safety from day one:** remove comments on your posts, report, mute and block.
- **Photos** come in their own milestone, once R2 storage is turned on.

## Status

| Field | Value |
|-------|-------|
| Status | Draft — design awaiting the owner's approval; the server starts first |
| Cluster | **CM** (CM0–CM3) |
| Owner(s) | **Profiles, follows, posts, reactions, safety, activity:** `apps/kitchen-worker`, `packages/db`, `packages/contracts`, `packages/sdk`. **Social pushes:** notifications-worker preference kinds. **Photos:** a new R2 bucket (`infra/terraform`), kitchen-worker. **Screens:** `apps/web-console-next`. |
| Builds on | `cookpool-recipes` (RC-4 recipes and visibility, RC copies and "saved by", RC-8 profile pages, Explore), `cookpool-guided` (step times), `cookpool-app` (PW-5/PW-6 push and preferences), `cookpool-simpler` (Undo, five tabs). |
| Decisions locked | (1) **No sixth tab.** Community lives in the Cook tab, and your profile is the You tab. (2) **A public profile needs a handle and a chosen name.** Nothing derived from the email is ever shown outside your groups. (3) **Posting is a choice each time,** with Followers as the default audience, and a post never carries money, groups or who ate. (4) **A private profile** approves each follower, and its posts reach only followers, whatever their audience. (5) **Recipes gain Public:** listed on your profile and in Discover. It's a link recipe that's also listed, so no new visibility level is needed. (6) **Blocking hides two people from each other everywhere, silently.** Muting only hides posts from your feed. (7) **Discover is newest-first** with a light Yum boost; there's no algorithm in v1. (8) **Social pushes are preferences** you can turn off, and Yums are grouped. (9) **Photos wait for R2,** which the owner turns on; posts look complete without them. (10) **Stage first,** behind `newFrame()`. |
| Design | Claude Design canvas, row "Community": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (`CommunityFeed`, `ShareCook`, `PostDetail`, `PersonProfile`, `PeopleSearch`, `CommunityActivity`, `HandleSetup`). The rules are on its sticky. |
| Gate | CM1 is the day you can follow a cook. CM2 is the day your cook reaches them. CM3 is the day it has a photo. |
| Shipped as | |

## Read order

1. `design.md`
2. `implementation-plan.md`
3. `risks-and-open-questions.md`
4. `IMPLEMENTATION-STATUS.md`

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| CM0 — the spec | this doc set and its contracts | merged |
| CM1 — profiles and following | handles and public profiles, privacy, follows and requests, blocks and mutes, people search and suggestions, public recipes; the profile, search and handle screens | on stage, Meera picks @meeracooks, Kabir finds her by handle and follows; her private profile shows him only the lock until she accepts |
| CM2 — sharing what you cooked | posts from a finished dish, the Following and Discover feeds, Yum, comments, reports, Activity, "cooked your recipe", social pushes; Share this cook?, the feed, the post and Activity screens | on stage, Anu posts her Chicken curry to followers after Who ate; Dev sees it in Following, says Yum, comments and taps Cook this; Meera's Activity reads "Anu cooked your Chicken curry" |
| CM3 — photos | an R2 bucket, uploads, a photo on a post and on a profile | on stage, a post shows the photo taken after Who ate |

## After this epic

(Filled in by the close-out task.)
