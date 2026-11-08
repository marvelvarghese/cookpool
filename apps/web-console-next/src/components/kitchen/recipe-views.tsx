"use client";

import * as React from "react";
import Link from "next/link";
import { Bookmark, BookOpen, ChevronDown } from "lucide-react";
import type { KitchenRecipe, RecipeMatchResponse } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON } from "./kit";
import { Face } from "./faces-ui";
import {
  amountText,
  factorChip,
  haveLine,
  mainAmountMilli,
  mainLineOf,
  minutesText,
  portionsAt,
  recipeByline,
  recipeHref,
  stepMain,
  stepPortions,
  useAllFor,
  type IngredientRow,
  type RecipeByline,
} from "./recipes";

/**
 * The recipe page's parts as they draw (cookpool-recipes RC-5, the canvas's
 * `Recipe`), from what was read: no reads or writes here, so each is
 * rendered in tests. `recipe-ui.tsx` puts them together over the data.
 */

/** Its name, and under it who it is from and how long it takes. */
export function RecipeHeader({ recipe, meId }: { recipe: Pick<KitchenRecipe, "name" | "minutes" | "isSystem" | "mine" | "source" | "ownerId" | "ownerName">; meId: string | null }) {
  const byline = recipeByline(recipe);
  const minutes = recipe.minutes ? minutesText(recipe.minutes) : null;
  return (
    <header className="-mt-1 flex min-w-0 flex-col gap-1.5">
      <h1 className="break-words text-[28px] font-extrabold leading-tight tracking-[-0.02em]">{recipe.name}</h1>
      {byline.kind !== "none" || minutes ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-[#3F4842]">
          {byline.kind !== "none" ? <BylineView byline={byline} meId={meId} /> : null}
          {byline.kind !== "none" && minutes ? <span aria-hidden className="h-[3px] w-[3px] rounded-full bg-[#9AA39D]" /> : null}
          {minutes ? <span className="tabular-nums">{minutes}</span> : null}
        </p>
      ) : null}
    </header>
  );
}

function BylineView({ byline, meId }: { byline: Exclude<RecipeByline, { kind: "none" }>; meId: string | null }) {
  if (byline.kind === "cookpool") return <span className="flex min-h-8 items-center">{byline.text}</span>;
  const names = new Map([[byline.subjectId, byline.name]]);
  return (
    <span className="flex min-h-8 items-center gap-1.5">
      <Face subjectId={byline.subjectId} meId={meId} names={names} className="h-6 w-6 text-[10px]" />
      {byline.text}
    </span>
  );
}

/** Save, Saved (on its way), or Saved opening your copy. */
export function SaveCopyView({ savedId, saving, onSave }: { savedId: string | null; saving: boolean; onSave: () => void }) {
  const saved = "-mr-1 flex min-h-11 items-center gap-1.5 rounded-xl border border-[#B9DCC8] bg-cp-herb-tint px-3.5 text-[15px] font-extrabold text-[#165C3A]";
  if (savedId) {
    return (
      <Link href={recipeHref(savedId)} className={cn(saved, "transition-colors hover:bg-[#D3EADC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
        <Bookmark className="h-4 w-4 fill-current" strokeWidth={2.2} aria-hidden />
        Saved
        <span className="sr-only"> · open your copy</span>
      </Link>
    );
  }
  if (saving) {
    return (
      <span role="status" aria-busy className={saved}>
        <Bookmark className="h-4 w-4 fill-current" strokeWidth={2.2} aria-hidden />
        Saved
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onSave}
      className="-mr-1 flex min-h-11 items-center gap-1.5 rounded-xl border border-[#C9CFC6] bg-card px-3.5 text-[15px] font-extrabold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bookmark className="h-4 w-4" strokeWidth={2.2} aria-hidden />
      Save
    </button>
  );
}

const STEPPER =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#C9CFC6] bg-card text-xl font-bold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/**
 * How much: the main item and the portions, each − value +, both setting the
 * one factor (`onFactor`); the factor chip; "Use all 450 g you have".
 */
export function HowMuchCard({
  recipe,
  factorMilli,
  match,
  onFactor,
}: {
  recipe: Pick<KitchenRecipe, "lines" | "servesHalf">;
  factorMilli: number;
  match: Pick<RecipeMatchResponse, "lines"> | null;
  onFactor: (factorMilli: number) => void;
}) {
  const main = mainLineOf(recipe);
  const chip = factorChip(factorMilli, recipe.servesHalf);
  const useAll = useAllFor(recipe, factorMilli, match);
  const portions = portionsAt(recipe, factorMilli);
  const less = stepMain(recipe, factorMilli, -1);
  const more = stepMain(recipe, factorMilli, 1);
  const fewer = stepPortions(recipe, factorMilli, -1);
  const morePortions = stepPortions(recipe, factorMilli, 1);
  const mainName = main ? main.name : "";

  return (
    <section aria-label="How much" className="flex flex-col gap-3 rounded-[22px] border bg-card px-4 py-3.5">
      {main ? (
        <div className="flex items-center gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs font-extrabold tracking-[0.04em] text-muted-foreground">MAIN ITEM</span>
            <span className="truncate text-[17px] font-extrabold">{mainName}</span>
          </div>
          <button type="button" aria-label={`Less ${mainName.toLowerCase()}`} disabled={less === factorMilli} onClick={() => onFactor(less)} className={STEPPER}>
            −
          </button>
          <span aria-live="polite" className="min-w-16 text-center text-lg font-extrabold tabular-nums">
            {amountText(mainAmountMilli(main, factorMilli), main.unit)}
          </span>
          <button type="button" aria-label={`More ${mainName.toLowerCase()}`} disabled={more === factorMilli} onClick={() => onFactor(more)} className={STEPPER}>
            +
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex min-h-8 items-center rounded-full px-3 text-[13px] font-extrabold tabular-nums",
            chip.written ? "bg-[#ECEEE9] text-[#3F4842]" : "bg-foreground text-background",
          )}
        >
          {chip.text}
        </span>
        {useAll ? (
          <button
            type="button"
            onClick={() => onFactor(useAll.factorMilli)}
            className="inline-flex min-h-11 items-center rounded-full border border-[#B9DCC8] bg-cp-herb-tint px-3 text-[13px] font-extrabold text-[#165C3A] transition-colors hover:bg-[#D3EADC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {useAll.text}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2.5 border-t border-[#ECEEE9] pt-3">
        <span className="flex-1 text-[15px] font-extrabold">Portions</span>
        <button type="button" aria-label="Fewer portions" disabled={fewer === factorMilli} onClick={() => onFactor(fewer)} className={STEPPER}>
          −
        </button>
        <span aria-live="polite" className="min-w-16 text-center text-lg font-extrabold tabular-nums">
          {portions.label}
        </span>
        <button type="button" aria-label="More portions" disabled={morePortions === factorMilli} onClick={() => onFactor(morePortions)} className={STEPPER}>
          +
        </button>
      </div>
    </section>
  );
}

const DOT: Record<NonNullable<IngredientRow["status"]>, string> = {
  have: "bg-primary",
  short: "bg-[#D97706]",
  missing: "bg-[#B42318]",
  always: "bg-[#C9CFC6]",
};

const STATUS_TEXT: Record<NonNullable<IngredientRow["status"]>, string> = {
  have: "text-[#165C3A]",
  short: "text-[#8A5A00]",
  missing: "text-[#B42318]",
  always: "text-muted-foreground",
};

/** The status words a screen reader hears before the line's own. */
const STATUS_WORD: Record<NonNullable<IngredientRow["status"]>, string> = { have: "Have", short: "Short", missing: "Missing", always: "Always have" };

/** Ingredients: "Have 6 of 8 · 1 to get", and every line at the factor with its dot and status. */
export function IngredientsSection({
  rows,
  match,
  failed,
  onRetry,
}: {
  rows: readonly IngredientRow[];
  match: Pick<RecipeMatchResponse, "summary"> | null;
  failed?: boolean;
  onRetry?: (() => void) | undefined;
}) {
  const have = match ? haveLine(match.summary) : null;
  return (
    <section aria-labelledby="recipe-ingredients" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="recipe-ingredients" className="text-lg font-extrabold tracking-tight">
          Ingredients
        </h2>
        {have ? (
          <span className={cn("text-[13px] font-extrabold tabular-nums", have.complete ? "text-[#165C3A]" : "text-[#8A5A00]")}>{have.text}</span>
        ) : failed && onRetry ? (
          <button type="button" onClick={onRetry} className="min-h-11 rounded-lg px-1 text-[13px] font-extrabold text-primary hover:underline">
            Check your pantries again
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-[#ECEEE9] overflow-hidden rounded-[22px] border bg-card">
        {rows.map((r) => (
          <li key={r.position} className="flex min-h-14 items-center gap-3 px-4 py-3">
            <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", r.status ? DOT[r.status] : "border border-[#C9CFC6]")} />
            <div className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate text-base font-extrabold">
                {r.name}
                {r.isMain ? <span className="font-bold text-muted-foreground"> · main</span> : null}
              </span>
              {r.status && r.statusText ? (
                <span className={cn("truncate text-[13px] font-bold tabular-nums", STATUS_TEXT[r.status])}>
                  <span className="sr-only">{STATUS_WORD[r.status]}: </span>
                  {r.statusText}
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-right text-base font-extrabold tabular-nums">{r.amount}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Steps · N, folded until opened, numbered. */
export function StepsSection({ steps, initiallyOpen = false }: { steps: readonly string[]; initiallyOpen?: boolean }) {
  const [open, setOpen] = React.useState(initiallyOpen);
  const id = React.useId();
  return (
    <section aria-label="Steps" className="flex flex-col gap-2.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 items-center justify-between rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-lg font-extrabold tracking-tight">Steps · {steps.length}</span>
        <ChevronDown className={cn("h-5 w-5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ol id={id} className="flex flex-col gap-2">
          {steps.map((text, i) => (
            <li key={i} className="flex gap-3 rounded-2xl border bg-card px-3.5 py-3">
              <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-extrabold text-background">
                {i + 1}
              </span>
              <span className="text-[15px] font-semibold leading-snug">{text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/**
 * The one main button, Start cooking, in the cook colour, with "For about 2
 * · chicken 450 g" under it: the session at this factor. Held above the tab
 * bar while the page is longer than the screen.
 */
export function StartCookingBar({ href, line }: { href: string; line: string }) {
  return (
    <div
      data-toast-above=""
      className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-30 -mx-4 bg-background px-4 pb-2 pt-3 min-[900px]:bottom-6 min-[900px]:mx-0 min-[900px]:bg-transparent min-[900px]:px-0"
    >
      <Link
        href={href}
        className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 rounded-[18px] bg-[#B4471F] px-4 py-2 text-white shadow-[0_8px_24px_rgba(23,32,27,0.18)] transition-colors hover:bg-[#9C3D1A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="text-[17px] font-extrabold">Start cooking</span>
        <span className="max-w-full truncate text-[13px] font-semibold tabular-nums opacity-90">{line}</span>
      </Link>
    </div>
  );
}

export function RecipeNotFound() {
  return (
    <KCard className="flex gap-4 p-5">
      <BookOpen className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-3">
        <h1 className="text-lg font-bold">This recipe isn&apos;t here</h1>
        <Button asChild variant="outline" className={K_BUTTON}>
          <Link href="/cook">Cook</Link>
        </Button>
      </div>
    </KCard>
  );
}

export function RecipeSkeleton() {
  return (
    <div className="flex max-w-xl flex-col gap-4" aria-hidden>
      <Skeleton className="h-11 w-11 rounded-xl" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-[184px] w-full rounded-[22px]" />
      <Skeleton className="h-72 w-full rounded-[22px]" />
    </div>
  );
}

