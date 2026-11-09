"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { AiSettingsScreen } from "@/components/kitchen/ai-settings-ui";

/**
 * You → Cookpool AI (cookpool-ai AI-7, design §7): this device's AI switches,
 * today's use against the limits and what is sent. It exists only in the new
 * frame: today's visitor is sent to You (`NEW_FRAME_ONLY`).
 */
export default function Page() {
  const shows = useNewFrameOnly("/you/ai");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <AiSettingsScreen />;
}
