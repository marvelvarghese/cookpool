"use client";

import * as React from "react";
import Link from "./link";
import { Compass } from "lucide-react";
import { savedHubRows } from "./cook-hub";
import { CookHubView, HUB_QUIET, HubCommunityLink } from "./cook-hub-views";
import { useCookNow, useMyRecipes, usePrefetchRecipe } from "./recipes-data";
import { EXPLORE_HREF } from "./explore";
import { COMMUNITY_HREF } from "./community";
import { RecipePhotoEntry } from "./recipe-photo-ui";

/**
 * The Cook tab (cookpool-recipes RC-5; revamped in RV-4, the canvas's
 * `RvCook`): `/cook` in the new frame. "Cook" and New dish (a blank
 * session, the one main button); Find a recipe; Cook now (what you have
 * everything for) and Saved recipes, each row its tile, name and one tag,
 * three then See all; then New recipe and Explore (RC-8), From a photo
 * (cookpool-ai AI-9) and Community (cookpool-community CM-5), quiet; RV-16
 * drops their helper lines.
 */
export function CookHub() {
  const cookNow = useCookNow();
  const recipes = useMyRecipes();
  const [now] = React.useState(() => new Date());
  const saved = React.useMemo(() => (recipes.data ? savedHubRows(recipes.data, cookNow.data, now) : null), [recipes.data, cookNow.data, now]);
  const prefetch = usePrefetchRecipe();

  return (
    <CookHubView
      cookNow={cookNow.data}
      saved={saved}
      recipesLoading={recipes.loading}
      recipesFailed={!!recipes.error && !recipes.data}
      onReloadRecipes={recipes.reload}
      prefetch={prefetch}
      extraAction={
        <Link href={EXPLORE_HREF} className={HUB_QUIET}>
          <Compass className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          Explore
        </Link>
      }
      photoAction={<RecipePhotoEntry />}
      community={<HubCommunityLink href={COMMUNITY_HREF} />}
    />
  );
}
