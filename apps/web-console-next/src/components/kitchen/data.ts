"use client";

import { useIsFetching, type QueryClient } from "@tanstack/react-query";
import type { PublicOrganization } from "@saas/contracts/membership";
import type { AuthUser } from "@saas/contracts/auth";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk, type AsyncState } from "@/lib/query";
import { NAME_READS } from "./you";

/**
 * Cookpool's shared reads (CP-5). Both use the admin console's cache keys and
 * shapes (`qk.orgs()`, `qk.profile()`), so the two apps share one cache entry.
 */

/** The person's groups (organizations), plus whether a refetch is running. */
export function useGroups(): AsyncState<PublicOrganization[]> & { fetching: boolean } {
  const { client } = useSession();
  const state = useApiQuery(qk.orgs(), () =>
    wrap(async () => (await client.organizations.list()).organizations),
  );
  const fetching = useIsFetching({ queryKey: qk.orgs() }) > 0;
  return { ...state, fetching };
}

/** The signed-in person. `enabled: false` holds the read (the kitchen layout, until the session is ready). */
export function useProfile(opts?: { enabled?: boolean }): AsyncState<AuthUser> {
  const { client } = useSession();
  return useApiQuery(qk.profile(), () => wrap(async () => (await client.auth.getProfile()).user), opts);
}

/**
 * After the person renames themselves (SI-6): write the saved profile in
 * place, and refresh every read that carries names (CP-9), so Home, People
 * and a group's members show the new name.
 */
export function applyNewName(qc: QueryClient, user: AuthUser): void {
  qc.setQueryData(qk.profile(), user);
  for (const queryKey of NAME_READS) void qc.invalidateQueries({ queryKey });
}
