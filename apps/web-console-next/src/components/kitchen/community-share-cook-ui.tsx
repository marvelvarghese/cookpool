"use client";

import * as React from "react";
import Link from "./link";
import { ChevronRight, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CLOSE_44, K_ROWS } from "./kit";
import { useProfile } from "./data";
import { useMyDishes } from "./cooks-data";
import { FEED_DAYS } from "./cooks";
import { GREEN_BUTTON } from "./community-views";
import {
  COOK_SOMETHING,
  NO_COOKS_TO_SHARE,
  SHARE_A_COOK,
  shareCookChoices,
} from "./community-share-cook";

/**
 * Community's floating main button (RV-18, `RvCommunity`): "Share a cook".
 * It floats above the floating tab bar, and keeps its own room at the end of
 * the feed, so it never covers the last card. It opens a sheet of your latest cooks; each
 * opens Share this cook? on its dish (the existing flow, `?share=1`).
 */
export function ShareCookButton() {
  const [open, setOpen] = React.useState(false);
  return (
    // On a phone it floats above the tab bar, as the board draws it; the room it keeps at the
    // feed's end means it never covers the last card. From 900px it sticks at the column's foot.
    <div className="h-14 min-[900px]:sticky min-[900px]:bottom-6 min-[900px]:z-30 min-[900px]:h-auto">
      <div
        data-toast-above=""
        className="fixed inset-x-[18px] bottom-[calc(var(--cp-tabbar-space,calc(max(14px,env(safe-area-inset-bottom))+76px))+6px)] z-30 min-[900px]:static"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            "flex min-h-14 w-full items-center justify-center gap-2 rounded-[18px] bg-primary px-5 text-base font-medium text-primary-foreground shadow-cp-nav transition-colors hover:bg-primary/90",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden />
          {SHARE_A_COOK}
        </button>
      </div>
      {open ? <ShareCookSheet onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function ShareCookSheet({ onClose }: { onClose: () => void }) {
  const me = useProfile();
  const mine = useMyDishes(FEED_DAYS);
  const [now] = React.useState(() => new Date());
  const choices = React.useMemo(
    () => shareCookChoices(mine.dishes, me.data?.id ?? null, now),
    [mine.dishes, me.data, now],
  );
  const loading = mine.loading || me.loading;
  return (
    <Sheet open onOpenChange={(o) => (o ? undefined : onClose())}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className={cn(
          "mx-auto flex max-h-[80dvh] max-w-xl flex-col gap-3 rounded-t-[26px] border-x-0 bg-background px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 min-[900px]:bottom-6 min-[900px]:rounded-[26px] min-[900px]:border",
          CLOSE_44,
        )}
      >
        <div
          aria-hidden
          className="mx-auto h-[5px] w-10 shrink-0 rounded-full bg-cp-line min-[900px]:hidden"
        />
        <SheetTitle className="flex min-h-11 items-center pr-12 text-[17px] font-medium leading-snug">
          {SHARE_A_COOK}
        </SheetTitle>
        {loading ? (
          <Skeleton aria-hidden className="h-[162px] w-full rounded-cp-card" />
        ) : choices.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-cp-card bg-card px-5 py-8 text-center shadow-cp-card">
            <p className="text-base font-medium">
              {mine.failed ? "Couldn't load your cooks" : NO_COOKS_TO_SHARE}
            </p>
            {mine.failed ? (
              <button
                type="button"
                onClick={mine.reload}
                className={cn(
                  "flex min-h-11 items-center rounded-[14px] px-5 text-[15px] font-medium",
                  GREEN_BUTTON,
                )}
              >
                Try again
              </button>
            ) : (
              <Link
                href={COOK_SOMETHING.href}
                className={cn(
                  "flex min-h-11 items-center rounded-[14px] px-5 text-[15px] font-medium",
                  GREEN_BUTTON,
                )}
              >
                {COOK_SOMETHING.label}
              </Link>
            )}
          </div>
        ) : (
          <ul aria-label="Your latest cooks" className={K_ROWS}>
            {choices.map((c) => (
              <li key={c.id}>
                <Link
                  href={c.href}
                  onClick={onClose}
                  className="flex min-h-[54px] items-center gap-3 pl-4 pr-3.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {c.name}
                  </span>
                  <span className="shrink-0 text-[13px] font-normal text-muted-foreground">
                    {c.when}
                  </span>
                  <ChevronRight
                    className="h-[18px] w-[18px] shrink-0 text-muted-foreground"
                    strokeWidth={2}
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
