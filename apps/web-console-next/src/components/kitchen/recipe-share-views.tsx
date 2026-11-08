"use client";

import * as React from "react";
import { Bookmark, Link2, Lock, Share, UsersRound } from "lucide-react";
import type { RecipeVisibility } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { LINK_MAKING_TEXT, savedByText, type ShareOption } from "./recipe-share";

/**
 * The share sheet's parts as they draw (cookpool-recipes RC-8, the canvas's
 * `ShareRecipe`), from what was read: no reads or writes, so each is
 * rendered in tests. `recipe-share-ui.tsx` puts them in the sheet over the
 * writes.
 */

const ICONS = { lock: Lock, groups: UsersRound, link: Link2 } as const;

/** The Share icon, 44 px, beside Edit. */
export function ShareIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Share"
      aria-haspopup="dialog"
      onClick={onClick}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[#3F4842] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Share className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden />
    </button>
  );
}

/** One level, as a radio row: its icon in a 40 px box, its words, the radio. */
function OptionRow({ option, on, onPick }: { option: ShareOption; on: boolean; onPick: () => void }) {
  const Icon = ICONS[option.icon];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        "flex min-h-[68px] w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-[1.5px] border-primary bg-cp-herb-tint" : "border border-[#D5DAD2] bg-card hover:bg-accent",
      )}
    >
      <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", on ? "bg-primary text-white" : "bg-background text-[#3F4842]")}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-extrabold">{option.title}</span>
        <span className="text-[13px] font-semibold text-muted-foreground">{option.sub}</span>
      </span>
      <span aria-hidden className={cn("grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2", on ? "border-primary" : "border-[#9AA39D]")}>
        <span className={cn("h-2.5 w-2.5 rounded-full", on ? "bg-primary" : "bg-transparent")} />
      </span>
    </button>
  );
}

/** The sheet's insides as they draw (no reads or writes, so tests render it). */
export function ShareSheetBody({
  options,
  visibility,
  linkUrl,
  copied,
  savedBy,
  rotating = false,
  onPick,
  onCopy,
  onRotate,
  onTurnOff,
  onDone,
  titleId = "share-recipe-h",
}: {
  options: readonly ShareOption[];
  visibility: RecipeVisibility;
  /** The full address while the link is on; null while a code is on its way. */
  linkUrl: string | null;
  copied: boolean;
  savedBy: number;
  rotating?: boolean;
  onPick: (to: RecipeVisibility) => void;
  onCopy: () => void;
  onRotate: () => void;
  onTurnOff: () => void;
  onDone: () => void;
  titleId?: string;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div role="radiogroup" aria-labelledby={titleId} className="flex flex-col gap-2">
        {options.map((o) => (
          <OptionRow key={o.id} option={o} on={o.id === visibility} onPick={() => onPick(o.id)} />
        ))}
      </div>

      {visibility === "link" ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 rounded-[14px] border border-[#E3E6E0] bg-background py-1.5 pl-3.5 pr-1.5">
            <span aria-live="polite" className="min-w-0 flex-1 truncate text-[15px] font-bold text-[#3F4842]">
              {linkUrl ?? LINK_MAKING_TEXT}
            </span>
            <button
              type="button"
              onClick={onCopy}
              disabled={!linkUrl}
              className="min-h-11 shrink-0 rounded-[10px] bg-foreground px-4 text-[15px] font-extrabold text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onRotate}
              disabled={!linkUrl || rotating}
              className="min-h-11 rounded-lg px-1 text-[13px] font-extrabold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              New link
            </button>
            <button
              type="button"
              onClick={onTurnOff}
              className="min-h-11 rounded-lg px-1 text-[13px] font-extrabold text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Turn off
            </button>
          </div>
        </div>
      ) : null}

      <p className="flex min-h-11 items-center gap-2 text-sm font-bold tabular-nums text-[#3F4842]">
        <Bookmark className="h-4 w-4" strokeWidth={2.2} aria-hidden />
        {savedByText(savedBy)}
      </p>

      <button
        type="button"
        onClick={onDone}
        className="min-h-14 w-full rounded-2xl bg-primary text-base font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Done
      </button>
    </div>
  );
}
