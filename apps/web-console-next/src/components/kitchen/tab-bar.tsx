"use client";

import * as React from "react";
import Link from "./link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { isTabActiveIn, kitchenTabs } from "./nav";
import { kitchenIcon } from "./icons";

/**
 * Cookpool's bottom tab bar, below 900px (CP-5): Home · Pantry · + Add ·
 * Groups · People. The centre Add is a raised circle that opens the Add
 * sheet, in the app's one primary green (SM-10: it was tomato, a second
 * "this is the action" colour). Fixed to the bottom with the home-indicator
 * inset; every cell is at least 60px tall.
 *
 * In the new frame (`newFrame`, cookpool-recipes RC-2): Home · Pantry · Cook ·
 * Money · You, with no + Add, on the revamp's floating bar (RV-2,
 * `FloatingTabBar`).
 */
export function KitchenTabBar({ onAdd, addOpen, newFrame = false }: { onAdd: () => void; addOpen: boolean; newFrame?: boolean }) {
  return newFrame ? <FloatingTabBar /> : <TodayTabBar onAdd={onAdd} addOpen={addOpen} />;
}

/** Today's tab bar (prod): Home · Pantry · + Add · Groups · People. */
function TodayTabBar({ onAdd, addOpen }: { onAdd: () => void; addOpen: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      data-toast-above=""
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-safe backdrop-blur-md min-[900px]:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {kitchenTabs(false).map((item) => {
          if (item.kind === "action") {
            return (
              <li key={item.id} className="flex justify-center">
                <button
                  type="button"
                  onClick={onAdd}
                  aria-haspopup="dialog"
                  aria-expanded={addOpen}
                  className="group -mt-6 flex min-h-[64px] w-full flex-col items-center gap-1 rounded-xl text-xs font-medium text-foreground focus-visible:outline-none"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_hsl(var(--primary)/0.32)] ring-4 ring-card transition-transform group-active:scale-95 group-focus-visible:ring-ring">
                    <Plus className="h-7 w-7" strokeWidth={2.5} aria-hidden />
                  </span>
                  <span>{item.label}</span>
                </button>
              </li>
            );
          }
          const active = isTabActiveIn(false, item.id, pathname);
          const Icon = kitchenIcon(item.icon);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 1.9} aria-hidden />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The new frame's tab bar (cookpool-revamp RV-2, design §3, the `HomeRevamp`
 * board's <nav>): it floats 12px from the sides and 14px from the bottom (or
 * above the home indicator, whichever is higher), radius 24, on `nav-bg` (ink
 * in light mode, the card in dark). The current tab is filled with the accent,
 * its words `on-accent`; the others are `nav-ink`. Labels are 11px, Medium.
 */
function FloatingTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      data-toast-above=""
      // It stays put while the page moves (RC-11's page transitions).
      data-vt-keep="tabs"
      className={cn(
        "fixed inset-x-3 bottom-[max(14px,env(safe-area-inset-bottom))] z-40 mx-auto max-w-lg",
        "h-[68px] rounded-[24px] bg-cp-nav-bg p-1.5 shadow-cp-nav min-[900px]:hidden",
      )}
    >
      <ul className="grid h-full grid-cols-5 items-center">
        {kitchenTabs(true).map((item) => {
          if (item.kind !== "link") return null;
          const active = isTabActiveIn(true, item.id, pathname);
          const Icon = kitchenIcon(item.icon);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-[18px] text-[11px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "bg-primary text-primary-foreground" : "text-cp-nav-ink",
                )}
              >
                <Icon className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
