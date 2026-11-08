"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CreatePurchaseRequest, KitchenItem, PantryRef, PurchaseResponse, ReachableItem, RestockResponse, WastePolicy } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { qk, useApiQuery } from "@/lib/query";
import { applyPatches, type CachePatch } from "@/lib/optimistic";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { itemAddedPatches, itemRemovedPatches, pendingItem } from "./cache-patches";
import { refreshPantry } from "./pantry-data";
import { useUndoToast } from "./undo-toast";
import { refusedToast, type UndoResult } from "./undo";
import { itemRefOf, itemRefParam } from "./pantry";
import { itemRestockKey, purchaseRefusal, restockBoughtPatch, undoPurchaseResult } from "./restock";

/**
 * Restocking's read and the shopping run's write (cookpool-pantry PN-6,
 * design §6.1, §6.3), through PN-3's SDK. Bought again is PN-7's
 * `useBuyAgain` (buy-again-data.ts).
 */

/** What to restock: `{ finished, runningLow, usual }` across every pantry you reach (under `kitchenPantry()`). */
export function useRestock(enabled = true) {
  const { client } = useSession();
  return useApiQuery<RestockResponse>(qk.kitchenRestock(), () => wrap(() => client.kitchen.restock()), { enabled });
}

export interface ShoppingRunInput {
  request: CreatePurchaseRequest;
  /** Where each line goes, in the request's order, with the group's waste rule (how its pending row reads). */
  where: readonly { pantry: PantryRef; groupWastePolicy?: WastePolicy | null | undefined }[];
  /** "Added 3 to your pantries · ₹449". */
  title: string;
  meId: string | null;
  /** The person's calendar date. */
  today: string;
  idempotencyKey: string;
}

/**
 * The shopping run's one write (design §6.3): every ticked line in one
 * purchase, paid by you, each into its own pantry. It shows at once (SM-5):
 * each item is listed in its pantry and its name leaves the restock read,
 * with one toast and one Undo that removes the whole purchase
 * (`undoPurchase`) — saying what stayed when someone used some meanwhile.
 * A refusal puts everything back and says why in one line.
 */
export function useShoppingRun() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: ShoppingRunInput): Promise<ApiResult<PurchaseResponse>> => {
      const at = new Date().toISOString();
      const shown: (ReachableItem | null)[] = input.request.lines.map((line, i) =>
        input.meId
          ? pendingItem({
              body: { ...line, boughtOn: input.today, expiresOn: line.expiresOn ?? null },
              pantry: input.where[i]!.pantry,
              currency: line.currency ?? "INR",
              groupWastePolicy: input.where[i]!.groupWastePolicy ?? null,
              meId: input.meId,
              today: input.today,
              at,
            })
          : null,
      );
      const listed = shown.filter((s): s is ReachableItem => s !== null);
      const patches: CachePatch[] = [...listed.flatMap((s) => itemAddedPatches(s)), restockBoughtPatch(listed.map(itemRestockKey))];
      const write = beginWrite(qc, patches);
      const sent = write.track(wrap(() => client.kitchen.buy(input.request.lines, { idempotencyKey: input.idempotencyKey })));
      let made: KitchenItem[] | null = null;
      let undone = false;
      const toast = offer({
        title: input.title,
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true, description: "Nothing was added." };
          const u = await write.track(wrap(() => client.kitchen.undoPurchase(r.data.purchaseId)));
          refreshPantry(qc, null);
          if (!u.ok) return { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
          return undoPurchaseResult(u.data);
        },
        restore: () => {
          undone = true;
          // Once the server's items took the pending rows' places, those come off too.
          write.restore(made ? made.flatMap((i) => itemRemovedPatches(i.id)) : []);
        },
      });
      const one = input.where.length === 1 && input.where[0]!.pantry.kind === "group" ? input.where[0]!.pantry.name : null;
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          refreshPantry(qc, null);
          toast.refuse(refusedToast("Couldn't add them", purchaseRefusal(r.error, one)));
          return r;
        }
        made = r.data.items;
        if (undone) {
          // Undo came first: the rows stay off until the removal lands.
          applyPatches(queryCacheOf(qc), made.flatMap((i) => itemRemovedPatches(i.id)));
          return r;
        }
        made.forEach((item, i) => {
          const pending = shown[i];
          if (pending) applyPatches(queryCacheOf(qc), itemAddedPatches({ ...item, canUse: true }, pending.id));
          qc.setQueryData(qk.kitchenItem(itemRefParam(itemRefOf(item))), item);
        });
        refreshPantry(qc, null);
        return r;
      });
    },
    [client, qc, offer],
  );
}
