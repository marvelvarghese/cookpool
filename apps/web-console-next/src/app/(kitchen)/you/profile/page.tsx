"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { HandleSetupScreen } from "@/components/kitchen/community-setup-ui";

/**
 * HandleSetup (CM-5, the canvas's `HandleSetup`): your public profile. It exists only in the new frame: today's visitor is sent elsewhere
 * (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/you/profile");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <HandleSetupScreen />;
}
