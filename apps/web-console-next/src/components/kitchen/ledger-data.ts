"use client";

import * as React from "react";
import { useInfiniteQuery, useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ActivityPage, KitchenTxn, SettlePlan } from "@saas/contracts/kitchen";
import type { PublicMember } from "@saas/contracts/membership";
import { wrap, type ApiErrorBody } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { useToast } from "@/components/ui/toast";
import { canManageGroup, roleFromAssignments, type GroupRole } from "./groups";
import type { GroupPlan, GroupRef } from "./settle";

/**
 * Cookpool's ledger reads and writes (CP-8), per group, through the CP-7 SDK.
 * Every read is cached under `qk.kitchenLedger(orgId)`, so one invalidation
 * after a write refreshes the feed, the balances and the plan together.
 */

const ACTIVITY_PAGE = 25;
/** The debts behind a plan read the whole feed: 100 a page, up to 5,000 entries. */
const ALL_PAGE = 100;
const ALL_MAX_PAGES = 50;

async function unwrap<T>(fn: () => Promise<T>): Promise<T> {
  const r = await wrap(fn);
  if (!r.ok) throw r.error;
  return r.data;
}

/** The group's activity, newest first, a page at a time ("Load more"). */
export function useActivityFeed(orgId: string) {
  const { client } = useSession();
  return useInfiniteQuery<ActivityPage, ApiErrorBody>({
    queryKey: qk.kitchenActivity(orgId),
    queryFn: ({ pageParam }) =>
      unwrap(() =>
        client.kitchen.activity(
          orgId,
          typeof pageParam === "string" ? { cursor: pageParam, limit: ACTIVITY_PAGE } : { limit: ACTIVITY_PAGE },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export interface AllActivity {
  txns: KitchenTxn[];
  /** More than the app reads at once: the debts shown are the newest ones only. */
  truncated: boolean;
}

/** The whole feed (for "Show the debts behind this"); only fetched when `enabled`. */
export function useAllActivity(orgId: string, enabled: boolean) {
  const { client } = useSession();
  return useApiQuery<AllActivity>(
    qk.kitchenActivityAll(orgId),
    () =>
      wrap(async () => {
        const txns: KitchenTxn[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < ALL_MAX_PAGES; page++) {
          const res: ActivityPage = await client.kitchen.activity(
            orgId,
            cursor ? { cursor, limit: ALL_PAGE } : { limit: ALL_PAGE },
          );
          txns.push(...res.items);
          cursor = res.nextCursor;
          if (!cursor) return { txns, truncated: false };
        }
        return { txns, truncated: true };
      }),
    { enabled },
  );
}

export function useBalances(orgId: string) {
  const { client } = useSession();
  return useApiQuery(qk.kitchenBalances(orgId), () => wrap(() => client.kitchen.balances(orgId)));
}

export function useSettlePlan(orgId: string, enabled = true) {
  const { client } = useSession();
  return useApiQuery(qk.kitchenSettlePlan(orgId), () => wrap(() => client.kitchen.settlePlan(orgId)), { enabled });
}

/** Every group's settle plan (one call each; a cross-group read arrives in CP-9). */
export function useSettlePlans(groups: readonly GroupRef[]): GroupPlan[] {
  const { client } = useSession();
  const results = useQueries({
    queries: groups.map((g) => ({
      queryKey: qk.kitchenSettlePlan(g.id),
      queryFn: () => unwrap<SettlePlan>(() => client.kitchen.settlePlan(g.id)),
    })),
  });
  return groups.map((group, i) => {
    const r = results[i];
    return {
      group,
      plan: r?.data ?? null,
      loading: r?.isLoading ?? true,
      failed: r?.isError ?? false,
    };
  });
}

/** Refresh everything the ledger shows for a group, after a write. */
export function refreshLedger(qc: QueryClient, orgId: string): void {
  void qc.invalidateQueries({ queryKey: qk.kitchenLedger(orgId) });
}

/**
 * The signed-in person's role in a group. Only owners and admins may list
 * members (`organization.member.list`); for anyone else the API answers 404,
 * which is also how the app learns the person is a member. Shares the
 * members cache with the group page.
 */
export function useGroupRole(orgId: string, myId: string | null) {
  const { client } = useSession();
  const members = useApiQuery<PublicMember[]>(qk.members(orgId), () =>
    wrap(async () => (await client.memberships.listMembers(orgId)).members),
  );
  const membersHidden = members.error?.code === "not_found";
  let role: GroupRole | null = null;
  if (members.data) {
    const me = myId ? members.data.find((m) => m.subjectId === myId) : undefined;
    // Listing succeeded, so the person is an owner or admin either way.
    role = (me && roleFromAssignments(me.roles)) || "admin";
  } else if (membersHidden) {
    role = "member";
  }
  const roleKnown = role !== null || (members.error !== null && !membersHidden);
  return { members, membersHidden, role, roleKnown, manager: canManageGroup(role) };
}

/** How long an Undo stays on screen. */
export const UNDO_MS = 10_000;

/**
 * Money actions confirm by undo, not by a dialog (design §7): after a write,
 * a toast offers Undo for ten seconds, which posts a reversal of what was
 * just written.
 */
export function useOfferUndo() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    (orgId: string, txn: KitchenTxn, title: string, description?: string) => {
      toast({
        kind: "success",
        title,
        description,
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              const r = await wrap(() =>
                client.kitchen.reverseTxn(orgId, txn.id, {}, { idempotencyKey: crypto.randomUUID() }),
              );
              refreshLedger(qc, orgId);
              if (r.ok) toast({ kind: "success", title: "Undone", description: `“${txn.title}” is reversed.` });
              else if (r.error.reason === "already_reversed") toast({ kind: "warning", title: "Already undone" });
              else toast({ kind: "error", title: "Couldn't undo it", description: r.error.message });
            })();
          },
        },
      });
    },
    [client, qc, toast],
  );
}
