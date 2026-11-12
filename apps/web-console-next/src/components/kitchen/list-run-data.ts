"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PurchaseResponse, RestockResponse, StapleBoughtResponse, StaplesResponse } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import type { CachePatch } from "@/lib/optimistic";
import { beginWrite } from "./optimistic-data";
import { refreshPantry } from "./pantry-data";
import { refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { purchaseRefusal, undoPurchaseResult, nameKeyOf } from "./restock";

import { readGot, writeGot } from "./shopping-list-data";
import type { RunRow, SavePlan } from "./list-run";

/**
 * The shopping run from the list, saved (cookpool-revamp RV-22): the items
 * in one purchase (the old run's `POST /me/purchases`), each staple kept in
 * its Always have through RV-21's Bought (a group's split equally), then
 * each pantry's `shopping/clear` with the lines saved. It shows at once
 * (the lines leave the list), with one toast and one Undo that reverses
 * what it can: the purchase's unused items, each group staple's bill, the
 * staples back to Low or Out, the hand lines added back.
 */

/** The staples read without the lines the run saved. */
function listWithout(plan: SavePlan): CachePatch {
  const staples = new Set(plan.clears.flatMap((c) => c.stapleIds));
  const items = new Set(plan.clears.flatMap((c) => c.itemIds));
  return {
    prefix: qk.kitchenStaples(),
    update: (data) => {
      const res = data as StaplesResponse | undefined;
      if (!res) return res;
      return {
        pantries: res.pantries.map((p) => ({
          ...p,
          staples: p.staples.map((s) => (staples.has(s.id) ? { ...s, status: "ok" as const, wantQtyMilli: null, wantUnit: null } : s)),
          items: p.items.filter((i) => !items.has(i.id)),
        })),
      };
    },
  };
}

export interface ListRunSaved {
  purchase: ApiResult<PurchaseResponse> | null;
  staples: { name: string; result: ApiResult<StapleBoughtResponse> }[];
}

export function useListRunSave() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const k = client.kitchen;
  return React.useCallback(
    (plan: SavePlan, o: { title: string; idempotencyKey: string }): Promise<ListRunSaved> => {
      const write = beginWrite(qc, [listWithout(plan)]);
      const purchase = plan.purchase;
      const sentPurchase = purchase
        ? write.track(wrap(() => k.buy(purchase.lines, { idempotencyKey: `${o.idempotencyKey}:items` }, purchase.paidBy)))
        : Promise.resolve(null);
      const sentStaples = Promise.all(
        plan.staples.map((s, i) =>
          write.track(wrap(() => k.stapleBought(s.pantry, s.stapleId, s.body, { idempotencyKey: `${o.idempotencyKey}:s${i}` }))).then((result) => ({ name: s.name, result })),
        ),
      );
      const saved: Promise<ListRunSaved> = Promise.all([sentPurchase, sentStaples]).then(([p, s]) => ({ purchase: p, staples: s }));
      // Clear what was saved: every line when everything went in; only the staples that did when the purchase was refused.
      const cleared = saved.then(async (r) => {
        const okStaples = new Set(plan.staples.filter((_s, i) => r.staples[i]!.result.ok).map((s) => s.stapleId));
        const itemsOk = !r.purchase || r.purchase.ok;
        const sends = plan.clears
          .map((c) => ({ ...c, itemIds: itemsOk ? c.itemIds : [], stapleIds: c.stapleIds.filter((id) => itemsOk || okStaples.has(id)) }))
          .filter((c) => c.itemIds.length > 0 || c.stapleIds.length > 0);
        await Promise.all(sends.map((c) => write.track(wrap(() => k.clearShopping(c.pantry, { itemIds: c.itemIds, stapleIds: c.stapleIds })))));
      });
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: qk.kitchenStaples() });
        void qc.invalidateQueries({ queryKey: qk.kitchenMyBalances() });
        refreshPantry(qc, null);
        for (const s of plan.staples) if (s.pantry) void qc.invalidateQueries({ queryKey: ["kitchenLedger", s.pantry] });
      };
      // The device's ticks for these rows are used up.
      const used = new Set(plan.gotKeys);
      const before = readGot();
      writeGot(before.filter((key) => !used.has(key)));

      const handle = offer({
        title: o.title,
        undo: async (): Promise<UndoResult> => {
          const r = await saved;
          await cleared;
          const steps: Promise<unknown>[] = [];
          let kept: UndoResult | null = null;
          if (r.purchase?.ok) {
            const purchaseId = r.purchase.data.purchaseId;
            steps.push(
              wrap(() => k.undoPurchase(purchaseId)).then((u) => {
                if (u.ok) {
                  const said = undoPurchaseResult(u.data);
                  if (!said.ok) kept = said;
                }
              }),
            );
          }
          r.staples.forEach((s, i) => {
            const w = plan.staples[i]!;
            if (s.result.ok && s.result.data.txn && w.pantry) {
              const txnId = s.result.data.txn.id;
              const orgId = w.pantry;
              steps.push(wrap(() => k.reverseTxn(orgId, txnId, {}, { idempotencyKey: crypto.randomUUID() })));
            }
          });
          for (const s of plan.restore.staples) steps.push(wrap(() => k.updateStaple(s.pantry, s.stapleId, { status: s.status })));
          for (const { pantry, item } of plan.restore.items) steps.push(wrap(() => k.addShoppingItem(pantry, { name: item.name, qtyMilli: item.qtyMilli, unit: item.unit })));
          await Promise.all(steps);
          writeGot([...new Set([...readGot(), ...plan.gotKeys])]);
          refresh();
          return kept ?? { ok: true };
        },
        restore: () => write.restore(),
      });
      void saved.then((r) => {
        const refused = [
          ...(r.purchase && !r.purchase.ok ? [purchaseRefusal(r.purchase.error, null)] : []),
          ...r.staples.filter((s) => !s.result.ok).map((s) => `${s.name}: ${s.result.ok ? "" : s.result.error.message}`),
        ];
        if (refused.length > 0) {
          write.rollback();
          // What didn't go in goes back on the device's ticks.
          writeGot([...new Set([...readGot(), ...plan.gotKeys])]);
          handle.refuse(refusedToast("Couldn't add all of it", refused.join(" · ")));
        }
        void cleared.finally(refresh);
      });
      return saved;
    },
    [k, qc, offer],
  );
}

/**
 * The kinds of the list's rows (an item needs one): a name the restock read
 * knows takes last time's, else the food list's by the staple's food or the
 * name; the rest are "other". Read once per set of names.
 */
export function useRunCategories(rows: readonly Pick<RunRow, "name" | "foodKey">[]): Readonly<Record<string, string>> {
  const { client } = useSession();
  const qc = useQueryClient();
  const names = rows.map((r) => `${nameKeyOf(r.name)}|${r.foodKey ?? ""}`).sort().join(",");
  const [found, setFound] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!names) return;
    const controller = new AbortController();
    const restock = qc.getQueryData<RestockResponse>(qk.kitchenRestock());
    const known = restock ? [...restock.finished, ...restock.runningLow, ...restock.usual] : [];
    void Promise.all(
      names.split(",").map(async (entry): Promise<[string, string | null]> => {
        const [key, foodKey] = entry.split("|") as [string, string];
        const last = known.find((l) => l.nameKey === key);
        if (last) return [key, last.category];
        try {
          const res = await client.kitchen.foods({ q: key, limit: 6 }, { signal: controller.signal });
          const food = res.foods.find((f) => (foodKey && f.key === foodKey) || nameKeyOf(f.name) === key || nameKeyOf(f.matchedName) === key);
          return [key, food?.category ?? null];
        } catch {
          return [key, null];
        }
      }),
    ).then((pairs) => {
      if (controller.signal.aborted) return;
      setFound(Object.fromEntries(pairs.filter((p): p is [string, string] => p[1] !== null)));
    });
    return () => controller.abort();
  }, [names, client, qc]);
  return found;
}

