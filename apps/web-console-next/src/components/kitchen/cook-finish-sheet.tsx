"use client";

import * as React from "react";
import type { MyGroupBalance } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44, KCard, K_BUTTON_QUIET } from "./kit";
import { MAIN_BUTTON, MainButtonLabel } from "./faces-ui";
import { useMemberNames } from "./people-data";
import { useMembersOf } from "./pantry-data";
import { SharePicker } from "./dish-maker-ui";
import { JUST_ME, dishTotals, shareChoice } from "./dish-maker";
import { useFinishSession } from "./cook-session-data";
import { SaveSwitch, UntickedChoiceBox, WhoAteList } from "./cook-session-ui";
import {
  eatenHalf,
  finishEaters,
  finishPlan,
  includedLines,
  postLabel,
  postSub,
  saveSwitch,
  sessionCurrency,
  sessionDishLines,
  startingEaters,
  stepEater,
  untickedText,
  type CookSession,
  type FinishOutcome,
  type UntickedChoice,
} from "./cook-session";

/**
 * The cooking session's Finish sheet (cookpool-recipes RC-6), on its own so
 * that RC-6's screen and guided mode's Done (cookpool-guided GC-5, "Who
 * ate?") open the same one.
 */

/** The bottom sheets' frame. */
export const SESSION_SHEET =
  "mx-auto flex max-h-[92dvh] max-w-xl flex-col gap-3 rounded-t-[28px] border-x-0 bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-2.5 shadow-2xl focus:outline-none";

/**
 * Finish (design §4.2): the unticked lines (Took them all / Leave them out),
 * who ate (the post-to group's faces, you at 1), where it posts, the save
 * switch, and Post with the total and each person's share.
 */
export function FinishSheet({
  session,
  meId,
  groups,
  groupsLoading,
  postTo,
  onPostTo,
  onClose,
  onPoint,
  onDone,
}: {
  session: CookSession;
  meId: string;
  groups: readonly MyGroupBalance[];
  groupsLoading: boolean;
  postTo: string;
  onPostTo: (postTo: string) => void;
  onClose: () => void;
  onPoint: (lineKey: string | null) => void;
  onDone: (out: FinishOutcome) => void;
}) {
  const finish = useFinishSession();
  const [unticked, setUnticked] = React.useState<UntickedChoice>("all");
  const [halves, setHalves] = React.useState<Record<string, number>>(() => startingEaters(meId));
  const [saveOn, setSaveOn] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const shared = postTo !== JUST_ME;
  const group = shared ? (groups.find((g) => g.orgId === postTo) ?? null) : null;
  const members = useMembersOf(shared ? postTo : null);
  const names = useMemberNames(members.data);
  const roster = React.useMemo(() => (members.data ? members.data.map((m) => m.subjectId) : null), [members.data]);
  // Only the group's own people count (the pick may have changed under them).
  const eaten = React.useMemo(() => {
    if (!roster) return halves;
    const keep = new Set([meId, ...roster]);
    return Object.fromEntries(Object.entries(halves).filter(([id]) => keep.has(id)));
  }, [halves, roster, meId]);

  const lines = includedLines(session, unticked);
  const dishLines = sessionDishLines(lines);
  const currency = sessionCurrency(session, group?.currency ?? null);
  const portionsHalf = shared ? Math.max(1, eatenHalf(eaten)) : 2;
  const totals = dishTotals({ lines: dishLines, extrasMinor: 0, portionsHalf, meId, currency });
  const eaters = shared && roster ? finishEaters({ roster, meId, halves: eaten, totalMinor: totals.totalMinor, names }) : null;
  const notTicked = untickedText(session);
  const sw = saveSwitch(session);
  const choice = shareChoice(postTo, groups);
  const waiting = shared && roster === null && !members.error;

  const post = async () => {
    if (busy || waiting) return;
    setProblem(null);
    const planned = finishPlan(session, { unticked, postTo, halves: eaten, roster, meId, save: saveOn && sw !== null }, { groups });
    if (!planned.ok) {
      setProblem(planned.problem.message);
      if (planned.problem.lineKey) {
        onClose();
        onPoint(planned.problem.lineKey);
      }
      return;
    }
    setBusy(true);
    const out = await finish(planned.plan, group?.name ?? null);
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
        <SheetTitle className="pr-12 text-[22px] font-medium">{shared ? "Who ate?" : "Finish"}</SheetTitle>
        <div className="-mx-5 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-1">
          {notTicked ? <UntickedChoiceBox text={notTicked} value={unticked} onChange={setUnticked} /> : null}

          {shared ? (
            members.error ? (
              <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p className="text-sm text-muted-foreground">Couldn&apos;t load who&apos;s in {group?.name ?? "the group"}. {members.error.message}</p>
                <Button variant="ghost" className={K_BUTTON_QUIET} onClick={members.reload}>
                  Try again
                </Button>
              </KCard>
            ) : (
              <WhoAteList
                rows={eaters?.rows ?? []}
                meId={meId}
                names={names}
                currency={currency}
                loading={eaters === null}
                onStep={(id, d) => setHalves((h) => stepEater(h, id, d))}
              />
            )
          ) : null}

          <SharePicker
            title="Post to"
            groups={groups}
            value={postTo}
            choice={choice}
            currency={dishLines.length > 0 ? sessionCurrency(session) : null}
            loading={groupsLoading}
            onChange={(to) => {
              setProblem(null);
              onPostTo(to);
            }}
          />

          {sw ? <SaveSwitch label={sw.label} on={saveOn} onChange={setSaveOn} /> : null}

          {problem ? (
            <p role="alert" className="rounded-xl bg-cp-expired-tint p-3 text-sm font-medium text-cp-expired">
              {problem}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          className={cn(MAIN_BUTTON, "shrink-0 bg-primary text-primary-foreground hover:bg-primary/90")}
          loading={busy}
          disabled={waiting || (shared && members.error !== null)}
          onClick={() => void post()}
        >
          <MainButtonLabel title={postLabel(postTo, group?.name ?? null)} who={postSub(totals, dishLines.length)} />
        </Button>
      </SheetContent>
    </Sheet>
  );
}
