"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { CookSessionScreen } from "@/components/kitchen/cook-session-screen";

/**
 * Cooking (cookpool-recipes RC-6, design §4.2): the session, blank or from a
 * recipe (`?recipe=rcp_…&f=450`), kept on this device until Finish posts it
 * (`CookSessionScreen`). It exists only in the new frame: a prod visitor is
 * sent Home.
 */
export default function CookSessionPage() {
  const shows = useNewFrameOnly("/cook/session");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <CookSessionScreen />;
}
