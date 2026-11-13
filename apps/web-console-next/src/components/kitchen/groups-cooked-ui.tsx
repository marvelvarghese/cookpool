"use client";

import * as React from "react";
import Link from "./link";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { shareKey, sharePart } from "@/lib/transitions";
import { useGroups } from "./data";
import { KCard, K_ROWS, K_SECTION } from "./kit";
import { Face } from "./faces-ui";
import { memberLabel, type MemberNames } from "./members";
import { HOME_DISH_DAYS, feedCards, type FeedCard } from "./cooks";
import { useMyDishes } from "./cooks-data";
import { firstThree, groupsCookedMeta, youPaid } from "./new-home-look";
import { RING, RowsSkeleton, SaveRecipeIcon, SeeAllButton, pillClass } from "./new-home-parts-ui";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import { useRecipesInFull } from "./recipes-data";
import { feedRecipeFor, feedRecipeIds } from "./explore";

// Since cookpool-home HM-3 this feed lives on Kitchen (the new frame's
// `NewPantry`), under Finished this week; it left Home in HM-2.

/**
 * "Your groups cooked" (the board; RC-2's From your groups): one row for each
 * dish finished in one of your groups in the last 7 days — the cook's face,
 * the dish, "Anu · you had 1 · ₹54" (what you paid) — opening the dish, with Save
 * when it was cooked from a recipe you may see that isn't yours (RC-8).
 * Three, then See all.
 */
export function FromYourGroups({ meId, names }: { meId: string | null; names: MemberNames }) {
  const groups = useGroups();
  const dishes = useMyDishes(HOME_DISH_DAYS);
  const [now] = React.useState(() => new Date());
  const [all, setAll] = React.useState(false);
  const groupNames = React.useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name] as const)), [groups.data]);
  const cards = React.useMemo(
    () => feedCards(dishes.dishes, { meId, names, groupNames, now }),
    [dishes.dishes, meId, names, groupNames, now],
  );
  const hasGroups = (groups.data?.length ?? 0) > 0;
  // The recipes the cards' dishes were cooked from (RC-8): each shows once its read succeeds (a 404 is one you may not see).
  const recipeOf = React.useMemo(() => feedRecipeIds(dishes.dishes, cards.map((c) => c.dishId)), [dishes.dishes, cards]);
  const recipeIds = React.useMemo(() => [...new Set(recipeOf.values())], [recipeOf]);
  const recipes = useRecipesInFull(recipeIds);
  const shown = firstThree(cards, all);
  // What you paid for each (the board's "Anu · you had 1 · ₹54"): your line of its split.
  const paid = React.useMemo(() => youPaid(dishes.dishes, meId), [dishes.dishes, meId]);

  return (
    <section aria-labelledby="home-from-groups" className="min-w-0 space-y-2.5">
      <h2 id="home-from-groups" className={K_SECTION}>
        Your groups cooked
      </h2>
      {dishes.loading || groups.loading ? (
        <RowsSkeleton />
      ) : dishes.failed ? (
        <KCard className="flex min-h-16 items-center justify-between gap-3 px-4 py-2">
          <p className="text-sm font-normal text-muted-foreground">Couldn&apos;t load what your groups cooked.</p>
          <button type="button" className={pillClass()} onClick={dishes.reload}>
            Try again
          </button>
        </KCard>
      ) : cards.length === 0 ? (
        <KCard className="flex min-h-14 items-center px-4 text-sm font-normal text-muted-foreground">{hasGroups ? "Nothing finished this week" : "No groups yet"}</KCard>
      ) : (
        <div className={K_ROWS}>
          <ul className="divide-y divide-cp-line">
            {shown.rows.map((card) => (
              <li key={card.dishId}>
                <GroupsCookedRow card={card} paid={paid.get(card.dishId) ?? null} meId={meId} names={names} recipe={feedRecipeFor(card.dishId, recipeOf, recipes)} />
              </li>
            ))}
          </ul>
          {shown.more ? <SeeAllButton label={shown.label} all={all} onToggle={() => setAll((v) => !v)} /> : null}
        </div>
      )}
    </section>
  );
}

function GroupsCookedRow({ card, paid, meId, names, recipe }: { card: FeedCard; paid: string | null; meId: string | null; names: MemberNames; recipe: KitchenRecipe | null }) {
  const prefetch = usePrefetchKitchen();
  const cook = memberLabel(card.cookId, meId, names);
  return (
    <div className="flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-2">
      <Face subjectId={card.cookId} meId={meId} names={names} className="h-[42px] w-[42px] text-sm font-medium" />
      <Link
        {...pressIn(() => prefetch.dish(card.dishId, card.orgId))}
        href={card.href}
        share={shareKey("dish", card.dishId)}
        className={cn("flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-px rounded-lg", RING)}
      >
        <span {...sharePart("title")} className="truncate text-base font-medium">
          {card.name}
        </span>
        <span className="truncate text-[13px] font-normal tabular-nums text-muted-foreground">{groupsCookedMeta(card, cook, paid)}</span>
      </Link>
      {recipe && !recipe.mine ? <SaveRecipeIcon recipe={recipe} /> : null}
    </div>
  );
}
