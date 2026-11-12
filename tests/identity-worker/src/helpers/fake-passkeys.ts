import type {
  CreatePasskeyChallengeInput,
  CreatePasskeyInput,
  IdentityResult,
  Passkey,
  PasskeyChallenge,
  PasskeyChallengeKind,
  PasskeysRepository,
} from "@saas/db/identity";

/**
 * An in-memory PasskeysRepository with the same conditions as the D1 one
 * (tests/db runs those statements against SQLite): the limit counted with the
 * insert, a unique credential id, a challenge used once and only before it
 * expires, and a sign count moved only from the value it was read at.
 */
export function createFakePasskeys(): PasskeysRepository & {
  _rows: Map<string, Passkey>;
  _challenges: Map<string, PasskeyChallenge>;
} {
  const rows = new Map<string, Passkey>();
  const challenges = new Map<string, PasskeyChallenge>();
  const copy = (p: Passkey): Passkey => ({ ...p, transports: [...p.transports] });

  return {
    _rows: rows,
    _challenges: challenges,

    async create(input: CreatePasskeyInput): Promise<IdentityResult<Passkey>> {
      const all = [...rows.values()];
      if (rows.has(input.id) || all.some((p) => p.credentialId === input.credentialId)) {
        return { ok: false, error: { kind: "conflict", entity: "passkey" } };
      }
      if (all.filter((p) => p.userId === input.userId).length >= input.limit) {
        return { ok: false, error: { kind: "conflict", entity: "passkey_limit" } };
      }
      const row: Passkey = {
        id: input.id,
        userId: input.userId,
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        signCount: input.signCount,
        transports: [...input.transports],
        aaguid: input.aaguid,
        deviceName: input.deviceName,
        backedUp: input.backedUp,
        createdAt: input.createdAt,
        lastUsedAt: null,
      };
      rows.set(row.id, row);
      return { ok: true, value: copy(row) };
    },

    async listForUser(userId: string): Promise<IdentityResult<Passkey[]>> {
      const mine = [...rows.values()]
        .filter((p) => p.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
      return { ok: true, value: mine.map(copy) };
    },

    async countForUser(userId: string): Promise<IdentityResult<number>> {
      return { ok: true, value: [...rows.values()].filter((p) => p.userId === userId).length };
    },

    async getByCredentialId(credentialId: string): Promise<IdentityResult<Passkey>> {
      const found = [...rows.values()].find((p) => p.credentialId === credentialId);
      return found ? { ok: true, value: copy(found) } : { ok: false, error: { kind: "not_found" } };
    },

    async recordUse(id, expectedSignCount, signCount, backedUp, usedAt): Promise<IdentityResult<Passkey>> {
      const row = rows.get(id);
      if (!row || row.signCount !== expectedSignCount) return { ok: false, error: { kind: "not_found" } };
      row.signCount = signCount;
      row.backedUp = backedUp;
      row.lastUsedAt = usedAt;
      return { ok: true, value: copy(row) };
    },

    async remove(id: string, userId: string): Promise<IdentityResult<Passkey>> {
      const row = rows.get(id);
      if (!row || row.userId !== userId) return { ok: false, error: { kind: "not_found" } };
      rows.delete(id);
      return { ok: true, value: copy(row) };
    },

    async createChallenge(input: CreatePasskeyChallengeInput): Promise<IdentityResult<PasskeyChallenge>> {
      for (const [k, c] of challenges) if (c.expiresAt.getTime() < input.pruneBefore.getTime()) challenges.delete(k);
      const row: PasskeyChallenge = {
        id: input.id,
        kind: input.kind,
        userId: input.userId,
        challenge: input.challenge,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        usedAt: null,
      };
      challenges.set(row.challenge, row);
      return { ok: true, value: { ...row } };
    },

    async consumeChallenge(
      challenge: string,
      kind: PasskeyChallengeKind,
      userId: string | null,
      now: Date,
    ): Promise<IdentityResult<PasskeyChallenge>> {
      const row = challenges.get(challenge);
      if (
        !row ||
        row.kind !== kind ||
        row.userId !== userId ||
        row.usedAt !== null ||
        row.expiresAt.getTime() <= now.getTime()
      ) {
        return { ok: false, error: { kind: "not_found" } };
      }
      row.usedAt = now;
      return { ok: true, value: { ...row } };
    },
  };
}
