"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Pencil } from "lucide-react";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { KCard, K_BUTTON } from "./kit";
import { BackButton } from "./back-ui";
import { useProfile } from "./data";
import { savedCopyOf } from "./cook-hub";
import { WRITTEN_FACTOR, canEditRecipe, clampFactor, ingredientRows, parseRecipeRef, recipeEditHref, recipeHref, sessionHref, startLine } from "./recipes";
import { useCopyRecipe, useMyRecipes, useRecipe, useRecipeMatch, useSaveDishAsRecipe } from "./recipes-data";
import { canShareRecipe } from "./recipe-share";
import { ShareSheet } from "./recipe-share-ui";
import { ShareIconButton } from "./recipe-share-views";
import { FoodAsks } from "./food-ask-ui";
import { hasTimedSteps, recipePlanHref, stepRows } from "./guided-steps";
import { LongPrepCard } from "./long-prep-ui";
import {
  HowMuchCard,
  IngredientsSection,
  RecipeHeader,
  RecipeNotFound,
  RecipeSkeleton,
  SaveCopyView,
  StartCookingBar,
  StepsSection,
} from "./recipe-views";

/**
 * A recipe (cookpool-recipes RC-5, design §3, the canvas's `Recipe`),
 * `/recipes/[id]`, in the new frame only. Back; its name; who it is from
 * ("from Anu" with her face, or "by Cookpool") and its minutes; Edit for its
 * owner, Save (your own copy) for anyone else — "Saved" once you have one,
 * opening it.
 *
 * **How much**: the main item with − amount + (50 g a step, ½ for pieces and
 * spoons), the factor ("As written · serves 4", or "×0.45 · every line
 * follows" in dark), "Use all 450 g you have" when your pantries hold a
 * different amount of it, and Portions − about 2 +. Both set one factor, so
 * they stay linked, and every line follows (`scaleLine`). Then the
 * Ingredients, "Have 6 of 8 · 1 to get", each line with its dot and what your
 * pantries hold for it at that factor (the match, read again once the factor
 * settles); Steps, folded; and the one main button, Start cooking "For about
 * 2 · chicken 450 g", which opens the session at that factor.
 *
 * `?f=450` opens it scaled (the session's chip links here so); `?code=` lets
 * a link holder read and match it (RC-8's `/r/<code>`).
 *
 * RC-8: the owner's Share icon, beside Edit, opens "Who can see it" (Only
 * me · My groups · Anyone with the link); and under the ingredients, "Is
 * Kanda onion onion?" for an unlinked item that may be a missing line's.
 *
 * cookpool-guided GC-6: long prep first, in an amber card under the title
 * (Soak now · ping me, Already done); each step with its flame, its range at
 * this size (`stepTimeAt`), what to watch for, Hands off and what cooks
 * learned (GC-7); and The plan beside Steps, at this size.
 */
export function RecipeScreen() {
  const recipeId = parseRecipeRef(usePathParam("/recipes/:recipeId", "recipeId"));
  const searchParams = useSearchParams();
  const code = searchParams?.get("code") ?? null;
  const f = Number(searchParams?.get("f"));
  const initialFactor = Number.isFinite(f) && f > 0 ? clampFactor(f) : WRITTEN_FACTOR;
  if (!recipeId) return <RecipeNotFound />;
  return <RecipeLoader key={recipeId} recipeId={recipeId} code={code} initialFactor={initialFactor} />;
}

function RecipeLoader({ recipeId, code, initialFactor }: { recipeId: string; code: string | null; initialFactor: number }) {
  const recipe = useRecipe(recipeId, code);
  if (recipe.loading) return <RecipeSkeleton />;
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
  return <RecipeView recipe={recipe.data.recipe} code={code} initialFactor={initialFactor} />;
}

/** A value once it has stopped changing for `ms` (the factor, before the match is read again). */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    if (Object.is(settled, value)) return;
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms, settled]);
  return settled;
}

/** How long the factor must hold before the match is read again. */
export const MATCH_SETTLE_MS = 350;

function RecipeView({ recipe, code, initialFactor }: { recipe: KitchenRecipe; code: string | null; initialFactor: number }) {
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const [factor, setFactor] = React.useState(initialFactor);
  const settled = useSettled(factor, MATCH_SETTLE_MS);
  const match = useRecipeMatch(recipe.id, settled, code);
  const rows = ingredientRows(recipe, factor, match.data);
  const [sharing, setSharing] = React.useState(false);

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 pb-2">
      <div className="flex items-center justify-between gap-3">
        <BackButton />
        {canEditRecipe(recipe) ? (
          <div className="-mr-1 flex items-center gap-1.5">
            {canShareRecipe(recipe) ? <ShareIconButton onClick={() => setSharing(true)} /> : null}
            <Link
              href={recipeEditHref(recipe.id)}
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-[#C9CFC6] bg-card px-3.5 text-[15px] font-extrabold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="h-4 w-4" strokeWidth={2.2} aria-hidden />
              Edit
            </Link>
          </div>
        ) : recipe.mine ? null : (
          <SaveCopyButton recipe={recipe} code={code} />
        )}
      </div>

      <RecipeHeader recipe={recipe} meId={meId} />

      <LongPrepCard recipe={recipe} code={code} />

      <HowMuchCard recipe={recipe} factorMilli={factor} match={match.data} onFactor={setFactor} />

      <IngredientsSection rows={rows} match={match.data} failed={!!match.error && !match.data} onRetry={match.reload} />

      <FoodAsks recipe={recipe} match={match.data} />

      {recipe.steps.length > 0 ? (
        <StepsSection
          steps={recipe.steps}
          rows={stepRows(recipe, factor)}
          planHref={hasTimedSteps(recipe) ? recipePlanHref(recipe.id, factor, code) : null}
        />
      ) : null}

      <StartCookingBar href={sessionHref(recipe.id, factor)} line={startLine(recipe, factor)} />

      {canShareRecipe(recipe) ? <ShareSheet recipe={recipe} open={sharing} onOpenChange={setSharing} /> : null}
    </div>
  );
}

/**
 * Save (not the owner): your own copy, Only me, "from Anu". It reads Saved at
 * once (the toast has Undo) and, once the server has written it — or when
 * you saved one before — opens your copy.
 */
function SaveCopyButton({ recipe, code }: { recipe: KitchenRecipe; code: string | null }) {
  const mine = useMyRecipes();
  const copy = useCopyRecipe();
  const [state, setState] = React.useState<{ kind: "idle" } | { kind: "saving" } | { kind: "saved"; id: string }>({ kind: "idle" });
  const existing = savedCopyOf(recipe.id, mine.data);
  const savedId = state.kind === "saved" ? state.id : existing;
  return <SaveCopyView savedId={state.kind === "saving" ? null : savedId} saving={state.kind === "saving"} onSave={() => {
    setState({ kind: "saving" });
    void copy({ recipe, code, onUndone: () => setState({ kind: "idle" }) }).then((r) => {
      setState((cur) => (cur.kind !== "saving" ? cur : r.ok ? { kind: "saved", id: r.data.recipe.id } : { kind: "idle" }));
    });
  }} />;
}

/**
 * Save as recipe, on a finished dish's page (new frame): the dish becomes a
 * recipe of yours — every ingredient a line at the amount used, its portions
 * the serves, the heaviest the main item — and the recipe opens.
 */
export function SaveAsRecipeButton({ dishId }: { dishId: string }) {
  const router = useRouter();
  const saveDish = useSaveDishAsRecipe();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        loading={busy}
        className={cn(K_BUTTON, "h-12 gap-2 self-start rounded-[14px] border-[#C9CFC6] bg-card font-extrabold")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await saveDish(dishId);
          setBusy(false);
          if (r.ok) router.push(recipeHref(r.data.recipe.id));
          else if (r.error.reason !== "offline") setError(r.error.reason === "dish_not_open" ? "It was canceled, so there's nothing to save." : r.error.message);
        }}
      >
        <BookOpen className="h-[18px] w-[18px]" aria-hidden />
        Save as recipe
      </Button>
      {error ? (
        <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
          {error}
        </p>
      ) : null}
    </div>
  );
}

