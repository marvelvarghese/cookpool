"use client";

import * as React from "react";
import Link from "./link";
import { Clock, CookingPot, Flag, PieChart, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Face } from "./faces-ui";
import type { MemberNames } from "./members";
import type { pressIn } from "./prefetch";
import type { NeedsTodo, NeedsTone } from "./inbox-needs";

/**
 * One row of Home's Needs you (cookpool-revamp RV-15, the canvas's
 * `HomeRevamp`): a 42 px badge (a face, or an icon on its tint), the title
 * over one line, then the row's buttons; what opens under it (portion or
 * payment chips, the ask's switch) comes after. A row done here dims: its
 * badge at half, its words muted, and its button turns into Undo. Every
 * kind of row — asks, dishes, payments, food, splits, your own asks, flags
 * — is drawn by this. Tokens only.
 */

export const NEEDS_TONE: Readonly<Record<NeedsTone, string>> = {
  muted: "text-muted-foreground",
  owe: "text-cp-owe",
  owed: "text-cp-owed",
  soon: "text-cp-soon",
  expired: "text-cp-expired",
};

const ICONS: Readonly<Record<NeedsTodo["icon"], { icon: LucideIcon; className: string }>> = {
  expired: { icon: TriangleAlert, className: "bg-cp-expired-tint text-cp-expired" },
  soon: { icon: Clock, className: "bg-cp-soon-tint text-cp-soon" },
  split: { icon: PieChart, className: "bg-cp-accent-tint text-cp-accent-text" },
  flag: { icon: Flag, className: "bg-cp-line text-foreground" },
  dish: { icon: CookingPot, className: "bg-cp-accent-tint text-cp-accent-text" },
};

/** The row's badge: someone's face (round), or the kind's icon on its tint. */
export function NeedsBadge({
  faceId,
  icon,
  meId,
  names,
  custom,
}: {
  faceId?: string | null;
  icon?: NeedsTodo["icon"] | "wait";
  meId: string | null;
  names: MemberNames;
  /** An icon of the caller's own, on the accent tint. */
  custom?: LucideIcon;
}) {
  if (faceId) return <Face subjectId={faceId} meId={meId} names={names} className="h-[42px] w-[42px] text-sm font-medium" />;
  const look = icon && icon !== "wait" ? ICONS[icon] : null;
  const Icon = custom ?? look?.icon ?? Clock;
  return (
    <span aria-hidden className={cn("grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[14px]", look?.className ?? (icon === "wait" ? "bg-cp-soon-tint text-cp-soon" : "bg-cp-accent-tint text-cp-accent-text"))}>
      <Icon className="h-5 w-5" strokeWidth={2} />
    </span>
  );
}

export function NeedsRow({
  badge,
  title,
  href,
  kindLabel,
  meta,
  tone,
  done = false,
  end,
  below,
  onPressTitle,
  className,
  ...rest
}: {
  badge: React.ReactNode;
  title: string;
  /** Where the title goes; none for a row whose title opens nothing. */
  href?: string | null;
  /** For a screen reader, before the title: "Dish", "Payment". */
  kindLabel: string;
  meta: string;
  tone: NeedsTone;
  /** Done here: dimmed, its line muted. */
  done?: boolean;
  /** The row's buttons. */
  end?: React.ReactNode;
  /** What opens under the row. */
  below?: React.ReactNode;
  /** The title is being pressed: read ahead what it opens. */
  onPressTitle?: ReturnType<typeof pressIn> | undefined;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title">) {
  const titleClass = cn("block truncate rounded text-base font-medium leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", done && "text-muted-foreground");
  return (
    <div className={className} {...rest}>
      <div className="flex min-h-16 items-center gap-2.5 py-2.5 pl-3.5 pr-2.5">
        <span className={cn("shrink-0 transition-opacity", done && "opacity-50")}>{badge}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          {href ? (
            <Link {...(onPressTitle ?? {})} href={href} className={titleClass}>
              <span className="sr-only">{kindLabel}: </span>
              {title}
            </Link>
          ) : (
            <span className={titleClass}>
              <span className="sr-only">{kindLabel}: </span>
              {title}
            </span>
          )}
          <p role={done ? "status" : undefined} className={cn("truncate text-[13px] font-normal tabular-nums", done ? "text-muted-foreground" : NEEDS_TONE[tone])}>
            {meta}
          </p>
        </div>
        {end}
      </div>
      {below}
    </div>
  );
}

/** The chips that open under a row: 44 px, on the tint, in an even grid. */
export function NeedsChips({ label, cols, children }: { label: string; cols: 3 | 4; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className={cn("grid gap-1.5 px-3.5 pb-3", cols === 4 ? "grid-cols-4" : "grid-cols-3")}>
      {children}
    </div>
  );
}

export const NEEDS_CHIP =
  "min-h-11 rounded-[12px] bg-cp-accent-tint text-base font-medium tabular-nums text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
