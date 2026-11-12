-- 570_identity_delegation_access: change what a connected assistant may do.
--
-- Context: identity
-- Epic: cookpool-spliteco (SE-6) — Spliteco's AI assistants page offers
--       "Look only" and "Add & edit" per assistant. scopes (migration 490)
--       stays what the token may do now, and is what every resolve reads;
--       granted_scopes is what the person allowed when they connected it,
--       the ceiling scopes may be set back up to. The assistant's own grant
--       at the MCP server only ever carries the scopes allowed at connect.
--
-- Design rules:
--   * Additive: one nullable column. NULL (every row before this) means the
--     same as scopes. New delegations store both.
--   * Valid scope names are checked in code (@saas/contracts/delegations).

ALTER TABLE identity_delegations ADD COLUMN granted_scopes TEXT
  CHECK (granted_scopes IS NULL OR (json_valid(granted_scopes) AND json_type(granted_scopes) = 'array'));

-- column identity_delegations.granted_scopes: The scopes allowed at connect (the ceiling for scopes); NULL means the same as scopes.
