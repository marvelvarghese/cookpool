"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ADD_SECONDARY, ADD_TILES, type AddAction } from "./nav";
import { kitchenIcon } from "./icons";
import { CLOSE_44, SoonBadge } from "./kit";

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
 * link that closes the sheet. A bottom sheet on phones, a floating panel from
 * 900px.
 */
export function AddSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[24px] border-x-0 px-4 pt-3 shadow-2xl",
          "min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
          CLOSE_44,
        )}
      >
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border min-[900px]:hidden" />
        <SheetTitle className="pr-12 text-xl font-extrabold">What happened?</SheetTitle>
        <SheetDescription className="mt-1 text-sm">
          Pick what you did. Anything marked Soon arrives with pantries and the ledger.
        </SheetDescription>

        <ul className="mt-4 grid grid-cols-2 gap-3">
          {ADD_TILES.map((tile) => (
            <li key={tile.id} className="min-w-0">
              <AddTile action={tile} onNavigate={close} />
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
      </SheetContent>
    </Sheet>
  );
}

function AddTile({ action, onNavigate }: { action: AddAction; onNavigate: () => void }) {
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
