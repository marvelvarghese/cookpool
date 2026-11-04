"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CircleCheck, CookingPot, Undo2 } from "lucide-react";
import type { KitchenDish } from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroups, useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, SoonBadge } from "@/components/kitchen/kit";
import { canManageGroup, canWriteInGroup, roleFromKitchen } from "@/components/kitchen/groups";
import { memberLabel } from "@/components/kitchen/members";
import { useMembersOf } from "@/components/kitchen/pantry-data";
import { useMemberNames } from "@/components/kitchen/people-data";
import { itemHref } from "@/components/kitchen/pantry";
import { useClaimer, useDish, useDishActions } from "@/components/kitchen/dish-data";
import { DishClaimChoices, DishCostCard, MoneyFlowCard, PortionStepper, WhoHadSomeList } from "@/components/kitchen/dish-ui";
import {
  OVER_CLAIMED,
  claimCount,
  claimableHalf,
  dishStateChip,
  dishSubtitle,
  dishWhen,
  halfOf,
  isSplitOpen,
  leftoverNote,
  moneyFlow,
  parseDishRef,
  sameShares,
  sharesOf,
  splitFor,
  whoHadSome,
  withHalf,
  type ShareDraft,
  type WhoRow,
} from "@/components/kitchen/dish";

/**
 * One dish (CP-17): what it cost (Total · Portions · Each, and every
 * ingredient with its pantry and buyer), who had how much, the leftovers, and
 * how it moves money — what the eaters owe the cook, what the cook owes the
 * buyers of what they took, and the two netted inside each group. A member
 * claims half portions in one tap ("How much did you have?", or the stepper on
 * their own row), with Undo; the cook (or an owner or admin) sets everyone's
 * portions, finalizes — a toast with "Correct it", no dialog — corrects a
 * finalized split, or cancels a dish still open. Open dishes are read again
 * every 20 seconds. The address is the plain id, `/dishes/dsh_…`, as the
 * dish-posted email links it.
 */
export default function DishPage() {
  const dishId = parseDishRef(usePathParam("/dishes/:dishRef", "dishRef"));
  if (!dishId) return <DishNotFound />;
  return <DishLoader key={dishId} dishId={dishId} />;
}

function DishLoader({ dishId }: { dishId: string }) {
  const profile = useProfile();
  const dish = useDish(dishId);
  if (dish.loading || profile.loading) return <DishSkeleton />;
  if (dish.error?.code === "not_found") return <DishNotFound />;
  if (dish.error || !dish.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this dish. {dish.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={dish.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  return <DishView dish={dish.data} meId={profile.data?.id ?? null} />;
}

type EditMode = null | "assign" | "correct";

function DishView({ dish, meId }: { dish: KitchenDish; meId: string | null }) {
  const groups = useGroups();
  const group = dish.orgId ? (groups.data?.find((g) => g.id === dish.orgId) ?? null) : null;
  const groupNames = React.useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name] as const)), [groups.data]);
  const members = useMembersOf(dish.orgId);
  const names = useMemberNames(members.data);
  const now = React.useMemo(() => new Date(), []);

  // Your role in the dish's group. While it loads the write actions wait; if
  // the member list can't be read they show, and the server decides.
  const meMember = meId ? members.data?.find((m) => m.subjectId === meId) : undefined;
  const role = meMember ? roleFromKitchen(meMember.role) : null;
  const roleKnown = !dish.orgId || role !== null || members.error !== null || (members.data !== null && !meMember);
  const isCook = meId !== null && meId === dish.cook;
  // Splitting is the cook's; an owner or admin may also split, finalize or
  // correct someone else's dish (a stuck one), from a quieter card.
  const canSplit = isCook || (dish.orgId !== null && canManageGroup(role));
  const canClaim = dish.orgId !== null && meId !== null && roleKnown && (role === null || canWriteInGroup(role));
  const groupName = dish.orgId ? (group?.name ?? null) : null;
  const people = { meId, names, groupNames };

  // The cook's edit: everyone's portions (a draft dish is always being set),
  // or a correction of a finalized one. Untouched, it follows the dish as it
  // is read again.
  const [mode, setMode] = React.useState<EditMode>(null);
  const [draft, setDraft] = React.useState<ShareDraft[]>(() => sharesOf(dish));
  const [touched, setTouched] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const editing: EditMode = mode ?? (dish.state === "draft" && dish.orgId !== null && isCook ? "assign" : null);
  React.useEffect(() => {
    if (!touched) setDraft(sharesOf(dish));
  }, [dish, touched]);

  const startCorrecting = React.useCallback(() => {
    setDraft(sharesOf(dish));
    setTouched(false);
    setNote("");
    setMode("correct");
  }, [dish]);
  const claimer = useClaimer(dish, meId, names);
  const actions = useDishActions({ dish, meId, names, groupName, onCorrect: startCorrecting });
  const stopEditing = () => {
    setMode(null);
    setTouched(false);
    setDraft(sharesOf(dish));
    actions.setError(null);
  };

  // "Correct it" from a finalize toast elsewhere (Home) lands here with ?correct=1.
  const askedToCorrect = React.useRef(false);
  React.useEffect(() => {
    if (askedToCorrect.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("correct") !== "1") return;
    askedToCorrect.current = true;
    if (dish.state === "finalized" && canSplit) startCorrecting();
    params.delete("correct");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [dish.state, canSplit, startCorrecting]);

  // The shares on screen: the cook's edit, your claim on its way, or the dish's own.
  const saved = sharesOf(dish);
  const shares = editing ? draft : claimer.pending && meId ? withHalf(saved, meId, claimer.half) : saved;
  const dirty = editing !== null && !sameShares(draft, saved);
  const split = splitFor(dish, shares);
  const shared = dish.orgId !== null;
  // Everyone else in the group with nothing yet; viewers don't claim, so they
  // are listed only while the cook sets portions (they can be counted in).
  const others =
    shared && members.data
      ? members.data.filter((m) => editing !== null || roleFromKitchen(m.role) !== "viewer").map((m) => m.subjectId)
      : canClaim && dish.state === "open" && meId
        ? [meId]
        : [];
  const rows = whoHadSome({ dish, shares, split, others, editing: editing !== null, ...people });
  const count = claimCount(dish, split);
  const leftovers = leftoverNote({ dish, split, ...people });
  const flow = moneyFlow({ dish, split, ...people });
  const previewLabel = editing === "correct" ? "Until you post it" : dish.state === "finalized" || dish.state === "canceled" ? null : "Until finalized";

  const stepperFor = (row: WhoRow): React.ReactNode => {
    if (editing) {
      if (row.exactMinor !== null) return null;
      return (
        <PortionStepper
          value={row.half}
          max={dish.portionsHalf}
          who={row.isMe ? "you" : row.label}
          disabled={actions.busy !== null}
          onStep={(delta) => {
            setTouched(true);
            actions.setError(null);
            setDraft((cur) => withHalf(cur, row.subjectId, Math.max(0, Math.min(dish.portionsHalf, halfOf(cur, row.subjectId) + delta))));
          }}
        />
      );
    }
    if (dish.state === "open" && row.isMe && canClaim) {
      const max = claimableHalf(dish);
      return <PortionStepper value={claimer.half} max={max} who="you" onStep={(delta) => claimer.step(delta, max)} />;
    }
    return null;
  };

  const back = shared
    ? group
      ? { href: `/groups/${encodeURIComponent(group.slug)}?tab=dishes`, label: group.name }
      : { href: "/groups", label: "Groups" }
    : { href: "/home", label: "Home" };

  const startAssigning = () => {
    setDraft(sharesOf(dish));
    setTouched(false);
    setMode("assign");
  };
  const cookName = memberLabel(dish.cook, meId, names);

  const saveEdit = async () => {
    if (editing === "correct") {
      if (await actions.correct(draft, note)) stopEditing();
      return;
    }
    if (await actions.saveShares(draft)) {
      setTouched(false);
      if (dish.state === "open" || !isCook) setMode(null);
    }
  };

  return (
    <div className="space-y-5">
      <Link
        href={back.href}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {back.label}
      </Link>
      <header className="min-w-0">
        <h1 className="break-words text-[26px] font-extrabold leading-tight tracking-tight">{dish.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{dishSubtitle(dish, { ...people, now })}</p>
      </header>

      <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)] min-[900px]:items-start">
        <div className="min-w-0 space-y-5">
          <DishCostCard dish={dish} chip={dishStateChip(dish)} people={people} />

          {/* A member's one tap: how much they had. */}
          {shared && dish.state === "open" && !isCook && meId && !editing ? (
            !roleKnown ? (
              <Skeleton className="h-28 w-full rounded-[20px]" />
            ) : canClaim ? (
              <KCard className="p-4">
                <DishClaimChoices dish={dish} meId={meId} names={names} claimer={claimer} />
              </KCard>
            ) : (
              <KCard className="p-4 text-sm text-muted-foreground">
                You view {groupName ?? "this group"}, so you don&apos;t claim portions. The cook can count you in.
              </KCard>
            )
          ) : null}

          {shared ? (
            <section aria-labelledby="who-h" className="space-y-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 id="who-h" className="text-[17px] font-extrabold">
                  Who had some
                </h2>
                <span
                  className={cn(
                    "text-[13px] font-bold",
                    count.tone === "over" ? "text-cp-expired" : count.tone === "exact" ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {count.text}
                </span>
              </div>
              {editing ? (
                <p className="text-[13px] text-muted-foreground">
                  {editing === "correct"
                    ? "Set what everyone really had. Posting it reverses the old split and posts the new one."
                    : dish.state === "draft"
                      ? "Set how much everyone had, then finalize."
                      : "You're setting everyone's portions. Saving replaces their claims."}
                </p>
              ) : null}
              <WhoHadSomeList rows={rows} meId={meId} names={names} stepperFor={stepperFor} />
              {split.over ? (
                <p role="alert" className="rounded-[14px] bg-cp-expired-tint px-3.5 py-3 text-sm font-semibold text-cp-expired">
                  {OVER_CLAIMED}
                </p>
              ) : null}
              {leftovers ? (
                <p className="rounded-[14px] bg-muted px-3.5 py-3 text-sm text-foreground/80">
                  {leftovers}
                  {isCook && dish.state === "finalized" && dish.leftoverItemId && !editing ? (
                    <>
                      {" "}
                      <Link href={itemHref({ kind: "personal", itemId: dish.leftoverItemId })} className="font-semibold text-primary underline-offset-2 hover:underline">
                        Open Leftovers
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
              {isCook && dish.state === "open" && !editing ? (
                <button
                  type="button"
                  onClick={startAssigning}
                  className="min-h-11 rounded-xl px-1 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Set everyone&apos;s portions yourself
                </button>
              ) : null}
              {isCook && dish.state === "open" && dish.splitMode === "claims" && groupName ? (
                <p className="text-xs text-muted-foreground">{groupName} was emailed when you cooked, so everyone can claim theirs.</p>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-5">
          {dish.state === "canceled" ? (
            <KCard className="flex gap-3 p-5">
              <Undo2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Canceled {dish.canceledAt ? dishWhen(dish.canceledAt, now) : ""}. Every ingredient went back to its pantry, and what
                cooking charged was reversed. Nothing is owed for it.
              </p>
            </KCard>
          ) : (
            <MoneyFlowCard flow={flow} currency={dish.currency} previewLabel={previewLabel} />
          )}

          {dish.state === "finalized" && !editing ? (
            <div role="status" className="flex items-start gap-2.5 rounded-2xl bg-cp-herb-tint px-4 py-3.5 text-[15px] font-bold text-primary">
              <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <span>
                {shared
                  ? `Posted to ${groupName ?? "the group"}${dish.finalizedAt ? ` ${dishWhen(dish.finalizedAt, now)}` : ""}. Changing it later adds a correction; nothing is overwritten.`
                  : "Finalized. It was just for you, so nothing was split."}
              </span>
            </div>
          ) : null}

          {editing === "correct" ? (
            <div className="space-y-1.5">
              <Label htmlFor="correct-note" className="text-sm font-semibold">
                Why (optional)
              </Label>
              <Input
                id="correct-note"
                value={note}
                maxLength={500}
                placeholder="Dev had seconds"
                onChange={(e) => setNote(e.target.value)}
                className="h-11 rounded-xl"
              />
              <p className="text-xs text-muted-foreground">It goes on the reversal, so the group sees why the numbers changed.</p>
            </div>
          ) : null}

          {!isCook && canSplit && shared && dish.state !== "canceled" && !editing ? (
            <KCard className="space-y-3 p-4">
              <p className="text-sm text-muted-foreground">
                As {role === "owner" ? "an owner" : "an admin"} of {groupName ?? "the group"}, you can{" "}
                {isSplitOpen(dish) ? "set the portions and finalize" : "correct"} {cookName}&apos;s dish if it&apos;s{" "}
                {isSplitOpen(dish) ? "stuck" : "wrong"}.
              </p>
              <div className="flex flex-wrap gap-2">
                {isSplitOpen(dish) ? (
                  <>
                    <Button variant="outline" className={K_BUTTON} onClick={startAssigning} disabled={actions.busy !== null}>
                      Set portions
                    </Button>
                    <Button
                      variant="outline"
                      className={K_BUTTON}
                      loading={actions.busy === "finalize"}
                      disabled={claimer.pending || (actions.busy !== null && actions.busy !== "finalize")}
                      onClick={() => void actions.finalize()}
                    >
                      Finalize for {cookName}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className={K_BUTTON} onClick={startCorrecting}>
                    Correct it
                  </Button>
                )}
              </div>
            </KCard>
          ) : null}

          {isCook && isSplitOpen(dish) && !editing ? (
            confirmCancel ? (
              <KCard className="space-y-3 border-cp-expired/40 p-4">
                <p className="text-sm">
                  Canceling puts every ingredient back in its pantry and reverses what cooking charged, so nobody owes anything for
                  it. This can&apos;t be undone.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" className={K_BUTTON} onClick={() => setConfirmCancel(false)} disabled={actions.busy === "cancel"}>
                    Keep it
                  </Button>
                  <Button
                    variant="destructive"
                    className={K_BUTTON}
                    loading={actions.busy === "cancel"}
                    onClick={() => void actions.cancel().then((ok) => ok && setConfirmCancel(false))}
                  >
                    Cancel the dish
                  </Button>
                </div>
              </KCard>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                className="min-h-11 rounded-xl px-1 text-sm font-semibold text-cp-expired hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel this dish
              </button>
            )
          ) : null}
        </div>
      </div>

      {actions.error ? (
        <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
          {actions.error}
        </p>
      ) : null}

      <ActionBar>
        {editing === "correct" || (editing === "assign" && (dish.state === "open" || !isCook)) ? (
          <>
            <Button variant="outline" className={cn(K_BUTTON, "h-[52px] flex-1")} onClick={stopEditing} disabled={actions.busy !== null}>
              Cancel
            </Button>
            <Button
              className={cn(K_BUTTON, "h-[52px] flex-[1.4] text-base font-extrabold")}
              disabled={!dirty || split.over}
              loading={actions.busy === "shares" || actions.busy === "correct"}
              onClick={() => void saveEdit()}
            >
              {editing === "correct" ? "Post correction" : "Save portions"}
            </Button>
          </>
        ) : isSplitOpen(dish) && isCook ? (
          <>
            {shared && dish.state === "open" ? (
              // No reminder API yet (CP-18 emails the group at cook time): shown, honestly not clickable.
              <button
                type="button"
                aria-disabled="true"
                className="relative flex h-[52px] flex-1 cursor-not-allowed items-center justify-center whitespace-nowrap rounded-xl border border-input bg-card px-3 text-[15px] font-semibold text-muted-foreground"
              >
                Remind group
                <SoonBadge className="absolute -top-2.5 right-2 border bg-card" />
              </button>
            ) : dirty ? (
              <Button variant="outline" className={cn(K_BUTTON, "h-[52px] flex-1")} loading={actions.busy === "shares"} disabled={split.over || actions.busy !== null} onClick={() => void saveEdit()}>
                Save for later
              </Button>
            ) : null}
            <Button
              className={cn(K_BUTTON, "h-[52px] flex-[1.4] text-base font-extrabold")}
              disabled={split.over || claimer.pending || (actions.busy !== null && actions.busy !== "finalize")}
              loading={actions.busy === "finalize"}
              onClick={() => void actions.finalize(dirty ? draft : undefined).then((ok) => ok && setTouched(false))}
            >
              {shared ? "Finalize split" : "Finalize"}
            </Button>
          </>
        ) : dish.state === "finalized" && shared ? (
          <>
            {isCook ? (
              <Button variant="outline" className={cn(K_BUTTON, "h-[52px] flex-1")} onClick={startCorrecting}>
                Correct it
              </Button>
            ) : null}
            <Button asChild className={cn(K_BUTTON, "h-[52px] flex-[1.4] bg-foreground text-base font-extrabold text-background hover:bg-foreground/90")}>
              <Link href={group ? `/settle?group=${encodeURIComponent(group.slug)}` : "/settle"}>Settle up</Link>
            </Button>
          </>
        ) : null}
      </ActionBar>
      {!shared && isSplitOpen(dish) && isCook ? (
        <p className="-mt-2 text-center text-xs text-muted-foreground">It&apos;s just for you, so finalizing only closes it: nothing is split.</p>
      ) : null}
    </div>
  );
}

/** The dish's actions, held above the tab bar on a phone and at the bottom of the column on a wide screen. */
function ActionBar({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 flex gap-2.5 rounded-[20px] border bg-card p-3 shadow-[0_8px_24px_rgba(23,32,27,0.14)] min-[900px]:bottom-6">
      {children}
    </div>
  );
}

function DishNotFound() {
  return (
    <KCard className="flex gap-4 p-5">
      <CookingPot className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-2">
        <h1 className="text-lg font-bold">This dish isn&apos;t here</h1>
        <p className="text-sm text-muted-foreground">
          It may be in a group you&apos;re not in, or the link is wrong. Dishes shared with your groups are on each group&apos;s Dishes tab.
        </p>
        <Button asChild variant="outline" className={K_BUTTON}>
          <Link href="/groups">Your groups</Link>
        </Button>
      </div>
    </KCard>
  );
}

function DishSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-44 w-full rounded-[22px]" />
      <Skeleton className="h-56 w-full rounded-[18px]" />
    </div>
  );
}
