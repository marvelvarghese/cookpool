"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Settings } from "lucide-react";
import type { PersonViewResponse } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { usePathParam } from "@/lib/page-param";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroups, useProfile } from "./data";
import { KCard, K_BUTTON } from "./kit";
import { BackButton } from "./back-ui";
import { Face } from "./faces-ui";
import { PersonAvatar } from "./sign-in-ui";
import { personInitials, shownName } from "./you";
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

/**
 * Your page and a person's in the new frame (cookpool-recipes RC-2, design
 * §1.4, the canvas's `Profile`). Both read your dishes and your groups' —
 * the one read the app already has — for the cooks they show.
 *
 * - **You** (`/you`): your face, name and groups; Cooks and Groups (RC-5 adds
 *   Recipes and Saved by); "Cooks a week" over the last 8 weeks; your recent
 *   cooks. The gear opens settings — today's You rows.
 * - **A person** (`/people/[id]`): their face and name, "In Flat 4B with you";
 *   what is between you two ("You get back ₹40.00") with Settle up; their
 *   recent cooks in the groups you share; and the Why, open, under its
 *   heading.
 */

// ── You ───────────────────────────────────────────────────────────

export function YourPage() {
  const profile = useProfile();
  const groups = useGroups();
  const dishes = useMyDishes(PROFILE_DISH_DAYS);
  const user = profile.data;
  const meId = user?.id ?? null;
  const [now] = React.useState(() => new Date());
  const groupNames = React.useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name] as const)), [groups.data]);
  const counts = React.useMemo(() => cooksAWeek(dishes.dishes, meId, now), [dishes.dishes, meId, now]);
  const rows = React.useMemo(() => recentCooks(dishes.dishes, meId, { groupNames, now }), [dishes.dishes, meId, groupNames, now]);
  const cooks = cookCountText(cookCount(dishes.dishes, meId), dishes.complete);

  return (
    <div className="flex w-full max-w-xl flex-col gap-4 min-[900px]:gap-5">
      <header className="flex items-center gap-3.5">
        {user ? (
          <PersonAvatar initials={personInitials(user)} className="h-16 w-16 text-[22px]" />
        ) : (
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          {profile.loading ? (
            <Skeleton className="h-7 w-40" />
          ) : (
            <h1 className="truncate text-2xl font-extrabold tracking-[-0.02em] min-[900px]:text-[26px]">{user ? shownName(user) : "You"}</h1>
          )}
          {groups.data ? <p className="truncate text-sm text-muted-foreground">{yourGroupsLine(groups.data) ?? "No groups yet"}</p> : null}
        </div>
        <Link
          href="/you/settings"
          aria-label="Settings"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#D5DAD2] bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings className="h-5 w-5" strokeWidth={1.9} aria-hidden />
        </Link>
      </header>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Cooks" value={dishes.loading ? null : cooks} />
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
        <>
          <CooksAWeek counts={counts} loading={dishes.loading} />
          <CookList title="Your cooks" rows={rows} loading={dishes.loading} empty="No cooks yet" />
        </>
      )}
    </div>
  );
}

/** One of the page's numbers: big, with its word under it. */
function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col-reverse rounded-[20px] border bg-card px-4 py-3">
      <dt className="text-[13px] font-bold text-muted-foreground">{label}</dt>
      <dd className="text-[26px] font-extrabold leading-tight tracking-tight tabular-nums">
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
    <section aria-labelledby="you-cooks-week" className="rounded-[22px] border bg-card px-4 pb-3 pt-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="you-cooks-week" className="text-base font-extrabold tracking-tight">
          Cooks a week
        </h2>
        {loading ? null : <span className="truncate text-[13px] font-semibold tabular-nums text-muted-foreground">{cooksAWeekText(counts)}</span>}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-[92px] w-full rounded-xl" />
      ) : (
        <ol aria-label="Cooks a week, the last 8 weeks, oldest first" className="mt-3 grid grid-cols-8 items-end gap-0.5 border-b border-[#E3E6E0]">
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

/** A list of cooks, newest first: each opens its dish. */
function CookList({ title, rows, loading, empty }: { title: string; rows: readonly CookRow[]; loading: boolean; empty: string }) {
  const id = React.useId();
  const prefetch = usePrefetchKitchen();
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-2">
      <h2 id={id} className="text-lg font-extrabold tracking-tight">
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
  const names = useMemberNames();
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

  return (
    <div className="space-y-4">
      <header className="flex min-h-11 items-center">
        <BackButton />
      </header>

      <div className="grid gap-4 min-[900px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] min-[900px]:items-start min-[900px]:gap-6">
        <div className="space-y-3 min-[900px]:sticky min-[900px]:top-6">
          <section aria-labelledby="person-name" className="flex items-center gap-3.5">
            <Face subjectId={view.subjectId} meId={myId} names={names} className="h-16 w-16 text-xl" />
            <div className="min-w-0 flex-1">
              <h1 id="person-name" className="truncate text-2xl font-extrabold tracking-[-0.02em] min-[900px]:text-[26px]">
                {name}
              </h1>
              {sharedGroupsLine(view.groups) ? <p className="truncate text-sm text-muted-foreground">{sharedGroupsLine(view.groups)}</p> : null}
            </div>
          </section>

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
          {dishes.failed ? (
            <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load {first}&apos;s cooks.</p>
              <Button variant="outline" className={K_BUTTON} onClick={dishes.reload}>
                Try again
              </Button>
            </KCard>
          ) : (
            <CookList title={`${first}'s cooks`} rows={cooks} loading={dishes.loading} empty="No cooks in your groups yet" />
          )}

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
