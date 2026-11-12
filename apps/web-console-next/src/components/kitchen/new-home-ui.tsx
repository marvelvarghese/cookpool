"use client";

import * as React from "react";
import Link from "./link";
import type { AskInboxItem, KitchenRecipe } from "@saas/contracts/kitchen";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { shareKey, sharePart } from "@/lib/transitions";
import { useGroups, useProfile } from "./data";
import { friendlyName, homeGreeting } from "./home";
import { personInitials } from "./you";
import { KCard, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { Face } from "./faces-ui";
import { memberLabel, type MemberNames } from "./members";
import { useMemberNames } from "./people-data";
import { useInbox } from "./inbox-data";
import { AskCards } from "./ask-card-ui";
import { askArrival, askCardsShown, parseAskParam, type AnsweredAsk } from "./ask-card";
import { HomeTodoList } from "./inbox-ui";
import { InstallCard } from "./install-ui";
import { QuickUse } from "./quick-use-ui";
import { HOME_DISH_DAYS, feedCards, type FeedCard } from "./cooks";
import { useMyDishes } from "./cooks-data";
import { homeSections, newHomeTodoOrder } from "./new-home";
import { firstThree, groupsCookedMeta } from "./new-home-look";
import { BalancePillLink, HomeCookNow, RING, ResumeStrip, RowsSkeleton, SaveRecipeIcon, SeeAllButton, pillClass } from "./new-home-parts-ui";
import { splitReminders, withoutJustMeFinalize } from "./cooked";
import { SplitReminderCards } from "./split-reminder-ui";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import { useRecipesInFull } from "./recipes-data";
import { feedRecipeFor, feedRecipeIds } from "./explore";

/**
 * The new frame's Home (cookpool-recipes RC-2; cookpool-revamp RV-3, the
 * canvas's `HomeRevamp`), in `homeSections(true)`'s order: your avatar,
 * "Hi, Rahul" and the balance pill (opening Money); What did you use? (with
 * your usuals); the cooking session you left, with Resume; Needs you — the
 * asks and split reminders, then an open dish to claim ("I had some" opens
 * its ½-step chips), Pay X, then food to use soon or past its date, three
 * then See all; Cook now (RC-5); Your groups cooked (RC-2's From your
 * groups, RC-8's Save). No money card: the pill is the one number.
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
    <div className="space-y-[22px]">
      {shows.has("greeting") ? (
        <header className="flex min-h-11 items-center gap-3">
          {/* Your avatar opens You (SI-6); from 900px the sidebar's "Me" does. */}
          <Link
            href="/you"
            aria-label="You"
            className={cn("grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-primary text-[15px] font-medium text-primary-foreground min-[900px]:hidden", RING)}
          >
            {user ? personInitials(user) : ""}
          </Link>
          {profile.loading ? (
            <Skeleton className="h-8 w-40 flex-1" />
          ) : (
            <h1 className={cn(K_TITLE, "min-w-0 flex-1 truncate")}>{homeGreeting(name)}</h1>
          )}
          <BalancePillLink />
        </header>
      ) : null}

      {shows.has("install") ? <InstallCard /> : null}

      <div className="flex flex-col gap-[22px] min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:items-start min-[900px]:gap-6">
        <div className="flex min-w-0 flex-col gap-[22px]">
          {shows.has("quick-use") ? <QuickUse meId={meId} fresh /> : null}
          <ResumeStrip meId={meId} />
          {shows.has("todo") ? (
            <HomeTodoList
              inbox={ordered}
              meId={meId}
              names={names}
              lead={lead}
              fresh
            />
          ) : null}
          {shows.has("cook-now") ? <HomeCookNow /> : null}
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

/**
 * "Your groups cooked" (the board; RC-2's From your groups): one row for each
 * dish finished in one of your groups in the last 7 days — the cook's face,
 * the dish, "Anu · you had 1 · ₹31.20 each" — opening the dish, with Save
 * when it was cooked from a recipe you may see that isn't yours (RC-8).
 * Three, then See all.
 */
function FromYourGroups({ meId, names }: { meId: string | null; names: MemberNames }) {
  const groups = useGroups();
  const dishes = useMyDishes(HOME_DISH_DAYS);
  const [now] = React.useState(() => new Date());
  const [all, setAll] = React.useState(false);
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
  const shown = firstThree(cards, all);

  return (
    <section aria-labelledby="home-from-groups" className="min-w-0 space-y-2.5">
      <h2 id="home-from-groups" className={K_SECTION}>
        Your groups cooked
      </h2>
      {dishes.loading || groups.loading ? (
        <RowsSkeleton />
      ) : dishes.failed ? (
        <KCard className="flex min-h-16 items-center justify-between gap-3 px-4 py-2">
          <p className="text-sm font-normal text-muted-foreground">Couldn&apos;t load what your groups cooked.</p>
          <button type="button" className={pillClass()} onClick={dishes.reload}>
            Try again
          </button>
        </KCard>
      ) : cards.length === 0 ? (
        <KCard className="flex min-h-14 items-center px-4 text-sm font-normal text-muted-foreground">{hasGroups ? "Nothing finished this week" : "No groups yet"}</KCard>
      ) : (
        <div className={K_ROWS}>
          <ul className="divide-y divide-cp-line">
            {shown.rows.map((card) => (
              <li key={card.dishId}>
                <GroupsCookedRow card={card} meId={meId} names={names} recipe={feedRecipeFor(card.dishId, recipeOf, recipes)} />
              </li>
            ))}
          </ul>
          {shown.more ? <SeeAllButton label={shown.label} all={all} onToggle={() => setAll((v) => !v)} /> : null}
        </div>
      )}
    </section>
  );
}

function GroupsCookedRow({ card, meId, names, recipe }: { card: FeedCard; meId: string | null; names: MemberNames; recipe: KitchenRecipe | null }) {
  const prefetch = usePrefetchKitchen();
  const cook = memberLabel(card.cookId, meId, names);
  return (
    <div className="flex min-h-16 items-center gap-3 py-2.5 pl-3.5 pr-2">
      <Face subjectId={card.cookId} meId={meId} names={names} className="h-[42px] w-[42px] text-sm font-medium" />
      <Link
        {...pressIn(() => prefetch.dish(card.dishId, card.orgId))}
        href={card.href}
        share={shareKey("dish", card.dishId)}
        className={cn("flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-px rounded-lg", RING)}
      >
        <span {...sharePart("title")} className="truncate text-base font-medium">
          {card.name}
        </span>
        <span className="truncate text-[13px] font-normal tabular-nums text-muted-foreground">{groupsCookedMeta(card, cook)}</span>
      </Link>
      {recipe && !recipe.mine ? <SaveRecipeIcon recipe={recipe} /> : null}
    </div>
  );
}
