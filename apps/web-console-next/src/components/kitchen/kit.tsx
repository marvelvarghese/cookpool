"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { groupInitials, roleLabel, type GroupRole } from "./groups";

/**
 * Cookpool's small visual kit (CP-5), on top of the shared UI kit: rounded
 * cards, the "Soon" badge, group avatars, page titles and honest empty states.
 * Colors come from the `.cookpool` tokens, so these only make sense inside the
 * kitchen layout.
 */

/** A rounded surface card (20px radius). */
export function KCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[20px] border bg-card text-card-foreground shadow-[0_1px_2px_rgba(23,32,27,0.04)]", className)}
      {...props}
    />
  );
}

/** "Soon": a feature that has not shipped yet. Neutral, 5.3:1. */
export function SoonBadge({ className, label = "Soon" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
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
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">{title}</h1>
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

/** A group's two-letter avatar in a green-tint rounded square. */
export function GroupAvatar({ name, size = "md", className }: { name: string; size?: keyof typeof AVATAR_SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center bg-cp-herb-tint font-bold text-primary",
        AVATAR_SIZES[size],
        className,
      )}
    >
      {groupInitials(name)}
    </span>
  );
}

export function RoleBadge({ role, className }: { role: GroupRole; className?: string }) {
  const manager = role === "owner" || role === "admin";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        manager ? "bg-cp-herb-tint text-primary" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {roleLabel(role)}
    </span>
  );
}

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
    green: "bg-cp-herb-tint text-primary",
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
 * An honest empty state for a feature that arrives later: what it will do,
 * never a placeholder number.
 */
export function ComingSoonCard({
  icon,
  title,
  body,
  tone = "neutral",
  badge = "Coming soon",
  className,
  headingLevel = 2,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  tone?: "green" | "tomato" | "blue" | "neutral";
  badge?: string | null;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <KCard className={cn("flex gap-4 p-5", className)}>
      <IconBubble icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="text-base font-bold tracking-tight">{title}</Heading>
          {badge ? <SoonBadge label={badge} /> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </KCard>
  );
}

/**
 * Size the built-in close (×) of the kit's Dialog/Sheet to a 44px target. The
 * close button is the content's last child in both components.
 */
export const CLOSE_44 =
  "[&>button:last-child]:grid [&>button:last-child]:h-11 [&>button:last-child]:w-11 [&>button:last-child]:place-items-center [&>button:last-child]:right-2 [&>button:last-child]:top-2 [&>button:last-child]:rounded-full";

/** 44px-tall rounded buttons and inputs inside the kitchen. */
export const K_BUTTON = "h-11 rounded-xl px-5 text-[15px] font-semibold";
export const K_INPUT = "h-11 rounded-xl text-base sm:h-11 sm:text-[15px]";

/** A short date: "12 Oct 2026". */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
