"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { RepeatButton } from "./row-gestures-ui";
import { JUST_ME, dishTotals } from "./dish-maker";
import { useFinishSession } from "./cook-session-data";
import { SESSION_SHEET } from "./cook-finish-sheet";
import { STEP_BUTTON, SaveSwitch, UntickedChoiceBox } from "./cook-session-ui";
import { finishPlan, includedLines, saveSwitch, sessionCurrency, sessionDishLines, untickedText, type CookSession, type FinishOutcome, type UntickedChoice } from "./cook-session";
import { FINISH_TITLE, finishSub, servingsText, startingServingsHalf, stepServings } from "./cooked";

/**
 * Finish in the new frame (cookpool-community CM-9, design §2a): the dish is
 * the cook's own — no group, no Who ate. The unticked lines (Took them all /
 * Leave them out), how many servings it made (the recipe's at this size to
 * start; Split shares them out later), the save switch, and Finish with the
 * cost. RC-6's screen and guided mode's Done both open it; it lands on Cooked!.
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
  const [unticked, setUnticked] = React.useState<UntickedChoice>("all");
  const [servings, setServings] = React.useState(() => startingServingsHalf(session));
  const [saveOn, setSaveOn] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const lines = includedLines(session, unticked);
  const currency = sessionCurrency(session);
  const totals = dishTotals({ lines: sessionDishLines(lines), extrasMinor: 0, portionsHalf: servings, meId, currency });
  const notTicked = untickedText(session);
  const sw = saveSwitch(session);

  const post = async () => {
    if (busy) return;
    setProblem(null);
    const planned = finishPlan(
      session,
      { unticked, postTo: JUST_ME, halves: {}, roster: null, meId, save: saveOn && sw !== null, portionsHalf: servings },
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

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="bottom" aria-describedby={undefined} className={cn(SESSION_SHEET, CLOSE_44)}>
        <div aria-hidden className="mx-auto mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" />
        <SheetTitle className="pr-12 text-[22px] font-extrabold">{FINISH_TITLE}</SheetTitle>
        <div className="-mx-5 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-1">
          {notTicked ? <UntickedChoiceBox text={notTicked} value={unticked} onChange={setUnticked} /> : null}

          <div className="flex min-h-14 items-center gap-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span id="finish-servings" className="text-base font-extrabold">
                Servings
              </span>
              <span className="text-xs font-semibold text-muted-foreground">How many it made · split them later</span>
            </span>
            <RepeatButton className={STEP_BUTTON} aria-label="Half a serving less" disabled={servings <= 1} onStep={() => setServings((h) => stepServings(h, -1))}>
              <Minus className="h-5 w-5" aria-hidden />
            </RepeatButton>
            <span aria-label={servingsText(servings)} className="min-w-[4.5rem] text-center text-lg font-extrabold tabular-nums">
              {servingsText(servings).replace(/ servings?$/, "")}
            </span>
            <RepeatButton className={STEP_BUTTON} aria-label="Half a serving more" onStep={() => setServings((h) => stepServings(h, 1))}>
              <Plus className="h-5 w-5" aria-hidden />
            </RepeatButton>
          </div>

          {sw ? <SaveSwitch label={sw.label} on={saveOn} onChange={setSaveOn} /> : null}

          {problem ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {problem}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          className={cn(MAIN_BUTTON, "shrink-0 bg-[#B4471F] text-white hover:bg-[#9C3C19]")}
          loading={busy}
          onClick={() => void post()}
        >
          <MainButtonLabel title={FINISH_TITLE} who={finishSub(totals.totalMinor, currency, servings)} />
        </Button>
      </SheetContent>
    </Sheet>
  );
}
