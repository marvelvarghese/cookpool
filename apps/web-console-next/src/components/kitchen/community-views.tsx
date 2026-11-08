"use client";

import * as React from "react";
import Link from "./link";
import { Bell, ChevronRight, Lock, Search, UsersRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { faceColor } from "./faces";
import { ACTIVITY_HREF, PEOPLE_SEARCH_HREF, type CountCell, type FollowButton, type HandleNote } from "./community";
import { rowFollowLabel, type PersonRow } from "./community-people";

/**
 * Community's parts as they draw (cookpool-community CM-5, the canvas row
 * "Community"), from what was read: no reads or writes, so each is rendered
 * in tests. `community-ui.tsx` puts them over the data.
 */

const FACE_SIZES = { sm: "h-11 w-11 text-base", lg: "h-[76px] w-[76px] text-[28px]" } as const;

/** A face: initials on the person's colour (photos come with CM-4). */
export function ProfileFace({ userId, initials, size = "sm", meId = null }: { userId: string; initials: string; size?: keyof typeof FACE_SIZES; meId?: string | null }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: faceColor(userId, meId) }}
      className={cn("grid shrink-0 place-items-center rounded-full font-extrabold text-white", FACE_SIZES[size])}
    >
      {initials}
    </span>
  );
}

/** An uppercase section label, as the canvas's ("FROM YOUR GROUPS", "WHO CAN FOLLOW YOU"). */
export function SectionLabel({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="px-0.5 text-xs font-extrabold uppercase tracking-[0.06em] text-[#3F4842]">
      {children}
    </h2>
  );
}

const ROW_BUTTON = "min-h-11 min-w-[96px] shrink-0 rounded-xl px-3 text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const OUTLINE_BUTTON = "border border-[#C9CFC6] bg-card text-foreground hover:bg-accent";
export const GREEN_BUTTON = "bg-primary text-primary-foreground hover:bg-primary/90";

/** A person in a list: face and name open their profile; the button follows (or `action` replaces it). */
export function PersonRowView({
  row,
  onFollow,
  action,
}: {
  row: PersonRow;
  onFollow?: ((row: PersonRow) => void) | undefined;
  /** Instead of Follow (Accept · Decline on a request, Remove on your followers, Unblock). */
  action?: React.ReactNode;
}) {
  const b = rowFollowLabel(row.following);
  return (
    <li className="flex min-h-16 items-center gap-3 px-3 py-2">
      <Link href={row.href} tabIndex={-1} aria-hidden className="shrink-0 rounded-full">
        <ProfileFace userId={row.userId} initials={row.initials} />
      </Link>
      <Link href={row.href} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate text-[15px] font-extrabold">{row.name}</span>
        <span className="truncate text-xs font-semibold text-muted-foreground">{row.sub}</span>
      </Link>
      {action ??
        (onFollow ? (
          <button type="button" aria-pressed={row.following !== "none"} onClick={() => onFollow(row)} className={cn(ROW_BUTTON, b.primary ? GREEN_BUTTON : OUTLINE_BUTTON)}>
            {b.label}
            <span className="sr-only"> {row.name}</span>
          </button>
        ) : null)}
    </li>
  );
}

/** A card of people rows. */
export function PeopleList({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-[#ECEEE9] overflow-hidden rounded-[20px] border bg-card">
      {children}
    </ul>
  );
}

/** A list that is loading: two grey rows. */
export function PeopleListSkeleton() {
  return (
    <div aria-hidden className="space-y-px overflow-hidden rounded-[20px] border bg-card">
      <Skeleton className="h-16 w-full rounded-none" />
      <Skeleton className="h-16 w-full rounded-none" />
    </div>
  );
}

/** A grey line in a card: an empty list. */
export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="flex min-h-14 items-center rounded-[20px] border bg-card px-4 text-sm font-semibold text-muted-foreground">{children}</p>;
}

/** Posts · Recipes · Followers · Following, beside the face; the last two open their lists. */
export function CountsRow({ cells }: { cells: readonly CountCell[] }) {
  return (
    <dl className="grid flex-1 grid-cols-4 text-center">
      {cells.map((c) => {
        const inner = (
          <>
            <dd className="text-lg font-extrabold leading-tight tabular-nums">{c.value}</dd>
            <dt className="text-[11px] font-bold text-muted-foreground">{c.label}</dt>
          </>
        );
        return c.href ? (
          <Link key={c.id} href={c.href} className="flex min-h-11 flex-col-reverse items-center justify-center rounded-xl hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {inner}
          </Link>
        ) : (
          <div key={c.id} className="flex min-h-11 flex-col-reverse items-center justify-center">
            {inner}
          </div>
        );
      })}
    </dl>
  );
}

/** The profile's main button: green to follow or ask, outlined once you do. */
export function FollowButtonView({ button, onClick, href }: { button: FollowButton; onClick?: () => void; href?: string }) {
  const cls = cn("flex min-h-12 items-center justify-center rounded-[14px] px-4 text-base font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", button.primary ? GREEN_BUTTON : OUTLINE_BUTTON);
  if (href) {
    return (
      <Link href={href} className={cls}>
        {button.label}
      </Link>
    );
  }
  return (
    <button type="button" aria-pressed={button.kind === "following" || button.kind === "requested"} onClick={onClick} className={cls}>
      {button.label}
    </button>
  );
}

/** The lock on a private profile you don't follow. */
export function LockCard({ title, sub }: { title: string; sub: string }) {
  return (
    <section aria-label={title} className="flex flex-col items-center gap-1.5 rounded-[20px] border bg-card px-4 py-7 text-center">
      <span aria-hidden className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-background text-[#3F4842]">
        <Lock className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <p className="text-base font-extrabold">{title}</p>
      <p className="text-sm font-semibold text-muted-foreground">{sub}</p>
    </section>
  );
}

/** Community's header: the title, and the bell opening Activity. */
export function CommunityHeader() {
  return (
    <header className="flex min-h-11 items-center gap-2">
      <h1 className="flex-1 text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Community</h1>
      <Link
        href={ACTIVITY_HREF}
        aria-label="Activity"
        className="grid h-11 w-11 place-items-center rounded-xl text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
      </Link>
    </header>
  );
}

/** The search field on Community: a link that opens people search. */
export function SearchLink() {
  return (
    <Link
      href={PEOPLE_SEARCH_HREF}
      className="flex min-h-12 items-center gap-2.5 rounded-[14px] border border-[#D5DAD2] bg-card px-3.5 text-[15px] font-semibold text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
      Search people
    </Link>
  );
}

/** Community, in the Cook hub: one row, the feed of people you follow. */
export function CommunityEntry({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center gap-3 rounded-[20px] border bg-card px-4 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cp-herb-tint text-primary">
        <UsersRound className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-extrabold">Community</span>
        <span className="truncate text-[13px] font-semibold text-muted-foreground">Follow cooks and see what they make</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** The handle's line under its field, in its tone. */
export function HandleNoteView({ note, id }: { note: HandleNote; id: string }) {
  return (
    <span id={id} aria-live="polite" className={cn("text-[13px] font-bold", note.tone === "ok" ? "text-[#165C3A]" : note.tone === "bad" ? "text-[#B42318]" : "text-muted-foreground")}>
      {note.text}
    </span>
  );
}

/** One of "Who can follow you": a radio row, tinted when chosen. */
export function PrivacyRow({ title, sub, on, onPick }: { title: string; sub: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-[1.5px] border-primary bg-cp-herb-tint" : "border border-[#D5DAD2] bg-card hover:bg-accent",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-extrabold">{title}</span>
        <span className="text-[13px] font-semibold text-muted-foreground">{sub}</span>
      </span>
      <span aria-hidden className={cn("grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2", on ? "border-primary" : "border-[#9AA39D]")}>
        <span className={cn("h-2.5 w-2.5 rounded-full", on ? "bg-primary" : "bg-transparent")} />
      </span>
    </button>
  );
}
