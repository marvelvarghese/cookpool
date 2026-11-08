"use client";

import * as React from "react";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { KCard, K_BUTTON } from "./kit";
import { BackButton } from "./back-ui";
import { useProfile } from "./data";
import { savedCopyOf } from "./cook-hub";
import { useMyRecipes, useRecipeMatch } from "./recipes-data";
import { linkFailure, linkHaveText, linkLines, linkSaveState, parseLinkCode } from "./recipe-share";
import { LinkGone, LinkSkeleton, RecipeLinkView } from "./recipe-link-views";
import { useLinkCopy, useRecipeByLink } from "./recipe-travel-data";

/**
 * A recipe's link (cookpool-recipes RC-8, design §5.2, the canvas's
 * `ShareRecipe` "Opened from a link"), `/r/<code>`, in the new frame only.
 * Signed out, the kitchen's sign-in brings you back here. Signed in: the
 * sharer's face, "Anu shared a recipe · From a link"; the name, "Serves 2 ·
 * 20 min"; each line with a dot for what your pantries hold and its amount;
 * "You have 5 of 6 · missing paneer"; then the one main button, Save to my
 * recipes — your own copy, which then reads "Saved · Undo" and links to it.
 * A link that was turned off or rotated says "This link no longer works".
 */
export function RecipeLinkScreen() {
  const code = parseLinkCode(usePathParam("/r/:code", "code"));
  if (!code) return <Gone />;
  return <LinkLoader key={code} code={code} />;
}

/** A dead link, under the back control. */
function Gone() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <header className="flex min-h-11 items-center">
        <BackButton />
      </header>
      <LinkGone />
    </div>
  );
}

function LinkLoader({ code }: { code: string }) {
  const read = useRecipeByLink(code);
  if (read.loading) return <LinkSkeleton />;
  const failure = linkFailure(read.error);
  if (failure === "gone") return <Gone />;
  if (failure === "error" || !read.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t open this link. {read.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={read.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  return <LinkedRecipe code={code} recipe={read.data.recipe} />;
}

function LinkedRecipe({ code, recipe }: { code: string; recipe: KitchenRecipe }) {
  const profile = useProfile();
  const mine = useMyRecipes();
  const match = useRecipeMatch(recipe.id, 1000, code);
  const copy = useLinkCopy(code, recipe);
  const save = linkSaveState({ recipe, existingCopyId: savedCopyOf(recipe.id, mine.data), savedHere: copy.savedHere });
  return (
    <RecipeLinkView
      recipe={recipe}
      meId={profile.data?.id ?? null}
      lines={linkLines(recipe, match.data)}
      have={linkHaveText(recipe, match.data)}
      save={save}
      onSave={copy.save}
      onUndo={copy.undo}
      back={<BackButton />}
    />
  );
}
