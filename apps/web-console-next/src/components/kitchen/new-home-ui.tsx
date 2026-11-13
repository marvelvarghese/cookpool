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
import { askArrival, askCardsShown, parseAskParam, type AnsweredAsk } from "./ask-card";
import { NeedsYou } from "./inbox-needs-ui";
import { InstallCard } from "./install-ui";
import { HOME_DISH_DAYS, feedCards, type FeedCard } from "./cooks";
import { useMyDishes } from "./cooks-data";
import { homeSections } from "./new-home";
import { firstThree, groupsCookedMeta, youPaid } from "./new-home-look";
import { BalancePillLink, HomeCookTonight, HomeQuickActions, RING, ResumeStrip, RowsSkeleton, SaveRecipeIcon, SeeAllButton, pillClass } from "./new-home-parts-ui";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import { useRecipesInFull } from "./recipes-data";
import { feedRecipeFor, feedRecipeIds } from "./explore";

/**
 * The new frame's Home (cookpool-recipes RC-2; cookpool-revamp RV-3 and
 * RV-15; since cookpool-home HM-2 the calm boards `Main`, `AllClear` and
 * `Cooking`), top to bottom: your avatar, "Hi, Rahul" and the balance pill
 * (opening Money) — no date, no summary; the cooking session you left, with
 * Resume; the quick actions (Scan bill, Log use, Cook, Groceries); Install
 * Cookpool (from the device's second day, never once installed); Needs you —
 * every kind of row, three then See all, and "All caught up" when there are
 * none; Cook tonight, one card. No money card (the pill is the one number)
 * and no groups feed (HM-3 puts it on Kitchen).
 *
 * From 900px, two columns: the session, the actions and Cook tonight on the
 * left; install and Needs you on the right.
 */
export function NewHome() {
  const shows = new Set(homeSections(true));
  const profile = useProfile();
  const user = profile.data;
  const meId = user?.id ?? null;
  const name = user ? friendlyName(user.displayName, user.email) : null;
  const names = useMemberNames();
  const inbox = useInbox();
  // Ask before use (cookpool-pantry PN-9): the asks you answer are Needs you's first rows.
  const asks = useHomeAsks(inbox.data?.asks ?? null);

  return (
    <div className="space-y-[22px]">
      {shows.has("greeting") ? (
        <header className="flex min-h-11 items-center gap-3">
          {/* Your avatar opens You (SI-6); from 900px the sidebar's "Me" does. */}
          <Link
            href="/you"
            aria-label="You"
            className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cp-accent-tint text-[15px] font-medium text-cp-accent-text min-[900px]:hidden", RING)}
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

      <div className="flex flex-col gap-6 min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:items-start">
        {/* `contents` on a phone, so the two columns' parts interleave in the boards' order. */}
        <div className="contents min-[900px]:flex min-[900px]:min-w-0 min-[900px]:flex-col min-[900px]:gap-6">
          <ResumeStrip meId={meId} />
          {shows.has("quick-actions") ? <HomeQuickActions /> : null}
          {/* Last on a phone (after Needs you), last of the left column from 900px. */}
          {shows.has("cook-tonight") ? <HomeCookTonight className="order-last min-[900px]:order-none" /> : null}
        </div>
        <div className="contents min-[900px]:flex min-[900px]:min-w-0 min-[900px]:flex-col min-[900px]:gap-6">
          {shows.has("install") ? <InstallCard fresh /> : null}
          {shows.has("todo") ? <NeedsYou inbox={inbox} meId={meId} names={names} asks={asks} caughtUp /> : null}
        </div>
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
 * the dish, "Anu · you had 1 · ₹54" (what you paid) — opening the dish, with Save
 * when it was cooked from a recipe you may see that isn't yours (RC-8).
 * Three, then See all.
 */
export function FromYourGroups({ meId, names }: { meId: string | null; names: MemberNames }) {
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
  // What you paid for each (the board's "Anu · you had 1 · ₹54"): your line of its split.
  const paid = React.useMemo(() => youPaid(dishes.dishes, meId), [dishes.dishes, meId]);

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
                <GroupsCookedRow card={card} paid={paid.get(card.dishId) ?? null} meId={meId} names={names} recipe={feedRecipeFor(card.dishId, recipeOf, recipes)} />
              </li>
            ))}
          </ul>
          {shown.more ? <SeeAllButton label={shown.label} all={all} onToggle={() => setAll((v) => !v)} /> : null}
        </div>
      )}
    </section>
  );
}

function GroupsCookedRow({ card, paid, meId, names, recipe }: { card: FeedCard; paid: string | null; meId: string | null; names: MemberNames; recipe: KitchenRecipe | null }) {
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
        <span className="truncate text-[13px] font-normal tabular-nums text-muted-foreground">{groupsCookedMeta(card, cook, paid)}</span>
      </Link>
      {recipe && !recipe.mine ? <SaveRecipeIcon recipe={recipe} /> : null}
    </div>
  );
}
