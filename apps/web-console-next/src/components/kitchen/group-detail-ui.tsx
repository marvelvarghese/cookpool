"use client";

import * as React from "react";
import Link from "./link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Plus, Settings } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useProfile } from "./data";
import { CLOSE_44, KCard, K_BUTTON, K_BUTTON_QUIET, K_CARD, K_ROWS, K_SECTION } from "./kit";
import { BackButton } from "./back-ui";
import { useBalances, useGroupRole } from "./ledger-data";
import { ActivityFeed } from "./activity-feed";
import { Face } from "./faces-ui";
import { memberLabel, type MemberNames } from "./members";
import { useMemberNames } from "./people-data";
import { usePantryItems } from "./pantry-data";
import { expiryChip, itemHref, leftText } from "./pantry";
import { GroupDishesPanel } from "./dish-ui";
import {
  GROUP_TABS,
  GROUP_TAB_ROWS,
  balanceFromYou,
  groupAddChoices,
  groupFaces,
  groupMoney,
  groupMoneyHref,
  groupPill,
  groupTabFrom,
  groupTabHref,
  pantryFactTone,
  type GroupTab,
} from "./group-page";
import { balanceView } from "@saas/spliteco-ui/balance";
import { useKitchenGroup } from "./kitchen-money-data";
import { namesOf } from "./kitchen-money-ui";

/**
 * One group in the new look (the revamp RV-5, the canvas's `RvGroup`): Back,
 * its name and a gear (Settings: invite, the waste rule, the currency,
 * members, Leave); the faces in it and your balance as a pill (Settle up when
 * you owe or are owed); Activity · Pantry · Money as tabs, each three rows
 * and See all; and one main button, Add — Expense, Pantry item or Dish I
 * cooked. A viewer has no Add. The tab is in the address (`?tab=`), so Back
 * from a row comes back to it. The reads are today's.
 */
export function GroupDetail({ group }: { group: PublicOrganization }) {
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const { members, manager, canWrite } = useGroupRole(group.id, myId);
  const names = useMemberNames(members.data);
  const balances = useBalances(group.id);
  const router = useRouter();
  const tab = groupTabFrom(useSearchParams()?.get("tab"));
  const [latestAll, setLatestAll] = React.useState(false);
  const pick = (next: GroupTab) => {
    if (next !== tab) router.replace(groupTabHref(group.slug, next), { scroll: false });
  };

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <div className="flex min-h-11 items-center gap-1.5">
          <BackButton />
          <h1 className="min-w-0 flex-1 truncate text-2xl font-medium leading-tight tracking-[-0.02em]">{group.name}</h1>
          <Link
            href={`/groups/${group.slug}/settings`}
            aria-label="Group settings"
            className="-mr-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-[14px] text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings className="h-[22px] w-[22px]" aria-hidden />
          </Link>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Faces subjectIds={members.data?.map((m) => m.subjectId) ?? null} myId={myId} names={names} />
          <BalancePill group={group} myId={myId} balances={balances} />
        </div>
      </header>

      <div role="tablist" aria-label="Group sections" className="grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
        {GROUP_TABS.map((t) => (
          <button
            key={t.id}
            id={`group-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="group-tab-panel"
            onClick={() => pick(t.id)}
            className={cn(
              "min-h-11 rounded-xl text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t.id ? "bg-card text-foreground shadow-cp-card" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="group-tab-panel" role="tabpanel" aria-labelledby={`group-tab-${tab}`} className="space-y-5">
        {tab === "activity" ? (
          <>
            <section aria-labelledby="group-latest" className="space-y-2.5">
              <div className="flex min-h-11 items-center justify-between">
                <h2 id="group-latest" className={K_SECTION}>
                  Latest
                </h2>
                <button type="button" aria-expanded={latestAll} onClick={() => setLatestAll(!latestAll)} className={MORE}>
                  {latestAll ? "Show less" : "See all"}
                </button>
              </div>
              <ActivityFeed
                orgId={group.id}
                slug={group.slug}
                meId={myId}
                canReverseAny={manager}
                canWrite={canWrite}
                limit={GROUP_TAB_ROWS}
                variant="line"
                expanded={latestAll}
              />
            </section>
            <section aria-labelledby="group-dishes" className="space-y-2.5">
              <h2 id="group-dishes" className={cn(K_SECTION, "flex min-h-11 items-center")}>
                Dishes
              </h2>
              <GroupDishesPanel orgId={group.id} meId={myId} names={names} limit={GROUP_TAB_ROWS} />
            </section>
          </>
        ) : tab === "pantry" ? (
          <PantryTab orgId={group.id} />
        ) : (
          <MoneyTab group={group} myId={myId} names={names} />
        )}
      </div>

      {canWrite ? <AddButton group={group} /> : null}
    </div>
  );
}

const TONE = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-muted-foreground" } as const;
const PILL_TONE = { owed: "bg-cp-owed-tint text-cp-owed", owe: "bg-cp-owe-tint text-cp-owe", settled: "bg-muted text-muted-foreground" } as const;
const ROW =
  "flex min-h-14 items-center gap-3 px-3.5 py-2 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const MORE = "flex min-h-11 items-center rounded-md text-sm font-medium text-cp-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** You first, then the others, overlapping; "+N" past four. One image for a screen reader: their names. */
function Faces({ subjectIds, myId, names }: { subjectIds: readonly string[] | null; myId: string | null; names: MemberNames }) {
  if (!subjectIds) return <Skeleton className="h-[38px] w-28 rounded-full" />;
  const { shown, more } = groupFaces(subjectIds, myId);
  const label = shown.map((s) => memberLabel(s, myId, names)).join(", ") + (more ? ` and ${more} more` : "");
  return (
    <div role="img" aria-label={label} className="flex items-center pl-2">
      {shown.map((s) => (
        <Face key={s} subjectId={s} meId={myId} names={names} className="-ml-2 h-[38px] w-[38px] border-2 border-background text-xs font-medium" />
      ))}
      {more ? (
        <span aria-hidden className="-ml-2 grid h-[38px] w-[38px] place-items-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground">
          +{more}
        </span>
      ) : null}
    </div>
  );
}

type BalancesState = ReturnType<typeof useBalances>;

/** Your balance in the group as a pill; it opens Settle up when you owe or are owed. */
function BalancePill({ group, myId, balances }: { group: PublicOrganization; myId: string | null; balances: BalancesState }) {
  if (balances.loading || (!balances.data && !balances.error)) return <Skeleton className="h-10 w-24 rounded-full" />;
  if (balances.error || !balances.data) {
    return (
      <Button variant="ghost" className={cn(K_BUTTON, "h-10 rounded-full px-3.5 text-sm text-muted-foreground")} onClick={balances.reload}>
        Try again
      </Button>
    );
  }
  const money = groupMoney(balances.data, myId);
  const pill = groupPill(balances.data, myId);
  const className = cn("flex min-h-10 items-center rounded-full px-3.5 text-[15px] font-medium tabular-nums", PILL_TONE[pill.tone]);
  return money.settleUp ? (
    <Link href={groupMoneyHref(group.id)} aria-label={`${money.line.text}. Settle up`} className={cn(className, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      {pill.text}
    </Link>
  ) : (
    <span className={className}>{pill.text}</span>
  );
}

/** The group's pantry, soonest use-by first: three items, then See all (Pantry on this group). */
function PantryTab({ orgId }: { orgId: string }) {
  const items = usePantryItems(orgId);
  const list = items.data?.items ?? [];
  const shown = list.slice(0, GROUP_TAB_ROWS);
  return (
    <section aria-labelledby="group-pantry" className="space-y-2.5">
      <div className="flex min-h-11 items-center justify-between">
        <h2 id="group-pantry" className={K_SECTION}>
          Use soon
        </h2>
        <Link href={`/pantry?pantry=${encodeURIComponent(orgId)}`} className={MORE}>
          See all
        </Link>
      </div>
      {items.loading && !items.data ? (
        <KCard className="px-4" aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
        </KCard>
      ) : items.error && !items.data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the pantry.</p>
          <Button variant="ghost" className={K_BUTTON_QUIET} onClick={items.reload}>
            Try again
          </Button>
        </KCard>
      ) : shown.length === 0 ? (
        <p className={cn(K_CARD, "flex min-h-14 items-center px-4 text-sm text-muted-foreground")}>Nothing in the pantry</p>
      ) : (
        <ul className={K_ROWS}>
          {shown.map((item) => {
            const chip = expiryChip(item);
            return (
              <li key={item.id}>
                <Link href={itemHref(item)} className={ROW}>
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cp-accent-tint text-sm font-medium text-cp-accent-text">
                    {item.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-normal">{item.name}</span>
                  <span className="shrink-0 text-sm font-medium text-muted-foreground tabular-nums">
                    {leftText(item)}
                    {chip ? (
                      <>
                        {" · "}
                        <span className={pantryFactTone(chip) === "expired" ? "text-cp-expired" : undefined}>{chip.label}</span>
                      </>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Balances from your view (RvGroup; the revamp audit's Group 4–5): everyone
 * in the group with what is between you two in the Kitchen plan — "+₹610"
 * blue when they owe you, "−₹24" orange when you owe them, "Square" — the
 * same read Settle up pays against. Three, then See all (the group's balance
 * and its why on Money, where Settle up is).
 */
function MoneyTab({ group, myId, names }: { group: PublicOrganization; myId: string | null; names: MemberNames }) {
  const read = useKitchenGroup(group.id);
  const kitchenNames = React.useMemo(() => namesOf(read.data ?? null), [read.data]);
  const view = React.useMemo(() => (read.data ? balanceView(read.data, myId, kitchenNames) : null), [read.data, myId, kitchenNames]);
  const rows = view?.rows ?? [];
  return (
    <section aria-labelledby="group-balances" className="space-y-2.5">
      <div className="flex min-h-11 items-center justify-between">
        <h2 id="group-balances" className={K_SECTION}>
          Balances
        </h2>
        <Link href={groupMoneyHref(group.id)} className={MORE}>
          See all
        </Link>
      </div>
      {read.loading && !read.data ? (
        <KCard className="px-4" aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
        </KCard>
      ) : read.error || !view ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the balances.</p>
          <Button variant="ghost" className={K_BUTTON_QUIET} onClick={read.reload}>
            Try again
          </Button>
        </KCard>
      ) : rows.length === 0 ? (
        <p className={cn(K_CARD, "flex min-h-14 items-center px-4 text-sm text-muted-foreground")}>No one else here yet</p>
      ) : (
        <ul className={K_ROWS}>
          {rows.slice(0, GROUP_TAB_ROWS).map((r) => {
            const fact = balanceFromYou(r.amountMinor, view.currency);
            return (
              <li key={r.subjectId}>
                <Link href={`/people/${encodeURIComponent(r.subjectId)}`} className={ROW}>
                  <Face subjectId={r.subjectId} meId={myId} names={names} className="h-9 w-9 text-[13px] font-medium" />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-normal">{r.name}</span>
                  <span className={cn("shrink-0 text-sm font-medium tabular-nums", TONE[fact.tone])} aria-label={r.text}>
                    {fact.text}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Add, the page's one main button, above the tab bar on a phone: a sheet with what can be added here. */
function AddButton({ group }: { group: PublicOrganization }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="sticky bottom-[var(--cp-bottom-bar,calc(max(14px,env(safe-area-inset-bottom))+82px))] z-10 pt-2 min-[900px]:static min-[900px]:pt-0">
        <Button aria-haspopup="dialog" onClick={() => setOpen(true)} className="h-auto min-h-14 w-full gap-2 rounded-[18px] text-base font-medium shadow-cp-nav">
          <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden />
          Add
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className={cn(
            "mx-auto max-w-xl gap-0 rounded-t-[26px] border-x-0 bg-background px-[18px] pt-2.5 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
            CLOSE_44,
          )}
        >
          <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-cp-line min-[900px]:hidden" />
          <SheetTitle className={cn(K_SECTION, "flex min-h-11 items-center pr-12")}>Add to {group.name}</SheetTitle>
          <ul className={cn(K_ROWS, "mb-5 mt-3")}>
            {groupAddChoices(group).map((c) => (
              <li key={c.id}>
                <Link href={c.href} onClick={() => setOpen(false)} className={cn(ROW, "min-h-14 text-base")}>
                  <span className="min-w-0 flex-1">{c.label}</span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
