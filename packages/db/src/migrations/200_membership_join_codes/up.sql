-- 200_membership_join_codes: a shareable join code per organization.
--
-- Context: membership
-- Epic: cookpool-kitchen (CP-3) — a Cookpool group is an organization, and a
--       person joins one by opening its link. The code is minted lazily (on the
--       first read by an owner or admin) and can be rotated, so it is nullable
--       and every existing organization starts without one.
--
-- Design rules:
--   * Additive: one nullable column and a partial unique index; no rewrite of
--     applied state. SQLite has no ADD COLUMN IF NOT EXISTS, so the runner's
--     applied ledger is what keeps the column add from running twice.
--   * A code names at most one organization: the unique index is partial, so
--     the many organizations without a code do not collide on NULL.

ALTER TABLE membership_organizations ADD COLUMN join_code TEXT;

-- column membership_organizations.join_code: Shareable, rotatable code that lets a signed-in person join this organization by link. NULL until an owner or admin first reads it; unique while set.

CREATE UNIQUE INDEX IF NOT EXISTS membership_orgs_join_code_idx
  ON membership_organizations (join_code)
  WHERE join_code IS NOT NULL;
