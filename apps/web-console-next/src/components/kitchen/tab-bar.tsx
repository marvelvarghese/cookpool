"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { KITCHEN_TABS, isKitchenTabActive } from "./nav";
import { kitchenIcon } from "./icons";

/**
 * Cookpool's bottom tab bar, below 900px (CP-5): Home · Pantry · + Add ·
 * Groups · People. The centre Add is a raised circle that opens the Add
 * sheet, in the app's one primary green (SM-10: it was tomato, a second
 * "this is the action" colour). Fixed to the bottom with the home-indicator
 * inset; every cell is at least 60px tall.
 */
export function KitchenTabBar({ onAdd, addOpen }: { onAdd: () => void; addOpen: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      data-toast-above=""
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-safe backdrop-blur-md min-[900px]:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {KITCHEN_TABS.map((item) => {
          if (item.kind === "action") {
            return (
              <li key={item.id} className="flex justify-center">
                <button
                  type="button"
                  onClick={onAdd}
                  aria-haspopup="dialog"
                  aria-expanded={addOpen}
                  className="group -mt-6 flex min-h-[64px] w-full flex-col items-center gap-1 rounded-xl text-xs font-semibold text-foreground focus-visible:outline-none"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(31,122,77,0.32)] ring-4 ring-card transition-transform group-active:scale-95 group-focus-visible:ring-ring">
                    <Plus className="h-7 w-7" strokeWidth={2.5} aria-hidden />
                  </span>
                  <span>{item.label}</span>
                </button>
              </li>
            );
          }
          const active = isKitchenTabActive(item.id, pathname);
          const Icon = kitchenIcon(item.icon);
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active ? "font-bold text-primary" : "text-muted-foreground hover:text-foreground",
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
