"use client";

import * as React from "react";
import type { GroupMembersResponse, KitchenMember, MyBalancesResponse, PersonViewResponse } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { roleFromKitchen, type GroupRole } from "./groups";
import type { MemberNames } from "./members";
import { mergeNames, namesFromBalances } from "./people";

/**
 * Cookpool's people reads (CP-9), through the SDK: the caller's balances
 * across every group (Home, People, Settle up's All groups, the Groups list),
 * the "why" for one person, and a group's members by name and role. The two
 * personal reads live under `qk.kitchenMe()`, which `refreshLedger` also
 * invalidates, so a payment anywhere refreshes them.
 */

export function useMyBalances() {
  const { client } = useSession();
  return useApiQuery<MyBalancesResponse>(qk.kitchenMyBalances(), () => wrap(() => client.kitchen.myBalances()));
}

type Client = ReturnType<typeof useSession>["client"];

/** Read the "why" for one person (their page's read; Home reads it ahead, SM-5). */
export function loadPerson(client: Client, subjectId: string): Promise<ApiResult<PersonViewResponse>> {
  return wrap(() => client.kitchen.person(subjectId));
}

/** Read a group's members (oldest first), by name and role. */
export function loadMembers(client: Client, orgId: string): Promise<ApiResult<KitchenMember[]>> {
  return wrap(async () => (await client.kitchen.groupMembers(orgId)).members);
}

export function usePerson(subjectId: string) {
  const { client } = useSession();
  return useApiQuery<PersonViewResponse>(qk.kitchenPerson(subjectId), () => loadPerson(client, subjectId), {
    enabled: subjectId !== "",
  });
}

/** A group's members (oldest first), by name and role — every member may read it. */
export function useGroupMembers(orgId: string) {
  const { client } = useSession();
  return useApiQuery<GroupMembersResponse["members"]>(qk.kitchenMembers(orgId), () => loadMembers(client, orgId));
}

/**
 * The names the app labels people with: everyone you share a group with
 * (from the cross-group read), plus `extra` (a group's member list, when a
 * screen has it). Ids without a name fall back to "Member · 3f9a".
 */
export function useMemberNames(extra?: readonly { subjectId: string; displayName: string | null }[] | null): MemberNames {
  const balances = useMyBalances();
  return React.useMemo(
    () => mergeNames(namesFromBalances(balances.data), (extra ?? []).map((m) => [m.subjectId, m.displayName] as const)),
    [balances.data, extra],
  );
}

/** Your role in each of your groups, by `org_…` id (from the cross-group read). */
export function useMyRoles(): { roles: Map<string, GroupRole>; loading: boolean } {
  const balances = useMyBalances();
  const roles = React.useMemo(() => {
    const out = new Map<string, GroupRole>();
    for (const g of balances.data?.groups ?? []) {
      const role = roleFromKitchen(g.role);
      if (role) out.set(g.orgId, role);
    }
    return out;
  }, [balances.data]);
  return { roles, loading: balances.loading };
}
