"use client";

import * as React from "react";
import Link from "./link";
import { ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard } from "./kit";
import { BackButton } from "./back-ui";
import { useSettled } from "./recipe-ui";
import {
  COMMUNITY_HREF,
  HANDLE_SETUP_HREF,
  SETUP_OFFERED_KEY,
  atHandle,
  communityTop,
  countText,
  profileHref,
} from "./community";
import { PEOPLE_SEARCH_MS, PEOPLE_SEARCH_PLACEHOLDER, blockedRow, peopleRows, peopleSearchQuery, peopleSearchView, suggestionGroups } from "./community-people";
import {
  CommunityHeader,
  EmptyLine,
  GREEN_BUTTON,
  OUTLINE_BUTTON,
  PeopleList,
  PeopleListSkeleton,
  PersonRowView,
  ProfileFace,
  SearchLink,
  SectionLabel,
} from "./community-views";
import { HandleSetup } from "./community-setup-ui";
import { CommunityFeed } from "./community-feed-ui";
import { useUnreadActivity } from "./community-posts-data";
import { useFollowRow } from "./community-profile-ui";
import { useAnswerRequest, useBlock, useBlocks, useFollowRequests, useMyCommunityProfile, usePeopleSearch, usePeopleSuggestions, usePersonProfile } from "./community-data";

/**
 * Community in the app (cookpool-community CM-5, design §4): the Cook tab's
 * `/community` shell — "Community", the bell (Activity), the search field
 * (people search) and CM-6's Following · Discover feed;
 * HandleSetup the first time it opens without a profile — people search,
 * blocked people, and You's handle, counts and follow requests.
 */

function readOffered(): boolean {
  try {
    return window.localStorage.getItem(SETUP_OFFERED_KEY) === "1";
  } catch {
    return false;
  }
}

function markOffered(): void {
  try {
    window.localStorage.setItem(SETUP_OFFERED_KEY, "1");
  } catch {
    // Private mode: it is offered again next time, which is fine.
  }
}

/** `/community`: the header with the bell's count, search, and the feed (CM-6). */
export function CommunityScreen() {
  const mine = useMyCommunityProfile();
  const [offered] = React.useState(readOffered);
  const [dismissed, setDismissed] = React.useState(false);
  const top = communityTop(mine.data ? mine.data.profile : mine.error ? null : undefined, offered || dismissed);
  // The bell's count (CM-6): Activity is only yours once you have a profile.
  const unread = useUnreadActivity(!!mine.data?.profile);
  React.useEffect(() => {
    if (top === "setup") markOffered();
  }, [top]);

  // The first time, HandleSetup may take the whole screen: nothing until your profile is read.
  if (top === "loading" && !offered) {
    return (
      <div aria-hidden className="flex w-full max-w-xl flex-col gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-12 w-full rounded-[14px]" />
      </div>
    );
  }
  if (top === "setup") {
    return (
      <div className="flex w-full max-w-xl flex-col gap-4">
        <HandleSetup intro onLater={() => setDismissed(true)} />
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <CommunityHeader unread={unread} />
      <SearchLink />
      {top === "loading" ? <Skeleton className="h-16 w-full rounded-[20px]" /> : top === "card" ? <SetupCard /> : null}
      {/* CM-6: Following · Discover (`?tab=`), the post cards. */}
      <CommunityFeed />
    </div>
  );
}

/** Without a profile, after HandleSetup was offered once: one card back to it. */
function SetupCard() {
  return (
    <Link
      href={HANDLE_SETUP_HREF}
      className="flex min-h-16 items-center gap-3 rounded-[20px] border bg-card px-4 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-extrabold">Pick a handle</span>
        <span className="text-[13px] font-semibold text-muted-foreground">To follow cooks, and be found</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

// ── People search ─────────────────────────────────────────────────

/** `/community/search`: the field (name, @handle); empty, From your groups · From recipes · Popular; Follow from the list. */
export function PeopleSearchScreen() {
  const [typed, setTyped] = React.useState("");
  const q = useSettled(peopleSearchQuery(typed), PEOPLE_SEARCH_MS);
  const search = usePeopleSearch(q);
  const suggestions = usePeopleSuggestions(!q);
  const mine = useMyCommunityProfile();
  const onFollow = useFollowRow(!!mine.data?.profile);
  const view = peopleSearchView(q, search.data);
  const groups = React.useMemo(() => (suggestions.data ? suggestionGroups(suggestions.data) : null), [suggestions.data]);

  return (
    <div className="flex w-full max-w-xl flex-col gap-3.5">
      <div className="flex items-center gap-2">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] border-[1.5px] border-foreground bg-card px-3.5 focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={2.2} aria-hidden />
          <span className="sr-only">Search people</span>
          <input
            type="search"
            autoFocus
            value={typed}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={PEOPLE_SEARCH_PLACEHOLDER}
            onChange={(e) => setTyped(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
        </label>
        <Link href={COMMUNITY_HREF} className="flex min-h-11 items-center px-1.5 text-[15px] font-extrabold text-primary hover:underline">
          Cancel
        </Link>
      </div>

      {view.kind === "suggestions" ? (
        suggestions.loading ? (
          <PeopleListSkeleton />
        ) : !groups || groups.length === 0 ? (
          <EmptyLine>{suggestions.error ? "Couldn't load suggestions." : "Search by name or @handle."}</EmptyLine>
        ) : (
          groups.map((g) => (
            <section key={g.id} aria-labelledby={`sg-${g.id}`} className="flex flex-col gap-1.5">
              <SectionLabel id={`sg-${g.id}`}>{g.title}</SectionLabel>
              <PeopleList>
                {g.rows.map((row) => (
                  <PersonRowView key={row.userId} row={row} onFollow={onFollow} />
                ))}
              </PeopleList>
            </section>
          ))
        )
      ) : view.kind === "loading" ? (
        <PeopleListSkeleton />
      ) : view.kind === "empty" ? (
        <p className="px-6 py-6 text-center text-[15px] font-bold text-muted-foreground">{view.text}</p>
      ) : (
        <section aria-labelledby="sg-people" className="flex flex-col gap-1.5">
          <SectionLabel id="sg-people">People</SectionLabel>
          <PeopleList>
            {view.rows.map((row) => (
              <PersonRowView key={row.userId} row={row} onFollow={onFollow} />
            ))}
          </PeopleList>
        </section>
      )}
    </div>
  );
}

// ── Blocked people ────────────────────────────────────────────────

/** `/you/blocked`: whom you blocked, each with Unblock (and Undo). */
export function BlockedPeopleScreen() {
  const blocks = useBlocks();
  const block = useBlock();
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="-ml-2.5 flex min-h-11 items-center">
        <BackButton />
      </div>
      <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">Blocked people</h1>
      <p className="text-sm font-semibold text-muted-foreground">You don&apos;t see each other anywhere. They aren&apos;t told.</p>
      {blocks.loading ? (
        <PeopleListSkeleton />
      ) : blocks.error && !blocks.data ? (
        <EmptyLine>Couldn&apos;t load them.</EmptyLine>
      ) : (blocks.data?.blocks.length ?? 0) === 0 ? (
        <EmptyLine>Nobody blocked</EmptyLine>
      ) : (
        <PeopleList label="Blocked people">
          {blocks.data!.blocks.map((b) => {
            const row = blockedRow(b);
            return (
              <li key={b.userId} className="flex min-h-16 items-center gap-3 px-3 py-2">
                <ProfileFace userId={row.userId} initials={row.initials} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-extrabold">{row.name}</span>
                  {row.sub ? <span className="truncate text-xs font-semibold text-muted-foreground">{row.sub}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => block(b, false)}
                  className={cn("min-h-11 shrink-0 rounded-xl px-3 text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", OUTLINE_BUTTON)}
                >
                  Unblock<span className="sr-only"> {row.name}</span>
                </button>
              </li>
            );
          })}
        </PeopleList>
      )}
    </div>
  );
}

// ── You ───────────────────────────────────────────────────────────

/**
 * On You (design §4): your @handle (opening your profile), Followers and
 * Following (opening the lists), Edit (HandleSetup); with a private profile,
 * the follow requests with Accept · Decline. Without a profile, one card to
 * HandleSetup.
 */
export function YouCommunity() {
  const mine = useMyCommunityProfile();
  const profile = mine.data?.profile ?? null;
  const read = usePersonProfile(profile?.handle ?? null);
  if (mine.loading) return <Skeleton className="h-[72px] w-full rounded-[20px]" />;
  if (!profile) {
    return mine.error ? null : (
      <Link
        href={HANDLE_SETUP_HREF}
        className="flex min-h-16 items-center gap-3 rounded-[20px] border bg-card px-4 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-extrabold">Your public profile</span>
          <span className="text-[13px] font-semibold text-muted-foreground">Pick a handle so cooks can follow you</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    );
  }
  const counts = read.data?.counts ?? null;
  const cell = "flex min-h-11 flex-col items-start justify-center rounded-xl px-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <section aria-label="Your public profile" className="flex flex-col gap-3">
      <KCard className="flex items-center gap-1 px-2 py-1.5">
        <Link href={profileHref(profile.handle)} className={cn(cell, "min-w-0 flex-1")}>
          <span className="max-w-full truncate text-[15px] font-extrabold">{atHandle(profile.handle)}</span>
          <span className="text-xs font-bold text-muted-foreground">{profile.privacy === "private" ? "Private" : "Public"}</span>
        </Link>
        <Link href={profileHref(profile.handle, "followers")} className={cell}>
          <span className="text-[17px] font-extrabold tabular-nums">{counts ? countText(counts.followers) : "–"}</span>
          <span className="text-xs font-bold text-muted-foreground">Followers</span>
        </Link>
        <Link href={profileHref(profile.handle, "following")} className={cell}>
          <span className="text-[17px] font-extrabold tabular-nums">{counts ? countText(counts.following) : "–"}</span>
          <span className="text-xs font-bold text-muted-foreground">Following</span>
        </Link>
        <Link href={HANDLE_SETUP_HREF} className="flex min-h-11 items-center rounded-xl px-2.5 text-sm font-extrabold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Edit
        </Link>
      </KCard>
      {profile.privacy === "private" ? <FollowRequests /> : null}
    </section>
  );
}

/** Follow requests, with Accept · Decline; nothing when there are none. */
export function FollowRequests() {
  const requests = useFollowRequests(true);
  const answer = useAnswerRequest();
  const rows = React.useMemo(() => peopleRows(requests.data), [requests.data]);
  if (requests.loading) return <PeopleListSkeleton />;
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="requests-h" className="flex flex-col gap-1.5">
      <SectionLabel id="requests-h">Follow requests · {rows.length}</SectionLabel>
      <PeopleList>
        {rows.map((row) => (
          <PersonRowView
            key={row.userId}
            row={row}
            action={
              <span className="flex shrink-0 gap-1.5">
                <button type="button" onClick={() => answer(row, true)} className={cn("min-h-11 rounded-xl px-3 text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", GREEN_BUTTON)}>
                  Accept<span className="sr-only"> {row.name}</span>
                </button>
                <button type="button" onClick={() => answer(row, false)} className={cn("min-h-11 rounded-xl px-3 text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", OUTLINE_BUTTON)}>
                  Decline<span className="sr-only"> {row.name}</span>
                </button>
              </span>
            }
          />
        ))}
      </PeopleList>
    </section>
  );
}
