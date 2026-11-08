"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { KitchenItem, PurchaseResponse } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { applyPatches } from "@/lib/optimistic";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { itemAddedPatches, itemRemovedPatches, pendingItem } from "./cache-patches";
import { refreshPantry } from "./pantry-data";
import { useUndoToast } from "./undo-toast";
import { refusedToast, type UndoResult } from "./undo";
import type { ItemRef } from "./pantry";
import { useKitchenRouter } from "./transition-ui";
import { boughtAgainLine, boughtAgainTitle, buyAgainRefusal, buyLikeHref } from "./item-page";
import { itemRestockKey, restockBoughtPatch } from "./restock";

/**
 * Bought again (cookpool-pantry PN-7 on the item page, design §6.2): one tap
 * buys it again like last time — a one-line shopping run (`kitchen.buy`),
 * paid by you, in the same pantry — listed at once (SM-5), with the toast
 * "Bought Milk · ₹68 · Change · Undo". Undo removes the purchase
 * (`undoPurchase`); Change takes it back the same way and opens Add item
 * filled from this one (`/pantry/new?from=`, PN-6), so changing it never
 * leaves two. PN-6's Finished this week and a running-low row's More…
 * sheet share it (a restock line as an item: `boughtAgainItem`); its name
 * leaves the restock read at once, as it will once the server has it.
 */
export function useBuyAgain() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const router = useKitchenRouter();
  return React.useCallback(
    (input: { ref: ItemRef; item: KitchenItem; meId: string | null; today: string; idempotencyKey: string }): Promise<ApiResult<PurchaseResponse>> => {
      const { item, meId, today } = input;
      const line = boughtAgainLine(item, today);
      const shown = meId
        ? pendingItem({
            body: { ...line, boughtOn: today, expiresOn: line.expiresOn ?? null },
            pantry: item.pantry,
            currency: item.currency,
            groupWastePolicy: item.wastePolicy,
            meId,
            today,
            at: new Date().toISOString(),
          })
        : null;
      const write = beginWrite(qc, shown ? [...itemAddedPatches(shown), restockBoughtPatch([itemRestockKey(shown)])] : []);
      const sent = write.track(wrap(() => client.kitchen.buy([line], { idempotencyKey: input.idempotencyKey })));
      let undone = false;
      const takeBack = async (): Promise<UndoResult> => {
        const r = await sent;
        if (!r.ok) return { ok: true, description: `${item.name} is off the list.` };
        const u = await write.track(wrap(() => client.kitchen.undoPurchase(r.data.purchaseId)));
        refreshPantry(qc, null);
        if (!u.ok) return { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        if (u.data.kept.length > 0) return { ok: false, kind: "warning", title: "Someone already used some", description: "It stays in the pantry." };
        return { ok: true, description: `${item.name} is off the list.` };
      };
      const restore = () => {
        undone = true;
        write.restore([]);
      };
      const toast = offer({
        title: boughtAgainTitle(item),
        undo: takeBack,
        restore,
        extra: {
          label: "Change",
          onClick: () => {
            restore();
            void takeBack();
            router.push(buyLikeHref(input.ref));
          },
        },
      });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          refreshPantry(qc, null);
          toast.refuse(refusedToast(`Couldn't buy ${item.name} again`, buyAgainRefusal(r.error, item)));
          return r;
        }
        const made = r.data.items[0];
        if (undone) {
          // Undo came first: the row stays off until the removal lands.
          if (made) applyPatches(queryCacheOf(qc), itemRemovedPatches(made.id));
          return r;
        }
        if (shown && made) applyPatches(queryCacheOf(qc), itemAddedPatches({ ...made, canUse: true }, shown.id));
        refreshPantry(qc, null);
        return r;
      });
    },
    [client, qc, offer, router],
  );
}
