"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowLeft, CookingPot, DoorOpen, Refrigerator, RefreshCw, Scale, User, UsersRound } from "lucide-react";
import type { PublicMember, PublicOrganization } from "@saas/contracts/membership";
import type { KitchenSettings, UpdateKitchenSettingsRequest, WastePolicy } from "@saas/contracts/kitchen";
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
import { useGroups, useProfile } from "@/components/kitchen/data";
import {
  GROUP_CURRENCIES,
  WASTE_RULES,
  canManageGroup,
  roleFromAssignments,
  wasteRuleLabel,
  type GroupRole,
} from "@/components/kitchen/groups";
import { formatJoinCode, joinUrl } from "@/components/kitchen/join-code";
import {
  ComingSoonCard,
  GroupAvatar,
  KCard,
  K_BUTTON,
  RoleBadge,
  shortDate,
} from "@/components/kitchen/kit";

/**
 * One group (CP-5): who is in it and your role, the join link (owners and
 * admins copy and rotate it), the group's rules (waste rule and currency;
 * owners and admins edit), leaving, and honest "coming soon" cards for
 * activity, balances, pantry and dishes.
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

function GroupView({ group, onLeft }: { group: PublicOrganization; onLeft: () => void }) {
  const { client } = useSession();
  const profile = useProfile();
  // Only owners and admins may list members (organization.member.list); for
  // anyone else the API answers 404, which is also how the page learns the
  // person is a member rather than an owner or admin.
  const members = useApiQuery(qk.members(group.id), () =>
    wrap(async () => (await client.memberships.listMembers(group.id)).members),
  );
  const membersHidden = members.error?.code === "not_found";

  const myId = profile.data?.id ?? null;
  let role: GroupRole | null = null;
  if (members.data) {
    const me = myId ? members.data.find((m) => m.subjectId === myId) : undefined;
    // Listing succeeded, so the person is an owner or admin either way.
    role = (me && roleFromAssignments(me.roles)) || "admin";
  } else if (membersHidden) {
    role = "member";
  }
  const roleKnown = role !== null || (members.error !== null && !membersHidden);
  const manager = canManageGroup(role);

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
        <div className="space-y-5 min-[900px]:order-2">
          {manager ? <InviteCard group={group} /> : null}
          <RulesCard group={group} manager={manager} roleKnown={roleKnown} />
          <MembersCard
            members={members.data}
            loading={members.loading}
            hidden={membersHidden}
            error={membersHidden ? null : members.error}
            myId={myId}
          />
        </div>

        <div className="space-y-5 min-[900px]:order-1">
          <section aria-labelledby="group-coming" className="space-y-3">
            <h2 id="group-coming" className="text-lg font-bold tracking-tight">
              In this group
            </h2>
            <ComingSoonCard
              headingLevel={3}
              icon={Activity}
              tone="green"
              title="Activity"
              body="Every use, dish, bill and payment in the group, newest first."
            />
            <ComingSoonCard
              headingLevel={3}
              icon={Scale}
              tone="blue"
              title="Balances"
              body="Who owes whom in this group, with every amount explained."
            />
            <ComingSoonCard
              headingLevel={3}
              icon={Refrigerator}
              tone="neutral"
              title="Pantry"
              body="What the group has bought, and what to use first."
            />
            <ComingSoonCard
              headingLevel={3}
              icon={CookingPot}
              tone="tomato"
              title="Dishes"
              body="Dishes shared with the group, and who had how much."
            />
          </section>
          <LeaveCard group={group} onLeft={onLeft} />
        </div>
      </div>
    </div>
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
  members,
  loading,
  hidden,
  error,
  myId,
}: {
  members: PublicMember[] | null;
  loading: boolean;
  hidden: boolean;
  error: { message: string } | null;
  myId: string | null;
}) {
  const sorted = React.useMemo(() => {
    if (!members) return [];
    // You first, then by join date.
    return [...members].sort((a, b) =>
      a.subjectId === myId ? -1 : b.subjectId === myId ? 1 : a.joinedAt.localeCompare(b.joinedAt),
    );
  }, [members, myId]);

  return (
    <KCard className="p-5">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
        <UsersRound className="h-5 w-5 text-muted-foreground" aria-hidden />
        Members
      </h2>
      {loading ? (
        <div aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : hidden ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Owners and admins see who&apos;s in the group. Ask one of them for the join link to invite someone.
        </p>
      ) : error ? (
        <p className="mt-2 text-sm text-muted-foreground">Couldn&apos;t load the members. {error.message}</p>
      ) : (
        <ul className="mt-2 divide-y">
          {sorted.map((m) => {
            const role = roleFromAssignments(m.roles);
            const you = m.subjectId === myId;
            return (
              <li key={m.id} className="flex min-h-14 items-center gap-3 py-2">
                <span
                  aria-hidden
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                    you ? "bg-cp-herb-tint text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {you ? "You" : <User className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {you ? "You" : <span className="font-mono text-xs">{shortSubject(m.subjectId)}</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">Joined {shortDate(m.joinedAt)}</span>
                </span>
                {role ? <RoleBadge role={role} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </KCard>
  );
}

/** `usr_8h2k…`: enough of an id to tell members apart (the API has no names yet). */
function shortSubject(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

// ── Leave ──────────────────────────────────────────────────────────

function LeaveCard({ group, onLeft }: { group: PublicOrganization; onLeft: () => void }) {
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
    for (const key of [qk.members(group.id), qk.joinCode(group.id), qk.kitchenSettings(group.id)]) {
      qc.removeQueries({ queryKey: key });
    }
    void qc.invalidateQueries({ queryKey: qk.orgs() });
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
