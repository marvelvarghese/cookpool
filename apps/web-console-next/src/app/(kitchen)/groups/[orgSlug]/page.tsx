"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  Crown,
  DoorOpen,
  HandCoins,
  MoreVertical,
  Plus,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import type {
  BalancesResponse,
  KitchenMember,
  KitchenSettings,
  UpdateKitchenSettingsRequest,
  WastePolicy,
} from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { forgetRecentGroup, recordRecentGroup } from "@/lib/recent-groups";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/ui/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGroups, useProfile } from "@/components/kitchen/data";
import {
  GROUP_CURRENCIES,
  WASTE_RULES,
  roleFromKitchen,
  wasteRuleLabel,
  type GroupRole,
} from "@/components/kitchen/groups";
import { formatJoinCode, joinUrl } from "@/components/kitchen/join-code";
import {
  GroupAvatar,
  KCard,
  K_BUTTON,
  RoleBadge,
  shortDate,
} from "@/components/kitchen/kit";
import { useBalances, useGroupRole, useSettlePlan } from "@/components/kitchen/ledger-data";
import { ActivityFeed } from "@/components/kitchen/activity-feed";
import { SettleCard, SettleNote } from "@/components/kitchen/settle-card";
import { BalanceWords, Money, PersonAvatar } from "@/components/kitchen/ledger-ui";
import { memberLabel, type MemberNames } from "@/components/kitchen/members";
import { useMemberNames } from "@/components/kitchen/people-data";
import { GroupPantryPanel } from "@/components/kitchen/pantry-cards";
import { GroupDishesPanel } from "@/components/kitchen/dish-ui";

/**
 * One group (CP-5, the ledger since CP-8): your balance in it with Add expense
 * and Settle up, then the tabs Activity · Balances · Pantry · Dishes (the
 * pantry lists what the group holds since CP-12; the dishes shared with the
 * group, each opening its page, since CP-17); beside them who is in it
 * and your role, the join link (owners and admins copy and rotate it), the
 * group's rules (owners and admins edit) and leaving. `?tab=` keeps the open
 * tab in the address. Since CP-9 every member sees everyone by name and role
 * (owners can make someone an owner or admin), each balance opens that
 * person, and a viewer sees no write actions.
 */
export default function GroupPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  const groups = useGroups();
  const group = groups.data?.find((g) => g.slug === slug) ?? null;
  const foundSlug = group?.slug ?? null;
  // Set once the person leaves, so the page does not flash "not in this
  // group" while the router moves to /groups.
  const [left, setLeft] = React.useState(false);

  React.useEffect(() => {
    if (foundSlug) recordRecentGroup(foundSlug);
  }, [foundSlug]);

  // A group just created or joined may not be in the cached list yet: wait for
  // the refetch before deciding the person is not in it.
  if (left || groups.loading || (!group && groups.fetching)) return <GroupSkeleton />;
  if (groups.error) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this group. {groups.error.message}</p>
        <Button variant="outline" className={K_BUTTON} onClick={groups.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  if (!group) return <NotInGroup />;
  return <GroupView group={group} onLeft={() => setLeft(true)} />;
}

const GROUP_TABS = [
  { id: "activity", label: "Activity" },
  { id: "balances", label: "Balances" },
  { id: "pantry", label: "Pantry" },
  { id: "dishes", label: "Dishes" },
] as const;
type GroupTab = (typeof GROUP_TABS)[number]["id"];

function isGroupTab(value: string | null | undefined): value is GroupTab {
  return GROUP_TABS.some((t) => t.id === value);
}

function GroupView({ group, onLeft }: { group: PublicOrganization; onLeft: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const { members, role, roleKnown, manager, canWrite } = useGroupRole(group.id, myId);
  const names = useMemberNames(members.data);
  const balances = useBalances(group.id);

  // The open tab switches at once and is mirrored into the address with the
  // history API (no navigation), so a reload or a shared link opens it again;
  // a link to another `?tab=` (Home's balance rows) still switches it.
  const tabParam = searchParams?.get("tab");
  const [tab, setTabState] = React.useState<GroupTab>(isGroupTab(tabParam) ? tabParam : "activity");
  React.useEffect(() => {
    setTabState(isGroupTab(tabParam) ? tabParam : "activity");
  }, [tabParam]);
  const setTab = (next: string) => {
    if (!isGroupTab(next)) return;
    setTabState(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "activity") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    window.history.replaceState(null, "", `${pathname ?? `/groups/${group.slug}`}${qs ? `?${qs}` : ""}`);
  };

  return (
    <div className="space-y-6">
      <Link
        href="/groups"
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Groups
      </Link>

      <header className="flex items-center gap-4">
        <GroupAvatar name={group.name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-extrabold leading-tight tracking-tight">{group.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {role ? (
              <>
                <span className="sr-only">Your role:</span>
                <RoleBadge role={role} />
              </>
            ) : !roleKnown ? (
              <Skeleton className="h-5 w-16 rounded-full" />
            ) : null}
            {members.data ? (
              <span>
                {members.data.length} {members.data.length === 1 ? "member" : "members"}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,340px)] min-[900px]:items-start">
        <div className="min-w-0 space-y-5">
          <YourBalanceCard group={group} myId={myId} balances={balances} canWrite={canWrite} roleKnown={roleKnown} />

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid h-auto w-full grid-cols-4 rounded-xl border border-input bg-card p-0.5">
              {GROUP_TABS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="min-h-11 rounded-[10px] px-1 text-sm font-semibold text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="activity">
              <ActivityFeed orgId={group.id} slug={group.slug} meId={myId} canReverseAny={manager} canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="balances">
              <BalancesPanel group={group} myId={myId} balances={balances} manager={manager} canWrite={canWrite} names={names} />
            </TabsContent>
            <TabsContent value="pantry">
              <GroupPantryPanel orgId={group.id} name={group.name} canWrite={canWrite} />
            </TabsContent>
            <TabsContent value="dishes">
              <GroupDishesPanel orgId={group.id} groupName={group.name} meId={myId} names={names} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="min-w-0 space-y-5">
          {manager ? <InviteCard group={group} /> : null}
          <RulesCard group={group} manager={manager} roleKnown={roleKnown} />
          <MembersCard
            group={group}
            members={members.data}
            loading={members.loading}
            error={members.error}
            reload={members.reload}
            myId={myId}
            myRole={role}
            names={names}
          />
          <LeaveCard group={group} onLeft={onLeft} owner={role === "owner"} />
        </div>
      </div>
    </div>
  );
}

// ── Your balance ───────────────────────────────────────────────────

type BalancesState = ReturnType<typeof useBalances>;

function YourBalanceCard({
  group,
  myId,
  balances,
  canWrite,
  roleKnown,
}: {
  group: PublicOrganization;
  myId: string | null;
  balances: BalancesState;
  canWrite: boolean;
  roleKnown: boolean;
}) {
  const mine = myId ? balances.data?.balances.find((b) => b.subjectId === myId) : undefined;
  const minor = mine?.balanceMinor ?? 0;
  const currency = balances.data?.currency ?? "INR";
  return (
    <KCard className="p-5">
      <h2 className="text-sm font-medium text-muted-foreground">Your balance in {group.name}</h2>
      {balances.loading || (!balances.data && !balances.error) ? (
        <Skeleton className="mt-2 h-8 w-48" />
      ) : balances.error ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Couldn&apos;t load it. {balances.error.message}{" "}
          <button type="button" onClick={balances.reload} className="min-h-11 font-semibold text-primary underline-offset-2 hover:underline">
            Try again
          </button>
        </p>
      ) : minor === 0 ? (
        <p className="mt-1 text-2xl font-extrabold tracking-tight">You&apos;re settled up</p>
      ) : (
        <p className={cn("mt-1 text-2xl font-extrabold tracking-tight", minor > 0 ? "text-cp-owed" : "text-cp-owe")}>
          {minor > 0 ? "You get back " : "You owe "}
          <Money minor={Math.abs(minor)} currency={currency} />
        </p>
      )}
      <div className={cn("mt-4 grid gap-2 min-[560px]:flex", canWrite || !roleKnown ? "grid-cols-2" : "grid-cols-1")}>
        {/* A viewer reads the group but adds nothing to it. */}
        {canWrite ? (
          <Button asChild className={K_BUTTON}>
            <Link href={`/groups/${group.slug}/expense`}>
              <Plus aria-hidden />
              Add expense
            </Link>
          </Button>
        ) : !roleKnown ? (
          <Skeleton className="h-11 rounded-xl" />
        ) : null}
        <Button asChild variant="outline" className={K_BUTTON}>
          <Link href={`/settle?group=${encodeURIComponent(group.slug)}`}>
            <HandCoins aria-hidden />
            Settle up
          </Link>
        </Button>
      </div>
      {roleKnown && !canWrite ? (
        <p className="mt-3 text-xs text-muted-foreground">You view {group.name}: you see its money, but don&apos;t add to it.</p>
      ) : null}
    </KCard>
  );
}

// ── Balances ───────────────────────────────────────────────────────

function BalancesPanel({
  group,
  myId,
  balances,
  manager,
  canWrite,
  names,
}: {
  group: PublicOrganization;
  myId: string | null;
  balances: BalancesState;
  manager: boolean;
  canWrite: boolean;
  names: MemberNames;
}) {
  const plan = useSettlePlan(group.id);
  return (
    <div className="space-y-5">
      <KCard className="p-5">
        <h3 className="text-base font-bold tracking-tight">Everyone&apos;s balance</h3>
        {balances.loading ? (
          <div aria-hidden>
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : balances.error || !balances.data ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Couldn&apos;t load the balances. {balances.error?.message ?? ""}</p>
            <Button variant="outline" className={K_BUTTON} onClick={balances.reload}>
              Try again
            </Button>
          </div>
        ) : (
          <BalanceList data={balances.data} myId={myId} names={names} />
        )}
      </KCard>
      <SettleCard
        group={group}
        plan={plan.data}
        loading={plan.loading}
        error={plan.error}
        reload={plan.reload}
        meId={myId}
        canRecordAny={manager}
        canWrite={canWrite}
      />
      <SettleNote className="px-1" />
    </div>
  );
}

/** Everyone's balance; each other person opens their view (everything between you two). */
function BalanceList({ data, myId, names }: { data: BalancesResponse; myId: string | null; names: MemberNames }) {
  if (data.balances.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">No one has a balance yet.</p>;
  }
  return (
    <ul className="mt-2 divide-y">
      {data.balances.map((b) => {
        const row = (
          <>
            <PersonAvatar subjectId={b.subjectId} meId={myId} names={names} />
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{memberLabel(b.subjectId, myId, names)}</span>
            <BalanceWords minor={b.balanceMinor} currency={data.currency} className="shrink-0 text-right" />
          </>
        );
        return (
          <li key={b.subjectId}>
            {b.subjectId === myId ? (
              <div className="flex min-h-14 items-center gap-3 py-2">
                {row}
                {/* Lines up with the chevron on everyone else's row. */}
                <span aria-hidden className="w-4 shrink-0" />
              </div>
            ) : (
              <Link
                href={`/people/${encodeURIComponent(b.subjectId)}`}
                className="-mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Invite ─────────────────────────────────────────────────────────

function InviteCard({ group }: { group: PublicOrganization }) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmRotate, setConfirmRotate] = React.useState(false);
  const code = useApiQuery(qk.joinCode(group.id), () =>
    wrap(async () => (await client.memberships.getJoinCode(group.id)).code),
  );
  const link = code.data ? joinUrl(window.location.origin, code.data) : "";

  const rotate = async () => {
    const r = await wrap(() =>
      client.memberships.rotateJoinCode(group.id, { idempotencyKey: crypto.randomUUID() }),
    );
    if (!r.ok) {
      toast({ kind: "error", title: "Couldn't change the link", description: r.error.message });
      return;
    }
    qc.setQueryData(qk.joinCode(group.id), r.data.code);
    toast({ kind: "success", title: "New join link ready", description: "The old link no longer works." });
  };

  return (
    <KCard className="p-5">
      <h2 className="text-base font-bold tracking-tight">Invite people</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Anyone with this link can join {group.name} as a member.
      </p>

      {code.loading ? (
        <Skeleton className="mt-4 h-11 w-full rounded-xl" />
      ) : code.error ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the link. {code.error.message}</p>
          <Button variant="outline" className={K_BUTTON} onClick={code.reload}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <p id="group-join-link-label" className="mt-4 text-sm font-medium">
            Join link
          </p>
          {/* The whole link, wrapped (an input would cut it off on a phone);
              one tap selects all of it. */}
          <p
            aria-labelledby="group-join-link-label"
            className="mt-2 select-all break-all rounded-xl border bg-background px-3 py-2.5 font-mono text-sm"
          >
            {link}
          </p>
          <CopyButton
            value={link}
            label="Copy link"
            copiedLabel="Copied"
            className="mt-2 h-11 w-full rounded-xl px-4 text-[15px] font-semibold"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Code{" "}
              <span className="font-mono text-[15px] font-bold tracking-wider text-foreground">
                {code.data ? formatJoinCode(code.data) : ""}
              </span>
            </p>
            <Button variant="ghost" className={cn(K_BUTTON, "px-3")} onClick={() => setConfirmRotate(true)}>
              <RefreshCw aria-hidden />
              New link
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Make a new join link?"
        description={`The current link stops working straight away. Everyone already in ${group.name} stays in; send the new link to anyone who still needs to join.`}
        confirmLabel="Make a new link"
        onConfirm={rotate}
      />
    </KCard>
  );
}

// ── Rules ──────────────────────────────────────────────────────────

function RulesCard({ group, manager, roleKnown }: { group: PublicOrganization; manager: boolean; roleKnown: boolean }) {
  const { client } = useSession();
  const settings = useApiQuery(qk.kitchenSettings(group.id), () => wrap(() => client.kitchen.getSettings(group.id)));

  return (
    <KCard className="p-5">
      <h2 className="text-base font-bold tracking-tight">Group rules</h2>
      {settings.loading || !roleKnown ? (
        <div className="mt-4 space-y-2" aria-hidden>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
      ) : settings.error || !settings.data ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the rules. {settings.error?.message ?? ""}
          </p>
          <Button variant="outline" className={K_BUTTON} onClick={settings.reload}>
            Try again
          </Button>
        </div>
      ) : manager ? (
        <RulesForm group={group} settings={settings.data} reload={settings.reload} />
      ) : (
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">When food goes to waste</dt>
            <dd className="font-semibold">{wasteRuleLabel(settings.data.wastePolicy)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Currency</dt>
            <dd className="font-semibold">{settings.data.currency}</dd>
          </div>
        </dl>
      )}
      {!manager && settings.data && roleKnown ? (
        <p className="mt-3 text-xs text-muted-foreground">Owners and admins set the rules.</p>
      ) : null}
    </KCard>
  );
}

function RulesForm({
  group,
  settings,
  reload,
}: {
  group: PublicOrganization;
  settings: KitchenSettings;
  reload: () => void;
}) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [waste, setWaste] = React.useState<WastePolicy>(settings.wastePolicy);
  const [currency, setCurrency] = React.useState(settings.currency);
  const [busy, setBusy] = React.useState(false);

  // Follow the server after a save or refetch.
  React.useEffect(() => {
    setWaste(settings.wastePolicy);
    setCurrency(settings.currency);
  }, [settings.wastePolicy, settings.currency]);

  // The currency is fixed once the group has saved its settings.
  const currencyLocked = settings.updatedAt !== null;
  const dirty = waste !== settings.wastePolicy || (!currencyLocked && currency !== settings.currency);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    const body: UpdateKitchenSettingsRequest = { wastePolicy: waste };
    if (!currencyLocked) body.currency = currency;
    setBusy(true);
    const r = await wrap(() => client.kitchen.updateSettings(group.id, body, { idempotencyKey: crypto.randomUUID() }));
    setBusy(false);
    if (!r.ok) {
      if (r.error.reason === "currency_locked") {
        toast({
          kind: "warning",
          title: "The currency is already set",
          description: "A group's currency can't change once it's saved.",
        });
        reload();
        return;
      }
      toast({ kind: "error", title: "Couldn't save the rules", description: r.error.message });
      return;
    }
    qc.setQueryData(qk.kitchenSettings(group.id), r.data);
    toast({ kind: "success", title: "Rules saved" });
  };

  return (
    <form onSubmit={save} className="mt-3 space-y-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm text-muted-foreground">When food goes to waste</legend>
        {WASTE_RULES.map((rule) => (
          <label
            key={rule.id}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
              waste === rule.id ? "border-primary bg-accent" : "hover:bg-accent/60",
            )}
          >
            <input
              type="radio"
              name={`waste-${group.id}`}
              value={rule.id}
              checked={waste === rule.id}
              onChange={() => setWaste(rule.id)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
            />
            <span>
              <span className="block text-[15px] font-semibold">{rule.label}</span>
              <span className="block text-xs text-muted-foreground">{rule.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {currencyLocked ? (
        <div className="text-sm">
          <p className="text-muted-foreground">Currency</p>
          <p className="font-semibold">
            {settings.currency} <span className="font-normal text-muted-foreground">· fixed once set</span>
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`currency-${group.id}`} className="font-normal text-muted-foreground">
            Currency
          </Label>
          <select
            id={`currency-${group.id}`}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-describedby={`currency-${group.id}-hint`}
            className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[15px]"
          >
            {GROUP_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <p id={`currency-${group.id}-hint`} className="text-xs text-muted-foreground">
            Set it once: it can&apos;t change after you save.
          </p>
        </div>
      )}

      <Button type="submit" className={cn(K_BUTTON, "w-full")} disabled={!dirty} loading={busy}>
        Save rules
      </Button>
    </form>
  );
}

// ── Members ────────────────────────────────────────────────────────

function MembersCard({
  group,
  members,
  loading,
  error,
  reload,
  myId,
  myRole,
  names,
}: {
  group: PublicOrganization;
  members: KitchenMember[] | null;
  loading: boolean;
  error: { message: string } | null;
  reload: () => void;
  myId: string | null;
  myRole: GroupRole | null;
  names: MemberNames;
}) {
  const [promoting, setPromoting] = React.useState<{ member: KitchenMember; role: "owner" | "admin" } | null>(null);
  const sorted = React.useMemo(() => {
    if (!members) return [];
    // You first, then in the order people joined (the API's order).
    return [...members].sort((a, b) => (a.subjectId === myId ? -1 : b.subjectId === myId ? 1 : 0));
  }, [members, myId]);

  return (
    <KCard className="scroll-mt-6 p-5" id="group-members">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
        <UsersRound className="h-5 w-5 text-muted-foreground" aria-hidden />
        Members
        {members ? <span className="font-normal text-muted-foreground">· {members.length}</span> : null}
      </h2>
      {loading ? (
        <div aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : error || !members ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the members. {error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <ul className="mt-2 divide-y">
          {sorted.map((m) => {
            const role = roleFromKitchen(m.role);
            const label = memberLabel(m.subjectId, myId, names);
            const you = m.subjectId === myId;
            // Owners hand over ownership (or make an admin); never of themselves.
            const canPromote = myRole === "owner" && !you && m.memberId !== null && role !== "owner";
            const who = (
              <>
                <PersonAvatar subjectId={m.subjectId} meId={myId} names={names} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{label}</span>
                  {m.joinedAt ? (
                    <span className="block text-xs text-muted-foreground">Joined {shortDate(m.joinedAt)}</span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={m.subjectId} className="flex min-h-14 items-center gap-2 py-2">
                {you ? (
                  <div className="flex min-w-0 flex-1 items-center gap-3">{who}</div>
                ) : (
                  <Link
                    href={`/people/${encodeURIComponent(m.subjectId)}`}
                    className="-ml-2 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {who}
                  </Link>
                )}
                {role ? <RoleBadge role={role} /> : null}
                {canPromote ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Change ${label}'s role`}
                      className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <MoreVertical className="h-5 w-5" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-48 rounded-xl p-1.5">
                      <DropdownMenuItem
                        onSelect={() => setPromoting({ member: m, role: "owner" })}
                        className="min-h-11 rounded-lg px-3 text-[15px]"
                      >
                        <Crown className="h-4 w-4" aria-hidden />
                        Make owner
                      </DropdownMenuItem>
                      {role !== "admin" ? (
                        <DropdownMenuItem
                          onSelect={() => setPromoting({ member: m, role: "admin" })}
                          className="min-h-11 rounded-lg px-3 text-[15px]"
                        >
                          <ShieldCheck className="h-4 w-4" aria-hidden />
                          Make admin
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : myRole === "owner" ? (
                  // Keeps the role badges in one column beside rows that have a menu.
                  <span aria-hidden className="-mr-2 w-11 shrink-0" />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <PromoteDialog
        group={group}
        target={promoting}
        name={promoting ? memberLabel(promoting.member.subjectId, myId, names) : ""}
        onClose={() => setPromoting(null)}
      />
    </KCard>
  );
}

const PROMOTE_COPY: Record<"owner" | "admin", { title: (name: string) => string; body: (group: string) => string; done: string }> = {
  owner: {
    title: (name) => `Make ${name} an owner?`,
    body: (group) =>
      `They'll be able to do everything you can in ${group}: change anyone's role, the rules and the join link. You stay an owner.`,
    done: "an owner",
  },
  admin: {
    title: (name) => `Make ${name} an admin?`,
    body: (group) => `They'll manage ${group}'s join link and rules, and can record or undo anyone's entries.`,
    done: "an admin",
  },
};

/** Confirms a role change, then posts it through the membership API. */
function PromoteDialog({
  group,
  target,
  name,
  onClose,
}: {
  group: PublicOrganization;
  target: { member: KitchenMember; role: "owner" | "admin" } | null;
  name: string;
  onClose: () => void;
}) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const copy = PROMOTE_COPY[target?.role ?? "owner"];

  const promote = async () => {
    if (!target?.member.memberId) return;
    const r = await wrap(() =>
      client.memberships.updateMemberRole(group.id, target.member.memberId!, { role: target.role }),
    );
    for (const key of [qk.kitchenMembers(group.id), qk.members(group.id), qk.kitchenMe()]) {
      void qc.invalidateQueries({ queryKey: key });
    }
    if (!r.ok) {
      toast({ kind: "error", title: "Couldn't change the role", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: `${name} is now ${copy.done}` });
  };

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title={copy.title(name)}
      description={copy.body(group.name)}
      confirmLabel={target?.role === "admin" ? "Make admin" : "Make owner"}
      destructive={false}
      onConfirm={promote}
    />
  );
}

// ── Leave ──────────────────────────────────────────────────────────

function LeaveCard({ group, onLeft, owner }: { group: PublicOrganization; onLeft: () => void; owner: boolean }) {
  const { client } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const [confirm, setConfirm] = React.useState(false);
  const [lastOwner, setLastOwner] = React.useState(false);

  const leave = async () => {
    setLastOwner(false);
    const r = await wrap(() => client.memberships.leave(group.id, { idempotencyKey: crypto.randomUUID() }));
    if (!r.ok) {
      if (r.error.reason === "last_owner") {
        setLastOwner(true);
        return;
      }
      toast({ kind: "error", title: "Couldn't leave the group", description: r.error.message });
      return;
    }
    onLeft();
    toast({ kind: "success", title: `You left ${group.name}` });
    router.replace("/groups");
    forgetRecentGroup(group.slug);
    qc.setQueryData<PublicOrganization[]>(qk.orgs(), (old) => old?.filter((g) => g.id !== group.id));
    for (const key of [
      qk.members(group.id),
      qk.kitchenMembers(group.id),
      qk.joinCode(group.id),
      qk.kitchenSettings(group.id),
      qk.kitchenLedger(group.id),
    ]) {
      qc.removeQueries({ queryKey: key });
    }
    void qc.invalidateQueries({ queryKey: qk.orgs() });
    void qc.invalidateQueries({ queryKey: qk.kitchenMe() });
  };

  return (
    <KCard className="p-5">
      <h2 className="text-base font-bold tracking-tight">Leave group</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You&apos;ll stop seeing {group.name}. To come back you&apos;ll need its join link.
      </p>
      {lastOwner ? (
        <div role="alert" className="mt-3 rounded-xl bg-cp-soon-tint p-3 text-sm text-cp-soon">
          <p className="font-bold">You&apos;re the last owner of {group.name}</p>
          <p className="mt-0.5">
            A group needs an owner while anyone is still in it. Make someone else an owner first, then
            you can leave.
          </p>
          {owner ? (
            <a
              href="#group-members"
              className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Choose a new owner in Members
              <ChevronRight className="h-4 w-4" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}
      <Button
        variant="outline"
        className={cn(K_BUTTON, "mt-4 w-full border-destructive/40 text-destructive hover:bg-cp-expired-tint hover:text-destructive")}
        onClick={() => setConfirm(true)}
      >
        <DoorOpen aria-hidden />
        Leave {group.name}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Leave ${group.name}?`}
        description="You'll stop seeing this group. To come back, someone in it will need to send you the join link."
        confirmLabel="Leave group"
        onConfirm={leave}
      />
    </KCard>
  );
}

// ── States ─────────────────────────────────────────────────────────

function NotInGroup() {
  return (
    <KCard className="flex flex-col items-center px-6 py-12 text-center">
      <h1 className="text-lg font-bold tracking-tight">You&apos;re not in this group</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        It may have been renamed, or you may have left it. To join, open the join link someone sent you.
      </p>
      <Button asChild className={cn(K_BUTTON, "mt-5")}>
        <Link href="/groups">Your groups</Link>
      </Button>
    </KCard>
  );
}

function GroupSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <Skeleton className="h-5 w-20" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-[16px]" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="h-40 w-full rounded-[20px]" />
      <Skeleton className="h-28 w-full rounded-[20px]" />
    </div>
  );
}
