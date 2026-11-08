"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { RecipeLinkScreen } from "@/components/kitchen/recipe-link-ui";

/**
 * A recipe's link (cookpool-recipes RC-8, design §5.1, §5.2): who shared
 * it, the recipe with what your pantries hold for each line, and Save to my
 * recipes — your own copy (`RecipeLinkScreen`). Signed out, sign-in brings
 * you back here (the kitchen layout's return). It exists only in the new
 * frame: a prod visitor is sent Home.
 */
export default function RecipeLinkPage() {
  const shows = useNewFrameOnly("/r/:code");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <RecipeLinkScreen />;
}
