"use client";

import * as React from "react";
import type { KitchenRecipe, RecipeMatchResponse } from "@saas/contracts/kitchen";
import { foodAsks } from "./always-have";
import { FoodAskListView } from "./always-have-views";
import { useAnswerFood, useAnsweredNames } from "./recipe-travel-data";

/**
 * The food ask on a recipe's page (cookpool-recipes RC-8, design §2): an
 * item your pantries hold that links to no food, and looks like a missing
 * line's ("Kanda onion" beside Onions), gets one small card — "Use Kanda
 * onion for Onions?", Yes and No — once per name. Either answer is kept for that
 * name in each pantry holding it, and the match is read again.
 */

/** The asks for a recipe at what its match found. An answered name goes at once and never comes back. */
export function FoodAsks({ recipe, match }: { recipe: Pick<KitchenRecipe, "lines">; match: Pick<RecipeMatchResponse, "lines" | "unlinked"> | null }) {
  const [answered, markAnswered] = useAnsweredNames();
  const answer = useAnswerFood();
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(() => new Set());
  const asks = React.useMemo(() => foodAsks(recipe, match, answered), [recipe, match, answered]);
  return (
    <FoodAskListView
      asks={asks}
      busy={busy}
      onAnswer={(ask, yes) => {
        setBusy((b) => new Set(b).add(ask.nameKey));
        void answer(ask, yes).then((ok) => {
          setBusy((b) => {
            const next = new Set(b);
            next.delete(ask.nameKey);
            return next;
          });
          if (ok) markAnswered(ask.nameKey);
        });
      }}
    />
  );
}
