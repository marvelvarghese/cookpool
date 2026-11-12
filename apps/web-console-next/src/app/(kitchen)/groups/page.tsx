"use client";

import * as React from "react";
import Link from "@/components/kitchen/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Link2, Plus, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { newFrame } from "@/lib/features";
import { Button } from "@/components/ui/button";
import { SkeletonRow } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { BackButton } from "@/components/kitchen/back-ui";
import { useGroups } from "@/components/kitchen/data";
import { filterGroups, groupMemberNames, sortGroups } from "@/components/kitchen/groups";
import { showGroupSearch } from "@/components/kitchen/group-page";
import { groupMeta } from "@/components/kitchen/money-page";
import { GroupAvatar, KCard, K_BUTTON, K_BUTTON_QUIET, K_CARD, K_ROWS, K_SECTION, K_TITLE } from "@/components/kitchen/kit";
import { useMyBalances } from "@/components/kitchen/people-data";
import { NewGroupDialog } from "@/components/kitchen/new-group-dialog";
import { JoinGroupDialog } from "@/components/kitchen/join-group-dialog";

/**
 * Groups (CP-5; SM-11; the revamp RV-5, the canvas's `RvGroups`): New group
 * and Join with link as two quiet buttons at the top, then the search (always
 * in the new frame, past 8 groups in today's), then one list, the groups you
 * opened last first, each on one line under its name: "4 people · +₹87.00",
 * the amount coloured by direction, "settled" at zero; no role words and no
 * sort control. The search finds groups by name or by the people in them (RV-23). `?new=1` / `?join=1` open the two from elsewhere (Home's
 * empty state).
 *
 * From 900px it is the same list (SM-15): a row opens the group's page,
 * which has its money, activity, balances and dishes. The chosen group
 * beside the list — its activity again, "Everyone's balance" and the fewest
 * payments a third time — is gone (each debt shows once: the group page and
 * People have them). An old `?group=` link just shows the list.
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
  // The revamp (RV-5): the search is always there in the new frame; today's frame keeps it past 8 groups.
  const searching = all.length > 0 && (newFrame() || showGroupSearch(all.length));
  // The new frame's search also finds a group by the people in it (RV-23).
  const members = React.useMemo(() => (newFrame() ? groupMemberNames(balances.data?.people) : null), [balances.data]);
  const shown = React.useMemo(
    () => sortGroups(filterGroups(all, searching ? query : "", members), "recent", recentSlugs),
    [all, query, searching, members, recentSlugs],
  );

  return (
    <div className="space-y-[18px] min-[900px]:max-w-2xl">
      <header className="flex min-h-11 items-center gap-1">
        {/* In the new frame Groups is reached from Money, not a tab (cookpool-recipes RC-2): it has a Back. */}
        {newFrame() ? <BackButton /> : null}
        <h1 className={cn(K_TITLE, "min-w-0 flex-1")}>Groups</h1>
      </header>

      <div className="grid grid-cols-2 gap-2.5">
        <Button variant="ghost" className={QUIET} onClick={() => setNewOpen(true)}>
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
          New group
        </Button>
        <Button variant="ghost" className={QUIET} onClick={() => setJoinOpen(true)}>
          <Link2 className="h-[18px] w-[18px]" aria-hidden />
          Join with link
        </Button>
      </div>

      {searching ? (
        <label className={cn(K_CARD, "flex min-h-[54px] items-center gap-2.5 rounded-[18px] px-4 text-muted-foreground focus-within:ring-2 focus-within:ring-ring")}>
          <Search className="h-5 w-5 shrink-0" aria-hidden />
          <span className="sr-only">Search groups</span>
          <input
            id="group-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={newFrame() ? "Search groups or people" : "Search groups"}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-base font-normal text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      ) : null}

      {groups.loading ? (
        <KCard className="px-4" aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </KCard>
      ) : groups.error ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your groups.</p>
          <Button variant="ghost" className={K_BUTTON_QUIET} onClick={groups.reload}>
            Try again
          </Button>
        </KCard>
      ) : all.length === 0 ? (
        <KCard className="flex flex-col items-center px-6 py-10 text-center">
          <h2 className={K_SECTION}>No groups yet</h2>
        </KCard>
      ) : shown.length === 0 ? (
        <KCard className="flex flex-col items-center px-6 py-6 text-center">
          <p className="text-[15px] font-normal text-muted-foreground">No match</p>
          <Button variant="ghost" className={cn(K_BUTTON, "mt-1 text-cp-accent-text")} onClick={() => setQuery("")}>
            Clear search
          </Button>
        </KCard>
      ) : (
        <ul className={K_ROWS}>
          {shown.map((g) => {
            const meta = groupMeta(kitchen.get(g.id));
            return (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.slug}`}
                  className="flex min-h-16 items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <GroupAvatar name={g.name} id={g.id} className="h-[42px] w-[42px] rounded-[14px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium">{g.name}</span>
                    {meta ? (
                      <span className="block truncate text-[13px] font-normal text-muted-foreground tabular-nums">
                        {meta.people} · <span className={cn("font-medium", FACT_TONE[meta.fact.tone])}>{meta.fact.text}</span>
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
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

const QUIET = cn(K_BUTTON_QUIET, "h-12 gap-1.5 rounded-2xl");
const FACT_TONE = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-muted-foreground" } as const;
