"use client";

import * as React from "react";
import { myRecipeCards } from "./cook-hub";
import { CookHubView } from "./cook-hub-views";
import { useCookNow, useMyRecipes, usePrefetchRecipe, useRecipesInFull } from "./recipes-data";
import { ExploreButton } from "./explore-views";
import { CommunityEntry } from "./community-views";
import { COMMUNITY_HREF } from "./community";

/**
 * The Cook hub (cookpool-recipes RC-5, design §1.2, §5.4, the canvas's
 * `CookTab`): `/cook` in the new frame. From the top: "Cook"; Start cooking
 * (the one main button, in the cook colour: a blank session); Cook now — what
 * you can make with what you have, "Can make N" | "Missing 1 · N", each row
 * with Start, hidden when there is nothing; My recipes — how many, New recipe
 * and Explore beside it (RC-8), and a card per recipe, last cooked first,
 * with a tinted Start cooking. Above My recipes, Community (cookpool-community
 * CM-5): following cooks and what they make.
 */
export function CookHub() {
  const cookNow = useCookNow();
  const recipes = useMyRecipes();
  // Their ingredients' names, as each recipe is read in full (also warming its page).
  const ids = React.useMemo(() => (recipes.data ?? []).map((r) => r.id), [recipes.data]);
  const full = useRecipesInFull(ids);
  const [now] = React.useState(() => new Date());
  const cards = React.useMemo(() => (recipes.data ? myRecipeCards(recipes.data, full, now) : null), [recipes.data, full, now]);
  const prefetch = usePrefetchRecipe();

  return (
    <CookHubView
      cookNow={cookNow.data}
      cards={cards}
      recipesLoading={recipes.loading}
      recipesFailed={!!recipes.error && !recipes.data}
      onReloadRecipes={recipes.reload}
      prefetch={prefetch}
      extraAction={<ExploreButton />}
      community={<CommunityEntry href={COMMUNITY_HREF} />}
    />
  );
}

