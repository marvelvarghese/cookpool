"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { StockMoveResponse } from "@saas/contracts/kitchen";
import { measureLabel } from "@saas/contracts/kitchen";
import { fromMilli } from "@saas/kitchen-engine/units";
import { wrap, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { qk } from "@/lib/query";
import { refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { itemRefParam } from "./pantry";
import { amountCost, logRefusal, logRequest } from "./item-use";
import { movesPatch, pendingMove, stockPatches, stockReturnPatches, type StockChange } from "./cache-patches";
import { beginWrite } from "./optimistic-data";
import { refreshPantry, undoRefusal, undoStockMove } from "./pantry-data";
import { trayToast, type TrayEntry } from "./now-strip";
import { sendInOrder, undoLastFirst } from "./log-several";
import type { MemberNames } from "./members";
import { applyPatches } from "@/lib/optimistic";
import { newFrame } from "@/lib/features";
import { queryCacheOf } from "./optimistic-data";
import { askFirstRefusalFields, askItemPatches } from "./ask-before-use";

/**
 * Log several (cookpool-pantry PN-5, design §1.3): the tray's uses, written
 * one after another — each through the same route as any use, so money,
 * Undo and the server's rules are the ones a single use has — for you
 * alone, with ONE Undo toast for all of them. They show at once (SM-5): what
 * is left drops wherever each item is listed, and each history gains its
 * row, before the first answer. A refused one is put back exactly and the
 * toast says which; Undo reverses every one that was written, the last
 * first. It answers with the refused entries (RV-13's Log keeps them
 * picked); `onRestore` runs the moment Undo is pressed.
 */
export function useLogSeveral() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const isNew = newFrame();
  return React.useCallback(
    (
      tray: readonly TrayEntry[],
      ctx: {
        meId: string | null;
        names?: MemberNames | null;
        /** The toast's words (Say what you used, AI-7: "Logged 2 · ₹42.50"); the tray's own "Logged 3 for you" by default. */
        toast?: (tray: readonly TrayEntry[], refused?: readonly TrayEntry[]) => { title: string; description?: string };
        /** Undo was pressed: put the screen's own state back (RV-13: the rows are picked again). */
        onRestore?: () => void;
      },
    ): Promise<TrayEntry[]> => {
      if (tray.length === 0) return Promise.resolve([]);
      const { meId } = ctx;
      const at = new Date().toISOString();
      const writes = tray.map((entry) => {
        const { item, ref, step } = entry;
        const consumers = item.pantry.kind === "personal" ? [] : entry.consumers ? [...entry.consumers] : meId ? [meId] : [];
        const counted = step.amount.kind === "measure" ? { measure: step.amount.measure, quantity: step.amount.quantity } : null;
        const body = logRequest(item, step.qtyMilli, consumers, counted);
        const change: StockChange = { itemId: item.id, kind: "use", qtyMilli: step.qtyMilli, costMinor: amountCost(item, step.qtyMilli) };
        const move = pendingMove({
          change,
          quantity: counted ? fromMilli(step.qtyMilli, item.displayUnit) : Number(body.quantity),
          unit: counted ? item.displayUnit : (body.unit ?? item.displayUnit),
          label: counted ? measureLabel(counted.quantity, counted.measure) : null,
          actor: meId ?? item.createdBy,
          consumers: item.pantry.kind === "personal" ? null : consumers,
          at,
        });
        const write = beginWrite(qc, [...stockPatches(change), movesPatch(itemRefParam(ref), move)]);
        const send = (): Promise<ApiResult<StockMoveResponse>> =>
          wrap(() =>
            ref.kind === "group"
              ? client.kitchen.useGroupItem(ref.orgId, ref.itemId, body, { idempotencyKey: crypto.randomUUID() })
              : client.kitchen.usePersonalItem(ref.itemId, body, { idempotencyKey: crypto.randomUUID() }),
          );
        return { entry, change, write, send };
      });

      // One after another: each waits for the one before it.
      const requests = sendInOrder(
        writes.map((w) => w.send),
        (i, answer) => writes[i]!.write.track(answer),
      );
      const all = Promise.all(requests);
      const words = ctx.toast ?? trayToast;
      let undone = false;
      const toast = offer({
        title: words(tray).title,
        undo: async (): Promise<UndoResult> => {
          const answers = await all;
          let refusal: UndoResult | null = null;
          // The last first: each item's own newest use is the one put back.
          await undoLastFirst(
            answers,
            (r) => r.ok,
            async (i, r) => {
              if (!r.ok) return false;
              const ref = writes[i]!.entry.ref;
              const u = await writes[i]!.write.track(undoStockMove(client, ref, { id: r.data.move.id, txnId: r.data.txn?.id ?? r.data.move.txnId }));
              refreshPantry(qc, ref.kind === "group" ? ref.orgId : null);
              if (!u.ok && !refusal) refusal = undoRefusal(u.error);
              return u.ok;
            },
          );
          return refusal ?? { ok: true, description: `${writes.length === 1 ? writes[0]!.entry.name : `${writes.length} things`} back as they were.` };
        },
        restore: () => {
          undone = true;
          for (const w of writes) w.write.restore(stockReturnPatches(w.change));
          ctx.onRestore?.();
        },
      });

      return all.then((answers) => {
        const refused: TrayEntry[] = [];
        answers.forEach((r, i) => {
          const w = writes[i]!;
          if (r.ok) {
            if (!undone) qc.setQueryData(qk.kitchenItem(itemRefParam(w.entry.ref)), r.data.item);
            return;
          }
          w.write.rollback();
          refused.push(w.entry);
          // You must ask first (cookpool-pantry PN-9): its row turns into the ask row at once, as a single use's does.
          const asking = isNew ? askFirstRefusalFields(r.error) : null;
          if (asking) applyPatches(queryCacheOf(qc), askItemPatches(w.entry.item.id, asking));
        });
        for (const w of writes) refreshPantry(qc, w.entry.ref.kind === "group" ? w.entry.ref.orgId : null);
        if (undone || refused.length === 0) return refused;
        if (refused.length === writes.length) {
          const first = answers.find((r): r is Extract<typeof r, { ok: false }> => !r.ok)!;
          const why = logRefusal(first.error, { item: refused[0]!.item, meId, names: ctx.names ?? null }).message;
          toast.refuse(refusedToast(`Couldn't log ${refused.length === 1 ? refused[0]!.name : `these ${refused.length}`}`, why));
          return refused;
        }
        toast.update(words(tray, refused));
        return refused;
      });
    },
    [client, qc, offer, isNew],
  );
}
