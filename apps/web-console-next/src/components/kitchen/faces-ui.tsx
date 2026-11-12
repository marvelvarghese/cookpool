"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { chipWindow } from "./item-form";
import { faceColor } from "./faces";
import { memberInitials, memberLabel, type MemberNames } from "./members";

/**
 * Faces for people (Cookpool SM-7): `Face` is a person — their initials on
 * their colour, the same on every screen — and `FaceRow` is the one row of
 * faces Use, Dish and Bill pick people with: a tap puts a person in or takes
 * them out — or, for one person only ("Paid by"), picks just them: the
 * caller's `onToggle` decides. You first, then by name.
 */

/** A person's face: initials on their colour ("You" on green). */
export function Face({
  subjectId,
  meId,
  names,
  className,
}: {
  subjectId: string;
  meId: string | null;
  names?: MemberNames | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: faceColor(subjectId, meId) }}
      className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-extrabold text-white", className)}
    >
      {memberInitials(subjectId, meId, names)}
    </span>
  );
}

/** Faces shown before "+N" (two rows on a phone); anyone picked further down stays shown. */
export const FACE_ROW_MAX = 10;

export function FaceRow({
  legend,
  people,
  chosen,
  onToggle,
  meId,
  names,
  max = FACE_ROW_MAX,
  className,
}: {
  /** "Who?", "Paid by", "For". */
  legend: string;
  /** Who can be picked; null while they load. */
  people: readonly string[] | null;
  chosen: ReadonlySet<string>;
  onToggle: (subjectId: string) => void;
  meId: string | null;
  names?: MemberNames | null;
  max?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const faces = chipWindow(people ?? [], { meId, names: names ?? null, chosen, expanded, max });
  return (
    <fieldset className={className}>
      <legend className="mb-2.5 text-[15px] font-extrabold">{legend}</legend>
      {people === null ? (
        <div className="flex gap-3" aria-hidden>
          <Skeleton className="h-[52px] w-[52px] rounded-full" />
          <Skeleton className="h-[52px] w-[52px] rounded-full" />
          <Skeleton className="h-[52px] w-[52px] rounded-full" />
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-1.5 gap-y-3">
          {faces.shown.map((id) => {
            const on = chosen.has(id);
            const color = faceColor(id, meId);
            const name = memberLabel(id, meId, names);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                aria-label={name}
                onClick={() => onToggle(id)}
                className="group flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-0.5 pb-1 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  style={on ? { backgroundColor: color, boxShadow: `0 0 0 3px hsl(var(--background)), 0 0 0 5px ${color}` } : undefined}
                  className={cn(
                    "grid h-[52px] w-[52px] place-items-center rounded-full text-[15px] font-extrabold transition-colors",
                    on ? "text-white" : "bg-muted text-muted-foreground group-hover:bg-accent",
                  )}
                >
                  {memberInitials(id, meId, names)}
                </span>
                <span aria-hidden className={cn("max-w-full truncate text-[13px]", on ? "font-extrabold text-foreground" : "font-semibold text-muted-foreground")}>
                  {name}
                </span>
              </button>
            );
          })}
          {faces.more > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={`${faces.more} more`}
              className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-0.5 pb-1 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden className="grid h-[52px] w-[52px] place-items-center rounded-full border-2 border-dashed border-input text-[15px] font-extrabold text-muted-foreground">
                +{faces.more}
              </span>
              <span aria-hidden className="text-[13px] font-semibold text-muted-foreground">
                More
              </span>
            </button>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}

/**
 * The main button's words: what it does, and — on a second line — who it is
 * for ("You + Anu · ₹8.50 each"). Put it in a `Button` with `MAIN_BUTTON`.
 */
export function MainButtonLabel({ title, who }: { title: string; who?: string | null }) {
  return (
    <span className="flex min-w-0 max-w-full flex-col items-center leading-tight">
      {/* The new frame (RV-19): 17px Medium over a 12px Regular line; today's frame keeps 16px over 13px. */}
      <span className="max-w-full truncate text-base font-extrabold [.cookpool-new_&]:text-[17px] [.cookpool-new_&]:font-medium">{title}</span>
      {who ? <span className="max-w-full truncate text-[13px] font-semibold opacity-90 [.cookpool-new_&]:text-xs [.cookpool-new_&]:font-normal">{who}</span> : null}
    </span>
  );
}

/** The main button: one per screen, full width, tall enough for its two lines. */
export const MAIN_BUTTON = "h-auto min-h-[60px] w-full rounded-[18px] px-4 py-2";
