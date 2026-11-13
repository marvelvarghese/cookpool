# Epic: tripeco (TR)

**A shared drive has a cost nobody wants to work out: the kilometres, the car's real mileage, today's fuel price, the toll. Tripeco works it out from two odometer photos — one at the start, one at the end, or a single end photo after a Trip A reset — and posts everyone's share into a Spliteco group as one locked row. It keeps your vehicles and your fuel log, and learns each car's real mileage from full-tank fill-ups. It has no ledger and no groups of its own: balances, reminders and settling up stay in Spliteco, on the same account.**

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped (2026-11-13) — verified signed in on stage (IMPLEMENTATION-STATUS) |
| Cluster | **TR** (TR0–TR7) |
| Owner(s) | **The drive API:** a new `apps/tripeco-worker` behind `apps/api-edge` at `/v1/tripeco`. **The money:** `apps/spliteco-worker` (a ride posts through it as a locked expense). **The reading:** `apps/kitchen-worker`'s AI runner (the receipt reader's path) reads odometers. **The app:** a new `apps/tripeco-web`. **The gestures:** a new `packages/gestures`, moved out of `apps/spliteco-web`. **The wire:** `packages/contracts`, `packages/sdk`. **Sign-in:** `apps/identity-worker` (origins only). |
| Builds on | `cookpool-spliteco` (EP-13: the ledger, groups, the handoff code, receipt scan); `spliteco-calm` (EP-15: the gestures, the calm look); `cookpool-ai` (the AI runner and its daily caps). |
| Changes | Adds an app, a worker, a package and one migration (610). Spliteco gains a ride row (car mark, lock, proof photos, Edit in Tripeco). Nothing in Cookpool changes. |
| Decisions locked | (1) **No ledger in Tripeco:** a posted ride is a Spliteco expense; balances and settling up live only there. (2) **No groups of its own:** Tripeco lists your Spliteco groups. (3) **Odometer, not GPS.** (4) **Mileage is learned** from full-tank fill-ups; the car's display figure is a choice per ride. (5) **Personal fuel never leaves Tripeco.** (6) **One account** with Spliteco and Cookpool. |
| Design | Claude Design canvas: https://claude.ai/artifact/84RAnUdxVzyQnVXj5AUBzC (12 phone boards, Asphalt & lime) |
| Needs from the owner | Nothing to start. Later, a custom domain for the app. |
| Cost | No new paid service. Odometer reading uses the existing `ANTHROPIC_API_KEY` and counts against the receipt cap. Photos are kept in D1 (§6). |
| Gate | TR5 is the day you can drive, post and see the ride in Spliteco. |
| Shipped as | #169, #170, #172, #175, #178, #179, #180 and the close-out; live at https://cookpool-tripeco-web-stage.cookpool.workers.dev (prod: `-prod`) |

## Read order

1. `design.md` — the model, the routes, the app, the decisions and the alternatives rejected
2. `implementation-plan.md` — the milestones and what "done" means for each
3. `risks-and-open-questions.md` — what could go wrong and what was decided
4. `IMPLEMENTATION-STATUS.md` — what actually shipped

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| TR0 — the spec | this doc set and the eight contracts | merged |
| TR1 — vehicles, fuel, rides | migration 610, tripeco-worker at `/v1/tripeco`, learned mileage | a vehicle, a fill-up and a ride round-trip on stage, and mileage is learned from two full tanks |
| TR2 — a ride posts to Spliteco | post, undo and repost through spliteco-worker as a locked `tripeco` row | a posted ride shows in the group's balances and Spliteco refuses to edit it |
| TR3 — odometer from a photo | an odometer read on kitchen-worker's AI runner | a photo of a dashboard returns the odometer (and Trip A and average when shown), writing nothing |
| TR4 — the Tripeco app | `apps/tripeco-web`, `packages/gestures`, Sign in through Spliteco, Home · Vehicles · Groups | you sign in on stage with your Spliteco account and swipe between the three tabs |
| TR5 — drive and split | Scan, New ride, Split, Posted, Log fuel, Vehicle, Add vehicle, Groups, Group rides | a ride scanned at start and end posts its shares to a group with Undo |
| TR6 — rides in Spliteco | the car mark and lock, the ride sheet with its photos, Edit in Tripeco | a ride row in Spliteco opens its photos and Edit opens the ride in Tripeco |
| TR7 — close-out | status, what was verified on stage | merged with `IMPLEMENTATION-STATUS.md` filled |
