"use client";

import * as React from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type { ApiResult } from "./api";
import { writesSettled } from "./optimistic";

export { qk } from "./query-keys";

/**
 * Client query cache for the console (Task 0130 / PERF1).
 *
 * `useApiQuery` is the cache-backed replacement for the old bespoke `useAsync`.
 * It keeps the same `{ data, loading, error, reload }` surface so call sites
 * stay small, but adds: a shared cache keyed per resource+scope (so navigating
 * back to a visited page paints instantly from cache), stale-while-revalidate
 * (background refetch), and automatic in-flight request dedupe.
 *
 * The queryFn unwraps the `ApiResult` envelope: on `ok` it returns the data, on
 * error it throws the `{ code, message }` body so react-query records it as an
 * error and we re-surface it in the same shape the UI already consumes.
 */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: { code: string; message: string } | null;
  reload: () => void;
}

/**
 * A read again of something on screen waits for the writes on their way
 * (Cookpool SM-5): they patched it at once, and an answer computed before
 * they land would bring the old screen back for a moment. A first read has
 * nothing to bring back, so it goes at once.
 */
export function afterWrites<T>(qc: QueryClient, key: QueryKey, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    if (qc.getQueryData(key) !== undefined) await writesSettled(qc);
    return fn();
  };
}

export function useApiQuery<T>(
  key: QueryKey,
  fn: () => Promise<ApiResult<T>>,
  opts?: {
    enabled?: boolean;
    /**
     * While another key's answer is on its way (a new search, another
     * pantry), keep showing the last one instead of a skeleton (SM-5).
     * Only for reads where the last answer is a fair stand-in.
     */
    keepPrevious?: boolean;
    /** What to show until the first answer, from other reads already cached (SM-5); undefined for nothing. */
    placeholder?: () => T | undefined;
  },
): AsyncState<T> {
  const qc = useQueryClient();
  const enabled = opts?.enabled ?? true;
  const q = useQuery<T, { code: string; message: string }>({
    queryKey: key,
    queryFn: afterWrites(qc, key, async () => {
      const r = await fn();
      if (!r.ok) throw r.error;
      return r.data;
    }),
    enabled,
    ...(opts?.keepPrevious
      ? { placeholderData: keepPreviousData }
      : opts?.placeholder
        ? { placeholderData: opts.placeholder as unknown as () => undefined }
        : {}),
  });

  return {
    data: (q.data ?? null) as T | null,
    // `isLoading` is true only on the first fetch with no cached data, so a
    // cached navigation paints immediately (no skeleton flash) while a
    // background revalidation runs.
    loading: q.isLoading,
    error: q.error ? { code: q.error.code ?? "error", message: q.error.message ?? "Request failed" } : null,
    reload: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  };
}

/**
 * Prefetch a query into the cache (warm on hover/intent). Safe to call
 * repeatedly — react-query dedupes and respects `staleTime`.
 */
export function prefetchApi<T>(
  qc: QueryClient,
  key: QueryKey,
  fn: () => Promise<ApiResult<T>>,
): void {
  void qc.prefetchQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await fn();
      if (!r.ok) throw r.error;
      return r.data;
    },
  });
}

/** Returns a stable `prefetch(key, fn)` callback bound to the query client. */
export function usePrefetch(): <T>(key: QueryKey, fn: () => Promise<ApiResult<T>>) => void {
  const qc = useQueryClient();
  return React.useCallback(
    <T,>(key: QueryKey, fn: () => Promise<ApiResult<T>>) => prefetchApi(qc, key, fn),
    [qc],
  );
}
