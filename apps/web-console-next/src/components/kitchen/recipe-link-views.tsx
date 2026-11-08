"use client";

import * as React from "react";
import Link from "./link";
import { Link2Off } from "lucide-react";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON } from "./kit";
import { Face } from "./faces-ui";
import { recipeHref } from "./recipes";
import { StepsSection } from "./recipe-views";
import { LINK_GONE_TEXT, linkSaveNote, linkSavedNote, sharedByText, servesLine, type LinkLine, type LinkSave } from "./recipe-share";

/**
 * The link page's parts as they draw (cookpool-recipes RC-8, the canvas's
 * `ShareRecipe` "Opened from a link"), from what was read: no reads or
 * writes, so each is rendered in tests. `recipe-link-ui.tsx` puts them
 * together over the data.
 */

const DOT: Record<NonNullable<LinkLine["tone"]>, string> = { have: "bg-primary", short: "bg-[#D97706]", missing: "bg-[#B42318]" };
const TONE_WORD: Record<NonNullable<LinkLine["tone"]>, string> = { have: "Have", short: "Short", missing: "Missing" };

/** The page as it draws, from what was read (no reads or writes, so tests render it). */
export function RecipeLinkView({
  recipe,
  meId,
  lines,
  have,
  save,
  onSave,
  onUndo,
  back,
}: {
  recipe: Pick<KitchenRecipe, "id" | "name" | "servesHalf" | "minutes" | "mine" | "isSystem" | "ownerId" | "ownerName" | "steps">;
  meId: string | null;
  lines: readonly LinkLine[];
  have: { text: string; complete: boolean } | null;
  save: LinkSave;
  onSave: () => void;
  onUndo: () => void;
  /** The back control (the screen's). */
  back?: React.ReactNode;
}) {
  const by = sharedByText(recipe);
  const names = new Map([[recipe.ownerId, recipe.isSystem ? "Cookpool" : recipe.ownerName]]);
  return (
    <div className="flex w-full max-w-xl flex-col gap-4 pb-2">
      <div className="flex items-center gap-2.5">
        {back ?? null}
        <Face subjectId={recipe.ownerId} meId={meId} names={names} className="h-10 w-10 text-sm" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-extrabold">{by.title}</span>
          <span className="truncate text-[13px] font-semibold text-muted-foreground">{by.sub}</span>
        </span>
      </div>

      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="break-words text-[28px] font-extrabold leading-tight tracking-[-0.02em]">{recipe.name}</h1>
        <p className="text-sm font-bold tabular-nums text-[#3F4842]">{servesLine(recipe)}</p>
      </header>

      <section aria-label="Ingredients" className="flex flex-col gap-2">
        <ul className="divide-y divide-[#ECEEE9] overflow-hidden rounded-[22px] border bg-card">
          {lines.map((l) => (
            <li key={l.position} className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
              <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", l.tone ? DOT[l.tone] : "border border-[#C9CFC6]")} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold">
                {l.tone ? <span className="sr-only">{TONE_WORD[l.tone]}: </span> : null}
                {l.name}
              </span>
              <span className="shrink-0 text-[15px] font-bold tabular-nums text-[#3F4842]">{l.amount}</span>
            </li>
          ))}
        </ul>
        {have ? <p className={cn("text-[13px] font-extrabold tabular-nums", have.complete ? "text-[#165C3A]" : "text-[#8A5A00]")}>{have.text}</p> : null}
      </section>

      {recipe.steps.length > 0 ? <StepsSection steps={recipe.steps} /> : null}

      <LinkSaveBar recipe={recipe} save={save} onSave={onSave} onUndo={onUndo} />
    </div>
  );
}

const MAIN = "flex min-h-[60px] w-full items-center justify-center rounded-[18px] px-4 text-[17px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** The one main button, held above the tab bar, and the line under it. */
function LinkSaveBar({
  recipe,
  save,
  onSave,
  onUndo,
}: {
  recipe: Pick<KitchenRecipe, "isSystem" | "ownerName">;
  save: LinkSave;
  onSave: () => void;
  onUndo: () => void;
}) {
  return (
    <div
      data-toast-above=""
      className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-30 -mx-4 flex flex-col gap-2 bg-background px-4 pb-2 pt-3 min-[900px]:bottom-6 min-[900px]:mx-0 min-[900px]:bg-transparent min-[900px]:px-0"
    >
      {save.kind === "save" ? (
        <button type="button" onClick={onSave} className={cn(MAIN, "bg-primary text-primary-foreground hover:bg-primary/90")}>
          Save to my recipes
        </button>
      ) : save.kind === "saved" ? (
        <button type="button" onClick={onUndo} className={cn(MAIN, "border border-[#D5DAD2] bg-card text-[#3F4842] hover:bg-accent")}>
          Saved · Undo
        </button>
      ) : (
        <Link href={recipeHref(save.kind === "had" ? save.copyId : save.recipeId)} className={cn(MAIN, "bg-cp-herb-tint text-[#165C3A] hover:bg-[#D3EADC]")}>
          {save.kind === "had" ? "Open your copy" : "Open your recipe"}
        </Link>
      )}
      <p className="text-center text-[13px] font-semibold text-muted-foreground">
        {save.kind === "save" ? (
          linkSaveNote(recipe)
        ) : save.kind === "saved" ? (
          save.copyId ? (
            <Link href={recipeHref(save.copyId)} className="inline-flex min-h-11 items-center font-extrabold text-primary hover:underline">
              {linkSavedNote(recipe)}
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center">Saving your copy…</span>
          )
        ) : save.kind === "had" ? (
          "You saved it before"
        ) : (
          "Anyone with this link can see it"
        )}
      </p>
    </div>
  );
}

/** A dead, rotated or mistyped link: what happened, and the way back to Cook. */
export function LinkGone() {
  return (
    <KCard className="flex gap-4 p-5">
      <Link2Off className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-3">
        <h1 className="text-lg font-bold">{LINK_GONE_TEXT}</h1>
        <p className="text-sm text-muted-foreground">Ask for a new one.</p>
        <Button asChild variant="outline" className={K_BUTTON}>
          <Link href="/cook">Cook</Link>
        </Button>
      </div>
    </KCard>
  );
}

export function LinkSkeleton() {
  return (
    <div className="flex max-w-xl flex-col gap-4" aria-hidden>
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-72 w-full rounded-[22px]" />
    </div>
  );
}
