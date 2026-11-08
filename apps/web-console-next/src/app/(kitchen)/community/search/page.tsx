"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { PeopleSearchScreen } from "@/components/kitchen/community-ui";

/**
 * People search (CM-5, the canvas's `PeopleSearch`): name or @handle; empty, the suggestions with their why. It exists only in the new frame: today's visitor is sent elsewhere
 * (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/community/search");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <PeopleSearchScreen />;
}
