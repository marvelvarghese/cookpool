"use client";

import * as React from "react";
import Link from "./link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { PersonViewResponse, RecipeSummary } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroups, useProfile } from "./data";
import { KCard, K_BUTTON, K_CARD, K_TITLE } from "./kit";
import { BackButton } from "./back-ui";
import { Face } from "./faces-ui";
import { RECIPES_AND_COOKS, YOU_COOKS_HREF } from "./you";
import { useMemberNames, usePerson } from "./people-data";
import { firstName, personName, recordOptions } from "./people";
import type { MoneyLine } from "./home";
import { personBalance } from "./money-page";
import { useMyDishes } from "./cooks-data";
import {
  PROFILE_DISH_DAYS,
  cookCount,
  cookCountText,
  cooksAWeek,
  cooksAWeekText,
  cooksText,
  recentCooks,
  sharedGroupsLine,
  weekLabel,
  yourGroupsLine,
  type CookRow,
} from "./cooks";
import { PersonSkeleton, RecordPayment, WhyGroup, safeDecode } from "./person-ui";
import { pressIn, usePrefetchKitchen } from "./prefetch";
import { useMyRecipes, usePrefetchRecipe } from "./recipes-data";
import { profileListFrom, profileRecipeRows, recipeStats, type ProfileList } from "./cook-hub";
import { PersonRecipesView, SaveCopyChip, Segmented, YourRecipes } from "./cook-hub-views";
import { personHref, personListFrom, personRecipeRows, type PersonList, type PersonRecipeRow } from "./explore";
import { usePersonRecipes, useSaveCopy } from "./recipe-travel-data";

/**
 * Your page and a person's in the new frame (cookpool-recipes RC-2, design
 * §1.4, the canvas's `Profile`). Both read your dishes and your groups' —
 * the one read the app already has — for the cooks they show.
 *
 * - **Your recipes and cooks** (`/you/cooks`, You's Account row since
 *   cookpool-revamp RV-6; it was `/you` itself): the groups you are in;
 *   Cooks, Recipes, Saved by and Groups; "Cooks a week" over the last 8
 *   weeks; then Recipes | Cooks (RC-5): your recipes, each with who can see
 *   it, or your recent cooks — the choice kept in the address
 *   (`?list=cooks`). Your @handle, Followers and Following moved to Name and
 *   handle (`/you/settings`).
 * - **A person** (`/people/[id]`): their face and name, "In Flat 4B with you";
 *   what is between you two ("You get back ₹40.00") with Settle up; Cooks,
 *   Recipes and Saved by; Recipes | Cooks (RC-8; `?list=cooks`) — the
 *   recipes of theirs you may see, each with Save, or their recent cooks in
 *   the groups you share; and the Why, open, under its heading.
 */

// ── You ───────────────────────────────────────────────────────────

export function YourCooks() {
  const profile = useProfile();
  const groups = useGroups();
  const dishes = useMyDishes(PROFILE_DISH_DAYS);
  const meId = profile.data?.id ?? null;
  const [now] = React.useState(() => new Date());
  const groupNames = React.useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name] as const)), [groups.data]);
  const counts = React.useMemo(() => cooksAWeek(dishes.dishes, meId, now), [dishes.dishes, meId, now]);
  const rows = React.useMemo(() => recentCooks(dishes.dishes, meId, { groupNames, now }), [dishes.dishes, meId, groupNames, now]);
  const cooks = cookCountText(cookCount(dishes.dishes, meId), dishes.complete);
  const recipes = useMyRecipes();
  const stats = recipes.data ? recipeStats(recipes.data) : null;
  const recipeRows = React.useMemo(() => (recipes.data ? profileRecipeRows(recipes.data) : []), [recipes.data]);
  const searchParams = useSearchParams();
  const list = profileListFrom(searchParams?.get("list"));
  const prefetchRecipe = usePrefetchRecipe();

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 min-[900px]:gap-5">
      <header className="flex items-center gap-1">
        <BackButton />
        <h1 className={cn(K_TITLE, "min-w-0 flex-1 truncate")}>{RECIPES_AND_COOKS}</h1>
      </header>
      {groups.data ? <p className="-mt-2 truncate text-sm text-muted-foreground">{yourGroupsLine(groups.data) ?? "No groups yet"}</p> : null}

      <dl className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-4">
        <Stat label="Cooks" value={dishes.loading ? null : cooks} />
        <Stat label="Recipes" value={recipes.loading ? null : stats ? String(stats.recipes) : "–"} />
        <Stat label="Saved by" value={recipes.loading ? null : stats ? String(stats.savedBy) : "–"} />
        <Stat label="Groups" value={groups.loading ? null : String(groups.data?.length ?? 0)} />
      </dl>

      {dishes.failed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your cooks.</p>
          <Button variant="outline" className={K_BUTTON} onClick={dishes.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <CooksAWeek counts={counts} loading={dishes.loading} />
      )}

      <ProfileListSwitch list={list} />
      {list === "recipes" ? (
        <YourRecipes rows={recipeRows} loading={recipes.loading} failed={!!recipes.error && !recipes.data} onReload={recipes.reload} prefetch={prefetchRecipe} />
      ) : dishes.failed ? null : (
        <CookList title="Your cooks" hideTitle rows={rows} loading={dishes.loading} empty="No cooks yet" />
      )}
    </div>
  );
}

/** One of the page's numbers: big, with its word under it. */
function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className={cn(K_CARD, "flex flex-col-reverse px-4 py-3")}>
      <dt className="text-[13px] font-normal text-muted-foreground">{label}</dt>
      <dd className="text-[26px] font-medium leading-tight tracking-tight tabular-nums">
        {value === null ? <Skeleton className="my-1 h-7 w-12" /> : value}
      </dd>
    </div>
  );
}

/**
 * "Cooks a week": a column per week over the last 8, this week last and in
 * full green, the rest lighter; one baseline, no grid. The number sits on
 * this week's column; every column says its own in its tooltip and name.
 */
function CooksAWeek({ counts, loading }: { counts: readonly number[]; loading: boolean }) {
  const max = Math.max(1, ...counts);
  const last = counts.length - 1;
  return (
    <section aria-labelledby="you-cooks-week" className={cn(K_CARD, "px-4 pb-3 pt-3.5")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="you-cooks-week" className="text-[17px] font-medium">
          Cooks a week
        </h2>
        {loading ? null : <span className="truncate text-[13px] font-semibold tabular-nums text-muted-foreground">{cooksAWeekText(counts)}</span>}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-[92px] w-full rounded-xl" />
      ) : (
        <ol aria-label="Cooks a week, the last 8 weeks, oldest first" className="mt-3 grid grid-cols-8 items-end gap-0.5 border-b border-cp-line">
          {counts.map((n, i) => {
            const weeksAgo = last - i;
            const words = `${cooksText(n)}, ${weekLabel(weeksAgo)}`;
            return (
              <li key={i} title={words} aria-label={words} className="flex h-[92px] flex-col items-center justify-end gap-1">
                <span aria-hidden className={cn("h-4 text-xs font-bold tabular-nums text-foreground", i !== last && "invisible")}>
                  {n}
                </span>
                <span
                  aria-hidden
                  className={cn("w-full max-w-6 rounded-t-[4px]", i === last ? "bg-primary" : "bg-primary/35")}
                  style={{ height: `${Math.round((n / max) * 64)}px`, minHeight: n > 0 ? 4 : 0 }}
                />
              </li>
            );
          })}
        </ol>
      )}
      {loading ? null : (
        <div aria-hidden className="mt-1.5 flex justify-between text-xs font-semibold text-muted-foreground">
          <span>8 weeks ago</span>
          <span>This week</span>
        </div>
      )}
    </section>
  );
}

/** Recipes | Cooks, a segmented control; the choice stays in the address. */
function ProfileListSwitch({ list }: { list: ProfileList }) {
  const router = useRouter();
  return (
    <Segmented
      label="Show"
      large
      value={list}
      onChange={(next) => {
        if (next !== list) router.replace(next === "cooks" ? `${YOU_COOKS_HREF}?list=cooks` : YOU_COOKS_HREF, { scroll: false });
      }}
      options={[
        { id: "recipes", label: "Recipes" },
        { id: "cooks", label: "Cooks" },
      ]}
    />
  );
}

/** A person's Recipes | Cooks (RC-8), as You's: the choice stays in the address. */
function PersonListSwitch({ subjectId, list }: { subjectId: string; list: PersonList }) {
  const router = useRouter();
  return (
    <Segmented
      label="Show"
      large
      value={list}
      onChange={(next) => {
        if (next !== list) router.replace(personHref(subjectId, next), { scroll: false });
      }}
      options={[
        { id: "recipes", label: "Recipes" },
        { id: "cooks", label: "Cooks" },
      ]}
    />
  );
}

/** Save on one of their recipes: your own copy, Saved once you have it. */
function PersonRecipeSave({ row, recipe }: { row: PersonRecipeRow; recipe: RecipeSummary }) {
  const copy = useSaveCopy(recipe);
  return <SaveCopyChip name={row.name} savedId={copy.savedId} saving={copy.saving} onSave={copy.save} />;
}

/** A list of cooks, newest first: each opens its dish. */
function CookList({
  title,
  hideTitle = false,
  rows,
  loading,
  empty,
}: {
  title: string;
  /** Named for screen readers only (You's Recipes | Cooks already says it). */
  hideTitle?: boolean;
  rows: readonly CookRow[];
  loading: boolean;
  empty: string;
}) {
  const id = React.useId();
  const prefetch = usePrefetchKitchen();
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-2">
      <h2 id={id} className={cn("text-lg font-extrabold tracking-tight", hideTitle && "sr-only")}>
        {title}
      </h2>
      {loading ? (
        <div className="space-y-px overflow-hidden rounded-[22px] border bg-card" aria-hidden>
          <Skeleton className="h-16 w-full rounded-none" />
          <Skeleton className="h-16 w-full rounded-none" />
        </div>
      ) : rows.length === 0 ? (
        <p className="flex min-h-14 items-center rounded-[22px] border bg-card px-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-[22px] border bg-card">
          {rows.map((row) => (
            <li key={row.dishId}>
              <Link
                {...pressIn(() => prefetch.dish(row.dishId, null))}
                href={row.href}
                className="flex min-h-16 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{row.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {row.where} · {row.when}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{row.portions}</span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── A person ──────────────────────────────────────────────────────

export function NewPerson() {
  const subjectId = safeDecode(usePathParam("/people/:subjectId", "subjectId"));
  const profile = useProfile();
  const myId = profile.data?.id ?? null;
  const person = usePerson(subjectId);

  return (
    <div className="space-y-4">
      {person.loading || profile.loading ? (
        <PersonSkeleton />
      ) : person.error?.code === "not_found" ? (
        <KCard className="flex flex-col items-center px-6 py-10 text-center">
          <h1 className="text-lg font-bold tracking-tight">
            {myId && subjectId === myId ? "That's you" : "You don't share a group with them"}
          </h1>
          <Button asChild className={cn(K_BUTTON, "mt-4")}>
            <Link href={myId && subjectId === myId ? "/you" : "/money"}>{myId && subjectId === myId ? "Your page" : "Money"}</Link>
          </Button>
        </KCard>
      ) : person.error || !person.data ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this person.</p>
          <Button variant="outline" className={K_BUTTON} onClick={person.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <PersonProfile view={person.data} myId={myId} />
      )}
    </div>
  );
}

const TONE: Record<MoneyLine["tone"], string> = { owed: "text-cp-owed", owe: "text-cp-owe", settled: "text-foreground" };

function PersonProfile({ view, myId }: { view: PersonViewResponse; myId: string | null }) {
  // Their own name from their read, so their face has its initials before the cross-group read answers.
  const own = React.useMemo(() => [{ subjectId: view.subjectId, displayName: view.displayName }], [view.subjectId, view.displayName]);
  const names = useMemberNames(own);
  const groups = useGroups();
  const dishes = useMyDishes(PROFILE_DISH_DAYS);
  const [now] = React.useState(() => new Date());
  const name = personName(view);
  const first = firstName(view);
  const balance = personBalance(view);
  const options = recordOptions(view, myId);
  // Money is open between you only in groups you view: nothing to settle here.
  const viewOnly = options.length === 0 && view.groups.some((g) => g.planMinor !== 0);
  const shared = React.useMemo(() => new Set(view.groups.map((g) => g.orgId)), [view.groups]);
  const groupNames = React.useMemo(
    () => new Map([...(groups.data ?? []).map((g) => [g.id, g.name] as const), ...view.groups.map((g) => [g.orgId, g.name] as const)]),
    [groups.data, view.groups],
  );
  const cooks = React.useMemo(
    () => recentCooks(dishes.dishes, view.subjectId, { groupNames, now, inGroups: shared }),
    [dishes.dishes, view.subjectId, groupNames, now, shared],
  );
  // Their cooks in the groups you share, as the list shows them.
  const cookTotal = React.useMemo(
    () => cookCount(dishes.dishes.filter((d) => !!d.orgId && shared.has(d.orgId)), view.subjectId),
    [dishes.dishes, shared, view.subjectId],
  );
  const theirRecipes = usePersonRecipes(view.subjectId);
  const recipeList = theirRecipes.data?.recipes ?? null;
  const stats = recipeList ? recipeStats(recipeList) : null;
  const recipeRows = React.useMemo(() => (recipeList ? personRecipeRows(recipeList) : []), [recipeList]);
  const byId = React.useMemo(() => new Map((recipeList ?? []).map((r) => [r.id, r] as const)), [recipeList]);
  const searchParams = useSearchParams();
  const list = personListFrom(searchParams?.get("list"));
  const prefetchRecipe = usePrefetchRecipe();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-6">
        <div className="space-y-3 min-[900px]:sticky min-[900px]:top-6">
          <header aria-labelledby="person-name" className="flex items-center gap-2.5">
            <BackButton />
            <Face subjectId={view.subjectId} meId={myId} names={names} className="h-16 w-16 text-xl" />
            <div className="min-w-0 flex-1">
              <h1 id="person-name" className="truncate text-2xl font-extrabold tracking-[-0.02em] min-[900px]:text-[26px]">
                {name}
              </h1>
              {sharedGroupsLine(view.groups) ? <p className="truncate text-sm text-muted-foreground">{sharedGroupsLine(view.groups)}</p> : null}
            </div>
          </header>

          <section aria-label="Between you two" className={cn("grid gap-3 rounded-[22px] border bg-card px-[18px] py-3", balance.length > 1 && "grid-cols-2")}>
            {balance.map((l) => (
              <p key={l.currency} className="min-w-0">
                <span className="block truncate text-[13px] font-bold text-muted-foreground">{l.amount ? l.label : ""}</span>
                <span className={cn("block truncate text-[28px] font-extrabold leading-tight tracking-tight tabular-nums", TONE[l.tone])}>
                  {l.amount ?? l.label}
                </span>
              </p>
            ))}
          </section>
          {options.length > 0 ? (
            <RecordPayment name={first} fullName={name} myId={myId} options={options} title="Settle up" />
          ) : viewOnly ? (
            <p className="px-1 text-sm font-semibold text-muted-foreground">View only</p>
          ) : null}
        </div>

        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            <dl className="grid grid-cols-3 gap-2">
              <Stat label="Cooks" value={dishes.loading ? null : cookCountText(cookTotal, dishes.complete)} />
              <Stat label="Recipes" value={theirRecipes.loading ? null : stats ? String(stats.recipes) : "–"} />
              <Stat label="Saved by" value={theirRecipes.loading ? null : stats ? String(stats.savedBy) : "–"} />
            </dl>
            <PersonListSwitch subjectId={view.subjectId} list={list} />
            {list === "recipes" ? (
              <PersonRecipesView
                rows={recipeRows}
                loading={theirRecipes.loading}
                failed={!!theirRecipes.error && !theirRecipes.data}
                onReload={theirRecipes.reload}
                prefetch={prefetchRecipe}
                renderSave={(row) => {
                  const recipe = byId.get(row.id);
                  return recipe ? <PersonRecipeSave row={row} recipe={recipe} /> : null;
                }}
              />
            ) : dishes.failed ? (
              <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load {first}&apos;s cooks.</p>
                <Button variant="outline" className={K_BUTTON} onClick={dishes.reload}>
                  Try again
                </Button>
              </KCard>
            ) : (
              <CookList title={`${first}'s cooks`} hideTitle rows={cooks} loading={dishes.loading} empty="No cooks in your groups yet" />
            )}
          </div>

          <section aria-labelledby="person-why" className="min-w-0 space-y-3">
            <h2 id="person-why" className="text-lg font-extrabold tracking-tight">
              Why
            </h2>
            {view.groups.map((g) => (
              <WhyGroup key={g.orgId} group={g} view={view} name={first} myId={myId} names={names} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
