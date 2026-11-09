import type { SqlExecutor } from "../d1/executor.js";
import { parseJsonColumn } from "../json.js";
import type { IdentityResult, User } from "./types.js";

// Delegated tokens for assistants (cookpool-mcp MC-2): identity_delegations,
// migration 490. Only the SHA-256 of a token's secret is stored. Its own
// repository, beside IdentityRepository, so the session and API-key fakes in
// tests need not grow.

export interface Delegation {
  id: string;
  userId: string;
  clientName: string;
  clientId: string;
  /** Scope names as stored; the caller checks them against @saas/contracts/delegations. */
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface CreateDelegationInput {
  id: string;
  userId: string;
  clientName: string;
  clientId: string;
  scopes: string[];
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface DelegationsRepository {
  create(input: CreateDelegationInput): Promise<IdentityResult<Delegation>>;
  /** The delegation and its user, when `tokenHash` is this delegation's — revoked or expired ones too; the caller decides. */
  getWithUserByIdAndTokenHash(id: string, tokenHash: string): Promise<IdentityResult<{ delegation: Delegation; user: User }>>;
  getById(id: string): Promise<IdentityResult<Delegation>>;
  /** Live ones only (not revoked, not expired at `now`), newest first. */
  listLiveForUser(userId: string, now: Date, limit: number): Promise<IdentityResult<Delegation[]>>;
  /** Sets revoked_at when it is still unset; not_found when the id is not this user's. Answers the row either way. */
  revoke(id: string, userId: string, revokedAt: Date): Promise<IdentityResult<Delegation>>;
  /** A new secret and expiry, only while live at `now`; not_found otherwise (the caller reads why). */
  rotate(id: string, tokenHash: string, expiresAt: Date, now: Date): Promise<IdentityResult<Delegation>>;
  /** Moves last_used_at to `now` when it is unset or at or before `staleBefore`. Best-effort. */
  touch(id: string, now: Date, staleBefore: Date): Promise<IdentityResult<boolean>>;
}

const COLUMNS =
  "id, user_id, client_name, client_id, scopes, created_at, last_used_at, expires_at, revoked_at";

function mapDelegation(row: Record<string, unknown>): Delegation {
  const scopes = parseJsonColumn<unknown>(row.scopes, []);
  return {
    id: row.id as string,
    userId: row.user_id as string,
    clientName: row.client_name as string,
    clientId: row.client_id as string,
    scopes: Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === "string") : [],
    createdAt: new Date(row.created_at as string),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
    expiresAt: new Date(row.expires_at as string),
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
  };
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: row.u_id as string,
    email: row.u_email as string,
    emailLower: row.u_email_lower as string,
    displayName: (row.u_display_name as string) ?? null,
    lastOrgSlug: (row.u_last_org_slug as string) ?? null,
    status: row.u_status as string,
    createdAt: new Date(row.u_created_at as string),
    updatedAt: new Date(row.u_updated_at as string),
  };
}

function failed(message: string): IdentityResult<never> {
  return { ok: false, error: { kind: "internal", message } };
}

export function createDelegationsRepository(executor: SqlExecutor): DelegationsRepository {
  return {
    async create(input) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `INSERT INTO identity_delegations (id, user_id, client_name, client_id, scopes, token_hash, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING
           RETURNING ${COLUMNS}`,
          [
            input.id,
            input.userId,
            input.clientName,
            input.clientId,
            JSON.stringify(input.scopes),
            input.tokenHash,
            input.createdAt.toISOString(),
            input.expiresAt.toISOString(),
          ],
        );
        if (result.rowCount === 0) return { ok: false, error: { kind: "conflict", entity: "delegation" } };
        return { ok: true, value: mapDelegation(result.rows[0]!) };
      } catch {
        return failed("Failed to create delegation");
      }
    },

    async getWithUserByIdAndTokenHash(id, tokenHash) {
      try {
        // One read on a bearer-cache miss: the row by primary key, its user joined.
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT d.id, d.user_id, d.client_name, d.client_id, d.scopes, d.created_at, d.last_used_at, d.expires_at, d.revoked_at,
                  u.id AS u_id, u.email AS u_email, u.email_lower AS u_email_lower, u.display_name AS u_display_name,
                  u.last_org_slug AS u_last_org_slug, u.status AS u_status, u.created_at AS u_created_at, u.updated_at AS u_updated_at
           FROM identity_delegations d
           JOIN identity_users u ON u.id = d.user_id
           WHERE d.id = $1 AND d.token_hash = $2`,
          [id, tokenHash],
        );
        if (result.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        const row = result.rows[0]!;
        return { ok: true, value: { delegation: mapDelegation(row), user: mapUser(row) } };
      } catch {
        return failed("Failed to read delegation");
      }
    },

    async getById(id) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM identity_delegations WHERE id = $1`,
          [id],
        );
        if (result.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapDelegation(result.rows[0]!) };
      } catch {
        return failed("Failed to read delegation");
      }
    },

    async listLiveForUser(userId, now, limit) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM identity_delegations
           WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
           ORDER BY created_at DESC, id DESC
           LIMIT $3`,
          [userId, now.toISOString(), limit],
        );
        return { ok: true, value: result.rows.map(mapDelegation) };
      } catch {
        return failed("Failed to list delegations");
      }
    },

    async revoke(id, userId, revokedAt) {
      try {
        const updated = await executor.execute<Record<string, unknown>>(
          `UPDATE identity_delegations SET revoked_at = $3
           WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
           RETURNING ${COLUMNS}`,
          [id, userId, revokedAt.toISOString()],
        );
        if (updated.rowCount > 0) return { ok: true, value: mapDelegation(updated.rows[0]!) };
        // Already revoked (answer it as it is), or not this user's.
        const existing = await executor.execute<Record<string, unknown>>(
          `SELECT ${COLUMNS} FROM identity_delegations WHERE id = $1 AND user_id = $2`,
          [id, userId],
        );
        if (existing.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapDelegation(existing.rows[0]!) };
      } catch {
        return failed("Failed to revoke delegation");
      }
    },

    async rotate(id, tokenHash, expiresAt, now) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `UPDATE identity_delegations SET token_hash = $2, expires_at = $3
           WHERE id = $1 AND revoked_at IS NULL AND expires_at > $4
           RETURNING ${COLUMNS}`,
          [id, tokenHash, expiresAt.toISOString(), now.toISOString()],
        );
        if (result.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapDelegation(result.rows[0]!) };
      } catch {
        return failed("Failed to rotate delegation");
      }
    },

    async touch(id, now, staleBefore) {
      try {
        // RETURNING: rowCount is the rows read back, not the rows changed.
        const result = await executor.execute(
          `UPDATE identity_delegations SET last_used_at = $2
           WHERE id = $1 AND (last_used_at IS NULL OR last_used_at <= $3)
           RETURNING id`,
          [id, now.toISOString(), staleBefore.toISOString()],
        );
        return { ok: true, value: result.rowCount > 0 };
      } catch {
        return failed("Failed to touch delegation");
      }
    },
  };
}
