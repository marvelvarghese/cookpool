"use client";

import * as React from "react";
import type { KitchenRecipe } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CLOSE_44 } from "./kit";
import { useGroups } from "./data";
import { COPIED_MS, copyLink, levelCall, recipeLinkUrl, shareLevelOf, shareOptions, type ShareCall } from "./recipe-share";
import { ShareSheetBody } from "./recipe-share-views";
import { useShareRecipe } from "./recipe-travel-data";

/**
 * Who can see your recipe (cookpool-recipes RC-8, design §5.1, the canvas's
 * `ShareRecipe`): the Share icon at the top right of your recipe's page opens
 * a bottom sheet, "Who can see it" — Only me, My groups, Anyone with the
 * link, Public (cookpool-community CM-5: listed on your profile and in
 * Discover) — the chosen row tinted green. Choosing one changes it at once, with
 * Undo. With the link on, its full address with a dark Copy ("Copied"), New
 * link (a fresh code; the old one stops) and Turn off (back to My groups).
 * Then "Saved by N", and Done.
 */

/** The sheet over your recipe: its level from the recipe's own read, every change through `useShareRecipe`. */
export function ShareSheet({
  recipe,
  open,
  onOpenChange,
}: {
  recipe: Pick<KitchenRecipe, "id" | "name" | "visibility" | "linkCode" | "savedBy" | "listed">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = useGroups();
  const share = useShareRecipe();
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  // Public (cookpool-community CM-5): the sheet is the new frame's only.
  const options = React.useMemo(() => shareOptions((groups.data ?? []).map((g) => g.name), { public: true }), [groups.data]);
  const level = shareLevelOf(recipe);
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
          visibility={level}
          linkUrl={linkUrl}
          copied={copied}
          savedBy={recipe.savedBy}
          rotating={rotating}
          onPick={(to) => {
            if (to !== level) send(levelCall(to, level));
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
