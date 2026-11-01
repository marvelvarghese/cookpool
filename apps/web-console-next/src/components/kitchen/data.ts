"use client";

import { useIsFetching } from "@tanstack/react-query";
import type { PublicOrganization } from "@saas/contracts/membership";
import type { AuthUser } from "@saas/contracts/auth";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk, type AsyncState } from "@/lib/query";

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

/** The signed-in person. */
export function useProfile(): AsyncState<AuthUser> {
  const { client } = useSession();
  return useApiQuery(qk.profile(), () => wrap(async () => (await client.auth.getProfile()).user));
}
