"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import type { MyBalancesResponse } from "@saas/contracts/kitchen";
import type { PublicOrganization } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroups, useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON } from "@/components/kitchen/kit";
import { Face } from "@/components/kitchen/faces-ui";
import type { MoneyLine } from "@/components/kitchen/home";
import { useGroupRole, useSettlePlan } from "@/components/kitchen/ledger-data";
import { useMemberNames, useMyBalances } from "@/components/kitchen/people-data";
import { everyoneIn, peopleMoney, type PeopleRow } from "@/components/kitchen/people";
import { PaymentRow, recordable } from "@/components/kitchen/settle-card";
import { groupPlansFromBalances, mergeAllGroups, paymentsYoursFirst } from "@/components/kitchen/settle";

/**
 * People (CP-9) and Settle up (CP-8), one screen since SM-11 — the People
 * tab. Your money, one headline per currency with money open ("You get back
 * ₹62.50", "You owe $25.00"; no zero cells); then the fewest payments, each
 * with its one action (Record → UPI · Cash · Bank) or why there is none in
 * two words; then everyone you share a group with, as faces, each opening
 * that person. `?group=` (a group's Settle up; `/settle?group=` leads here)
 * shows just that group: your balance there, its whole plan (an owner or
 * admin records anyone's payment) and its people; × goes back to all.
 */
export default function PeoplePage() {
  const searchParams = useSearchParams();
  const groups = useGroups();
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const balances = useMyBalances();
  const slug = searchParams?.get("group") ?? null;
  const group = slug ? (groups.data?.find((g) => g.slug === slug) ?? null) : null;
  const data = balances.data;

  return (
    <div className="space-y-4">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">People</h1>
        {group ? (
          <Link
            href="/people"
            aria-label={`${group.name}: show every group`}
            className="inline-flex min-h-11 max-w-[60%] items-center gap-1.5 rounded-full border border-primary bg-accent pl-4 pr-3 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">{group.name}</span>
            <X className="h-4 w-4 shrink-0" aria-hidden />
          </Link>
        ) : null}
      </header>

      {balances.loading || (slug && groups.loading) ? (
        <div className="space-y-4" aria-hidden>
          <Skeleton className="h-[88px] w-full rounded-[22px]" />
          <Skeleton className="h-40 w-full rounded-[22px]" />
        </div>
      ) : balances.error || !data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your people.</p>
          <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
            Try again
          </Button>
        </KCard>
      ) : data.groups.length === 0 ? (
        <KCard className="flex flex-col items-center px-6 py-10 text-center">
          <h2 className="text-lg font-bold tracking-tight">No one here yet</h2>
          <Button asChild className={cn(K_BUTTON, "mt-4")}>
            <Link href="/groups">Your groups</Link>
          </Button>
        </KCard>
      ) : (
        <div className="space-y-5 min-[900px]:grid min-[900px]:grid-cols-[minmax(0,320px)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-6 min-[900px]:space-y-0">
          <MoneyHeadlines lines={peopleMoney(data, group?.id)} />
          <div className="min-w-0 space-y-5">
            {group ? <GroupPayments group={group} myId={myId} /> : <AllPayments data={data} myId={myId} />}
            <Everyone rows={everyoneIn(data, group?.id)} myId={myId} />
          </div>
        </div>
      )}
    </div>
  );
}

const TONE: Record<MoneyLine["tone"], string> = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-foreground" };

/** One headline per currency with money open, side by side; "Settled up" when none is. */
function MoneyHeadlines({ lines }: { lines: readonly MoneyLine[] }) {
  return (
    <section aria-label="Your money" className={cn("grid gap-3 rounded-[22px] border bg-card px-[18px] py-3", lines.length > 1 && "grid-cols-2")}>
      {lines.map((l) => (
        <p key={l.currency} className="min-w-0">
          <span className="block text-[13px] font-bold text-muted-foreground">{l.amount ? l.label : ""}</span>
          <span className={cn("block truncate text-[28px] font-extrabold leading-tight tracking-tight tabular-nums", TONE[l.tone])}>
            {l.amount ?? l.label}
          </span>
        </p>
      ))}
    </section>
  );
}

/** Every group's payments that involve you, from the one cross-group read: what you pay first. */
function AllPayments({ data, myId }: { data: MyBalancesResponse; myId: string | null }) {
  const merged = React.useMemo(() => mergeAllGroups(myId ? groupPlansFromBalances(data, myId) : [], myId), [data, myId]);
  // In a group you only view, your payments are listed but you don't record them.
  const viewing = new Set(data.groups.filter((g) => g.role === "viewer").map((g) => g.orgId));
  if (merged.payments.length === 0) return null;
  return (
    <Payments>
      {merged.payments.map((p) => (
        <PaymentRow
          key={`${p.group.id}:${p.fromSubjectId}>${p.toSubjectId}`}
          orgId={p.group.id}
          payment={p}
          currency={p.currency}
          meId={myId}
          groupName={p.group.name}
          {...recordable(p, { meId: myId, canWrite: !viewing.has(p.group.id), manager: false })}
        />
      ))}
    </Payments>
  );
}

/** One group's whole plan (an owner or admin records anyone's payment), yours first. */
function GroupPayments({ group, myId }: { group: PublicOrganization; myId: string | null }) {
  const plan = useSettlePlan(group.id);
  const { manager, canWrite } = useGroupRole(group.id, myId);
  if (plan.loading) return <Skeleton className="h-32 w-full rounded-[22px]" />;
  if (plan.error || !plan.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the payments.</p>
        <Button variant="outline" className={K_BUTTON} onClick={plan.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  const payments = paymentsYoursFirst(plan.data.payments, myId);
  if (payments.length === 0) return null;
  const currency = plan.data.currency;
  return (
    <Payments>
      {payments.map((p) => (
        <PaymentRow
          key={`${p.fromSubjectId}>${p.toSubjectId}`}
          orgId={group.id}
          payment={p}
          currency={currency}
          meId={myId}
          {...recordable(p, { meId: myId, canWrite, manager })}
        />
      ))}
    </Payments>
  );
}

function Payments({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="people-payments" className="space-y-2">
      <h2 id="people-payments" className="text-lg font-extrabold tracking-tight">
        Payments
      </h2>
      <ul className="divide-y rounded-[22px] border bg-card px-4">{children}</ul>
    </section>
  );
}

/** Everyone you share a group with, as faces; each opens what is between you two. */
function Everyone({ rows, myId }: { rows: readonly PeopleRow[]; myId: string | null }) {
  const names = useMemberNames();
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="people-everyone" className="space-y-2">
      <h2 id="people-everyone" className="text-lg font-extrabold tracking-tight">
        Everyone
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-x-1.5 gap-y-3">
        {rows.map((r) => (
          <li key={r.subjectId} className="min-w-0">
            <Link
              href={`/people/${encodeURIComponent(r.subjectId)}`}
              className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-0.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Face subjectId={r.subjectId} meId={myId} names={names} className="h-[52px] w-[52px] text-[15px]" />
              <span className="max-w-full truncate text-[13px] font-semibold">{r.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
