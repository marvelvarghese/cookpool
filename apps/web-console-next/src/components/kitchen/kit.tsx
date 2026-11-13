"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { groupInitials } from "./groups";
import { groupTint, type GroupTint } from "./group-tint";
import { dayText } from "./when";

/**
 * Cookpool's small visual kit (CP-5), on top of the shared UI kit: rounded
 * cards, group avatars and page titles. (No "Soon" badge or coming-soon card
 * since SM-15: nothing in the app is a placeholder.)
 * Colors come from the `.cookpool` tokens, so these only make sense inside the
 * kitchen layout.
 *
 * The revamp (RV-2, design §2–3): cards have no border, the soft shadow (none
 * in dark) and radius 22, with rows split by the `line` token; titles are
 * sized, not bolded (26px pages, 17px sections, weight 500); buttons are 44px
 * on the accent for the one main action, or on the tint when quiet.
 */

/** The kitchen card's surface: no border, the soft shadow, radius 22. */
export const K_CARD = "rounded-cp-card bg-card text-card-foreground shadow-cp-card";

/** A card of rows: the card, clipped, with a 1px `line` between rows. */
export const K_ROWS = `${K_CARD} overflow-hidden divide-y divide-cp-line`;

/** A rounded surface card (no border, the soft shadow, radius 22). */
export function KCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(K_CARD, className)} {...props} />;
}

/** A card of rows, each split from the next by the `line` token. */
export function KRows({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(K_ROWS, className)} {...props} />;
}

/** A page's title: 26px, Medium. */
export const K_TITLE = "text-[26px] font-medium leading-tight tracking-[-0.02em]";

/** A section's heading: 17px, Medium. */
export const K_SECTION = "text-[17px] font-medium leading-snug";

/** A section heading (17px, Medium), with an optional muted count after it. */
export function SectionHeading({
  id,
  count,
  className,
  children,
}: {
  id?: string;
  count?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className={cn(K_SECTION, className)}>
      {children}
      {count !== undefined && count !== null ? <span className="font-normal text-muted-foreground"> {count}</span> : null}
    </h2>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className={K_TITLE}>{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

const AVATAR_SIZES = {
  sm: "h-9 w-9 rounded-[10px] text-xs",
  md: "h-11 w-11 rounded-[12px] text-sm",
  lg: "h-14 w-14 rounded-[16px] text-lg",
} as const;

/**
 * A group's two-letter avatar in a rounded square: the green tint in today's
 * frame; in the new frame (RV-19) the group's own tint, stable from its `id`
 * (`groupTint`; a screen without the id falls back to the name). It carries
 * `data-tint` so the tint is readable in tests.
 */
export function GroupAvatar({ name, id, size = "md", className }: { name: string; id?: string | null; size?: keyof typeof AVATAR_SIZES; className?: string }) {
  const tint = groupTint(id || name);
  return (
    <span
      aria-hidden
      data-tint={tint}
      className={cn(
        "grid shrink-0 place-items-center bg-cp-herb-tint font-medium text-cp-accent-text",
        NEW_LOOK_TINTS[tint],
        NEW_LOOK_DARK_BADGE,
        AVATAR_SIZES[size],
        className,
      )}
    >
      {groupInitials(name)}
    </span>
  );
}

/** In the new look's dark every group badge is the neutral line grey with ink words (the boards, RV-23). */
const NEW_LOOK_DARK_BADGE =
  "cp-dark:bg-cp-line cp-dark:text-foreground";

/** Each group tint under `.cookpool-new` only (whole class names, so Tailwind keeps them). */
const NEW_LOOK_TINTS: Record<GroupTint, string> = {
  green: "[.cookpool-new_&]:bg-cp-accent-tint [.cookpool-new_&]:text-cp-accent-text",
  blue: "[.cookpool-new_&]:bg-cp-owed-tint [.cookpool-new_&]:text-cp-owed",
  // The boards' warm badge is the owe tint (RvMoney's "Lunch club"), not use-soon's amber (RV-23).
  amber: "[.cookpool-new_&]:bg-cp-owe-tint [.cookpool-new_&]:text-cp-owe",
  purple: "[.cookpool-new_&]:bg-cp-purple-tint [.cookpool-new_&]:text-cp-purple",
  teal: "[.cookpool-new_&]:bg-cp-teal-tint [.cookpool-new_&]:text-cp-teal",
  slate: "[.cookpool-new_&]:bg-cp-slate-tint [.cookpool-new_&]:text-cp-slate",
};

/** An icon in a tinted circle. */
export function IconBubble({
  icon: Icon,
  tone = "green",
  className,
}: {
  icon: LucideIcon;
  tone?: "green" | "tomato" | "blue" | "neutral";
  className?: string;
}) {
  const tones = {
    green: "bg-cp-herb-tint text-cp-accent-text",
    tomato: "bg-cp-tomato-tint text-cp-tomato",
    blue: "bg-cp-owed-tint text-cp-owed",
    neutral: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span aria-hidden className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full", tones[tone], className)}>
      <Icon className="h-5 w-5" strokeWidth={2} />
    </span>
  );
}

/**
 * Size the built-in close (×) of the kit's Dialog/Sheet to a 44px target. The
 * close button is the content's last child in both components.
 */
export const CLOSE_44 =
  "[&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center [&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:rounded-full";

/**
 * 44px-tall buttons inside the kitchen (radius 14, Medium). With the Button's
 * default variant it sits on the accent: the screen's one main action.
 */
export const K_BUTTON = "h-11 rounded-[14px] px-5 text-[15px] font-medium";

/** A quiet button's colours: the accent tint with the accent text (use with K_BUTTON). */
export const K_QUIET = "border-0 bg-cp-accent-tint text-cp-accent-text shadow-none hover:bg-cp-accent-tint/80";

/** A quiet 44px button: K_BUTTON on the tint. */
export const K_BUTTON_QUIET = `${K_BUTTON} ${K_QUIET}`;
export const K_INPUT = "h-11 rounded-xl text-base sm:h-11 sm:text-[15px]";

/**
 * A short date in the app's one style (`dayText`, CP-23): "today",
 * "yesterday", "12 Oct", "12 Oct 2025" — not the browser's locale.
 */
export function shortDate(iso: string, now: Date = new Date()): string {
  return dayText(iso, now);
}
