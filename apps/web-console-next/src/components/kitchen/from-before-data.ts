"use client";

import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import type { ItemHistoryEntry, Recipe } from "@saas/contracts/kitchen";
import type { KitchenClient } from "@saas/sdk";
import { useSession } from "@/lib/session";
import { qk } from "@/lib/query-keys";
import { FROM_BEFORE_LIMIT, FROM_BEFORE_STALE_MS, fromBeforeTerm } from "./from-before";

/**
 * The "from before" reads (SM-8) behind the type-ahead on Bought and on Cook
 * (SM-9), beside the other kitchen reads: one React Query entry per typed text
 * (`fromBeforeTerm`). Each keeps its answer for `FROM_BEFORE_STALE_MS`, so
 * retyping a prefix answers from the cache; while the next text loads, the
 * last answer stays (`keepPreviousData`), so the list doesn't flash empty;
 * and the request for a text typed past is cancelled — the query function
 * hands React Query's signal to the SDK, which aborts its fetch once nothing
 * watches that text any more. A failed read shows no suggestions (the form
 * works as before), so it is not retried.
 */

/** The answer for `typed`: names bought before, best match first. */
export function itemHistoryQuery(kitchen: Pick<KitchenClient, "itemHistory">, typed: string) {
  const term = fromBeforeTerm(typed);
  return queryOptions<ItemHistoryEntry[]>({
    queryKey: qk.kitchenItemHistory(term),
    queryFn: async ({ signal }) => (await kitchen.itemHistory(term, { limit: FROM_BEFORE_LIMIT }, { signal })).items,
    staleTime: FROM_BEFORE_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** The answer for `typed`: dishes cooked before, best match first, each ingredient matched to an item usable now. */
export function recipesQuery(kitchen: Pick<KitchenClient, "recipes">, typed: string) {
  const term = fromBeforeTerm(typed);
  return queryOptions<Recipe[]>({
    queryKey: qk.kitchenRecipes(term),
    queryFn: async ({ signal }) => (await kitchen.recipes(term, { limit: FROM_BEFORE_LIMIT }, { signal })).recipes,
    staleTime: FROM_BEFORE_STALE_MS,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Names bought before matching `q` (the debounced text); `enabled` false holds the read. */
export function useItemHistory(q: string, enabled = true) {
  const { client } = useSession();
  return useQuery({ ...itemHistoryQuery(client.kitchen, q), enabled });
}

/** Dishes cooked before matching `q` (the debounced text); `enabled` false holds the read. */
export function useRecipes(q: string, enabled = true) {
  const { client } = useSession();
  return useQuery({ ...recipesQuery(client.kitchen, q), enabled });
}
