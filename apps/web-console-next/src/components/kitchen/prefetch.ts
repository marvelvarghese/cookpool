"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { prefetchApi, qk } from "@/lib/query";
import { itemRefParam, type ItemRef } from "./pantry";
import { loadItem, loadItemMoves } from "./pantry-data";
import { loadMembers, loadPerson } from "./people-data";
import { loadActivityPage, loadBalances } from "./ledger-data";
import { loadDish } from "./dish-data";
import { loadRecentActivity } from "./inbox-data";

/**
 * Read ahead what Home's rows open (Cookpool SM-5), into the same cache
 * entries the pages read, so the page paints at once: a person's "why", a
 * group (its members, balances and first page of activity), an item (and its
 * history), a dish (and its group's members). Each is skipped while what is
 * cached is fresh (`staleTime`), so calling them on every render or press is
 * cheap. `pressIn` gives a row's handlers: pointer down (a phone's tap lands
 * about a tenth of a second later), hover and focus.
 */
export function usePrefetchKitchen() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useMemo(() => {
    const members = (orgId: string) => prefetchApi(qc, qk.kitchenMembers(orgId), () => loadMembers(client, orgId));
    const out = {
      person: (subjectId: string) => prefetchApi(qc, qk.kitchenPerson(subjectId), () => loadPerson(client, subjectId)),
      members,
      group: (orgId: string) => {
        members(orgId);
        prefetchApi(qc, qk.kitchenBalances(orgId), () => loadBalances(client, orgId));
        void qc.prefetchInfiniteQuery({
          queryKey: qk.kitchenActivity(orgId),
          queryFn: ({ pageParam }) => loadActivityPage(client, orgId, pageParam),
          initialPageParam: null as string | null,
        });
      },
      item: (ref: ItemRef) => {
        prefetchApi(qc, qk.kitchenItem(itemRefParam(ref)), () => loadItem(client, ref));
        prefetchApi(qc, qk.kitchenItemMoves(itemRefParam(ref)), () => loadItemMoves(client, ref));
        if (ref.kind === "group") members(ref.orgId);
      },
      /** A group's newest entries, for Home's Recent activity. */
      recent: (orgId: string) => {
        void qc.prefetchQuery({ queryKey: qk.kitchenRecentActivity(orgId), queryFn: () => loadRecentActivity(client, orgId) });
      },
      dish: (dishId: string, orgId: string | null) => {
        void qc.prefetchQuery({ queryKey: qk.kitchenDish(dishId), queryFn: () => loadDish(client, dishId) });
        if (orgId) members(orgId);
      },
    };
    return out;
  }, [client, qc]);
}

/** A row's press-in handlers: read ahead what it opens before the tap lands. */
export function pressIn(read: () => void): {
  onPointerDown: () => void;
  onMouseEnter: () => void;
  onFocus: () => void;
} {
  return { onPointerDown: read, onMouseEnter: read, onFocus: read };
}
