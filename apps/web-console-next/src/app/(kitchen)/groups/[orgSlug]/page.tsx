"use client";

import * as React from "react";
import Link from "@/components/kitchen/link";
import { ChevronRight, Plus, Settings } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import { usePathParam } from "@/lib/page-param";
import { cn } from "@/lib/cn";
import { recordRecentGroup, rememberGroupId, rememberedGroupId } from "@/lib/recent-groups";
import { usePrefetchKitchen } from "@/components/kitchen/prefetch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroups, useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, K_BUTTON_QUIET } from "@/components/kitchen/kit";
import { BackButton } from "@/components/kitchen/back-ui";
import { useBalances, useGroupRole } from "@/components/kitchen/ledger-data";
import { ActivityFeed } from "@/components/kitchen/activity-feed";
import { Face, MAIN_BUTTON, MainButtonLabel } from "@/components/kitchen/faces-ui";
import type { MemberNames } from "@/components/kitchen/members";
import { useMemberNames } from "@/components/kitchen/people-data";
import { usePantries } from "@/components/kitchen/pantry-data";
import { countWords } from "@/components/kitchen/pantry";
import { GroupDishesPanel } from "@/components/kitchen/dish-ui";
import { GroupDetail } from "@/components/kitchen/group-detail-ui";
import { newFrame } from "@/lib/features";
import {
  GROUP_ACTIVITY_ROWS,
  GROUP_DISH_ROWS,
  groupBalanceRows,
  groupMoney,
  groupSettleHref,
} from "@/components/kitchen/group-page";

/**
 * One group (CP-5, the ledger since CP-8; SM-11 under the seven rules): its
 * name and your money in it, one main button, then what happened and where
 * the group stands — see `GroupView`. Since CP-9 every member sees everyone
 * by name, each balance opens that person, and a viewer sees no write
 * actions. Its settings are their own page (`./settings`).
 */
export default function GroupPage() {
  const slug = usePathParam("/groups/:orgSlug", "orgSlug");
  const groups = useGroups();
  const group = groups.data?.find((g) => g.slug === slug) ?? null;
  const foundSlug = group?.slug ?? null;
  const foundId = group?.id ?? null;
  const prefetch = usePrefetchKitchen();

  // Opened cold, the group's own reads start beside the group list, by the
  // id this slug had last time (SM-5): no waiting for one before the other.
  React.useEffect(() => {
    const known = rememberedGroupId(slug);
    if (known) prefetch.group(known);
  }, [slug, prefetch]);

  React.useEffect(() => {
    if (!foundSlug) return;
    recordRecentGroup(foundSlug);
    if (foundId) rememberGroupId(foundSlug, foundId);
  }, [foundSlug, foundId]);

  // A group just created or joined may not be in the cached list yet: wait for
  // the refetch before deciding the person is not in it.
  if (groups.loading || (!group && groups.fetching)) return <GroupSkeleton />;
  if (groups.error) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this group.</p>
        <Button variant="ghost" className={K_BUTTON_QUIET} onClick={groups.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  if (!group) return <NotInGroup />;
  // The revamp (RV-5, the canvas's `RvGroup`) in the new frame; today's page in today's.
  return newFrame() ? <GroupDetail group={group} /> : <GroupView group={group} />;
}

/**
 * The group's everyday page (SM-11): its name with Back and Settings, your
 * money in it with Settle up when you owe or are owed, the one main button
 * (Add a bill; a viewer has none), then Activity (five rows, See all),
 * Balances (everyone else with money open, one line each), Dishes (three,
 * See all) and the pantry as one row. Invite, the waste rule, the currency,
 * members and Leave are behind Settings (`/groups/{slug}/settings`).
 */
function GroupView({ group }: { group: PublicOrganization }) {
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const { members, manager, canWrite } = useGroupRole(group.id, myId);
  const names = useMemberNames(members.data);
  const balances = useBalances(group.id);

  return (
    <div className="space-y-4">
      <header className="flex min-h-11 items-center gap-1">
        <BackButton />
        <h1 className="min-w-0 flex-1 truncate text-[26px] font-medium leading-tight tracking-tight">{group.name}</h1>
        <Link href={`/groups/${group.slug}/settings`} aria-label="Settings" className={cn(ICON_LINK, "-mr-2")}>
          <Settings className="h-5 w-5" aria-hidden />
        </Link>
      </header>

      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,340px)] min-[900px]:items-start min-[900px]:gap-6">
        <div className="min-w-0 space-y-4">
          <GroupMoneyCard group={group} myId={myId} balances={balances} />
          {canWrite ? (
            <Button asChild className={MAIN_BUTTON}>
              <Link href={`/groups/${group.slug}/expense`}>
                <Plus aria-hidden />
                <MainButtonLabel title="Add a bill" />
              </Link>
            </Button>
          ) : null}
          <section aria-labelledby="group-activity" className="space-y-2">
            <h2 id="group-activity" className={SECTION_TITLE}>
              Activity
            </h2>
            <ActivityFeed
              orgId={group.id}
              slug={group.slug}
              meId={myId}
              canReverseAny={manager}
              canWrite={canWrite}
              limit={GROUP_ACTIVITY_ROWS}
            />
          </section>
        </div>
        <div className="min-w-0 space-y-4">
          <BalancesSection balances={balances} myId={myId} names={names} />
          <section aria-labelledby="group-dishes" className="space-y-2">
            <h2 id="group-dishes" className={SECTION_TITLE}>
              Dishes
            </h2>
            <GroupDishesPanel orgId={group.id} meId={myId} names={names} limit={GROUP_DISH_ROWS} />
          </section>
          <PantryRow orgId={group.id} />
        </div>
      </div>
    </div>
  );
}

const ICON_LINK =
  "-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SECTION_TITLE = "text-lg font-medium tracking-tight";
const MONEY_TONE = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-foreground" } as const;

type BalancesState = ReturnType<typeof useBalances>;

/** "You get back ₹86.50" (or "Settled up"), with Settle up only when you owe or are owed. */
function GroupMoneyCard({ group, myId, balances }: { group: PublicOrganization; myId: string | null; balances: BalancesState }) {
  if (balances.loading || (!balances.data && !balances.error)) return <Skeleton className="h-[84px] w-full rounded-[22px]" />;
  if (balances.error || !balances.data) {
    return (
      <div className="flex min-h-[68px] items-center justify-between gap-3 rounded-[22px] border bg-card px-4">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your balance.</p>
        <Button variant="ghost" className={K_BUTTON_QUIET} onClick={balances.reload}>
          Try again
        </Button>
      </div>
    );
  }
  const money = groupMoney(balances.data, myId);
  return (
    <div className="flex items-center gap-3 rounded-[22px] border bg-card px-[18px] py-3">
      <p className="min-w-0 flex-1">
        {money.line.amount ? <span className="block text-[13px] font-medium text-muted-foreground">{money.line.label}</span> : null}
        <span className={cn("block truncate text-[30px] font-medium leading-tight tracking-tight tabular-nums", MONEY_TONE[money.line.tone])}>
          {money.line.amount ?? money.line.label}
        </span>
      </p>
      {money.settleUp ? (
        <Button asChild variant="ghost" className={cn(K_BUTTON_QUIET, "shrink-0 px-4")}>
          <Link href={groupSettleHref(group.slug)}>Settle up</Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Everyone else with money open in the group, one line each; each opens that person. */
function BalancesSection({ balances, myId, names }: { balances: BalancesState; myId: string | null; names: MemberNames }) {
  if (!balances.data) return null;
  const rows = groupBalanceRows(balances.data, myId, names);
  return (
    <section aria-labelledby="group-balances" className="space-y-2">
      <h2 id="group-balances" className={SECTION_TITLE}>
        Balances
      </h2>
      {rows.length === 0 ? (
        <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">Everyone is settled up</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-[22px] border bg-card">
          {rows.map((r) => (
            <li key={r.subjectId}>
              <Link
                href={`/people/${encodeURIComponent(r.subjectId)}`}
                className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Face subjectId={r.subjectId} meId={myId} names={names} className="h-9 w-9 text-xs" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{r.label}</span>
                <span className={cn("shrink-0 text-sm", MONEY_TONE[r.tone])}>
                  {r.words} <span className="font-medium tabular-nums">{r.amount}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The group's pantry as one row: how many items, opening Pantry on it. */
function PantryRow({ orgId }: { orgId: string }) {
  const pantries = usePantries();
  const pantry = pantries.data?.find((p) => p.kind === "group" && p.orgId === orgId) ?? null;
  return (
    <Link
      id="group-pantry"
      href={`/pantry?pantry=${encodeURIComponent(orgId)}`}
      className="flex min-h-14 items-center gap-3 rounded-[22px] border bg-card px-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1 text-lg font-medium tracking-tight">Pantry</span>
      {pantry ? <span className="shrink-0 text-sm text-muted-foreground">{countWords(pantry.itemCount, "item")}</span> : null}
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

// ── States ─────────────────────────────────────────────────────────

function NotInGroup() {
  return (
    <KCard className="flex flex-col items-center px-6 py-10 text-center">
      <h1 className="text-lg font-medium tracking-tight">You&apos;re not in this group</h1>
      <Button asChild className={cn(K_BUTTON, "mt-4")}>
        <Link href="/groups">Your groups</Link>
      </Button>
    </KCard>
  );
}

function GroupSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-11 w-48" />
      <Skeleton className="h-[84px] w-full rounded-[22px]" />
      <Skeleton className="h-[60px] w-full rounded-[18px]" />
      <Skeleton className="h-40 w-full rounded-[22px]" />
    </div>
  );
}
