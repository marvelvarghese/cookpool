"use client";

import * as React from "react";
import Link from "@/components/kitchen/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Crown, DoorOpen, MoreVertical, RefreshCw, Share2, ShieldCheck } from "lucide-react";
import type { PublicOrganization } from "@saas/contracts/membership";
import type {
  KitchenMember,
  KitchenSettings,
  UpdateKitchenSettingsRequest,
  WastePolicy,
} from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
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
  leaveBalance,
  roleFromKitchen,
  wasteRuleLabel,
  type GroupRole,
  type LeaveBalance,
} from "@/components/kitchen/groups";
import { roleWords } from "@/components/kitchen/group-page";
import { formatJoinCode, joinUrl } from "@/components/kitchen/join-code";
import { KCard, K_BUTTON } from "@/components/kitchen/kit";
import { BackButton } from "@/components/kitchen/back-ui";
import { refreshLedger, useBalances, useGroupRole } from "@/components/kitchen/ledger-data";
import { Face } from "@/components/kitchen/faces-ui";
import { Segmented } from "@/components/kitchen/ledger-ui";
import { memberLabel, type MemberNames } from "@/components/kitchen/members";
import { useMemberNames } from "@/components/kitchen/people-data";
import { useKitchenRouter } from "@/components/kitchen/transition-ui";

/**
 * A group's settings (SM-11): everything that is not everyday, off the
 * group's page and behind its one Settings entry — the invite (owners and
 * admins: the code, Copy link, Share, a new link), what happens to food that
 * goes off and the currency (owners and admins change them; Save appears
 * once something changed), who is in it (owners make someone an owner or
 * admin), and Leave. Short labels, no explanations: the confirm dialogs keep
 * the one line each that a step you can't undo needs.
 */
export default function GroupSettingsPage() {
  const slug = usePathParam("/groups/:orgSlug/settings", "orgSlug");
  const groups = useGroups();
  const group = groups.data?.find((g) => g.slug === slug) ?? null;
  const foundSlug = group?.slug ?? null;
  // Set once the person leaves, so the page does not flash "not in this
  // group" while the router moves to /groups.
  const [left, setLeft] = React.useState(false);

  React.useEffect(() => {
    if (foundSlug) recordRecentGroup(foundSlug);
  }, [foundSlug]);

  if (left || groups.loading || (!group && groups.fetching)) return <SettingsSkeleton />;
  if (groups.error) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this group.</p>
        <Button variant="outline" className={K_BUTTON} onClick={groups.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  if (!group) return <NotInGroup />;
  return <SettingsView group={group} onLeft={() => setLeft(true)} />;
}

function SettingsView({ group, onLeft }: { group: PublicOrganization; onLeft: () => void }) {
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const { members, role, roleKnown, manager } = useGroupRole(group.id, myId);
  const names = useMemberNames(members.data);
  const balances = useBalances(group.id);

  return (
    <div className="space-y-4">
      <header className="flex min-h-11 items-center gap-1">
        <BackButton />
        <h1 className="min-w-0 flex-1 truncate text-[26px] font-extrabold leading-tight tracking-tight">Settings</h1>
      </header>

      <div className="grid gap-4 min-[900px]:grid-cols-2 min-[900px]:items-start">
        <div className="min-w-0 space-y-4">
          {manager ? <InviteCard group={group} /> : null}
          <RulesCard group={group} manager={manager} roleKnown={roleKnown} />
        </div>
        <div className="min-w-0 space-y-4">
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
          <LeaveCard
            group={group}
            onLeft={onLeft}
            owner={role === "owner"}
            myBalance={
              myId && balances.data
                ? { balanceMinor: balances.data.balances.find((b) => b.subjectId === myId)?.balanceMinor ?? 0, currency: balances.data.currency }
                : null
            }
          />
        </div>
      </div>
    </div>
  );
}

const CARD_TITLE = "text-base font-extrabold tracking-tight";

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
    toast({ kind: "success", title: "New join link ready" });
  };

  // The phone's own share sheet, where there is one (WhatsApp is where a flat's link goes).
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const share = () => {
    if (!link) return;
    void navigator.share({ title: group.name, url: link }).catch(() => undefined);
  };

  return (
    <KCard className="p-4">
      <h2 className={CARD_TITLE}>Invite</h2>
      {code.loading ? (
        <Skeleton className="mt-3 h-11 w-full rounded-xl" />
      ) : code.error ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the link.</p>
          <Button variant="outline" className={K_BUTTON} onClick={code.reload}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {/* The code, never the wrapping link: the buttons carry the link. */}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="whitespace-nowrap font-mono text-[22px] font-bold tracking-wider">
              <span className="sr-only">Join code </span>
              {code.data ? formatJoinCode(code.data) : ""}
            </p>
            <Button variant="ghost" className={cn(K_BUTTON, "shrink-0 px-3")} onClick={() => setConfirmRotate(true)}>
              <RefreshCw aria-hidden />
              New
            </Button>
          </div>
          <div className={cn("mt-2 grid gap-2", canShare && "grid-cols-2")}>
            <CopyButton value={link} label="Copy link" copiedLabel="Copied" className="h-11 w-full rounded-xl px-4 text-[15px] font-semibold" />
            {canShare ? (
              <Button className={cn(K_BUTTON, "w-full")} onClick={share}>
                <Share2 aria-hidden />
                Share
              </Button>
            ) : null}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Make a new join link?"
        description="The old link stops working."
        confirmLabel="Make a new link"
        onConfirm={rotate}
      />
    </KCard>
  );
}

// ── Rules ──────────────────────────────────────────────────────────

/** What happens to food that goes off, and the currency: owners and admins change them. */
function RulesCard({ group, manager, roleKnown }: { group: PublicOrganization; manager: boolean; roleKnown: boolean }) {
  const { client } = useSession();
  const settings = useApiQuery(qk.kitchenSettings(group.id), () => wrap(() => client.kitchen.getSettings(group.id)));

  return (
    <KCard className="p-4">
      {settings.loading || !roleKnown ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      ) : settings.error || !settings.data ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the rules.</p>
          <Button variant="outline" className={K_BUTTON} onClick={settings.reload}>
            Try again
          </Button>
        </div>
      ) : manager ? (
        <RulesForm group={group} settings={settings.data} reload={settings.reload} />
      ) : (
        <dl className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <dt className={CARD_TITLE}>Food that goes off</dt>
            <dd className="text-[15px] text-muted-foreground">{wasteRuleLabel(settings.data.wastePolicy)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className={CARD_TITLE}>Currency</dt>
            <dd className="text-[15px] text-muted-foreground">{settings.data.currency}</dd>
          </div>
        </dl>
      )}
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
        toast({ kind: "warning", title: "The currency is already set" });
        reload();
        return;
      }
      toast({ kind: "error", title: "Couldn't save", description: r.error.message });
      return;
    }
    qc.setQueryData(qk.kitchenSettings(group.id), r.data);
    toast({ kind: "success", title: "Saved" });
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-2">
        <h2 id={`waste-${group.id}`} className={CARD_TITLE}>
          Food that goes off
        </h2>
        <Segmented
          label="Food that goes off"
          value={waste}
          options={WASTE_RULES.map((r) => ({ id: r.id, label: r.label }))}
          onChange={setWaste}
        />
      </div>

      {currencyLocked ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className={CARD_TITLE}>Currency</h2>
          <p className="text-[15px] text-muted-foreground">{settings.currency}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={`currency-${group.id}`} className={CARD_TITLE}>
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
          {/* The one hint here: saving fixes it. */}
          <p id={`currency-${group.id}-hint`} className="text-xs text-muted-foreground">
            Fixed once saved
          </p>
        </div>
      )}

      {dirty ? (
        <Button type="submit" className={cn(K_BUTTON, "w-full")} loading={busy}>
          Save
        </Button>
      ) : null}
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
    <KCard className="scroll-mt-6 p-4" id="group-members">
      <h2 className={CARD_TITLE}>
        People
        {members ? <span className="font-semibold text-muted-foreground"> · {members.length}</span> : null}
      </h2>
      {loading ? (
        <div aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : error || !members ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load who&apos;s in it.</p>
          <Button variant="outline" className={K_BUTTON} onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <ul className="mt-1 divide-y">
          {sorted.map((m) => {
            const role = roleFromKitchen(m.role);
            const words = roleWords(role);
            const label = memberLabel(m.subjectId, myId, names);
            const you = m.subjectId === myId;
            // Owners hand over ownership (or make an admin); never of themselves.
            const canPromote = myRole === "owner" && !you && m.memberId !== null && role !== "owner";
            const who = (
              <>
                <Face subjectId={m.subjectId} meId={myId} names={names} className="h-9 w-9 text-xs" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{label}</span>
              </>
            );
            return (
              <li key={m.subjectId} className="flex min-h-[52px] items-center gap-2 py-1">
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
                {words ? <span className="shrink-0 text-[13px] font-semibold text-muted-foreground">{words}</span> : null}
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
                  // Keeps the role words in one column beside rows that have a menu.
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
    body: () => "They can do everything you can. You stay an owner.",
    done: "an owner",
  },
  admin: {
    title: (name) => `Make ${name} an admin?`,
    body: () => "They can change the link and the rules, and record or undo anyone's entries.",
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

/**
 * Leaving is the one place a confirm stays (it can't be undone). It is
 * refused while you are the last owner (CP-3) or while your balance in the
 * group isn't zero (CP-19's `balance_not_settled`): the card then says how
 * much and which way, with Settle up — and the dialog warns before you try,
 * when the balance the page has isn't zero (CP-23).
 */
function LeaveCard({
  group,
  onLeft,
  owner,
  myBalance,
}: {
  group: PublicOrganization;
  onLeft: () => void;
  owner: boolean;
  /** Your balance in the group as this page read it; null while unknown. */
  myBalance: { balanceMinor: number; currency: string } | null;
}) {
  const { client } = useSession();
  const qc = useQueryClient();
  const router = useKitchenRouter();
  const { toast } = useToast();
  const [confirm, setConfirm] = React.useState(false);
  const [lastOwner, setLastOwner] = React.useState(false);
  const [unsettled, setUnsettled] = React.useState<LeaveBalance | null>(null);
  const owing = myBalance && myBalance.balanceMinor !== 0 ? leaveBalance(group, myBalance) : null;

  const leave = async () => {
    setLastOwner(false);
    setUnsettled(null);
    const r = await wrap(() => client.memberships.leave(group.id, { idempotencyKey: crypto.randomUUID() }));
    if (!r.ok) {
      if (r.error.reason === "last_owner") {
        setLastOwner(true);
        return;
      }
      if (r.error.reason === "balance_not_settled") {
        setUnsettled(leaveBalance(group, r.error.details));
        // The page's balances may be behind: read them again.
        refreshLedger(qc, group.id);
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
    <div className="space-y-2">
      {lastOwner ? (
        <div role="alert" className="rounded-xl bg-cp-soon-tint p-3 text-sm font-semibold text-cp-soon">
          <p>You&apos;re the last owner. Make someone else an owner first.</p>
          {owner ? (
            <a
              href="#group-members"
              className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-lg font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              People
              <ChevronRight className="h-4 w-4" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}
      {unsettled ? (
        <div role="alert" className="rounded-xl bg-cp-soon-tint p-3 text-sm text-cp-soon">
          <p className="font-bold">{unsettled.title}</p>
          <Link
            href={unsettled.settleHref}
            className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-lg font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Settle up
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      ) : null}
      <Button
        variant="outline"
        className={cn(K_BUTTON, "w-full border-destructive/40 text-destructive hover:bg-cp-expired-tint hover:text-destructive")}
        onClick={() => setConfirm(true)}
      >
        <DoorOpen aria-hidden />
        Leave {group.name}
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Leave ${group.name}?`}
        description={
          owing ? (
            <>
              <span className="block font-semibold text-foreground">{owing.title}.</span>
              <Link href={owing.settleHref} className="font-semibold text-primary underline underline-offset-2">
                Settle up first
              </Link>
            </>
          ) : (
            "To come back you'll need its join link."
          )
        }
        confirmLabel="Leave group"
        onConfirm={leave}
      />
    </div>
  );
}

// ── States ─────────────────────────────────────────────────────────

function NotInGroup() {
  return (
    <KCard className="flex flex-col items-center px-6 py-10 text-center">
      <h1 className="text-lg font-bold tracking-tight">You&apos;re not in this group</h1>
      <Button asChild className={cn(K_BUTTON, "mt-4")}>
        <Link href="/groups">Your groups</Link>
      </Button>
    </KCard>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-11 w-40" />
      <Skeleton className="h-32 w-full rounded-[20px]" />
      <Skeleton className="h-40 w-full rounded-[20px]" />
    </div>
  );
}
