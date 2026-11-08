"use client";

import * as React from "react";
import Link from "./link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ADD_TILES, groupActionHref, type AddAction } from "./nav";
import { kitchenIcon } from "./icons";
import { CLOSE_44, K_BUTTON } from "./kit";
import { BackControl } from "./back-ui";
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
 * "+ Add" (CP-5; SM-10 as the canvas draws it): the four things that happen
 * — Used · Cooked · Bought · Paid a bill — as big tiles, and nothing else
 * (Home's row of usuals and Use's recents do "again"). A tile is a link that
 * closes the sheet; "Paid a bill" needs a group first, so it turns the sheet
 * into the group picker, then goes to that group — leaving out groups the
 * person only views (CP-9). The title and × never scroll away: only the list
 * under them does. A bottom sheet on phones, a floating panel from 900px.
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

  // Each opening starts at the tiles.
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
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SHEET_CLASS, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
        {picking ? (
          <>
            <div className="flex min-h-11 shrink-0 items-center gap-1 pr-12">
              <BackControl onClick={() => setPicking(null)} />
              <SheetTitle className="text-[22px] font-extrabold">Which group?</SheetTitle>
            </div>
            <div className="-mx-4 mt-2 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {groups.loading ? (
                <div className="space-y-2" aria-hidden>
                  <Skeleton className="h-14 w-full rounded-[18px]" />
                  <Skeleton className="h-14 w-full rounded-[18px]" />
                </div>
              ) : list.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border p-4">
                  <p className="text-[15px] font-semibold">No group yet</p>
                  <Button asChild className={K_BUTTON}>
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
            <SheetTitle className="flex min-h-11 shrink-0 items-center pr-12 text-[22px] font-extrabold">Add</SheetTitle>
            <div className="-mx-4 mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <ul className="grid grid-cols-2 gap-3">
                {ADD_TILES.map((tile) => (
                  <li key={tile.id} className="min-w-0">
                    <AddTile action={tile} onNavigate={close} onPick={pickFor} />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// The sheet itself never scrolls (its title and × stay put); the part under the title does.
const SHEET_CLASS = cn(
  "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-hidden rounded-t-[28px] border-x-0 bg-background px-4 pt-2.5 shadow-2xl focus:outline-none",
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
      <span aria-hidden className={cn("grid h-12 w-12 place-items-center rounded-2xl", TILE_TONES[action.id])}>
        <Icon className="h-6 w-6" strokeWidth={2} />
      </span>
      <span className="block text-[17px] font-extrabold leading-tight">{action.label}</span>
    </>
  );
  const tileClass =
    "flex h-full min-h-[108px] w-full flex-col items-center justify-center gap-2.5 rounded-[22px] border bg-card p-3 text-center transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (action.pickGroup) {
    return (
      <button type="button" onClick={() => onPick(action)} className={tileClass}>
        {body}
      </button>
    );
  }
  return (
    <Link href={action.href} onClick={onNavigate} className={tileClass}>
      {body}
    </Link>
  );
}
