"use client";

import * as React from "react";
import Link from "./link";
import { Bookmark, CookingPot } from "lucide-react";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { shareKey, sharePart } from "@/lib/transitions";
import { useCookSession } from "@/lib/cook-session-store";
import { Skeleton } from "@/components/ui/skeleton";
import { homeMoney } from "./home";
import { useMyBalances } from "./people-data";
import { sessionBarView } from "./cook-session";
import { useNow } from "./cook-session-ui";
import { HOME_COOK_NOW, recipeTile } from "./cook-hub";
import { useCookNow, usePrefetchRecipe } from "./recipes-data";
import { useSaveCopy } from "./recipe-travel-data";
import { recipeHref } from "./recipes";
import { pressIn } from "./prefetch";
import { K_SECTION } from "./kit";
import { balancePill, cookNowTag, resumeMeta, resumeStep } from "./new-home-look";

/**
 * The revamped Home's parts (cookpool-revamp RV-3, the canvas's
 * `HomeRevamp`): the balance pill, the resume strip, Cook now's cards and
 * the save button on a dish your groups cooked. `NewHome` puts them in the
 * board's order. Tokens only: no raw colours.
 */

/** Focus ring every revamped control shares. */
export const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A row's 44 px pill: on the tint, on the accent for what settles the row, or plain once done. */
export function pillClass(kind: "quiet" | "main" | "done" = "quiet"): string {
  return cn(
    "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[14px] px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    RING,
    kind === "main" && "bg-primary text-primary-foreground hover:bg-primary/90",
    kind === "quiet" && "bg-cp-accent-tint text-cp-accent-text hover:bg-cp-accent-tint/80",
    kind === "done" && "bg-transparent text-muted-foreground hover:bg-muted",
  );
}

/** The balance pill beside "Hi, Rahul": "+₹62.50" in the money-back colour, "−₹25.00" in the owe colour; opens Money. */
export function BalancePillLink() {
  const balances = useMyBalances();
  const pill = balancePill(balances.data ? homeMoney(balances.data) : null);
  if (!pill) return null;
  return (
    <Link
      href="/money"
      aria-label={pill.label}
      className={cn(
        "inline-flex min-h-10 shrink-0 items-center rounded-full px-3.5 text-[15px] font-medium tabular-nums",
        RING,
        pill.tone === "owed" ? "bg-cp-owed-tint text-cp-owed" : "bg-cp-owe-tint text-cp-owe",
      )}
    >
      {pill.text}
    </Link>
  );
}

/** The cooking session you left, as Home's strip: the pot, its name, "12 min · 3 of 7 in" and Resume. */
export function ResumeStrip({ meId }: { meId: string | null }) {
  const session = useCookSession(meId);
  const now = useNow(30_000);
  const view = sessionBarView(session, now);
  if (!view) return null;
  return (
    <Link
      href={view.href}
      aria-label={`Resume ${view.name}`}
      className={cn("flex min-h-[68px] items-center gap-3 rounded-[20px] bg-cp-cook-bg py-2.5 pl-3.5 pr-2.5 text-cp-cook-ink", RING)}
    >
      <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-cp-cook text-cp-on-cook">
        <CookingPot className="h-[22px] w-[22px]" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-base font-medium">{view.name}</span>
        <span className="truncate text-[13px] font-normal opacity-85 [@media(prefers-color-scheme:dark)]:opacity-75">{resumeMeta(view.meta, session ? resumeStep(session) : null)}</span>
      </span>
      <span aria-hidden className="inline-flex min-h-11 shrink-0 items-center rounded-[14px] bg-cp-cook px-4 text-[15px] font-medium text-cp-on-cook">
        Resume
      </span>
    </Link>
  );
}

/**
 * Cook now (RC-5's data): up to three cards, 148 px wide and scrolling
 * sideways, each its tile, its name and "Have all" or "Need yogurt"; All
 * opens the Cook tab. Nothing while Cook now has nothing.
 */
export function HomeCookNow() {
  const cookNow = useCookNow();
  const prefetch = usePrefetchRecipe();
  const entries = (cookNow.data ?? []).slice(0, HOME_COOK_NOW);
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="home-cook-now" className="min-w-0 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-cook-now" className={K_SECTION}>
          Cook now
        </h2>
        <Link href="/cook" className={cn("flex min-h-11 items-center rounded-lg px-1 text-sm font-medium text-cp-accent-text", RING)}>
          All
        </Link>
      </div>
      <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-2 pt-0.5 [scrollbar-width:none] min-[900px]:mx-0 min-[900px]:px-0 [&::-webkit-scrollbar]:hidden">
        {entries.map((e) => {
          const tile = recipeTile(e.recipe);
          const tag = cookNowTag(e);
          return (
            <li key={e.recipe.id} className="w-[148px] shrink-0">
              <Link
                {...pressIn(() => prefetch(e.recipe.id))}
                href={recipeHref(e.recipe.id)}
                share={shareKey("recipe", e.recipe.id)}
                className={cn("flex h-full flex-col overflow-hidden rounded-[20px] bg-card shadow-cp-card", RING)}
              >
                {/* The recipe's own tile colours in light; the line colour in dark, as the board draws it. */}
                <span
                  {...sharePart("tile")}
                  aria-hidden
                  style={{ "--tile-bg": tile.bg, "--tile-fg": tile.fg } as React.CSSProperties}
                  className="flex h-[76px] items-center justify-center bg-[var(--tile-bg)] text-[28px] font-medium text-[var(--tile-fg)] [@media(prefers-color-scheme:dark)]:bg-cp-line [@media(prefers-color-scheme:dark)]:text-foreground"
                >
                  {tile.initial}
                </span>
                <span className="flex flex-col gap-1 px-3 pb-3 pt-2.5">
                  <span {...sharePart("title")} className="truncate text-[15px] font-medium">
                    {e.recipe.name}
                  </span>
                  <span
                    className={cn(
                      "self-start rounded-full px-2 py-0.5 text-xs font-medium",
                      tag.tone === "have" ? "bg-cp-accent-tint text-cp-accent-text" : "bg-cp-owe-tint text-cp-owe",
                    )}
                  >
                    {tag.text}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Save a recipe a group cooked from, as one 44 px bookmark: your own copy, then Saved (opening it). */
export function SaveRecipeIcon({ recipe }: { recipe: KitchenRecipe }) {
  const copy = useSaveCopy(recipe);
  const base = cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px] transition-colors", RING);
  if (copy.savedId) {
    return (
      <Link href={recipeHref(copy.savedId)} aria-label={`Saved ${recipe.name} · open your copy`} className={cn(base, "text-cp-accent-text hover:bg-muted")}>
        <Bookmark className="h-5 w-5 fill-current" strokeWidth={2} aria-hidden />
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={copy.saving ? `Saved ${recipe.name}` : `Save ${recipe.name}`}
      aria-pressed={copy.saving}
      disabled={copy.saving}
      onClick={copy.save}
      className={cn(base, copy.saving ? "text-cp-accent-text" : "text-muted-foreground hover:bg-muted")}
    >
      <Bookmark className={cn("h-5 w-5", copy.saving && "fill-current")} strokeWidth={2} aria-hidden />
    </button>
  );
}

/** "See all 13" / "Show less" at the foot of a revamped card. */
export function SeeAllButton({ label, all, onToggle }: { label: string; all: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={all}
      onClick={onToggle}
      className={cn("min-h-12 w-full border-t border-cp-line text-sm font-medium text-cp-accent-text hover:bg-muted/50", RING, "focus-visible:ring-inset")}
    >
      {label}
    </button>
  );
}

/** Rows loading inside a revamped card. */
export function RowsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-cp-card bg-card shadow-cp-card" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-none" />
      ))}
    </div>
  );
}
