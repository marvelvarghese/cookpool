"use client";

import * as React from "react";
import Link from "./link";
import { ChevronRight } from "lucide-react";
import type { KitchenItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44, K_BUTTON, K_BUTTON_QUIET } from "./kit";
import type { MemberNames } from "./members";
import { useGroupRole } from "./ledger-data";
import { useMemberNames } from "./people-data";
import { useWasteItem } from "./pantry-data";
import { ShareList } from "./pantry-ui";
import { wastePreview } from "./item-use";
import { itemActions, type ItemAction } from "./item-actions";
import type { ItemRef } from "./pantry";

// ── Wasted: the one confirm (the item page's, and the held item's menu) ──

/**
 * "Throw away the 400 g left (₹16.00)?" with who pays (the share list, or
 * a few words), then Keep it · Mark wasted. Waste moves money, so it is
 * never one tap: the item page shows this under Wasted, and the held item's
 * menu shows the same (PW-8).
 */
export function WasteConfirm({
  id,
  item,
  roster,
  meId,
  names,
  onKeep,
  onWaste,
  className,
}: {
  id?: string;
  item: KitchenItem;
  /** The group's members in its order; null for your own item, or while they load. */
  roster: readonly string[] | null;
  meId: string | null;
  names: MemberNames;
  onKeep: () => void;
  onWaste: () => void;
  className?: string;
}) {
  const preview = wastePreview({ item, members: roster ?? [], meId, names });
  const waiting = item.pantry.kind === "group" && roster === null;
  return (
    <section id={id} aria-label="Waste preview" className={cn("space-y-3 rounded-cp-card bg-card p-5 shadow-cp-card", className)}>
      <p className="text-[15px] font-medium">{preview.question}</p>
      {waiting ? (
        <Skeleton className="h-10 w-full" />
      ) : preview.lines.length > 0 && preview.lines.length <= 8 ? (
        <ShareList lines={preview.lines} currency={item.currency} />
      ) : (
        <p className="text-sm font-normal text-muted-foreground">{preview.short ?? preview.explain}</p>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Button type="button" variant="ghost" className={K_BUTTON_QUIET} onClick={onKeep}>
          Keep it
        </Button>
        <Button type="button" variant="destructive" className={K_BUTTON} disabled={waiting} onClick={onWaste}>
          Mark wasted
        </Button>
      </div>
    </section>
  );
}

// ── The held item's menu ──────────────────────────────────────────

/** What was held: the item (null until it is read), and the row's own Use when it logs your usual at once. */
export interface ItemMenuTarget {
  name: string;
  ref: ItemRef;
  item: (KitchenItem & { canUse?: boolean }) | null;
  /** The row's Use button: "2 onions", logged at once with Undo. Null when the row's Use opens Use. */
  use: { words: string; run: () => void } | null;
}

const SHEET_CLASS = cn(
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-hidden rounded-t-[28px] border-x-0 bg-card px-5 pt-2.5 shadow-2xl focus:outline-none",
  "min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
);
const ROW =
  "flex min-h-[52px] w-full items-center gap-2 rounded-[14px] bg-background px-3.5 text-left text-base font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Press and hold an item (a Pantry row, one of Home's use-soon rows) and
 * this sheet opens (the canvas's AppGestures): Use [your usual] · Use some… ·
 * Cook with it · Wasted · Open. Use is the row's own button, the same write
 * and the same Undo toast; Wasted turns the sheet into the waste confirm;
 * the rest are links. It is the shared bottom sheet, so ✕, a tap outside
 * (and, with PW-7, a drag down) close it.
 */
export function ItemActionsSheet({ target, onClose, meId }: { target: ItemMenuTarget | null; onClose: () => void; meId: string | null }) {
  // The last item stays on the sheet while it slides away.
  const last = React.useRef<ItemMenuTarget | null>(target);
  if (target) last.current = target;
  const shown = target ?? last.current;
  const [wasting, setWasting] = React.useState(false);
  React.useEffect(() => {
    if (target) setWasting(false);
  }, [target]);

  const actions = shown ? itemActions({ item: shown.item, ref: shown.ref, usualWords: shown.use?.words ?? null }) : [];
  return (
    <Sheet open={target !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="flex min-h-11 shrink-0 items-center truncate pr-12 text-[22px] font-medium tracking-[-0.01em]">
          {shown?.name ?? ""}
        </SheetTitle>
        {shown && wasting && shown.item ? (
          <SheetWaste target={{ ...shown, item: shown.item }} meId={meId} onKeep={() => setWasting(false)} onDone={onClose} />
        ) : (
          <ul aria-label={shown ? `${shown.name}: what to do` : undefined} className="mt-2 flex flex-col gap-2">
            {actions.map((a) => (
              <li key={a.id}>
                <MenuEntry action={a} onClose={onClose} onUse={() => shown?.use?.run()} onWaste={() => setWasting(true)} />
              </li>
            ))}
          </ul>
        )}
        <div aria-hidden className="h-6 shrink-0" />
      </SheetContent>
    </Sheet>
  );
}

function MenuEntry({ action, onClose, onUse, onWaste }: { action: ItemAction; onClose: () => void; onUse: () => void; onWaste: () => void }) {
  if (action.id === "use") {
    return (
      <button
        type="button"
        onClick={() => {
          onClose();
          onUse();
        }}
        className="flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-primary px-4 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {action.label}
      </button>
    );
  }
  if (action.id === "waste") {
    return (
      <button type="button" onClick={onWaste} className={ROW}>
        {action.label}
      </button>
    );
  }
  return (
    <Link href={action.href ?? "#"} onClick={onClose} className={ROW}>
      <span className="min-w-0 flex-1 truncate">{action.label}</span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Wasted, from the menu: the item page's confirm, with the group's members for who pays. */
function SheetWaste(props: { target: ItemMenuTarget & { item: KitchenItem }; meId: string | null; onKeep: () => void; onDone: () => void }) {
  const ref = props.target.ref;
  return ref.kind === "group" ? <GroupWaste {...props} orgId={ref.orgId} /> : <OwnWaste {...props} />;
}

function GroupWaste(props: { target: ItemMenuTarget & { item: KitchenItem }; orgId: string; meId: string | null; onKeep: () => void; onDone: () => void }) {
  const { members } = useGroupRole(props.orgId, props.meId);
  const names = useMemberNames(members.data);
  const roster = React.useMemo(() => (members.data ? members.data.map((m) => m.subjectId) : null), [members.data]);
  return <WasteStep {...props} roster={roster} names={names} />;
}

function OwnWaste(props: { target: ItemMenuTarget & { item: KitchenItem }; meId: string | null; onKeep: () => void; onDone: () => void }) {
  const names = useMemberNames();
  return <WasteStep {...props} roster={null} names={names} />;
}

function WasteStep({
  target,
  roster,
  names,
  meId,
  onKeep,
  onDone,
}: {
  target: ItemMenuTarget & { item: KitchenItem };
  roster: readonly string[] | null;
  names: MemberNames;
  meId: string | null;
  onKeep: () => void;
  onDone: () => void;
}) {
  const wasteItem = useWasteItem();
  return (
    <WasteConfirm
      className="mt-2 bg-background p-4 shadow-none"
      item={target.item}
      roster={roster}
      meId={meId}
      names={names}
      onKeep={onKeep}
      onWaste={() => {
        // At once (SM-5), as on the item page: none left on screen and the Undo toast up.
        onDone();
        void wasteItem({ ref: target.ref, item: target.item, meId, idempotencyKey: crypto.randomUUID() });
      }}
    />
  );
}
