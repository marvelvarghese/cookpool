"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ShoppingItem, StaplePantry, StaplesResponse } from "@saas/contracts/kitchen";
import { wrap } from "@/lib/api";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import type { CachePatch } from "@/lib/optimistic";
import { useToast } from "@/components/ui/toast";
import { beginWrite } from "./optimistic-data";
import { refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { stapleApiPantry, stapleKey } from "./kitchen-staples";
import { GOT_KEY, parseGot, type ListUnit, type NeedRow } from "./shopping-list";

/**
 * The shopping list's device ticks and its writes (cookpool-revamp RV-22),
 * on RV-21's routes: a line's amount (a hand line's `PATCH …/shopping/{shp}`,
 * a staple's wanted amount `PATCH …/staples/{stp}`), adding a line with its
 * amount, and taking one off — each on screen at once, adding and removing
 * with an Undo toast.
 */

/** What this device ticked as got: kept in localStorage, so the run reads the same. */
export function useGot(): [string[], (update: (got: string[]) => string[]) => void] {
  const [got, setGot] = React.useState<string[]>([]);
  React.useEffect(() => {
    try {
      setGot(parseGot(window.localStorage.getItem(GOT_KEY)));
    } catch {
      // No storage (a private window): ticks last as long as the page.
    }
  }, []);
  const update = React.useCallback((fn: (got: string[]) => string[]) => {
    setGot((prev) => {
      const next = fn(prev);
      try {
        window.localStorage.setItem(GOT_KEY, JSON.stringify(next));
      } catch {
        // As above.
      }
      return next;
    });
  }, []);
  return [got, update];
}

/** Read this device's ticks once (the run). */
export function readGot(): string[] {
  try {
    return parseGot(window.localStorage.getItem(GOT_KEY));
  } catch {
    return [];
  }
}

/** Write this device's ticks (the run, once saved). */
export function writeGot(got: readonly string[]): void {
  try {
    window.localStorage.setItem(GOT_KEY, JSON.stringify(got));
  } catch {
    // No storage.
  }
}

type Patch = (p: StaplePantry) => StaplePantry;

function pantryPatch(key: string, patch: Patch): CachePatch {
  return {
    prefix: qk.kitchenStaples(),
    update: (data) => {
      const res = data as StaplesResponse | undefined;
      return res ? { pantries: res.pantries.map((p) => (stapleKey(p.owner) === key ? patch(p) : p)) } : res;
    },
  };
}

const withItem = (i: ShoppingItem, replaces?: string): Patch => (p) => ({ ...p, items: [...p.items.filter((x) => x.id !== i.id && x.id !== replaces), i] });
const withoutItem = (id: string): Patch => (p) => ({ ...p, items: p.items.filter((x) => x.id !== id) });

export function useNeedActions() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const { toast } = useToast();
  const k = client.kitchen;
  const refresh = React.useCallback(() => void qc.invalidateQueries({ queryKey: qk.kitchenStaples() }), [qc]);

  return React.useMemo(
    () => ({
      /** The amount a line asks for, saved on it: no toast; a refusal puts it back and says so. */
      setAmount(pantry: StaplePantry, row: Pick<NeedRow, "id" | "source" | "name">, to: { qtyMilli: number; unit: ListUnit }) {
        const key = stapleKey(pantry.owner);
        const api = stapleApiPantry(pantry.owner);
        const patch: Patch =
          row.source === "staple"
            ? (p) => ({ ...p, staples: p.staples.map((s) => (s.id === row.id ? { ...s, wantQtyMilli: to.qtyMilli, wantUnit: to.unit } : s)) })
            : (p) => ({ ...p, items: p.items.map((i) => (i.id === row.id ? { ...i, qtyMilli: to.qtyMilli, unit: to.unit } : i)) });
        const write = beginWrite(qc, [pantryPatch(key, patch)]);
        const sent = write.track(
          wrap<unknown>(() =>
            row.source === "staple"
              ? k.updateStaple(api, row.id, { wantQtyMilli: to.qtyMilli, wantUnit: to.unit })
              : k.updateShoppingItem(api, row.id, { qtyMilli: to.qtyMilli, unit: to.unit }),
          ),
        );
        void sent.then((r) => {
          if (!r.ok) {
            write.rollback();
            toast(refusedToast(`Couldn't change ${row.name}`, r.error.message));
          }
          refresh();
        });
        return sent;
      },

      /** A line added with its amount; Undo takes it off again. */
      add(pantry: StaplePantry, line: { name: string; qtyMilli: number | null; unit: string | null }, title: string) {
        const key = stapleKey(pantry.owner);
        const api = stapleApiPantry(pantry.owner);
        const pending: ShoppingItem = { id: `pending:${line.name}`, name: line.name, qtyMilli: line.qtyMilli, unit: line.unit, addedBy: "", createdAt: new Date().toISOString() };
        const write = beginWrite(qc, [pantryPatch(key, withItem(pending))]);
        const sent = write.track(wrap(() => k.addShoppingItem(api, { name: line.name, qtyMilli: line.qtyMilli, unit: line.unit })));
        const handle = offer({
          title,
          undo: async (): Promise<UndoResult> => {
            const r = await sent;
            if (!r.ok) return { ok: true };
            const u = await wrap(() => k.removeShoppingItem(api, r.data.item.id));
            refresh();
            return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
          },
          restore: () => write.restore([pantryPatch(key, withoutItem(pending.id))]),
        });
        void sent.then((r) => {
          if (!r.ok) {
            write.rollback();
            handle.refuse(refusedToast(`Couldn't add ${line.name}`, r.error.message));
          }
          refresh();
        });
        return sent;
      },

      /** A hand-added line off the list; Undo adds it back with its amount. */
      remove(pantry: StaplePantry, item: ShoppingItem) {
        const key = stapleKey(pantry.owner);
        const api = stapleApiPantry(pantry.owner);
        const write = beginWrite(qc, [pantryPatch(key, withoutItem(item.id))]);
        const sent = write.track(wrap(() => k.removeShoppingItem(api, item.id)));
        const handle = offer({
          title: `${item.name} · off the list`,
          undo: async (): Promise<UndoResult> => {
            const r = await sent;
            if (!r.ok) return { ok: true };
            const u = await wrap(() => k.addShoppingItem(api, { name: item.name, qtyMilli: item.qtyMilli, unit: item.unit }));
            refresh();
            return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
          },
          restore: () => write.restore([pantryPatch(key, withItem(item))]),
        });
        void sent.then((r) => {
          if (!r.ok) {
            write.rollback();
            handle.refuse(refusedToast(`Couldn't remove ${item.name}`, r.error.message));
          }
          refresh();
        });
        return sent;
      },
    }),
    [k, qc, offer, toast, refresh],
  );
}
