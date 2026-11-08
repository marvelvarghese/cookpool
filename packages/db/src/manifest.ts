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
  ],
};
