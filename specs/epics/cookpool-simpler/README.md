# Epic: cookpool-simpler (SM)

**Cookpool works, but it is slow and it talks too much. Every page is rendered on the server per visit (1.4–2.6 s from India), the database sits far from the people using it, and a tap waits for the server before anything changes. Home is 541 words long; most screens explain themselves in sentences, use ledger words like "netting", and offer the same action twice. This epic makes Cookpool fast first: pages served as files from the edge, the API on the app's own address, the database moved near its people, and every action shown at once with Undo. Then it makes Cookpool simple: one main button per screen, numbers instead of sentences, faces for people. Anyone can log for anyone, a dish's portions included. Adding food or cooking again starts from what you did before.**

It is for the same people as before — flatmates on phones — and the bar is "a tap feels instant and a screen reads at a glance".

## Status

| Field | Value |
|-------|-------|
| Status | ✅ Shipped 2026-11-07 |
| Cluster | **SM** (SM0–SM6) |
| Owner(s) | `apps/web-console-next` (pages, screens, instant UI) · `apps/api-edge` (the API on the app's address) · `infra/terraform/cloudflare-d1` + every worker's placement (the database near its people) · `apps/kitchen-worker` + `packages/db` (portions for anyone, "from before") |
| Builds on | `cookpool-kitchen` and `cookpool-sign-in`, on the new Cloudflare account (SI-10) at `cookpool.store` (SI-8, SI-12) |
| Changes | Pages become static files with data loaded in the browser. The API answers at `cookpool.store/api`. The D1 database is recreated in Asia–Pacific and the workers that use it run next to it. Writes show at once with Undo. Any member sets any member's dish portion. Adding food and cooking suggest what you did before. Every phone screen follows seven rules (design.md §4). |
| Decisions locked | (1) **Speed before looks**: SM1 lands before any screen changes. (2) **Budgets**: a page's first byte under 0.3 s and a read under 0.4 s at the 75th percentile from India; a write shows in the UI within one frame. (3) **The database restarts empty** when it moves (stage and prod hold only test data on 2026-11-04). (4) **Anyone can set anyone's portion**; the row says who set it and that person is emailed. (5) **"From before" fills everything and you change what differs**. (6) **The seven rules** in design.md §4 apply to every screen, with the design canvas as the reference. |
| Design | Claude Design canvas, rows "Simpler — less to read, one tap" and "Use it your way — measures": https://claude.ai/artifact/TwmkN2cAmebQPkL2QEQZVv (Home, Use, Dish, + Add, Pantry, Bought from before, Cook again). The phone audit behind it: `ux-audit.md`. |
| Gate | SM1 is the change people feel first. SM4 is the first day the app reads at a glance. |
| Shipped as | SM0 #36 · SM1 #37 #38 #41 #43 · SM2 #39 #44 · SM3 #40 #42 · SM6 #46 #49 · SM4 #47 · SM5 #51 #53 · close SM-12. Pages are files from the edge, the API on the app's own address, the database in Asia–Pacific, writes that show at once with Undo; anyone sets anyone's portion; Bought and Cook start from before; items count in their own measures; every screen under the seven rules. |

## Read order

1. `design.md` — the speed plan with its measurements, portions for anyone, "from before", the seven rules and the screens
2. `implementation-plan.md` — the milestones, their tasks, and what "done" means for each
3. `risks-and-open-questions.md`
4. `ux-audit.md` — the phone audit (2026-11-04) the design answers
5. `IMPLEMENTATION-STATUS.md` — what actually shipped

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| SM0 — the spec | this doc set and the canvas row | merged; SM-1 reads done |
| SM1 — fast | static pages, the API at `cookpool.store/api`, the database in Asia–Pacific with workers placed by it, instant writes with Undo, a timing check | budgets met from India on stage and prod |
| SM2 — for anyone | any member sets any member's portion, "by Anu" and an email; the Log button names who it is for | Anu sets Dev's portion, Dev is emailed and can change it |
| SM3 — from before | type-ahead from past items when buying; cook again from a past dish | buying milk again takes two taps |
| SM6 — your measures | each item counted its own way (1 onion ≈ 150 g, 20 slices a pack), asked once per pantry; uses keep their words | onions bought by the kilo are used as "1 onion" |
| SM4 — simpler screens | Home, Use, + Add, Dish, Pantry as designed; the audit's phone bugs | Home fits one screen; no screen has an explainer paragraph |
| SM5 — the rest | Groups, People with Settle, Item, Bill, Add item, Cook, the desktop pages | every screen follows the seven rules |

## After this epic

What the tasks reported and left, for a later epic or a small fix:

- **Type sizes** — the audit's Top 15 item 15 asks for 4 type sizes instead of 8; the rebuilt screens use about 5. A visual-identity change, out of this epic's scope (design §7).
- **Back icons** are mixed: an arrow on Use, a group, Settings, Bill and a person; a chevron on the item page, Bought, Cook, a dish and You. Pick one.
- **Home's use-soon to-do** can't offer an item's measure: the inbox's `use_soon` item carries no `measures` (a server read change).
- **Dead code** left with its tests: `pantryChoice` / `pantryPickerList`, `debtsBehind`, `useAllActivity`, `useUseSoonItems`, `soonStrip` / `HOME_USE_SOON`.
- **Timing from India** — SM1's budgets were measured from Asian Cloudflare colos, not from India (IMPLEMENTATION-STATUS, "SM1 — the exit check").
- **A member who left a group but still holds a dish share** can't have it changed to 0 by anyone but the cook (SM-6, 422 `not_in_group`).
- **The old databases** `cookpool-stage` / `cookpool-prod` (no location hint) are unmanaged since SM-3; the owner deletes them in the Cloudflare dashboard once their metrics show no queries.

