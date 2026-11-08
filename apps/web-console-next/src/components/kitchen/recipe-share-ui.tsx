"use client";

import * as React from "react";
import { Bookmark, Link2, Lock, Share, UsersRound } from "lucide-react";
import type { KitchenRecipe, RecipeVisibility } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CLOSE_44 } from "./kit";
import { useGroups } from "./data";
import {
  COPIED_MS,
  LINK_MAKING_TEXT,
  copyLink,
  recipeLinkUrl,
  savedByText,
  shareOptions,
  visibilityCall,
  type ShareCall,
  type ShareOption,
} from "./recipe-share";
import { useShareRecipe } from "./recipe-travel-data";

/**
 * Who can see your recipe (cookpool-recipes RC-8, design §5.1, the canvas's
 * `ShareRecipe`): the Share icon at the top right of your recipe's page opens
 * a bottom sheet, "Who can see it" — Only me, My groups, Anyone with the
 * link — the chosen row tinted green. Choosing one changes it at once, with
 * Undo. With the link on, its full address with a dark Copy ("Copied"), New
 * link (a fresh code; the old one stops) and Turn off (back to My groups).
 * Then "Saved by N", and Done.
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

/** The sheet over your recipe: its level from the recipe's own read, every change through `useShareRecipe`. */
export function ShareSheet({
  recipe,
  open,
  onOpenChange,
}: {
  recipe: Pick<KitchenRecipe, "id" | "name" | "visibility" | "linkCode" | "savedBy">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = useGroups();
  const share = useShareRecipe();
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  const options = React.useMemo(() => shareOptions((groups.data ?? []).map((g) => g.name)), [groups.data]);
  const linkUrl = recipe.visibility === "link" && recipe.linkCode && typeof window !== "undefined" ? recipeLinkUrl(window.location.origin, recipe.linkCode) : null;

  // "Copied" for a moment, and never for a code that has since changed.
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);
  React.useEffect(() => setCopied(false), [linkUrl]);

  const send = (call: ShareCall) => void share({ recipe, call });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className={cn(
          "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[24px] border-x-0 bg-card px-5 pb-6 pt-3 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
          CLOSE_44,
        )}
      >
        <div aria-hidden className="mx-auto mb-2 h-[5px] w-10 shrink-0 rounded-full bg-[#D5DAD2] min-[900px]:hidden" />
        <SheetTitle id="share-recipe-h" className="mb-3.5 flex min-h-11 items-center pr-12 text-[22px] font-extrabold">
          Who can see it
        </SheetTitle>
        <ShareSheetBody
          options={options}
          visibility={recipe.visibility}
          linkUrl={linkUrl}
          copied={copied}
          savedBy={recipe.savedBy}
          rotating={rotating}
          onPick={(to) => {
            if (to !== recipe.visibility) send(visibilityCall(to));
          }}
          onCopy={() => {
            if (!linkUrl) return;
            void copyLink(linkUrl, typeof navigator !== "undefined" ? navigator.clipboard : null).then((ok) => {
              if (ok) setCopied(true);
              else toast({ kind: "warning", title: "Couldn't copy it", description: "Press and hold the link to copy it" });
            });
          }}
          onRotate={() => {
            setRotating(true);
            void share({ recipe, call: { kind: "rotate" } }).finally(() => setRotating(false));
          }}
          onTurnOff={() => send({ kind: "off" })}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
