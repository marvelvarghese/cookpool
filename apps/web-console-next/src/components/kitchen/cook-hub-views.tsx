"use client";

import * as React from "react";
import Link from "./link";
import { BookOpen, Bookmark, ChevronRight, Plus, Search } from "lucide-react";
import type { CookNowEntry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { shareKey, sharePart } from "@/lib/transitions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON, K_CARD, K_TITLE, SectionHeading } from "./kit";
import { BLANK_SESSION_HREF, NEW_RECIPE_HREF, recipeHref } from "./recipes";
import type { PersonRecipeRow } from "./explore";
import { HUB_FIRST, cookNowHubRows, hubMatches, type CookNowCard, type HubRow, type ProfileRecipeRow } from "./cook-hub";

/**
 * The lists of recipes as they draw (cookpool-recipes RC-5; the Cook tab
 * revamped in RV-4): the Cook tab and its lists, Home's Cook now strip and You's recipes; and (RC-8) a
 * person's recipes with Save on each row — from what was
 * read, with no reads or writes of their own, so each is rendered in tests.
 * `cook-hub-ui.tsx`, `cook-now-slot.tsx` and `profile-ui.tsx` put them over
 * the data.
 */

/** Read ahead on press, hover or focus (`prefetch.ts`'s `pressIn`, kept here so these stay free of the session). */
function pressIn(read: () => void): { onPointerDown: () => void; onMouseEnter: () => void; onFocus: () => void } {
  return { onPointerDown: read, onMouseEnter: read, onFocus: read };
}

/**
 * The Cook tab as it draws (RV-4, the canvas's `RvCook`), from what was
 * read (null: not yet): "Cook" and the one main button, New dish (a blank
 * session); Find a recipe; Cook now — what you have everything for — and
 * Saved recipes, each a card of rows (tile, name, one tag), three then "See
 * all N"; then New recipe, Explore, From a photo and Community, quiet.
 */
export function CookHubView({
  cookNow,
  saved,
  recipesLoading,
  recipesFailed,
  onReloadRecipes,
  prefetch,
  extraAction,
  photoAction,
  community,
  initialQuery = "",
}: {
  cookNow: readonly CookNowEntry[] | null;
  /** Saved recipes' rows (`savedHubRows`), null until read. */
  saved: readonly HubRow[] | null;
  recipesLoading: boolean;
  recipesFailed: boolean;
  onReloadRecipes?: (() => void) | undefined;
  prefetch?: ((recipeId: string) => void) | undefined;
  /** Beside New recipe (RC-8: Explore). */
  extraAction?: React.ReactNode;
  /** Under them (cookpool-ai AI-9): "📷 From a photo". */
  photoAction?: React.ReactNode;
  /** Last (cookpool-community CM-5): the Community entry. */
  community?: React.ReactNode;
  initialQuery?: string;
}) {
  const [query, setQuery] = React.useState(initialQuery);
  const searching = query.trim() !== "";
  const now = (cookNow ? cookNowHubRows(cookNow) : []).filter((r) => hubMatches(r, query));
  const mine = (saved ?? []).filter((r) => hubMatches(r, query));
  return (
    <div className="flex w-full max-w-xl flex-col gap-[22px]">
      <header className="flex min-h-11 items-center gap-3">
        <h1 className={cn(K_TITLE, "flex-1")}>Cook</h1>
        <Link
          href={BLANK_SESSION_HREF}
          className="flex min-h-11 items-center gap-1.5 rounded-[14px] bg-primary px-4 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
          New dish
        </Link>
      </header>

      <label className={cn(K_CARD, "flex min-h-[54px] items-center gap-2.5 rounded-[18px] px-4 text-muted-foreground")}>
        <Search className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="sr-only">Find a recipe</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a recipe"
          className="min-h-11 min-w-0 flex-1 border-0 bg-transparent text-base font-normal text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      {now.length > 0 ? <HubList id="cook-now-h" title="Cook now" rows={now} searching={searching} prefetch={prefetch} /> : null}

      {recipesLoading ? (
        <div className="space-y-2.5" aria-hidden>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-48 w-full rounded-cp-card" />
        </div>
      ) : recipesFailed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your recipes.</p>
          {onReloadRecipes ? (
            <Button variant="outline" className={K_BUTTON} onClick={onReloadRecipes}>
              Try again
            </Button>
          ) : null}
        </KCard>
      ) : mine.length > 0 ? (
        <HubList id="saved-recipes-h" title="Saved recipes" rows={mine} searching={searching} prefetch={prefetch} />
      ) : null}

      {searching && now.length === 0 && mine.length === 0 && !recipesLoading ? (
        <p className={cn(K_CARD, "px-4 py-6 text-center text-[15px] font-normal text-muted-foreground")}>Nothing matches</p>
      ) : !searching && now.length === 0 && saved && saved.length === 0 && !recipesLoading && !recipesFailed ? (
        <p className={cn(K_CARD, "px-4 py-6 text-center text-[15px] font-normal text-muted-foreground")}>No recipes yet</p>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2.5">
          <Link href={NEW_RECIPE_HREF} className={HUB_QUIET}>
            <BookOpen className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            New recipe
          </Link>
          {extraAction ?? null}
        </div>
        {photoAction ?? null}
        {community ?? null}
      </div>
    </div>
  );
}

/** A quiet 44 px link on the tint (New recipe, Explore). */
export const HUB_QUIET =
  "flex min-h-11 items-center justify-center gap-2 rounded-[14px] bg-cp-accent-tint px-4 text-[15px] font-medium text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const TAG: Record<HubRow["tone"], string> = {
  have: "bg-cp-accent-tint text-cp-accent-text",
  need: "bg-cp-owe-tint text-cp-owe",
  plain: "bg-cp-line text-muted-foreground",
};

/** A list on the Cook tab: its title and count, a card of rows, three then "See all N" (all while searching). */
export function HubList({
  id,
  title,
  rows,
  searching = false,
  prefetch = noPrefetch,
}: {
  id: string;
  title: string;
  rows: readonly HubRow[];
  searching?: boolean;
  prefetch?: ((recipeId: string) => void) | undefined;
}) {
  const [all, setAll] = React.useState(false);
  const open = all || searching;
  const shown = open ? rows : rows.slice(0, HUB_FIRST);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <SectionHeading id={id} count={`· ${rows.length}`}>
        {title}
      </SectionHeading>
      <div className={cn(K_CARD, "overflow-hidden")}>
        <ul className="divide-y divide-cp-line">
          {shown.map((r) => (
            <li key={r.id} data-vt-card="">
              <Link
                {...pressIn(() => prefetch(r.id))}
                href={r.href}
                share={shareKey("recipe", r.id)}
                className="flex min-h-16 items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <RecipeTileView tile={r.tile} className="h-[42px] w-[42px] rounded-[14px] text-base" part={sharePart("tile")} />
                <span {...sharePart("title")} className="min-w-0 flex-1 truncate text-base font-medium">
                  {r.name}
                </span>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", TAG[r.tone])}>{r.tag}</span>
              </Link>
            </li>
          ))}
        </ul>
        {rows.length > HUB_FIRST && !searching ? (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((a) => !a)}
            className="min-h-12 w-full border-t border-cp-line text-sm font-medium text-cp-accent-text transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {all ? "Show less" : `See all ${rows.length}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** A recipe's tile: its initial on its colour (the line and ink in dark, as the boards). `part`: what lets it travel into the recipe's page (RC-11). */
export function RecipeTileView({
  tile,
  className,
  part,
}: {
  tile: { initial: string; bg: string; fg: string };
  className?: string;
  part?: Record<string, string> | undefined;
}) {
  return (
    <span
      aria-hidden
      {...part}
      style={{ "--cp-tile-bg": tile.bg, "--cp-tile-fg": tile.fg } as React.CSSProperties}
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--cp-tile-bg)] text-[17px] font-medium text-[var(--cp-tile-fg)]",
        "[@media(prefers-color-scheme:dark)]:[.cookpool-new_&]:bg-cp-line [@media(prefers-color-scheme:dark)]:[.cookpool-new_&]:text-foreground",
        className,
      )}
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
  large = false,
  className,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** Full width, in 15 px (a page's list switch, as Money's People | Groups). */
  large?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex rounded-xl bg-[#ECEEE9] p-[3px]", large && "w-full rounded-[14px]", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "min-h-11 flex-1 whitespace-nowrap rounded-[9px] px-2.5 text-[13px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            large && "rounded-[11px] text-[15px]",
            value === o.id ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const noPrefetch = (_recipeId: string): void => undefined;

/** The strip as it draws: nothing when there are no cards. */
export function CookNowStrip({ cards, prefetch }: { cards: readonly CookNowCard[]; prefetch?: ((recipeId: string) => void) | undefined }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="home-cook-now" className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-cook-now" className="text-lg font-extrabold tracking-tight">
          Cook now
        </h2>
        <Link
          href="/cook"
          className="flex min-h-11 items-center rounded-lg px-1 text-sm font-extrabold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          See all
        </Link>
      </div>
      <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] min-[900px]:mx-0 min-[900px]:px-0 [&::-webkit-scrollbar]:hidden">
        {cards.map((c) => (
          <li key={c.id} className="w-40 shrink-0">
            <Link
              {...pressIn(() => prefetch?.(c.id))}
              href={c.href}
              share={shareKey("recipe", c.id)}
              className="flex h-full flex-col gap-2 rounded-[18px] border bg-card p-3 shadow-[0_1px_2px_rgba(23,32,27,0.04)] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RecipeTileView tile={c.tile} part={sharePart("tile")} />
              <span {...sharePart("title")} className="line-clamp-2 text-[15px] font-extrabold leading-tight">{c.name}</span>
              <span className={cn("truncate text-[13px] font-bold tabular-nums", c.tone === "have" ? "text-[#165C3A]" : "text-muted-foreground")}>{c.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Your recipes and copies, last cooked first, each with who can see it: each opens its page. */
export function YourRecipes({
  rows,
  loading,
  failed,
  onReload,
  prefetch,
}: {
  rows: readonly ProfileRecipeRow[];
  loading: boolean;
  failed: boolean;
  onReload?: (() => void) | undefined;
  /** Warm a recipe's page on press. */
  prefetch?: ((recipeId: string) => void) | undefined;
}) {
  return (
    <section aria-label="Your recipes" className="min-w-0">
      {loading ? (
        <div className="space-y-px overflow-hidden rounded-[22px] border bg-card" aria-hidden>
          <Skeleton className="h-16 w-full rounded-none" />
          <Skeleton className="h-16 w-full rounded-none" />
        </div>
      ) : failed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your recipes.</p>
          {onReload ? (
            <Button variant="outline" className={K_BUTTON} onClick={onReload}>
              Try again
            </Button>
          ) : null}
        </KCard>
      ) : rows.length === 0 ? (
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-[22px] border bg-card px-4 py-2">
          <p className="text-sm text-muted-foreground">No recipes yet</p>
          <Link href={NEW_RECIPE_HREF} className="flex min-h-11 items-center rounded-lg px-1 text-sm font-extrabold text-primary hover:underline">
            New recipe
          </Link>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-[22px] border bg-card">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                {...pressIn(() => prefetch?.(row.id))}
                href={row.href}
                share={shareKey("recipe", row.id)}
                className="flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span {...sharePart("title")} className="block truncate text-base font-extrabold">{row.name}</span>
                  <span className="block truncate text-[13px] font-semibold text-muted-foreground">{row.meta}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Someone else's recipes (RC-8) ────────────────────────────────

/**
 * Save on a row: your own copy (outline), "Saved" (tinted) once you have
 * one — then it opens it. 44 px tall; the bookmark before it on a feed card.
 */
export function SaveCopyChip({
  name,
  savedId,
  saving,
  onSave,
  icon = false,
}: {
  name: string;
  savedId: string | null;
  saving: boolean;
  onSave: () => void;
  icon?: boolean;
}) {
  const base = "flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[15px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const saved = cn(base, "border border-[#B9DCC8] bg-cp-herb-tint text-[#165C3A]");
  const mark = (filled: boolean) => (icon ? <Bookmark className={cn("h-4 w-4", filled && "fill-current")} strokeWidth={2.2} aria-hidden /> : null);
  if (savedId) {
    return (
      <Link href={recipeHref(savedId)} className={cn(saved, "hover:bg-[#D3EADC]")}>
        {mark(true)}
        Saved
        <span className="sr-only"> · open your copy of {name}</span>
      </Link>
    );
  }
  if (saving) {
    return (
      <span role="status" aria-busy className={saved}>
        {mark(true)}
        Saved
      </span>
    );
  }
  return (
    <button type="button" onClick={onSave} className={cn(base, "border border-[#C9CFC6] bg-card hover:bg-accent")}>
      {mark(false)}
      Save
      <span className="sr-only"> {name}</span>
    </button>
  );
}

/** A person's recipes you may see: name, "Serves 4 · 30 min", and each row's Save. */
export function PersonRecipesView({
  rows,
  loading,
  failed,
  onReload,
  renderSave,
  prefetch,
}: {
  rows: readonly PersonRecipeRow[];
  loading: boolean;
  failed: boolean;
  onReload?: (() => void) | undefined;
  renderSave?: ((row: PersonRecipeRow) => React.ReactNode) | undefined;
  prefetch?: ((recipeId: string) => void) | undefined;
}) {
  return (
    <section aria-label="Their recipes" className="min-w-0">
      {loading ? (
        <div className="space-y-px overflow-hidden rounded-[22px] border bg-card" aria-hidden>
          <Skeleton className="h-16 w-full rounded-none" />
          <Skeleton className="h-16 w-full rounded-none" />
        </div>
      ) : failed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load their recipes.</p>
          {onReload ? (
            <Button variant="outline" className={K_BUTTON} onClick={onReload}>
              Try again
            </Button>
          ) : null}
        </KCard>
      ) : rows.length === 0 ? (
        <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">No recipes they share yet</p>
      ) : (
        <ul className="divide-y divide-[#ECEEE9] overflow-hidden rounded-[22px] border bg-card">
          {rows.map((row) => (
            <li key={row.id} className="flex min-h-16 items-center gap-3 py-2 pl-4 pr-3">
              <Link
                {...pressIn(() => prefetch?.(row.id))}
                href={row.href}
                share={shareKey("recipe", row.id)}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span {...sharePart("title")} className="truncate text-base font-extrabold">{row.name}</span>
                <span className="truncate text-[13px] font-semibold tabular-nums text-muted-foreground">{row.meta}</span>
              </Link>
              {renderSave ? renderSave(row) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Under a From your groups card (RC-8): the recipe the dish was cooked
 * from — "Anu's recipe", "Cookpool's recipe" — opening it, and Save.
 */
export function FeedRecipeRowView({ text, href, save }: { text: string; href: string; save?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-[#ECEEE9] pt-2">
      <Link
        href={href}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-sm font-extrabold text-[#165C3A] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpen className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
        <span className="truncate">{text}</span>
      </Link>
      {save ?? null}
    </div>
  );
}
