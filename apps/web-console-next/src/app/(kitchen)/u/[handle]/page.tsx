"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { PersonProfileScreen } from "@/components/kitchen/community-profile-ui";

/**
 * A cook's profile (CM-5, the canvas's `PersonProfile`). It exists only in the new frame: today's visitor is sent elsewhere
 * (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/u/:handle");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <PersonProfileScreen />;
}
