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
import { byGroupRows, friendlyName, greetingFor, recentAcrossGroups, recentGroupsToRead } from "@/components/kitchen/home";
import { GroupAvatar, IconBubble, KCard, K_BUTTON } from "@/components/kitchen/kit";
import { Money } from "@/components/kitchen/ledger-ui";
import { useMemberNames, useMyBalances } from "@/components/kitchen/people-data";
import { homeBalance, netWords } from "@/components/kitchen/people";
import { HomeUseSoon } from "@/components/kitchen/pantry-cards";
import { useInbox, useRecentActivity } from "@/components/kitchen/inbox-data";
import { inboxItemIds } from "@/components/kitchen/inbox";
import { NeedsYou, RecentActivityList } from "@/components/kitchen/inbox-ui";

/**
 * Home (CP-5; balances since CP-8, across groups since CP-9, use soon since
 * CP-12, quick use since CP-13, the inbox since CP-23): "What did you use?",
 * your balance, Needs you — one card per thing that needs you, each done in
 * place (claim, finalize, I had a glass, I paid, a flag) or All clear — then
 * Use soon (what the inbox doesn't already list), Recent activity across
 * your groups, and your balance by group.
 *
 * Phones: one column in that order (by group last). From 900px, beside the
 * sidebar, two columns: balance, by group and recent activity · needs you
 * and use soon. From 1280px three: balance and by group · needs you and use
 * soon · recent activity (design §7's web page).
 */
export default function HomePage() {
  const profile = useProfile();
  const user = profile.data;
  const meId = user?.id ?? null;
  const name = user ? friendlyName(user.displayName, user.email) : null;
  const greeting = greetingFor(new Date().getHours());
  const names = useMemberNames();
  const inbox = useInbox();
  const inInbox = React.useMemo(() => inboxItemIds(inbox.data), [inbox.data]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 min-[1280px]:flex-row min-[1280px]:items-end min-[1280px]:justify-between">
        <div className="flex items-start justify-between gap-4">
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
        </div>
        <QuickUse className="min-[1280px]:w-[26rem] min-[1280px]:shrink-0" />
      </header>

      {/*
        One DOM order for every width: column 1 (balance, by group), column 2
        (needs you, use soon), column 3 (recent). On phones the columns
        dissolve (`contents`) into one list and "By group" goes last.
      */}
      <div
        className={cn(
          "flex flex-col gap-6",
          "min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:grid-rows-[auto_1fr] min-[900px]:items-start min-[900px]:gap-x-6 min-[900px]:gap-y-6",
          "min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] min-[1280px]:grid-rows-1",
        )}
      >
        <div className="contents min-[900px]:col-start-1 min-[900px]:row-start-1 min-[900px]:flex min-[900px]:min-w-0 min-[900px]:flex-col min-[900px]:gap-6">
          <BalanceCard />
          <ByGroup className="order-last min-[900px]:order-none" />
        </div>
        <div className="contents min-[900px]:col-start-2 min-[900px]:row-span-2 min-[900px]:row-start-1 min-[900px]:flex min-[900px]:min-w-0 min-[900px]:flex-col min-[900px]:gap-6 min-[1280px]:row-span-1">
          <NeedsYou inbox={inbox} meId={meId} names={names} />
          <HomeUseSoon exclude={inInbox} />
        </div>
        <div className="contents min-[900px]:col-start-1 min-[900px]:row-start-2 min-[900px]:flex min-[900px]:min-w-0 min-[900px]:flex-col min-[900px]:gap-6 min-[1280px]:col-start-3 min-[1280px]:row-start-1">
          <RecentActivity meId={meId} />
        </div>
      </div>
    </div>
  );
}

/**
 * "What did you use?" (CP-13): looks like the search it opens — quick use
 * (/use), which searches every pantry you use from and shows your usuals.
 */
function QuickUse({ className }: { className?: string }) {
  return (
    <section aria-label="Quick use" className={className}>
      <Link
        href="/use"
        aria-describedby="quick-use-note"
        className="flex h-14 w-full items-center gap-3 rounded-2xl border border-input bg-card px-4 text-base text-muted-foreground shadow-[0_1px_2px_rgba(23,32,27,0.04)] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">What did you use?</span>
      </Link>
      <p id="quick-use-note" className="mt-2 px-1 text-sm text-muted-foreground min-[1280px]:sr-only">
        Search every pantry, or tap + Add to log one of your usuals again.
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
      <div className="flex flex-wrap items-center gap-3">
        <IconBubble icon={Scale} tone="blue" />
        {/* In a narrow column Settle up wraps under the heading rather than squeezing it. */}
        <div className="min-w-[8rem] flex-1">
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
        <p className="mt-3 text-sm text-muted-foreground">Balances appear once your groups start logging.</p>
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

/** Groups "By group" lists before "All N". */
const BY_GROUP_ROWS = 6;

/**
 * Your balance in each group (the balance card's breakdown, CP-23), money
 * open first; each opens the group. With no groups yet: start one or join.
 */
function ByGroup({ className }: { className?: string }) {
  const balances = useMyBalances();
  const groups = useGroups();
  const recentSlugs = useRecentGroupSlugs();
  const rows = React.useMemo(() => byGroupRows(balances.data?.groups ?? [], recentSlugs), [balances.data, recentSlugs]);
  const shown = rows.slice(0, BY_GROUP_ROWS);
  const loading = balances.loading || groups.loading;
  const none = !loading && !balances.error && rows.length === 0 && (groups.data?.length ?? 0) === 0;

  return (
    <section aria-labelledby="home-by-group" className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h2 id="home-by-group" className="text-lg font-bold tracking-tight">
          By group
        </h2>
        {rows.length > 0 ? (
          <Link
            href="/groups"
            className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {rows.length > BY_GROUP_ROWS ? `All ${rows.length}` : "Groups"}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-14 w-full rounded-[18px]" />
          <Skeleton className="h-14 w-full rounded-[18px]" />
        </div>
      ) : balances.error ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your groups. {balances.error.message}</p>
          <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
            Try again
          </Button>
        </KCard>
      ) : none ? (
        <KCard className="p-5">
          <div className="flex items-start gap-4">
            <IconBubble icon={UsersRound} />
            <div className="min-w-0">
              <h3 className="text-base font-bold tracking-tight">Cook with the people you eat with</h3>
              <p className="mt-1 text-sm text-muted-foreground">Start a group for your flat or lunch club, or join one with a link.</p>
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
        <ul className="divide-y overflow-hidden rounded-[20px] border bg-card">
          {shown.map((g) => (
            <li key={g.orgId}>
              <Link
                href={g.href}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <GroupAvatar name={g.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{g.name}</span>
                <span
                  className={cn(
                    "shrink-0 text-right text-sm",
                    g.tone === "owed" ? "text-cp-owed" : g.tone === "owe" ? "text-cp-owe" : "text-muted-foreground",
                  )}
                >
                  {g.words}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Recent activity across your groups: the newest entries of the groups you opened most recently. */
function RecentActivity({ meId }: { meId: string | null }) {
  const groups = useGroups();
  const recentSlugs = useRecentGroupSlugs();
  const names = useMemberNames();
  const toRead = React.useMemo(() => recentGroupsToRead(groups.data ?? [], recentSlugs), [groups.data, recentSlugs]);
  const recent = useRecentActivity(toRead);
  const now = React.useMemo(() => new Date(), []);
  const rows = recentAcrossGroups(recent.data, { meId, names, now });
  return (
    <RecentActivityList
      rows={rows}
      loading={groups.loading || recent.loading}
      failed={recent.failed}
      reload={recent.reload}
      hasGroups={(groups.data?.length ?? 0) > 0}
    />
  );
}
