"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Clock, CookingPot, Flag, HandCoins, Receipt, TriangleAlert, type LucideIcon } from "lucide-react";
import type { InboxResponse, KitchenDish, SettlementMethod } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IconBubble, KCard, K_BUTTON } from "./kit";
import { KindBubble, Money } from "./ledger-ui";
import type { MemberNames } from "./members";
import { formatMinor } from "./money";
import { amountCost } from "./item-use";
import { useItemsByRef, useLogUse } from "./pantry-data";
import { useDish, useDishActions } from "./dish-data";
import { DishClaimStepper } from "./dish-ui";
import { dishHref, leftoverNote, splitOfDish } from "./dish";
import { PaymentMethodChips, useRecordPayment } from "./settle-card";
import { finalizePreview, inboxView, type InboxAction, type InboxCard, type InboxTone } from "./inbox";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import type { RecentRow } from "./home";
import type { AsyncState } from "@/lib/query";

/**
 * Home's inbox (Cookpool CP-23): "Needs you · N to do", one card per thing
 * that needs you, each done where it is — claim a portion, finalize your dish
 * after a preview of who owes what, "I had a glass", I paid, open a flagged
 * entry — and "All clear" when nothing does. Every money or stock action ends
 * in the one Undo toast; the inbox refreshes after each. Also Home's Recent
 * activity rows.
 */

const TONES: Record<InboxTone, { icon: LucideIcon; className: string; label: string }> = {
  expired: { icon: TriangleAlert, className: "bg-cp-expired-tint text-cp-expired", label: "Past its date" },
  soon: { icon: Clock, className: "bg-cp-soon-tint text-cp-soon", label: "Use soon" },
  dish: { icon: CookingPot, className: "bg-cp-tomato-tint text-cp-tomato", label: "Dish" },
  money: { icon: HandCoins, className: "bg-cp-owed-tint text-cp-owed", label: "Payment" },
  flag: { icon: Flag, className: "bg-muted text-muted-foreground", label: "Flag" },
};

export function NeedsYou({
  inbox,
  meId,
  names,
  className,
}: {
  inbox: AsyncState<InboxResponse>;
  meId: string | null;
  names: MemberNames;
  className?: string;
}) {
  const now = React.useMemo(() => new Date(), []);
  const view = inbox.data ? inboxView(inbox.data, { meId, names, now }) : null;

  return (
    <section aria-labelledby="home-needs-you" className={cn("space-y-3", className)}>
      <h2 id="home-needs-you" className="text-lg font-bold tracking-tight">
        {view ? view.heading : "Needs you"}
      </h2>
      {inbox.loading ? (
        <div className="space-y-2.5" aria-hidden>
          <Skeleton className="h-28 w-full rounded-[20px]" />
          <Skeleton className="h-28 w-full rounded-[20px]" />
        </div>
      ) : inbox.error || !view ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load what needs you. {inbox.error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={inbox.reload}>
            Try again
          </Button>
        </KCard>
      ) : view.empty ? (
        <KCard className="flex items-center gap-4 p-5">
          <IconBubble icon={CheckCircle2} />
          <div className="min-w-0">
            <h3 className="text-base font-bold tracking-tight">All clear</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">Nothing needs you right now.</p>
          </div>
        </KCard>
      ) : (
        <ul className="space-y-2.5">
          {view.cards.map((card) => (
            <li key={card.key}>
              <InboxCardView card={card} meId={meId} names={names} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InboxCardView({ card, meId, names }: { card: InboxCard; meId: string | null; names: MemberNames }) {
  const tone = TONES[card.tone];
  const Icon = tone.icon;
  const prefetch = usePrefetchKitchen();
  const { action } = card;
  // What the card's page needs beyond what the card already read (SM-5): a
  // dish's group members now; the rest when the card is pressed.
  const claimGroup = action.kind === "claim" ? action.orgId : null;
  React.useEffect(() => {
    if (claimGroup) prefetch.members(claimGroup);
  }, [claimGroup, prefetch]);
  const readAhead = () => {
    if (action.kind === "claim") prefetch.dish(action.dishId, action.orgId);
    else if (action.kind === "finalize") prefetch.dish(action.dishId, null);
    else if (action.kind === "use") prefetch.item(action.ref);
    else if (action.kind === "pay") prefetch.group(action.orgId);
  };
  return (
    <KCard className="p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", tone.className)}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            {...pressIn(readAhead)}
            href={card.href}
            className="block rounded text-[15px] font-bold leading-snug underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="sr-only">{tone.label}: </span>
            {card.title}
          </Link>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{card.meta}</p>
          {card.note ? <p className="mt-1 break-words text-sm italic text-foreground/80">{card.note}</p> : null}
        </div>
      </div>
      <div className="mt-3">
        <CardAction action={card.action} meId={meId} names={names} />
      </div>
    </KCard>
  );
}

function CardAction({ action, meId, names }: { action: InboxAction; meId: string | null; names: MemberNames }) {
  switch (action.kind) {
    case "claim":
      return <ClaimAction dishId={action.dishId} meId={meId} names={names} />;
    case "finalize":
      return <FinalizeAction dishId={action.dishId} groupName={action.groupName} meId={meId} names={names} />;
    case "split":
    case "open":
      return (
        <Button asChild variant="outline" className={K_BUTTON}>
          <Link href={action.href}>
            {action.label}
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      );
    case "use":
      return <UseAction action={action} meId={meId} names={names} />;
    case "pay":
      return <PayAction action={action} meId={meId} />;
  }
}

// ── Claim: CP-17's claim buttons, over the dish read ──────────────

function DishFallback({ dishId, loading }: { dishId: string; loading: boolean }) {
  if (loading) return <Skeleton className="h-11 w-full rounded-xl" aria-hidden />;
  return (
    <Button asChild variant="outline" className={K_BUTTON}>
      <Link href={dishHref(dishId)}>
        Open the dish
        <ChevronRight aria-hidden />
      </Link>
    </Button>
  );
}

function ClaimAction({ dishId, meId, names }: { dishId: string; meId: string | null; names: MemberNames }) {
  const dish = useDish(dishId);
  if (!meId || !dish.data || dish.data.state !== "open") return <DishFallback dishId={dishId} loading={!meId || dish.loading} />;
  return <DishClaimStepper dish={dish.data} meId={meId} names={names} />;
}

// ── Finalize: a preview of who owes what, then the dish page's finalize ──

/** Preview lines shown before "and N more". */
const PREVIEW_LINES = 3;

function FinalizeAction({
  dishId,
  groupName,
  meId,
  names,
}: {
  dishId: string;
  groupName: string | null;
  meId: string | null;
  names: MemberNames;
}) {
  const dish = useDish(dishId);
  if (!dish.data || (dish.data.state !== "open" && dish.data.state !== "draft")) {
    return <DishFallback dishId={dishId} loading={dish.loading} />;
  }
  return <FinalizeInline dish={dish.data} groupName={groupName} meId={meId} names={names} />;
}

function FinalizeInline({
  dish,
  groupName,
  meId,
  names,
}: {
  dish: KitchenDish;
  groupName: string | null;
  meId: string | null;
  names: MemberNames;
}) {
  const actions = useDishActions({ dish, meId, names, groupName });
  const prefetch = usePrefetchKitchen();
  const dishGroup = dish.orgId;
  React.useEffect(() => {
    if (dishGroup) prefetch.members(dishGroup);
  }, [dishGroup, prefetch]);
  const preview = finalizePreview(dish, { meId, names });
  const leftovers = leftoverNote({ dish, split: splitOfDish(dish), meId, names });
  const shown = preview.lines.slice(0, PREVIEW_LINES);
  const more = preview.lines.length - shown.length;
  return (
    <div className="space-y-2.5">
      <div className="rounded-xl bg-background px-3 py-2.5 text-sm">
        {preview.empty ? (
          <p className="text-muted-foreground">{preview.empty}</p>
        ) : (
          <>
            <p className="text-xs font-semibold text-muted-foreground">Once you finalize, they owe you</p>
            <ul className="mt-1 space-y-0.5">
              {shown.map((l) => (
                <li key={l.subjectId} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{l.label}</span>
                  <Money minor={l.amountMinor} currency={dish.currency} className="shrink-0 font-bold text-cp-owed" />
                </li>
              ))}
            </ul>
            {more > 0 ? <p className="mt-0.5 text-xs text-muted-foreground">and {more} more on the dish page</p> : null}
          </>
        )}
        {leftovers ? <p className="mt-1.5 text-xs text-muted-foreground">{leftovers}</p> : null}
      </div>
      {actions.error ? (
        <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
          {actions.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button className={K_BUTTON} loading={actions.busy === "finalize"} disabled={actions.busy !== null} onClick={() => void actions.finalize()}>
          Finalize<span className="sr-only"> {dish.name}</span>
        </Button>
        <Button asChild variant="outline" className={K_BUTTON}>
          <Link href={dishHref(dish.id)}>
            Open the dish<span className="sr-only">: {dish.name}</span>
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ── Use soon: one tap for your usual amount, or cook with it ──────

function UseAction({ action, meId, names }: { action: Extract<InboxAction, { kind: "use" }>; meId: string | null; names: MemberNames }) {
  const items = useItemsByRef([action.ref]);
  const item = items.get(action.ref.itemId);
  const logUse = useLogUse();
  const fits = item ? item.state === "active" && action.qtyMilli <= item.qtyLeftMilli : true;
  const cost = item && fits ? formatMinor(amountCost(item, action.qtyMilli), item.currency) : null;

  // At once (SM-5): the card's "left" drops (or the card goes, with nothing
  // left) and the Undo toast is up; a refusal is put back and says why.
  const use = () => {
    if (!item || !meId) return;
    void logUse({
      ref: action.ref,
      item,
      qtyMilli: action.qtyMilli,
      consumers: [meId],
      idempotencyKey: crypto.randomUUID(),
      what: action.words,
      inPantry: true,
      meId,
      names,
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        <Button className={K_BUTTON} disabled={!item || !fits || !meId} onClick={use}>
          {cost ? `${action.label} · ${cost}` : action.label}
        </Button>
        <Button asChild variant="outline" className={K_BUTTON}>
          <Link href={action.cookHref}>
            <CookingPot aria-hidden />
            Cook with it
            {item ? <span className="sr-only">: {item.name}</span> : null}
          </Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {item === null
          ? "It can't be read just now: open it to see what's left."
          : !fits
            ? "Less is left than that now: open it to log another amount."
            : `${action.usual ? "Your usual amount" : "A usual measure"}, for just you.`}
      </p>
    </div>
  );
}

// ── I paid: record the plan's payment, with Undo ──────────────────

function PayAction({ action, meId }: { action: Extract<InboxAction, { kind: "pay" }>; meId: string | null }) {
  const record = useRecordPayment();
  const [choosing, setChoosing] = React.useState(false);
  const chipsId = React.useId();
  const to = action.toLabel;

  if (!action.canRecord) {
    return (
      <p className="text-xs text-muted-foreground">
        You view {action.groupName}, so {to} or an owner or admin records it.
      </p>
    );
  }
  // Recorded at once (SM-5): the card leaves Home and the Undo toast is up
  // before the server answers; a refusal brings it back and says why.
  const pick = (method: SettlementMethod) => {
    if (!meId) return;
    setChoosing(false);
    void record({
      orgId: action.orgId,
      payment: { fromSubjectId: meId, toSubjectId: action.toSubjectId, amountMinor: action.amountMinor },
      currency: action.currency,
      method,
      sentence: `You paid ${to}`,
    });
  };
  return choosing ? (
    <PaymentMethodChips id={chipsId} busy={null} onPick={pick} onCancel={() => setChoosing(false)} />
  ) : (
    <Button className={K_BUTTON} disabled={!meId} aria-expanded={false} aria-controls={chipsId} onClick={() => setChoosing(true)}>
      <HandCoins aria-hidden />
      I paid
      <span className="sr-only">
        {" "}
        {formatMinor(action.amountMinor, action.currency)} in {action.groupName}
      </span>
    </Button>
  );
}

// ── Recent activity across groups ─────────────────────────────────

export function RecentActivityList({
  rows,
  loading,
  failed,
  reload,
  hasGroups,
  onPressRow,
  className,
}: {
  rows: readonly RecentRow[];
  loading: boolean;
  failed: readonly string[];
  reload: () => void;
  hasGroups: boolean;
  /** A row is being pressed: read ahead what it opens. */
  onPressRow?: (row: RecentRow) => void;
  className?: string;
}) {
  return (
    <section aria-labelledby="home-recent" className={cn("space-y-3", className)}>
      <h2 id="home-recent" className="text-lg font-bold tracking-tight">
        Recent activity
      </h2>
      {loading ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-16 w-full rounded-[18px]" />
          <Skeleton className="h-16 w-full rounded-[18px]" />
        </div>
      ) : rows.length === 0 ? (
        <KCard className="flex gap-4 p-5">
          <IconBubble icon={Receipt} tone="blue" />
          <p className="min-w-0 self-center text-sm text-muted-foreground">
            {hasGroups ? "Nothing logged in your groups yet." : "Start or join a group to see what's logged in it."}
          </p>
        </KCard>
      ) : (
        <ul className="divide-y overflow-hidden rounded-[20px] border bg-card">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                {...pressIn(() => onPressRow?.(row))}
                href={row.href}
                className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <KindBubble glyph={row.glyph} label={row.kindLabel} tone={row.reversed ? "neutral" : row.kindTone} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[15px] font-semibold", row.reversed && "text-muted-foreground line-through")}>
                    {row.title}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {row.reversed ? "Undone · " : ""}
                    {row.whoWhen}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {row.amountText ? (
                    <span
                      className={cn(
                        "block text-sm font-bold tabular-nums",
                        row.reversed || row.tone === "neutral" ? "text-muted-foreground" : row.tone === "owed" ? "text-cp-owed" : "text-cp-owe",
                        row.reversed && "line-through",
                      )}
                    >
                      <span aria-hidden>{row.amountText}</span>
                      <span className="sr-only">{row.amountWords}</span>
                    </span>
                  ) : (
                    <span className="block text-xs text-muted-foreground">not involved</span>
                  )}
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    <span className="sr-only">Total </span>
                    {row.totalText}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {failed.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          Couldn&apos;t read {failed.join(", ")}.
          <button type="button" onClick={reload} className="min-h-11 font-semibold text-primary underline-offset-2 hover:underline">
            Try again
          </button>
        </p>
      ) : null}
    </section>
  );
}
