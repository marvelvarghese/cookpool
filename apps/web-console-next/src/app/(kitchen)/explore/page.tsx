"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { ExploreScreen } from "@/components/kitchen/explore-ui";

/**
 * Explore (cookpool-recipes RC-8, design §5.3): Cookpool's recipes, or the
 * ones your groups can see, searched and filtered by kind and by what you
 * can make, each with what you have for it (`ExploreScreen`). It exists only
 * in the new frame: a prod visitor is sent Home.
 */
export default function ExplorePage() {
  const shows = useNewFrameOnly("/explore");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <ExploreScreen />;
}
