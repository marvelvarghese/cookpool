"use client";

import * as React from "react";
import Link from "next/link";
import { CookingPot, Plus } from "lucide-react";
import type { CookNowEntry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON } from "./kit";
import { BLANK_SESSION_HREF, NEW_RECIPE_HREF } from "./recipes";
import {
  cookNowCounts,
  cookNowFilterLabel,
  cookNowRows,
  defaultCookNowFilter,
  myRecipeCards,
  showsCookNow,
  type CookNowFilter,
  type MyRecipeCard,
} from "./cook-hub";
import { useCookNow, useMyRecipes, usePrefetchRecipe, useRecipesInFull } from "./recipes-data";
import { pressIn } from "./prefetch";

/**
 * The Cook hub (cookpool-recipes RC-5, design §1.2, §5.4, the canvas's
 * `CookTab`): `/cook` in the new frame. From the top: "Cook"; Start cooking
 * (the one main button, in the cook colour: a blank session); Cook now — what
 * you can make with what you have, "Can make N" | "Missing 1 · N", each row
 * with Start, hidden when there is nothing; My recipes — how many, New recipe
 * (and room beside it for Explore, RC-8), and a card per recipe, last cooked
 * first, with a tinted Start cooking.
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
    />
  );
}

/** The hub as it draws, from what was read (null: not yet). */
export function CookHubView({
  cookNow,
  cards,
  recipesLoading,
  recipesFailed,
  onReloadRecipes,
  prefetch,
}: {
  cookNow: readonly CookNowEntry[] | null;
  cards: readonly MyRecipeCard[] | null;
  recipesLoading: boolean;
  recipesFailed: boolean;
  onReloadRecipes?: (() => void) | undefined;
  prefetch?: ((recipeId: string) => void) | undefined;
}) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <header className="flex min-h-11 items-center">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Cook</h1>
      </header>
      <StartCookingButton />
      {cookNow && showsCookNow(cookNow) ? <CookNowSection entries={cookNow} prefetch={prefetch} /> : null}
      <MyRecipesSection cards={cards} loading={recipesLoading} failed={recipesFailed} onReload={onReloadRecipes} prefetch={prefetch} />
    </div>
  );
}

/** The cook colour, for Start cooking (the pot on From your groups' cards wears it too). */
export const COOK_COLOR = "#B4471F";

/** Start cooking: a blank session (RC-6's page). Full width, in the cook colour, the pot before it. */
export function StartCookingButton() {
  return (
    <Link
      href={BLANK_SESSION_HREF}
      className="flex min-h-[60px] items-center justify-center gap-2.5 rounded-[18px] bg-[#B4471F] px-4 text-[17px] font-extrabold text-white shadow-sm transition-colors hover:bg-[#9C3D1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <CookingPot className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
      Start cooking
    </Link>
  );
}

/** A recipe's tile: its initial on its colour. */
export function RecipeTileView({ tile, className }: { tile: { initial: string; bg: string; fg: string }; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: tile.bg, color: tile.fg }}
      className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[17px] font-extrabold", className)}
    >
      {tile.initial}
    </span>
  );
}

/** Two choices side by side; the one shown is pressed. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex rounded-xl bg-[#ECEEE9] p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "min-h-11 flex-1 whitespace-nowrap rounded-[9px] px-2.5 text-[13px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === o.id ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Cook now: "Can make N" | "Missing 1 · N", a row each, Start on each. */
export function CookNowSection({
  entries,
  initialFilter,
  prefetch = noPrefetch,
}: {
  entries: readonly CookNowEntry[];
  initialFilter?: CookNowFilter;
  /** Warm a recipe's page on press. */
  prefetch?: ((recipeId: string) => void) | undefined;
}) {
  const [filter, setFilter] = React.useState<CookNowFilter>(() => initialFilter ?? defaultCookNowFilter(entries));
  const counts = cookNowCounts(entries);
  const rows = cookNowRows(entries, filter);
  return (
    <section aria-labelledby="cook-now-h" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cook-now-h" className="text-lg font-extrabold tracking-tight">
          Cook now
        </h2>
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={(["can", "one"] as const).map((id) => ({ id, label: cookNowFilterLabel(id, counts) }))}
        />
      </div>
      {rows.length === 0 ? (
        <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">
          {filter === "can" ? "Nothing you can make yet" : "Nothing missing just one"}
        </p>
      ) : (
        <ul className="divide-y divide-[#ECEEE9] overflow-hidden rounded-[22px] border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5 pl-3.5 pr-3">
              <RecipeTileView tile={r.tile} />
              <Link
                {...pressIn(() => prefetch(r.id))}
                href={r.href}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="truncate text-base font-extrabold">{r.name}</span>
                <span className={cn("truncate text-[13px] font-bold tabular-nums", r.tone === "have" ? "text-[#165C3A]" : "text-muted-foreground")}>
                  {r.meta}
                </span>
              </Link>
              <Link
                href={r.startHref}
                className="flex min-h-11 shrink-0 items-center rounded-xl border border-[#C9CFC6] bg-card px-3.5 text-[15px] font-extrabold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Start
                <span className="sr-only"> cooking {r.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const noPrefetch = (_recipeId: string): void => undefined;

/** My recipes: the count, New recipe (Explore joins it in RC-8), a card per recipe. */
export function MyRecipesSection({
  cards,
  loading,
  failed,
  onReload,
  extraAction,
  prefetch = noPrefetch,
}: {
  cards: readonly MyRecipeCard[] | null;
  loading: boolean;
  failed: boolean;
  onReload?: (() => void) | undefined;
  /** The second button beside New recipe (RC-8's Explore). */
  extraAction?: React.ReactNode;
  prefetch?: ((recipeId: string) => void) | undefined;
}) {
  return (
    <section aria-labelledby="my-recipes-h" className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="my-recipes-h" className="text-lg font-extrabold tracking-tight">
          My recipes
        </h2>
        {cards ? <span className="text-[13px] font-bold tabular-nums text-muted-foreground">{cards.length}</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Link
          href={NEW_RECIPE_HREF}
          className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] border border-[#C9CFC6] bg-card text-[15px] font-extrabold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
          New recipe
        </Link>
        {extraAction ?? null}
      </div>
      {loading ? (
        <div className="space-y-2.5" aria-hidden>
          <Skeleton className="h-[148px] w-full rounded-[22px]" />
          <Skeleton className="h-[148px] w-full rounded-[22px]" />
        </div>
      ) : failed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your recipes.</p>
          {onReload ? (
            <Button variant="outline" className={K_BUTTON} onClick={onReload}>
              Try again
            </Button>
          ) : null}
        </KCard>
      ) : !cards || cards.length === 0 ? (
        <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">No recipes yet</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {cards.map((c) => (
            <li key={c.id}>
              <article className="flex flex-col gap-2.5 rounded-[22px] border bg-card px-4 py-3.5 shadow-[0_1px_2px_rgba(23,32,27,0.04)]">
                <Link
                  {...pressIn(() => prefetch(c.id))}
                  href={c.href}
                  className="flex min-w-0 flex-col gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate text-[17px] font-extrabold">{c.name}</span>
                  <span className="truncate text-[13px] font-semibold text-muted-foreground">{c.items}</span>
                </Link>
                <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] font-bold tabular-nums text-[#3F4842]">
                  {c.meta.map((m, i) => (
                    <React.Fragment key={m}>
                      {i > 0 ? <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-[#9AA39D]" /> : null}
                      <span>{m}</span>
                    </React.Fragment>
                  ))}
                </p>
                <Link
                  href={c.startHref}
                  className="flex min-h-[46px] items-center justify-center rounded-[14px] bg-cp-herb-tint text-[15px] font-extrabold text-[#165C3A] transition-colors hover:bg-[#D3EADC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Start cooking
                  <span className="sr-only"> {c.name}</span>
                </Link>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
