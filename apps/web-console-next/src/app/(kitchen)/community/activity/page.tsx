"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { ActivityScreen } from "@/components/kitchen/community-activity-ui";

/**
 * Activity (CM-6): follow requests and what happened, by day; opening it marks it read. It exists only in the new frame: today's visitor is sent elsewhere
 * (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/community/activity");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <ActivityScreen />;
}
