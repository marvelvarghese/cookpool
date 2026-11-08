"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { RecipeScreen } from "@/components/kitchen/recipe-ui";

/**
 * A recipe (cookpool-recipes RC-5, design §3): how much — by the main item
 * or the portions, every line following — what your pantries hold for each
 * line, its steps, and Start cooking at that size (`RecipeScreen`). It
 * exists only in the new frame: a prod visitor is sent Home.
 */
export default function RecipePage() {
  const shows = useNewFrameOnly("/recipes/:recipeId");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <RecipeScreen />;
}
