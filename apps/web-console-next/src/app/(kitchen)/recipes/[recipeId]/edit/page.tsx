"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useNewFrameOnly } from "@/components/kitchen/frame-ui";
import { EditRecipeScreen } from "@/components/kitchen/recipe-form-ui";

/**
 * Edit a recipe (cookpool-recipes RC-5): its owner's alone — the same form
 * as New recipe, plus Delete with Undo. Copies of it never change. It exists
 * only in the new frame: a prod visitor is sent Home.
 */
export default function EditRecipePage() {
  const shows = useNewFrameOnly("/recipes/:recipeId/edit");
  if (!shows) return <Skeleton className="h-8 w-32" aria-hidden />;
  return <EditRecipeScreen />;
}
