"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { useRequireAuth } from "@/lib/use-async";
import { markNameAsked, nameAskedFor } from "@/lib/first-run";
import { signingOut } from "@/lib/sign-out";
import { Skeleton } from "@/components/ui/skeleton";
import { KitchenSidebar } from "@/components/kitchen/sidebar";
import { KitchenTabBar } from "@/components/kitchen/tab-bar";
import { AddSheet } from "@/components/kitchen/add-sheet";
import { AppNotify } from "@/components/kitchen/notify-device";
import { BackTrailRecorder } from "@/components/kitchen/back-ui";
import { KITCHEN_THEME_CLASSES } from "@/components/kitchen/theme";
import { useKitchenBodyTheme } from "@/components/kitchen/theme-scope";
import { isWideKitchenPage } from "@/components/kitchen/nav";
import { useProfile } from "@/components/kitchen/data";
import { firstRunRedirect } from "@/components/kitchen/sign-in";

/**
 * Cookpool, the consumer app (epic cookpool-kitchen, CP-5), beside the admin
 * console's `(app)` shell. Mobile first: below 900px one column with a fixed
 * bottom tab bar (Home · Pantry · + Add · Groups · People); from 900px a left
 * sidebar with the same destinations. Home and Groups lay out in three
 * columns from 1280px, so they take the room beside the sidebar (CP-23).
 *
 * Every page needs a session: without one the person goes to sign-in and comes
 * back here afterwards (`returnHere`), which is what lets a join link survive
 * signing in. When the API stops accepting the session (a 401 on any request),
 * the token is cleared and sign-in says "You were signed out" before bringing
 * the person back (SI-5). The frame paints at once; pages mount when the
 * session is ready.
 *
 * Every screen that is not a tab has one back control (PW-3, back-ui.tsx):
 * the frame keeps count of the screens it has shown, so Back goes back to
 * them, or to the screen's parent when it was opened straight from outside.
 *
 * Someone who signed in before the Name step existed (SI-6) and still has no
 * name is sent to it once, from whatever kitchen page they open, and comes
 * back there; see `useAskForNameOnce`.
 *
 * Signed in, `AppNotify` keeps the icon badge on Home's to-do count and
 * this device's push subscription on the server (cookpool-app PW-6).
 *
 * The palette and font are scoped to this tree (`.cookpool`, light only); the
 * classes also go on <body> while this layout is mounted, so portalled UI —
 * the Add sheet, dialogs, toasts — matches. The admin console is untouched.
 */
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  const ready = useRequireAuth({ returnHere: true, signOutOnUnauthorized: true });
  const wide = isWideKitchenPage(usePathname());
  useAskForNameOnce(ready);
  const [addOpen, setAddOpen] = React.useState(false);
  const openAdd = React.useCallback(() => setAddOpen(true), []);

  useKitchenBodyTheme();

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
      {ready ? <AppNotify /> : null}
      {/* What Back may go back to (PW-3): the screens this frame has shown. */}
      <BackTrailRecorder />
    </div>
  );
}

/**
 * The once-only ask (SI-6): a profile that was read and has no name, on a
 * device that has not asked this person yet, goes to the Name step
 * (`/login?step=name&next=<this page>`). The device remembers the ask before
 * leaving, so the step's own checks — a failed read sends the person straight
 * back — can never loop; a failed read here asks nothing.
 */
function useAskForNameOnce(ready: boolean): void {
  const router = useRouter();
  const profile = useProfile({ enabled: ready });
  React.useEffect(() => {
    if (!ready || signingOut()) return;
    const user = profile.data;
    const read = profile.error ? { ok: false as const, status: 0 } : user ? { ok: true as const, user } : null;
    const { pathname, search, hash } = window.location;
    const to = firstRunRedirect(read, nameAskedFor(), `${pathname}${search}${hash}`);
    if (!to || !user) return;
    markNameAsked(user.id);
    router.replace(to);
  }, [ready, profile.data, profile.error, router]);
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
