"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, HandCoins, Search, UsersRound } from "lucide-react";
import type { CurrencyTotal } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { IconBubble, KCard, K_BUTTON, K_INPUT, PageHeader } from "@/components/kitchen/kit";
import { Money } from "@/components/kitchen/ledger-ui";
import { useMyBalances } from "@/components/kitchen/people-data";
import { acrossGroups, netWords, peopleRows, totalLine, type PeopleRow } from "@/components/kitchen/people";

/**
 * People (CP-9): everyone you share a group with and where you stand with
 * each — what every group's settle plan has between you, added up per
 * currency — largest amount first, searchable by name or group. Totals per
 * currency on top. Each person opens "You and {name}", which explains every
 * amount.
 */
export default function PeoplePage() {
  const balances = useMyBalances();
  const [query, setQuery] = React.useState("");
  const data = balances.data;
  const all = React.useMemo(() => peopleRows(data), [data]);
  const shown = React.useMemo(() => peopleRows(data, query), [data, query]);

  return (
    <div className="space-y-5">
      <PageHeader title="People" subtitle="Everyone you share a group with, and where you stand." />

      {balances.loading ? (
        <div className="space-y-4" aria-hidden>
          <Skeleton className="h-24 w-full rounded-[20px]" />
          <KCard className="px-4">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </KCard>
        </div>
      ) : balances.error || !data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your people. {balances.error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
            Try again
          </Button>
        </KCard>
      ) : data.groups.length === 0 ? (
        <KCard className="flex flex-col items-center px-6 py-12 text-center">
          <IconBubble icon={UsersRound} className="h-14 w-14" />
          <h2 className="mt-4 text-lg font-bold tracking-tight">No one here yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            People show up once you&apos;re in a group with them. Start one, or join one with a link.
          </p>
          <Button asChild className={cn(K_BUTTON, "mt-5")}>
            <Link href="/groups">Your groups</Link>
          </Button>
        </KCard>
      ) : (
        <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,320px)_minmax(0,1fr)] min-[900px]:items-start">
          <div className="min-[900px]:sticky min-[900px]:top-6">
            <Totals totals={data.totals} groupCount={data.groups.length} />
          </div>

          <div className="min-w-0 space-y-4">
            {all.length === 0 ? (
              <KCard className="flex flex-col items-center px-6 py-10 text-center">
                <IconBubble icon={HandCoins} tone="blue" className="h-14 w-14" />
                <h2 className="mt-4 text-lg font-bold tracking-tight">Just you so far</h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Send a group&apos;s join link to the people you cook with; they&apos;ll show up here.
                </p>
                <Button asChild variant="outline" className={cn(K_BUTTON, "mt-5")}>
                  <Link href="/groups">Invite from a group</Link>
                </Button>
              </KCard>
            ) : (
              <>
                <div className="relative">
                  <label htmlFor="people-search" className="sr-only">
                    Search people
                  </label>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="people-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search people or groups"
                    autoComplete="off"
                    className={cn(K_INPUT, "bg-card pl-11")}
                  />
                </div>
                <p aria-live="polite" className="sr-only">
                  {query ? `${shown.length} of ${all.length} people shown` : ""}
                </p>
                {shown.length === 0 ? (
                  <KCard className="flex flex-col items-center px-6 py-10 text-center">
                    <p className="text-base font-semibold">No one matches &ldquo;{query.trim()}&rdquo;</p>
                    <Button variant="ghost" className={cn(K_BUTTON, "mt-2 text-primary")} onClick={() => setQuery("")}>
                      Clear search
                    </Button>
                  </KCard>
                ) : (
                  <ul className="divide-y overflow-hidden rounded-[20px] border bg-card">
                    {shown.map((row) => (
                      <PersonRow key={row.subjectId} row={row} />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** What you're owed and what you owe, one block per currency (never added across). */
function Totals({ totals, groupCount }: { totals: readonly CurrencyTotal[]; groupCount: number }) {
  return (
    <KCard className="p-5">
      <p className="text-sm text-muted-foreground">{acrossGroups(groupCount)}</p>
      <ul className="mt-1 space-y-3">
        {totals.map((t) => {
          const line = totalLine(t);
          return (
            <li key={t.currency}>
              <p
                className={cn(
                  "text-2xl font-extrabold tracking-tight tabular-nums",
                  line.tone === "owed" ? "text-cp-owed" : line.tone === "owe" ? "text-cp-owe" : "",
                )}
              >
                {line.headline}
              </p>
              <p className="text-sm tabular-nums text-muted-foreground">{line.detail}</p>
            </li>
          );
        })}
      </ul>
    </KCard>
  );
}

function PersonRow({ row }: { row: PeopleRow }) {
  const groupNames = row.groups.map((g) => g.name).join(" · ");
  return (
    <li>
      <Link
        href={`/people/${encodeURIComponent(row.subjectId)}`}
        className="flex min-h-[68px] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold text-muted-foreground"
        >
          {row.initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold">{row.label}</span>
          <span className="block truncate text-sm text-muted-foreground">{groupNames}</span>
        </span>
        <span className="shrink-0 text-right">
          {row.settled ? (
            <span className="text-sm text-muted-foreground">settled</span>
          ) : (
            row.nets.map((n) => (
              <span key={n.currency} className={cn("block text-xs font-medium leading-snug", n.netMinor > 0 ? "text-cp-owed" : "text-cp-owe")}>
                {netWords(n.netMinor)}
                <Money minor={Math.abs(n.netMinor)} currency={n.currency} className="block text-[15px] font-bold" />
              </span>
            ))
          )}
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}
