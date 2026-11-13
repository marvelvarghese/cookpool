"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { MAIN_BUTTON } from "./faces-ui";
import { RepeatButton } from "./row-gestures-ui";
import { JUST_ME, dishTotals } from "./dish-maker";
import { useFinishSession } from "./cook-session-data";
import { SESSION_SHEET } from "./cook-finish-sheet";
import { SaveSwitch } from "./cook-session-ui";
import { finishPlan, finishSaveSwitch, includedLines, sessionCurrency, sessionDishLines, type CookSession, type FinishOutcome, type UntickedChoice } from "./cook-session";
import { FINISH_TITLE, finishLabel, finishSub, servingsText, startingServingsHalf, stepServings } from "./cooked";

/**
 * Finish in the new frame (cookpool-community CM-9, design §2a): the dish is
 * the cook's own — no group, no Who ate. Only the ticked lines go in
 * (cookpool-revamp RV-11: tick what went in; unticked rows aren't charged),
 * how many servings it made (the recipe's at this size to
 * start; Split shares them out later), the save switch, and Finish with the
 * cost on one line ("Finish · ₹186", RV-25). In dark the sheet is #0A0A0A,
 * half the card on the black ground (no token of its own). RC-6's screen
 * and guided mode's Done both open it; it lands on Cooked!.
 * Today's frame keeps `FinishSheet` (Who ate?, Post to).
 */
export function CookFinishSheet({
  session,
  meId,
  onClose,
  onPoint,
  onDone,
}: {
  session: CookSession;
  meId: string;
  onClose: () => void;
  onPoint: (lineKey: string | null) => void;
  onDone: (out: FinishOutcome) => void;
}) {
  const finish = useFinishSession();
  // RV-11: the rows say what went in; an unticked row is never charged.
  const unticked: UntickedChoice = "out";
  const [servings, setServings] = React.useState(() => startingServingsHalf(session));
  // RV-25: "Save to my recipes" starts on where it shows (the owner's call); today's amounts start off.
  const [saveOn, setSaveOn] = React.useState(() => finishSaveSwitch(session)?.on ?? false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const lines = includedLines(session, unticked);
  const currency = sessionCurrency(session);
  const dishLines = sessionDishLines(lines);
  const totals = dishTotals({ lines: dishLines, extrasMinor: 0, portionsHalf: servings, meId, currency });
  const sw = finishSaveSwitch(session);

  const post = async () => {
    if (busy) return;
    setProblem(null);
    const planned = finishPlan(
      session,
      { unticked, postTo: JUST_ME, halves: {}, roster: null, meId, save: saveOn && sw !== null, newSwitch: true, portionsHalf: servings },
      { groups: [] },
    );
    if (!planned.ok) {
      setProblem(planned.problem.message);
      if (planned.problem.lineKey) {
        onClose();
        onPoint(planned.problem.lineKey);
      }
      return;
    }
    setBusy(true);
    const out = await finish(planned.plan, null);
    setBusy(false);
    if (!out.ok && out.kind === "offline") {
      setProblem(out.message);
      return;
    }
    onDone(out);
  };

  const stepper = "grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-cp-accent-tint text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-50";
  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SESSION_SHEET, "gap-[18px] rounded-t-[26px] bg-background cp-dark:bg-[color-mix(in_srgb,hsl(var(--cp-card))_50%,hsl(var(--background)))]", CLOSE_44)}>
        <div aria-hidden className="mx-auto h-[5px] w-10 shrink-0 rounded-full bg-cp-line" />
        <SheetTitle className="flex min-h-11 items-center pr-12 text-[22px] font-medium tracking-[-0.01em]">{FINISH_TITLE}</SheetTitle>
        <div className="-mx-5 min-h-0 flex-1 space-y-[18px] overflow-y-auto px-5 pb-1">
          <div className="overflow-hidden rounded-cp-card bg-card shadow-cp-card">
            <div role="group" aria-labelledby="finish-servings" className="flex min-h-[68px] items-center gap-2.5 py-2.5 pl-4 pr-3">
              <span id="finish-servings" className="flex-1 text-base font-medium">
                Servings
              </span>
              <RepeatButton className={stepper} aria-label="Half a serving less" disabled={servings <= 1} onStep={() => setServings((h) => stepServings(h, -1))}>
                <Minus className="h-5 w-5" strokeWidth={2.4} aria-hidden />
              </RepeatButton>
              <span role="status" aria-label={servingsText(servings)} className="min-w-11 text-center text-xl font-medium tabular-nums">
                {servingsText(servings).replace(/ servings?$/, "")}
              </span>
              <RepeatButton className={stepper} aria-label="Half a serving more" onStep={() => setServings((h) => stepServings(h, 1))}>
                <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden />
              </RepeatButton>
            </div>
            {sw ? (
              <div className="border-t border-cp-line py-1.5 pl-4 pr-3.5">
                <SaveSwitch label={sw.label} on={saveOn} onChange={setSaveOn} />
              </div>
            ) : null}
          </div>

          <p className="text-center text-[13px] font-normal text-muted-foreground">Split the servings after</p>

          {problem ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-normal text-cp-expired">
              {problem}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          className={cn(MAIN_BUTTON, "min-h-[60px] shrink-0 rounded-[18px] bg-primary text-primary-foreground hover:bg-primary/90")}
          loading={busy}
          onClick={() => void post()}
        >
          <span className="truncate text-lg font-medium">{finishLabel(totals.totalMinor, currency, dishLines.length)}</span>
          <span className="sr-only"> · {finishSub(totals.totalMinor, currency, servings, dishLines.length)}</span>
        </Button>
      </SheetContent>
    </Sheet>
  );
}
