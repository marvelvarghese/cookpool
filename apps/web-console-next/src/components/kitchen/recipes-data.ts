"use client";

import * as React from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CookNowEntry,
  CreateRecipeRequest,
  FoodMatch,
  KitchenRecipe,
  RecipeMatchResponse,
  RecipeResponse,
  RecipeSummary,
} from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { isOffline, refuseIfOffline } from "@/lib/connection";
import { applyPatches, trackWrite } from "@/lib/optimistic";
import { afterWrites, qk, useApiQuery, type AsyncState } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { UNDO_MS, refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { recipeAddedPatches, recipeRemovedPatches } from "./cook-hub";

/**
 * Recipes' reads and writes (cookpool-recipes RC-5) over the RC-4 routes:
 * My recipes, a recipe in full, what your pantries hold for it at a factor
 * (the match), Cook now and the food list; writing, editing and deleting a
 * recipe, saving your own copy and saving a dish as one.
 *
 * The match and Cook now sit under `qk.kitchenPantry()`, so any stock write
 * reads them again; a recipe write reads My recipes, Cook now and its
 * matches again. Deleting offers Undo (SM-5's pattern): the recipe leaves
 * every list at once, and the delete is sent when the Undo has gone.
 */

type Client = ReturnType<typeof useSession>["client"];

export function loadMyRecipes(client: Client) {
  return wrap(async () => (await client.kitchen.myRecipes()).recipes);
}

export function loadRecipe(client: Client, recipeId: string, code?: string | null) {
  return wrap(() => client.kitchen.getRecipe(recipeId, code ? { code } : {}));
}

function loadMatch(client: Client, recipeId: string, factorMilli: number, code?: string | null) {
  return wrap(() => client.kitchen.recipeMatch(recipeId, code ? { f: factorMilli, code } : { f: factorMilli }));
}

function loadCookNow(client: Client) {
  return wrap(async () => (await client.kitchen.cookNow()).recipes);
}

async function unwrap<T>(result: Promise<ApiResult<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw r.error;
  return r.data;
}

/** Yours and your copies (`GET /v1/kitchen/me/recipes`). */
export function useMyRecipes(opts?: { enabled?: boolean }): AsyncState<RecipeSummary[]> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenMyRecipes(), () => loadMyRecipes(client), opts);
}

/** What you can make now (`GET /v1/kitchen/me/cook-now`): fewest missing first. */
export function useCookNow(opts?: { enabled?: boolean }): AsyncState<CookNowEntry[]> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenCookNow(), () => loadCookNow(client), opts);
}

/** One recipe in full, with your last cook of it; `code` lets a link holder in. Not found is not retried. */
export function useRecipe(recipeId: string | null, code?: string | null): AsyncState<RecipeResponse> {
  const { client } = useSession();
  const qc = useQueryClient();
  const key = qk.kitchenRecipe(recipeId ?? "");
  const q = useQuery<RecipeResponse, ApiErrorBody>({
    queryKey: key,
    queryFn: afterWrites(qc, key, () => unwrap(loadRecipe(client, recipeId ?? "", code))),
    enabled: recipeId !== null,
    retry: (count, error) => error.code !== "not_found" && count < 1,
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.error ? { code: q.error.code ?? "error", message: q.error.message ?? "Request failed" } : null,
    reload: () => void q.refetch(),
  };
}

/**
 * What your pantries hold for a recipe at a factor. While another factor's
 * answer is on its way the last one stays on screen (its words for each
 * line hold; only have and short may change).
 */
export function useRecipeMatch(recipeId: string | null, factorMilli: number, code?: string | null): AsyncState<RecipeMatchResponse> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenRecipeMatch(recipeId ?? "", factorMilli), () => loadMatch(client, recipeId ?? "", factorMilli, code), {
    enabled: recipeId !== null,
    keepPrevious: true,
  });
}

/** Recipes read in full (for their ingredients' names on My recipes' cards), by id, as they arrive. */
export function useRecipesInFull(recipeIds: readonly string[]): ReadonlyMap<string, KitchenRecipe> {
  const { client } = useSession();
  const results = useQueries({
    queries: recipeIds.map((id) => ({
      queryKey: qk.kitchenRecipe(id),
      queryFn: () => unwrap(loadRecipe(client, id)),
      retry: false,
    })),
  });
  const recipes = results.map((r) => (r.data as RecipeResponse | undefined)?.recipe ?? null);
  const stamp = recipes.map((r) => (r ? `${r.id}:${r.updatedAt}` : "")).join("|");
  return React.useMemo(
    () => new Map(recipes.filter((r): r is KitchenRecipe => r !== null).map((r) => [r.id, r] as const)),
    // Read again only when a recipe arrives or changes (`results` is a new array every render).
    [stamp],
  );
}

/** The food list for typed words (`GET /v1/kitchen/foods?q=`): the closest names first. */
export function useFoods(q: string): AsyncState<FoodMatch[]> {
  const { client } = useSession();
  const text = q.trim();
  return useApiQuery(qk.kitchenFoods(text), () => wrap(async () => (await client.kitchen.foods({ q: text, limit: 6 })).foods), {
    enabled: text.length > 0,
    keepPrevious: true,
  });
}

/** Warm a recipe's page (on press, as the dish and item pages are). */
export function usePrefetchRecipe(): (recipeId: string) => void {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    (recipeId: string) => {
      void qc.prefetchQuery({ queryKey: qk.kitchenRecipe(recipeId), queryFn: () => unwrap(loadRecipe(client, recipeId)) });
    },
    [client, qc],
  );
}

// ── Writes ────────────────────────────────────────────────────────

/** After a recipe write: every list of recipes, Cook now and that recipe's matches are read again. */
function refreshAfter(qc: ReturnType<typeof useQueryClient>, recipeId: string | null): void {
  void qc.invalidateQueries({ queryKey: qk.kitchenMyRecipes() });
  void qc.invalidateQueries({ queryKey: qk.kitchenCookNow() });
  if (recipeId) void qc.invalidateQueries({ queryKey: qk.kitchenRecipeMatches(recipeId) });
}

/** The answer a write gives offline: held back, nothing sent (PW-4). */
const OFFLINE: ApiResult<never> = { ok: false, status: 0, error: { code: "network_error", reason: "offline", message: "You're offline" } };

/**
 * Save the recipe form: POST a new recipe, or PATCH yours (`lines` and
 * `steps` replace the whole list). It waits for the server, so a 422's
 * field errors can land on the form; the saved recipe is then the cached
 * one, so its page opens at once.
 */
export function useSaveRecipe() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (input: { recipeId: string | null; body: CreateRecipeRequest }): Promise<ApiResult<RecipeResponse>> => {
      if (refuseIfOffline()) return OFFLINE;
      const request = input.recipeId
        ? wrap(() => client.kitchen.updateRecipe(input.recipeId!, input.body))
        : wrap(() => client.kitchen.createRecipe(input.body, { idempotencyKey: crypto.randomUUID() }));
      const r = await trackWrite(qc, request);
      if (r.ok) {
        qc.setQueryData(qk.kitchenRecipe(r.data.recipe.id), r.data);
        applyPatches(queryCacheOf(qc), recipeAddedPatches(r.data.recipe));
        refreshAfter(qc, r.data.recipe.id);
      }
      return r;
    },
    [client, qc],
  );
}

/**
 * Save a finished dish as a recipe (`POST /v1/kitchen/me/recipes` with
 * `fromDishId`): its ingredients at the amounts used, its portions as
 * serves, the heaviest as the main line. The new recipe is cached, so its
 * page opens at once.
 */
export function useSaveDishAsRecipe() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (dishId: string): Promise<ApiResult<RecipeResponse>> => {
      if (refuseIfOffline()) return OFFLINE;
      const r = await trackWrite(qc, wrap(() => client.kitchen.createRecipe({ fromDishId: dishId }, { idempotencyKey: crypto.randomUUID() })));
      if (r.ok) {
        qc.setQueryData(qk.kitchenRecipe(r.data.recipe.id), r.data);
        applyPatches(queryCacheOf(qc), recipeAddedPatches(r.data.recipe));
        refreshAfter(qc, r.data.recipe.id);
      }
      return r;
    },
    [client, qc],
  );
}

/**
 * Save your own copy of someone's recipe (design §5.2): Only me, "from Anu".
 * The toast shows at once, with Undo — which deletes the copy. `onUndone`
 * is told when Undo is pressed, so the button reads Save again.
 */
export function useCopyRecipe() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: { recipe: Pick<RecipeSummary, "id" | "name">; code: string | null; onUndone: () => void }): Promise<ApiResult<RecipeResponse>> => {
      if (refuseIfOffline()) return Promise.resolve(OFFLINE);
      const { recipe, code } = input;
      const sent = trackWrite(
        qc,
        wrap(() => client.kitchen.copyRecipe(code ? { linkCode: code } : { recipeId: recipe.id }, { idempotencyKey: crypto.randomUUID() })),
      );
      const toast = offer({
        title: `Saved ${recipe.name}`,
        description: "It's in My recipes",
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          // Off My recipes at once, so nothing reads "Saved" while the delete is on its way.
          applyPatches(queryCacheOf(qc), recipeRemovedPatches(r.data.recipe.id));
          const d = await trackWrite(qc, wrap(() => client.kitchen.deleteRecipe(r.data.recipe.id)));
          qc.removeQueries({ queryKey: qk.kitchenRecipe(r.data.recipe.id), exact: true });
          refreshAfter(qc, null);
          return d.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: d.error.message };
        },
        restore: input.onUndone,
      });
      return sent.then((r) => {
        if (!r.ok) {
          toast.refuse(refusedToast(`Couldn't save ${recipe.name}`, r.error.message));
          return r;
        }
        qc.setQueryData(qk.kitchenRecipe(r.data.recipe.id), r.data);
        applyPatches(queryCacheOf(qc), recipeAddedPatches(r.data.recipe));
        refreshAfter(qc, null);
        return r;
      });
    },
    [client, qc, offer],
  );
}

/**
 * Delete your recipe, with Undo instead of a confirm (SM-5): it leaves My
 * recipes and Cook now at once, and the toast offers Undo for ten seconds.
 * The server has no undelete, so the DELETE is sent when the Undo has gone —
 * or at once if the page is closed meanwhile. Undo puts it back on every
 * list. False when nothing happened (offline: held back).
 */
export function useDeleteRecipe() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const { toast } = useToast();
  return React.useCallback(
    (recipe: Pick<RecipeSummary, "id" | "name">): boolean => {
      if (isOffline()) {
        refuseIfOffline();
        return false;
      }
      const write = beginWrite(qc, recipeRemovedPatches(recipe.id));
      let undone = false;
      let sent: Promise<ApiResult<RecipeResponse>> | null = null;
      const send = (): void => {
        if (undone || sent) return;
        if (typeof window !== "undefined") window.removeEventListener("pagehide", send);
        sent = write.track(wrap(() => client.kitchen.deleteRecipe(recipe.id)));
        void sent.then((r) => {
          if (r.ok || r.error.code === "not_found") {
            qc.removeQueries({ queryKey: qk.kitchenRecipe(recipe.id), exact: true });
            refreshAfter(qc, null);
            return;
          }
          write.rollback();
          refreshAfter(qc, recipe.id);
          toast(refusedToast(`Couldn't delete ${recipe.name}`, r.error.message));
        });
      };
      const timer = setTimeout(send, UNDO_MS);
      if (typeof window !== "undefined") window.addEventListener("pagehide", send);
      offer({
        title: `Deleted ${recipe.name}`,
        undo: async (): Promise<UndoResult> => {
          if (!sent) return { ok: true };
          const r = await sent;
          return r.ok ? { ok: false, kind: "warning", title: "Already deleted" } : { ok: true };
        },
        restore: () => {
          if (sent) return;
          undone = true;
          clearTimeout(timer);
          if (typeof window !== "undefined") window.removeEventListener("pagehide", send);
          write.restore();
          // Nothing was sent: a read now has it back wherever the patch was overtaken.
          refreshAfter(qc, recipe.id);
        },
      });
      return true;
    },
    [client, qc, offer, toast],
  );
}
