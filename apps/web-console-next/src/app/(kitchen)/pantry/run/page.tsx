"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { ShoppingRun } from "@/components/kitchen/shopping-run-ui";

/**
 * The shopping run (cookpool-pantry PN-6, design §6.3): what was finished,
 * what is running low and what you usually buy, ticked and added in one
 * write (`ShoppingRun`). It exists only in the new frame: today's frame
 * sends its visitor to the Pantry.
 */
export default function ShoppingRunPage() {
  const shows = useNewFrameOnly("/pantry/run");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <ShoppingRun />;
}
