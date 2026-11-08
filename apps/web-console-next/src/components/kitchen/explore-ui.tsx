"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ExploreRecipe } from "@saas/contracts/kitchen";
import { BackButton } from "./back-ui";
import { useGroups } from "./data";
import { useSettled } from "./recipe-ui";
import { EXPLORE_SEARCH_MS, exploreHref, exploreRows, exploreSourceFrom, exploreSubtitle, type ExploreKind } from "./explore";
import { BookmarkButton, ExploreView } from "./explore-views";
import { useExploreRecipes, useSaveCopy } from "./recipe-travel-data";

/**
 * Explore (cookpool-recipes RC-8, design §5.3, the canvas's `Explore`),
 * `/explore`, in the new frame only. Back, "Explore" with "By Cookpool · 42
 * recipes" (or "Shared in Flat 4B and Lunch club"); Cookpool | Your groups
 * (kept in the address, `?source=groups`); a search; Only what I can make;
 * the kind chips; then a row per recipe, fewest missing first — its tile,
 * "by Anu · Serves 4 · 30 min", "✓ You have everything" or "Missing yogurt"
 * — each with a bookmark that saves your own copy.
 */

export function ExploreScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = exploreSourceFrom(searchParams?.get("source"));
  const [query, setQuery] = React.useState("");
  const [kind, setKind] = React.useState<ExploreKind>("all");
  const [onlyCanMake, setOnlyCanMake] = React.useState(false);
  const q = useSettled(query, EXPLORE_SEARCH_MS);
  const list = useExploreRecipes(source, q, kind);
  // Cookpool's whole list, for the count (the same read as the page's own when nothing is chosen).
  const whole = useExploreRecipes("cookpool", "", "all", { enabled: source === "cookpool" });
  const groups = useGroups();
  const byId = React.useMemo(() => new Map((list.data ?? []).map((r) => [r.id, r] as const)), [list.data]);
  const rows = React.useMemo(() => (list.data ? exploreRows(list.data, { source, onlyCanMake }) : null), [list.data, source, onlyCanMake]);

  return (
    <ExploreView
      source={source}
      subtitle={exploreSubtitle(source, whole.data ? whole.data.length : null, (groups.data ?? []).map((g) => g.name))}
      query={query}
      kind={kind}
      onlyCanMake={onlyCanMake}
      rows={rows}
      loading={list.loading}
      failed={!!list.error && !list.data}
      onReload={list.reload}
      onSource={(next) => {
        if (next === source) return;
        setKind("all");
        router.replace(exploreHref(next), { scroll: false });
      }}
      onQuery={setQuery}
      onKind={setKind}
      onOnlyCanMake={setOnlyCanMake}
      renderSave={(row) => {
        const recipe = byId.get(row.id);
        return recipe ? <ExploreSave recipe={recipe} /> : null;
      }}
      back={<BackButton />}
    />
  );
}

/** A row's bookmark over the copy write. */
function ExploreSave({ recipe }: { recipe: ExploreRecipe }) {
  const copy = useSaveCopy(recipe);
  return <BookmarkButton name={recipe.name} savedId={copy.savedId} saving={copy.saving} onSave={copy.save} />;
}
