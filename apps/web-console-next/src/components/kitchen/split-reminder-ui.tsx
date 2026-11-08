"use client";

import * as React from "react";
import Link from "./link";
import { ReceiptText } from "lucide-react";
import type { SplitReminderInboxItem } from "@saas/contracts/kitchen";
import { Button } from "@/components/ui/button";
import { dishHref } from "./dish";
import { useDismissSplitReminder } from "./cooked-data";
import { reminderSplitHref, reminderSub, reminderTitle } from "./cooked";

/** A row's button: 44px tall (Home's To do). */
const ROW_BUTTON = "h-11 rounded-[14px] px-4 text-[15px] font-extrabold";

/**
 * Home's split reminders (cookpool-community CM-9, CM-8's
 * `InboxResponse.splitReminders`), at the top of To do in the new frame:
 * "Split Chicken curry with Flat 4B?", its servings and cost, Dismiss (gone at
 * once, with Undo) and Split (the dish page's Split with a group, starting on
 * that group).
 */
export function SplitReminderCards({ items }: { items: readonly SplitReminderInboxItem[] }) {
  const dismiss = useDismissSplitReminder();
  if (items.length === 0) return null;
  return (
    <ul aria-label="Split with a group" className="space-y-2">
      {items.map((r) => (
        <li key={r.dish.id} data-split-reminder={r.dish.id} className="space-y-2.5 rounded-[22px] border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#E6EEF8] text-[#1D4ED8]">
              <ReceiptText className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                href={dishHref(r.dish.id)}
                className="block break-words rounded text-base font-extrabold leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {reminderTitle(r)}
              </Link>
              <p className="truncate text-[13px] text-muted-foreground tabular-nums">{reminderSub(r)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className={ROW_BUTTON} onClick={() => dismiss(r)} aria-label={`Dismiss: ${reminderTitle(r)}`}>
              Dismiss
            </Button>
            <Button asChild className={ROW_BUTTON}>
              <Link href={reminderSplitHref(r)} aria-label={`Split ${r.dish.name} with ${r.suggest.groupName}`}>
                Split
              </Link>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
