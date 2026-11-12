"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { newFrame } from "@/lib/features";
import { useRequireAuth } from "@/lib/use-async";
import { markNameAsked, nameAskedFor } from "@/lib/first-run";
import { signingOut } from "@/lib/sign-out";
import { Skeleton } from "@/components/ui/skeleton";
import { KitchenSidebar } from "@/components/kitchen/sidebar";
import { KitchenTabBar } from "@/components/kitchen/tab-bar";
import { AddSheet } from "@/components/kitchen/add-sheet";
import { SessionBar } from "@/components/kitchen/session-bar";
import { AppNotify } from "@/components/kitchen/notify-device";
import { BackTrailRecorder } from "@/components/kitchen/back-ui";
import { PageTransitions } from "@/components/kitchen/transition-ui";
import { EdgeSwipeBack, PullToRefresh, TabSwipe } from "@/components/kitchen/gestures-ui";
import { KITCHEN_NEW_LOOK_CLASS, KITCHEN_THEME_CLASSES } from "@/components/kitchen/theme";
import { useKitchenBodyTheme } from "@/components/kitchen/theme-scope";
import { isWideKitchenPage, tabBarHidden } from "@/components/kitchen/nav";
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
 * The frame's gestures (PW-7, gestures-ui.tsx): the lists pull to refresh in
 * `<main>`, and on the installed iPhone a swipe from the left edge goes back
 * by the back control's rule, sliding `<main>` away. Sheets drag away by
 * themselves (the shared sheet). In the new frame, a sideways swipe on a
 * tab's root goes to the tab beside it (RV-9, `TabSwipe`).
 *
 * The palette and font are scoped to this tree (`.cookpool`; dark only in the new look); the
 * classes also go on <body> while this layout is mounted, so portalled UI —
 * the Add sheet, dialogs, toasts — matches. The admin console is untouched.
 *
 * THE NEW FRAME (cookpool-recipes RC-2, `newFrame()`: everywhere but prod):
 * the tab bar and the sidebar list Home · Pantry · Cook · Money · You, with
 * no + Add (and no Add sheet), and while a cooking session is open the
 * session's bar sits above the tab bar (`SessionBar`, RC-6; the sidebar's
 * footer from 900px). It is decided in the browser once the session is
 * ready, so the prerendered frame is the same for both.
 *
 * THE NEW LOOK (cookpool-revamp RV-2): in the new frame the wrapper and <body>
 * also get `KITCHEN_NEW_LOOK_CLASS`, so the palette follows the device into
 * dark mode; it is read at mount, before the session is ready, so the frame
 * turns dark as early as it can (the prerendered skeleton is light).
 *
 * PAGE TRANSITIONS (cookpool-recipes RC-11, new frame only): every step
 * between screens animates by its kind with the View Transitions API
 * (`PageTransitions`, transition-ui.tsx), while the tab bar, the sidebar and
 * the session bar stay put (`data-vt-keep`).
 */
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  const ready = useRequireAuth({ returnHere: true, signOutOnUnauthorized: true });
  // Read only where `ready` (the browser, after hydration): the host names the environment.
  const frameNew = ready && newFrame();
  const pathname = usePathname();
  const wide = isWideKitchenPage(pathname);
  // The query (Cooked! is `?cooked=1`) is read in a Suspense'd probe, so the page stays static.
  const [search, setSearch] = React.useState("");
  const barHidden = tabBarHidden(frameNew, pathname, search);
  useAskForNameOnce(ready);
  const [addOpen, setAddOpen] = React.useState(false);
  const openAdd = React.useCallback(() => setAddOpen(true), []);
  const frame = React.useRef<HTMLDivElement>(null);
  const main = React.useRef<HTMLElement>(null);

  const newLook = useNewLook();
  useKitchenBodyTheme(newLook);

  return (
    // `overflow-x-clip`: nothing in the frame widens the page — not even `<main>` while
    // the edge swipe slides it away, which would let the phone pan or zoom out (PW-7).
    <div
      ref={frame}
      data-tabbar={frameNew ? (barHidden ? "hidden" : "shown") : undefined}
      className={cn(...KITCHEN_THEME_CLASSES, newLook && KITCHEN_NEW_LOOK_CLASS, "min-h-dvh overflow-x-clip bg-background text-foreground min-[900px]:flex")}
    >
      <React.Suspense fallback={null}>
        <SearchProbe onSearch={setSearch} />
      </React.Suspense>
      <a
        href="#kitchen-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-card focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        Skip to content
      </a>

      {ready ? (
        <KitchenSidebar onAdd={openAdd} addOpen={addOpen} newFrame={frameNew} />
      ) : (
        <aside aria-hidden className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r bg-card min-[900px]:block" />
      )}

      <main
        ref={main}
        id="kitchen-main"
        className={cn(
          "mx-auto w-full min-w-0 max-w-2xl px-4",
          "pb-[var(--cp-main-bottom,calc(env(safe-area-inset-bottom)+6.5rem))] pt-[calc(env(safe-area-inset-top)+1.25rem)]",
          "min-[900px]:max-w-5xl min-[900px]:flex-1 min-[900px]:px-10 min-[900px]:pb-14 min-[900px]:pt-10",
          wide && "min-[1280px]:max-w-[90rem]",
        )}
      >
        <PullToRefresh surface={main} enabled={ready}>
          {ready ? children : <KitchenSkeleton />}
        </PullToRefresh>
      </main>

      {frameNew ? <SessionBar /> : null}
      {ready && !barHidden ? <KitchenTabBar onAdd={openAdd} addOpen={addOpen} newFrame={frameNew} /> : null}
      {ready && !frameNew ? <AddSheet open={addOpen} onOpenChange={setAddOpen} /> : null}
      {ready ? <AppNotify /> : null}
      {ready ? <EdgeSwipeBack frame={frame} page={main} /> : null}
      {/* Swiping between the five tabs on a phone (RV-9), in the new frame only. */}
      {frameNew ? <TabSwipe page={main} /> : null}
      {/* What Back may go back to (PW-3): the screens this frame has shown. */}
      <BackTrailRecorder />
      {/* Page transitions on phones (RC-11), in the new frame only: after the trail, whose counts they read. */}
      {frameNew ? <PageTransitions /> : null}
    </div>
  );
}

/** Reports the page's query (`?cooked=1` hides the tab bar on Cooked!); inside Suspense, as `useSearchParams` needs. */
function SearchProbe({ onSearch }: { onSearch: (search: string) => void }) {
  const search = useSearchParams()?.toString() ?? "";
  React.useEffect(() => onSearch(search), [search, onSearch]);
  return null;
}

/**
 * Whether this page shows the new look (`newFrame()`, RV-2): false while
 * prerendered and on the first render, so hydration matches, then read once.
 */
function useNewLook(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => setOn(newFrame()), []);
  return on;
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
