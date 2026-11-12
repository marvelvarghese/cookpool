import type { SqlExecutor } from "../d1/executor.js";

// One-time handoff codes (cookpool-spliteco SE-4, migration 580): a signed-in
// person in Cookpool asks for one, bound to them and to the origin of the app
// it opens (Spliteco); that app exchanges it, once, within 60 seconds, for a
// session of its own. Only the code's hash is stored. Its own repository,
// beside IdentityRepository, as passkeys and delegations are.

export interface HandoffCode {
  /** `hof_` plus 32 hex characters. */
  id: string;
  userId: string;
  targetOrigin: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  sessionId: string | null;
}

export interface CreateHandoffCodeInput {
  id: string;
  userId: string;
  codeHash: string;
  targetOrigin: string;
  createdAt: Date;
  expiresAt: Date;
}

/** Why a code could not be taken: none with that hash, another origin, past its time, or already used. */
export type HandoffRefusal = "not_found" | "wrong_origin" | "expired" | "used";

export type ConsumeHandoffResult = { ok: true; code: HandoffCode } | { ok: false; reason: HandoffRefusal };

export interface HandoffRepository {
  create(input: CreateHandoffCodeInput): Promise<HandoffCode>;
  /**
   * Take the code with this hash for `origin` at `now`: one guarded UPDATE
   * stamps used_at only while it is unused, unexpired and made for exactly
   * this origin, so of two racing exchanges one wins. A refusal says why.
   */
  consume(codeHash: string, origin: string, now: Date): Promise<ConsumeHandoffResult>;
  /** Record the session the exchange minted. */
  attachSession(id: string, sessionId: string): Promise<void>;
}

type Row = Record<string, unknown>;

const COLUMNS = "id, user_id, target_origin, created_at, expires_at, used_at, session_id";

function mapCode(row: Row): HandoffCode {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    targetOrigin: String(row.target_origin),
    createdAt: new Date(String(row.created_at)),
    expiresAt: new Date(String(row.expires_at)),
    usedAt: row.used_at ? new Date(String(row.used_at)) : null,
    sessionId: row.session_id ? String(row.session_id) : null,
  };
}

export function createHandoffRepository(executor: SqlExecutor): HandoffRepository {
  return {
    async create(input) {
      const result = await executor.execute(
        `INSERT INTO identity_handoff_codes (id, user_id, code_hash, target_origin, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLUMNS}`,
        [input.id, input.userId, input.codeHash, input.targetOrigin, input.createdAt.toISOString(), input.expiresAt.toISOString()],
      );
      const row = result.rows[0];
      if (!row) throw new Error("identity: handoff code insert returned no row");
      return mapCode(row);
    },

    async consume(codeHash, origin, now) {
      const at = now.toISOString();
      const taken = await executor.execute(
        `UPDATE identity_handoff_codes SET used_at = $3
         WHERE code_hash = $1 AND target_origin = $2 AND used_at IS NULL AND expires_at > $3
         RETURNING ${COLUMNS}`,
        [codeHash, origin, at],
      );
      const row = taken.rows[0];
      if (row) return { ok: true, code: mapCode(row) };
      // Not taken: say why, from what is there.
      const found = await executor.execute(`SELECT ${COLUMNS} FROM identity_handoff_codes WHERE code_hash = $1`, [codeHash]);
      const existing = found.rows[0];
      if (!existing) return { ok: false, reason: "not_found" };
      const code = mapCode(existing);
      if (code.usedAt) return { ok: false, reason: "used" };
      if (code.targetOrigin !== origin) return { ok: false, reason: "wrong_origin" };
      return { ok: false, reason: "expired" };
    },

    async attachSession(id, sessionId) {
      await executor.execute(`UPDATE identity_handoff_codes SET session_id = $2 WHERE id = $1 AND session_id IS NULL`, [id, sessionId]);
    },
  };
}
