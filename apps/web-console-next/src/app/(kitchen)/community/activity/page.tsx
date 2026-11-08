"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { ActivityScreen } from "@/components/kitchen/community-ui";

/**
 * Activity (CM-6 fills it; CM-5 lays the route). It exists only in the new frame: today's visitor is sent elsewhere
 * (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/community/activity");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <ActivityScreen />;
}
