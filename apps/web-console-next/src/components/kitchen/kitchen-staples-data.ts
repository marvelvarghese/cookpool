"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { KitchenStaple, ShoppingItem, StaplePantry, StapleStatus, StaplesResponse } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { newFrame } from "@/lib/features";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";
import { beginWrite } from "./optimistic-data";
import { refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { ALWAYS_HAVE_REFRESHES } from "./always-have";
import { stapleApiPantry, stapleKey, statusToast } from "./kitchen-staples";
import type { CachePatch } from "@/lib/optimistic";

/**
 * Always have per pantry and the shopping list's reads and writes
 * (cookpool-revamp RV-21): one read of every pantry's staples and hand-added
 * lines, and each write at once on screen with one Undo toast — Running low,
 * Out, Got more (a group's posts the equal split; its Undo reverses that
 * bill), add and remove a staple, add a line to the list.
 */

export function useStaples() {
  const { client } = useSession();
  return useApiQuery<StaplesResponse>(qk.kitchenStaples(), () => wrap(() => client.kitchen.staples()), { enabled: newFrame() });
}

type Patch = (pantry: StaplePantry) => StaplePantry;

/** A patch of one pantry in the read. */
function pantryPatch(key: string, patch: Patch): CachePatch {
  return {
    prefix: qk.kitchenStaples(),
    update: (data) => {
      const res = data as StaplesResponse | undefined;
      if (!res) return res;
      return { pantries: res.pantries.map((p) => (stapleKey(p.owner) === key ? patch(p) : p)) };
    },
  };
}

const withStaple = (s: KitchenStaple): Patch => (p) => ({ ...p, isSet: true, staples: p.staples.some((x) => x.id === s.id) ? p.staples.map((x) => (x.id === s.id ? s : x)) : [...p.staples, s].sort((a, b) => a.name.localeCompare(b.name)) });
const withoutStaple = (id: string): Patch => (p) => ({ ...p, isSet: true, staples: p.staples.filter((x) => x.id !== id) });
const withItem = (i: ShoppingItem): Patch => (p) => ({ ...p, items: [...p.items.filter((x) => x.id !== i.id), i] });
const withoutItem = (id: string): Patch => (p) => ({ ...p, items: p.items.filter((x) => x.id !== id) });

/** One staples write: on screen at once, sent, refused back off the screen, with Undo by `undo`. */
function useStapleWrite() {
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    <T,>(o: {
      pantry: StaplePantry;
      patch: Patch;
      revert: Patch;
      send: () => Promise<T>;
      title: string;
      refusal: string;
      undo: ((answer: T) => Promise<unknown>) | null;
      personal?: boolean;
    }): Promise<ApiResult<T>> => {
      const key = stapleKey(o.pantry.owner);
      const write = beginWrite(qc, [pantryPatch(key, o.patch)]);
      const sent = write.track(wrap(o.send));
      const refresh = () => {
        void qc.invalidateQueries({ queryKey: qk.kitchenStaples() });
        // Your own staples are Cook now's Always have.
        if (o.pantry.owner.kind === "personal") {
          void qc.invalidateQueries({ queryKey: qk.kitchenAlwaysHave() });
          for (const k of ALWAYS_HAVE_REFRESHES) void qc.invalidateQueries({ queryKey: k });
        } else {
          void qc.invalidateQueries({ queryKey: ["kitchenLedger", o.pantry.owner.orgId] });
          void qc.invalidateQueries({ queryKey: qk.kitchenMyBalances() });
        }
      };
      const undo = o.undo;
      const handle = offer({
        title: o.title,
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok || !undo) return { ok: true };
          const u = await wrap(() => undo(r.data));
          refresh();
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
        },
        restore: () => write.restore([pantryPatch(key, o.revert)]),
      });
      void sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          handle.refuse(refusedToast(o.refusal, r.error.message));
        }
        refresh();
      });
      return sent;
    },
    [qc, offer],
  );
}

export function useStapleActions() {
  const { client } = useSession();
  const run = useStapleWrite();
  const k = client.kitchen;
  return React.useMemo(
    () => ({
      /** Running low, Out, or back to ok. */
      setStatus(pantry: StaplePantry, staple: KitchenStaple, to: StapleStatus) {
        const api = stapleApiPantry(pantry.owner);
        return run({
          pantry,
          patch: withStaple({ ...staple, status: to }),
          revert: withStaple(staple),
          send: () => k.updateStaple(api, staple.id, { status: to }),
          title: statusToast(staple.name, staple.status, to),
          refusal: `Couldn't change ${staple.name}`,
          undo: () => k.updateStaple(api, staple.id, { status: staple.status }),
        });
      },
      /** Got more: a group's posts the price split equally (Undo reverses that bill); yours records it. */
      bought(pantry: StaplePantry, staple: KitchenStaple, priceMinor: number, title: string) {
        const api = stapleApiPantry(pantry.owner);
        const idempotencyKey = crypto.randomUUID();
        return run({
          pantry,
          patch: withStaple({ ...staple, status: "ok", lastPriceMinor: priceMinor, wantQtyMilli: null, wantUnit: null }),
          revert: withStaple(staple),
          send: () => k.stapleBought(api, staple.id, { priceMinor }, { idempotencyKey }),
          title,
          refusal: `Couldn't add ${staple.name}`,
          undo: async (r) => {
            if (r.txn && pantry.owner.kind === "group") await k.reverseTxn(pantry.owner.orgId, r.txn.id, {}, { idempotencyKey: crypto.randomUUID() });
            return k.updateStaple(api, staple.id, { status: staple.status });
          },
        });
      },
      add(pantry: StaplePantry, name: string) {
        const api = stapleApiPantry(pantry.owner);
        const pending: KitchenStaple = {
          id: `pending:${name}`, name, foodKey: null, status: "ok", lastPriceMinor: null, currency: null, lastQtyMilli: null, lastUnit: null,
          wantQtyMilli: null, wantUnit: null, boughtAt: null, updatedBy: "", updatedAt: new Date().toISOString(),
        };
        return run({
          pantry,
          patch: withStaple(pending),
          revert: withoutStaple(pending.id),
          send: () => k.addStaple(api, { name }),
          title: `${name} · in Always have`,
          refusal: `Couldn't add ${name}`,
          undo: (r) => k.removeStaple(api, r.staple.id),
        });
      },
      remove(pantry: StaplePantry, staple: KitchenStaple) {
        const api = stapleApiPantry(pantry.owner);
        return run({
          pantry,
          patch: withoutStaple(staple.id),
          revert: withStaple(staple),
          send: () => k.removeStaple(api, staple.id),
          title: `${staple.name} · off Always have`,
          refusal: `Couldn't remove ${staple.name}`,
          undo: () => k.addStaple(api, { name: staple.name, foodKey: staple.foodKey }),
        });
      },
      /** A line on the list by hand (Finished this week's Add to list; the list's + Add). */
      addToList(pantry: StaplePantry, name: string) {
        const api = stapleApiPantry(pantry.owner);
        const pending: ShoppingItem = { id: `pending:${name}`, name, qtyMilli: null, unit: null, addedBy: "", createdAt: new Date().toISOString() };
        return run({
          pantry,
          patch: withItem(pending),
          revert: withoutItem(pending.id),
          send: () => k.addShoppingItem(api, { name }),
          title: `${name} · on the list`,
          refusal: `Couldn't add ${name} to the list`,
          undo: (r) => k.removeShoppingItem(api, r.item.id),
        });
      },
      removeFromList(pantry: StaplePantry, item: ShoppingItem) {
        const api = stapleApiPantry(pantry.owner);
        return run({
          pantry,
          patch: withoutItem(item.id),
          revert: withItem(item),
          send: () => k.removeShoppingItem(api, item.id),
          title: `${item.name} · off the list`,
          refusal: `Couldn't remove ${item.name}`,
          undo: () => k.addShoppingItem(api, { name: item.name, qtyMilli: item.qtyMilli, unit: item.unit }),
        });
      },
    }),
    [k, run],
  );
}
