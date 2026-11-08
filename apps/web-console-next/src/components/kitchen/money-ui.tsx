"use client";

import * as React from "react";
import Link from "./link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Plus, Receipt, Ticket } from "lucide-react";
import type { MyBalancesResponse } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useGroups, useProfile } from "./data";
import { CLOSE_44, GroupAvatar, KCard, K_BUTTON } from "./kit";
import { Face, MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { GroupPickerList } from "./group-picker";
import { NewGroupDialog } from "./new-group-dialog";
import { JoinGroupDialog } from "./join-group-dialog";
import { useMemberNames, useMyBalances, useMyRoles } from "./people-data";
import type { MoneyLine } from "./home";
import {
  SETTLE_UP_HREF,
  moneyGroups,
  moneyHref,
  moneyListFrom,
  moneyPeople,
  moneyTotals,
  type MoneyGroupRow,
  type MoneyList,
  type MoneyPersonRow,
} from "./money-page";
import { useKitchenRouter } from "./transition-ui";

/**
 * Money (cookpool-recipes RC-2, design §1.4, the canvas's `Money`): the new
 * frame's tab, and the one place money lives (§1.3). Your money, one figure
 * per currency; Settle up (the main button: today's settle screen, People)
 * and Bill (which group, then today's Add a bill); then People | Groups. A
 * person opens their page; a group opens today's group page. Under Groups:
 * New group, and Join with a link. The list is in the address (`?list=`),
 * so Back from a group comes back to Groups.
 */
export function MoneyScreen() {
  const balances = useMyBalances();
  const profile = useProfile();
  const searchParams = useSearchParams();
  const list = moneyListFrom(searchParams?.get("list"));
  const data = balances.data;

  return (
    <div className="space-y-4 min-[900px]:max-w-2xl">
      <header className="flex min-h-11 items-center">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Money</h1>
      </header>

      {balances.loading ? (
        <div className="space-y-4" aria-hidden>
          <Skeleton className="h-[88px] w-full rounded-[22px]" />
          <Skeleton className="h-[60px] w-full rounded-[18px]" />
          <Skeleton className="h-40 w-full rounded-[22px]" />
        </div>
      ) : balances.error || !data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your money.</p>
          <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
            Try again
          </Button>
        </KCard>
      ) : data.groups.length === 0 ? (
        <NoGroups />
      ) : (
        <>
          <Totals lines={moneyTotals(data)} />
          <Actions />
          <ListSwitch list={list} />
          {list === "people" ? <People data={data} meId={profile.data?.id ?? null} /> : <Groups data={data} />}
        </>
      )}
    </div>
  );
}

const TONE: Record<MoneyLine["tone"], string> = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-foreground" };

/** You get back / you owe: one figure per currency, side by side. */
function Totals({ lines }: { lines: readonly MoneyLine[] }) {
  return (
    <section aria-label="Your money" className={cn("grid gap-3 rounded-[22px] border bg-card px-[18px] py-3", lines.length > 1 && "grid-cols-2")}>
      {lines.map((l) => (
        <p key={l.currency} className="min-w-0">
          <span className="block text-[13px] font-bold text-muted-foreground">{l.amount ? l.label : ""}</span>
          <span className={cn("block truncate text-[30px] font-extrabold leading-tight tracking-tight tabular-nums", TONE[l.tone])}>
            {l.amount ?? l.label}
          </span>
        </p>
      ))}
    </section>
  );
}

/** Settle up (the main button) and Bill. */
function Actions() {
  const [billOpen, setBillOpen] = React.useState(false);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <Button asChild className={MAIN_BUTTON}>
        <Link href={SETTLE_UP_HREF}>
          <MainButtonLabel title="Settle up" />
        </Link>
      </Button>
      <Button
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => setBillOpen(true)}
        className="h-auto min-h-[60px] gap-2 rounded-[18px] border-[#D5DAD2] bg-card px-5 text-base font-extrabold text-foreground hover:bg-accent"
      >
        <Receipt className="h-5 w-5" aria-hidden />
        Bill
      </Button>
      <BillSheet open={billOpen} onOpenChange={setBillOpen} />
    </div>
  );
}

/** People | Groups, a segmented control; the choice stays in the address. */
function ListSwitch({ list }: { list: MoneyList }) {
  const router = useRouter();
  const pick = (next: MoneyList) => {
    if (next !== list) router.replace(moneyHref(next), { scroll: false });
  };
  return (
    <div role="group" aria-label="Show" className="grid grid-cols-2 gap-1 rounded-2xl border bg-muted/60 p-1">
      {(["people", "groups"] as const).map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={list === id}
          onClick={() => pick(id)}
          className={cn(
            "min-h-11 rounded-xl text-[15px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            list === id ? "bg-card text-foreground shadow-[0_1px_2px_rgba(23,32,27,0.08)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {id === "people" ? "People" : "Groups"}
        </button>
      ))}
    </div>
  );
}

const ROW =
  "flex min-h-[64px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function People({ data, meId }: { data: MyBalancesResponse; meId: string | null }) {
  const names = useMemberNames();
  const rows = React.useMemo(() => moneyPeople(data), [data]);
  if (rows.length === 0) {
    return <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">No one else in your groups yet</p>;
  }
  return (
    <ul aria-label="People" className="divide-y overflow-hidden rounded-[22px] border bg-card">
      {rows.map((row) => (
        <li key={row.subjectId}>
          <PersonRow row={row} meId={meId} names={names} />
        </li>
      ))}
    </ul>
  );
}

function PersonRow({ row, meId, names }: { row: MoneyPersonRow; meId: string | null; names: ReturnType<typeof useMemberNames> }) {
  return (
    <Link href={row.href} className={ROW}>
      <Face subjectId={row.subjectId} meId={meId} names={names} className="h-11 w-11 text-sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">{row.label}</span>
        {row.group ? <span className="block truncate text-[13px] text-muted-foreground">{row.group}</span> : null}
      </span>
      <span className="shrink-0 space-y-0.5 text-right leading-tight">
        {row.amounts.map((a) =>
          a.amount ? (
            <span key={a.currency} className={cn("block", a.tone === "owed" ? "text-cp-owed" : "text-cp-owe")}>
              <span className="block text-xs font-semibold">{a.words}</span>
              <span className="block text-[15px] font-extrabold tabular-nums">{a.amount}</span>
            </span>
          ) : (
            <span key={a.currency} className="block text-[13px] font-semibold text-muted-foreground">
              Settled
            </span>
          ),
        )}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

function Groups({ data }: { data: MyBalancesResponse }) {
  const groups = useGroups();
  const recentSlugs = useRecentGroupSlugs();
  const [newOpen, setNewOpen] = React.useState(false);
  const [joinOpen, setJoinOpen] = React.useState(false);
  const kitchen = React.useMemo(() => new Map(data.groups.map((g) => [g.orgId, g] as const)), [data]);
  const rows = React.useMemo(() => moneyGroups(groups.data ?? [], kitchen, recentSlugs), [groups.data, kitchen, recentSlugs]);

  return (
    <div className="space-y-3">
      {groups.loading ? (
        <KCard className="px-4" aria-hidden>
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
      ) : (
        <ul aria-label="Groups" className="divide-y overflow-hidden rounded-[22px] border bg-card">
          {rows.map((row) => (
            <li key={row.id}>
              <GroupRow row={row} />
            </li>
          ))}
        </ul>
      )}
      <GroupButtons onNew={() => setNewOpen(true)} onJoin={() => setJoinOpen(true)} />
      <NewGroupDialog open={newOpen} onOpenChange={setNewOpen} />
      <JoinGroupDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </div>
  );
}

function GroupRow({ row }: { row: MoneyGroupRow }) {
  return (
    <Link href={row.href} className={ROW}>
      <GroupAvatar name={row.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">{row.name}</span>
        {row.people ? <span className="block truncate text-[13px] text-muted-foreground">{row.people}</span> : null}
      </span>
      {row.money ? (
        <span className={cn("shrink-0 text-right leading-tight", row.money.tone === "owed" ? "text-cp-owed" : "text-cp-owe")}>
          <span className="block text-xs font-semibold">{row.money.label}</span>
          <span className="block text-[15px] font-extrabold tabular-nums">{row.money.amount}</span>
        </span>
      ) : null}
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

function GroupButtons({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  const button = "h-12 gap-2 rounded-2xl border-[#D5DAD2] bg-card text-[15px] font-extrabold text-foreground hover:bg-accent";
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" className={button} onClick={onNew}>
        <Plus className="h-5 w-5 text-primary" aria-hidden />
        New group
      </Button>
      <Button variant="outline" className={button} onClick={onJoin}>
        <Ticket className="h-5 w-5 text-cp-owed" aria-hidden />
        Join with a link
      </Button>
    </div>
  );
}

/** In no group yet: start one, or join one. */
function NoGroups() {
  const [newOpen, setNewOpen] = React.useState(false);
  const [joinOpen, setJoinOpen] = React.useState(false);
  return (
    <KCard className="flex flex-col items-center px-6 py-10 text-center">
      <h2 className="text-lg font-bold tracking-tight">No groups yet</h2>
      <div className="mt-4 w-full max-w-sm">
        <GroupButtons onNew={() => setNewOpen(true)} onJoin={() => setJoinOpen(true)} />
      </div>
      <NewGroupDialog open={newOpen} onOpenChange={setNewOpen} />
      <JoinGroupDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </KCard>
  );
}

/**
 * Bill: which group (leaving out groups you only view), then today's Add a
 * bill there — straight there when there is one group. The + Add sheet's
 * "Paid a bill", now Money's.
 */
function BillSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useKitchenRouter();
  const allGroups = useGroups();
  const { roles } = useMyRoles();
  const groups = React.useMemo(() => allGroups.data?.filter((g) => roles.get(g.id) !== "viewer") ?? null, [allGroups.data, roles]);
  const go = React.useCallback(
    (slug: string) => {
      onOpenChange(false);
      router.push(`/groups/${encodeURIComponent(slug)}/expense`);
    },
    [onOpenChange, router],
  );

  // One group: nothing to pick.
  const only = groups?.length === 1 ? groups[0]!.slug : null;
  React.useEffect(() => {
    if (open && only) go(only);
  }, [open, only, go]);

  return (
    <Sheet open={open && !only} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className={cn(
          "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-hidden rounded-t-[28px] border-x-0 bg-background px-4 pt-2.5 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
          CLOSE_44,
        )}
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="flex min-h-11 shrink-0 items-center pr-12 text-[22px] font-extrabold">Which group?</SheetTitle>
        <div className="-mx-4 mt-2 min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          {allGroups.loading || !groups ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-14 w-full rounded-[18px]" />
              <Skeleton className="h-14 w-full rounded-[18px]" />
            </div>
          ) : groups.length === 0 ? (
            <p className="rounded-[18px] border bg-card p-4 text-[15px] font-semibold">No group you can add to</p>
          ) : (
            <GroupPickerList groups={groups} idPrefix="money-bill-group" onPick={go} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
