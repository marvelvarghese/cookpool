"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { KCard, K_BUTTON } from "./kit";
import { BackButton } from "./back-ui";
import { factorFromQuery, planOf, planSizes } from "./guided-steps";
import { parseRecipeRef, sessionHref } from "./recipes";
import { useRecipe } from "./recipes-data";
import { RecipeNotFound } from "./recipe-views";
import { PlanSkeleton, PlanView } from "./plan-views";

/**
 * The plan (cookpool-guided GC-6, design §3.5, the canvas's
 * `GuideTimeline`): `/recipes/[id]/plan`, in the new frame only. It opens
 * from the recipe page's Steps and from the session's header (GC-5), at
 * their size: `?f=` (thousandths), switched with the recipe's own size.
 * Every range is `stepTimeAt` at the size on screen; Start step by step
 * opens the session at it. `?code=` lets a link holder read it.
 *
 * The recipe is read as the recipe page reads it (one cache entry, no size):
 * what cooks learned (GC-7) comes at the recipe's own size and is scaled to
 * the size on screen by each step's rule (guided-steps.ts's `learnedAt`).
 */
export function PlanScreen() {
  const recipeId = parseRecipeRef(usePathParam("/recipes/:recipeId", "recipeId"));
  const searchParams = useSearchParams();
  const code = searchParams?.get("code") ?? null;
  const given = factorFromQuery(searchParams?.get("f"));
  if (!recipeId) return <RecipeNotFound />;
  return <PlanLoader key={recipeId} recipeId={recipeId} code={code} given={given} />;
}

function PlanLoader({ recipeId, code, given }: { recipeId: string; code: string | null; given: number | null }) {
  const recipe = useRecipe(recipeId, code);
  if (recipe.loading) return <PlanSkeleton />;
  if (recipe.error?.code === "not_found") return <RecipeNotFound />;
  if (recipe.error || !recipe.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this recipe. {recipe.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={recipe.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  return <PlanAtSize recipe={recipe.data.recipe} given={given} />;
}

function PlanAtSize({ recipe, given }: { recipe: KitchenRecipe; given: number | null }) {
  const sizes = planSizes(recipe, given);
  const [factor, setFactor] = React.useState(sizes[0]!.factorMilli);
  const plan = planOf(recipe, factor);
  return <PlanView back={<BackButton />} name={recipe.name} plan={plan} sizes={sizes} onSize={setFactor} startHref={sessionHref(recipe.id, factor)} />;
}
