"use client";

import * as React from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { CookDishRequest, KitchenDish, ReachableItem, SetDishSharesRequest } from "@saas/contracts/kitchen";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { useToast } from "@/components/ui/toast";
import { UNDO_MS, refreshLedger } from "./ledger-data";
import { refreshPantry } from "./pantry-data";
import { cookRefusal, sharesRefusal, type CookRefusal, type DishLine } from "./dish-maker";

/**
 * The dish maker's reads and its one write (Cookpool CP-15), through the
 * CP-14/CP-16 SDK: the items the cook may cook with (the "Take from any
 * pantry" list; a search is quick use's `useItemSearch`), and cooking —
 * `cookDish`, then in assign mode `setDishShares` — with the refresh of every
 * read it changes and the ten-second Undo (which cancels the dish: its charges
 * are reversed and every ingredient goes back).
 */

/** How many items "Take from any pantry" lists before a search. */
export const COOKABLE_LIMIT = 100;

/** Items the caller may cook with — their own, and groups' they use from — soonest use-by first. */
export function useCookableItems() {
  const { client } = useSession();
  return useApiQuery<ReachableItem[]>(qk.kitchenCookable(), () =>
    wrap(async () => (await client.kitchen.items({ usable: true, limit: COOKABLE_LIMIT })).items),
  );
}

/** After cooking or cancelling: every pantry read, the dishes, and the ledger of each group the dish touched. */
export function refreshAfterDish(qc: QueryClient, dish: Pick<KitchenDish, "orgId" | "ingredients">): void {
  void qc.invalidateQueries({ queryKey: qk.kitchenDishes() });
  refreshPantry(qc, null);
  const groups = new Set<string>();
  if (dish.orgId) groups.add(dish.orgId);
  for (const i of dish.ingredients) if (i.orgId) groups.add(i.orgId);
  for (const orgId of groups) refreshLedger(qc, orgId);
  void qc.invalidateQueries({ queryKey: qk.kitchenMe() });
}

export interface CookInput {
  request: CookDishRequest;
  /** Assign mode: who ate what, posted right after cooking; null otherwise. */
  shares: SetDishSharesRequest | null;
  idempotencyKey: string;
  lines: readonly DishLine[];
  /** The toast once it is cooked. */
  text: (dish: KitchenDish) => { title: string; description: string };
}

export type CookResult =
  | { ok: true; dish: KitchenDish }
  | {
      ok: false;
      refusal: CookRefusal;
      /** The server answered (a refusal is stored against the key): the next try needs a new key. */
      answered: boolean;
    };

/**
 * Cook: `cookDish`, then — in assign mode — the shares, right away (the dish
 * stays a draft until its cook finalizes it on the dish page). A refusal comes
 * back in words; once cooked, every read it changed is refreshed and a toast
 * offers Undo for ten seconds. If the split could not be posted, the dish is
 * still cooked, and a second toast says to set it on the dish page.
 */
export function useCookDish() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    async (input: CookInput): Promise<CookResult> => {
      const r = await wrap(() => client.kitchen.cookDish(input.request, { idempotencyKey: input.idempotencyKey }));
      if (!r.ok) {
        refreshPantry(qc, null);
        return { ok: false, refusal: cookRefusal(r.error, input.lines), answered: r.status > 0 && r.status < 500 };
      }
      let dish = r.data.dish;
      let sharesError: string | null = null;
      const orgId = dish.orgId;
      if (input.shares && input.shares.shares.length > 0 && orgId) {
        const body = input.shares;
        const s = await wrap(() => client.kitchen.setDishShares(orgId, dish.id, body, { idempotencyKey: crypto.randomUUID() }));
        if (s.ok) dish = s.data.dish;
        else sharesError = sharesRefusal(s.error);
      }
      refreshAfterDish(qc, dish);
      const text = input.text(dish);
      const cooked = dish;
      toast({
        kind: "success",
        title: text.title,
        description: text.description,
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              const c = await wrap(() => client.kitchen.cancelDish(cooked.id, { idempotencyKey: crypto.randomUUID() }));
              refreshAfterDish(qc, cooked);
              if (c.ok) toast({ kind: "success", title: "Undone", description: `${cooked.name} is canceled: everything is back in its pantry.` });
              else if (c.error.reason === "dish_not_open") toast({ kind: "warning", title: "It's finalized now", description: "Correct it on the dish page instead." });
              else toast({ kind: "error", title: "Couldn't undo it", description: c.error.message });
            })();
          },
        },
      });
      if (sharesError) toast({ kind: "warning", title: "The split wasn't saved", description: sharesError });
      return { ok: true, dish };
    },
    [client, qc, toast],
  );
}
