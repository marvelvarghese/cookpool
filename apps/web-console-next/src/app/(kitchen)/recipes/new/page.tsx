"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { NewRecipeScreen } from "@/components/kitchen/recipe-form-ui";

/**
 * New recipe (cookpool-recipes RC-5, design §3.5): name, serves, minutes,
 * ingredients with one main, steps, then Save, which opens it. It exists
 * only in the new frame: a prod visitor is sent Home.
 */
export default function NewRecipePage() {
  const shows = useNewFrameOnly("/recipes/new");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <NewRecipeScreen />;
}
