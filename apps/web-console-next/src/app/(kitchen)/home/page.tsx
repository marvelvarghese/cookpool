"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, HandCoins, Plus, Scale, Search, Ticket, UsersRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/components/account/profile";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useGroups, useProfile } from "@/components/kitchen/data";
import { friendlyName, greetingFor } from "@/components/kitchen/home";
import { sortGroups } from "@/components/kitchen/groups";
import { GroupAvatar, IconBubble, KCard, K_BUTTON, SoonBadge } from "@/components/kitchen/kit";
import { Money } from "@/components/kitchen/ledger-ui";
import { useMyBalances } from "@/components/kitchen/people-data";
import { homeBalance, netWords } from "@/components/kitchen/people";

/**
 * Home (CP-5; balances since CP-8, across groups since CP-9). The inbox and
 * quick use arrive with later milestones; Home greets the person, shows the
 * quick-use field as "Soon", the balance card, and their groups.
 */
export default function HomePage() {
  const profile = useProfile();
  const user = profile.data;
  const name = user ? friendlyName(user.displayName, user.email) : null;
  const greeting = greetingFor(new Date().getHours());

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {profile.loading ? (
            <Skeleton className="h-8 w-56" />
          ) : (
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">
              {name ? `${greeting}, ${name}` : greeting}
            </h1>
          )}
          <p className="mt-1 text-sm text-muted-foreground">Your kitchen, across every group.</p>
        </div>
        <Link
          href="/account"
          aria-label="Account settings"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cp-herb-tint text-sm font-bold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[900px]:hidden"
        >
          {user ? initials(user.displayName ?? null, user.email) : ""}
        </Link>
      </header>

      <QuickUse />
      <BalanceCard />
      <YourGroups />
    </div>
  );
}

function QuickUse() {
  return (
    <section aria-label="Quick use">
      <label htmlFor="quick-use" className="sr-only">
        What did you use?
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id="quick-use"
          type="search"
          disabled
          placeholder="What did you use?"
          aria-describedby="quick-use-note"
          className="h-14 w-full cursor-not-allowed rounded-2xl border border-input bg-card pl-12 pr-20 text-base placeholder:text-muted-foreground"
        />
        <SoonBadge className="absolute right-4 top-1/2 -translate-y-1/2" />
      </div>
      <p id="quick-use-note" className="mt-2 px-1 text-sm text-muted-foreground">
        Logging what you used, in two taps, arrives with pantries.
      </p>
    </section>
  );
}

/** People listed on the balance card before "and N more". */
const HOME_PEOPLE_ROWS = 4;

/**
 * Where you stand across every group, from one cross-group read (CP-9):
 * "Across 3 groups · You're owed ₹… — ₹… to you · ₹… from you", one line per
 * currency, then the people with money open between you, largest first.
 * Every amount opens People or the person; Settle up when any payment
 * involves you.
 */
function BalanceCard() {
  const balances = useMyBalances();
  const data = balances.data;
  const summary = data ? homeBalance(data, HOME_PEOPLE_ROWS) : null;

  return (
    <KCard className="p-5">
      <div className="flex items-center gap-3">
        <IconBubble icon={Scale} tone="blue" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold tracking-tight">Your balance</h2>
          {summary && data && data.groups.length > 0 ? (
            <p className="text-xs text-muted-foreground">{summary.across}</p>
          ) : null}
        </div>
        {summary?.settleUp ? (
          <Button asChild variant="outline" className={K_BUTTON}>
            <Link href="/settle">
              <HandCoins aria-hidden />
              Settle up
            </Link>
          </Button>
        ) : null}
      </div>

      {balances.loading ? (
        <div className="mt-4 space-y-2" aria-hidden>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      ) : balances.error || !summary || !data ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your balance. {balances.error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
            Try again
          </Button>
        </div>
      ) : data.groups.length === 0 ? (
        <>
          <p className="mt-4 text-lg font-bold">No balances yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Balances appear once your groups start logging.</p>
        </>
      ) : (
        <>
          <ul className="mt-3 space-y-1">
            {summary.totals.map((t) => (
              <li key={t.currency}>
                <Link
                  href="/people"
                  className="-mx-2 block rounded-xl px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "block text-2xl font-extrabold tracking-tight tabular-nums",
                      t.tone === "owed" ? "text-cp-owed" : t.tone === "owe" ? "text-cp-owe" : "",
                    )}
                  >
                    {t.headline}
                  </span>
                  <span className="block text-sm tabular-nums text-muted-foreground">{t.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
          {summary.people.length > 0 ? (
            <ul className="mt-2 divide-y border-t">
              {summary.people.map((p) => (
                <li key={p.subjectId}>
                  <Link
                    href={`/people/${encodeURIComponent(p.subjectId)}`}
                    className="-mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      {p.initial}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.label}</span>
                    <span className="shrink-0 text-right">
                      {p.nets.map((n) => (
                        <span key={n.currency} className={cn("block text-sm", n.netMinor > 0 ? "text-cp-owed" : "text-cp-owe")}>
                          {netWords(n.netMinor)} <Money minor={Math.abs(n.netMinor)} currency={n.currency} className="font-bold" />
                        </span>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.morePeople > 0 ? (
            <p className="pt-2 text-sm text-muted-foreground">
              and {summary.morePeople} more —{" "}
              <Link href="/people" className="font-semibold text-primary underline-offset-2 hover:underline">
                see everyone
              </Link>
            </p>
          ) : null}
        </>
      )}
    </KCard>
  );
}

function YourGroups() {
  const groups = useGroups();
  const recentSlugs = useRecentGroupSlugs();
  const list = React.useMemo(
    () => sortGroups(groups.data ?? [], "recent", recentSlugs).slice(0, 8),
    [groups.data, recentSlugs],
  );

  return (
    <section aria-labelledby="home-groups" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="home-groups" className="text-lg font-bold tracking-tight">
          Your groups
        </h2>
        {list.length > 0 ? (
          <Link
            href="/groups"
            className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            See all
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
      </div>

      {groups.loading ? (
        <div className="flex gap-3" aria-hidden>
          <Skeleton className="h-32 w-40 rounded-[18px]" />
          <Skeleton className="h-32 w-40 rounded-[18px]" />
        </div>
      ) : groups.error ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your groups. {groups.error.message}</p>
          <Button variant="outline" className={K_BUTTON} onClick={groups.reload}>
            Try again
          </Button>
        </KCard>
      ) : list.length === 0 ? (
        <KCard className="p-5">
          <div className="flex items-start gap-4">
            <IconBubble icon={UsersRound} />
            <div className="min-w-0">
              <h3 className="text-base font-bold tracking-tight">Cook with the people you eat with</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Start a group for your flat or lunch club, or join one with a link someone sent you.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild className={K_BUTTON}>
              <Link href="/groups?new=1">
                <Plus aria-hidden />
                New group
              </Link>
            </Button>
            <Button asChild variant="outline" className={K_BUTTON}>
              <Link href="/groups?join=1">
                <Ticket aria-hidden />
                Join with a code
              </Link>
            </Button>
          </div>
        </KCard>
      ) : (
        <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 min-[900px]:mx-0 min-[900px]:grid min-[900px]:grid-cols-3 min-[900px]:overflow-visible min-[900px]:px-0 min-[900px]:pb-0">
          {list.map((g) => (
            <li key={g.id} className="w-40 shrink-0 snap-start min-[900px]:w-auto">
              <Link
                href={`/groups/${g.slug}`}
                className="flex h-full min-h-32 flex-col justify-between gap-3 rounded-[18px] border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <GroupAvatar name={g.name} />
                <span className="line-clamp-2 text-[15px] font-bold leading-snug">{g.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
