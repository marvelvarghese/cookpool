"use client";

import { useQueries } from "@tanstack/react-query";
import type { InboxResponse, KitchenTxn } from "@saas/contracts/kitchen";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { RECENT_PER_GROUP } from "./home";

/**
 * Home's reads (Cookpool CP-23): the inbox (CP-19's `kitchen.inbox()`), cached
 * under `qk.kitchenInbox()` — inside `kitchenMe()`, so every ledger write
 * refreshes it, and stock and dish writes refresh it by name — and Recent
 * activity: the newest entries of each of a few groups, each under its
 * group's `kitchenLedger(orgId)`, so a write in that group refreshes them.
 */

export function useInbox() {
  const { client } = useSession();
  return useApiQuery<InboxResponse>(qk.kitchenInbox(), () => wrap(() => client.kitchen.inbox()));
}

export interface GroupActivity {
  orgId: string;
  name: string;
  slug: string;
  txns: KitchenTxn[];
}

/**
 * The newest entries of each group given (there is no cross-group activity
 * read, so one small page per group). `data` holds the groups read so far;
 * `loading` until the first answers; `failed` names the groups that could not
 * be read.
 */
export function useRecentActivity(groups: readonly { id: string; name: string; slug: string }[]) {
  const { client } = useSession();
  const results = useQueries({
    queries: groups.map((g) => ({
      queryKey: qk.kitchenRecentActivity(g.id),
      queryFn: async (): Promise<KitchenTxn[]> => {
        const r = await wrap(() => client.kitchen.activity(g.id, { limit: RECENT_PER_GROUP }));
        if (!r.ok) throw r.error;
        return r.data.items;
      },
    })),
  });
  const data: GroupActivity[] = [];
  groups.forEach((g, i) => {
    const txns = results[i]?.data;
    if (txns) data.push({ orgId: g.id, name: g.name, slug: g.slug, txns });
  });
  const loading = groups.length > 0 && results.every((r) => r.isLoading);
  const failed = groups.filter((_, i) => results[i]?.isError).map((g) => g.name);
  const reload = () => {
    for (const r of results) if (r.isError) void r.refetch();
  };
  return { data, loading, failed, reload };
}
