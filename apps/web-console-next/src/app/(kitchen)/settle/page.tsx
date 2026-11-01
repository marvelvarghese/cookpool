"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, HandCoins, UsersRound } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroups, useProfile } from "@/components/kitchen/data";
import { IconBubble, KCard, K_BUTTON, PageHeader } from "@/components/kitchen/kit";
import { GroupPickerButton } from "@/components/kitchen/group-picker";
import { useGroupRole, useSettlePlan } from "@/components/kitchen/ledger-data";
import { useMyBalances } from "@/components/kitchen/people-data";
import { PaymentRow, SettleCard, SettleNote } from "@/components/kitchen/settle-card";
import { Money } from "@/components/kitchen/ledger-ui";
import { ALL_GROUPS, groupPlansFromBalances, initialSettleChoice, mergeAllGroups } from "@/components/kitchen/settle";

/**
 * Settle up (CP-8). A searchable group picker with All groups; it opens on
 * the group you came from (`?group=`), else All groups. One group: its
 * fewest-payments card — the working, the debts behind it, every payment
 * with Record. All groups: every group's payments that involve you, from one
 * cross-group read (`myBalances`, CP-9). A viewer records nothing.
 */
export default function SettlePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const groups = useGroups();
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const list = React.useMemo(() => groups.data ?? [], [groups.data]);
  const choice = initialSettleChoice(searchParams?.get("group"), list);
  const group = choice === ALL_GROUPS ? null : (list.find((g) => g.slug === choice) ?? null);

  const choose = (slug: string) => {
    router.replace(slug === ALL_GROUPS ? "/settle" : `/settle?group=${encodeURIComponent(slug)}`, { scroll: false });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settle up" subtitle="The fewest payments that square everyone up." />
      <SettleNote />

      {groups.loading || profile.loading ? (
        <div className="space-y-4" aria-hidden>
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-[20px]" />
        </div>
      ) : groups.error ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your groups. {groups.error.message}</p>
          <Button variant="outline" className={K_BUTTON} onClick={groups.reload}>
            Try again
          </Button>
        </KCard>
      ) : list.length === 0 ? (
        <KCard className="flex flex-col items-center px-6 py-12 text-center">
          <IconBubble icon={UsersRound} className="h-14 w-14" />
          <h2 className="mt-4 text-lg font-bold tracking-tight">No groups yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Settling up happens inside a group. Start one, or join one with a link.
          </p>
          <Button asChild className={cn(K_BUTTON, "mt-5")}>
            <Link href="/groups">Your groups</Link>
          </Button>
        </KCard>
      ) : (
        <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,320px)_minmax(0,1fr)] min-[900px]:items-start">
          <div className="min-[900px]:sticky min-[900px]:top-6">
            <GroupPickerButton groups={list} value={choice} onChange={choose} allGroups label="Settle up in" />
          </div>
          <div className="min-w-0">
            {group ? <OneGroup group={group} myId={myId} /> : <AllGroups myId={myId} />}
          </div>
        </div>
      )}
    </div>
  );
}

function OneGroup({ group, myId }: { group: PublicOrganization; myId: string | null }) {
  const plan = useSettlePlan(group.id);
  const { manager, canWrite } = useGroupRole(group.id, myId);
  return (
    <div className="space-y-3">
      <SettleCard
        group={group}
        plan={plan.data}
        loading={plan.loading}
        error={plan.error}
        reload={plan.reload}
        meId={myId}
        canRecordAny={manager}
        canWrite={canWrite}
        showGroup
      />
      <Link
        href={`/groups/${group.slug}?tab=balances`}
        className="inline-flex min-h-11 items-center gap-1 rounded-xl px-1 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {group.name}&apos;s balances and activity
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

function AllGroups({ myId }: { myId: string | null }) {
  const balances = useMyBalances();
  const plans = React.useMemo(
    () => (balances.data && myId ? groupPlansFromBalances(balances.data, myId) : []),
    [balances.data, myId],
  );
  const merged = mergeAllGroups(plans, myId);
  // In a group you only view, your payments are listed but you don't record them.
  const viewing = new Set((balances.data?.groups ?? []).filter((g) => g.role === "viewer").map((g) => g.orgId));

  if (balances.loading) {
    return (
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-24 w-full rounded-[20px]" />
        <Skeleton className="h-40 w-full rounded-[20px]" />
      </div>
    );
  }
  if (balances.error || !balances.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t check your groups. {balances.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
          Try again
        </Button>
      </KCard>
    );
  }

  return (
    <div className="space-y-4">
      {merged.totals.length > 0 ? (
        <KCard className="grid grid-cols-2 gap-x-4 gap-y-3 p-5">
          {merged.totals.map((t) => (
            <React.Fragment key={t.currency}>
              <div>
                <p className="text-sm text-muted-foreground">You pay{merged.totals.length > 1 ? ` (${t.currency})` : ""}</p>
                <p className={cn("text-2xl font-extrabold tracking-tight", t.youPayMinor > 0 ? "text-cp-owe" : "text-muted-foreground")}>
                  <Money minor={t.youPayMinor} currency={t.currency} />
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">You get back{merged.totals.length > 1 ? ` (${t.currency})` : ""}</p>
                <p className={cn("text-2xl font-extrabold tracking-tight", t.youGetMinor > 0 ? "text-cp-owed" : "text-muted-foreground")}>
                  <Money minor={t.youGetMinor} currency={t.currency} />
                </p>
              </div>
            </React.Fragment>
          ))}
        </KCard>
      ) : null}

      <KCard className="p-5">
        <h2 className="text-base font-bold tracking-tight">Your payments, every group</h2>
        {merged.payments.length > 0 ? (
          <ul className="mt-1 divide-y">
            {merged.payments.map((p) => (
              <PaymentRow
                key={`${p.group.id}:${p.fromSubjectId}>${p.toSubjectId}`}
                orgId={p.group.id}
                payment={p}
                currency={p.currency}
                meId={myId}
                canRecord={!viewing.has(p.group.id)}
                groupName={p.group.name}
                groupHref={`/settle?group=${encodeURIComponent(p.group.slug)}`}
              />
            ))}
          </ul>
        ) : (
          <div className="mt-3 flex items-center gap-3">
            <IconBubble icon={HandCoins} tone="blue" />
            <p className="text-sm text-muted-foreground">You&apos;re settled up in every group.</p>
          </div>
        )}
      </KCard>
    </div>
  );
}
