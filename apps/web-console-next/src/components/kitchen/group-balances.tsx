"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { BalancesResponse } from "@saas/contracts/kitchen";
import { Button } from "@/components/ui/button";
import { SkeletonRow } from "@/components/ui/skeleton";
import { KCard, K_BUTTON } from "./kit";
import { BalanceWords, PersonAvatar } from "./ledger-ui";
import { memberLabel, type MemberNames } from "./members";
import { useBalances, useSettlePlan } from "./ledger-data";
import { SettleCard } from "./settle-card";
import type { GroupRef } from "./settle";

/**
 * One group's money (CP-8, shared since CP-23): everyone's balance, each
 * other person opening everything between you two, then the fewest payments
 * with Record. The Groups page shows it beside the list from 900px (its
 * third column from 1280px).
 */
export function GroupBalancesPanel({
  group,
  myId,
  balances,
  manager,
  canWrite,
  names,
}: {
  group: GroupRef;
  myId: string | null;
  balances: ReturnType<typeof useBalances>;
  manager: boolean;
  canWrite: boolean;
  names: MemberNames;
}) {
  const plan = useSettlePlan(group.id);
  return (
    <div className="space-y-5">
      <KCard className="p-5">
        <h3 className="text-base font-bold tracking-tight">Everyone&apos;s balance</h3>
        {balances.loading ? (
          <div aria-hidden>
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : balances.error || !balances.data ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load the balances. {balances.error?.message ?? ""}</p>
            <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
              Try again
            </Button>
          </div>
        ) : (
          <BalanceList data={balances.data} myId={myId} names={names} />
        )}
      </KCard>
      <SettleCard
        group={group}
        plan={plan.data}
        loading={plan.loading}
        error={plan.error}
        reload={plan.reload}
        meId={myId}
        canRecordAny={manager}
        canWrite={canWrite}
      />
    </div>
  );
}

/** Everyone's balance; each other person opens their view (everything between you two). */
function BalanceList({ data, myId, names }: { data: BalancesResponse; myId: string | null; names: MemberNames }) {
  if (data.balances.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">No one has a balance yet.</p>;
  }
  return (
    <ul className="mt-2 divide-y">
      {data.balances.map((b) => {
        const row = (
          <>
            <PersonAvatar subjectId={b.subjectId} meId={myId} names={names} />
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{memberLabel(b.subjectId, myId, names)}</span>
            <BalanceWords minor={b.balanceMinor} currency={data.currency} className="shrink-0 text-right" />
          </>
        );
        return (
          <li key={b.subjectId}>
            {b.subjectId === myId ? (
              <div className="flex min-h-14 items-center gap-3 py-2">
                {row}
                {/* Lines up with the chevron on everyone else's row. */}
                <span aria-hidden className="w-4 shrink-0" />
              </div>
            ) : (
              <Link
                href={`/people/${encodeURIComponent(b.subjectId)}`}
                className="-mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
