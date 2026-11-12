"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { YouNameScreen } from "@/components/kitchen/you-home-ui";

/**
 * Name and handle (cookpool-revamp RV-6): You's Account row in the new
 * frame — the name your groups see, with Change your name, and your public
 * profile's @handle, counts and Edit. The rest of what this page held since
 * RC-2 (notifications, security, AI, install, sign out) is on You's lists
 * now. In today's frame those rows are `/you` itself, so a visitor here is
 * sent there.
 */
export default function YouSettingsPage() {
  const shows = useNewFrameOnly("/you/settings");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <YouNameScreen />;
}
