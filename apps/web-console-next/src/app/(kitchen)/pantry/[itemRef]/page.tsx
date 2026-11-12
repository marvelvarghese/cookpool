"use client";

import * as React from "react";
import Link from "@/components/kitchen/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, ChevronDown, CookingPot, Trash2, X } from "lucide-react";
import type { KitchenItem, KitchenStockMove } from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, K_CARD, K_ROWS, K_SECTION } from "@/components/kitchen/kit";
import { SeeAllButton, pillClass } from "@/components/kitchen/new-home-parts-ui";
import { firstThree } from "@/components/kitchen/new-home-look";
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
  useUsuals,
  useWasteItem,
} from "@/components/kitchen/pantry-data";
import { usualFor } from "@/components/kitchen/quick-use";
import { ItemActionsRow, LevelRingCard, QuickUse, RunOutCard, WhoHadItCard } from "@/components/kitchen/item-page-ui";
import { StockBar, UseByPill } from "@/components/kitchen/pantry-ui";
import { WasteConfirm } from "@/components/kitchen/item-actions-ui";
import { SwipeRow } from "@/components/kitchen/row-gestures-ui";
import { MAIN_BUTTON } from "@/components/kitchen/faces-ui";
import { CountedAs } from "@/components/kitchen/measures-ui";
import { ItemNoteCard } from "@/components/kitchen/item-note-ui";
import { canEditNote, noteOf } from "@/components/kitchen/item-note";
import { useSetItemNote } from "@/components/kitchen/item-note-data";
import { newFrame } from "@/lib/features";
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
import { canSwipeUndoMove, canUndoMove, costPerText, historyRows, isUnused, itemFacts, keepAmountsTogether, transferNote, transferTargets } from "@/components/kitchen/item-use";
import { historyFace, itemSubtitle } from "@/components/kitchen/item-page";
import { Face } from "@/components/kitchen/faces-ui";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { cookHref } from "@/components/kitchen/dish-maker";
import { undoneToast } from "@/components/kitchen/undo";
import { usePrefetchKitchen } from "@/components/kitchen/prefetch";
import { askName } from "@/components/kitchen/ask-before-use";
import { ItemAskSetting } from "@/components/kitchen/ask-ui";
import { RowTagPill } from "@/components/kitchen/pantry-row-ui";

/**
 * One item (CP-12; SM-15 under the seven rules, the canvas's MeasureItem):
 * its name and pantry; how much is left of what was bought, a bar, and one
 * line — worth now, its price once, who paid; "Counted as" (SM-14); Cook
 * with it and Wasted (with who pays) as quiet buttons, Move to a group for
 * your own item while none of it is used, and its history in the words each
 * use was given in; then one main button, **Use some**, held in thumb reach.
 * Uses and waste confirm by a ten-second Undo. The address names the item:
 * `/pantry/me:itm_…` (yours) or `/pantry/org:org_…:itm_…` (a group's).
 * Viewers see it all and change nothing. In the new frame (RC-3) its note
 * sits under the stock, changed in place with the same ten-second Undo.
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
  // The new frame's page (cookpool-pantry PN-7): today's frame renders exactly as before.
  if (newFrame()) return <NewItemView {...ctx} />;
  return <TodayItemView {...ctx} />;
}

function TodayItemView(ctx: ItemCtx) {
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
          {newFrame() ? <NoteCard {...ctx} /> : null}
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
        <div data-toast-above="" className="sticky bottom-[var(--cp-bottom-bar,calc(env(safe-area-inset-bottom)+5.75rem))] z-30 min-[900px]:static min-[900px]:max-w-sm">
          <Button asChild className={cn(MAIN_BUTTON, "text-[17px] font-extrabold shadow-[0_8px_24px_rgba(23,32,27,0.18)] min-[900px]:shadow-none")}>
            <Link href={quickUseHref(item)}>Use some</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The new frame's item page (cookpool-pantry PN-7, design §5; cookpool-revamp
 * RV-15, the canvas's RvItem), top to bottom on a phone: the name over
 * "Flat 4B · Meera paid ₹68"; the ring card ("1 L of 2 L", "₹34 left"); the
 * use row (½ glass · 1 glass · 2 glasses · More); "Runs out Sun"; Who had
 * it (a face and an amount each); the history (a face first, three then See
 * all; stock checks read as such, a check's raise undoable); Got more ·
 * Finish it · Wasted (at once, with Undo), then Fix how much is left and
 * Cook with it; Measures and note, folded; Who can use it and Move to a
 * group. The use row and More are how you use it: there is no Use some
 * button here.
 */
function NewItemView(ctx: ItemCtx) {
  const { itemRef, item, meId, names, roster, roleKnown, canWrite } = ctx;
  const personal = item.pantry.kind === "personal";
  const live = item.state === "active" && item.qtyLeftMilli > 0;
  const stateLabel = STATE_LABEL[item.state];
  const canUseHere = live && roleKnown && canWrite;
  const usuals = useUsuals(canUseHere);
  const usual = usualFor(item.id, usuals.data);
  const moves = useItemMoves(itemRef);
  const parts = { itemRef, item, meId, names, roster, usual };
  // Ask before use (cookpool-pantry PN-9): "Ask Meera" when you must ask first.
  const ask = itemRef.kind === "group" ? askName(item, { names }) : null;

  // The board (RV-3, the canvas's RvItem): the name, one muted line, then the ring, how much to use,
  // the run-out line, Who had it, History (three, then See all), the actions, and Measures and note folded.
  return (
    <div className="space-y-[22px]">
      <header className="flex min-w-0 flex-col gap-1.5">
        <BackButton />
        <h1 className="min-w-0 break-words text-[28px] font-medium leading-tight tracking-[-0.02em]">{item.name}</h1>
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-normal text-muted-foreground">
          <span className="min-w-0 truncate tabular-nums">{itemSubtitle(item, { meId, names, state: stateLabel })}</span>
          {ask ? <RowTagPill tag={{ label: `Ask ${ask}`, tone: "ask" }} /> : null}
        </p>
      </header>

      <div className="grid gap-[22px] min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)] min-[900px]:items-start">
        <div className="min-w-0 space-y-[22px]">
          <LevelRingCard item={item} usual={usual} meId={meId} names={names} />
          {canUseHere ? <QuickUse {...parts} /> : null}
          <RunOutCard item={item} moves={moves.data ?? null} />
          <WhoHadItCard item={item} moves={moves.data ?? null} meId={meId} names={names} />
          <HistoryCard {...ctx} fresh />
        </div>

        <div className="min-w-0 space-y-[22px]">
          {live && roleKnown && !canWrite ? <p className="px-1 text-sm font-normal text-muted-foreground">You only view {pantryLabel(item.pantry)}.</p> : null}
          {roleKnown ? <ItemActionsRow {...parts} canWrite={canWrite} /> : null}
          <MeasuresAndNote>
            {item.priceMinor > 0 ? <p className="px-1 text-sm font-normal tabular-nums text-muted-foreground">{costPerText(item)}</p> : null}
            <NoteCard {...ctx} />
            {item.state === "active" ? <CountedAs item={item} canWrite={roleKnown && canWrite} /> : null}
          </MeasuresAndNote>
          {roleKnown && canWrite ? <ItemAskSetting item={item} roster={roster} meId={meId} names={names} role={ctx.role} /> : null}
          {personal && item.state === "active" ? <MoveCard {...ctx} /> : null}
        </div>
      </div>
    </div>
  );
}

/** "Measures and note" (the board): one folded card; opened, the item's note and how it is counted, each editable as before. */
function MeasuresAndNote({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <section className={cn(K_CARD, "overflow-hidden")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[54px] w-full items-center gap-2.5 px-4 text-left text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate">Measures and note</span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div id={id} className="space-y-4 px-3 pb-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}

const CHIP = "inline-flex shrink-0 items-center rounded-full bg-muted px-2.5 py-1 text-[13px] font-medium text-muted-foreground";

/** A quiet button beside the one main button: Cook with it, Wasted, Move to a group. */
const SECONDARY =
  "flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] bg-card px-3 text-[15px] font-medium text-foreground shadow-cp-card transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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

// ── Note (RC-3) ────────────────────────────────────────────────────

/** Its note: shown to whoever sees the item, changed by whoever may edit it (the API's rule), with Undo. */
function NoteCard({ item, meId, role, roleKnown, canWrite }: ItemCtx) {
  const setNote = useSetItemNote();
  const editable = roleKnown && canEditNote(item, { meId, role, canWrite });
  return (
    <ItemNoteCard
      // A new note from elsewhere (the server's answer, an Undo) starts the block afresh.
      key={noteOf(item) ?? ""}
      note={noteOf(item)}
      pantry={item.pantry.kind === "group" ? { kind: "group", name: item.pantry.name } : { kind: "personal" }}
      canEdit={editable}
      onSave={(note) => void setNote({ item, note })}
    />
  );
}

// ── Cook with it · Mark wasted ─────────────────────────────────────

function ActionsCard({ itemRef, item, meId, names, roster }: ItemCtx) {
  const wasteItem = useWasteItem();
  const [open, setOpen] = React.useState(false);

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
        <WasteConfirm id="waste-preview" item={item} roster={roster} meId={meId} names={names} onKeep={() => setOpen(false)} onWaste={waste} />
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
    <section aria-labelledby="move-heading" className={cn(K_CARD, "space-y-3 p-4")}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="move-heading" className={K_SECTION}>
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
          className="-mr-2 grid h-11 w-11 place-items-center rounded-[14px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {chosen ? (
        <>
          <p className="text-sm font-normal text-muted-foreground">{transferNote(item, chosen.name)}</p>
          {error ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" className={cn(pillClass("done"), "min-h-12")} onClick={() => setTarget(null)}>
              Back
            </button>
            <button type="button" className={cn(pillClass("main"), "min-h-12")} disabled={busy} aria-busy={busy || undefined} onClick={() => void move()}>
              Move
            </button>
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

function HistoryCard({ itemRef, item, meId, names, role, canWrite, fresh = false }: ItemCtx & { fresh?: boolean }) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const moves = useItemMoves(itemRef);
  const [pending, setPending] = React.useState<string | null>(null);
  const personal = item.pantry.kind === "personal";
  const now = new Date();
  // The new frame (PN-7) reads a stock check's moves as the check, and lets its raise be undone.
  const rows = moves.data ? historyRows(moves.data, fresh ? { item, meId, names, now, stockChecks: true } : { item, meId, names, now }) : null;
  const byId = new Map((moves.data ?? []).map((m) => [m.id, m] as const));
  // The new frame (RV-3, the board): three, then See all.
  const [all, setAll] = React.useState(false);
  const shown = rows ? (fresh ? firstThree(rows, all) : { rows, more: false, label: "" }) : null;

  const undo = async (move: KitchenStockMove) => {
    setPending(move.id);
    const r = await undoStockMove(client, itemRef, move);
    setPending(null);
    refreshPantry(qc, itemRef.kind === "group" ? itemRef.orgId : null);
    // A stock check's raise (PN-7) comes back off; anything else is back in the pantry.
    const back = fresh && move.kind === "adjust" ? "It's back to what Cookpool thought." : "It's back in the pantry.";
    toast(undoneToast(r.ok ? { ok: true, description: back } : undoRefusal(r.error)));
  };

  return (
    <section aria-labelledby="history-heading" className="space-y-2.5">
      <h2 id="history-heading" className={fresh ? K_SECTION : "text-[17px] font-extrabold"}>
        History
      </h2>
      {moves.loading ? (
        <KCard className="px-4" aria-hidden>
          <SkeletonRow />
          <SkeletonRow />
        </KCard>
      ) : moves.error || !shown ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the history. {moves.error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={moves.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <div className={fresh ? K_ROWS : "overflow-hidden rounded-[18px] border bg-card"}>
        <ul className={fresh ? "divide-y divide-cp-line" : "divide-y"}>
          {shown.rows.map((row) => {
            const move = byId.get(row.id);
            const can = fresh ? { meId, personal, role, canWrite, adjusts: true } : { meId, personal, role, canWrite };
            const undoable = move && moves.data ? canUndoMove(move, moves.data, can) : false;
            // Your own use or waste swipes left to the same Undo (PW-8); the button stays.
            const swipe = move && moves.data && pending !== move.id && canSwipeUndoMove(move, moves.data, can);
            return (
              <SwipeRow
                key={row.id}
                action={swipe && move ? { label: "Undo", tone: "undo", run: () => void undo(move) } : null}
                frontClassName={fresh ? "flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-3" : "flex items-center gap-3 px-4 py-3"}
              >
                {/* The board (RV-15): who it was, as a face, first; the money goes on the line under, not in a column. */}
                {fresh ? <Face subjectId={historyFace(move, item)} meId={meId} names={names} className={cn("h-[42px] w-[42px] text-sm font-medium", row.undone && "opacity-50")} /> : null}
                <div className="min-w-0 flex-1">
                  <p className={cn(fresh ? "truncate text-base font-medium" : "text-sm font-semibold", row.undone && "text-muted-foreground line-through")}>{keepAmountsTogether(row.what)}</p>
                  <p className={cn("text-[13px] text-muted-foreground", fresh && "truncate font-normal")}>
                    {keepAmountsTogether(row.when)}
                    {fresh && row.amount ? <span className="tabular-nums">{` · ${row.amount}`}</span> : null}
                    {row.undone ? (
                      <>
                        {" · "}
                        <span className={fresh ? "font-medium" : "font-semibold"}>Undone</span>
                      </>
                    ) : null}
                  </p>
                </div>
                {row.amount && !fresh ? (
                  <span className={cn("shrink-0 text-sm font-bold tabular-nums", row.undone && "text-muted-foreground line-through")}>
                    {row.amount}
                  </span>
                ) : null}
                {undoable && move ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={fresh ? cn(pillClass(), "h-11") : "min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-primary"}
                    loading={pending === move.id}
                    onClick={() => void undo(move)}
                  >
                    Undo
                  </Button>
                ) : null}
              </SwipeRow>
            );
          })}
        </ul>
        {shown.more ? <SeeAllButton label={shown.label} all={all} onToggle={() => setAll((v) => !v)} /> : null}
        </div>
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
        <Link href="/pantry">Your kitchen</Link>
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
