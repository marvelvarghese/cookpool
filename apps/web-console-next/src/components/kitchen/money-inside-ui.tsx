"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SplitecoMoneyTab, type SplitecoOpen } from "@saas/spliteco-ui/money-tab-ui";
import { splitecoPath } from "@saas/spliteco-ui/money-tab";
import { useSession } from "@/lib/session";
import { useProfile } from "./data";
import { splitecoToCookpool } from "./spliteco-paths";

/**
 * Money, Spliteco inside (money-inside MN-3, the canvas's "Money, calmer" B
 * boards): the tab shows Spliteco's own Money screens in its Deep ocean, the
 * same as Tripeco's — read through this app's API client — with "‹ Cookpool"
 * back Home. Since MN-8, Settle up, + Expense and a whole group open
 * Spliteco's own screens inside Cookpool (/money/settle-up, /money/add,
 * /money/group), never the Spliteco app. `?group=org_…` opens on that group.
 */
export function MoneyInside() {
  const router = useRouter();
  const params = useSearchParams();
  const { client } = useSession();
  const profile = useProfile();
  const api = React.useMemo(
    () => ({
      groups: () => client.spliteco.groups(),
      group: (id: string) => client.spliteco.group(id),
      groupActivity: (id: string) => client.spliteco.groupActivity(id),
      remind: (body: Parameters<typeof client.spliteco.remind>[0]) => client.spliteco.remind(body),
    }),
    [client],
  );
  // Settle up, + Expense and a whole group open Spliteco's own screens here, under /money (MN-8).
  const open = (t: SplitecoOpen) => router.push(splitecoToCookpool(splitecoPath(t)));
  const group = params?.get("group");
  return (
    <SplitecoMoneyTab
      api={api}
      hostName="Cookpool"
      onBack={() => router.push("/home")}
      meId={profile.data?.id ?? null}
      onOpen={open}
      initialGroupId={group && /^org_[A-Za-z0-9]{1,64}$/.test(group) ? group : null}
    />
  );
}
