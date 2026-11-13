"use client";

import type { SplitecoGroupResponse } from "@saas/contracts/spliteco";

/**
 * What is left of Cookpool's own kitchen money screens (cookpool-spliteco SE3)
 * since money-inside MN-6: Money is Spliteco inside (`money-inside-ui.tsx`),
 * and the kitchen settle and profile screens share this.
 */

/** Names by subject id from a kitchen read. */
export function namesOf(data: SplitecoGroupResponse | null): Map<string, string | null> {
  return new Map([...(data?.members ?? []), ...(data?.people ?? [])].map((p) => [p.subjectId, p.name] as const));
}
