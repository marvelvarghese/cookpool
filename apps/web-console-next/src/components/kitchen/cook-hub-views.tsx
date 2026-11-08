"use client";

import * as React from "react";
import Link from "./link";
import { BookOpen, Bookmark, ChevronRight, CookingPot, Plus } from "lucide-react";
import type { CookNowEntry } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { shareKey, sharePart } from "@/lib/transitions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON } from "./kit";
import { BLANK_SESSION_HREF, NEW_RECIPE_HREF, recipeHref } from "./recipes";
import type { PersonRecipeRow } from "./explore";
import {
  cookNowCounts,
  cookNowFilterLabel,
  cookNowRows,
  defaultCookNowFilter,
  showsCookNow,
  type CookNowCard,
  type CookNowFilter,
  type MyRecipeCard,
  type ProfileRecipeRow,
} from "./cook-hub";

/**
 * The lists of recipes as they draw (cookpool-recipes RC-5): the Cook hub
 * and its sections, Home's Cook now strip and You's recipes; and (RC-8) a
 * person's recipes with Save on each row — from what was
 * read, with no reads or writes of their own, so each is rendered in tests.
 * `cook-hub-ui.tsx`, `cook-now-slot.tsx` and `profile-ui.tsx` put them over
 * the data.
 */

/** Read ahead on press, hover or focus (`prefetch.ts`'s `pressIn`, kept here so these stay free of the session). */
function pressIn(read: () => void): { onPointerDown: () => void; onMouseEnter: () => void; onFocus: () => void } {
  return { onPointerDown: read, onMouseEnter: read, onFocus: read };
}

/** The hub as it draws, from what was read (null: not yet). */
export function CookHubView({
  cookNow,
  cards,
  recipesLoading,
  recipesFailed,
  onReloadRecipes,
  prefetch,
  extraAction,
}: {
  cookNow: readonly CookNowEntry[] | null;
  cards: readonly MyRecipeCard[] | null;
  recipesLoading: boolean;
  recipesFailed: boolean;
  onReloadRecipes?: (() => void) | undefined;
  prefetch?: ((recipeId: string) => void) | undefined;
  /** Beside New recipe (RC-8: Explore). */
  extraAction?: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <header className="flex min-h-11 items-center">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Cook</h1>
      </header>
      <StartCookingButton />
      {cookNow && showsCookNow(cookNow) ? <CookNowSection entries={cookNow} prefetch={prefetch} /> : null}
      <MyRecipesSection cards={cards} loading={recipesLoading} failed={recipesFailed} onReload={onReloadRecipes} prefetch={prefetch} extraAction={extraAction} />
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

/** A recipe's tile: its initial on its colour. `part`: what lets it travel into the recipe's page (RC-11). */
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
            <li key={r.id} data-vt-card="" className="flex items-center gap-3 py-2.5 pl-3.5 pr-3">
              <RecipeTileView tile={r.tile} part={sharePart("tile")} />
              <Link
                {...pressIn(() => prefetch(r.id))}
                href={r.href}
                share={shareKey("recipe", r.id)}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span {...sharePart("title")} className="truncate text-base font-extrabold">{r.name}</span>
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
                  share={shareKey("recipe", c.id)}
                  className="flex min-w-0 flex-col gap-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span {...sharePart("title")} className="truncate text-[17px] font-extrabold">{c.name}</span>
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
