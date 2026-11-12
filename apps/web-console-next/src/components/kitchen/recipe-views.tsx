"use client";

import * as React from "react";
import Link from "./link";
import { Bookmark, BookOpen, ChevronDown, CookingPot, ListOrdered, Minus, Plus } from "lucide-react";
import type { KitchenRecipe, RecipeMatchResponse } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { shareKey, shareTarget } from "@/lib/transitions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON, K_CARD, K_ROWS, K_SECTION } from "./kit";
import { Face } from "./faces-ui";
import { GuidedStepItem } from "./guided-views";
import type { StepRow } from "./guided-steps";
import {
  halvesText,
  portionsAt,
  recipeByline,
  recipeHref,
  recipeMetaLine,
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

/**
 * Its name (28 px), and one line under it (RV-4, the canvas's `RvRecipe`):
 * "Serves 4 · 35 min · Have 7 of 9"; then who it is from, with their face,
 * when it is someone's.
 */
export function RecipeHeader({
  recipe,
  meId,
  servesLabel,
  have = null,
}: {
  recipe: Pick<KitchenRecipe, "id" | "name" | "minutes" | "isSystem" | "mine" | "source" | "ownerId" | "ownerName" | "servesHalf">;
  meId: string | null;
  /** The portions at the page's size ("4", "about 2"); as written when absent. */
  servesLabel?: string | undefined;
  /** "Have 7 of 9", once the match has answered. */
  have?: string | null;
}) {
  const byline = recipeByline(recipe);
  // Its name is where a tapped card's title lands (RC-11's page transitions).
  const key = shareKey("recipe", recipe.id);
  return (
    <header className="-mt-1 flex min-w-0 flex-col gap-1.5">
      <h1 {...shareTarget(key, "title")} className="min-w-0 break-words text-[28px] font-medium leading-tight tracking-[-0.02em]">
        {recipe.name}
      </h1>
      <p className="text-sm font-normal tabular-nums text-muted-foreground">
        {recipeMetaLine(servesLabel ?? halvesText(recipe.servesHalf), recipe.minutes, have)}
      </p>
      {byline.kind !== "none" ? (
        <p className="flex items-center text-sm font-normal text-muted-foreground">
          <BylineView byline={byline} meId={meId} />
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
  const saved = "-mr-1 flex min-h-11 items-center gap-1.5 rounded-[14px] bg-cp-herb-tint px-3.5 text-[15px] font-medium text-cp-accent-text";
  if (savedId) {
    return (
      <Link href={recipeHref(savedId)} className={cn(saved, "transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
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
      className="-mr-1 flex min-h-11 items-center gap-1.5 rounded-[14px] bg-cp-accent-tint px-3.5 text-[15px] font-medium text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bookmark className="h-4 w-4" strokeWidth={2.2} aria-hidden />
      Save
    </button>
  );
}

const STEP_BUTTON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Servings (RV-4, the canvas's `RvRecipe`): − 4 + on a small card beside
 * Ingredients. It sets the one factor (`onFactor`), so every line follows.
 */
export function ServingsStepper({
  recipe,
  factorMilli,
  onFactor,
}: {
  recipe: Pick<KitchenRecipe, "servesHalf">;
  factorMilli: number;
  onFactor: (factorMilli: number) => void;
}) {
  const portions = portionsAt(recipe, factorMilli);
  const fewer = stepPortions(recipe, factorMilli, -1);
  const more = stepPortions(recipe, factorMilli, 1);
  return (
    <div role="group" aria-label="Servings" className={cn(K_CARD, "flex items-center gap-0.5 rounded-[14px] p-0.5")}>
      <button type="button" aria-label="Fewer portions" disabled={fewer === factorMilli} onClick={() => onFactor(fewer)} className={STEP_BUTTON}>
        <Minus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
      </button>
      <span aria-live="polite" className="min-w-7 text-center text-[15px] font-medium tabular-nums">
        {portions.label}
      </span>
      <button type="button" aria-label="More portions" disabled={more === factorMilli} onClick={() => onFactor(more)} className={STEP_BUTTON}>
        <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}

/** "Use all 450 g you have" (its main item, from your pantries), quiet; nothing when it would change nothing. */
export function UseAllChip({
  recipe,
  factorMilli,
  match,
  onFactor,
}: {
  recipe: Pick<KitchenRecipe, "lines">;
  factorMilli: number;
  match: Pick<RecipeMatchResponse, "lines"> | null;
  onFactor: (factorMilli: number) => void;
}) {
  const useAll = useAllFor(recipe, factorMilli, match);
  if (!useAll) return null;
  return (
    <button
      type="button"
      onClick={() => onFactor(useAll.factorMilli)}
      className="inline-flex min-h-11 items-center self-start rounded-full bg-cp-accent-tint px-3.5 text-sm font-medium text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {useAll.text}
    </button>
  );
}

/** The dot (RV-4): filled and muted when you have it, a ring in money-you-owe's colour when you don't. */
const DOT: Record<NonNullable<IngredientRow["status"]>, string> = {
  have: "bg-muted-foreground",
  always: "bg-muted-foreground/50",
  short: "border-2 border-cp-owe",
  missing: "border-2 border-cp-owe",
};

const AMOUNT: Record<NonNullable<IngredientRow["status"]>, string> = {
  have: "text-muted-foreground",
  always: "text-muted-foreground",
  short: "text-cp-owe",
  missing: "text-cp-owe",
};

/** The status words a screen reader hears before the line's own. */
const STATUS_WORD: Record<NonNullable<IngredientRow["status"]>, string> = { have: "Have", short: "Short", missing: "Missing", always: "Always have" };

/**
 * Ingredients (RV-4): the heading with `action` (the servings) beside it, and
 * one row per line — its dot, its name, its amount at the factor. What your
 * pantries hold for it is said to a screen reader.
 */
export function IngredientsSection({
  rows,
  failed,
  onRetry,
  action,
}: {
  rows: readonly IngredientRow[];
  match?: Pick<RecipeMatchResponse, "summary"> | null;
  failed?: boolean;
  onRetry?: (() => void) | undefined;
  action?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="recipe-ingredients" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <h2 id="recipe-ingredients" className={cn(K_SECTION, "flex-1")}>
          Ingredients
        </h2>
        {action ?? null}
      </div>
      <ul className={K_ROWS}>
        {rows.map((r) => (
          <li key={r.position} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
            <span aria-hidden className={cn("box-border h-2.5 w-2.5 shrink-0 rounded-full", r.status ? DOT[r.status] : "border-2 border-border")} />
            <span className="min-w-0 flex-1 truncate text-base font-medium">
              {r.name}
              {r.isMain ? <span className="font-normal text-muted-foreground"> · main</span> : null}
              {r.status ? (
                <span className="sr-only">
                  {" "}
                  {STATUS_WORD[r.status]}
                  {r.statusText ? `: ${r.statusText}` : ""}
                </span>
              ) : null}
            </span>
            <span className={cn("shrink-0 text-right text-[15px] font-medium tabular-nums", r.status ? AMOUNT[r.status] : "text-muted-foreground")}>{r.amount}</span>
          </li>
        ))}
      </ul>
      {failed && onRetry ? (
        <button type="button" onClick={onRetry} className="min-h-11 self-start rounded-lg px-1 text-sm font-medium text-cp-accent-text hover:underline">
          Check your kitchen again
        </button>
      ) : null}
    </section>
  );
}

/**
 * Steps · N, numbered on the tint, one card of rows (RV-4); folded until
 * opened unless `initiallyOpen`. With `rows` (cookpool-guided GC-6) each step
 * shows its flame, its range at the page's size, what to watch for, Hands
 * off and the learned badge; `planHref` puts The plan beside the heading.
 */
export function StepsSection({
  steps,
  rows,
  planHref,
  initiallyOpen = false,
}: {
  steps: readonly string[];
  rows?: readonly StepRow[] | undefined;
  planHref?: string | null | undefined;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(initiallyOpen);
  const id = React.useId();
  return (
    <section aria-label="Steps" className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 flex-1 items-center justify-between gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={K_SECTION}>Steps · {steps.length}</span>
          <ChevronDown className={cn("h-5 w-5 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {planHref ? (
          <Link
            href={planHref}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-cp-accent-tint px-3.5 text-[15px] font-medium text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ListOrdered className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            The plan
          </Link>
        ) : null}
      </div>
      {open && rows ? (
        <ol id={id} className="flex flex-col gap-2">
          {rows.map((row) => (
            <GuidedStepItem key={row.position} row={row} />
          ))}
        </ol>
      ) : open ? (
        <ol id={id} className={K_ROWS}>
          {steps.map((text, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3">
              <span aria-hidden className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-cp-accent-tint text-[13px] font-medium text-cp-accent-text">
                {i + 1}
              </span>
              <span className="text-[15px] font-normal leading-snug">{text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/**
 * The one main button, Start cooking, on the accent with the pot (RV-4):
 * the session at this factor. "For about 2 · chicken 450 g" is said to a
 * screen reader. Held above the tab bar while the page is longer than the
 * screen.
 */
export function StartCookingBar({ href, line }: { href: string; line: string }) {
  return (
    <div
      data-toast-above=""
      className="sticky bottom-[calc(max(14px,env(safe-area-inset-bottom))+76px)] z-30 -mx-4 bg-gradient-to-t from-background from-70% to-transparent px-4 pb-2 pt-3.5 min-[900px]:bottom-6 min-[900px]:mx-0 min-[900px]:bg-none min-[900px]:px-0"
    >
      <Link
        href={href}
        className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-[18px] bg-primary px-4 text-[17px] font-medium text-primary-foreground shadow-cp-card transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <CookingPot className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
        Start cooking
        <span className="sr-only">, {line}</span>
      </Link>
    </div>
  );
}

export function RecipeNotFound() {
  return (
    <KCard className="flex gap-4 p-5">
      <BookOpen className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-3">
        <h1 className="text-lg font-medium">This recipe isn&apos;t here</h1>
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

