"use client";

import * as React from "react";
import Link from "./link";
import { CookingPot } from "lucide-react";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { shareKey, sharePart } from "@/lib/transitions";
import { useGroups, useProfile } from "./data";
import { friendlyName, homeGreeting } from "./home";
import { K_BUTTON } from "./kit";
import { Face } from "./faces-ui";
import { memberLabel, type MemberNames } from "./members";
import { useMemberNames } from "./people-data";
import { useInbox } from "./inbox-data";
import { useSearchParams } from "next/navigation";
import type { AskInboxItem } from "@saas/contracts/kitchen";
import { useToast } from "@/components/ui/toast";
import { AskCards } from "./ask-card-ui";
import { askArrival, askCardsShown, parseAskParam, type AnsweredAsk } from "./ask-card";
import { HomeTodoList } from "./inbox-ui";
import { InstallCard } from "./install-ui";
import { QuickUse } from "./quick-use-ui";
import { CookNow } from "./cook-now-slot";
import { HOME_DISH_DAYS, feedCards, type FeedCard } from "./cooks";
import { useMyDishes } from "./cooks-data";
import { homeSections, newHomeTodoOrder } from "./new-home";
import { splitReminders, withoutJustMeFinalize } from "./cooked";
import { SplitReminderCards } from "./split-reminder-ui";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import { recipeHref } from "./recipes";
import { useRecipesInFull } from "./recipes-data";
import { FeedRecipeRowView, SaveCopyChip } from "./cook-hub-views";
import { feedRecipeFor, feedRecipeIds, feedRecipeText } from "./explore";
import { useSaveCopy } from "./recipe-travel-data";

/**
 * The new frame's Home (cookpool-recipes RC-2, design §1.4, the canvas's
 * `NewHome`), in `homeSections(true)`'s order: "Hi, Rahul"; What did you use?
 * (with your usuals); To do — an open dish to claim, with its ½-step chips in
 * the row, then Pay X, then food to use soon or past its date; Cook now (a
 * slot RC-5 fills; nothing yet); From your groups — what was finished in your
 * groups this week, with the recipe it was cooked from when you may see it
 * ("Anu's recipe" and Save, RC-8). No money card: money lives in Money, and
 * a debt that needs you is a To do.
 *
 * From 900px, two columns: what needs you on the left, your groups' cooks on
 * the right.
 */
export function NewHome() {
  const shows = new Set(homeSections(true));
  const profile = useProfile();
  const user = profile.data;
  const meId = user?.id ?? null;
  const name = user ? friendlyName(user.displayName, user.email) : null;
  const names = useMemberNames();
  const inbox = useInbox();
  // Dishes first, then Pay X, then use soon (the canvas), each in the server's order; no just-me
  // "Finalize" (cookpool-community CM-9: it posts nothing; splitting it is the reminder's).
  const ordered = React.useMemo(() => (inbox.data ? { ...inbox, data: withoutJustMeFinalize(newHomeTodoOrder(inbox.data)) } : inbox), [inbox]);
  // Ask before use (cookpool-pantry PN-9): the asks you answer go first in To do.
  const asks = useHomeAsks(inbox.data?.asks ?? null);
  // Then "Split Chicken curry with Flat 4B?" (CM-9).
  const reminders = splitReminders(inbox.data);
  const lead =
    asks.count > 0 || reminders.length > 0 ? (
      <>
        {asks.count > 0 ? <AskCards asks={inbox.data?.asks ?? []} answered={asks.answered} onAnswered={asks.setAnswered} meId={meId} names={names} highlight={asks.highlight} /> : null}
        <SplitReminderCards items={reminders} />
      </>
    ) : undefined;

  return (
    <div className="space-y-4">
      {shows.has("greeting") ? (
        <header className="flex min-h-11 items-center">
          {profile.loading ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <h1 className="min-w-0 truncate text-[26px] font-extrabold leading-tight tracking-tight">{homeGreeting(name)}</h1>
          )}
        </header>
      ) : null}

      {shows.has("install") ? <InstallCard /> : null}

      <div className="flex flex-col gap-4 min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:items-start min-[900px]:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {shows.has("quick-use") ? <QuickUse meId={meId} /> : null}
          {shows.has("todo") ? (
            <HomeTodoList
              inbox={ordered}
              meId={meId}
              names={names}
              lead={lead}
            />
          ) : null}
          {shows.has("cook-now") ? <CookNow meId={meId} /> : null}
        </div>
        {shows.has("from-groups") ? <FromYourGroups meId={meId} names={names} /> : null}
      </div>
    </div>
  );
}

/**
 * The ask cards' state on Home (PN-9): the answers given here (each card
 * stays, with Undo, after the inbox moves on), and `?ask=<askId>` — the
 * push's address — scrolling to that card and lighting it up, or saying it
 * was already answered. The address drops `?ask=` once it is used.
 */
function useHomeAsks(listed: readonly AskInboxItem[] | null) {
  const params = useSearchParams();
  const { toast } = useToast();
  const target = parseAskParam(params?.get("ask"));
  const [answered, setAnsweredMap] = React.useState<ReadonlyMap<string, AnsweredAsk>>(new Map());
  const [highlight, setHighlight] = React.useState<string | null>(null);
  const setAnswered = React.useCallback((id: string, a: AnsweredAsk | null) => {
    setAnsweredMap((m) => {
      const next = new Map(m);
      if (a) next.set(id, a);
      else next.delete(id);
      return next;
    });
  }, []);
  const shown = askCardsShown(listed, answered);
  const shownIds = listed === null ? null : shown.map((s) => s.ask.id);
  const arrival = askArrival(target, shownIds);
  const used = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!target || !arrival || used.current === target) return;
    used.current = target;
    const now = new URLSearchParams(window.location.search);
    now.delete("ask");
    const qs = now.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    if (arrival === "gone") {
      toast({ kind: "warning", title: "Already answered", description: "That ask was answered or has lapsed." });
      return;
    }
    setHighlight(target);
    window.requestAnimationFrame(() => document.querySelector(`[data-ask-id="${target}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [target, arrival, toast]);
  // The light goes out after a few seconds.
  React.useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [highlight]);
  return { answered, setAnswered, highlight, count: shown.length };
}

/** "From your groups": a card for each dish finished in one of your groups in the last 7 days. */
function FromYourGroups({ meId, names }: { meId: string | null; names: MemberNames }) {
  const groups = useGroups();
  const dishes = useMyDishes(HOME_DISH_DAYS);
  const [now] = React.useState(() => new Date());
  const groupNames = React.useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name] as const)), [groups.data]);
  const cards = React.useMemo(
    () => feedCards(dishes.dishes, { meId, names, groupNames, now }),
    [dishes.dishes, meId, names, groupNames, now],
  );
  const hasGroups = (groups.data?.length ?? 0) > 0;
  // The recipes the cards' dishes were cooked from (RC-8): each shows once its read succeeds (a 404 is one you may not see).
  const recipeOf = React.useMemo(() => feedRecipeIds(dishes.dishes, cards.map((c) => c.dishId)), [dishes.dishes, cards]);
  const recipeIds = React.useMemo(() => [...new Set(recipeOf.values())], [recipeOf]);
  const recipes = useRecipesInFull(recipeIds);

  return (
    <section aria-labelledby="home-from-groups" className="min-w-0 space-y-2">
      <h2 id="home-from-groups" className="text-lg font-extrabold tracking-tight">
        From your groups
      </h2>
      {dishes.loading || groups.loading ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-[168px] w-full rounded-[22px]" />
          <Skeleton className="h-[168px] w-full rounded-[22px]" />
        </div>
      ) : dishes.failed ? (
        <div className="flex min-h-[68px] items-center justify-between gap-3 rounded-[22px] border bg-card px-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load what your groups cooked.</p>
          <Button variant="outline" className={K_BUTTON} onClick={dishes.reload}>
            Try again
          </Button>
        </div>
      ) : cards.length === 0 ? (
        <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">
          {hasGroups ? "Nothing finished this week" : "No groups yet"}
        </p>
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => (
            <li key={card.dishId}>
              <FeedCardView card={card} meId={meId} names={names} recipe={feedRecipeFor(card.dishId, recipeOf, recipes)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FeedCardView({ card, meId, names, recipe }: { card: FeedCard; meId: string | null; names: MemberNames; recipe: KitchenRecipe | null }) {
  if (!recipe) return <FeedCardLink card={card} meId={meId} names={names} />;
  // With the recipe it was cooked from (RC-8): the card, then "Anu's recipe" and Save under it.
  return (
    <article className="rounded-[22px] border bg-card shadow-[0_1px_2px_rgba(23,32,27,0.04)]">
      <FeedCardLink card={card} meId={meId} names={names} bare />
      <div className="px-4 pb-2">
        <FeedRecipeRowView
          text={feedRecipeText(recipe, memberLabel(card.cookId, meId, names))}
          href={recipeHref(recipe.id)}
          save={recipe.mine ? null : <FeedRecipeSave recipe={recipe} />}
        />
      </div>
    </article>
  );
}

/** Save on a feed card's recipe: your own copy. */
function FeedRecipeSave({ recipe }: { recipe: KitchenRecipe }) {
  const copy = useSaveCopy(recipe);
  return <SaveCopyChip name={recipe.name} savedId={copy.savedId} saving={copy.saving} onSave={copy.save} icon />;
}

function FeedCardLink({ card, meId, names, bare = false }: { card: FeedCard; meId: string | null; names: MemberNames; bare?: boolean }) {
  const prefetch = usePrefetchKitchen();
  return (
    <Link
      {...pressIn(() => prefetch.dish(card.dishId, card.orgId))}
      href={card.href}
      share={shareKey("dish", card.dishId)}
      className={
        bare
          ? "block rounded-t-[22px] p-4 pb-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "block rounded-[22px] border bg-card p-4 shadow-[0_1px_2px_rgba(23,32,27,0.04)] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      <span className="flex items-center gap-3">
        <Face subjectId={card.cookId} meId={meId} names={names} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold">{card.cookText}</span>
          <span className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
            <CookingPot className="h-3.5 w-3.5 shrink-0 text-[#B4471F]" strokeWidth={2.2} aria-hidden />
            <span className="truncate">
              {card.groupName} · {card.when}
            </span>
          </span>
        </span>
      </span>
      <span {...sharePart("title")} className="mt-2.5 block truncate text-lg font-extrabold leading-snug tracking-tight">
        {card.name}
      </span>
      <span className="mt-2 grid grid-cols-3 gap-2">
        <Stat value={card.portions} label="portions" />
        <Stat value={card.each} label="each" />
        <Stat value={card.youHad} label="you had" />
      </span>
    </Link>
  );
}

/** One of a card's three numbers: the number big, a word under it. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-0 flex-col rounded-[14px] bg-background px-3 py-2">
      <span className="truncate text-[17px] font-extrabold leading-tight tabular-nums">{value}</span>
      <span className="truncate text-xs font-semibold text-muted-foreground">{label}</span>
    </span>
  );
}
