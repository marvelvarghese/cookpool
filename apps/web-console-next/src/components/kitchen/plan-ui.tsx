"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { KCard, K_BUTTON_QUIET } from "./kit";
import { BackButton } from "./back-ui";
import { factorFromQuery, planOf, planSizes } from "./guided-steps";
import { WRITTEN_FACTOR, parseRecipeRef, sessionHref } from "./recipes";
import { useRecipeAtSize } from "./recipes-data";
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
 * The recipe is read at the size on screen (`?f=`, GC-7), so what cooks
 * learned comes at that size; until that read answers, the page shows the
 * last one it has — the other size's, or the recipe page's — with the
 * learned ranges scaled from the size it was read at (`learnedAt`).
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
  // The size first shown: the one asked for (planSizes puts it first), else the recipe's own.
  const [factor, setFactor] = React.useState(given ?? WRITTEN_FACTOR);
  const recipe = useRecipeAtSize(recipeId, code, factor);
  if (recipe.loading) return <PlanSkeleton />;
  if (recipe.error?.code === "not_found") return <RecipeNotFound />;
  if (recipe.error || !recipe.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this recipe. {recipe.error?.message ?? ""}</p>
        <Button variant="ghost" className={K_BUTTON_QUIET} onClick={recipe.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  const r = recipe.data.recipe;
  return (
    <PlanView
      back={<BackButton />}
      name={r.name}
      plan={planOf(r, factor, recipe.readAt)}
      sizes={planSizes(r, given)}
      onSize={setFactor}
      startHref={sessionHref(r.id, factor)}
    />
  );
}
