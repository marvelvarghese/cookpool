"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { NewRecipe } from "@/components/kitchen/recipe-photo-ui";

/**
 * New recipe (cookpool-recipes RC-5, design §3.5): name, serves, minutes,
 * ingredients with one main, steps, then Save, which opens it. It exists
 * only in the new frame: a prod visitor is sent Home. Recipe from a photo
 * (cookpool-ai AI-9) starts here too, when AI is on (`?photo=1` opens it).
 */
export default function NewRecipePage() {
  const shows = useNewFrameOnly("/recipes/new");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <NewRecipe />;
}
