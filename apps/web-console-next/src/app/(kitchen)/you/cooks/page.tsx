"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { YourCooks } from "@/components/kitchen/profile-ui";

/**
 * You → Your recipes and cooks (cookpool-revamp RV-6): what `/you` showed in
 * the new frame before the `RvYou` board made You a list — your numbers,
 * Cooks a week, and Recipes | Cooks. It exists only in the new frame:
 * today's visitor is sent to You (`NEW_FRAME_ONLY`).
 */
export default function YouCooksPage() {
  const shows = useNewFrameOnly("/you/cooks");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <YourCooks />;
}
