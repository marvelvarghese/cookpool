"use client";

import * as React from "react";
import Link from "./link";
import { ReceiptText, X } from "lucide-react";
import type { SplitReminderInboxItem } from "@saas/contracts/kitchen";
import { dishHref } from "./dish";
import { useDismissSplitReminder } from "./cooked-data";
import { reminderSplitHref, reminderSub, reminderTitle } from "./cooked";
import { pillClass } from "./new-home-parts-ui";


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
        <li key={r.dish.id} data-split-reminder={r.dish.id} className="flex min-h-16 items-center gap-3 rounded-cp-card bg-card py-2.5 pl-3.5 pr-2 shadow-cp-card">
          <span aria-hidden className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[14px] bg-cp-owed-tint text-cp-owed">
            <ReceiptText className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={dishHref(r.dish.id)}
              className="block truncate rounded text-base font-medium leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {reminderTitle(r)}
            </Link>
            <p className="truncate text-[13px] font-normal text-muted-foreground tabular-nums">{reminderSub(r)}</p>
          </div>
          {/* One button per row (RV-3): Split; Dismiss is the quiet × after it, gone at once with Undo. */}
          <Link href={reminderSplitHref(r)} aria-label={`Split ${r.dish.name} with ${r.suggest.groupName}`} className={pillClass("main")}>
            Split
          </Link>
          <button
            type="button"
            onClick={() => dismiss(r)}
            aria-label={`Dismiss: ${reminderTitle(r)}`}
            className="grid h-11 w-9 shrink-0 place-items-center rounded-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
