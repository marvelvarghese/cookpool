import type { MigrationManifest } from "./types.js";

export const manifest: MigrationManifest = {
  version: 1,
  migrations: [
    {
      id: "000_control_baseline",
      context: "control",
      path: "000_control/up.sql",
      checksum:
        "c7f11499fa82d6fd2baa1af7fc75eeb73cd7be252af2e56841509c66001d638b",
      description:
        "Baseline control migration — creates the migration tracking schema",
    },
    {
      id: "010_identity_core",
      context: "identity",
      path: "010_identity_core/up.sql",
      checksum:
        "e8275904e2c60c42c6c977c208acd857086c6b93b35f552fd10e41ca16607872",
      description:
        "Identity persistence foundation — users, auth identities, login challenges, sessions",
    },
    {
      id: "020_membership_core",
      context: "membership",
      path: "020_membership_core/up.sql",
      checksum:
        "857bbac3e351b71a2549e6639127611e0918a16a6efe94fe0edb8d12dc7392d5",
      description:
        "Membership persistence foundation — organizations, members, invitations, role assignments",
    },
    {
      id: "030_events_audit_core",
      context: "events",
      path: "030_events_audit_core/up.sql",
      checksum:
        "13c451ca150371f301a85c3a00b36689a6108f31da05c8d1a3fa64b3b1b6bfb4",
      description:
        "Events/audit persistence foundation — canonical event log and audit entry projections",
    },
    {
      id: "040_projects_core",
      context: "projects",
      path: "040_projects_core/up.sql",
      checksum:
        "f40bd14d98f399f0a0cfb6f82a5ac7be31792c74950e597bc90ffe6a6ead3949",
      description:
        "Projects persistence foundation — projects and environments tables with tenant isolation",
    },
    {
      id: "050_identity_security_events",
      context: "identity",
      path: "050_identity_security_events/up.sql",
      checksum:
        "e97f0dc7d4e7f3e246bbdd80f041a64a178949281e30c9e94ceb8a64d9472009",
      description:
        "Identity-owned security-event source facts — pre-organization user activity log",
    },
    {
      id: "060_identity_api_keys",
      context: "identity",
      path: "060_identity_api_keys/up.sql",
      checksum:
        "9adceb6281c2f88449415dceba7f387e16591ffbc115d6199a5efce4acf92aff",
      description:
        "Identity-owned service principals and API keys — org-bound automation actors and credential persistence",
    },
    {
      id: "070_config_settings_flags",
      context: "config",
      path: "070_config_settings_flags/up.sql",
      checksum:
        "0996c9c8e483b1aff84a2b17e4176eaa21316f3c9834070eaee78c23c0b18a48",
      description:
        "Config persistence foundation — scoped settings, feature flags, and secret metadata",
    },
    {
      id: "080_webhooks_core",
      context: "webhooks",
      path: "080_webhooks_core/up.sql",
      checksum:
        "c9157f4836d229b73dd3918b0b090fc776e0ba73727a876e37a2b6c1b098a38a",
      description:
        "Webhook persistence foundation — endpoints, subscriptions, and delivery attempts",
    },
    {
      id: "090_webhooks_delivery",
      context: "webhooks",
      path: "090_webhooks_delivery/up.sql",
      checksum:
        "79ea5500c1e5dff36f70ad6a3f63f4335c1423c4695ca0ac5b60942d6f20cce4",
      description:
        "Webhook delivery runtime — fixes event_id type, adds dispatch cursor and delivery indexes",
    },
    {
      id: "100_metering_foundation",
      context: "metering",
      path: "100_metering_foundation/up.sql",
      checksum:
        "f5448db51935ade1fab8670a27c1104d20b07d0003608550d1749a013f0ac6b9",
      description:
        "Metering persistence foundation — usage records, rollups, quota definitions, and quota violations",
    },
    {
      id: "110_billing_foundation",
      context: "billing",
      path: "110_billing_foundation/up.sql",
      checksum:
        "446e002fada272b2488c745eb855f49685e7f9899297c8df7e39f25ad591e06f",
      description:
        "Billing persistence foundation — provider-neutral plans, billing customers, subscriptions, invoices, and entitlements",
    },
    {
      id: "120_notifications_core",
      context: "notifications",
      path: "120_notifications_core/up.sql",
      checksum:
        "ca99fc52528d2697885776096ee0d0b2b46cab6c18ca37cfc6e46ed4cf0b4d59",
      description:
        "Notifications persistence foundation — preferences, notifications, attempts, suppressions",
    },
    {
      id: "130_webhook_secret_rotation_grace",
      context: "webhooks",
      path: "130_webhook_secret_rotation_grace/up.sql",
      checksum:
        "de5929da0705b34ae3ac94ce978705c857d232997f553ed4abd92996b9ba8134",
      description:
        "Dual-secret rotation window — adds previous_secret_{ciphertext,version,expires_at} for grace-period delivery signing",
    },
    {
      id: "140_support_action_records",
      context: "support",
      path: "140_support_action_records/up.sql",
      checksum:
        "4379358a3692ebc734c1125c3d21c00c023185f42572351d7366f3292388b4b3",
      description:
        "Support persistence foundation — append-only audited support-action ledger owned by the admin-support worker",
    },
    {
      id: "150_entitlement_decision_observations",
      context: "billing",
      path: "150_entitlement_decision_observations/up.sql",
      checksum:
        "51950b97f41b5b03107cf1414a068e5d2a82901331f00687aa647139f40043d5",
      description:
        "Entitlement-decision observability — append-only, counts-only observation table (org × entitlement key × outcome) owned by the billing context",
    },
    {
      id: "160_identity_user_last_org",
      context: "identity",
      path: "160_identity_user_last_org/up.sql",
      checksum:
        "ebfead333c9a5ccfdc782744eef2911ae9c63c70358a8fccecbd8b545a851806",
      description:
        "Per-user last-viewed organization preference (nullable slug hint on identity_users) backing the console's cross-device default landing",
    },
    {
      id: "170_membership_org_parent",
      context: "membership",
      path: "170_membership_org_parent/up.sql",
      checksum:
        "33e280e66b1752832a434fb122d41733e1c325faa443e819a8b402ca63995581",
      description:
        "Optional parent-organization pointer (nullable parent_org_id on membership_organizations) — the dormant seam for the saas-multi-org-billing epic; NULL = standalone, no behavior change",
    },
    {
      id: "180_integrations_foundation",
      context: "integrations",
      path: "180_integrations_foundation/up.sql",
      checksum:
        "f0a65edf90d7d63349628335ca80ddf825555b1686c4873aa4f75ab633b8f2bd",
      description:
        "Integrations persistence foundation (IG0, dormant) — provider-agnostic connections, GitHub installation facts, repo links with branch→environment maps, the durable inbound-delivery inbox, and the encrypted installation-token cache",
    },
    {
      id: "190_integrations_delivery_attribution",
      context: "integrations",
      path: "190_integrations_delivery_attribution/up.sql",
      checksum:
        "b5ffe67f60e3486b9c733146c375341e757145b5d4381475256f1399328d81a0",
      description:
        "Connection pointer on the inbound-delivery inbox (nullable connection_id + partial index) — lets the per-connection delivery log scope precisely; attributed by the IG2 cron drain",
    },
    {
      id: "200_membership_join_codes",
      context: "membership",
      path: "200_membership_join_codes/up.sql",
      checksum:
        "433bafcd71b95cae7cd1a7e96f2ab3b815236633063e073a7ac048bf9ec210fc",
      description:
        "Shareable join code per organization (nullable join_code on membership_organizations + partial unique index) — minted lazily, rotatable; opening a group's link joins it (Cookpool CP-3)",
    },
    {
      id: "210_kitchen_settings",
      context: "kitchen",
      path: "210_kitchen_settings/up.sql",
      checksum:
        "d27c4c8c47096bdcce4f7d425782c75798bc0c3414cda73d41b0df2bd2854e84",
      description:
        "Kitchen bounded context, first table: kitchen_group_settings — one row per group (org_id PK) with its ledger currency (fixed once set) and default waste policy; no row reads as INR / split_equally (Cookpool CP-4)",
    },
    {
      id: "220_kitchen_ledger",
      context: "kitchen",
      path: "220_kitchen_ledger/up.sql",
      checksum:
        "a5b3f6cbc68fb46a3821f5df5b0687b97323d709b91f4ad880127b47ddbf3f57",
      description:
        "Every group's append-only ledger: kitchen_txns (unique idempotency key per group; a transaction reversed at most once), kitchen_txn_splits (who paid, who owes) and kitchen_flags (Cookpool CP-7)",
    },
    {
      id: "230_kitchen_pantry",
      context: "kitchen",
      path: "230_kitchen_pantry/up.sql",
      checksum:
        "535ecb74e7762c5bad24f3b29f82e0bb36127ebbab24b5aa549cba2c84429d4d",
      description:
        "Pantries: kitchen_items (a personal item keyed by its owner, a group item by its group — the owner CHECK; 0 ≤ qty_left ≤ qty_bought; price and cost taken in minor units; unique idempotency key per pantry) and kitchen_stock_moves, every change to an item's stock (Cookpool CP-10)",
    },
    {
      id: "240_kitchen_stock_moves",
      context: "kitchen",
      path: "240_kitchen_stock_moves/up.sql",
      checksum:
        "db23670f21dc2378f7791a1ff8d80c33ae43e1ae42ddd0cec386ea6a27d0a788",
      description:
        "What a stock move records once people use, waste, move and undo things: nullable consumers (JSON array), unit, reverses (a move put back at most once — partial unique index; only a reversal reverses) and idem_key (unique per item) on kitchen_stock_moves (Cookpool CP-11)",
    },
    {
      id: "250_kitchen_dishes",
      context: "kitchen",
      path: "250_kitchen_dishes/up.sql",
      checksum:
        "ef5b2491752d42575d643480ec4fdbecf6fe33ccb67607f93ccdda72bfff5743",
      description:
        "Dishes: kitchen_dishes (a cook's dish, shared with a group or just for them; total = ingredients + extras; draft | open | finalized | canceled; unique idempotency key per cook) and kitchen_dish_ingredients (one item taken from any pantry, its cost, its buyer and the use transaction that charged the cook), plus an index on kitchen_stock_moves.dish_id (Cookpool CP-14)",
    },
    {
      id: "260_kitchen_dish_shares",
      context: "kitchen",
      path: "260_kitchen_dish_shares/up.sql",
      checksum:
        "6cee8f016a0d6a503e020c9e376316c677625256c285c48a0aab6559611da743",
      description:
        "Splitting dishes: kitchen_dish_shares (one eater's half portions or exact amount, claimed by them or assigned by the cook; unique per dish and eater; exactly one of portions or amount) and kitchen_dishes.version (bumped by every claim and assignment; finalize and correct apply only at the version they read) (Cookpool CP-16)",
    },
    {
      id: "270_kitchen_sweeps",
      context: "kitchen",
      path: "270_kitchen_sweeps/up.sql",
      checksum:
        "0d94d3ffe77dbb20455c4dcda4ed6cdfa0c88580f489dcd6bb5f8ca97540bf97",
      description:
        "The daily use-soon sweep's record: kitchen_sweeps, one row per UTC day swept (when it last ran, items in the window, people with something to use, digests sent and failed); /health reports the latest (Cookpool CP-18)",
    },
    {
      id: "280_identity_login_attempts",
      context: "identity",
      path: "280_identity_login_attempts/up.sql",
      checksum:
        "69b984e98fb2aef1c881e843ddda5053062eab822d3ab6067c0cd8daf242b88b",
      description:
        "Limits on sign-in codes: identity_login_challenges.attempts (wrong codes taken; login/complete counts them in the guarded UPDATE that checks the code, and a challenge at the limit is spent) and a (user_id, created_at) index for login/start's per-address count of codes in the last 15 minutes (Cookpool SI-2)",
    },
    {
      id: "290_kitchen_dish_share_setter",
      context: "kitchen",
      path: "290_kitchen_dish_share_setter/up.sql",
      checksum:
        "a5ab4fcb0d3014f2d377e02b47518423284fb1f123d4628a6a7ed8b766c9b54d",
      description:
        "Who set each share of a dish: nullable kitchen_dish_shares.set_by (usr_…), written by every claim — the eater's own, or another member's for them — the cook's assignment and a correction; null for shares written before (Cookpool SM-6)",
    },
    {
      id: "300_kitchen_measures",
      context: "kitchen",
      path: "300_kitchen_measures/up.sql",
      checksum:
        "c49137d8d6280af027e90cc34d2cf1269e26cc89e293b2797294d928bf2ebceb",
      description:
        "Your measures: kitchen_measures (up to three sizes per item name, pantry and dimension — count of a measure make amount_milli of the stock, exactly; one row per word and name; looked up by pantry, name and dimension in position order) and a nullable label (the words a use was given in, \"2 onions\") on kitchen_stock_moves and kitchen_dish_ingredients (Cookpool SM-13)",
    },
    {
      id: "310_notification_push_subscriptions",
      context: "notifications",
      path: "310_notification_push_subscriptions/up.sql",
      checksum:
        "1b89aa8a05fc9cfaf732f6a8d97c51388287a1ed6873c58138692096ab6afd7d",
      description:
        "Web Push subscriptions: notifications_push_subscriptions, one row per device (unique https endpoint, the browser's p256dh and auth keys, a user-agent label, created/updated and last success/failure times) for one person (subject_id, usr_…) — not org-scoped, at most ten per person (Cookpool PW-5)",
    },
    {
      id: "320_notification_push_preferences",
      context: "notifications",
      path: "320_notification_push_preferences/up.sql",
      checksum:
        "771596cf75fdbd9e7b85c53f220d72ee776e17dae0cbef7e8290a555b713bb57",
      description:
        "Push as a preference channel: notifications_notification_preferences rebuilt (same name, rows and unique key) so channel may be 'email' or 'push', with a kinds map (kitchen.portion_set, kitchen.dish_posted, kitchen.paid_you) beside categories; existing rows keep their meaning with kinds '{}' (Cookpool PW-5)",
    },
    {
      id: "330_kitchen_item_notes",
      context: "kitchen",
      path: "330_kitchen_item_notes/up.sql",
      checksum:
        "313f6591b646ce7d6735c904afd7eeb83813b697ef104ba1464076dc6c35e348",
      description:
        "Item notes: a nullable kitchen_items.note (at most 80 characters by length(), trimmed and never blank — the worker stores an empty note as NULL; items written before read as NULL), read by whoever can read the item; it moves no money (Cookpool RC-3)",
    },
    {
      id: "340_kitchen_foods",
      context: "kitchen",
      path: "340_kitchen_foods/up.sql",
      checksum:
        "072434af6698e1c559793d37db0f073ae2f04ad7e0747a2c60cc2925c423ace5",
      description:
        "The shared food list: kitchen_foods (key, name, mass/volume/count, one piece in grams, category) and kitchen_food_names (every spelling and language → one food), seeded with 70 everyday foods and their English, Hindi and regional names; kitchen_items.food_key (linked when an item is added and exactly one food matches its name); kitchen_food_answers (a pantry's \"asked once\" answer per name, or none); kitchen_always_have and kitchen_always_have_lists (a person's always-have foods; salt and water until they save their own) (Cookpool RC-4)",
    },
    {
      id: "350_kitchen_recipes",
      context: "kitchen",
      path: "350_kitchen_recipes/up.sql",
      checksum:
        "6722b99310bd9a743ecc9a7c2e7b050c7096182cce615b6e5649ceb053cba6b7",
      description:
        "Recipes: kitchen_recipes (rcp_ templates owned by a person or Cookpool's system user; serves in halves; only_me / groups / link visibility with a unique 10-character link code exactly while it is link; copies carry their source and its owner's name; soft delete), kitchen_recipe_lines (food or free text, an amount in a unit or to taste, exactly one main never to taste) and kitchen_recipe_steps (up to 20, 200 characters each); the dish's recipe_id and recipe_factor_milli and each ingredient's recipe_line, nullable (Cookpool RC-4)",
    },
    {
      id: "360_kitchen_cookpool_recipes",
      context: "kitchen",
      path: "360_kitchen_cookpool_recipes/up.sql",
      checksum:
        "035861f1e00a40135553ea661b357bd2baa45f9355a8b04bca90904625fe3a3b",
      description:
        "The full food list and Cookpool's own recipes: kitchen_foods.g_per_ml (grams per millilitre, nullable, so a spoon meets a weight), set on RC-4's foods measured by spoon or cup; 230 more foods (300 in all) and 1,850 more names in English, Hindi and regional words; 42 home-staple recipes under usr_cookpool (is_system, seen by everyone, edited by no one) with their lines and steps; and one backfill linking items still unlinked to the new names (Cookpool RC-7)",
    },
    {
      id: "370_kitchen_guided_steps",
      context: "kitchen",
      path: "370_kitchen_guided_steps/up.sql",
      checksum:
        "ae869e23ff34bec5bde674727d7664c1415bc65c6885d8fa5900a708294fd26f",
      description:
        "Steps that guide: kitchen_recipe_steps gains a stable step_key (backfilled at random for every existing step, unique per recipe), phase (prep/cook), line_refs (JSON positions), heat 0–3, min/max seconds (both or neither, min ≤ max ≤ 86 400), whistles 1–10 (never with seconds), hands_off, time_rule (fixed/partly/linear), a checkpoint ≤ 80 and its sense, and a tip ≤ 160; kitchen_recipes.tools (a JSON array of up to 10); and kitchen_dish_step_times (one row per dish and step key: seconds, the dish's factor, the cook and the recipe root), indexed by root and key (Cookpool GC-2)",
    },
    {
      id: "380_kitchen_timers",
      context: "kitchen",
      path: "380_kitchen_timers/up.sql",
      checksum:
        "4484c14ac6225b88c6ce14817d700ac20459e9a6ec6ab3caadbe8b146bbcb073",
      description:
        "Timers that find you: kitchen_timers (tmr_ id, one person's usr_… user_id, a 1–60 character label, an optional 1–120 character body, the app path it opens, ends_at after created_at — kitchen-worker keeps it 30 s to 24 h ahead — sent_at once the per-minute sweep has claimed it and asked for its push, canceled_at once its person cancelled it), at most ten active per person; indexed on ends_at over active rows (the sweep), on (user_id, ends_at) over active rows (a person's list and the limit) and on ends_at over every row (the purge of rows that ended more than a day ago) (Cookpool GC-3)",
    },
    {
      id: "390_kitchen_cookpool_guided",
      context: "kitchen",
      path: "390_kitchen_cookpool_guided/up.sql",
      checksum:
        "b97920e7a3ffa123bfd078b6927047957b2f8f72ae01c2f3828e653987459a2a",
      description:
        "Cookpool's 42 recipes with guided steps: for each of 360's recipes under usr_cookpool, its tools (a JSON array) set by UPDATE, and its step rows replaced — DELETE, then one plain INSERT — by guided steps with fixed keys c00c0390-<recipe>-<step>: prep (chopping, soaking, marinating, resting) before cook, every cook step with a flame, its lines, a time range and rule or a whistle count, hands off where it waits, a checkpoint and a tip where useful; the rajma and chole soaks, sabudana's soak and fried rice's cooled rice are long prep. Lines, names and every other recipe are untouched (Cookpool GC-4)",
    },
    {
      id: "400_kitchen_purchases",
      context: "kitchen",
      path: "400_kitchen_purchases/up.sql",
      checksum:
        "44b8b8abe901dc64d1f94a4991be67d2f85bc6f1e29106c28fa59732787219b4",
      description:
        "Shopping runs: kitchen_items.purchase_id (nullable, no default — a UUID, pur_ in the API) shared by every item one run added in one batch with one payer, null for an item added on its own; indexed on purchase_id over the items in a purchase, for the run's Undo and the replay of a retried run. No purchases table and no name index: the restock read groups by name through the existing owner and group indexes (Cookpool PN-3)",
    },
    {
      id: "410_kitchen_moves_via",
      context: "kitchen",
      path: "410_kitchen_moves_via/up.sql",
      checksum:
        "858d68fa7595f7e82420e158bf935eefa01ed2dce546d1b24d34655d8d1180c8",
      description:
        "What wrote a stock move: a nullable kitchen_stock_moves.via, CHECK in ('check', 'ask') — check on every use, waste and adjust a stock check writes (PN-4), ask reserved for the use an approved ask posts (PN-8); NULL for every move logged directly, every reversal, and every move written before (Cookpool PN-4)",
    },
    {
      id: "420_kitchen_asks",
      context: "kitchen",
      path: "420_kitchen_asks/up.sql",
      checksum:
        "5ddba43ea6bc22992b99c04d2ef8bbe8d029dad0b6ac0acfaf557ab020976c1c",
      description:
        "Ask before use: kitchen_items.ask_first (0 or 1, default 0 — the buyer of a group item asks to be asked first); kitchen_item_allowed (item_id, member_id, created_at; primary key item and member — who never needs to ask); and kitchen_asks (ask_ id, org_id, item_id, asker_id, qty_milli, unit, the measure's label, consumers as a JSON array, weights or NULL, source pantry or cook, state pending/approved/declined/canceled, created_at, expires_at 24 h on, answered_at and answered_by, the move_id and txn_id an approval posted, granted when it also let the asker, and an idem_key unique per item), indexed by item and state and by asker and time. Lapsing is read-side (Cookpool PN-8)",
    },
    {
      id: "430_kitchen_community",
      context: "kitchen",
      path: "430_kitchen_community/up.sql",
      checksum:
        "5079266cb6904503fb75ffea4bf0a5af44098d4b5225afa7bed5c5db49033caa",
      description:
        "Profiles and following: kitchen_profiles (user_id primary key; a lowercase unique handle of 3–20 a–z, 0–9, _ and . with no leading, trailing or doubled dot; name 1–40; about up to 160 or NULL; privacy public/private, default public; handle_changed_at NULL until the first change, which is free; created_at, updated_at); kitchen_follows (follower_id, followee_id primary key, state accepted/requested, created_at, accepted_at set exactly when accepted, never oneself), indexed by followee, state and acceptance and by state and acceptance; kitchen_blocks (blocker_id, blocked_id primary key, created_at), indexed by the blocked person; kitchen_mutes (muter_id, muted_id primary key, created_at); and kitchen_recipes.listed (0 or 1, default 0, 1 only on a link recipe — a public recipe), with an index of listed live recipes by time (Cookpool CM-2)",
    },
    {
      id: "440_kitchen_posts",
      context: "kitchen",
      path: "440_kitchen_posts/up.sql",
      checksum:
        "870825eae82f8432de00b06486a1775569e2d003e38f2cec1fc4ff0eee964e98",
      description:
        "Posts, Yum, comments, reports and Activity: kitchen_posts (pst_ id as a UUID, author_id, dish_id unique while live, recipe_id, title 1–60, caption up to 500 or NULL, audience followers/public/me, stats a JSON object of only size, minutes, ate and steps — no other key — photo_key NULL for CM-4, yum_pushed_at for the hourly Yum push, created_at, edited_at, deleted_at), indexed by author and time, audience and time and recipe; kitchen_post_yums (post_id, user_id primary key, created_at); kitchen_post_comments (cmt_ id, post_id, author_id, body 1–500, created_at, deleted_at and deleted_by together), indexed by post and time and by author and time; kitchen_reports (rpt_ id, reporter_id, target_kind post/comment/profile, target_id, reason spam/abuse/unsafe/other, note up to 300, created_at, state open/closed; one per reporter and target), indexed by target and state; and kitchen_activity (act_ id, recipient user_id, kind followed/follow_request/follow_accepted/yum/comment/cooked_yours/saved_yours, actor_id never the recipient, post_id, comment_id, recipe_id, created_at, read_at), indexed by recipient and time, unread, and by post and kind (Cookpool CM-3)",
    },
    {
      id: "460_kitchen_split_later",
      context: "kitchen",
      path: "460_kitchen_split_later/up.sql",
      checksum:
        "3dd317745b3d73878c8cf16f517b95c421bc6e3bd6d58291c4035d6b4c32d9c0",
      description:
        "Cooked, then split later: kitchen_dishes.split_at (when a dish cooked as its cook's own was split with a group — set once with org_id, and only on a dish that has one, by CHECK) and kitchen_dishes.split_dismissed_at (when its cook dismissed Home's reminder to split it; NULL while it would remind). Both nullable, no default (Cookpool CM-8)",
    },
    {
      id: "470_kitchen_ai",
      context: "kitchen",
      path: "470_kitchen_ai/up.sql",
      checksum:
        "4b2162bfc73edb7aa314f63bd167aa30496a699d18c3da0d64a370e602efec35",
      description:
        "AI usage: kitchen_ai_usage (id, user_id usr_…, feature uses/receipt/recipe_import/transcribe/ask_step/swaps/idea, model — the last model called, input_tokens uncached, cached_tokens read from the prompt cache, output_tokens, audio_seconds, ok 0 or 1, created_at), one row per AI action with a Sonnet retry's tokens summed into its action's row, indexed by user and time for the daily limits of 50 actions and 30 voice minutes per person per UTC day. Counts only: no group, item, price or text (Cookpool AI-2)",
    },
    {
      id: "480_kitchen_ai_cost",
      context: "kitchen",
      path: "480_kitchen_ai_cost/up.sql",
      checksum:
        "d396b3171b5df8a80b2c999ecf673cf8c72f833aec5ad5d58f7545050b7a4db7",
      description:
        "AI cost: kitchen_ai_usage.cost_micros (INTEGER NOT NULL DEFAULT 0, ≥ 0) — each AI action's estimated cost in micro-dollars from its calls' tokens and the price table (escalations add both models) — and kitchen_ai_usage_created_idx (created_at, cost_micros), covering the month's total across everyone that the AI budget is checked against (Cookpool AI-13)",
    },
    {
      id: "490_identity_delegations",
      context: "identity",
      path: "490_identity_delegations/up.sql",
      checksum:
        "3400cf03300b2584b6eab111aec2abb661c4dd8ca25971a6ad96aa3799e08677",
      description:
        "Delegated tokens for assistants: identity_delegations (id, user_id, client_name 1–80, client_id 1–128 — the MCP client's id, scopes a JSON array of at least one scope name, token_hash the SHA-256 of the token's secret, created_at, last_used_at moved at most hourly, expires_at 90 days after minting or the last rotation, revoked_at), indexed by user and time. Tokens are sps_dlg_<id>.<secret>; the raw token is never stored (Cookpool MC-2)",
    },
    {
      id: "510_identity_passkeys",
      context: "identity",
      path: "510_identity_passkeys/up.sql",
      checksum:
        "cb6104c7f9f6244dc3cc8171086d717ab4781a3d0da8582ef6c19c6ece56efe1",
      description:
        "Passkeys: identity_passkeys (id pky_ plus 16 hex, user_id, credential_id base64url unique, public_key COSE base64url, sign_count ≥ 0, transports a JSON array, aaguid, device_name 1–60, backed_up 0 or 1, created_at, last_used_at), indexed by user, at most 10 per person; and identity_passkey_challenges (id, kind register or login, user_id set for register and null for login, challenge unique, created_at, expires_at 5 minutes later, used_at), used once, indexed by expiry for pruning. Public keys only (Cookpool PK-2)",
    },
    {
      id: "520_identity_passkeys_id_check",
      context: "identity",
      path: "520_identity_passkeys_id_check/up.sql",
      checksum:
        "06a110d21309ecd17bbd6dac9d05771f1ade967f99de5cb7f55a68ac3d81f598",
      description:
        "Passkeys: identity_passkeys rebuilt with an id check D1 can run (20 characters, pky_ then 0-9a-f only, every pattern under D1's 50-byte LIKE/GLOB limit) in place of 510's 132-character GLOB, which made every insert fail on D1; columns, constraints and index otherwise unchanged (Cookpool PK-7)",
    },
    {
      id: "530_spliteco_ledger",
      context: "kitchen",
      path: "530_spliteco_ledger/up.sql",
      checksum:
        "78049d8f4bb99e10c61a2189cb2a536fa2b39574cbe33fca8d484d0c3313c09a",
      description:
        "Spliteco on Cookpool's ledger: membership_organizations.made_in (cookpool default | spliteco) and kind (kitchen default | trip | home | couple | other | direct); kitchen_txns.app (cookpool default | spliteco), bucket (kitchen default | other: two balances per kitchen group), category, revises and moved_from (each unique when set: a version is replaced or moved once), deleted_at (on a delete's reversal), via_delegation and split_spec (JSON); ledger_txn_items, ledger_txn_item_shares (portion ×1000, basis points or minor units), ledger_txn_adjustments (tax, service, discount) and ledger_comments (cmt_ ids). Append-only (cookpool-spliteco SE-2)",
    },
    {
      id: "540_spliteco_settle_up",
      context: "kitchen",
      path: "540_spliteco_settle_up/up.sql",
      checksum:
        "c395bb09c5b6d3f80de881b2528c17899bc048eb627fc430494642f8278324fd",
      description:
        "Spliteco settle up: ledger_reminders (rmd_ ids; org, from, to, amount, currency, sent_at; indexed by pair and time — at most one per pair per 24 hours), spliteco_profiles (subject_id, upi_vpa — a UPI ID shown only to people who share a group — and default_currency) and spliteco_group_settings (org_id, simplify_debts default 1). Payments stay kitchen_txns settlements with their bucket. Additive (cookpool-spliteco SE-3)",
    },
    {
      id: "550_spliteco_live_split",
      context: "kitchen",
      path: "550_spliteco_live_split/up.sql",
      checksum:
        "b07efb77c42d0cf0e3367d8c2885a011e884a0f2f4c7ac30913d1dff9b441dd1",
      description:
        "Spliteco live split: ledger_live_sessions (lvs_ ids; org, an 8-character join code unique across sessions, the itemized draft as JSON, open | locked, created_by, created_at, expires_at 24 h on, the posted txn_id), ledger_live_claims (session, item_position, subject_id, mode portion | pct | exact and value as an item share's) and ledger_live_presence (who last read it, when). No money until the lock posts one itemized expense. Additive (cookpool-spliteco SE-5)",
    },
    {
      id: "560_spliteco_assistants",
      context: "kitchen",
      path: "560_spliteco_assistants/up.sql",
      checksum:
        "6591596eaf90094d7aba261891c0c1eff6cbc1770f0e755d895655b84a7ffa0f",
      description:
        "Spliteco assistants: kitchen_txns.via_client (the assistant's name as connected, 1–80, beside via_delegation, so Activity says via Claude) and ledger_drafts (drf_ ids; the person and delegation that drafted it, add | edit | move, the group, the expense for an edit or move, the request as JSON, 10 minutes to save it, saved_txn_id once saved), indexed by expiry. Additive (cookpool-spliteco SE-6)",
    },
    {
      id: "570_identity_delegation_access",
      context: "identity",
      path: "570_identity_delegation_access/up.sql",
      checksum:
        "28002b0c38b2edb5590f47240029e0073b9a9555737a08bbe22cd696f89f9802",
      description:
        "Delegations: identity_delegations.granted_scopes (JSON array; the scopes allowed at connect, the ceiling scopes may be changed within; NULL means the same as scopes), so a person can set an assistant to Look only or Add & edit. Additive (cookpool-spliteco SE-6)",
    },
  ],
};
