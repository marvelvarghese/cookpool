/**
 * Writes that show at once (Cookpool SM-5), the pure half: patch every cached
 * read a write changes the moment it is made, remember what each read held,
 * and put exactly that back if the server refuses.
 *
 * Dependency-free (no React, no react-query) so it is unit-testable: the
 * cache is anything with the three calls below, which `queryCacheOf`
 * (src/components/kitchen/optimistic-data.ts) builds over the QueryClient.
 *
 * Money stays the server's (risk SM-D): a patch only changes the obvious
 * local things — what is left of an item, a portion count, a row added or
 * taken off — and every read a write touched is read again once it answers.
 */

export type CacheKey = readonly unknown[];

/** The cache as a write sees it. */
export interface CacheLike {
  /** Every read whose key starts with `prefix`, with what it holds (undefined while it has nothing yet). */
  entries(prefix: CacheKey): ReadonlyArray<readonly [CacheKey, unknown]>;
  get(key: CacheKey): unknown;
  set(key: CacheKey, data: unknown): void;
}

/**
 * One change to the reads under `prefix`: `update` gets what a read holds
 * and its key, and returns the new value — the same value (`===`) when the
 * read does not show the thing written, so it is left alone.
 */
export interface CachePatch {
  prefix: CacheKey;
  update: (data: unknown, key: CacheKey) => unknown;
}

/** What a write changed in one read: what it held before, and what the write put there. */
export interface PatchedEntry {
  key: CacheKey;
  before: unknown;
  after: unknown;
}

function sameKey(a: CacheKey, b: CacheKey): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || JSON.stringify(v) === JSON.stringify(b[i]));
}

/**
 * Apply `patches` in order and return what changed, one entry per read
 * (several patches on one read keep its first `before`). Reads that hold
 * nothing yet are skipped: there is nothing on screen to change.
 */
export function applyPatches(cache: CacheLike, patches: readonly CachePatch[], into: PatchedEntry[] = []): PatchedEntry[] {
  for (const patch of patches) {
    for (const [key, data] of cache.entries(patch.prefix)) {
      if (data === undefined) continue;
      const current = cache.get(key) ?? data;
      const next = patch.update(current, key);
      if (next === current || next === undefined) continue;
      cache.set(key, next);
      // What the cache keeps (React Query shares structure with the old value,
      // so it may be a different object than `next`).
      const stored = cache.get(key) ?? next;
      const seen = into.find((e) => sameKey(e.key, key));
      if (seen) seen.after = stored;
      else into.push({ key, before: current, after: stored });
    }
  }
  return into;
}

/**
 * Undo what `applyPatches` did: every read still holding what the write put
 * there gets exactly what it held before. A read something else changed
 * since (another write, the server's answer) is not guessed at: it is
 * returned, for the caller to read again.
 */
export function rollbackPatches(cache: CacheLike, entries: readonly PatchedEntry[]): CacheKey[] {
  const stale: CacheKey[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (cache.get(e.key) === e.after) cache.set(e.key, e.before);
    else stale.push(e.key);
  }
  return stale;
}

// ── Writes on their way ────────────────────────────────────────────

const inFlight = new WeakMap<object, Set<Promise<unknown>>>();

/**
 * Count `write` as on its way for `owner` (the QueryClient) until it
 * settles. A read started meanwhile waits for it (`writesSettled`), so a
 * refresh never brings back what the screen showed before the write.
 */
export function trackWrite<T>(owner: object, write: Promise<T>): Promise<T> {
  let set = inFlight.get(owner);
  if (!set) {
    set = new Set();
    inFlight.set(owner, set);
  }
  const mine = set;
  const tracked = write.finally(() => mine.delete(tracked));
  mine.add(tracked);
  tracked.catch(() => undefined);
  return write;
}

/** How many writes are on their way for `owner`. */
export function writesInFlight(owner: object): number {
  return inFlight.get(owner)?.size ?? 0;
}

/** Resolves once no write is on its way for `owner` (at once when none is). */
export async function writesSettled(owner: object): Promise<void> {
  const set = inFlight.get(owner);
  while (set && set.size > 0) await Promise.allSettled([...set]);
}

// ── Rows that are not on the server yet ────────────────────────────

const PENDING = "pending_";

/** An id for a row shown before the server has made it ("pending_…"); never sent anywhere. */
export function pendingId(kind: string, random: () => string = () => Math.random().toString(36).slice(2, 12)): string {
  return `${PENDING}${kind}_${random()}`;
}

/** A row the screen shows while its write is on its way: nothing can be done to it yet. */
export function isPendingId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(PENDING);
}
