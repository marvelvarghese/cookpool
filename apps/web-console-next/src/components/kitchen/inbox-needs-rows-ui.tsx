"use client";

import * as React from "react";
import Link from "./link";
import { X } from "lucide-react";
import type { KitchenAsk, SplitReminderInboxItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import type { MemberNames } from "./members";
import { formatMinor } from "./money";
import { amountCost } from "./item-use";
import { useItemsByRef, useLogUse } from "./pantry-data";
import { itemHref, itemRefParam, parseItemRef, quickUseHref } from "./pantry";
import { swipeUseLabel } from "./item-actions";
import type { ItemMenuTarget } from "./item-actions-ui";
import { SwipeRow, type SwipeAction } from "./row-gestures-ui";
import { useClaimer, useDish, useDishActions } from "./dish-data";
import { CLAIM_CHOICES, claimableHalf, dishHref, halfText, perPortion, portionsText } from "./dish";
import { settleHref } from "./money-page";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import { useKitchenRouter } from "./transition-ui";
import { pillClass } from "./new-home-parts-ui";
import { reminderSplitHref, reminderSub, reminderTitle } from "./cooked";
import { useDismissSplitReminder } from "./cooked-data";
import { useCancelAsk } from "./ask-data";
import { cancelledMeta, claimedMeta, foodButton, mineRowText, usedMeta, type NeedsTodo } from "./inbox-needs";
import { NEEDS_CHIP, NeedsBadge, NeedsChips, NeedsRow } from "./inbox-row-ui";

/**
 * The rows of Home's Needs you (cookpool-revamp RV-15, the canvas's
 * `HomeRevamp`) other than the asks (`AskRow`): an open dish ("I had some"
 * opens ½ 1 1½ 2), Pay X (Paid opens the one Settle up), food to use (its
 * amount, or Used once past its date), your dish to split or finalize, a
 * split reminder, your own ask that waits (Cancel), and a flag (Open). A
 * pick or a use is written at once with the Undo toast, and the
 * row stays, dimmed, saying what was done, with its own Undo.
 */

/** What a row says once done here, and its Undo (null when it has none). */
export interface NeedsDone {
  meta: string;
  undo: (() => void) | null;
}

export interface TodoRowProps {
  todo: NeedsTodo;
  done: NeedsDone | null;
  meId: string | null;
  names: MemberNames;
  /** Done here: dim the row with this line and Undo. */
  onDone: (done: NeedsDone) => void;
  /** Put back (Undo, here or on the toast; or a refusal). */
  onUndone: () => void;
  onMenu: (target: ItemMenuTarget) => void;
}

const KIND_LABEL: Readonly<Record<NeedsTodo["kind"], string>> = {
  ask: "Ask",
  claim: "Dish",
  pay: "Payment",
  food: "Use soon",
  split: "Your dish",
  mine: "Your ask",
  flag: "Flag",
};

function UndoPill({ done, label }: { done: NeedsDone; label: string }) {
  return done.undo ? (
    <button type="button" onClick={done.undo} className={pillClass("done")}>
      Undo<span className="sr-only">: {label}</span>
    </button>
  ) : null;
}

export function TodoNeedsRow(props: TodoRowProps) {
  switch (props.todo.action.kind) {
    case "claim":
      return <ClaimRow {...props} dishId={props.todo.action.dishId} orgId={props.todo.action.orgId} />;
    case "pay":
      return <PayRow {...props} />;
    case "use":
      return <FoodRow {...props} />;
    case "finalize":
      return <FinalizeRow {...props} dishId={props.todo.action.dishId} groupName={props.todo.action.groupName} />;
    case "split":
    case "open":
      return <LinkRow {...props} href={props.todo.action.href} label={props.todo.action.kind === "split" ? "Set portions" : props.todo.kind === "food" ? "Use" : "Open"} />;
  }
}

function useReadAhead(todo: NeedsTodo) {
  const prefetch = usePrefetchKitchen();
  const { action } = todo;
  return pressIn(() => {
    if (action.kind === "claim") prefetch.dish(action.dishId, action.orgId);
    else if (action.kind === "finalize") prefetch.dish(action.dishId, null);
    else if (action.kind === "use") prefetch.item(action.ref);
    else if (action.kind === "pay") prefetch.group(action.orgId);
  });
}

function Row({ todo, done, meId, names, end, below }: Pick<TodoRowProps, "todo" | "done" | "meId" | "names"> & { end?: React.ReactNode; below?: React.ReactNode }) {
  const press = useReadAhead(todo);
  return (
    <NeedsRow
      badge={<NeedsBadge faceId={todo.faceId} icon={todo.icon} meId={meId} names={names} />}
      title={todo.title}
      href={todo.href}
      onPressTitle={press}
      kindLabel={KIND_LABEL[todo.kind]}
      meta={done?.meta ?? todo.meta}
      tone={todo.tone}
      done={!!done}
      end={done ? <UndoPill done={done} label={todo.title} /> : end}
      below={done ? null : below}
    />
  );
}

function LinkRow(props: TodoRowProps & { href: string; label: string }) {
  return (
    <Row
      {...props}
      end={
        <Link href={props.href} className={pillClass()}>
          {props.label}
          <span className="sr-only">: {props.todo.title}</span>
        </Link>
      }
    />
  );
}

// ── An open dish: I had some → ½ 1 1½ 2 ───────────────────────────

/** The portion chips (no 0: the dimmed row's Undo takes a pick back). */
const PICKS = CLAIM_CHOICES.filter((h) => h > 0);

function ClaimRow(props: TodoRowProps & { dishId: string; orgId: string }) {
  const dish = useDish(props.dishId);
  const prefetch = usePrefetchKitchen();
  // The group's members now, for the dish page the title opens (SM-5).
  React.useEffect(() => {
    if (props.orgId) prefetch.members(props.orgId);
  }, [props.orgId, prefetch]);
  if (!props.meId || !dish.data) return <ClaimWaiting {...props} />;
  return <ClaimReady {...props} dish={dish.data} meId={props.meId} />;
}

function ClaimWaiting(props: TodoRowProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Row
      {...props}
      end={
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={pillClass()}>
          {open ? "Close" : "I had some"}
        </button>
      }
      below={
        open ? (
          <NeedsChips label="Your portions" cols={4}>
            {PICKS.map((h) => (
              <Skeleton key={h} className="h-11 rounded-[12px]" />
            ))}
          </NeedsChips>
        ) : null
      }
    />
  );
}

function ClaimReady(props: TodoRowProps & { dish: NonNullable<ReturnType<typeof useDish>["data"]>; meId: string }) {
  const { dish, todo, onDone } = props;
  const claimer = useClaimer(dish, props.meId, props.names);
  const [open, setOpen] = React.useState(false);
  const max = claimableHalf(dish);
  // Undo on the toast puts the portion back: once the pick has shown, the row comes back when the portion goes back.
  const picked = React.useRef<{ half: number; before: number; seen: boolean } | null>(null);
  const { done, onUndone } = props;
  React.useEffect(() => {
    const p = picked.current;
    if (!done || !p) return;
    if (claimer.half === p.half) p.seen = true;
    else if (p.seen && !claimer.pending && claimer.half === p.before) {
      picked.current = null;
      onUndone();
    }
  }, [done, claimer.half, claimer.pending, onUndone]);
  const price = todo.perPortion ?? { minor: perPortion(dish).minor, currency: dish.currency };
  const pick = (half: number) => {
    const before = claimer.half;
    picked.current = { half, before, seen: false };
    claimer.set(half, { now: true });
    setOpen(false);
    onDone({ meta: claimedMeta(price.minor, price.currency, half), undo: () => {
      picked.current = null;
      claimer.set(before, { now: true });
      onUndone();
    } });
  };
  return (
    <Row
      {...props}
      end={
        dish.state === "open" ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={pillClass()}>
            {open ? "Close" : "I had some"}
            <span className="sr-only"> of {todo.title}</span>
          </button>
        ) : null
      }
      below={
        open && dish.state === "open" ? (
          <NeedsChips label={`Your portions of ${dish.name}`} cols={4}>
            {PICKS.map((h) => (
              <button key={h} type="button" aria-label={portionsText(h)} aria-pressed={claimer.half === h} disabled={h > max} onClick={() => pick(h)} className={NEEDS_CHIP}>
                {halfText(h)}
              </button>
            ))}
          </NeedsChips>
        ) : null
      }
    />
  );
}

// ── Pay X: Paid → the one Settle up (RV-17's `/money/settle`), back to Home ──

function PayRow(props: TodoRowProps) {
  const { todo } = props;
  if (todo.action.kind !== "pay") return null;
  const action = todo.action;
  return (
    <Row
      {...props}
      end={
        action.canRecord ? (
          <Link
            href={settleHref(action.orgId, action.toSubjectId, "/home")}
            aria-label={`Paid: ${formatMinor(action.amountMinor, action.currency)} to ${action.toLabel} in ${action.groupName}`}
            className={pillClass("main")}
          >
            Paid
          </Link>
        ) : null
      }
    />
  );
}

// ── Food to use: its amount, or Used once past its date ───────────

function FoodRow(props: TodoRowProps) {
  const { todo, meId, names, onDone, onUndone, onMenu } = props;
  const router = useKitchenRouter();
  const action = todo.action.kind === "use" ? todo.action : null;
  const ref = action?.ref ?? null;
  const key = ref ? itemRefParam(ref) : null;
  const refs = React.useMemo(() => {
    const parsed = key ? parseItemRef(key) : null;
    return parsed ? [parsed] : [];
  }, [key]);
  const items = useItemsByRef(refs);
  const logUse = useLogUse();
  if (!action || !ref) return null;
  const item = items.get(ref.itemId);
  const fits = item ? item.state === "active" && action.qtyMilli <= item.qtyLeftMilli : true;
  // It can't be read, or less is left than that: Use says what is left.
  const opens = item !== undefined && (item === null || !fits);
  const cost = item ? formatMinor(amountCost(item, action.qtyMilli), item.currency) : null;
  const words = foodButton(todo.tone, action.words);
  const run =
    item && meId && !opens
      ? () => {
          let undo: (() => void) | null = null;
          const sent = logUse({
            ref,
            item,
            qtyMilli: action.qtyMilli,
            consumers: [meId],
            idempotencyKey: crypto.randomUUID(),
            what: action.words,
            inPantry: true,
            meId,
            names,
            onUndoable: (u) => {
              undo = u;
            },
            onUndone,
          });
          onDone({ meta: usedMeta(action.words), undo: undo as (() => void) | null });
          void sent.then((r) => {
            if (!r.ok) onUndone();
          });
        }
      : null;
  const useHref = quickUseHref(ref);
  const swipe: SwipeAction | null = props.done ? null : opens ? { label: swipeUseLabel(null), tone: "use", run: () => router.push(useHref) } : run ? { label: swipeUseLabel(action.words), tone: "use", run } : null;
  return (
    <SwipeRow
      as="div"
      action={swipe}
      onLongPress={() => onMenu({ name: todo.title, ref, item: item ?? null, use: run ? { words: action.words, run } : null })}
      frontClassName="bg-card"
    >
      <Row
        {...props}
        end={
          opens ? (
            <Link href={useHref} className={pillClass()}>
              Use<span className="sr-only">: {todo.title}</span>
            </Link>
          ) : (
            <button type="button" disabled={!run} aria-label={`${action.label}${cost ? `, ${cost}` : ""}, for you`} onClick={() => run?.()} className={pillClass()}>
              {words}
            </button>
          )
        }
      />
    </SwipeRow>
  );
}

// ── Your dish: Finalize, in one tap ────────────────────────────────

function FinalizeRow(props: TodoRowProps & { dishId: string; groupName: string | null }) {
  const dish = useDish(props.dishId);
  const ready = dish.data && (dish.data.state === "open" || dish.data.state === "draft");
  return (
    <Row
      {...props}
      end={
        ready && dish.data ? (
          <FinalizeNow dish={dish.data} groupName={props.groupName} meId={props.meId} names={props.names} />
        ) : (
          <button type="button" disabled className={pillClass("main")}>
            Finalize
          </button>
        )
      }
    />
  );
}

function FinalizeNow({ dish, groupName, meId, names }: { dish: NonNullable<ReturnType<typeof useDish>["data"]>; groupName: string | null; meId: string | null; names: MemberNames }) {
  // At once (SM-5): the dish reads finalized everywhere and this row goes, with "Correct it" on the toast.
  const actions = useDishActions({ dish, meId, names, groupName });
  return (
    <button type="button" disabled={actions.busy !== null} onClick={() => void actions.finalize()} className={pillClass("main")}>
      Finalize<span className="sr-only"> {dish.name}</span>
    </button>
  );
}

// ── A split reminder: Split · × ───────────────────────────────────

export function ReminderNeedsRow({ item, meId, names }: { item: SplitReminderInboxItem; meId: string | null; names: MemberNames }) {
  const dismiss = useDismissSplitReminder();
  const title = reminderTitle(item);
  return (
    <NeedsRow
      data-split-reminder={item.dish.id}
      badge={<NeedsBadge icon="split" meId={meId} names={names} />}
      title={title}
      href={dishHref(item.dish.id)}
      kindLabel="Split"
      meta={reminderSub(item)}
      tone="muted"
      end={
        <>
          <Link href={reminderSplitHref(item)} aria-label={`Split ${item.dish.name} with ${item.suggest.groupName}`} className={pillClass()}>
            Split
          </Link>
          <button
            type="button"
            onClick={() => dismiss(item)}
            aria-label={`Dismiss: ${title}`}
            className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </>
      }
    />
  );
}

// ── Your own ask, waiting: Cancel ──────────────────────────────────

export function MineNeedsRow({
  ask,
  cancelled,
  meId,
  names,
  now,
  onCancelled,
}: {
  ask: KitchenAsk;
  cancelled: boolean;
  meId: string | null;
  names: MemberNames;
  now: Date;
  onCancelled: (on: boolean) => void;
}) {
  const cancel = useCancelAsk();
  const text = mineRowText(ask, { names, now });
  const ref = parseItemRef(ask.item.ref);
  return (
    <NeedsRow
      badge={<NeedsBadge icon="wait" meId={meId} names={names} />}
      title={text.title}
      href={ref ? itemHref(ref) : null}
      kindLabel="Your ask"
      meta={cancelled ? cancelledMeta(ask, names) : text.meta}
      tone={text.tone}
      done={cancelled}
      end={
        cancelled ? null : (
          <button
            type="button"
            onClick={() => {
              onCancelled(true);
              void cancel(ask).then((r) => {
                if (!r.ok) onCancelled(false);
              });
            }}
            className={pillClass("done")}
          >
            Cancel<span className="sr-only">: {text.title}</span>
          </button>
        )
      }
    />
  );
}
