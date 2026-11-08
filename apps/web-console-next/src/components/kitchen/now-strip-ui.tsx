"use client";

import * as React from "react";
import Link from "./link";
import { Check } from "lucide-react";
import type { UsualBucket } from "@saas/contracts/kitchen-usuals";
import { cn } from "@/lib/cn";
import { nowHeading, trayButton, trayLine, type NowChip, type TrayEntry } from "./now-strip";

/**
 * The Pantry's Now strip (cookpool-pantry PN-5, design §3, the canvas's
 * PantryNew): "NOW · MORNING", then a chip per thing — its name, the
 * suggested amount and why — that logs it in one tap with Undo, or, under
 * Log several, puts it in the tray (ticked while it is there). Nothing is
 * drawn when there is nothing to offer.
 */
export function NowStripView({
  bucket,
  chips,
  several,
  tray,
  onChip,
}: {
  bucket: UsualBucket;
  chips: readonly NowChip[];
  several: boolean;
  tray: readonly TrayEntry[];
  onChip: (chip: NowChip) => void;
}) {
  if (chips.length === 0) return null;
  const headingId = "pantry-now-h";
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-xs font-extrabold tracking-[0.06em] text-foreground/80">
          {nowHeading(bucket)}
        </h2>
        <span className="text-xs font-bold text-muted-foreground">{several ? "Tap each one you had" : "One tap logs it"}</span>
      </div>
      <ul className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:px-0">
        {chips.map((c) => {
          const on = several && tray.some((e) => e.itemId === c.id);
          return (
            <li key={c.id} className="shrink-0">
              <button
                type="button"
                aria-label={several ? `${on ? "Take out of" : "Add to"} the tray: ${c.label}` : `Log ${c.label}`}
                aria-pressed={several ? on : undefined}
                onClick={() => onChip(c)}
                className={cn(
                  "flex min-h-[76px] min-w-[112px] max-w-[180px] flex-col items-start gap-0.5 rounded-2xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-primary bg-[#E4F2EA]" : "border-[#E3E6E0] bg-card hover:bg-accent",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-[15px] font-extrabold">{c.name}</span>
                  {several ? (
                    <span
                      aria-hidden
                      className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full", on ? "bg-primary text-primary-foreground" : "border-[1.5px] border-[#C9CFC6] text-transparent")}
                    >
                      <Check className="h-3 w-3" strokeWidth={3.2} />
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate text-sm font-extrabold text-[#165C3A]">{c.words}</span>
                <span className="max-w-full truncate text-[11px] font-bold text-muted-foreground">{c.why}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Log several's tray (design §1.3, the canvas's QuickLog): what is in it in
 * one line ("1 glass milk · 2 eggs"), the one main button "Log 3 for you",
 * and "A meal for others? Cook it instead" — several things for other
 * people make a dish. It sits above the tab bar while it holds anything.
 */
export function LogTray({ tray, onLog }: { tray: readonly TrayEntry[]; onLog: () => void }) {
  if (tray.length === 0) return null;
  return (
    <div
      data-toast-above=""
      className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 -mx-4 flex flex-col gap-2 bg-background px-4 pb-1 pt-2.5 shadow-[0_-14px_14px_-6px_hsl(var(--background))] min-[900px]:bottom-6 min-[900px]:mx-0 min-[900px]:rounded-t-2xl min-[900px]:px-0"
    >
      <p className="truncate text-[13px] font-bold text-foreground/80">{trayLine(tray)}</p>
      <button
        type="button"
        onClick={onLog}
        className="min-h-[60px] w-full rounded-[18px] bg-primary px-4 text-[17px] font-extrabold text-primary-foreground shadow-[0_8px_24px_rgba(23,32,27,0.18)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-[900px]:shadow-none"
      >
        {trayButton(tray)}
      </button>
      <Link
        href="/cook"
        className="flex min-h-11 items-center self-center rounded-lg px-2 text-[13px] font-extrabold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        A meal for others? Cook it instead
      </Link>
    </div>
  );
}
