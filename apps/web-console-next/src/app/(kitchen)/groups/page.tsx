"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Plus, Search, Ticket } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRow } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useGroups } from "@/components/kitchen/data";
import { filterGroups, sortGroups } from "@/components/kitchen/groups";
import { groupListRow, showGroupSearch } from "@/components/kitchen/group-page";
import { CLOSE_44, GroupAvatar, KCard, K_BUTTON, K_INPUT } from "@/components/kitchen/kit";
import { useMyBalances } from "@/components/kitchen/people-data";
import { NewGroupDialog } from "@/components/kitchen/new-group-dialog";
import { JoinGroupDialog } from "@/components/kitchen/join-group-dialog";

/**
 * Groups (CP-5; SM-11 under the seven rules): one list, the groups you
 * opened last first, each with how many are in it and your balance there as
 * a number — "You get back ₹86.50", "You owe $25.00", coloured; nothing
 * when settled, no role words. One round + opens New group or Join (a small
 * sheet with the two); a search only past 8 groups, and no sort control.
 * `?new=1` / `?join=1` open the two from elsewhere (Home's empty state).
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
  const [addOpen, setAddOpen] = React.useState(false);
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
  const searching = showGroupSearch(all.length);
  const shown = React.useMemo(
    () => sortGroups(filterGroups(all, searching ? query : ""), "recent", recentSlugs),
    [all, query, searching, recentSlugs],
  );

  return (
    <div className="space-y-4 min-[900px]:max-w-2xl">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Groups</h1>
        <button
          type="button"
          aria-label="New group or join"
          aria-haspopup="dialog"
          onClick={() => setAddOpen(true)}
          className="grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden />
        </button>
      </header>

      <div className="space-y-4">
        <div className="min-w-0 space-y-4">
          {searching ? (
            <div className="relative">
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
              <Button variant="outline" className={K_BUTTON} onClick={groups.reload}>
                Try again
              </Button>
            </KCard>
          ) : all.length === 0 ? (
            <KCard className="flex flex-col items-center px-6 py-10 text-center">
              <h2 className="text-lg font-bold tracking-tight">No groups yet</h2>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button className={K_BUTTON} onClick={() => setNewOpen(true)}>
                  <Plus aria-hidden />
                  New group
                </Button>
                <Button variant="outline" className={K_BUTTON} onClick={() => setJoinOpen(true)}>
                  <Ticket aria-hidden />
                  Join
                </Button>
              </div>
            </KCard>
          ) : shown.length === 0 ? (
            <KCard className="flex flex-col items-center px-6 py-8 text-center">
              <p className="text-base font-semibold">No groups match &ldquo;{query.trim()}&rdquo;</p>
              <Button variant="ghost" className={cn(K_BUTTON, "mt-2 text-primary")} onClick={() => setQuery("")}>
                Clear search
              </Button>
            </KCard>
          ) : (
            <ul className="divide-y overflow-hidden rounded-[22px] border bg-card">
              {shown.map((g) => {
                const row = groupListRow(g, kitchen.get(g.id));
                return (
                  <li key={g.id}>
                    <Link
                      href={`/groups/${g.slug}`}
                      className="flex min-h-[64px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <GroupAvatar name={g.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold">{row.name}</span>
                        {row.people ? <span className="block truncate text-sm text-muted-foreground">{row.people}</span> : null}
                      </span>
                      {row.money ? (
                        <span className={cn("shrink-0 text-right leading-tight", row.money.tone === "owed" ? "text-cp-owed" : "text-cp-owe")}>
                          <span className="block text-xs font-semibold">{row.money.label}</span>
                          <span className="block text-[15px] font-extrabold tabular-nums">{row.money.amount}</span>
                        </span>
                      ) : null}
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <AddGroupSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onNew={() => setNewOpen(true)}
        onJoin={() => setJoinOpen(true)}
      />
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

/** The + : a small sheet with the two ways to a new group — start one, or join one with a code. */
function AddGroupSheet({
  open,
  onOpenChange,
  onNew,
  onJoin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNew: () => void;
  onJoin: () => void;
}) {
  const picked = React.useRef(false);
  const pick = (then: () => void) => {
    picked.current = true;
    onOpenChange(false);
    then();
  };
  const choice =
    "flex min-h-[64px] w-full items-center gap-3 rounded-[18px] border bg-card px-4 text-left text-[17px] font-extrabold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        // A choice opens its own dialog: focus goes there, not back to the +.
        onCloseAutoFocus={(e) => {
          if (picked.current) e.preventDefault();
          picked.current = false;
        }}
        className={cn(
          "mx-auto max-w-xl gap-0 rounded-t-[28px] border-x-0 bg-background px-4 pt-2.5 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
          CLOSE_44,
        )}
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="flex min-h-11 items-center pr-12 text-[22px] font-extrabold">Add a group</SheetTitle>
        {/* The bottom padding is inside: the sheet's own is the safe area's. */}
        <div className="mt-3 space-y-2.5 pb-5">
          <button type="button" className={choice} onClick={() => pick(onNew)}>
            <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cp-herb-tint text-primary">
              <Plus className="h-5 w-5" strokeWidth={2.4} />
            </span>
            New group
          </button>
          <button type="button" className={choice} onClick={() => pick(onJoin)}>
            <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cp-owed-tint text-cp-owed">
              <Ticket className="h-5 w-5" />
            </span>
            Join with a code
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
