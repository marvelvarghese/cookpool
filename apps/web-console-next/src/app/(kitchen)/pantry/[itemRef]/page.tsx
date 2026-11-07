"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CookingPot, Trash2, X } from "lucide-react";
import type { KitchenItem, KitchenStockMove } from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON } from "@/components/kitchen/kit";
import { BackButton } from "@/components/kitchen/back-ui";
import { useGroupRole } from "@/components/kitchen/ledger-data";
import type { MemberNames } from "@/components/kitchen/members";
import { useMemberNames, useMyRoles } from "@/components/kitchen/people-data";
import { GroupPickerList } from "@/components/kitchen/group-picker";
import type { GroupRole } from "@/components/kitchen/groups";
import {
  refreshPantry,
  undoRefusal,
  undoStockMove,
  useItemMoves,
  useKitchenItem,
  usePantries,
  useWasteItem,
} from "@/components/kitchen/pantry-data";
import { ShareList, StockBar, UseByPill } from "@/components/kitchen/pantry-ui";
import { MAIN_BUTTON } from "@/components/kitchen/faces-ui";
import { CountedAs } from "@/components/kitchen/measures-ui";
import {
  barTone,
  itemHref,
  itemRefParam,
  leftPercent,
  orderPantries,
  pantryChipLabel,
  pantryLabel,
  parseItemRef,
  quickUseHref,
  expiryChip,
  expiryText,
  type ItemRef,
} from "@/components/kitchen/pantry";
import { canUndoMove, historyRows, isUnused, itemFacts, keepAmountsTogether, transferNote, transferTargets, wastePreview } from "@/components/kitchen/item-use";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { cookHref } from "@/components/kitchen/dish-maker";
import { undoneToast } from "@/components/kitchen/undo";
import { usePrefetchKitchen } from "@/components/kitchen/prefetch";

/**
 * One item (CP-12; SM-15 under the seven rules, the canvas's MeasureItem):
 * its name and pantry; how much is left of what was bought, a bar, and one
 * line — worth now, its price once, who paid; "Counted as" (SM-14); Cook
 * with it and Wasted (with who pays) as quiet buttons, Move to a group for
 * your own item while none of it is used, and its history in the words each
 * use was given in; then one main button, **Use some**, held in thumb reach.
 * Uses and waste confirm by a ten-second Undo. The address names the item:
 * `/pantry/me:itm_…` (yours) or `/pantry/org:org_…:itm_…` (a group's).
 * Viewers see it all and change nothing.
 */
export default function ItemPage() {
  const ref = parseItemRef(usePathParam("/pantry/:itemRef", "itemRef"));
  if (!ref) return <ItemNotFound />;
  return <ItemLoader key={itemRefParam(ref)} itemRef={ref} />;
}

function ItemLoader({ itemRef }: { itemRef: ItemRef }) {
  const profile = useProfile();
  const item = useKitchenItem(itemRef);
  // Its history and its group's members start beside the item, not after it (SM-5).
  const prefetch = usePrefetchKitchen();
  const refParam = itemRefParam(itemRef);
  React.useEffect(() => {
    const ref = parseItemRef(refParam);
    if (ref) prefetch.item(ref);
  }, [refParam, prefetch]);
  if (item.loading || profile.loading) return <ItemSkeleton />;
  if (item.error?.code === "not_found") return <ItemNotFound />;
  if (item.error || !item.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this item. {item.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={item.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  const meId = profile.data?.id ?? null;
  return itemRef.kind === "group" ? (
    <GroupItem itemRef={itemRef} item={item.data} meId={meId} />
  ) : (
    <PersonalItem itemRef={itemRef} item={item.data} meId={meId} />
  );
}

function GroupItem({ itemRef, item, meId }: { itemRef: ItemRef & { kind: "group" }; item: KitchenItem; meId: string | null }) {
  const { members, role, roleKnown, canWrite } = useGroupRole(itemRef.orgId, meId);
  const names = useMemberNames(members.data);
  const roster = React.useMemo(() => (members.data ? members.data.map((m) => m.subjectId) : null), [members.data]);
  return <ItemView itemRef={itemRef} item={item} meId={meId} names={names} roster={roster} role={role} roleKnown={roleKnown} canWrite={canWrite} />;
}

function PersonalItem({ itemRef, item, meId }: { itemRef: ItemRef; item: KitchenItem; meId: string | null }) {
  const names = useMemberNames();
  return <ItemView itemRef={itemRef} item={item} meId={meId} names={names} roster={null} role={null} roleKnown canWrite />;
}

interface ItemCtx {
  itemRef: ItemRef;
  item: KitchenItem;
  meId: string | null;
  names: MemberNames;
  /** The group's members in its order (null for your own item, or while loading). */
  roster: readonly string[] | null;
  role: GroupRole | null;
  roleKnown: boolean;
  canWrite: boolean;
}

const STATE_LABEL: Record<KitchenItem["state"], string | null> = {
  active: null,
  used_up: "Used up",
  wasted: "Wasted",
  removed: "Removed",
};

function ItemView(ctx: ItemCtx) {
  const { item, roleKnown, canWrite } = ctx;
  const personal = item.pantry.kind === "personal";
  const live = item.state === "active" && item.qtyLeftMilli > 0;
  const stateLabel = STATE_LABEL[item.state];
  const canUseHere = live && roleKnown && canWrite;

  return (
    <div className="space-y-5">
      <BackButton />
      {/* The name and where it is (SM-15, the canvas's MeasureItem): category, who paid and the rest are one line below. */}
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="min-w-0 break-words text-[26px] font-extrabold leading-tight tracking-tight">{item.name}</h1>
        <span className={CHIP}>{pantryChipLabel(item.pantry)}</span>
        {stateLabel ? <span className={CHIP}>{stateLabel}</span> : null}
      </header>

      <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)] min-[900px]:items-start">
        <div className="min-w-0 space-y-5">
          <StockCard {...ctx} />
          {item.state === "active" ? <CountedAs item={item} canWrite={roleKnown && canWrite} /> : null}
          {live && roleKnown && !canWrite ? <p className="px-1 text-sm text-muted-foreground">You only view {pantryLabel(item.pantry)}.</p> : null}
        </div>

        <div className="min-w-0 space-y-5">
          {live && roleKnown && canWrite ? <ActionsCard {...ctx} /> : null}
          {personal && item.state === "active" ? <MoveCard {...ctx} /> : null}
          <HistoryCard {...ctx} />
        </div>
      </div>

      {/* One way to use an item (the audit's "two UIs for the same job"): Use some opens /use on it. */}
      {canUseHere ? (
        <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 min-[900px]:static min-[900px]:max-w-sm">
          <Button asChild className={cn(MAIN_BUTTON, "text-[17px] font-extrabold shadow-[0_8px_24px_rgba(23,32,27,0.18)] min-[900px]:shadow-none")}>
            <Link href={quickUseHref(item)}>Use some</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const CHIP = "inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-[13px] font-bold text-muted-foreground";

/** A quiet button beside the one main button: Cook with it, Wasted, Move to a group. */
const SECONDARY =
  "flex min-h-[50px] items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border border-input bg-card px-3 text-[15px] font-bold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ── Stock ──────────────────────────────────────────────────────────

/** What is left of what was bought, a bar, and the rest in one line (SM-15: the six-cell grid). */
function StockCard({ item, meId, names }: ItemCtx) {
  const chip = expiryChip(item);
  const long = expiryText(item);
  const facts = itemFacts(item, { meId, names });
  return (
    <section aria-label="Stock" className="space-y-3 rounded-[22px] border bg-card p-5">
      {chip && long ? <UseByPill chip={{ ...chip, label: long }} className="px-2.5 py-1" /> : null}
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[34px] font-extrabold leading-none tracking-tight tabular-nums">{facts.left}</span>
        <span className="text-[15px] text-muted-foreground">{facts.of}</span>
      </p>
      <StockBar percent={leftPercent(item)} tone={barTone(item)} thick />
      <p className="text-sm font-semibold tabular-nums text-muted-foreground">{facts.line}</p>
    </section>
  );
}

// ── Cook with it · Mark wasted ─────────────────────────────────────

function ActionsCard({ itemRef, item, meId, names, roster }: ItemCtx) {
  const wasteItem = useWasteItem();
  const [open, setOpen] = React.useState(false);
  const preview = wastePreview({ item, members: roster ?? [], meId, names });
  const waiting = item.pantry.kind === "group" && roster === null;

  // At once (SM-5): nothing left on screen and the Undo toast up before the
  // server answers; a refusal is put back and the toast says why.
  const waste = () => {
    setOpen(false);
    void wasteItem({ ref: itemRef, item, meId, idempotencyKey: crypto.randomUUID() });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        {/* The dish maker (CP-15), with this item already in the dish. */}
        <Link href={cookHref(itemRef)} className={SECONDARY}>
          <CookingPot className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          Cook with it
        </Link>
        <button type="button" aria-expanded={open} aria-controls="waste-preview" onClick={() => setOpen((o) => !o)} className={SECONDARY}>
          <Trash2 className="h-5 w-5 text-muted-foreground" aria-hidden />
          Wasted
        </button>
      </div>
      {open ? (
        <section id="waste-preview" aria-label="Waste preview" className="space-y-3 rounded-[22px] border bg-card p-5">
          <p className="text-[15px] font-bold">{preview.question}</p>
          {waiting ? (
            <Skeleton className="h-10 w-full" />
          ) : preview.lines.length > 0 && preview.lines.length <= 8 ? (
            <ShareList lines={preview.lines} currency={item.currency} />
          ) : (
            <p className="text-sm font-semibold text-muted-foreground">{preview.short ?? preview.explain}</p>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className={K_BUTTON} onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" className={K_BUTTON} disabled={waiting} onClick={waste}>
              Mark wasted
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ── Move to a group ────────────────────────────────────────────────

/**
 * Your own item, none of it used yet, into a group you add to: one quiet
 * button, then the groups, then a one-line confirm. Nothing shows once some
 * is used, or when no group can take it (SM-15: no sentences about why).
 */
function MoveCard({ itemRef, item }: ItemCtx) {
  const { client } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const pantries = usePantries();
  const { roles } = useMyRoles();
  const recentSlugs = useRecentGroupSlugs();
  const [picking, setPicking] = React.useState(false);
  const [target, setTarget] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const idemKey = React.useRef(crypto.randomUUID());
  const unused = isUnused(item);
  const targets = React.useMemo(
    () => transferTargets(orderPantries(pantries.data ?? [], recentSlugs), item, roles),
    [pantries.data, recentSlugs, item, roles],
  );
  const open = targets.filter((t) => !t.disabledReason);
  const chosen = open.find((t) => t.slug === target) ?? null;
  if (!unused || pantries.loading || open.length === 0) return null;

  const move = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    const r = await wrap(() =>
      client.kitchen.transferPersonalItem(itemRef.itemId, { orgId: chosen.orgId }, { idempotencyKey: idemKey.current }),
    );
    setBusy(false);
    if (!r.ok) {
      // A refusal is stored against its key at the edge: the next try needs a new one.
      if (r.status > 0 && r.status < 500) idemKey.current = crypto.randomUUID();
      refreshPantry(qc, null);
      if (r.error.reason === "item_used") setError("Some of it is used now, so it stays yours.");
      else if (r.error.reason === "currency_mismatch") setError(`${chosen.name} counts in ${String(r.error.details?.["currency"] ?? "another currency")}.`);
      else setError(r.error.message);
      return;
    }
    refreshPantry(qc, chosen.orgId);
    toast({ kind: "success", title: `Moved ${item.name} to ${chosen.name}` });
    router.replace(itemHref(r.data.item));
  };

  if (!picking) {
    return (
      <button type="button" onClick={() => setPicking(true)} className={cn(SECONDARY, "w-full")}>
        <ArrowRightLeft className="h-5 w-5 text-muted-foreground" aria-hidden />
        Move to a group
      </button>
    );
  }
  return (
    <section aria-labelledby="move-heading" className="space-y-3 rounded-[22px] border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="move-heading" className="text-[17px] font-extrabold">
          {chosen ? `Move to ${chosen.name}?` : "Move to"}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            setPicking(false);
            setTarget(null);
            setError(null);
          }}
          className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {chosen ? (
        <>
          <p className="text-sm font-semibold text-muted-foreground">{transferNote(item, chosen.name)}</p>
          {error ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className={K_BUTTON} onClick={() => setTarget(null)}>
              Back
            </Button>
            <Button type="button" variant="outline" className={cn(K_BUTTON, "border-primary text-primary")} loading={busy} onClick={() => void move()}>
              Move
            </Button>
          </div>
        </>
      ) : (
        <GroupPickerList
          groups={open.map((t) => ({ id: t.orgId, name: t.name, slug: t.slug, createdAt: "" }))}
          idPrefix="move-item-group"
          onPick={(slug) => setTarget(slug)}
        />
      )}
    </section>
  );
}

// ── History ────────────────────────────────────────────────────────

function HistoryCard({ itemRef, item, meId, names, role, canWrite }: ItemCtx) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const moves = useItemMoves(itemRef);
  const [pending, setPending] = React.useState<string | null>(null);
  const personal = item.pantry.kind === "personal";
  const now = new Date();
  const rows = moves.data ? historyRows(moves.data, { item, meId, names, now }) : null;
  const byId = new Map((moves.data ?? []).map((m) => [m.id, m] as const));

  const undo = async (move: KitchenStockMove) => {
    setPending(move.id);
    const r = await undoStockMove(client, itemRef, move);
    setPending(null);
    refreshPantry(qc, itemRef.kind === "group" ? itemRef.orgId : null);
    toast(undoneToast(r.ok ? { ok: true, description: "It's back in the pantry." } : undoRefusal(r.error)));
  };

  return (
    <section aria-labelledby="history-heading" className="space-y-2.5">
      <h2 id="history-heading" className="text-[17px] font-extrabold">
        History
      </h2>
      {moves.loading ? (
        <KCard className="px-4" aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
        </KCard>
      ) : moves.error || !rows ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the history. {moves.error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={moves.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <ul className="divide-y rounded-[18px] border bg-card">
          {rows.map((row) => {
            const move = byId.get(row.id);
            const undoable = move && moves.data ? canUndoMove(move, moves.data, { meId, personal, role, canWrite }) : false;
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-semibold", row.undone && "text-muted-foreground line-through")}>{keepAmountsTogether(row.what)}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {keepAmountsTogether(row.when)}
                    {row.undone ? (
                      <>
                        {" · "}
                        <span className="font-semibold">Undone</span>
                      </>
                    ) : null}
                  </p>
                </div>
                {row.amount ? (
                  <span className={cn("shrink-0 text-sm font-bold tabular-nums", row.undone && "text-muted-foreground line-through")}>
                    {row.amount}
                  </span>
                ) : null}
                {undoable && move ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-primary"
                    loading={pending === move.id}
                    onClick={() => void undo(move)}
                  >
                    Undo
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Not found, loading ─────────────────────────────────────────────

function ItemNotFound() {
  return (
    <KCard className="flex flex-col items-center px-6 py-12 text-center">
      <h1 className="text-lg font-bold tracking-tight">This item isn&apos;t in a pantry you can see</h1>
      <Button asChild className={cn(K_BUTTON, "mt-5")}>
        <Link href="/pantry">Your pantries</Link>
      </Button>
    </KCard>
  );
}

function ItemSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="space-y-5">
          <Skeleton className="h-56 w-full rounded-[22px]" />
          <Skeleton className="h-72 w-full rounded-[22px]" />
        </div>
        <Skeleton className="h-48 w-full rounded-[22px]" />
      </div>
    </div>
  );
}
