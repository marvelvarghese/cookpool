"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ADD_SECONDARY, ADD_TILES, groupActionHref, type AddAction } from "./nav";
import { kitchenIcon } from "./icons";
import { CLOSE_44, K_BUTTON, SoonBadge } from "./kit";
import { useGroups } from "./data";
import { GroupPickerList } from "./group-picker";
import { useMyRoles } from "./people-data";

const TILE_TONES: Record<string, string> = {
  use: "bg-cp-herb-tint text-primary",
  cook: "bg-cp-tomato-tint text-cp-tomato",
  buy: "bg-cp-soon-tint text-cp-soon",
  bill: "bg-cp-owed-tint text-cp-owed",
};

/**
 * "+ Add" (CP-5): what happened? Four big tiles and two secondary actions.
 * A tile whose feature has not shipped shows "Soon" and does nothing
 * (aria-disabled, still focusable so it can be discovered); a live one is a
 * link that closes the sheet. A tile that needs a group first ("I paid a
 * bill", CP-8) turns the sheet into a searchable group picker, then goes to
 * that group — leaving out groups the person only views (CP-9). A bottom
 * sheet on phones, a floating panel from 900px.
 */
export function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const allGroups = useGroups();
  const { roles } = useMyRoles();
  // A viewer adds nothing to a group; until roles load, every group is offered.
  const groups = React.useMemo(
    () => ({ ...allGroups, data: allGroups.data?.filter((g) => roles.get(g.id) !== "viewer") ?? null }),
    [allGroups, roles],
  );
  const [picking, setPicking] = React.useState<AddAction | null>(null);
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  // Each opening starts at "What happened?".
  React.useEffect(() => {
    if (!open) setPicking(null);
  }, [open]);

  const go = (action: AddAction, slug: string) => {
    close();
    router.push(groupActionHref(action, slug));
  };
  const pickFor = (action: AddAction) => {
    // One group: nothing to pick.
    const only = groups.data?.length === 1 ? groups.data[0] : undefined;
    if (only) go(action, only.slug);
    else setPicking(action);
  };

  const list = groups.data ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={cn(SHEET_CLASS, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border min-[900px]:hidden" />
        {picking ? (
          <>
            <button
              type="button"
              onClick={() => setPicking(null)}
              className="-ml-2 mb-1 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </button>
            <SheetTitle className="pr-12 text-xl font-extrabold">Which group?</SheetTitle>
            <SheetDescription className="mt-1 text-sm">{picking.label}: pick the group it&apos;s split in.</SheetDescription>
            <div className="mb-4 mt-4">
              {groups.loading ? (
                <div className="space-y-2" aria-hidden>
                  <Skeleton className="h-14 w-full rounded-[18px]" />
                  <Skeleton className="h-14 w-full rounded-[18px]" />
                </div>
              ) : list.length === 0 ? (
                <div className="rounded-[18px] border p-4">
                  <p className="text-[15px] font-semibold">You&apos;re not in a group yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Bills are split inside a group. Start one first.</p>
                  <Button asChild className={cn(K_BUTTON, "mt-3")}>
                    <Link href="/groups?new=1" onClick={close}>
                      New group
                    </Link>
                  </Button>
                </div>
              ) : (
                <GroupPickerList groups={list} idPrefix="add-sheet-group" onPick={(slug) => go(picking, slug)} />
              )}
            </div>
          </>
        ) : (
          <>
            <SheetTitle className="pr-12 text-xl font-extrabold">What happened?</SheetTitle>
            <SheetDescription className="mt-1 text-sm">
              Pick what you did. Anything marked Soon arrives with pantries and dishes.
            </SheetDescription>

            <ul className="mt-4 grid grid-cols-2 gap-3">
              {ADD_TILES.map((tile) => (
                <li key={tile.id} className="min-w-0">
                  <AddTile action={tile} onNavigate={close} onPick={pickFor} />
                </li>
              ))}
            </ul>

            <ul className="mb-4 mt-3 divide-y rounded-[18px] border">
              {ADD_SECONDARY.map((action) => (
                <li key={action.id}>
                  <SecondaryAction action={action} onNavigate={close} />
                </li>
              ))}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

const SHEET_CLASS = cn(
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[24px] border-x-0 px-4 pt-3 shadow-2xl",
  "min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
);

function AddTile({
  action,
  onNavigate,
  onPick,
}: {
  action: AddAction;
  onNavigate: () => void;
  onPick: (action: AddAction) => void;
}) {
  const Icon = kitchenIcon(action.icon);
  const body = (
    <>
      <span className="flex w-full items-start justify-between gap-2">
        <span aria-hidden className={cn("grid h-11 w-11 place-items-center rounded-full", TILE_TONES[action.id])}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        {action.live ? null : <SoonBadge />}
      </span>
      <span className="mt-3 block text-[15px] font-bold leading-snug">{action.label}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{action.hint}</span>
    </>
  );
  const tileClass =
    "flex h-full min-h-[124px] w-full flex-col items-start rounded-[18px] border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (!action.live) {
    return (
      <button type="button" aria-disabled="true" className={cn(tileClass, "cursor-not-allowed")}>
        {body}
      </button>
    );
  }
  if (action.pickGroup) {
    return (
      <button type="button" onClick={() => onPick(action)} className={cn(tileClass, "hover:bg-accent")}>
        {body}
      </button>
    );
  }
  return (
    <Link href={action.href} onClick={onNavigate} className={cn(tileClass, "hover:bg-accent")}>
      {body}
    </Link>
  );
}

function SecondaryAction({ action, onNavigate }: { action: AddAction; onNavigate: () => void }) {
  const Icon = kitchenIcon(action.icon);
  const rowClass =
    "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left first:rounded-t-[18px] last:rounded-b-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const body = (
    <>
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{action.label}</span>
        <span className="block text-xs text-muted-foreground">{action.hint}</span>
      </span>
      {action.live ? <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden /> : <SoonBadge />}
    </>
  );
  if (!action.live) {
    return (
      <button type="button" aria-disabled="true" className={cn(rowClass, "cursor-not-allowed")}>
        {body}
      </button>
    );
  }
  return (
    <Link href={action.href} onClick={onNavigate} className={cn(rowClass, "hover:bg-accent")}>
      {body}
    </Link>
  );
}
