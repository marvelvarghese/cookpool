"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { PlanScreen } from "@/components/kitchen/plan-ui";

/**
 * A recipe's plan (cookpool-guided GC-6, design §3.5): the size switch, In
 * all · Hands on · Waiting, every step's range at that size with its rule,
 * a bar and Meanwhile under a hands-off step, then Start step by step. It
 * is the recipe's own static shell (`/recipes/_/plan`, the `[recipeId]`
 * layout's), and exists only in the new frame: a prod visitor is sent Home.
 */
export default function RecipePlanPage() {
  const shows = useNewFrameOnly("/recipes/:recipeId/plan");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <PlanScreen />;
}
