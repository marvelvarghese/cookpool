"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { KitchenItem, RecipeMatchResponse, RecipeResponse } from "@saas/contracts/kitchen";
import { wrap } from "@/lib/api";
import { isOffline } from "@/lib/connection";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { useToast } from "@/components/ui/toast";
import { refreshAfterDish, useCookableItems } from "./dish-maker-data";
import { refreshPantry, useItemsByRef } from "./pantry-data";
import { itemRefParam } from "./pantry";
import { undoFailed, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { JUST_ME, cookedText } from "./dish-maker";
import { refreshTakes, runFinish, takeRefsToRead, type CookSession, type FinishOutcome, type FinishPlan } from "./cook-session";

/**
 * The cooking session's reads and its one Finish (cookpool-recipes RC-6),
 * through RC-4's SDK: the recipe with the caller's last cook of it, and the
 * match at the session's factor (what each line would take, from which
 * items) — and Finish's writes in order (`runFinish`): the existing cook
 * write, the shares, the recipe write. Once cooked, every read it changed is
 * refreshed and the toast offers Undo for ten seconds, which cancels the dish
 * through the existing cancel route (SM-5).
 */

/**
 * A recipe the caller may see, with their last cook of it ("last time") —
 * read at the session's size `f` (cookpool-guided GC-7: its steps' learned
 * ranges come at that size). Its own key under the recipe's, so the recipe
 * page's read (as written) is not mixed up with it, and refreshing the
 * recipe refreshes both.
 */
export function useRecipe(recipeId: string | null, f?: number) {
  const { client } = useSession();
  return useApiQuery<RecipeResponse>(
    f === undefined ? qk.kitchenRecipe(recipeId ?? "") : [...qk.kitchenRecipe(recipeId ?? ""), "f", f],
    () => wrap(() => client.kitchen.getRecipe(recipeId ?? "", f === undefined ? {} : { f })),
    { enabled: recipeId !== null },
  );
}

/** What the caller's pantries hold for each of its lines at factor `f`, and the items each would take. */
export function useRecipeMatch(recipeId: string | null, f: number) {
  const { client } = useSession();
  return useApiQuery<RecipeMatchResponse>(
    qk.kitchenRecipeMatch(recipeId ?? "", f),
    () => wrap(() => client.kitchen.recipeMatch(recipeId ?? "", { f })),
    { enabled: recipeId !== null },
  );
}

/**
 * The items the session takes from, as read now (someone may have used some
 * meanwhile): the usable-items list, else each one on its own — written back
 * into the draft (`refreshTakes`) for what they cost and what is left. RC-6's
 * screen and guided mode (GC-5) both keep their lines fresh with it.
 */
export function useFreshTakes(session: CookSession, save: (change: (s: CookSession) => CookSession) => void): void {
  const cookable = useCookableItems();
  const listed = React.useMemo(() => new Map<string, KitchenItem>((cookable.data ?? []).map((i) => [i.id, i] as const)), [cookable.data]);
  const listedIds = React.useMemo(() => new Set(listed.keys()), [listed]);
  const listReady = cookable.data !== null || cookable.error !== null;
  const toRead = listReady ? takeRefsToRead(session, listedIds) : [];
  const toReadKey = toRead.map(itemRefParam).join(",");
  const refs = React.useMemo(() => toRead, [toReadKey]);
  const read = useItemsByRef(refs);
  const readKey = [...read.entries()].map(([id, item]) => `${id}:${item ? `${item.version}:${item.qtyLeftMilli}` : "x"}`).join(",");
  // What the draft holds of each item: a line picked or added since needs its item too.
  const takesKey = session.lines
    .flatMap((l) => l.takes.map((t) => `${t.itemId}:${t.gone ? "x" : t.item ? `${t.item.version}:${t.item.qtyLeftMilli}` : "?"}`))
    .join(",");
  React.useEffect(() => {
    const fresh = new Map<string, KitchenItem | null>(listed);
    for (const [id, item] of read) if (!fresh.has(id)) fresh.set(id, item);
    if (fresh.size > 0) save((s) => refreshTakes(s, fresh));
    // `read` is a new map each render; the keys say when it, or the draft's items, changed.
  }, [listed, readKey, takesKey, save]);
}

/**
 * Post a finished session: `runFinish` over the client. A refusal comes back
 * in words (the pantry reads are refreshed, as the dish maker's are); once
 * cooked, the toast "Cooked Chicken curry · ₹143.96 · Flat 4B" offers Undo,
 * and a shares or recipe write that failed says so in a second toast. The
 * caller clears the draft and opens the dish.
 */
export function useFinishSession() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const offerUndo = useUndoToast();
  // One key per attempt: a refusal is stored against its key at the edge, so the next try needs a new one.
  const cookKey = React.useRef<string | null>(null);
  return React.useCallback(
    async (plan: FinishPlan, groupName: string | null): Promise<FinishOutcome> => {
      cookKey.current ??= crypto.randomUUID();
      const key = cookKey.current;
      const out = await runFinish(plan, {
        offline: () => isOffline(),
        cookDish: (request) => wrap(() => client.kitchen.cookDish(request, { idempotencyKey: key })),
        setShares: (orgId, dishId, body) =>
          wrap(() => client.kitchen.setDishShares(orgId, dishId, body, { idempotencyKey: crypto.randomUUID() })),
        updateRecipe: (recipeId, body) => wrap(() => client.kitchen.updateRecipe(recipeId, body, { idempotencyKey: crypto.randomUUID() })),
        createRecipe: (body) => wrap(() => client.kitchen.createRecipe(body, { idempotencyKey: crypto.randomUUID() })),
      });
      if (!out.ok) {
        if (out.kind === "refused") {
          refreshPantry(qc, null);
          if (out.answered) cookKey.current = null;
        }
        return out;
      }
      cookKey.current = null;
      const dish = out.dish;
      refreshAfterDish(qc, dish);
      // The recipe's last cook, My recipes' order (last cooked first) and Cook now.
      if (plan.recipe) {
        void qc.invalidateQueries({ queryKey: qk.kitchenRecipeBook() });
        void qc.invalidateQueries({ queryKey: qk.kitchenCookNow() });
      }
      const text = cookedText({
        name: dish.name,
        share: dish.orgId ?? JUST_ME,
        groupName,
        mode: dish.splitMode,
        totalMinor: dish.totalMinor,
        currency: dish.currency,
      });
      offerUndo({
        title: text.title,
        undo: async (): Promise<UndoResult> => {
          const c = await wrap(() => client.kitchen.cancelDish(dish.id, { idempotencyKey: crypto.randomUUID() }));
          refreshAfterDish(qc, dish);
          if (c.ok) return { ok: true, description: `${dish.name} is canceled: everything is back in its pantry.` };
          if (c.error.reason === "dish_not_open") return { ok: false, kind: "warning", title: "It's finalized now", description: "Correct it on the dish page instead." };
          return undoFailed(c.error);
        },
      });
      if (out.sharesError) toast({ kind: "warning", title: "Who ate wasn't saved", description: out.sharesError });
      if (out.recipeError) toast({ kind: "warning", title: "The recipe wasn't saved", description: out.recipeError });
      return out;
    },
    [client, qc, toast, offerUndo],
  );
}
