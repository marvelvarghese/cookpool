"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { homeCookNowCards, type CookNowCard } from "./cook-hub";
import { RecipeTileView } from "./cook-hub-ui";
import { useCookNow, usePrefetchRecipe } from "./recipes-data";
import { pressIn } from "./prefetch";

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
              className="flex h-full flex-col gap-2 rounded-[18px] border bg-card p-3 shadow-[0_1px_2px_rgba(23,32,27,0.04)] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RecipeTileView tile={c.tile} />
              <span className="line-clamp-2 text-[15px] font-extrabold leading-tight">{c.name}</span>
              <span className={cn("truncate text-[13px] font-bold tabular-nums", c.tone === "have" ? "text-[#165C3A]" : "text-muted-foreground")}>{c.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
