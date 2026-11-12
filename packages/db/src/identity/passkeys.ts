import type { SqlExecutor } from "../d1/executor.js";
import { parseJsonColumn } from "../json.js";
import type { IdentityResult } from "./types.js";

// Passkeys (cookpool-passkeys PK-2): identity_passkeys and
// identity_passkey_challenges, migration 510. Only public keys are stored.
// Its own repository, beside IdentityRepository, so the session and API-key
// fakes in tests need not grow.

export interface Passkey {
  /** `pky_` plus 16 hex characters. */
  id: string;
  userId: string;
  /** The WebAuthn credential id, base64url. */
  credentialId: string;
  /** The COSE public key, base64url. */
  publicKey: string;
  signCount: number;
  transports: string[];
  aaguid: string;
  deviceName: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface CreatePasskeyInput {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  aaguid: string;
  deviceName: string;
  backedUp: boolean;
  createdAt: Date;
  /** The person may hold at most this many; counted in the insert itself. */
  limit: number;
}

export type PasskeyChallengeKind = "register" | "login";

export interface PasskeyChallenge {
  id: string;
  kind: PasskeyChallengeKind;
  /** The signed-in person for `register`; null for `login`. */
  userId: string | null;
  challenge: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface CreatePasskeyChallengeInput {
  id: string;
  kind: PasskeyChallengeKind;
  userId: string | null;
  challenge: string;
  createdAt: Date;
  expiresAt: Date;
  /** Challenges that expired before this are deleted first (best-effort). */
  pruneBefore: Date;
}

export interface PasskeysRepository {
  /**
   * Stores a passkey. `conflict` with entity `passkey` when the credential id
   * is already stored; `conflict` with entity `passkey_limit` when the person
   * already holds `limit` passkeys.
   */
  create(input: CreatePasskeyInput): Promise<IdentityResult<Passkey>>;
  /** The person's passkeys, newest first. */
  listForUser(userId: string): Promise<IdentityResult<Passkey[]>>;
  countForUser(userId: string): Promise<IdentityResult<number>>;
  getByCredentialId(credentialId: string): Promise<IdentityResult<Passkey>>;
  /**
   * After a sign-in: the new sign count, backed-up flag and last use — only
   * while the stored count is still `expectedSignCount`, so two sign-ins with
   * one count cannot both land. not_found otherwise.
   */
  recordUse(
    id: string,
    expectedSignCount: number,
    signCount: number,
    backedUp: boolean,
    usedAt: Date,
  ): Promise<IdentityResult<Passkey>>;
  /** Deletes the person's own passkey; not_found when the id is not theirs. */
  remove(id: string, userId: string): Promise<IdentityResult<Passkey>>;

  createChallenge(input: CreatePasskeyChallengeInput): Promise<IdentityResult<PasskeyChallenge>>;
  /**
   * Marks the challenge used, in one UPDATE, only when it is of this kind (and
   * this person's, for `register`), unused and not expired at `now`.
   * not_found for every other case: the caller says nothing about why.
   */
  consumeChallenge(
    challenge: string,
    kind: PasskeyChallengeKind,
    userId: string | null,
    now: Date,
  ): Promise<IdentityResult<PasskeyChallenge>>;
}

const PASSKEY_COLUMNS =
  "id, user_id, credential_id, public_key, sign_count, transports, aaguid, device_name, backed_up, created_at, last_used_at";
const CHALLENGE_COLUMNS = "id, kind, user_id, challenge, created_at, expires_at, used_at";

function mapPasskey(row: Record<string, unknown>): Passkey {
  const transports = parseJsonColumn<unknown>(row.transports, []);
  return {
    id: row.id as string,
    userId: row.user_id as string,
    credentialId: row.credential_id as string,
    publicKey: row.public_key as string,
    signCount: Number(row.sign_count ?? 0),
    transports: Array.isArray(transports) ? transports.filter((t): t is string => typeof t === "string") : [],
    aaguid: row.aaguid as string,
    deviceName: row.device_name as string,
    backedUp: Number(row.backed_up) === 1,
    createdAt: new Date(row.created_at as string),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
  };
}

function mapChallenge(row: Record<string, unknown>): PasskeyChallenge {
  return {
    id: row.id as string,
    kind: row.kind as PasskeyChallengeKind,
    userId: (row.user_id as string | null) ?? null,
    challenge: row.challenge as string,
    createdAt: new Date(row.created_at as string),
    expiresAt: new Date(row.expires_at as string),
    usedAt: row.used_at ? new Date(row.used_at as string) : null,
  };
}

function failed(message: string): IdentityResult<never> {
  return { ok: false, error: { kind: "internal", message } };
}

export function createPasskeysRepository(executor: SqlExecutor): PasskeysRepository {
  return {
    async create(input) {
      try {
        // The count and the insert are one statement: two registrations at
        // once cannot take a person past the limit.
        const result = await executor.execute<Record<string, unknown>>(
          `INSERT INTO identity_passkeys (id, user_id, credential_id, public_key, sign_count, transports, aaguid, device_name, backed_up, created_at)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
           WHERE (SELECT COUNT(*) FROM identity_passkeys WHERE user_id = $2) < $11
           ON CONFLICT DO NOTHING
           RETURNING ${PASSKEY_COLUMNS}`,
          [
            input.id,
            input.userId,
            input.credentialId,
            input.publicKey,
            input.signCount,
            JSON.stringify(input.transports),
            input.aaguid,
            input.deviceName,
            input.backedUp ? 1 : 0,
            input.createdAt.toISOString(),
            input.limit,
          ],
        );
        if (result.rowCount > 0) return { ok: true, value: mapPasskey(result.rows[0]!) };
        const existing = await executor.execute(
          `SELECT id FROM identity_passkeys WHERE credential_id = $1 OR id = $2`,
          [input.credentialId, input.id],
        );
        return {
          ok: false,
          error: { kind: "conflict", entity: existing.rowCount > 0 ? "passkey" : "passkey_limit" },
        };
      } catch {
        return failed("Failed to create passkey");
      }
    },

    async listForUser(userId) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${PASSKEY_COLUMNS} FROM identity_passkeys
           WHERE user_id = $1
           ORDER BY created_at DESC, id DESC`,
          [userId],
        );
        return { ok: true, value: result.rows.map(mapPasskey) };
      } catch {
        return failed("Failed to list passkeys");
      }
    },

    async countForUser(userId) {
      try {
        const result = await executor.execute<{ n: number }>(
          `SELECT COUNT(*) AS n FROM identity_passkeys WHERE user_id = $1`,
          [userId],
        );
        return { ok: true, value: Number(result.rows[0]?.n ?? 0) };
      } catch {
        return failed("Failed to count passkeys");
      }
    },

    async getByCredentialId(credentialId) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `SELECT ${PASSKEY_COLUMNS} FROM identity_passkeys WHERE credential_id = $1`,
          [credentialId],
        );
        if (result.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapPasskey(result.rows[0]!) };
      } catch {
        return failed("Failed to read passkey");
      }
    },

    async recordUse(id, expectedSignCount, signCount, backedUp, usedAt) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `UPDATE identity_passkeys SET sign_count = $3, backed_up = $4, last_used_at = $5
           WHERE id = $1 AND sign_count = $2
           RETURNING ${PASSKEY_COLUMNS}`,
          [id, expectedSignCount, signCount, backedUp ? 1 : 0, usedAt.toISOString()],
        );
        if (result.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapPasskey(result.rows[0]!) };
      } catch {
        return failed("Failed to record passkey use");
      }
    },

    async remove(id, userId) {
      try {
        const result = await executor.execute<Record<string, unknown>>(
          `DELETE FROM identity_passkeys WHERE id = $1 AND user_id = $2
           RETURNING ${PASSKEY_COLUMNS}`,
          [id, userId],
        );
        if (result.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapPasskey(result.rows[0]!) };
      } catch {
        return failed("Failed to remove passkey");
      }
    },

    async createChallenge(input) {
      try {
        // Best-effort pruning: a failed delete never fails the new challenge.
        try {
          await executor.execute(`DELETE FROM identity_passkey_challenges WHERE expires_at < $1`, [
            input.pruneBefore.toISOString(),
          ]);
        } catch {
          /* pruned next time */
        }
        const result = await executor.execute<Record<string, unknown>>(
          `INSERT INTO identity_passkey_challenges (id, kind, user_id, challenge, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${CHALLENGE_COLUMNS}`,
          [
            input.id,
            input.kind,
            input.userId,
            input.challenge,
            input.createdAt.toISOString(),
            input.expiresAt.toISOString(),
          ],
        );
        if (result.rowCount === 0) return failed("Failed to create passkey challenge");
        return { ok: true, value: mapChallenge(result.rows[0]!) };
      } catch {
        return failed("Failed to create passkey challenge");
      }
    },

    async consumeChallenge(challenge, kind, userId, now) {
      try {
        const at = now.toISOString();
        const result = await executor.execute<Record<string, unknown>>(
          `UPDATE identity_passkey_challenges SET used_at = $4
           WHERE challenge = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $4
             AND ((user_id IS NULL AND $3 IS NULL) OR user_id = $3)
           RETURNING ${CHALLENGE_COLUMNS}`,
          [challenge, kind, userId, at],
        );
        if (result.rowCount === 0) return { ok: false, error: { kind: "not_found" } };
        return { ok: true, value: mapChallenge(result.rows[0]!) };
      } catch {
        return failed("Failed to use passkey challenge");
      }
    },
  };
}
