"use client";

import * as React from "react";
import Link from "./link";
import type { AskInboxItem } from "@saas/contracts/kitchen";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useProfile } from "./data";
import { friendlyName, homeGreeting } from "./home";
import { personInitials } from "./you";
import { K_TITLE } from "./kit";
import { useMemberNames } from "./people-data";
import { useInbox } from "./inbox-data";
import { askArrival, askCardsShown, parseAskParam, type AnsweredAsk } from "./ask-card";
import { NeedsYou } from "./inbox-needs-ui";
import { InstallCard } from "./install-ui";
import { homeSections } from "./new-home";
import { BalancePillLink, HomeCookTonight, HomeQuickActions, RING, ResumeStrip } from "./new-home-parts-ui";

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
