"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SplitecoMoneyTab, type SplitecoOpen } from "@saas/spliteco-ui/money-tab-ui";
import { splitecoPath } from "@saas/spliteco-ui/money-tab";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "./data";
import { handoffCode, moneyError } from "./kitchen-money-data";
import { handoffUrlTo, splitecoOriginFor } from "./spliteco-link";

/**
 * Money, Spliteco inside (money-inside MN-3, the canvas's "Money, calmer" B
 * boards): the tab shows Spliteco's own Money screens in its Deep ocean, the
 * same as Tripeco's — read through this app's API client — with "‹ Cookpool"
 * back Home. Settle up, + Expense and a whole group open the Spliteco app,
 * signed in with a one-time code, and come back here. `?group=org_…` opens on
 * that group.
 */
export function MoneyInside() {
  const router = useRouter();
  const params = useSearchParams();
  const { client, target } = useSession();
  const { toast } = useToast();
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
  const busy = React.useRef(false);
  const open = async (t: SplitecoOpen) => {
    if (busy.current) return;
    const origin = splitecoOriginFor(window.location.host, target.name);
    if (!origin) {
      toast({ kind: "error", title: "Spliteco isn't available here" });
      return;
    }
    busy.current = true;
    try {
      const code = await handoffCode(client, origin);
      window.location.assign(handoffUrlTo(origin, code, splitecoPath(t), window.location.href));
    } catch (err) {
      busy.current = false;
      toast({ kind: "error", title: "Couldn't open Spliteco", description: moneyError(err) });
    }
  };
  const group = params?.get("group");
  return (
    <SplitecoMoneyTab
      api={api}
      hostName="Cookpool"
      onBack={() => router.push("/home")}
      meId={profile.data?.id ?? null}
      onOpen={(t) => void open(t)}
      initialGroupId={group && /^org_[A-Za-z0-9]{1,64}$/.test(group) ? group : null}
    />
  );
}
