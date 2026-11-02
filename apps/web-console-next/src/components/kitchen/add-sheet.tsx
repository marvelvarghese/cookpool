"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { ADD_SECONDARY, ADD_TILES, groupActionHref, type AddAction } from "./nav";
import { kitchenIcon } from "./icons";
import { CLOSE_44, K_BUTTON, SoonBadge } from "./kit";
import { useGroups, useProfile } from "./data";
import { GroupPickerList } from "./group-picker";
import { useMemberNames, useMyRoles } from "./people-data";
import { useItemsByRef, useLogUse, useUsuals } from "./pantry-data";
import { DO_IT_AGAIN_ROWS, doItAgainRows, usualRef, usualsThatFit, type DoItAgainRow } from "./quick-use";

const TILE_TONES: Record<string, string> = {
  use: "bg-cp-herb-tint text-primary",
  cook: "bg-cp-tomato-tint text-cp-tomato",
  buy: "bg-cp-soon-tint text-cp-soon",
  bill: "bg-cp-owed-tint text-cp-owed",
};

/**
 * "+ Add" (CP-5): what happened? Four big tiles, "Do it again" (CP-13) and
 * two secondary actions. A tile whose feature has not shipped shows "Soon"
 * and does nothing (aria-disabled, still focusable so it can be discovered);
 * a live one is a link that closes the sheet. A tile that needs a group first
 * ("I paid a bill", CP-8) turns the sheet into a searchable group picker, then
 * goes to that group — leaving out groups the person only views (CP-9). "Do
 * it again" logs one of your usuals in one tap — the same amount for the same
 * people — and closes on the Undo toast. A bottom sheet on phones, a floating
 * panel from 900px.
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
              Pick what you did, or log one of your usuals again in one tap.
            </SheetDescription>

            <ul className="mt-4 grid grid-cols-2 gap-3">
              {ADD_TILES.map((tile) => (
                <li key={tile.id} className="min-w-0">
                  <AddTile action={tile} onNavigate={close} onPick={pickFor} />
                </li>
              ))}
            </ul>

            <DoItAgain onLogged={close} />

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

/** Usuals whose items are read for "Do it again": a couple beyond the rows shown, so a usual that no longer fits is replaced. */
const DO_IT_AGAIN_READS = DO_IT_AGAIN_ROWS + 2;

/**
 * "Do it again" (CP-13): your top usuals as one-tap rows — "Milk · 1 glass",
 * "Flat 4B · you and Anu", what it costs now — each logging that again at
 * once, with the ten-second Undo toast. A usual whose amount no longer fits
 * what is left is left out. Nothing shows until you have usuals.
 */
function DoItAgain({ onLogged }: { onLogged: () => void }) {
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const usuals = useUsuals();
  const names = useMemberNames();
  const { toast } = useToast();
  const logUse = useLogUse();
  const fit = React.useMemo(() => usualsThatFit(usuals.data ?? []).slice(0, DO_IT_AGAIN_READS), [usuals.data]);
  const refs = React.useMemo(() => fit.map(usualRef), [fit]);
  const items = useItemsByRef(refs);
  const rows = doItAgainRows(fit, items, { meId, names });
  const [pending, setPending] = React.useState<string | null>(null);

  if (usuals.loading || profile.loading) {
    return (
      <div className="mt-4 space-y-2" aria-hidden>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-14 w-full rounded-[18px]" />
      </div>
    );
  }
  if (usuals.error || rows.length === 0) return null;

  const again = async (row: DoItAgainRow) => {
    if (!row.item || pending) return;
    setPending(row.key);
    const r = await logUse({
      ref: row.ref,
      item: row.item,
      qtyMilli: row.qtyMilli,
      consumers: row.consumers,
      idempotencyKey: crypto.randomUUID(),
      what: row.words,
      inPantry: true,
      meId,
      names,
    });
    setPending(null);
    if (r.ok) onLogged();
    else toast({ kind: "error", title: `Couldn't log ${row.title}`, description: r.message });
  };

  return (
    <section aria-labelledby="add-sheet-again" className="mt-4">
      <h3 id="add-sheet-again" className="mb-2 px-1 text-sm font-bold text-muted-foreground">
        Do it again
      </h3>
      <ul className="divide-y rounded-[18px] border">
        {rows.map((row) => {
          const busy = pending === row.key;
          return (
            <li key={row.key}>
              <button
                type="button"
                aria-label={row.label}
                aria-disabled={!row.item || (pending !== null && !busy) ? true : undefined}
                aria-busy={busy || undefined}
                onClick={() => void again(row)}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors first:rounded-t-[18px] last:rounded-b-[18px]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  row.item ? "hover:bg-accent" : "cursor-wait",
                )}
              >
                <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cp-herb-tint text-primary">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" strokeWidth={2.2} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{row.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.meta}</span>
                </span>
                <span className="shrink-0 text-right">
                  {row.cost ? (
                    <span className="block text-sm font-bold tabular-nums">{row.cost}</span>
                  ) : (
                    <Skeleton className="h-4 w-12" />
                  )}
                  <span className="block text-xs font-bold text-primary">Log</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
