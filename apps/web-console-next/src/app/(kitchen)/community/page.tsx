"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { CommunityScreen } from "@/components/kitchen/community-ui";

/**
 * Community (cookpool-community CM-5, design §4): the Cook tab's shell — Community, the bell, the search field, and where CM-6's feed goes; HandleSetup the first time without a profile. It exists only in the new frame: today's visitor is sent elsewhere
 * (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/community");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <CommunityScreen />;
}
