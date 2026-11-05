"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Clock, CookingPot, Flag, HandCoins, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { InboxResponse, SettlementMethod } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KindBubble } from "./ledger-ui";
import { Face } from "./faces-ui";
import type { MemberNames } from "./members";
import { formatMinor } from "./money";
import { amountCost } from "./item-use";
import { useItemsByRef, useLogUse } from "./pantry-data";
import { quickUseHref } from "./pantry";
import { useClaimer, useDish, useDishActions } from "./dish-data";
import { CLAIM_CHOICES, claimableHalf, halfText, portionsText } from "./dish";
import { useRecordPayment } from "./settle-card";
import { SETTLE_METHODS } from "./settle";
import { HOME_TODOS, homeTodos, type HomeTodo, type InboxAction, type InboxTone } from "./inbox";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import type { RecentRow } from "./home";
import type { AsyncState } from "@/lib/query";

/**
 * Home's to-do list (Cookpool CP-23; SM-10 as the canvas draws it): at most
 * three rows, each one thing that needs you — a dish to say how much you had
 * (½-step chips), your dish to finalize, food to use soon, someone to pay, a
 * flag — with its one action at the end of the row and no captions; "See all"
 * when there are more. Every money or stock action ends in the one Undo
 * toast. Also Home's Recent activity rows.
 */

const TONES: Record<InboxTone, { icon: LucideIcon; className: string; label: string }> = {
  expired: { icon: TriangleAlert, className: "bg-cp-expired-tint text-cp-expired", label: "Past its date" },
  soon: { icon: Clock, className: "bg-cp-soon-tint text-cp-soon", label: "Use soon" },
  dish: { icon: CookingPot, className: "bg-cp-tomato-tint text-cp-tomato", label: "Dish" },
  money: { icon: HandCoins, className: "bg-cp-owed-tint text-cp-owed", label: "Payment" },
  flag: { icon: Flag, className: "bg-muted text-muted-foreground", label: "Flag" },
};

const SUB_TONES: Record<HomeTodo["subTone"], string> = {
  muted: "text-muted-foreground",
  expired: "font-semibold text-cp-expired",
  soon: "font-semibold text-cp-soon",
  owe: "font-bold text-cp-owe",
};

/** A row's button: 44px tall, the green one for what settles it, outlined otherwise. */
const ROW_BUTTON = "h-11 shrink-0 rounded-[14px] px-4 text-[15px] font-extrabold";

export function HomeTodoList({
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
  const [all, setAll] = React.useState(false);
  const todos = inbox.data ? homeTodos(inbox.data, { meId, names, now }, { all }) : null;
  const listId = React.useId();

  return (
    <section aria-labelledby="home-todo" className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-todo" className="text-lg font-extrabold tracking-tight">
          To do
        </h2>
        {todos && todos.total > HOME_TODOS ? (
          <button
            type="button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => setAll((v) => !v)}
            className="-my-2 -mr-2 min-h-11 rounded-xl px-2 text-sm font-bold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {all ? "Show less" : `See all ${todos.total}`}
          </button>
        ) : null}
      </div>
      {inbox.loading ? (
        <div className="space-y-px overflow-hidden rounded-[22px] border bg-card" aria-hidden>
          <Skeleton className="h-[68px] w-full rounded-none" />
          <Skeleton className="h-[68px] w-full rounded-none" />
        </div>
      ) : inbox.error || !todos ? (
        <div className="flex min-h-[68px] items-center justify-between gap-3 rounded-[22px] border bg-card px-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your to-dos.</p>
          <Button variant="outline" className={ROW_BUTTON} onClick={inbox.reload}>
            Try again
          </Button>
        </div>
      ) : todos.total === 0 ? (
        <div role="status" className="flex min-h-[68px] items-center gap-3 rounded-[22px] border bg-card px-4">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cp-herb-tint text-primary">
            <Check className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <span className="text-base font-extrabold">All clear</span>
        </div>
      ) : (
        <ul id={listId} className="divide-y overflow-hidden rounded-[22px] border bg-card">
          {todos.rows.map((todo) => (
            <li key={todo.key}>
              <TodoRow todo={todo} meId={meId} names={names} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TodoRow({ todo, meId, names }: { todo: HomeTodo; meId: string | null; names: MemberNames }) {
  const tone = TONES[todo.tone];
  const Icon = tone.icon;
  const prefetch = usePrefetchKitchen();
  const { action } = todo;
  // What the row's page needs beyond what the row already read (SM-5): a
  // dish's group members now; the rest when the row is pressed.
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
  // A payment's method chips open under the row, like a dish's portion chips.
  const [paying, setPaying] = React.useState(false);

  const head = (
    <div className="flex items-center gap-3">
      {todo.faceId ? (
        <Face subjectId={todo.faceId} meId={meId} names={names} />
      ) : (
        <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone.className)}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <Link
          {...pressIn(readAhead)}
          href={todo.href}
          className="block truncate rounded text-base font-extrabold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="sr-only">{tone.label}: </span>
          {todo.title}
        </Link>
        <p className={cn("truncate text-[13px] tabular-nums", SUB_TONES[todo.subTone])}>{todo.sub}</p>
      </div>
      <RowAction action={action} title={todo.title} meId={meId} names={names} paying={paying} onPay={() => setPaying(true)} />
    </div>
  );

  return (
    <div className="space-y-2.5 px-4 py-3">
      {head}
      {action.kind === "claim" ? <ClaimChips dishId={action.dishId} meId={meId} names={names} /> : null}
      {action.kind === "pay" && paying ? <PayChips action={action} meId={meId} onDone={() => setPaying(false)} /> : null}
    </div>
  );
}

function RowAction({
  action,
  title,
  meId,
  names,
  paying,
  onPay,
}: {
  action: InboxAction;
  title: string;
  meId: string | null;
  names: MemberNames;
  paying: boolean;
  onPay: () => void;
}) {
  switch (action.kind) {
    case "claim":
      return null;
    case "finalize":
      return <FinalizeButton dishId={action.dishId} groupName={action.groupName} meId={meId} names={names} />;
    case "split":
    case "open":
      return (
        <Button asChild variant="outline" className={ROW_BUTTON}>
          <Link href={action.href} aria-label={`${action.label}: ${title}`}>
            {action.kind === "split" ? "Set" : "Open"}
          </Link>
        </Button>
      );
    case "use":
      return <UseButton action={action} meId={meId} names={names} />;
    case "pay":
      return action.canRecord && !paying ? (
        <Button
          className={ROW_BUTTON}
          disabled={!meId}
          aria-label={`Paid: ${formatMinor(action.amountMinor, action.currency)} to ${action.toLabel} in ${action.groupName}`}
          onClick={onPay}
        >
          Paid
        </Button>
      ) : null;
  }
}

// ── How much did you have: 0 · ½ · 1 · 1½ · 2 ────────────────────

function ClaimChips({ dishId, meId, names }: { dishId: string; meId: string | null; names: MemberNames }) {
  const dish = useDish(dishId);
  if (!meId || !dish.data || dish.data.state !== "open") {
    return (
      <div className="grid grid-cols-5 gap-1.5" aria-hidden>
        {CLAIM_CHOICES.map((h) => (
          <Skeleton key={h} className="h-11 rounded-xl" />
        ))}
      </div>
    );
  }
  return <ClaimChipRow dish={dish.data} meId={meId} names={names} />;
}

function ClaimChipRow({ dish, meId, names }: { dish: NonNullable<ReturnType<typeof useDish>["data"]>; meId: string; names: MemberNames }) {
  const claimer = useClaimer(dish, meId, names);
  const max = claimableHalf(dish);
  return (
    <div role="group" aria-label={`Your portions of ${dish.name}`} className="grid grid-cols-5 gap-1.5">
      {CLAIM_CHOICES.map((h) => {
        const on = claimer.half === h && h > 0;
        return (
          <button
            key={h}
            type="button"
            aria-pressed={on}
            aria-label={portionsText(h)}
            disabled={h > max}
            onClick={() => claimer.set(h, { now: true })}
            className={cn(
              "min-h-11 rounded-xl border text-[15px] font-extrabold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40",
              on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground hover:bg-accent",
            )}
          >
            {halfText(h)}
          </button>
        );
      })}
    </div>
  );
}

// ── Finalize your dish, in one tap ────────────────────────────────

function FinalizeButton({ dishId, groupName, meId, names }: { dishId: string; groupName: string | null; meId: string | null; names: MemberNames }) {
  const dish = useDish(dishId);
  if (!dish.data || (dish.data.state !== "open" && dish.data.state !== "draft")) {
    return (
      <Button className={ROW_BUTTON} disabled>
        Finalize
      </Button>
    );
  }
  return <FinalizeNow dish={dish.data} groupName={groupName} meId={meId} names={names} />;
}

function FinalizeNow({
  dish,
  groupName,
  meId,
  names,
}: {
  dish: NonNullable<ReturnType<typeof useDish>["data"]>;
  groupName: string | null;
  meId: string | null;
  names: MemberNames;
}) {
  // At once (SM-5): the dish reads finalized everywhere and this row goes, with "Correct it" on the toast.
  const actions = useDishActions({ dish, meId, names, groupName });
  return (
    <Button className={ROW_BUTTON} loading={actions.busy === "finalize"} disabled={actions.busy !== null} onClick={() => void actions.finalize()}>
      Finalize<span className="sr-only"> {dish.name}</span>
    </Button>
  );
}

// ── Use soon: your usual amount, for just you, in one tap ─────────

function UseButton({ action, meId, names }: { action: Extract<InboxAction, { kind: "use" }>; meId: string | null; names: MemberNames }) {
  const items = useItemsByRef([action.ref]);
  const item = items.get(action.ref.itemId);
  const logUse = useLogUse();
  const fits = item ? item.state === "active" && action.qtyMilli <= item.qtyLeftMilli : true;
  const cost = item && fits ? formatMinor(amountCost(item, action.qtyMilli), item.currency) : null;

  // At once (SM-5): what is left drops (the row goes with nothing left) and
  // the Undo toast is up; a refusal is put back and says why.
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

  if (item !== undefined && (item === null || !fits)) {
    // It can't be read, or less is left than that: its page says what is left.
    return (
      <Button asChild variant="outline" className={ROW_BUTTON}>
        <Link href={quickUseHref(action.ref)}>Use</Link>
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      className={ROW_BUTTON}
      disabled={!item || !meId}
      aria-label={`${action.label}${cost ? `, ${cost}` : ""}, for you`}
      onClick={use}
    >
      {action.words}
    </Button>
  );
}

// ── Paid: how, then it is recorded with Undo ──────────────────────

function PayChips({ action, meId, onDone }: { action: Extract<InboxAction, { kind: "pay" }>; meId: string | null; onDone: () => void }) {
  const record = useRecordPayment();
  // Recorded at once (SM-5): the row leaves Home and the Undo toast is up
  // before the server answers; a refusal brings it back and says why.
  const pick = (method: SettlementMethod) => {
    if (!meId) return;
    onDone();
    void record({
      orgId: action.orgId,
      payment: { fromSubjectId: meId, toSubjectId: action.toSubjectId, amountMinor: action.amountMinor },
      currency: action.currency,
      method,
      sentence: `You paid ${action.toLabel}`,
    });
  };
  return (
    <div role="group" aria-label="How was it paid?" className="flex items-center gap-1.5">
      {SETTLE_METHODS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => pick(m.id)}
          className="min-h-11 flex-1 rounded-xl border border-input bg-card text-[15px] font-extrabold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {m.label}
        </button>
      ))}
      <button
        type="button"
        aria-label="Not now"
        onClick={onDone}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
    </div>
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
    <section aria-labelledby="home-recent" className={cn("space-y-2", className)}>
      <h2 id="home-recent" className="text-lg font-extrabold tracking-tight">
        Recent
      </h2>
      {loading ? (
        <div className="space-y-px overflow-hidden rounded-[22px] border bg-card" aria-hidden>
          <Skeleton className="h-14 w-full rounded-none" />
          <Skeleton className="h-14 w-full rounded-none" />
        </div>
      ) : rows.length === 0 ? (
        <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">
          {hasGroups ? "Nothing logged yet" : "No groups yet"}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-[22px] border bg-card">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                {...pressIn(() => onPressRow?.(row))}
                href={row.href}
                className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <KindBubble glyph={row.glyph} label={row.kindLabel} tone={row.reversed ? "neutral" : row.kindTone} className="h-9 w-9 text-sm" />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[15px] font-bold leading-snug", row.reversed && "text-muted-foreground line-through")}>
                    {row.title}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {row.reversed ? "Undone · " : ""}
                    {row.whoWhen}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[15px] font-bold tabular-nums",
                    !row.amountText || row.reversed || row.tone === "neutral" ? "text-muted-foreground" : row.tone === "owed" ? "text-cp-owed" : "text-cp-owe",
                    row.reversed && "line-through",
                  )}
                >
                  {row.amountText ? (
                    <>
                      <span aria-hidden>{row.amountText}</span>
                      <span className="sr-only">{row.amountWords}</span>
                    </>
                  ) : (
                    <>
                      <span className="sr-only">Not you; in all </span>
                      {row.totalText}
                    </>
                  )}
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
