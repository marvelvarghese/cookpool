"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "./link";
import { Plus, Ticket } from "lucide-react";
import type { MyBalancesResponse } from "@saas/contracts/kitchen";
import type { PublicOrganization } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useGroups, useProfile } from "./data";
import { GroupAvatar, KCard, K_BUTTON, K_BUTTON_QUIET, K_CARD, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { Face } from "./faces-ui";
import { NewGroupDialog } from "./new-group-dialog";
import { JoinGroupDialog } from "./join-group-dialog";
import { useMemberNames, useMyBalances, useMyRoles } from "./people-data";
import { copyLink } from "./recipe-share";
import type { NetTone } from "./people";
import {
  MONEY_PEOPLE_ROWS,
  moneyGroups,
  moneyNets,
  moneyPeople,
  personAction,
  personLine,
  personTone,
  remindText,
  type MoneyGroupRow,
  type MoneyNet,
  type MoneyPersonRow,
} from "./money-page";
import { useKitchenRouter } from "./transition-ui";
import { AddBillSheet, KitchenMoney, MoreInSpliteco, kitchenGroupsOf } from "./kitchen-money-ui";

/**
 * Money (cookpool-recipes RC-2; the revamp RV-5, the canvas's `RvMoney`; on
 * Spliteco since cookpool-spliteco SE3, the canvas's CookpoolMoney): the new
 * frame's tab, and the one place money lives. The big net figure, one per
 * currency, coloured by direction, with the one main button, + Add a bill
 * (which kitchen, then the shared add-a-bill form, saved by spliteco-worker on
 * the Kitchen balance); then Kitchen money — one kitchen at a time (`?group=`),
 * its Kitchen balance with Settle up and its "why", from spliteco-worker's
 * Kitchen-only read; then People — three, then See all — each with one
 * button: Pay when you owe them, Remind when they owe you; then Groups; and
 * last, More in Spliteco, which opens that kitchen in Spliteco signed in.
 * Every number is the Kitchen balance: Cookpool never shows a kitchen's
 * Other balance, friends outside it, or groups made in Spliteco.
 */
export function MoneyScreen() {
  const balances = useMyBalances();
  const profile = useProfile();
  const groups = useGroups();
  const router = useKitchenRouter();
  const data = balances.data;
  const kitchens = React.useMemo(() => kitchenGroupsOf(groups.data ?? []), [groups.data]);
  const asked = useSearchParams()?.get("group") ?? null;
  const orgId = kitchens.find((g) => g.id === asked)?.id ?? kitchens[0]?.id ?? null;
  const pick = React.useCallback((id: string) => router.replace(`/money?group=${encodeURIComponent(id)}`, { scroll: false }), [router]);

  return (
    <div className="space-y-[22px] min-[900px]:max-w-2xl">
      <header className="flex min-h-11 items-center">
        <h1 className={K_TITLE}>Money</h1>
      </header>

      {balances.loading ? (
        <div className="space-y-[22px]" aria-hidden>
          <Skeleton className="h-[180px] w-full rounded-[22px]" />
          <Skeleton className="h-48 w-full rounded-[22px]" />
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
          <NetCard nets={moneyNets(data)} kitchens={kitchens} preferred={orgId} />
          {orgId ? <KitchenMoney groups={kitchens} orgId={orgId} onPick={pick} /> : null}
          <People data={data} meId={profile.data?.id ?? null} />
          <Groups data={data} />
          <MoreInSpliteco orgId={orgId} />
        </>
      )}
    </div>
  );
}

const TONE: Record<NetTone, string> = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-muted-foreground" };

/** The big net figure (one per currency), coloured by direction, and + Add a bill, the one main button. */
function NetCard({ nets, kitchens, preferred }: { nets: readonly MoneyNet[]; kitchens: readonly PublicOrganization[]; preferred: string | null }) {
  const [billOpen, setBillOpen] = React.useState(false);
  const { roles } = useMyRoles();
  const addable = React.useMemo(() => kitchens.filter((g) => roles.get(g.id) !== "viewer"), [kitchens, roles]);
  return (
    <section aria-label="Your money" className={cn(K_CARD, "flex flex-col items-center gap-3.5 px-[18px] pb-[18px] pt-[22px]")}>
      <div className={cn("grid w-full gap-4", nets.length > 1 && "grid-cols-2")}>
        {nets.map((n) => (
          <p key={n.currency} className="flex min-w-0 flex-col items-center gap-3.5 text-center">
            <span className="text-sm font-normal text-muted-foreground">{n.label}</span>
            <span
              className={cn(
                "max-w-full truncate font-medium leading-none tracking-[-0.03em] tabular-nums",
                nets.length > 1 ? "text-[34px]" : "text-[48px]",
                TONE[n.tone],
              )}
            >
              {n.figure}
            </span>
          </p>
        ))}
      </div>
      <Button aria-haspopup="dialog" onClick={() => setBillOpen(true)} className="h-auto min-h-[54px] w-full gap-2 rounded-2xl text-[17px] font-medium">
        <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden />
        Add a bill
      </Button>
      <AddBillSheet open={billOpen} onOpenChange={setBillOpen} groups={addable} preferred={preferred} />
    </section>
  );
}

/** A section's heading row: the 17px title and, at the right, its one quiet link or toggle. */
function SectionHead({ id, title, children }: { id: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between">
      <h2 id={id} className={K_SECTION}>
        {title}
      </h2>
      {children}
    </div>
  );
}

const MORE = "flex min-h-11 items-center text-sm font-medium text-cp-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md";

function People({ data, meId }: { data: MyBalancesResponse; meId: string | null }) {
  const names = useMemberNames();
  const rows = React.useMemo(() => moneyPeople(data), [data]);
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, MONEY_PEOPLE_ROWS);
  return (
    <section aria-labelledby="money-people" className="space-y-2.5">
      <SectionHead id="money-people" title="People">
        {rows.length > MONEY_PEOPLE_ROWS ? (
          <button type="button" aria-expanded={all} onClick={() => setAll(!all)} className={MORE}>
            {all ? "Show less" : "See all"}
          </button>
        ) : null}
      </SectionHead>
      {rows.length === 0 ? (
        <p className={cn(K_CARD, "flex min-h-14 items-center px-4 text-sm text-muted-foreground")}>No one else in your groups yet</p>
      ) : (
        <ul aria-label="People" className={K_ROWS}>
          {shown.map((row) => (
            <li key={row.subjectId}>
              <PersonRow row={row} meId={meId} names={names} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const PILL = cn(K_BUTTON_QUIET, "h-11 shrink-0 px-3.5 text-sm");

function PersonRow({ row, meId, names }: { row: MoneyPersonRow; meId: string | null; names: ReturnType<typeof useMemberNames> }) {
  const action = personAction(row);
  return (
    <div className="flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-3">
      <Link
        href={row.href}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Face subjectId={row.subjectId} meId={meId} names={names} className="h-[42px] w-[42px] text-sm font-medium" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{row.label}</span>
          <span className={cn("block truncate text-[13px] font-normal tabular-nums", TONE[personTone(row)])}>{personLine(row)}</span>
        </span>
      </Link>
      {action === "pay" ? (
        <Button asChild variant="ghost" className={PILL}>
          <Link href={row.href}>Pay</Link>
        </Button>
      ) : action === "remind" ? (
        <RemindButton row={row} />
      ) : null}
    </div>
  );
}

/**
 * Remind: a short note in your words through the phone's share sheet, or
 * copied where there is none. Nothing is sent by the app and nothing in the
 * ledger changes.
 */
function RemindButton({ row }: { row: MoneyPersonRow }) {
  const { toast } = useToast();
  const remind = async () => {
    const text = remindText(row.label, row);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ text }).catch(() => undefined);
      return;
    }
    const ok = await copyLink(text, typeof navigator !== "undefined" ? navigator.clipboard : null);
    toast(ok ? { kind: "success", title: "Reminder copied" } : { kind: "error", title: "Couldn't copy the reminder" });
  };
  return (
    <Button variant="ghost" className={PILL} onClick={() => void remind()}>
      Remind
    </Button>
  );
}

function Groups({ data }: { data: MyBalancesResponse }) {
  const groups = useGroups();
  const recentSlugs = useRecentGroupSlugs();
  const kitchen = React.useMemo(() => new Map(data.groups.map((g) => [g.orgId, g] as const)), [data]);
  const rows = React.useMemo(() => moneyGroups(groups.data ?? [], kitchen, recentSlugs), [groups.data, kitchen, recentSlugs]);

  return (
    <section aria-labelledby="money-groups" className="space-y-2.5">
      <SectionHead id="money-groups" title="Groups">
        <Link href="/groups" className={MORE}>
          All
        </Link>
      </SectionHead>
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
        <ul aria-label="Groups" className={K_ROWS}>
          {rows.map((row) => (
            <li key={row.id}>
              <GroupRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GroupRow({ row }: { row: MoneyGroupRow }) {
  return (
    <Link
      href={row.href}
      className="flex min-h-[60px] items-center gap-3 py-2 pl-3.5 pr-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <GroupAvatar name={row.name} className="h-[42px] w-[42px] rounded-[14px]" />
      <span className="min-w-0 flex-1 truncate text-base font-medium">{row.name}</span>
      {row.fact ? <span className={cn("shrink-0 text-[15px] font-medium tabular-nums", TONE[row.fact.tone])}>{row.fact.text}</span> : null}
    </Link>
  );
}

function GroupButtons({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  const button = cn(K_BUTTON_QUIET, "h-12 gap-1.5 rounded-2xl");
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Button variant="ghost" className={button} onClick={onNew}>
        <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
        New group
      </Button>
      <Button variant="ghost" className={button} onClick={onJoin}>
        <Ticket className="h-[18px] w-[18px]" aria-hidden />
        Join with link
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
      <h2 className={K_SECTION}>No groups yet</h2>
      <div className="mt-4 w-full max-w-sm">
        <GroupButtons onNew={() => setNewOpen(true)} onJoin={() => setJoinOpen(true)} />
      </div>
      <NewGroupDialog open={newOpen} onOpenChange={setNewOpen} />
      <JoinGroupDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </KCard>
  );
}
