"use client";

import * as React from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  KitchenItem,
  KitchenMember,
  KitchenStockMove,
  Pantry,
  ReachableItem,
  StockMoveResponse,
} from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { useToast } from "@/components/ui/toast";
import { refreshLedger, UNDO_MS } from "./ledger-data";
import { itemRefParam, type ItemRef } from "./pantry";

/**
 * Cookpool's pantry reads and stock writes (CP-12), through the CP-10/CP-11
 * SDK. Every read is cached under `qk.kitchenPantry()`, so one invalidation
 * after a use, waste, move or undo refreshes every pantry, Home's strip, the
 * item and its history; a write that moved money also refreshes the group's
 * ledger and the cross-group reads (`refreshLedger`).
 */

/** Items are read 100 at a time, up to 1,000 per pantry choice. */
const ITEMS_PAGE = 100;
const ITEMS_MAX_PAGES = 10;

/** Every pantry the caller can reach (their own first, then each group by name), with totals. */
export function usePantries() {
  const { client } = useSession();
  return useApiQuery<Pantry[]>(qk.kitchenPantries(), () => wrap(async () => (await client.kitchen.pantries()).pantries));
}

export interface LoadedItems {
  items: ReachableItem[];
  /** More than the app reads at once: only the soonest 1,000 are shown. */
  truncated: boolean;
}

/** The items of one choice ("all", "personal" or a group's `org_…`), soonest use-by first, every page. */
export function usePantryItems(pantry: string, enabled = true) {
  const { client } = useSession();
  return useApiQuery<LoadedItems>(
    qk.kitchenPantryItems(pantry),
    () =>
      wrap(async () => {
        const items: ReachableItem[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < ITEMS_MAX_PAGES; page++) {
          const res = await client.kitchen.items(cursor ? { pantry, cursor, limit: ITEMS_PAGE } : { pantry, limit: ITEMS_PAGE });
          items.push(...res.items);
          cursor = res.nextCursor;
          if (!cursor) return { items, truncated: false };
        }
        return { items, truncated: true };
      }),
    { enabled },
  );
}

/** Home's strip: items to use within a few days, and the first few already past their date. */
export function useUseSoonItems() {
  const { client } = useSession();
  return useApiQuery<{ soon: ReachableItem[]; expired: ReachableItem[] }>(qk.kitchenUseSoon(), () =>
    wrap(async () => {
      const [soon, expired] = await Promise.all([
        client.kitchen.items({ filter: "soon", limit: 4 }),
        client.kitchen.items({ filter: "expired", limit: 4 }),
      ]);
      return { soon: soon.items, expired: expired.items };
    }),
  );
}

/** One item, by its page ref: your own (`getPersonalItem`) or a group's (`getGroupItem`). */
export function useKitchenItem(ref: ItemRef | null) {
  const { client } = useSession();
  return useApiQuery<KitchenItem>(
    qk.kitchenItem(ref ? itemRefParam(ref) : ""),
    () =>
      wrap(async () => {
        if (!ref) throw new Error("no item");
        const res =
          ref.kind === "personal"
            ? await client.kitchen.getPersonalItem(ref.itemId)
            : await client.kitchen.getGroupItem(ref.orgId, ref.itemId);
        return res.item;
      }),
    { enabled: ref !== null },
  );
}

/** The item's stock moves, newest first. */
export function useItemMoves(ref: ItemRef | null) {
  const { client } = useSession();
  return useApiQuery<KitchenStockMove[]>(
    qk.kitchenItemMoves(ref ? itemRefParam(ref) : ""),
    () =>
      wrap(async () => {
        if (!ref) throw new Error("no item");
        const res =
          ref.kind === "personal"
            ? await client.kitchen.personalItemMoves(ref.itemId, { limit: 100 })
            : await client.kitchen.groupItemMoves(ref.orgId, ref.itemId, { limit: 100 });
        return res.moves;
      }),
    { enabled: ref !== null },
  );
}

/**
 * A group's members (oldest first) when `orgId` is set — the same cache entry
 * as `useGroupMembers`, for screens where the group is a choice (the add form)
 * and may be none.
 */
export function useMembersOf(orgId: string | null) {
  const { client } = useSession();
  return useApiQuery<KitchenMember[]>(
    qk.kitchenMembers(orgId ?? ""),
    () =>
      wrap(async () => {
        if (!orgId) throw new Error("no group");
        return (await client.kitchen.groupMembers(orgId)).members;
      }),
    { enabled: orgId !== null },
  );
}

/** Refresh every pantry read after a stock write — and a group's ledger when the write was in one. */
export function refreshPantry(qc: QueryClient, orgId: string | null): void {
  void qc.invalidateQueries({ queryKey: qk.kitchenPantry() });
  if (orgId) refreshLedger(qc, orgId);
}

/**
 * Put back a use or waste: reverse its transaction when it posted one (the
 * reversal puts the stock back in the same write), else undo the move itself.
 */
export function undoStockMove(
  client: ReturnType<typeof useSession>["client"],
  ref: ItemRef,
  move: Pick<KitchenStockMove, "id" | "txnId">,
): Promise<ApiResult<unknown>> {
  const opts = { idempotencyKey: crypto.randomUUID() };
  if (ref.kind === "personal") return wrap(() => client.kitchen.undoPersonalMove(move.id, opts));
  if (move.txnId) {
    const txnId = move.txnId;
    return wrap(() => client.kitchen.reverseTxn(ref.orgId, txnId, {}, opts));
  }
  return wrap(() => client.kitchen.undoGroupMove(ref.orgId, move.id, opts));
}

/** What to say when an undo is refused. */
export function undoRefusal(error: ApiErrorBody): { kind: "warning" | "error"; title: string; description?: string } {
  switch (error.reason) {
    case "already_reversed":
      return { kind: "warning", title: "Already undone" };
    case "not_latest":
      return {
        kind: "warning",
        title: "Something newer came after it",
        description: "Only the latest change to an item can be put back. Undo that one first.",
      };
    case "not_reversible":
      return { kind: "warning", title: "This one can't be undone", description: "Log it again instead." };
    case "not_creator":
      return { kind: "warning", title: "Only who logged it can undo it", description: "Or an owner or admin of the group." };
    default:
      return { kind: "error", title: "Couldn't undo it", description: error.message };
  }
}

/**
 * Stock actions confirm by undo, not by a dialog (design §7): after a use or
 * waste, a toast offers Undo for ten seconds.
 */
export function useOfferStockUndo() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    (ref: ItemRef, response: StockMoveResponse, title: string, description?: string) => {
      const orgId = ref.kind === "group" ? ref.orgId : null;
      toast({
        kind: "success",
        title,
        description,
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              const r = await undoStockMove(client, ref, { id: response.move.id, txnId: response.txn?.id ?? response.move.txnId });
              refreshPantry(qc, orgId);
              if (r.ok) toast({ kind: "success", title: "Undone", description: `${response.item.name} is back as it was.` });
              else toast(undoRefusal(r.error));
            })();
          },
        },
      });
    },
    [client, qc, toast],
  );
}
