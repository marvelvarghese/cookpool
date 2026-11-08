"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { BlockedPeopleScreen } from "@/components/kitchen/community-ui";

/**
 * Blocked people (CM-5): each with Unblock. It exists only in the new frame: today's visitor is sent elsewhere
 * (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/you/blocked");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <BlockedPeopleScreen />;
}
