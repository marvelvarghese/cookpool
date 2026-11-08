"use client";

import * as React from "react";
import type { KitchenRecipe, RecipeMatchResponse } from "@saas/contracts/kitchen";
import { foodAsks, type FoodAsk } from "./always-have";
import { useAnswerFood, useAnsweredNames } from "./recipe-travel-data";

/**
 * The food ask on a recipe's page (cookpool-recipes RC-8, design §2): an
 * item your pantries hold that links to no food, and looks like a missing
 * line's ("Kanda onion" beside Onions), gets one small card — "Is Kanda
 * onion onion?", Yes and No — once per name. Either answer is kept for that
 * name in each pantry holding it, and the match is read again.
 */

/** One ask as it draws. */
export function FoodAskCard({ ask, busy, onAnswer }: { ask: Pick<FoodAsk, "question">; busy: boolean; onAnswer: (yes: boolean) => void }) {
  return (
    <div role="group" aria-label={ask.question} className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[#F0DDB0] bg-[#FFF8E6] py-2 pl-4 pr-2">
      <p className="min-w-0 flex-1 text-[15px] font-extrabold">{ask.question}</p>
      <div className="flex shrink-0 gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(true)}
          className="min-h-11 rounded-xl bg-primary px-4 text-[15px] font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          Yes
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(false)}
          className="min-h-11 rounded-xl border border-[#C9CFC6] bg-card px-4 text-[15px] font-extrabold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          No
        </button>
      </div>
    </div>
  );
}

/** The asks as they draw: nothing when there are none. */
export function FoodAskListView({ asks, busy, onAnswer }: { asks: readonly FoodAsk[]; busy: ReadonlySet<string>; onAnswer: (ask: FoodAsk, yes: boolean) => void }) {
  if (asks.length === 0) return null;
  return (
    <section aria-label="Is this the same food?" className="flex flex-col gap-2">
      {asks.map((a) => (
        <FoodAskCard key={a.nameKey} ask={a} busy={busy.has(a.nameKey)} onAnswer={(yes) => onAnswer(a, yes)} />
      ))}
    </section>
  );
}

/** The asks for a recipe at what its match found. An answered name goes at once and never comes back. */
export function FoodAsks({ recipe, match }: { recipe: Pick<KitchenRecipe, "lines">; match: Pick<RecipeMatchResponse, "lines" | "unlinked"> | null }) {
  const [answered, markAnswered] = useAnsweredNames();
  const answer = useAnswerFood();
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(() => new Set());
  const asks = React.useMemo(() => foodAsks(recipe, match, answered), [recipe, match, answered]);
  return (
    <FoodAskListView
      asks={asks}
      busy={busy}
      onAnswer={(ask, yes) => {
        setBusy((b) => new Set(b).add(ask.nameKey));
        void answer(ask, yes).then((ok) => {
          setBusy((b) => {
            const next = new Set(b);
            next.delete(ask.nameKey);
            return next;
          });
          if (ok) markAnswered(ask.nameKey);
        });
      }}
    />
  );
}
