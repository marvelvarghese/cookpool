"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { KitchenItem, KitchenItemResponse } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { applyPatches } from "@/lib/optimistic";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { noteOf, notePatches, noteRefusal, noteSavedText } from "./item-note";

/**
 * Saving an item's note (Cookpool RC-3) from its page, at once (SM-5's
 * pattern, as the measures do): every cached read that shows the item reads
 * the new note before the server answers, so its pantry row's third line
 * changes the moment Save is tapped. The one Undo toast says "Note saved" (or
 * "Note removed"), and Undo puts the old note back — another PATCH of it. A
 * refusal rolls back and the toast says why in one line. A note is words: it
 * moves no money, so there is nothing else to undo.
 */
export function useSetItemNote() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: { item: KitchenItem; note: string | null }): Promise<ApiResult<KitchenItemResponse>> => {
      const { item, note } = input;
      const before = noteOf(item);
      const send = (value: string | null) =>
        wrap(() =>
          item.pantry.kind === "group"
            ? client.kitchen.updateGroupItem(item.pantry.orgId, item.id, { note: value })
            : client.kitchen.updatePersonalItem(item.id, { note: value }),
        );
      const write = beginWrite(qc, notePatches(item.id, { note }));
      const sent = write.track(send(note));
      const refresh = () => void qc.invalidateQueries({ queryKey: qk.kitchenPantry() });
      let undone = false;
      const toast = offer({
        title: noteSavedText(note),
        // Pressed before the server answered: the old note goes back once it has, if it was saved at all.
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await write.track(send(before));
          refresh();
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: noteRefusal(u.error) };
        },
        restore: () => {
          undone = true;
          write.restore(notePatches(item.id, { note: before }));
        },
      });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          refresh();
          toast.refuse(refusedToast(`Couldn't save ${item.name}'s note`, noteRefusal(r.error)));
          return r;
        }
        if (undone) return r;
        // The server's note and version everywhere at once; then every read is read again.
        const saved = r.data.item;
        applyPatches(queryCacheOf(qc), notePatches(item.id, { note: noteOf(saved), version: saved.version, updatedAt: saved.updatedAt }));
        refresh();
        return r;
      });
    },
    [client, qc, offer],
  );
}
