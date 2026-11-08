"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AlwaysHaveResponse,
  ExploreRecipe,
  ExploreSource,
  KitchenRecipe,
  PersonRecipesResponse,
  RecipeResponse,
  RecipeSummary,
} from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { refuseIfOffline } from "@/lib/connection";
import { applyPatches, trackWrite } from "@/lib/optimistic";
import { afterWrites, qk, useApiQuery, type AsyncState } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { recipeAddedPatches, recipeRemovedPatches, savedCopyOf } from "./cook-hub";
import { useCopyRecipe, useMyRecipes } from "./recipes-data";
import {
  sendShare,
  sharedToastTitle,
  undoCallFor,
  visibilityAfter,
  visibilityPatches,
  type ShareCall,
  type ShareDeps,
} from "./recipe-share";
import { exploreQuery, type ExploreKind } from "./explore";
import {
  ALWAYS_HAVE_REFRESHES,
  FOOD_ANSWER_REFRESHES,
  alwaysHaveKeys,
  alwaysHavePatches,
  alwaysHaveToast,
  foodAnswerBodies,
  inverseChange,
  type AlwaysHaveChange,
  type FoodAsk,
} from "./always-have";

/**
 * Recipes travel (cookpool-recipes RC-8): the reads and writes behind the
 * share sheet, `/r/<code>`, a person's recipes, Explore, Always have and the
 * food ask, over RC-4's routes.
 *
 * Every write is SM-5's instant write: the screen changes first, the toast
 * offers Undo, a refusal puts it back and says why. Sharing and Always have
 * change what other reads show, so each refreshes them once it lands: a
 * level My recipes, Always have and a food answer every match, Cook now and
 * Explore.
 */

type Client = ReturnType<typeof useSession>["client"];
type QC = ReturnType<typeof useQueryClient>;

async function unwrap<T>(result: Promise<ApiResult<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw r.error;
  return r.data;
}

/** The answer a write gives offline: held back, nothing sent (PW-4). */
const OFFLINE: ApiResult<never> = { ok: false, status: 0, error: { code: "network_error", reason: "offline", message: "You're offline" } };

/** A read whose 404 is an answer (a dead link, someone you no longer share a group with): not retried. */
function useFoundQuery<T>(key: readonly unknown[], load: () => Promise<ApiResult<T>>, enabled: boolean): AsyncState<T> {
  const qc = useQueryClient();
  const q = useQuery<T, ApiErrorBody>({
    queryKey: key,
    queryFn: afterWrites(qc, key, () => unwrap(load())),
    enabled,
    retry: (count, error) => error.code !== "not_found" && count < 1,
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.error ? { code: q.error.code ?? "error", message: q.error.message ?? "Request failed" } : null,
    reload: () => void q.refetch(),
  };
}

// ── Reads ─────────────────────────────────────────────────────────

/** The recipe a link opens (`GET /v1/kitchen/recipe-links/{code}`): anyone signed in; 404 once it is off or rotated. */
export function useRecipeByLink(code: string | null): AsyncState<RecipeResponse> {
  const { client } = useSession();
  return useFoundQuery(qk.kitchenRecipeLink(code ?? ""), () => wrap(() => client.kitchen.recipeByLink(code ?? "")), code !== null);
}

/** A person's recipes you may see (`GET /v1/kitchen/people/{usr}/recipes`): My groups and link ones, newest first. */
export function usePersonRecipes(subjectId: string | null): AsyncState<PersonRecipesResponse> {
  const { client } = useSession();
  return useFoundQuery(qk.kitchenPersonRecipes(subjectId ?? ""), () => wrap(() => client.kitchen.personRecipes(subjectId ?? "")), !!subjectId);
}

/** Explore (`GET /v1/kitchen/recipes?source=&q=&kind=`): each row with its match. The last list stays while the next is read. */
export function useExploreRecipes(source: ExploreSource, q: string, kind: ExploreKind, opts?: { enabled?: boolean }): AsyncState<ExploreRecipe[]> {
  const { client } = useSession();
  const query = exploreQuery(source, q, kind);
  return useApiQuery(
    qk.kitchenExplore(source, query.q ?? "", query.kind ?? "all"),
    () => wrap(async () => (await client.kitchen.exploreRecipes(query)).recipes),
    { keepPrevious: true, ...(opts?.enabled === undefined ? {} : { enabled: opts.enabled }) },
  );
}

/** Your Always have list (`GET /v1/kitchen/me/always-have`): salt and water until you save one. */
export function useAlwaysHave(): AsyncState<AlwaysHaveResponse> {
  const { client } = useSession();
  return useApiQuery(qk.kitchenAlwaysHave(), () => wrap(() => client.kitchen.alwaysHave()));
}

// ── Sharing ───────────────────────────────────────────────────────

function shareDeps(client: Client): ShareDeps {
  return {
    updateRecipe: (id, body) => wrap(() => client.kitchen.updateRecipe(id, body)),
    shareRecipeLink: (id) => wrap(() => client.kitchen.shareRecipeLink(id)),
    stopRecipeLink: (id) => wrap(() => client.kitchen.stopRecipeLink(id)),
  };
}

/** The server's recipe everywhere it shows: its page, and its row on My recipes (then read again). */
function settleShared(qc: QC, r: ApiResult<RecipeResponse>, recipeId: string): void {
  if (r.ok) {
    qc.setQueryData(qk.kitchenRecipe(recipeId), r.data);
    applyPatches(queryCacheOf(qc), visibilityPatches(recipeId, { visibility: r.data.recipe.visibility, linkCode: r.data.recipe.linkCode }));
  } else {
    void qc.invalidateQueries({ queryKey: qk.kitchenRecipe(recipeId), exact: true });
  }
  void qc.invalidateQueries({ queryKey: qk.kitchenMyRecipes() });
}

/**
 * Who can see your recipe (design §5.1): a level, New link or Turn off.
 *
 * A level and Turn off change the sheet at once and offer Undo, which sends
 * the level it was before (`undoCallFor`) — back to the link mints a new
 * code, since the server can't revive an old one. New link waits for the
 * new code ("Making a link…" meanwhile) and has no Undo: the old code is
 * gone the moment it is rotated, so its toast says so.
 */
export function useShareRecipe() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const { toast } = useToast();
  return React.useCallback(
    (input: { recipe: Pick<KitchenRecipe, "id" | "name" | "visibility" | "linkCode">; call: ShareCall }): Promise<ApiResult<RecipeResponse>> => {
      const { recipe, call } = input;
      const deps = shareDeps(client);
      const before = recipe.visibility;
      const after = visibilityAfter(call, before);

      if (call.kind === "rotate") {
        if (refuseIfOffline()) return Promise.resolve(OFFLINE);
        const write = beginWrite(qc, visibilityPatches(recipe.id, { visibility: "link", linkCode: null }));
        return write.track(sendShare(recipe.id, call, deps)).then((r) => {
          if (!r.ok) {
            write.rollback();
            toast(refusedToast("Couldn't make a new link", r.error.message));
            return r;
          }
          settleShared(qc, r, recipe.id);
          toast({ kind: "success", title: "New link", description: "The old one no longer works" });
          return r;
        });
      }

      const keepCode = after === "link" && before === "link" ? recipe.linkCode : null;
      const write = beginWrite(qc, visibilityPatches(recipe.id, { visibility: after, linkCode: keepCode }));
      const sent = write.track(sendShare(recipe.id, call, deps));
      const back = undoCallFor(call, before);
      let undone = false;
      const handle = offer({
        title: call.kind === "off" ? "Link off" : sharedToastTitle(after),
        description: call.kind === "off" ? `${recipe.name} · your groups can still see it` : recipe.name,
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok || !back) return { ok: true };
          const u = await trackWrite(qc, sendShare(recipe.id, back, deps));
          settleShared(qc, u, recipe.id);
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
        restore: () => {
          undone = true;
          // Back to the link waits for its new code.
          write.restore(visibilityPatches(recipe.id, { visibility: before, linkCode: null }));
        },
      });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          void qc.invalidateQueries({ queryKey: qk.kitchenRecipe(recipe.id), exact: true });
          handle.refuse(refusedToast(`Couldn't change who sees ${recipe.name}`, r.error.message));
          return r;
        }
        if (!undone) settleShared(qc, r, recipe.id);
        return r;
      });
    },
    [client, qc, offer, toast],
  );
}

// ── Saving a copy ─────────────────────────────────────────────────

/**
 * Save on a row (a person's recipes, Explore, a feed card): your copy, at
 * once with the Undo toast (`useCopyRecipe`). `savedId` is your copy — one
 * you saved before, or this one once the server has written it — and
 * `saving` while it is on its way.
 */
export function useSaveCopy(recipe: Pick<RecipeSummary, "id" | "name">, code: string | null = null) {
  const mine = useMyRecipes();
  const copy = useCopyRecipe();
  const [state, setState] = React.useState<{ kind: "idle" } | { kind: "saving" } | { kind: "saved"; id: string }>({ kind: "idle" });
  const existing = savedCopyOf(recipe.id, mine.data);
  const savedId = state.kind === "saved" ? state.id : existing;
  const save = React.useCallback(() => {
    setState({ kind: "saving" });
    void copy({ recipe, code, onUndone: () => setState({ kind: "idle" }) }).then((r) => {
      setState((cur) => (cur.kind !== "saving" ? cur : r.ok ? { kind: "saved", id: r.data.recipe.id } : { kind: "idle" }));
    });
  }, [copy, recipe, code]);
  return { savedId: state.kind === "saving" ? null : savedId, saving: state.kind === "saving", save };
}

/**
 * The link page's Save to my recipes (`POST …/copies` with `{ linkCode }`):
 * it reads "Saved · Undo" at once, and that button is the Undo — it deletes
 * the copy. No toast: the button says it.
 */
export function useLinkCopy(code: string, recipe: Pick<RecipeSummary, "id" | "name">) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [saved, setSaved] = React.useState<{ copyId: string | null; sent: Promise<ApiResult<RecipeResponse>> } | null>(null);

  const save = React.useCallback(() => {
    if (refuseIfOffline()) return;
    const sent = trackWrite(qc, wrap(() => client.kitchen.copyRecipe({ linkCode: code }, { idempotencyKey: crypto.randomUUID() })));
    setSaved({ copyId: null, sent });
    void sent.then((r) => {
      if (!r.ok) {
        setSaved((cur) => (cur?.sent === sent ? null : cur));
        toast(refusedToast(`Couldn't save ${recipe.name}`, r.error.message));
        return;
      }
      qc.setQueryData(qk.kitchenRecipe(r.data.recipe.id), r.data);
      applyPatches(queryCacheOf(qc), recipeAddedPatches(r.data.recipe));
      void qc.invalidateQueries({ queryKey: qk.kitchenMyRecipes() });
      void qc.invalidateQueries({ queryKey: qk.kitchenCookNow() });
      setSaved((cur) => (cur?.sent === sent ? { copyId: r.data.recipe.id, sent } : cur));
    });
  }, [client, qc, toast, code, recipe.name]);

  const undo = React.useCallback(() => {
    const current = saved;
    if (!current) return;
    setSaved(null);
    void current.sent.then(async (r) => {
      if (!r.ok) return;
      applyPatches(queryCacheOf(qc), recipeRemovedPatches(r.data.recipe.id));
      const d = await trackWrite(qc, wrap(() => client.kitchen.deleteRecipe(r.data.recipe.id)));
      qc.removeQueries({ queryKey: qk.kitchenRecipe(r.data.recipe.id), exact: true });
      void qc.invalidateQueries({ queryKey: qk.kitchenMyRecipes() });
      void qc.invalidateQueries({ queryKey: qk.kitchenCookNow() });
      if (!d.ok) toast({ kind: "error", title: "Couldn't undo it", description: d.error.message });
    });
  }, [client, qc, toast, saved]);

  return { savedHere: saved ? { copyId: saved.copyId } : null, save, undo };
}

// ── Always have ───────────────────────────────────────────────────

/** Read again what Always have and a food answer change: every match, Cook now, Explore. */
function refreshMatches(qc: QC, keys: readonly (readonly unknown[])[]): void {
  for (const key of keys) void qc.invalidateQueries({ queryKey: key });
}

/**
 * Add a food to Always have, or take one off (design §3.4): the chips change
 * at once, the whole list is PUT, and the toast offers Undo — the other way
 * round, PUT again. The PUTs go one after another, so two quick edits land in
 * order. False when nothing changed (not read yet, already there, offline).
 */
export function useEditAlwaysHave() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const chain = React.useRef<Promise<unknown>>(Promise.resolve());
  return React.useCallback(
    (change: AlwaysHaveChange): boolean => {
      const key = qk.kitchenAlwaysHave();
      const before = qc.getQueryData<AlwaysHaveResponse>(key);
      if (!before) return false;
      const write = beginWrite(qc, alwaysHavePatches(change));
      const now = qc.getQueryData<AlwaysHaveResponse>(key);
      if (!now || now === before) {
        write.rollback();
        return false;
      }
      const put = (list: AlwaysHaveResponse): Promise<ApiResult<AlwaysHaveResponse>> => {
        const p = chain.current.then(() => wrap(() => client.kitchen.setAlwaysHave(alwaysHaveKeys(list))));
        chain.current = p.catch(() => undefined);
        return write.track(p);
      };
      const sent = put(now);
      let undone = false;
      const handle = offer({
        title: alwaysHaveToast(change),
        description: "Always have",
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const list = qc.getQueryData<AlwaysHaveResponse>(key);
          if (!list) return { ok: true };
          const u = await put(list);
          if (u.ok) qc.setQueryData(key, u.data);
          else void qc.invalidateQueries({ queryKey: key });
          refreshMatches(qc, ALWAYS_HAVE_REFRESHES);
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
        restore: () => {
          undone = true;
          write.restore(alwaysHavePatches(inverseChange(change)));
        },
      });
      void sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          void qc.invalidateQueries({ queryKey: key });
          handle.refuse(refusedToast("Couldn't change Always have", r.error.message));
          return;
        }
        if (!undone) qc.setQueryData(key, r.data);
        refreshMatches(qc, ALWAYS_HAVE_REFRESHES);
      });
      return true;
    },
    [client, qc, offer],
  );
}

// ── The food ask ──────────────────────────────────────────────────

/** Names answered this visit (by `askKey`): the ask doesn't come back before the match is read again. */
const answeredNames = new Set<string>();

/** The names answered so far, for `foodAsks`. */
export function useAnsweredNames(): [ReadonlySet<string>, (nameKey: string) => void] {
  const [answered, setAnswered] = React.useState<ReadonlySet<string>>(() => new Set(answeredNames));
  const add = React.useCallback((nameKey: string) => {
    answeredNames.add(nameKey);
    setAnswered(new Set(answeredNames));
  }, []);
  return [answered, add];
}

/**
 * "Is Kanda onion onion?" — Yes links that name to the food, No answers
 * "none of these" (`foodKey: null`); one PUT per pantry holding the name,
 * each with its owner (`orgId`, or none for your own). Then every match,
 * Cook now and Explore are read again. True when every answer landed.
 */
export function useAnswerFood() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    async (ask: FoodAsk, yes: boolean): Promise<boolean> => {
      if (refuseIfOffline()) return false;
      const results = await Promise.all(foodAnswerBodies(ask, yes).map((body) => trackWrite(qc, wrap(() => client.kitchen.setFoodAnswer(body)))));
      refreshMatches(qc, FOOD_ANSWER_REFRESHES);
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) {
        toast(refusedToast("Couldn't save that", failed.error.message));
        return false;
      }
      return true;
    },
    [client, qc, toast],
  );
}
