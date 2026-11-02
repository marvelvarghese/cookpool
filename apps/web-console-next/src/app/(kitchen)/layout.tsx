"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useRequireAuth } from "@/lib/use-async";
import { Skeleton } from "@/components/ui/skeleton";
import { KitchenSidebar } from "@/components/kitchen/sidebar";
import { KitchenTabBar } from "@/components/kitchen/tab-bar";
import { AddSheet } from "@/components/kitchen/add-sheet";
import { KITCHEN_THEME_CLASSES } from "@/components/kitchen/theme";
import { isWideKitchenPage } from "@/components/kitchen/nav";

/**
 * Cookpool, the consumer app (epic cookpool-kitchen, CP-5), beside the admin
 * console's `(app)` shell. Mobile first: below 900px one column with a fixed
 * bottom tab bar (Home · Pantry · + Add · Groups · People); from 900px a left
 * sidebar with the same destinations. Home and Groups lay out in three
 * columns from 1280px, so they take the room beside the sidebar (CP-23).
 *
 * Every page needs a session: without one the person goes to sign-in and comes
 * back here afterwards (`returnHere`), which is what lets a join link survive
 * signing in. The frame paints at once; pages mount when the session is ready.
 *
 * The palette and font are scoped to this tree (`.cookpool`, light only); the
 * classes also go on <body> while this layout is mounted, so portalled UI —
 * the Add sheet, dialogs, toasts — matches. The admin console is untouched.
 */
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  const ready = useRequireAuth({ returnHere: true });
  const wide = isWideKitchenPage(usePathname());
  const [addOpen, setAddOpen] = React.useState(false);
  const openAdd = React.useCallback(() => setAddOpen(true), []);

  React.useEffect(() => {
    const body = document.body;
    body.classList.add(...KITCHEN_THEME_CLASSES);
    return () => body.classList.remove(...KITCHEN_THEME_CLASSES);
  }, []);

  return (
    <div className={cn(...KITCHEN_THEME_CLASSES, "min-h-dvh bg-background text-foreground min-[900px]:flex")}>
      <a
        href="#kitchen-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-card focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        Skip to content
      </a>

      {ready ? (
        <KitchenSidebar onAdd={openAdd} addOpen={addOpen} />
      ) : (
        <aside aria-hidden className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r bg-card min-[900px]:block" />
      )}

      <main
        id="kitchen-main"
        className={cn(
          "mx-auto w-full min-w-0 max-w-2xl px-4",
          "pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-[calc(env(safe-area-inset-top)+1.25rem)]",
          "min-[900px]:max-w-5xl min-[900px]:flex-1 min-[900px]:px-10 min-[900px]:pb-14 min-[900px]:pt-10",
          wide && "min-[1280px]:max-w-[90rem]",
        )}
      >
        {ready ? children : <KitchenSkeleton />}
      </main>

      {ready ? <KitchenTabBar onAdd={openAdd} addOpen={addOpen} /> : null}
      {ready ? <AddSheet open={addOpen} onOpenChange={setAddOpen} /> : null}
    </div>
  );
}

function KitchenSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="h-14 w-full rounded-2xl" />
      <Skeleton className="h-36 w-full rounded-[20px]" />
      <Skeleton className="h-28 w-full rounded-[20px]" />
    </div>
  );
}
