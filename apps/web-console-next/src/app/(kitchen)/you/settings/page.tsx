"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { YouSettings } from "@/components/kitchen/you-settings-ui";

/**
 * Settings (cookpool-recipes RC-2, design §1.4): what You's gear opens in the
 * new frame — today's You rows (your name, how you sign in, notifications,
 * install, sign out), under You. In today's frame those rows are `/you`
 * itself, so a visitor here is sent there.
 */
export default function YouSettingsPage() {
  const shows = useNewFrameOnly("/you/settings");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <YouSettings title="Settings" sub />;
}
