"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ItemScope, KitchenItem, KitchenMeasureInput, SetMeasuresResponse } from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { applyPatches } from "@/lib/optimistic";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { measureInputs, measureTarget, measuresOf, measuresPatches, measuresSavedText, pendingMeasures } from "./measures";

/**
 * Saving an item's measures (Cookpool SM-14) — the first-time question on
 * Use and the item page's "Counted as" — through `kitchen.setMeasures`, at
 * once (SM-5's pattern): every cached read that lists an item of that name
 * in that pantry reads the new measures before the server answers, so Use's
 * tiles switch to "1 onion" the moment Save is tapped; the one Undo toast
 * says what changed ("Saved · now in onions") and Undo puts the measures
 * back as they were (another PUT of the old set). A refusal rolls back and
 * the toast says why in one line.
 */

/** Whose item, as the SDK takes it. */
function scopeOf(item: Pick<KitchenItem, "pantry">): ItemScope {
  return item.pantry.kind === "group" ? { kind: "group", orgId: item.pantry.orgId } : { kind: "personal" };
}

/** Why a save was refused, in one line. */
export function measuresRefusal(error: ApiErrorBody): string {
  if (error.code === "not_found") return "You can't change this item any more.";
  const fields = error.details?.["fields"];
  if (fields && typeof fields === "object") {
    for (const messages of Object.values(fields as Record<string, unknown>)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") return messages[0];
    }
  }
  return error.message;
}

export function useSetMeasures() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: { item: KitchenItem; measures: KitchenMeasureInput[] }): Promise<ApiResult<SetMeasuresResponse>> => {
      const { item } = input;
      const target = measureTarget(item);
      const before = [...measuresOf(item)];
      const scope = scopeOf(item);
      const write = beginWrite(qc, measuresPatches(target, pendingMeasures(input.measures, before)));
      const sent = write.track(wrap(() => client.kitchen.setMeasures(scope, item.id, input.measures)));
      const refresh = () => void qc.invalidateQueries({ queryKey: qk.kitchenPantry() });
      let undone = false;
      const toast = offer({
        title: measuresSavedText({ dimension: item.dimension, before, after: input.measures }),
        // Pressed before the server answered: the old set goes back once it has, if it was saved at all.
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await write.track(wrap(() => client.kitchen.setMeasures(scope, item.id, measureInputs(before))));
          refresh();
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
        restore: () => {
          undone = true;
          write.restore(measuresPatches(target, before));
        },
      });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          refresh();
          toast.refuse(refusedToast(`Couldn't save ${item.name}'s measure`, measuresRefusal(r.error)));
          return r;
        }
        if (undone) return r;
        // The server's measures (their ids) everywhere at once; then every read is read again.
        applyPatches(queryCacheOf(qc), measuresPatches(target, r.data.measures));
        refresh();
        return r;
      });
    },
    [client, qc, offer],
  );
}
