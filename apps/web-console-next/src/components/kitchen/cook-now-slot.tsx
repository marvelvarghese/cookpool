"use client";

import * as React from "react";
import { homeCookNowCards } from "./cook-hub";
import { CookNowStrip } from "./cook-hub-views";
import { useCookNow, usePrefetchRecipe } from "./recipes-data";

/**
 * Home's "Cook now" (cookpool-recipes design §1.4, §5.4, RC-5): up to three
 * cards of what you can cook with what you have — 160 px wide, scrolling
 * sideways — each with its tile, its name and "Have all · for 3" in green or
 * "Missing 1 · yogurt" in muted text, opening the recipe; "See all" opens the
 * Cook tab. Nothing at all while Cook now has nothing (or can't be read).
 * The new Home mounts it between To do and From your groups.
 */
export function CookNow(_props: { meId: string | null }) {
  const cookNow = useCookNow();
  const prefetch = usePrefetchRecipe();
  const cards = React.useMemo(() => (cookNow.data ? homeCookNowCards(cookNow.data) : []), [cookNow.data]);
  return <CookNowStrip cards={cards} prefetch={prefetch} />;
}
