"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRightLeft, CookingPot, Minus, Plus, Trash2 } from "lucide-react";
import type { KitchenItem, KitchenStockMove } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { wrap } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON, SoonBadge } from "@/components/kitchen/kit";
import { Money } from "@/components/kitchen/ledger-ui";
import { useGroupRole } from "@/components/kitchen/ledger-data";
import { memberLabel, memberLabelInline, type MemberNames } from "@/components/kitchen/members";
import { useMemberNames, useMyRoles } from "@/components/kitchen/people-data";
import { GroupPickerList } from "@/components/kitchen/group-picker";
import { wasteRuleLabel, type GroupRole } from "@/components/kitchen/groups";
import { formatMinor } from "@/components/kitchen/money";
import {
  refreshPantry,
  undoRefusal,
  undoStockMove,
  useItemMoves,
  useKitchenItem,
  useLogUse,
  useOfferStockUndo,
  usePantries,
} from "@/components/kitchen/pantry-data";
import { ShareList, StockBar, UseByPill, WhoHadIt } from "@/components/kitchen/pantry-ui";
import {
  barTone,
  boughtText,
  categoryLabel,
  dayMonth,
  itemHref,
  itemRefParam,
  leftPercent,
  leftText,
  orderPantries,
  pantryLabel,
  parseItemRef,
  unitPriceText,
  expiryChip,
  expiryText,
  type ItemRef,
} from "@/components/kitchen/pantry";
import {
  canUndoMove,
  costPerText,
  historyRows,
  initialAmount,
  isUnused,
  orderConsumers,
  parseAmount,
  stepAmount,
  transferNote,
  transferTargets,
  amountInput,
  shareBreakdown,
  logButtonLabel,
  amountCost,
  amountText,
  amountStep,
  wastePreview,
} from "@/components/kitchen/item-use";
import { useRecentGroupSlugs } from "@/lib/recent-groups";

/**
 * One item (CP-12): how much is left of what was bought, what it cost and is
 * worth, and who pays if it is wasted; **Use some** — an amount in sensible
 * steps, its cost live by the engine, who had it, who owes whom — then
 * **Mark wasted** (with a preview of who pays), **Move to a group** for your
 * own item while none of it is used, and its history, where the latest use
 * or waste can be undone. Uses and waste confirm by a ten-second Undo. The
 * address names the item: `/pantry/me:itm_…` (yours) or
 * `/pantry/org:org_…:itm_…` (a group's). Viewers see it all and change nothing.
 */
export default function ItemPage() {
  const params = useParams<{ itemRef: string }>();
  const ref = parseItemRef(params?.itemRef);
  if (!ref) return <ItemNotFound />;
  return <ItemLoader key={itemRefParam(ref)} itemRef={ref} />;
}

function ItemLoader({ itemRef }: { itemRef: ItemRef }) {
  const profile = useProfile();
  const item = useKitchenItem(itemRef);
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
  const { item, meId, names, roleKnown, canWrite } = ctx;
  const personal = item.pantry.kind === "personal";
  const live = item.state === "active" && item.qtyLeftMilli > 0;
  const back = `/pantry?pantry=${encodeURIComponent(item.pantry.kind === "personal" ? "personal" : item.pantry.orgId)}`;
  const where = personal ? "Personal" : `${pantryLabel(item.pantry)} pantry`;
  const sub = [where, item.category ? categoryLabel(item.category) : null, personal ? null : `${memberLabel(item.paidBy, meId, names)} paid`]
    .filter(Boolean)
    .join(" · ");
  const stateLabel = STATE_LABEL[item.state];
  const cardRef = React.useRef<HTMLElement>(null);

  // A link to the Use section (#use) lands here: bring the Use card into view.
  const canUseHere = live && roleKnown && canWrite;
  React.useEffect(() => {
    if (canUseHere && window.location.hash === "#use") cardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [canUseHere]);

  return (
    <div className="space-y-5">
      <Link
        href={back}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Pantry
      </Link>
      <header className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-[26px] font-extrabold leading-tight tracking-tight">{item.name}</h1>
          {stateLabel ? <SoonBadge label={stateLabel} /> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      </header>

      <div className="grid gap-5 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)] min-[900px]:items-start">
        <div className="min-w-0 space-y-5">
          <StockCard {...ctx} />
          {live ? (
            !roleKnown ? (
              <Skeleton className="h-72 w-full rounded-[22px]" />
            ) : canWrite ? (
              <UseCard {...ctx} cardRef={cardRef} />
            ) : (
              <KCard className="p-5 text-sm text-muted-foreground">
                You view {pantryLabel(item.pantry)}: you see its pantry, but don&apos;t use from it or change it.
              </KCard>
            )
          ) : null}
        </div>

        <div className="min-w-0 space-y-5">
          {live && roleKnown && canWrite ? <ActionsCard {...ctx} /> : null}
          {personal && item.state === "active" ? <MoveCard {...ctx} /> : null}
          <HistoryCard {...ctx} />
        </div>
      </div>
    </div>
  );
}

// ── Stock ──────────────────────────────────────────────────────────

function StockCard({ item, meId, names }: ItemCtx) {
  const chip = expiryChip(item);
  const long = expiryText(item);
  const personal = item.pantry.kind === "personal";
  const left = leftText(item);
  const rule = personal
    ? "Nothing to split"
    : `${wasteRuleLabel(item.wastePolicy ?? "split_equally")}${item.wastePolicyOverride ? " (this item)" : ""}`;
  return (
    <section aria-label="Stock" className="space-y-3.5 rounded-[22px] border bg-card p-5">
      {chip && long ? <UseByPill chip={{ ...chip, label: long }} className="px-2.5 py-1" /> : null}
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[34px] font-extrabold leading-none tracking-tight tabular-nums">{left}</span>
        <span className="text-[15px] text-muted-foreground">left of {boughtText(item)}</span>
      </p>
      <StockBar percent={leftPercent(item)} tone={barTone(item)} thick />
      <dl className="grid grid-cols-2 gap-3">
        <Fact term="Price paid">
          <Money minor={item.priceMinor} currency={item.currency} />
          {personal ? null : <> by {memberLabelInline(item.paidBy, meId, names)}</>}
        </Fact>
        <Fact term="Costs">{costPerText(item)}</Fact>
        <Fact term="Worth now">
          <Money minor={item.worthMinor} currency={item.currency} />
        </Fact>
        <Fact term="If wasted">{rule}</Fact>
        <Fact term="Bought on">{dayMonth(item.boughtOn)}</Fact>
        <Fact term="Price per unit">{unitPriceText(item)}</Fact>
      </dl>
    </section>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted-foreground">{term}</dt>
      <dd className="text-base font-bold tabular-nums">{children}</dd>
    </div>
  );
}

// ── Use some ───────────────────────────────────────────────────────

function UseCard({ itemRef, item, meId, names, roster, cardRef }: ItemCtx & { cardRef: React.RefObject<HTMLElement | null> }) {
  const logUse = useLogUse();
  const personal = item.pantry.kind === "personal";
  const step = amountStep(item);
  const [qtyMilli, setQtyMilli] = React.useState(() => initialAmount(item));
  const [typed, setTyped] = React.useState<string | null>(null);
  const [chosen, setChosen] = React.useState<ReadonlySet<string>>(() => new Set(meId ? [meId] : []));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const idemKey = React.useRef(crypto.randomUUID());

  // What is left can shrink under us (someone else used some): stay within it.
  React.useEffect(() => {
    setQtyMilli((q) => (q > item.qtyLeftMilli || q <= 0 ? initialAmount(item) : q));
  }, [item]);

  const parsed = typed === null ? null : parseAmount(typed, item);
  const amount = parsed ? (parsed.ok ? parsed.milli : null) : qtyMilli;
  const consumers = personal ? [] : orderConsumers(chosen, roster ?? [], meId);
  const breakdown = amount !== null && !personal ? shareBreakdown({ item, qtyMilli: amount, consumers, meId, names }) : null;
  const cost = amount !== null ? amountCost(item, amount) : null;
  const label = logButtonLabel({ qtyMilli: amount ?? qtyMilli, item, consumers: personal ? null : consumers, meId, names });
  const stepText = amountText(step.stepMilli, item);
  const ready = amount !== null && (personal || consumers.length > 0);

  const stepBy = (delta: 1 | -1) => {
    setTyped(null);
    setError(null);
    setQtyMilli((q) => stepAmount(amount ?? q, delta, item));
  };
  const toggle = (id: string) => {
    setError(null);
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (amount === null || !ready) return;
    setBusy(true);
    setError(null);
    const r = await logUse({ ref: itemRef, item, qtyMilli: amount, consumers, idempotencyKey: idemKey.current, meId, names });
    setBusy(false);
    if (!r.ok) {
      // A refusal is stored against its key at the edge: the next try needs a new one.
      if (r.answered) idemKey.current = crypto.randomUUID();
      if (r.gone.length > 0) setChosen((cur) => new Set([...cur].filter((id) => !r.gone.includes(id))));
      setError(r.message);
      return;
    }
    idemKey.current = crypto.randomUUID();
    setTyped(null);
    setQtyMilli(initialAmount(r.response.item));
  };

  const btn =
    "grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-input bg-card transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <section
      ref={cardRef}
      id="use"
      aria-labelledby="use-heading"
      className="scroll-mt-6 space-y-4 rounded-[22px] border-2 border-primary bg-card p-5"
    >
      <div>
        <h2 id="use-heading" className="text-[17px] font-extrabold">
          Use some
        </h2>
        <p className="text-[13px] text-muted-foreground">No dish needed. A snack, a salad, a glass of milk all count.</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" className={btn} aria-label={`${stepText} less`} disabled={amount !== null && amount <= Math.min(step.stepMilli, item.qtyLeftMilli)} onClick={() => stepBy(-1)}>
          <Minus className="h-5 w-5" aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
          <label htmlFor="use-amount" className="sr-only">
            How much, in {step.unit}
          </label>
          <span className="flex items-baseline gap-1.5">
            <Input
              id="use-amount"
              inputMode="decimal"
              value={typed ?? amountInput(qtyMilli)}
              onChange={(e) => {
                setError(null);
                setTyped(e.target.value);
              }}
              onBlur={() => {
                if (parsed?.ok) {
                  setQtyMilli(parsed.milli);
                  setTyped(null);
                }
              }}
              aria-invalid={parsed !== null && !parsed.ok}
              aria-describedby="use-cost"
              className="h-11 w-24 rounded-xl border-transparent bg-background text-center text-[26px] font-extrabold tabular-nums sm:h-11 sm:text-[26px]"
            />
            <span className="text-lg font-bold text-muted-foreground">{step.unit === "pcs" ? "pcs" : step.unit}</span>
          </span>
          <span id="use-cost" role="status" aria-live="polite" className="text-[13px] text-muted-foreground">
            {parsed && !parsed.ok ? (
              <span className="font-medium text-destructive">{parsed.message}</span>
            ) : cost !== null ? (
              <>
                costs <Money minor={cost} currency={item.currency} className="font-bold text-foreground" />
              </>
            ) : null}
          </span>
        </div>
        <button type="button" className={btn} aria-label={`${stepText} more`} disabled={amount !== null && amount >= item.qtyLeftMilli} onClick={() => stepBy(1)}>
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {amount !== item.qtyLeftMilli ? (
        <div className="-mt-2 text-center">
          <button
            type="button"
            onClick={() => {
              setTyped(null);
              setQtyMilli(item.qtyLeftMilli);
            }}
            className="min-h-11 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            All that&apos;s left · {amountText(item.qtyLeftMilli, item)}
          </button>
        </div>
      ) : null}

      {personal ? (
        <p className="rounded-[14px] bg-background px-3.5 py-3 text-sm text-muted-foreground">
          It&apos;s your own pantry, so nobody owes anyone — this just keeps count.
        </p>
      ) : (
        <>
          <WhoHadIt roster={roster} chosen={chosen} onToggle={toggle} meId={meId} names={names} />
          <ShareList
            lines={breakdown?.lines ?? []}
            currency={item.currency}
            empty={consumers.length === 0 ? "Pick at least one person." : amount === null ? "Enter how much to see who owes what." : null}
          />
        </>
      )}

      {error ? (
        <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
          {error}
        </p>
      ) : null}
      <Button type="button" className={cn(K_BUTTON, "h-12 w-full")} disabled={!ready} loading={busy} onClick={() => void submit()}>
        {label}
      </Button>
    </section>
  );
}

// ── Cook with it · Mark wasted ─────────────────────────────────────

function ActionsCard({ itemRef, item, meId, names, roster }: ItemCtx) {
  const { client } = useSession();
  const qc = useQueryClient();
  const offerUndo = useOfferStockUndo();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const idemKey = React.useRef(crypto.randomUUID());
  const preview = wastePreview({ item, members: roster ?? [], meId, names });
  const waiting = item.pantry.kind === "group" && roster === null;

  const waste = async () => {
    setBusy(true);
    setError(null);
    const opts = { idempotencyKey: idemKey.current };
    const r = await wrap(() =>
      itemRef.kind === "group"
        ? client.kitchen.wasteGroupItem(itemRef.orgId, itemRef.itemId, {}, opts)
        : client.kitchen.wastePersonalItem(itemRef.itemId, {}, opts),
    );
    setBusy(false);
    if (!r.ok) {
      // A refusal is stored against its key at the edge: the next try needs a new one.
      if (r.status > 0 && r.status < 500) idemKey.current = crypto.randomUUID();
      refreshPantry(qc, null);
      setError(r.error.reason === "insufficient_stock" ? "There's nothing left to waste now." : r.error.message);
      return;
    }
    idemKey.current = crypto.randomUUID();
    setOpen(false);
    refreshPantry(qc, itemRef.kind === "group" ? itemRef.orgId : null);
    const what = `${amountText(r.data.move.qtyMilli, item)} of ${item.name}`;
    offerUndo(
      itemRef,
      r.data,
      `Marked ${what} wasted`,
      r.data.txn
        ? `${formatMinor(r.data.txn.totalMinor, item.currency)} split equally in ${pantryLabel(item.pantry)}.`
        : "Nobody was charged.",
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        {/* The dish maker arrives with CP-15: shown, honestly not clickable yet. */}
        <button
          type="button"
          aria-disabled="true"
          className="relative flex min-h-[50px] cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border border-input bg-card px-3 text-[15px] font-bold text-muted-foreground"
        >
          <CookingPot className="h-5 w-5 shrink-0" aria-hidden />
          Cook with it
          <SoonBadge className="absolute -top-2.5 right-2 border bg-card" />
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="waste-preview"
          onClick={() => {
            setError(null);
            setOpen((o) => !o);
          }}
          className="flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] border border-input bg-card px-3 text-[15px] font-bold text-cp-expired transition-colors hover:bg-cp-expired-tint/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="h-5 w-5" aria-hidden />
          Mark wasted
        </button>
      </div>
      {open ? (
        <section id="waste-preview" aria-label="Waste preview" className="space-y-3 rounded-[22px] border bg-card p-5">
          <p className="text-[15px] font-bold">{preview.question}</p>
          {waiting ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{preview.explain}</p>
              {preview.lines.length > 0 && preview.lines.length <= 8 ? (
                <ShareList lines={preview.lines} currency={item.currency} />
              ) : null}
            </>
          )}
          {error ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className={K_BUTTON} onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" className={K_BUTTON} loading={busy} disabled={waiting} onClick={() => void waste()}>
              Mark wasted
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ── Move to a group ────────────────────────────────────────────────

function MoveCard({ itemRef, item }: ItemCtx) {
  const { client } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const pantries = usePantries();
  const { roles } = useMyRoles();
  const recentSlugs = useRecentGroupSlugs();
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
  const closed = targets.filter((t) => t.disabledReason);
  const chosen = open.find((t) => t.slug === target) ?? null;

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
      if (r.error.reason === "item_used") setError("Some of it has been used now, so it stays in your pantry.");
      else if (r.error.reason === "currency_mismatch")
        setError(`${chosen.name} counts in ${String(r.error.details?.["currency"] ?? "another currency")}, so it can't take this item.`);
      else setError(r.error.message);
      return;
    }
    refreshPantry(qc, chosen.orgId);
    toast({ kind: "success", title: `Moved ${item.name} to ${chosen.name}`, description: "It's the group's now, paid by you." });
    router.replace(itemHref(r.data.item));
  };

  return (
    <section aria-labelledby="move-heading" className="space-y-3 rounded-[22px] border bg-card p-5">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="h-5 w-5 text-muted-foreground" aria-hidden />
        <h2 id="move-heading" className="text-[17px] font-extrabold">
          Move to a group
        </h2>
      </div>
      {!unused ? (
        <p className="text-sm text-muted-foreground">Some of it is used, so it stays in your pantry. Cook with it for any group instead.</p>
      ) : pantries.loading ? (
        <Skeleton className="h-14 w-full rounded-[18px]" />
      ) : open.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {closed.length > 0
            ? `Your groups count in another currency (${closed.map((t) => `${t.name}: ${t.disabledReason?.replace("Counts in ", "")}`).join(", ")}), so this item can't move.`
            : "You're not in a group you can add to yet."}
        </p>
      ) : chosen ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{transferNote(item, chosen.name)}</p>
          {error ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2.5">
            <Button type="button" variant="outline" className={K_BUTTON} onClick={() => setTarget(null)}>
              Back
            </Button>
            <Button type="button" className={K_BUTTON} loading={busy} onClick={() => void move()}>
              Move to {chosen.name}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Share it with a group: they can use it, and pay you back for what they use.</p>
          <GroupPickerList
            groups={open.map((t) => ({ id: t.orgId, name: t.name, slug: t.slug, createdAt: "" }))}
            idPrefix="move-item-group"
            onPick={(slug) => setTarget(slug)}
          />
          {closed.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Not listed: {closed.map((t) => `${t.name} (${(t.disabledReason ?? "").replace(/^Counts/, "counts")})`).join(", ")}.
            </p>
          ) : null}
        </>
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
    if (r.ok) toast({ kind: "success", title: "Undone", description: "It's back in the pantry." });
    else toast(undoRefusal(r.error));
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
                  <p className={cn("text-sm font-semibold", row.undone && "text-muted-foreground line-through")}>{row.what}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {row.when}
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
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        It may have been removed, or moved to a group you&apos;re not in.
      </p>
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
