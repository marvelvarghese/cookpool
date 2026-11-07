"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Plus, Search, Ticket } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { rememberedGroupId, useRecentGroupSlugs } from "@/lib/recent-groups";
import { useGroups, useProfile } from "@/components/kitchen/data";
import { personInitials } from "@/components/kitchen/you";
import { RECENT_GROUPS, friendlyName, homeGreeting, homeMoney, recentAcrossGroups, recentGroupsToRead } from "@/components/kitchen/home";
import { K_BUTTON } from "@/components/kitchen/kit";
import { Face } from "@/components/kitchen/faces-ui";
import { useMemberNames, useMyBalances } from "@/components/kitchen/people-data";
import { useItemsByRef, useLogUse, useUsuals } from "@/components/kitchen/pantry-data";
import { doItAgainRows, usualRef, usualsThatFit, type DoItAgainRow } from "@/components/kitchen/quick-use";
import { useInbox, useRecentActivity } from "@/components/kitchen/inbox-data";
import { HomeTodoList, RecentActivityList } from "@/components/kitchen/inbox-ui";
import { usePrefetchKitchen } from "@/components/kitchen/prefetch";
import { parseDishRef } from "@/components/kitchen/dish";
import { InstallCard } from "@/components/kitchen/install-ui";

/**
 * Home (CP-5; SM-10 as the canvas's "Simpler — Home" draws it): "Hi, Rahul",
 * one money line (You get back / You owe, in your currency), "What did you
 * use?" and one row of your usuals (one tap logs one again, with Undo), at
 * most three to-dos in a compact list ("See all" for the rest), and a short
 * Recent. Who owes whom is People's and each payment is a to-do, so every
 * debt shows once; "By group" is the Groups tab's. On a phone it fits one
 * screen with three to-dos.
 *
 * From 900px, beside the sidebar, two columns: money, usuals and recent ·
 * to-dos.
 *
 * PW-2: under the greeting, the one invitation to install Cookpool, from the
 * device's second day and never in the installed app (`InstallCard`).
 */
export default function HomePage() {
  const profile = useProfile();
  const user = profile.data;
  const meId = user?.id ?? null;
  const name = user ? friendlyName(user.displayName, user.email) : null;
  const names = useMemberNames();
  const inbox = useInbox();

  return (
    <div className="space-y-3">
      <header className="flex min-h-11 items-center justify-between gap-4">
        {profile.loading ? (
          <Skeleton className="h-8 w-40" />
        ) : (
          <h1 className="min-w-0 truncate text-[26px] font-extrabold leading-tight tracking-tight">{homeGreeting(name)}</h1>
        )}
        {/* Your avatar opens You (SI-6); from 900px the sidebar's "Me" does. */}
        <Link
          href="/you"
          aria-label="You"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cp-herb-tint text-sm font-bold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[900px]:hidden"
        >
          {user ? personInitials(user) : ""}
        </Link>
      </header>

      <InstallCard />

      <div className="flex flex-col gap-3 min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:items-start min-[900px]:gap-6">
        <div className="contents min-[900px]:flex min-[900px]:min-w-0 min-[900px]:flex-col min-[900px]:gap-4">
          <MoneyCard />
          <QuickUse meId={meId} />
        </div>
        <HomeTodoList inbox={inbox} meId={meId} names={names} className="min-[900px]:row-span-2" />
        <RecentActivity meId={meId} className="min-[900px]:col-start-1" />
      </div>
    </div>
  );
}

/**
 * Your money in one line (SM-10): "You get back ₹62.50" in the currency most
 * of your groups count in, and "You owe $25.00" under it for any other
 * currency with money open. The card opens People, where each person is.
 */
function MoneyCard() {
  const balances = useMyBalances();
  const money = balances.data ? homeMoney(balances.data) : null;

  if (balances.loading) return <Skeleton className="h-[102px] w-full rounded-[22px]" />;
  if (balances.error || !money) {
    return (
      <div className="flex min-h-[68px] items-center justify-between gap-3 rounded-[22px] border bg-card px-4">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your balance.</p>
        <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (money.noGroups) {
    // Nothing to owe yet: start a group, or join one.
    return (
      <div className="grid grid-cols-2 gap-2">
        <Button asChild className={cn(K_BUTTON, "h-12")}>
          <Link href="/groups?new=1">
            <Plus aria-hidden />
            New group
          </Link>
        </Button>
        <Button asChild variant="outline" className={cn(K_BUTTON, "h-12")}>
          <Link href="/groups?join=1">
            <Ticket aria-hidden />
            Join
          </Link>
        </Button>
      </div>
    );
  }
  const tone = (t: "owed" | "owe" | "settled") => (t === "owed" ? "text-cp-owed" : t === "owe" ? "text-cp-owe" : "text-foreground");
  return (
    <Link
      href="/people"
      className="flex items-center gap-3 rounded-[22px] border bg-card px-[18px] py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-muted-foreground">{money.main.label}</span>
        {money.main.amount ? (
          <span className={cn("block text-[34px] font-extrabold leading-tight tracking-tight tabular-nums", tone(money.main.tone))}>
            {money.main.amount}
          </span>
        ) : null}
        {money.others.map((o) => (
          <span key={o.currency} className={cn("block text-sm font-bold tabular-nums", tone(o.tone))}>
            {o.text}
          </span>
        ))}
      </span>
      <ChevronRight className="h-[22px] w-[22px] shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Usuals whose items are read for the row: a couple beyond the ones shown, so a usual that no longer fits is replaced. */
const USUAL_CHIPS = 6;

/**
 * "What did you use?" (CP-13), and under it the one row of your usuals
 * (SM-10: it was Home's use-soon cards, + Add's "Do it again" and Use's
 * strip — three places). Each chip says what and for whom — "Milk · 1 glass"
 * with the faces of who it is for when that is not just you — and logs it
 * again at once, with the Undo toast. Nothing shows until you have usuals.
 */
function QuickUse({ meId }: { meId: string | null }) {
  const usuals = useUsuals();
  const names = useMemberNames();
  const logUse = useLogUse();
  const fit = React.useMemo(() => usualsThatFit(usuals.data ?? []).slice(0, USUAL_CHIPS + 2), [usuals.data]);
  const refs = React.useMemo(() => fit.map(usualRef), [fit]);
  const items = useItemsByRef(refs);
  const rows = doItAgainRows(fit, items, { meId, names, limit: USUAL_CHIPS });

  // Logged at once (SM-5): the Undo toast is up before the server answers; a refusal is put back and says why.
  const again = (row: DoItAgainRow) => {
    if (!row.item) return;
    void logUse({
      ref: row.ref,
      item: row.item,
      qtyMilli: row.qtyMilli,
      consumers: row.consumers,
      idempotencyKey: crypto.randomUUID(),
      what: row.words,
      measure: row.measure,
      meId,
      names,
    });
  };

  return (
    <section aria-label="Quick use" className="space-y-2">
      <Link
        href="/use"
        className="flex h-12 w-full items-center gap-2.5 rounded-2xl border border-input bg-card px-4 text-base text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">What did you use?</span>
      </Link>
      {usuals.loading ? (
        <div className="flex gap-2" aria-hidden>
          <Skeleton className="h-11 w-32 rounded-full" />
          <Skeleton className="h-11 w-28 rounded-full" />
          <Skeleton className="h-11 w-28 rounded-full" />
        </div>
      ) : rows.length > 0 ? (
        <ul aria-label="Your usuals" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:px-0">
          {rows.map((row) => {
            const others = row.consumers.length > 1 || (row.consumers.length === 1 && row.consumers[0] !== meId);
            return (
              <li key={row.key} className="shrink-0">
                <button
                  type="button"
                  aria-label={row.label}
                  aria-disabled={!row.item ? true : undefined}
                  onClick={() => again(row)}
                  className={cn(
                    "flex h-11 items-center gap-2 whitespace-nowrap rounded-full border bg-card pl-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    others ? "pr-1.5" : "pr-4",
                    row.item ? "hover:bg-accent" : "cursor-wait",
                  )}
                >
                  {row.title}
                  {others ? (
                    <span aria-hidden className="flex -space-x-1">
                      {row.consumers.slice(0, 3).map((id) => (
                        <Face key={id} subjectId={id} meId={meId} names={names} className="h-8 w-8 text-[10px] ring-2 ring-card" />
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/** Recent activity across your groups: the newest few entries of the groups you opened most recently. */
function RecentActivity({ meId, className }: { meId: string | null; className?: string }) {
  const groups = useGroups();
  const recentSlugs = useRecentGroupSlugs();
  const names = useMemberNames();
  const toRead = React.useMemo(() => recentGroupsToRead(groups.data ?? [], recentSlugs), [groups.data, recentSlugs]);
  const recent = useRecentActivity(toRead);
  const now = React.useMemo(() => new Date(), []);
  const rows = recentAcrossGroups(recent.data, { meId, names, now });
  const prefetch = usePrefetchKitchen();
  // The groups opened most recently are read beside the group list, by the
  // ids they had last time (SM-5), not after it.
  const recentKey = recentSlugs.slice(0, RECENT_GROUPS).join(",");
  React.useEffect(() => {
    for (const slug of recentKey ? recentKey.split(",") : []) {
      const id = rememberedGroupId(slug);
      if (id) prefetch.recent(id);
    }
  }, [recentKey, prefetch]);
  return (
    <RecentActivityList
      rows={rows}
      onPressRow={(row) => {
        const dishId = row.href.startsWith("/dishes/") ? parseDishRef(row.href.slice("/dishes/".length)) : null;
        if (dishId) prefetch.dish(dishId, row.orgId);
        else prefetch.group(row.orgId);
      }}
      loading={groups.loading || recent.loading}
      failed={recent.failed}
      reload={recent.reload}
      hasGroups={(groups.data?.length ?? 0) > 0}
      {...(className ? { className } : {})}
    />
  );
}
