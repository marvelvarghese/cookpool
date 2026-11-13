"use client";

// Money (money-inside MN-4, the canvas's "Money, calmer" B boards): Spliteco
// inside — the same Spliteco Money screens Cookpool's Money tab shows, in
// Spliteco's Deep ocean, read with this app's client. "‹ Tripeco" goes back
// to Home; Settle up, + Expense and a whole group open Spliteco (you signed
// in to Tripeco through it, so it already knows you).

import * as React from "react";
import { SplitecoMoneyTab, type SplitecoOpen } from "@saas/spliteco-ui/money-tab-ui";
import { splitecoPath } from "@saas/spliteco-ui/money-tab";
import { useSession } from "@/lib/session";
import { useMe } from "@/lib/me";
import { splitecoOriginFor } from "@/lib/links";

export function MoneyTab({ onBack }: { onBack: () => void }) {
  const { client } = useSession();
  const { me } = useMe();
  const api = React.useMemo(
    () => ({
      groups: () => client.spliteco.groups(),
      group: (id: string) => client.spliteco.group(id),
      groupActivity: (id: string) => client.spliteco.groupActivity(id),
      remind: (body: Parameters<typeof client.spliteco.remind>[0]) => client.spliteco.remind(body),
    }),
    [client],
  );
  const open = (t: SplitecoOpen) => {
    const origin = splitecoOriginFor(window.location.host);
    if (origin) window.location.assign(`${origin}${splitecoPath(t)}`);
  };
  return <SplitecoMoneyTab api={api} hostName="Tripeco" onBack={onBack} meId={me?.id ?? null} onOpen={open} />;
}
