"use client";

import * as React from "react";
import Link from "@/components/kitchen/link";
import { useSearchParams } from "next/navigation";
import { CookingPot, MoreHorizontal } from "lucide-react";
import type { KitchenDish } from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
import { cn } from "@/lib/cn";
import { shareKey, shareTarget } from "@/lib/transitions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroups, useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, K_BUTTON_QUIET } from "@/components/kitchen/kit";
import { BackButton } from "@/components/kitchen/back-ui";
import { canManageGroup, canWriteInGroup, roleFromKitchen } from "@/components/kitchen/groups";
import { memberLabel, sortMembers } from "@/components/kitchen/members";
import { useMembersOf } from "@/components/kitchen/pantry-data";
import { useMemberNames } from "@/components/kitchen/people-data";
import { itemHref } from "@/components/kitchen/pantry";
import { useDish, useDishActions, usePortions } from "@/components/kitchen/dish-data";
import { DishChipPill, DishMoney, MoneyLines, PortionStepper, WhoHadSomeList } from "@/components/kitchen/dish-ui";
import { groupTabHref } from "@/components/kitchen/group-page";
import { settleHref } from "@/components/kitchen/money-page";
import { newFrame } from "@/lib/features";
import { offersSaveAsRecipe } from "@/components/kitchen/recipes";
import { SaveAsRecipeButton } from "@/components/kitchen/recipe-ui";
import { offersShare } from "@/components/kitchen/community-share";
import { DishShareButton, ShareCookSheet, useSharedPost } from "@/components/kitchen/community-share-ui";
import { COOKED_PARAM, SPLIT_PARAM, cookedActions, dishNextActions, showsCooked, splitParam } from "@/components/kitchen/cooked";
import { CookedScreen, NextActionList, SplitSheet } from "@/components/kitchen/cooked-ui";
import { useDeletePost } from "@/components/kitchen/community-posts-data";
import { useKitchenRouter } from "@/components/kitchen/transition-ui";
import {
  OVER_CLAIMED,
  claimCount,
  dishByline,
  dishMoneySummary,
  dishStateChip,
  halfOf,
  isSplitOpen,
  leftoverNote,
  moneyFlow,
  parseDishRef,
  portionsLeft,
  sameShares,
  sharesOf,
  splitFor,
  whoHadSome,
  withHalf,
  type CountTone,
  type ShareDraft,
  type WhoRow,
} from "@/components/kitchen/dish";

/**
 * One dish (CP-17; SM-10 as the canvas's "Simpler — Dish" draws it): its
 * name, who cooked it and what a portion costs, one status word; one count
 * ("2 of 5 left") over a bar; who had some, a row each, any member stepping
 * anyone's portion while it is open (SM-7, with Undo; "by Anu" when someone
 * else set it); the money in at most two lines, the rest behind Details; and
 * one main button — the cook's Finalize, or Settle up once it is final. What
 * an owner or admin may do to someone else's stuck dish (set portions,
 * finalize, correct), and the cook's Cancel and Correct it, sit behind one
 * "…" menu at the top. Open dishes are read again every 20 seconds. The
 * address is the plain id, `/dishes/dsh_…`, as the dish-posted email links it.
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
        <Button variant="ghost" className={K_BUTTON_QUIET} onClick={dish.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  return <DishView dish={dish.data} meId={profile.data?.id ?? null} />;
}

type EditMode = null | "assign" | "correct";

const COUNT_TONES: Record<CountTone, string> = {
  over: "text-cp-expired",
  exact: "text-primary",
  under: "text-foreground",
};

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
  // correct someone else's dish (a stuck one), from the "…" menu.
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
  const portions = usePortions(dish, meId, names);
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

  // Share this cook? (cookpool-community CM-6): the cook's own dish that
  // isn't canceled, in the new frame — from Cooked!'s Post to Community, the
  // page's Post, or `?share=1`. Since CM-9 posting is its own action: a group
  // dish no longer waits for Finalize.
  const canShare = offersShare(newFrame(), dish, meId);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [sharedPost, setSharedPost] = useSharedPost(dish.id);
  // Undo on Cooked!'s Posted row (RV-16): the post goes; its toast can put it back.
  const deletePost = useDeletePost();
  const askedToShare = React.useRef(false);
  React.useEffect(() => {
    if (askedToShare.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("share") !== "1") return;
    askedToShare.current = true;
    if (canShare) setShareOpen(true);
    params.delete("share");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [canShare]);

  // Cooked, then post or split (cookpool-community CM-9): Finish lands on
  // Cooked! here (`?cooked=1`); Split with a group opens from it, from the
  // page's Split, or from Home's reminder (`?split=1`, `?split=org_…` to
  // suggest that group).
  const params = useSearchParams();
  const router = useKitchenRouter();
  const cooked = showsCooked(newFrame(), params?.get(COOKED_PARAM) === "1", dish, meId);
  const next = dishNextActions(newFrame(), dish, meId, sharedPost);
  const [splitOpen, setSplitOpen] = React.useState(false);
  const [splitHint, setSplitHint] = React.useState<string | null>(null);
  const askedToSplit = React.useRef(false);
  React.useEffect(() => {
    if (askedToSplit.current || typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const asked = splitParam(query.get(SPLIT_PARAM));
    if (!asked.open) return;
    askedToSplit.current = true;
    if (next.split) {
      setSplitHint(asked.orgId);
      setSplitOpen(true);
    }
    query.delete(SPLIT_PARAM);
    const qs = query.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [next.split]);

  // The shares on screen: the cook's edit, or the dish's own (a portion on its
  // way is in it already: SM-5's patch of the cached dish).
  const saved = sharesOf(dish);
  const shares = editing ? draft : saved;
  const dirty = editing !== null && !sameShares(draft, saved);
  const split = splitFor(dish, shares);
  const shared = dish.orgId !== null;
  // Everyone in the group, you first, then by name — viewers too: they eat,
  // and anyone may count them in (SM-6). Each keeps their row as portions change.
  const roster = React.useMemo(
    () => (members.data ? sortMembers(members.data.map((m) => m.subjectId), meId, names) : null),
    [members.data, meId, names],
  );
  const others = shared ? (roster ?? (canClaim && dish.state === "open" && meId ? [meId] : [])) : [];
  const rows = whoHadSome({ dish, shares, split, others, editing: editing !== null, ...people });
  // Anyone (not a viewer) steps anyone's portion while the dish is open.
  const stepping = shared && dish.state === "open" && editing === null && canClaim;
  // One count: what is left of an open dish, else how much was had.
  const count = dish.state === "open" && editing === null ? portionsLeft(dish, split) : claimCount(dish, split);
  const hadHalf = Math.min(split.claimedHalf, dish.portionsHalf);
  const leftovers = leftoverNote({ dish, split, ...people });
  const flow = moneyFlow({ dish, split, ...people });
  const summary = dishMoneySummary({ dish, split, ...people });

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
    if (stepping && row.exactMinor === null) {
      return (
        <PortionStepper
          value={portions.halfOf(row.subjectId)}
          max={portions.limitOf(row.subjectId)}
          who={row.isMe ? "you" : row.label}
          onStep={(delta) => portions.step(row.subjectId, delta)}
        />
      );
    }
    return null;
  };

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

  // Everything but the one main button, behind "…" (SM-10): an owner's or
  // admin's way into someone else's stuck dish, and the cook's Cancel and Correct it.
  const menu: { key: string; label: string; onSelect: () => void; destructive?: boolean; disabled?: boolean }[] = [];
  if (!editing && dish.state !== "canceled") {
    if (isCook) {
      if (isSplitOpen(dish)) menu.push({ key: "cancel", label: "Cancel dish", onSelect: () => setConfirmCancel(true), destructive: true });
      else if (shared) menu.push({ key: "correct", label: "Correct it", onSelect: startCorrecting });
    } else if (canSplit && shared) {
      if (dish.state === "draft") menu.push({ key: "assign", label: "Set portions", onSelect: startAssigning });
      if (isSplitOpen(dish)) {
        menu.push({
          key: "finalize",
          label: `Finalize for ${cookName}`,
          onSelect: () => void actions.finalize(),
          disabled: portions.pending || actions.busy !== null,
        });
      } else menu.push({ key: "correct", label: "Correct it", onSelect: startCorrecting });
    }
  }

  // The cook's Finalize carries the money line with it (SM-15): held above the
  // tab bar, it never sits over the line it acts on.
  const finalizing = !editing && isSplitOpen(dish) && isCook;

  const sheets = (
    <>
      {newFrame() && isCook && (shareOpen || canShare) ? (
        <ShareCookSheet dish={dish} groupName={groupName} open={shareOpen} onClose={() => setShareOpen(false)} onPosted={setSharedPost} />
      ) : null}
      {splitOpen && meId && isCook ? (
        <SplitSheet dish={dish} meId={meId} hint={splitHint} onClose={() => setSplitOpen(false)} onSplit={() => setSplitOpen(false)} />
      ) : null}
    </>
  );

  if (cooked) {
    return (
      <>
        <CookedScreen
          dish={dish}
          postId={sharedPost}
          groupName={groupName}
          groupNames={groupNames}
          onPost={() => setShareOpen(true)}
          onSplit={() => {
            setSplitHint(null);
            setSplitOpen(true);
          }}
          onDone={() => router.replace("/home")}
          onUnpost={
            sharedPost
              ? () => {
                  const id = sharedPost;
                  setSharedPost(null);
                  deletePost({ id, title: dish.name });
                }
              : undefined
          }
        />
        {sheets}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <BackButton known={{ groupSlug: group?.slug ?? null }} />
        {menu.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More"
              className="-mr-2 grid h-11 w-11 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="h-6 w-6" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48 rounded-xl p-1.5">
              {menu.map((m) => (
                <DropdownMenuItem
                  key={m.key}
                  onSelect={m.onSelect}
                  disabled={m.disabled ?? false}
                  className={cn("min-h-11 rounded-lg px-3 text-[15px] font-medium", m.destructive && "text-cp-expired focus:text-cp-expired")}
                >
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <header className="min-w-0 space-y-1">
        {/* Where a tapped dish card's title lands (RC-11's page transitions). */}
        <h1 {...shareTarget(shareKey("dish", dish.id), "title")} className="break-words text-[26px] font-medium leading-tight tracking-[-0.02em]">
          {dish.name}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-normal text-muted-foreground">
          <span className="tabular-nums">{dishByline(dish, people)}</span>
          <DishChipPill chip={dishStateChip(dish)} />
        </p>
      </header>

      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)] min-[900px]:items-start">
        <div className="min-w-0 space-y-4">
          {shared ? (
            <>
              <div className="space-y-2">
                <p className={cn("text-[15px] font-medium tabular-nums", COUNT_TONES[count.tone])}>{count.text}</p>
                <PortionBar half={hadHalf} of={dish.portionsHalf} over={count.tone === "over"} />
              </div>
              <WhoHadSomeList rows={rows} meId={meId} names={names} stepperFor={stepperFor} />
              {split.over ? (
                <p role="alert" className="rounded-[14px] bg-cp-expired-tint px-3.5 py-3 text-sm font-normal text-cp-expired">
                  {OVER_CLAIMED}
                </p>
              ) : null}
              {/* While it is open, what is left shows once: in the count. */}
              {leftovers && (dish.state !== "open" || editing) ? (
                <p className="px-1 text-sm font-normal text-muted-foreground tabular-nums">
                  {leftovers}
                  {isCook && dish.state === "finalized" && dish.leftoverItemId && !editing ? (
                    <>
                      {" · "}
                      <Link href={itemHref({ kind: "personal", itemId: dish.leftoverItemId })} className="font-medium text-primary underline-offset-2 hover:underline">
                        Open
                      </Link>
                    </>
                  ) : null}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4">
          {editing === "correct" ? (
            <div className="space-y-1.5">
              <Label htmlFor="correct-note" className="text-sm font-normal">
                Why? (optional)
              </Label>
              <Input
                id="correct-note"
                value={note}
                maxLength={500}
                placeholder="Dev had seconds"
                onChange={(e) => setNote(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
          ) : null}
          <DishMoney dish={dish} summary={finalizing ? [] : summary} flow={flow} people={people} now={now} />
          {/* The new frame (cookpool-recipes RC-5): a dish that was cooked becomes a recipe of yours. */}
          {!editing && offersSaveAsRecipe(newFrame(), dish) ? <SaveAsRecipeButton dishId={dish.id} /> : null}
          {/* Post and Split, whichever isn't done yet, in any order (CM-9); See your post once posted. */}
          {!editing && (next.post === "offer" || next.split) ? (
            <NextActionList
              actions={cookedActions({ postId: null, orgId: null, groupName: null }).filter((a) => (a.id === "post" ? next.post === "offer" : next.split))}
              postId={sharedPost}
              dishId={dish.id}
              onPost={() => setShareOpen(true)}
              onSplit={() => {
                setSplitHint(null);
                setSplitOpen(true);
              }}
            />
          ) : null}
          {!editing && next.post === "posted" ? <DishShareButton postId={sharedPost} onShare={() => setShareOpen(true)} /> : null}
        </div>
      </div>

      {actions.error ? (
        <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
          {actions.error}
        </p>
      ) : null}

      <ActionBar above={finalizing && summary.length > 0 ? <MoneyLines summary={summary} /> : null}>
        {editing === "correct" || (editing === "assign" && (dish.state === "open" || !isCook)) ? (
          <>
            <Button variant="ghost" className={cn(K_BUTTON_QUIET, "h-[52px] flex-1")} onClick={stopEditing} disabled={actions.busy !== null}>
              Cancel
            </Button>
            <Button
              className={cn(K_BUTTON, "h-[52px] flex-[1.4] text-base font-medium")}
              disabled={!dirty || split.over}
              loading={actions.busy === "shares" || actions.busy === "correct"}
              onClick={() => void saveEdit()}
            >
              {editing === "correct" ? "Post correction" : "Save portions"}
            </Button>
          </>
        ) : isSplitOpen(dish) && isCook ? (
          <>
            {dirty ? (
              <Button variant="ghost" className={cn(K_BUTTON_QUIET, "h-[52px] flex-1")} loading={actions.busy === "shares"} disabled={split.over || actions.busy !== null} onClick={() => void saveEdit()}>
                Save for later
              </Button>
            ) : null}
            <Button
              className={cn(K_BUTTON, "h-[60px] flex-[1.4] rounded-[18px] text-[17px] font-medium")}
              disabled={split.over || portions.pending || (actions.busy !== null && actions.busy !== "finalize")}
              loading={actions.busy === "finalize"}
              onClick={() =>
                void actions.finalize(dirty ? draft : undefined).then((ok) => {
                  if (ok) setTouched(false);
                })
              }
            >
              Finalize
            </Button>
          </>
        ) : dish.state === "finalized" && shared ? (
          <Button asChild className={cn(K_BUTTON, "h-[60px] flex-1 rounded-[18px] text-[17px] font-medium")}>
            <Link href={dishSettleHref(dish, meId, group?.slug ?? null)}>Settle up</Link>
          </Button>
        ) : null}
      </ActionBar>

      {sheets}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel ${dish.name}?`}
        description="Its ingredients go back to their pantries, and nobody owes for it."
        confirmLabel="Cancel dish"
        cancelLabel="Keep it"
        onConfirm={async () => {
          await actions.cancel();
        }}
      />
    </div>
  );
}

/** The count's bar: half portions had, out of all of them (decorative — the count says it). */
function PortionBar({ half, of, over }: { half: number; of: number; over: boolean }) {
  const segments = of > 0 && of <= 20;
  if (segments) {
    return (
      <div aria-hidden className="grid gap-1" style={{ gridTemplateColumns: `repeat(${of}, minmax(0, 1fr))` }}>
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={cn("h-2.5 rounded", i < half ? (over ? "bg-cp-expired" : "bg-primary") : "bg-border")} />
        ))}
      </div>
    );
  }
  const pct = of > 0 ? Math.min(100, Math.round((half * 100) / of)) : 0;
  return (
    <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-border">
      <div className={cn("h-full rounded-full", over ? "bg-cp-expired" : "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The one main button, at the end of the page and held above the tab bar
 * while the page is longer than the screen. It comes after everything you
 * choose, so scrolling to the end always shows every row above it.
 */
function ActionBar({ children, above }: { children: React.ReactNode; above?: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  // Opaque, so nothing shows through it half-covered (the audit's rows peeking out under the old fade).
  return (
    <div
      data-toast-above=""
      className="sticky bottom-[var(--cp-bottom-bar,calc(env(safe-area-inset-bottom)+5.25rem))] z-30 -mx-[var(--cp-gutter,1rem)] space-y-2 bg-background px-[var(--cp-gutter,1rem)] pb-2 pt-3 min-[900px]:bottom-6 min-[900px]:mx-0 min-[900px]:rounded-[22px] min-[900px]:border min-[900px]:px-4"
    >
      {above}
      <div className="flex gap-2.5">{children}</div>
    </div>
  );
}

function DishNotFound() {
  return (
    <KCard className="flex gap-4 p-5">
      <CookingPot className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-3">
        <h1 className="text-lg font-medium">This dish isn&apos;t here</h1>
        <Button asChild variant="ghost" className={K_BUTTON_QUIET}>
          <Link href="/groups">Your groups</Link>
        </Button>
      </div>
    </KCard>
  );
}

function DishSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-11 w-11 rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-72 w-full rounded-[22px]" />
    </div>
  );
}

/**
 * Settle up on a finalized group dish (RV-17's one settle path): someone who
 * ate pays the cook at `/money/settle`, back to the group; the cook, whom the
 * others pay, sees the group's Money tab (else Money).
 */
function dishSettleHref(dish: Pick<KitchenDish, "orgId" | "cook">, meId: string | null, groupSlug: string | null): string {
  const back = groupSlug ? `/groups/${encodeURIComponent(groupSlug)}` : null;
  if (dish.orgId && meId && dish.cook !== meId) return settleHref(dish.orgId, dish.cook, back);
  return groupSlug ? groupTabHref(groupSlug, "money") : "/money";
}
