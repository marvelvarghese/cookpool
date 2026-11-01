-- 210_kitchen_settings: one settings row per Cookpool group.
--
-- Context: kitchen
-- Epic: cookpool-kitchen (CP-4) — the kitchen bounded context's first table.
--       A group is a membership organization. Its settings say which currency
--       its ledger counts in and who pays for food that goes to waste.
--
-- Design rules:
--   * Additive and idempotent: CREATE TABLE IF NOT EXISTS only.
--   * Keyed by the group: org_id is the primary key, an opaque reference to
--     membership_organizations.id (a bare UUID) with no cross-context FK.
--   * A group without a row reads as the defaults (INR, split_equally), so no
--     row has to be written when a group is created. The worker writes one on
--     the first change.
--   * The currency is fixed once the row exists: kitchen-worker's upsert only
--     accepts a currency equal to the stored one (details.reason
--     currency_locked otherwise). The CHECKs below keep the values well formed.
-- schema kitchen: The kitchen bounded context (Cookpool) — group settings, pantries, the group ledger and dishes. Owns every kitchen_* table.

CREATE TABLE IF NOT EXISTS kitchen_group_settings (
  org_id        TEXT PRIMARY KEY,
  currency      TEXT NOT NULL DEFAULT 'INR' CHECK (length(currency) = 3 AND currency GLOB '[A-Z][A-Z][A-Z]'),
  waste_policy  TEXT NOT NULL DEFAULT 'split_equally' CHECK (waste_policy IN ('split_equally', 'buyer_absorbs')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- table kitchen_group_settings: One row per group (organization) that has changed its kitchen settings. A group without a row uses the defaults.
-- column kitchen_group_settings.org_id: Owning organization (the group) — opaque reference to membership_organizations.id, no cross-context FK.
-- column kitchen_group_settings.currency: ISO 4217 code the group's ledger counts in (amounts are integer minor units). Fixed once the row exists.
-- column kitchen_group_settings.waste_policy: Who pays for wasted food by default: split_equally across the group, or buyer_absorbs. Items may override it.
