"use client";

import * as React from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { DishesPage, KitchenDish } from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody } from "@/lib/api";
import { useSession } from "@/lib/session";
import { afterWrites, qk } from "@/lib/query";
import { coversDays } from "./cooks";

/**
 * The dishes behind the new frame's cooks (cookpool-recipes RC-2): `GET
 * /v1/kitchen/me/dishes` — what you cooked and what was shared with your
 * groups, newest cooked first — a page of 100 at a time, read on until it
 * covers the days the screen needs (Home two weeks, your page and a person's
 * the chart's 8 weeks), at most four pages. One cache entry for every screen,
 * under `qk.kitchenDishes()`, so cooking, a claim or a finalize refreshes it.
 */

const PAGE = 100;
const MAX_PAGES = 4;

export interface MyDishes {
  /** Every dish read so far, newest cooked first. */
  dishes: KitchenDish[];
  /** Until the first page answers. */
  loading: boolean;
  /** The first page could not be read. */
  failed: boolean;
  /** Every dish was read (no page was left out). */
  complete: boolean;
  reload: () => void;
}

async function page(client: ReturnType<typeof useSession>["client"], cursor: string | null): Promise<DishesPage> {
  const r = await wrap(() => client.kitchen.myDishes(cursor ? { cursor, limit: PAGE } : { limit: PAGE }));
  if (!r.ok) throw r.error;
  return r.data;
}

export function useMyDishes(days: number): MyDishes {
  const { client } = useSession();
  const qc = useQueryClient();
  const q = useInfiniteQuery<DishesPage, ApiErrorBody>({
    queryKey: qk.kitchenMyDishes(),
    queryFn: ({ pageParam }) => afterWrites(qc, qk.kitchenMyDishes(), () => page(client, typeof pageParam === "string" ? pageParam : null))(),
    initialPageParam: null as string | null,
    getNextPageParam: (last, pages) => (pages.length < MAX_PAGES ? (last.nextCursor ?? undefined) : undefined),
  });
  const dishes = React.useMemo(() => q.data?.pages.flatMap((p) => p.dishes) ?? [], [q.data]);
  const [now] = React.useState(() => new Date());
  const needMore = !!q.data && q.hasNextPage && !q.isFetchingNextPage && !q.isError && !coversDays(dishes, true, days, now);
  const { fetchNextPage, refetch } = q;
  React.useEffect(() => {
    if (needMore) void fetchNextPage();
  }, [needMore, fetchNextPage]);
  const lastPage = q.data?.pages[q.data.pages.length - 1];
  return {
    dishes,
    loading: q.isLoading,
    failed: q.isError && !q.data,
    complete: !!lastPage && lastPage.nextCursor === null,
    reload: () => void refetch(),
  };
}
