"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { newFrame } from "@/lib/features";
import { DEFAULT_PARENT, backParent, createTrail, type BackKnown, type Trail } from "./back";

/**
 * The one back control (cookpool-app PW-3): a chevron, top-left in the
 * header, a 44 px target, no word beside it. Every screen that is not a tab
 * has it (`BackButton`); the + Add sheet's "Which group?" step wears the same
 * one (`BackControl`, with its own action).
 */

// One per page load (back.ts's `createTrail`); none while prerendering.
const trail: Trail | null = typeof window === "undefined" ? null : createTrail(window.history);

const BACK_CONTROL =
  "-ml-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The control itself: what it does is the caller's. */
export function BackControl({ onClick, className }: { onClick: () => void; className?: string | undefined }) {
  return (
    <button type="button" onClick={onClick} aria-label="Back" className={cn(BACK_CONTROL, className)}>
      <ChevronLeft className="h-6 w-6" aria-hidden />
    </button>
  );
}

/**
 * What Back does on this screen: back when one of the app's own screens is
 * behind it (the trail), otherwise this screen is replaced by its parent
 * (`backParent`, from the address and what the screen `known`s) — never out
 * of the app. The iPhone's edge swipe (PW-7) runs the same action.
 */
export function useBack(known?: BackKnown): () => void {
  const router = useRouter();
  const pathname = usePathname();
  const parent = backParent(pathname, known, { newFrame: newFrame() }) ?? DEFAULT_PARENT;
  return React.useCallback(() => {
    if (trail?.canGoBack()) router.back();
    else router.replace(parent);
  }, [router, parent]);
}

// The back control on screen, so the edge swipe (PW-7) does exactly what it
// does — with what the screen knows (a dish's group), not just its address.
let shownBack: (() => void) | null = null;

/** What the back control on screen does, or null while none is shown. */
export function shownBackAction(): (() => void) | null {
  return shownBack;
}

/** A screen's back control (`useBack`). */
export function BackButton({ known, className }: { known?: BackKnown | undefined; className?: string | undefined }) {
  const back = useBack(known);
  React.useEffect(() => {
    shownBack = back;
    return () => {
      if (shownBack === back) shownBack = null;
    };
  }, [back]);
  return <BackControl onClick={back} className={className} />;
}

// ── Keeping the trail ─────────────────────────────────────────────

/**
 * Keeps the trail while the app's frame is up: mounted once, by the kitchen
 * layout. Each mount starts again from the screen it shows: opened from
 * outside, back from sign-in, or a reload.
 */
export function BackTrailRecorder() {
  React.useEffect(() => {
    if (!trail) return;
    trail.start();
    // In the capture phase: counted before Next's own listener restores the screen.
    const onPop = (event: PopStateEvent) => trail.pop(event.state);
    window.addEventListener("popstate", onPop, { capture: true });
    return () => {
      window.removeEventListener("popstate", onPop, { capture: true });
      trail.stop();
    };
  }, []);
  return null;
}
