"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "./link";
import { ChevronRight, Plus, ScanLine, Ticket } from "lucide-react";
import type { MyBalancesResponse } from "@saas/contracts/kitchen";
import type { PublicOrganization } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useGroups, useProfile } from "./data";
import { CLOSE_44, GroupAvatar, KCard, K_BUTTON_QUIET, K_CARD, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { Face } from "./faces-ui";
import { NewGroupDialog } from "./new-group-dialog";
import { JoinGroupDialog } from "./join-group-dialog";
import { useMemberNames, useMyBalances, useMyRoles } from "./people-data";
import type { NetTone } from "./people";
import {
  MONEY_GROUP_ROWS,
  MONEY_PEOPLE_ROWS,
  directPay,
  groupFactWhole,
  moneyGroupHref,
  moneyGroups,
  moneyNetsWhole,
  moneyPeople,
  personAction,
  personFact,
  personTone,
  settleHref,
  settleSheetRows,
  type MoneyGroupRow,
  type MoneyNet,
  type MoneyPersonRow,
  type SettleSheetRow,
} from "./money-page";
import { AddBillSheet, MoreInSpliteco, kitchenGroupsOf } from "./kitchen-money-ui";
import { MONEY_PILL, MoneyGroupScreen, PayRow, RemindButton } from "./money-group-ui";
import { useScanBillShows } from "./bill-scan-ui";

/**
 * Money (cookpool-recipes RC-2; the revamp RV-5, then RV-17 to the
 * owner-approved board `RvMoney`; on Spliteco since cookpool-spliteco SE3):
 * the new frame's tab, one place for each thing.
 *
 * - The header: the title, Scan a bill (where Scan a receipt runs) and the
 *   one main button, + Add a bill (which kitchen, then the shared form, saved
 *   by spliteco-worker on the Kitchen balance).
 * - One net card: the figure per currency, coloured by direction, and the
 *   ONLY Settle up — a sheet of who pays whom, each Pay going to the one
 *   settle path (`/money/settle`, spliteco-worker, Kitchen only), each
 *   "pays you" with Remind.
 * - People and Groups, three each, then All. A person opens their balance and
 *   its why (`/people/[id]`); a group opens its balance and its why here
 *   (`/money?group=org_…`, `MoneyGroupScreen`) — the why is one tap away.
 * - More in Spliteco, one quiet row.
 *
 * Every number is the Kitchen balance: Cookpool never shows a kitchen's
 * Other balance, friends outside it, or groups made in Spliteco.
 * `?settle=1` opens Settle up (People's old address leads here).
 */
export function MoneyScreen() {
  const params = useSearchParams();
  const groups = useGroups();
  const kitchens = React.useMemo(() => kitchenGroupsOf(groups.data ?? []), [groups.data]);
  const asked = params?.get("group") ?? null;
  const group = asked ? (kitchens.find((g) => g.id === asked) ?? null) : null;
  if (asked && groups.loading) return <Skeleton className="h-[180px] w-full rounded-[22px]" aria-hidden />;
  if (group) return <MoneyGroupScreen key={group.id} group={group} />;
  return <MoneyHome kitchens={kitchens} settleAsked={params?.get("settle") === "1"} />;
}

function MoneyHome({ kitchens, settleAsked }: { kitchens: readonly PublicOrganization[]; settleAsked: boolean }) {
  const balances = useMyBalances();
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const data = balances.data;
  const { roles } = useMyRoles();
  const addable = React.useMemo(() => kitchens.filter((g) => roles.get(g.id) !== "viewer"), [kitchens, roles]);
  const [bill, setBill] = React.useState<{ open: boolean; scan: boolean }>({ open: false, scan: false });
  const [settleOpen, setSettleOpen] = React.useState(settleAsked);
  const scanShows = useScanBillShows();
  const pays = React.useMemo(() => settleSheetRows(data), [data]);

  return (
    <div className="space-y-[22px] min-[900px]:max-w-2xl">
      <header className="flex min-h-11 items-center gap-2">
        <h1 className={cn(K_TITLE, "min-w-0 flex-1")}>Money</h1>
        {scanShows && addable.length > 0 ? (
          <Button
            variant="ghost"
            aria-label="Scan a bill"
            aria-haspopup="dialog"
            className="h-11 w-11 shrink-0 rounded-[14px] bg-cp-accent-tint p-0 text-cp-accent-text hover:bg-cp-accent-tint/80"
            onClick={() => setBill({ open: true, scan: true })}
          >
            <ScanLine className="h-5 w-5" aria-hidden />
          </Button>
        ) : null}
        <Button aria-haspopup="dialog" className="h-11 shrink-0 gap-1.5 rounded-[14px] px-4 text-[15px] font-medium" onClick={() => setBill({ open: true, scan: false })}>
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
          Add a bill
        </Button>
      </header>
      <AddBillSheet open={bill.open} onOpenChange={(open) => setBill((b) => ({ ...b, open }))} groups={addable} preferred={null} startScan={bill.scan} />

      {balances.loading ? (
        <div className="space-y-[22px]" aria-hidden>
          <Skeleton className="h-[160px] w-full rounded-[22px]" />
          <Skeleton className="h-48 w-full rounded-[22px]" />
        </div>
      ) : balances.error || !data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your money.</p>
          <Button variant="ghost" className={MONEY_PILL} onClick={balances.reload}>
            Try again
          </Button>
        </KCard>
      ) : data.groups.length === 0 ? (
        <NoGroups />
      ) : (
        <>
          <NetCard nets={moneyNetsWhole(data)} canSettle={pays.length > 0} onSettle={() => setSettleOpen(true)} />
          <SettleSheet open={settleOpen && pays.length > 0} onOpenChange={setSettleOpen} rows={pays} meId={meId} />
          <People data={data} meId={meId} pays={pays} onSettle={() => setSettleOpen(true)} />
          <Groups data={data} />
          <MoreInSpliteco orgId={null} />
        </>
      )}
    </div>
  );
}

const TONE: Record<NetTone, string> = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-muted-foreground" };

/** The one net card: the figure per currency, coloured by direction, and the only Settle up. */
function NetCard({ nets, canSettle, onSettle }: { nets: readonly MoneyNet[]; canSettle: boolean; onSettle: () => void }) {
  return (
    <section aria-label="Your money" className={cn(K_CARD, "flex flex-col items-center gap-3.5 px-[18px] pb-[18px] pt-[22px]")}>
      <div className={cn("grid w-full gap-4", nets.length > 1 && "grid-cols-2")}>
        {nets.map((n) => (
          <p key={n.currency} className="flex min-w-0 flex-col items-center gap-3.5 text-center">
            <span className="text-sm font-normal text-muted-foreground">{n.label}</span>
            <span className={cn("max-w-full truncate font-medium leading-none tracking-[-0.03em] tabular-nums", nets.length > 1 ? "text-[34px]" : "text-[48px]", TONE[n.tone])}>
              {n.figure}
            </span>
          </p>
        ))}
      </div>
      {canSettle ? (
        <Button variant="ghost" aria-haspopup="dialog" onClick={onSettle} className={cn(K_BUTTON_QUIET, "h-auto min-h-[50px] w-full rounded-2xl text-base")}>
          Settle up
        </Button>
      ) : null}
    </section>
  );
}

/** Settle up: every payment that involves you, what you pay first; Pay goes to the one settle path. */
function SettleSheet({ open, onOpenChange, rows, meId }: { open: boolean; onOpenChange: (open: boolean) => void; rows: readonly SettleSheetRow[]; meId: string | null }) {
  const names = useMemberNames();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className={cn(
          "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-hidden rounded-t-[26px] border-x-0 bg-background px-[18px] pb-7 pt-2.5 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
          CLOSE_44,
        )}
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-cp-line min-[900px]:hidden" />
        <SheetTitle className={cn(K_SECTION, "flex min-h-11 items-center pr-12")}>Settle up</SheetTitle>
        <ul aria-label="Who pays whom" className={cn(K_ROWS, "mt-3 min-h-0 overflow-y-auto")}>
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 pl-3.5 pr-3">
              <Face subjectId={r.subjectId} meId={meId} names={names} className="h-[42px] w-[42px] text-sm font-medium" />
              <div className="min-w-0 flex-1">
                <PayRow row={r} back="/money" group />
              </div>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
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

const MORE = "flex min-h-11 items-center rounded-md text-sm font-medium text-cp-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function People({ data, meId, pays, onSettle }: { data: MyBalancesResponse; meId: string | null; pays: readonly SettleSheetRow[]; onSettle: () => void }) {
  const names = useMemberNames();
  const rows = React.useMemo(() => moneyPeople(data), [data]);
  const [all, setAll] = React.useState(false);
  const shown = all ? rows : rows.slice(0, MONEY_PEOPLE_ROWS);
  return (
    <section aria-labelledby="money-people" className="space-y-2.5">
      <SectionHead id="money-people" title="People">
        {rows.length > MONEY_PEOPLE_ROWS ? (
          <button type="button" aria-expanded={all} onClick={() => setAll(!all)} className={MORE}>
            {all ? "Less" : "All"}
          </button>
        ) : null}
      </SectionHead>
      {rows.length === 0 ? (
        <p className={cn(K_CARD, "flex min-h-14 items-center px-4 text-sm text-muted-foreground")}>No one else in your groups yet</p>
      ) : (
        <ul aria-label="People" className={K_ROWS}>
          {shown.map((row) => (
            <li key={row.subjectId}>
              <PersonRow row={row} meId={meId} names={names} pays={pays} onSettle={onSettle} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonRow({
  row,
  meId,
  names,
  pays,
  onSettle,
}: {
  row: MoneyPersonRow;
  meId: string | null;
  names: ReturnType<typeof useMemberNames>;
  pays: readonly SettleSheetRow[];
  onSettle: () => void;
}) {
  const action = personAction(row);
  const direct = action === "pay" ? directPay(pays, row.subjectId) : null;
  const owed = pays.filter((p) => p.subjectId === row.subjectId && p.minor > 0).map((p) => ({ minor: p.minor, currency: p.currency }));
  const first = row.label.split(" ")[0] || row.label;
  return (
    <div className="flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-3">
      <Link
        href={row.href}
        aria-label={`${row.label}, ${personFact(row)}, why`}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Face subjectId={row.subjectId} meId={meId} names={names} className="h-[42px] w-[42px] text-sm font-medium" />
        <span className="min-w-0 flex-1 truncate text-base font-medium">
          {first} <span className={cn("font-normal tabular-nums", TONE[personTone(row)])}>· {personFact(row)}</span>
        </span>
      </Link>
      {action === "pay" ? (
        direct ? (
          <Button asChild variant="ghost" className={MONEY_PILL}>
            <Link href={settleHref(direct.orgId, direct.subjectId, "/money")}>Pay</Link>
          </Button>
        ) : (
          <Button variant="ghost" aria-haspopup="dialog" className={MONEY_PILL} onClick={onSettle}>
            Pay
          </Button>
        )
      ) : action === "remind" && owed.length > 0 ? (
        <RemindButton name={row.label} owed={owed} />
      ) : null}
    </div>
  );
}

function Groups({ data }: { data: MyBalancesResponse }) {
  const groups = useGroups();
  const recentSlugs = useRecentGroupSlugs();
  const kitchen = React.useMemo(() => new Map(data.groups.map((g) => [g.orgId, g] as const)), [data]);
  const rows = React.useMemo(() => moneyGroups(kitchenGroupsOf(groups.data ?? []), kitchen, recentSlugs), [groups.data, kitchen, recentSlugs]);

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
          <Button variant="ghost" className={MONEY_PILL} onClick={groups.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <ul aria-label="Groups" className={K_ROWS}>
          {rows.slice(0, MONEY_GROUP_ROWS).map((row) => (
            <li key={row.id}>
              <GroupRow row={row} balance={kitchen.get(row.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GroupRow({ row, balance }: { row: MoneyGroupRow; balance: Parameters<typeof groupFactWhole>[0] }) {
  const fact = groupFactWhole(balance);
  return (
    <Link
      href={moneyGroupHref(row.id)}
      aria-label={`${row.name}, ${fact?.text ?? ""}, why`}
      className="flex min-h-[60px] items-center gap-3 py-2 pl-3.5 pr-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <GroupAvatar name={row.name} id={row.id} className="h-[42px] w-[42px] rounded-[14px]" />
      <span className="min-w-0 flex-1 truncate text-base font-medium">{row.name}</span>
      {fact ? <span className={cn("shrink-0 text-[15px] font-medium tabular-nums", TONE[fact.tone])}>{fact.text}</span> : null}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.2} aria-hidden />
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
