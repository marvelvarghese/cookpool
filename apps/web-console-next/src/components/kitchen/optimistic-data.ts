"use client";

import type { QueryClient } from "@tanstack/react-query";
import {
  applyPatches,
  rollbackPatches,
  trackWrite,
  type CacheKey,
  type CacheLike,
  type CachePatch,
  type PatchedEntry,
} from "@/lib/optimistic";
import { refuseIfOffline } from "@/lib/connection";

/**
 * Writes that show at once (Cookpool SM-5), over the QueryClient: React
 * Query's optimistic update — the patch before the request (`onMutate`), the
 * exact rollback when it is refused (`onError`), and reading again what it
 * touched once it answers (`onSettled`) — as one handle the write hooks
 * share (pantry-data, dish-data, ledger-data, settle-card).
 */

/** The cache, as `src/lib/optimistic.ts` patches it. */
export function queryCacheOf(qc: QueryClient): CacheLike {
  return {
    entries: (prefix) => qc.getQueriesData({ queryKey: prefix }),
    get: (key) => qc.getQueryData(key),
    set: (key, data) => {
      qc.setQueryData(key, data);
    },
  };
}

export interface OptimisticWrite {
  /** More changes for the same write (a burst of taps): one rollback undoes them all. */
  patch: (patches: readonly CachePatch[]) => void;
  /** The server refused: every read the write changed holds exactly what it did before; any changed since is read again. */
  rollback: () => void;
  /**
   * Undo, pressed: put the screen back now — exactly where nothing changed
   * since the write, and by `revert` (the inverse patches) where the server's
   * answer arrived meanwhile.
   */
  restore: (revert?: readonly CachePatch[]) => void;
  /** The request: while it is on its way, refreshes wait for it (they would bring back the old screen). */
  track: <T>(request: Promise<T>) => Promise<T>;
}

/**
 * A write held back offline (Cookpool PW-4): it changes nothing on screen,
 * has nothing to roll back or restore, and is not counted as on its way —
 * its request is refused by the API client before anything is sent.
 */
const HELD_BACK: OptimisticWrite = Object.freeze({
  patch: () => undefined,
  rollback: () => undefined,
  restore: () => undefined,
  track: <T,>(request: Promise<T>) => request,
});

/**
 * Stop a refresh already on its way to `patches`' reads from landing on top
 * of them, then patch them. A read with nothing in it yet is left loading.
 *
 * Offline (Cookpool PW-4) the write is held back at once: no patch, and the
 * one-line toast "You're offline · nothing was logged" (`refuseIfOffline`).
 * The handle it returns does nothing, the Undo toast offers nothing
 * (`useUndoToast`), and the request is refused unsent (`lib/api.ts`).
 * Nothing is queued.
 */
export function beginWrite(qc: QueryClient, patches: readonly CachePatch[]): OptimisticWrite {
  if (refuseIfOffline()) return HELD_BACK;
  const cache = queryCacheOf(qc);
  const entries: PatchedEntry[] = [];
  const apply = (list: readonly CachePatch[]) => {
    for (const p of list) {
      for (const [key, data] of qc.getQueriesData({ queryKey: p.prefix })) {
        if (data !== undefined && qc.isFetching({ queryKey: key, exact: true }) > 0) void qc.cancelQueries({ queryKey: key, exact: true });
      }
    }
    applyPatches(cache, list, entries);
  };
  const refetch = (keys: readonly CacheKey[]) => {
    for (const key of keys) void qc.invalidateQueries({ queryKey: key, exact: true });
  };
  let rolledBack = false;
  apply(patches);
  return {
    patch: (list) => {
      if (!rolledBack) apply(list);
    },
    rollback: () => {
      if (rolledBack) return;
      rolledBack = true;
      refetch(rollbackPatches(cache, entries));
    },
    restore: (revert = []) => {
      if (rolledBack) return;
      rolledBack = true;
      // A refresh already on its way (the write's own, once it answered) would
      // bring back what the Undo is taking away: stop it first.
      for (const e of entries) {
        if (qc.isFetching({ queryKey: e.key, exact: true }) > 0) void qc.cancelQueries({ queryKey: e.key, exact: true });
      }
      const stale = rollbackPatches(cache, entries);
      if (stale.length === 0 || revert.length === 0) return;
      // Only the reads that already hold the server's answer get the inverse.
      const only = (key: CacheKey) => stale.some((k) => JSON.stringify(k) === JSON.stringify(key));
      applyPatches(
        cache,
        revert.map((p) => ({ prefix: p.prefix, update: (d, key) => (only(key) ? p.update(d, key) : d) })),
      );
    },
    track: (request) => trackWrite(qc, request),
  };
}
