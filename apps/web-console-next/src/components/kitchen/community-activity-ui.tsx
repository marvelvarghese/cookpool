"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON } from "./kit";
import { BackButton } from "./back-ui";
import { useProfile } from "./data";
import { peopleRows } from "./community-people";
import { EmptyLine, GREEN_BUTTON, OUTLINE_BUTTON, PeopleList, PeopleListSkeleton, PersonRowView, SectionLabel } from "./community-views";
import { ACTIVITY_EMPTY, ACTIVITY_PUSH_NOTE, REQUESTS_TITLE, activityGroups, markReadBefore, moreRequestsText } from "./community-activity";
import { ActivityLineView } from "./community-post-views";
import { useActivity, useMarkActivityRead } from "./community-posts-data";
import { useAnswerRequest } from "./community-data";

/**
 * Activity (cookpool-community CM-6, the canvas's `CommunityActivity`):
 * `/community/activity`. WANTS TO FOLLOW YOU — the newest requests, each
 * with No · Accept (CM-5's writes) — then what happened, by day, each line
 * opening its post, person or recipe; More reads the next page. Opening it
 * marks everything read: the bell goes to 0 (the dots stay for this visit).
 */
export function ActivityScreen() {
  const me = useProfile();
  const read = useActivity();
  const markRead = useMarkActivityRead();
  const answer = useAnswerRequest();
  const [now] = React.useState(() => new Date());
  const [answered, setAnswered] = React.useState<ReadonlySet<string>>(() => new Set());
  const marked = React.useRef(false);

  const firstLoaded = read.requests !== null;
  React.useEffect(() => {
    if (!firstLoaded || marked.current) return;
    marked.current = true;
    markRead(markReadBefore(read.items, now));
  }, [firstLoaded, read.items, markRead, now]);

  const groups = React.useMemo(() => activityGroups(read.items, now), [read.items, now]);
  const requests = read.requests;
  const rows = React.useMemo(() => peopleRows(requests ? { people: requests.people, nextCursor: null } : null).filter((r) => !answered.has(r.userId)), [requests, answered]);
  const more = requests ? moreRequestsText(requests.count - answered.size, rows.length) : null;

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="-ml-2.5 flex min-h-11 items-center gap-1">
        <BackButton />
        <h1 className="text-[24px] font-medium leading-tight tracking-[-0.02em]">Activity</h1>
      </div>

      {rows.length > 0 ? (
        <section aria-labelledby="requests-h" className="flex flex-col gap-1.5">
          <SectionLabel id="requests-h">{REQUESTS_TITLE}</SectionLabel>
          <PeopleList>
            {rows.map((row) => (
              <PersonRowView
                key={row.userId}
                row={row}
                action={
                  <span className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAnswered((s) => new Set(s).add(row.userId));
                        answer(row, false);
                      }}
                      className={cn("min-h-11 rounded-xl px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", OUTLINE_BUTTON)}
                    >
                      No<span className="sr-only">, decline {row.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAnswered((s) => new Set(s).add(row.userId));
                        answer(row, true);
                      }}
                      className={cn("min-h-11 rounded-xl px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", GREEN_BUTTON)}
                    >
                      Accept<span className="sr-only"> {row.name}</span>
                    </button>
                  </span>
                }
              />
            ))}
          </PeopleList>
          {more ? <p className="px-1 text-[13px] font-medium text-muted-foreground">{more} · on You</p> : null}
        </section>
      ) : null}

      {read.loading ? (
        <>
          <Skeleton className="h-4 w-24" />
          <PeopleListSkeleton />
        </>
      ) : read.failed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load Activity.</p>
          <Button variant="outline" className={K_BUTTON} onClick={read.reload}>
            Try again
          </Button>
        </KCard>
      ) : groups.length === 0 ? (
        <EmptyLine>{ACTIVITY_EMPTY}</EmptyLine>
      ) : (
        groups.map((g) => (
          <section key={g.id} aria-labelledby={`act-${g.id}`} className="flex flex-col gap-1.5">
            <SectionLabel id={`act-${g.id}`}>{g.title}</SectionLabel>
            <ul className="divide-y divide-cp-line overflow-hidden rounded-cp-card bg-card shadow-cp-card">
              {g.lines.map((line) => (
                <ActivityLineView key={line.id} line={line} meId={me.data?.id ?? null} />
              ))}
            </ul>
          </section>
        ))
      )}
      {read.hasMore ? (
        <button type="button" onClick={read.loadMore} disabled={read.loadingMore} className="min-h-11 self-center rounded-xl px-4 text-[15px] font-medium text-primary hover:bg-accent disabled:opacity-60">
          {read.loadingMore ? "Loading…" : "More"}
        </button>
      ) : null}
      <p className="px-0.5 text-[13px] font-medium text-muted-foreground">{ACTIVITY_PUSH_NOTE}</p>
    </div>
  );
}
