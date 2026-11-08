"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CheckGroupItemRequest, CheckPersonalItemRequest, KitchenItem, StockCheckGone, StockMoveResponse } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { qk } from "@/lib/query";
import { beginWrite } from "./optimistic-data";
import { movesPatch, stockPatches, stockReturnPatches } from "./cache-patches";
import { refreshPantry, undoRefusal, undoStockMove } from "./pantry-data";
import { useUndoToast } from "./undo-toast";
import { refusedToast, type UndoResult } from "./undo";
import { itemRefParam, type ItemRef } from "./pantry";
import type { MemberNames } from "./members";
import { checkRefusal, checkRequest, checkToast, checkUndoRefusal, checkWrite, type CheckOption } from "./stock-check";

/**
 * The stock check's write (cookpool-pantry PN-7, design §7), at once like a
 * use (SM-5): the level changes wherever the item is listed and its history
 * gains the check's row before the server answers, and the one Undo toast
 * says what happened to the difference. Undo reverses the check's
 * transaction when it posted one (`reverseTxn`), else undoes its move — a
 * raise's undo answering `insufficient_stock` once what it added is used
 * ("Already used"). A refusal puts everything back and the toast says why.
 * Resolves to null when there is nothing to write ("It's right").
 */
export function useCheckItem() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: {
      ref: ItemRef;
      item: KitchenItem;
      says: number;
      gone: StockCheckGone;
      option: CheckOption | null;
      roster: readonly string[] | null;
      meId: string;
      names: MemberNames;
      idempotencyKey: string;
    }): Promise<ApiResult<StockMoveResponse> | null> => {
      const { ref, item, says, gone, meId, names } = input;
      const body = checkRequest(item, says, gone);
      const write = checkWrite({ item, says, gone, roster: input.roster, meId, at: new Date().toISOString() });
      if (!body || !write) return Promise.resolve(null);
      const orgId = ref.kind === "group" ? ref.orgId : null;
      // A take comes off what is left; a raise goes back on, and its Undo takes it off again.
      const shown = write.kind === "take" ? stockPatches(write.change) : stockReturnPatches(write.change);
      const revert = write.kind === "take" ? stockReturnPatches(write.change) : stockPatches(write.change);
      const pending = beginWrite(qc, [...shown, movesPatch(itemRefParam(ref), write.move)]);
      const opts = { idempotencyKey: input.idempotencyKey };
      const request = pending.track(
        wrap(() =>
          ref.kind === "group"
            ? client.kitchen.checkGroupItem(ref.orgId, ref.itemId, body as CheckGroupItemRequest, opts)
            : client.kitchen.checkPersonalItem(ref.itemId, body as CheckPersonalItemRequest, opts),
        ),
      );
      const words = checkToast({ item, says, option: input.option, meId, names });
      let undone = false;
      const toast = offer({
        title: words.title,
        description: words.description,
        undo: async (): Promise<UndoResult> => {
          const r = await request;
          if (!r.ok) return { ok: true, description: `${item.name} is back as it was.` };
          const u = await pending.track(undoStockMove(client, ref, { id: r.data.move.id, txnId: r.data.txn?.id ?? r.data.move.txnId }));
          refreshPantry(qc, orgId);
          if (u.ok) return { ok: true, description: `${item.name} is back as it was.` };
          return checkUndoRefusal(u.error) ?? undoRefusal(u.error);
        },
        restore: () => {
          undone = true;
          pending.restore(revert);
        },
      });
      return request.then((r) => {
        if (!r.ok) {
          pending.rollback();
          refreshPantry(qc, null);
          toast.refuse(refusedToast(`Couldn't fix ${item.name}`, checkRefusal(r.error)));
          return r;
        }
        if (undone) return r;
        qc.setQueryData(qk.kitchenItem(itemRefParam(ref)), r.data.item);
        refreshPantry(qc, orgId);
        return r;
      });
    },
    [client, qc, offer],
  );
}
