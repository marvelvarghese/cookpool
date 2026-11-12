import type {
  CreateDelegationInput,
  Delegation,
  DelegationsRepository,
  IdentityRepository,
  IdentityResult,
} from "@saas/db/identity";

/** What the fake stores: the row as migration 490 holds it (the hash, never the token). */
export interface StoredDelegation extends Delegation {
  tokenHash: string;
}

/**
 * An in-memory DelegationsRepository with the same filters as the D1 one
 * (tests/db checks those against SQLite). It reads users from the identity
 * fake it is given, as the real one joins identity_users.
 */
export function createFakeDelegations(identity: IdentityRepository): DelegationsRepository & {
  _rows: Map<string, StoredDelegation>;
  _touches: number;
} {
  const rows = new Map<string, StoredDelegation>();
  const strip = ({ tokenHash: _t, ...d }: StoredDelegation): Delegation => ({ ...d, scopes: [...d.scopes], grantedScopes: [...d.grantedScopes] });

  const fake = {
    _rows: rows,
    _touches: 0,

    async create(input: CreateDelegationInput): Promise<IdentityResult<Delegation>> {
      if (rows.has(input.id)) return { ok: false, error: { kind: "conflict", entity: "delegation" } };
      const row: StoredDelegation = {
        id: input.id,
        userId: input.userId,
        clientName: input.clientName,
        clientId: input.clientId,
        scopes: [...input.scopes],
        grantedScopes: [...input.scopes],
        tokenHash: input.tokenHash,
        createdAt: input.createdAt,
        lastUsedAt: null,
        expiresAt: input.expiresAt,
        revokedAt: null,
      };
      rows.set(row.id, row);
      return { ok: true, value: strip(row) };
    },

    async getWithUserByIdAndTokenHash(id: string, tokenHash: string) {
      const row = rows.get(id);
      if (!row || row.tokenHash !== tokenHash) return { ok: false as const, error: { kind: "not_found" as const } };
      const user = await identity.getUserById(row.userId);
      if (!user.ok) return { ok: false as const, error: { kind: "not_found" as const } };
      return { ok: true as const, value: { delegation: strip(row), user: user.value } };
    },

    async getById(id: string): Promise<IdentityResult<Delegation>> {
      const row = rows.get(id);
      return row ? { ok: true, value: strip(row) } : { ok: false, error: { kind: "not_found" } };
    },

    async listLiveForUser(userId: string, now: Date, limit: number): Promise<IdentityResult<Delegation[]>> {
      const live = [...rows.values()]
        .filter((r) => r.userId === userId && r.revokedAt === null && r.expiresAt.getTime() > now.getTime())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
      return { ok: true, value: live.map(strip) };
    },

    async revoke(id: string, userId: string, revokedAt: Date): Promise<IdentityResult<Delegation>> {
      const row = rows.get(id);
      if (!row || row.userId !== userId) return { ok: false, error: { kind: "not_found" } };
      if (row.revokedAt === null) row.revokedAt = revokedAt;
      return { ok: true, value: strip(row) };
    },

    async rotate(id: string, tokenHash: string, expiresAt: Date, now: Date): Promise<IdentityResult<Delegation>> {
      const row = rows.get(id);
      if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
        return { ok: false, error: { kind: "not_found" } };
      }
      row.tokenHash = tokenHash;
      row.expiresAt = expiresAt;
      return { ok: true, value: strip(row) };
    },

    async updateScopes(id: string, userId: string, scopes: string[], now: Date): Promise<IdentityResult<Delegation>> {
      const row = rows.get(id);
      if (!row || row.userId !== userId || row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
        return { ok: false, error: { kind: "not_found" } };
      }
      row.scopes = [...scopes];
      return { ok: true, value: strip(row) };
    },

    async touch(id: string, now: Date, staleBefore: Date): Promise<IdentityResult<boolean>> {
      const row = rows.get(id);
      if (!row) return { ok: true, value: false };
      if (row.lastUsedAt !== null && row.lastUsedAt.getTime() > staleBefore.getTime()) return { ok: true, value: false };
      row.lastUsedAt = now;
      fake._touches += 1;
      return { ok: true, value: true };
    },
  };
  return fake;
}
