"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Plus, Search, Ticket, UsersRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useGroups } from "@/components/kitchen/data";
import { GROUP_SORTS, filterGroups, roleFromKitchen, roleLabel, sortGroups, type GroupSort } from "@/components/kitchen/groups";
import { GroupAvatar, IconBubble, KCard, K_BUTTON, K_INPUT, PageHeader, shortDate } from "@/components/kitchen/kit";
import { Money } from "@/components/kitchen/ledger-ui";
import { useMyBalances } from "@/components/kitchen/people-data";
import { NewGroupDialog } from "@/components/kitchen/new-group-dialog";
import { JoinGroupDialog } from "@/components/kitchen/join-group-dialog";

/**
 * Groups (CP-5): every group the person is in, searchable by name and sorted
 * by Recent (opened on this device, then newest) or A–Z. One list however many
 * groups there are — no per-group tabs. Each row shows your role, how many
 * are in it and your balance there (from the cross-group read, CP-9). New
 * group and Join open dialogs; `?new=1` / `?join=1` open them from elsewhere
 * (Home's empty state).
 */
export default function GroupsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const groups = useGroups();
  const balances = useMyBalances();
  const kitchen = React.useMemo(
    () => new Map((balances.data?.groups ?? []).map((g) => [g.orgId, g] as const)),
    [balances.data],
  );
  const recentSlugs = useRecentGroupSlugs();
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<GroupSort>("recent");
  const [newOpen, setNewOpen] = React.useState(false);
  const [joinOpen, setJoinOpen] = React.useState(false);

  React.useEffect(() => {
    if (searchParams?.get("new") === "1") setNewOpen(true);
    else if (searchParams?.get("join") === "1") setJoinOpen(true);
  }, [searchParams]);

  // Closing a dialog opened from the URL drops the parameter, so a reload or
  // Back does not open it again.
  const dropParams = React.useCallback(() => {
    if (searchParams?.get("new") || searchParams?.get("join")) {
      router.replace(pathname ?? "/groups", { scroll: false });
    }
  }, [router, pathname, searchParams]);

  const all = groups.data ?? [];
  const shown = React.useMemo(
    () => sortGroups(filterGroups(all, query), sort, recentSlugs),
    [all, query, sort, recentSlugs],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Groups"
        subtitle={
          groups.data ? `${all.length} ${all.length === 1 ? "group" : "groups"}` : "The flats, clubs and families you cook with."
        }
        actions={
          <>
            <Button variant="outline" className={K_BUTTON} onClick={() => setJoinOpen(true)}>
              <Ticket aria-hidden />
              Join
            </Button>
            <Button className={K_BUTTON} onClick={() => setNewOpen(true)}>
              <Plus aria-hidden />
              New group
            </Button>
          </>
        }
      />

      {all.length > 0 ? (
        <div className="flex flex-col gap-3 min-[560px]:flex-row">
          <div className="relative flex-1">
            <label htmlFor="group-search" className="sr-only">
              Search groups
            </label>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="group-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search groups"
              autoComplete="off"
              className={cn(K_INPUT, "bg-card pl-11")}
            />
          </div>
          <div role="group" aria-label="Sort groups" className="inline-flex h-11 shrink-0 self-start rounded-xl border border-input bg-card p-0.5">
            {GROUP_SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sort === s.id}
                onClick={() => setSort(s.id)}
                className={cn(
                  "min-w-[72px] rounded-[10px] px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  sort === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {groups.loading ? (
        <KCard className="px-4" aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </KCard>
      ) : groups.error ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your groups. {groups.error.message}</p>
          <Button variant="outline" className={K_BUTTON} onClick={groups.reload}>
            Try again
          </Button>
        </KCard>
      ) : all.length === 0 ? (
        <KCard className="flex flex-col items-center px-6 py-12 text-center">
          <IconBubble icon={UsersRound} className="h-14 w-14" />
          <h2 className="mt-4 text-lg font-bold tracking-tight">No groups yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Start one for your flat or lunch club, or join one with a link someone sent you.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button className={K_BUTTON} onClick={() => setNewOpen(true)}>
              <Plus aria-hidden />
              New group
            </Button>
            <Button variant="outline" className={K_BUTTON} onClick={() => setJoinOpen(true)}>
              <Ticket aria-hidden />
              Join with a code
            </Button>
          </div>
        </KCard>
      ) : (
        <>
          <p aria-live="polite" className="sr-only">
            {query ? `${shown.length} of ${all.length} groups shown` : ""}
          </p>
          {shown.length === 0 ? (
            <KCard className="flex flex-col items-center px-6 py-10 text-center">
              <p className="text-base font-semibold">No groups match &ldquo;{query.trim()}&rdquo;</p>
              <Button variant="ghost" className={cn(K_BUTTON, "mt-2 text-primary")} onClick={() => setQuery("")}>
                Clear search
              </Button>
            </KCard>
          ) : (
            <ul className="divide-y overflow-hidden rounded-[20px] border bg-card">
              {shown.map((g) => {
                const k = kitchen.get(g.id);
                const role = roleFromKitchen(k?.role);
                return (
                  <li key={g.id}>
                    <Link
                      href={`/groups/${g.slug}`}
                      className="flex min-h-[68px] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <GroupAvatar name={g.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold">{g.name}</span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {k && role
                            ? `${roleLabel(role)} · ${k.memberCount} ${k.memberCount === 1 ? "member" : "members"}`
                            : `Started ${shortDate(g.createdAt)}`}
                        </span>
                      </span>
                      {k && k.balanceMinor !== 0 ? (
                        <span
                          className={cn(
                            "shrink-0 text-right text-xs font-medium leading-snug",
                            k.balanceMinor > 0 ? "text-cp-owed" : "text-cp-owe",
                          )}
                        >
                          {k.balanceMinor > 0 ? "you get back" : "you owe"}
                          <Money minor={Math.abs(k.balanceMinor)} currency={k.currency} className="block text-[15px] font-bold" />
                        </span>
                      ) : null}
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <NewGroupDialog
        open={newOpen}
        onOpenChange={(open) => {
          setNewOpen(open);
          if (!open) dropParams();
        }}
      />
      <JoinGroupDialog
        open={joinOpen}
        onOpenChange={(open) => {
          setJoinOpen(open);
          if (!open) dropParams();
        }}
      />
    </div>
  );
}
