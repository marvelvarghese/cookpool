"use client";

import * as React from "react";
import type { MyGroupBalance } from "@saas/contracts/kitchen";
import { isOffline } from "@/lib/connection";
import { newFrame } from "@/lib/features";
import { SETTLE_EASE, SETTLE_MS, listenForDrags, prefersReducedMotion, type ElementLike } from "@/lib/gestures";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { cookSessions } from "@/lib/cook-session-store";
import { readLongPrep, writeLongPrep } from "@/lib/long-prep-store";
import { useToast } from "@/components/ui/toast";
import { useBack } from "./back-ui";
import { useMemberNames, useMyBalances } from "./people-data";
import { JUST_ME, dishHref } from "./dish-maker";
import { formatMinor } from "./money";
import { useFreshTakes } from "./cook-session-data";
import { useCancelAsk, useCookAsk, useSessionAsks } from "./ask-data";
import { FinishSheet } from "./cook-finish-sheet";
import { useNow } from "./cook-session-ui";
import {
  FINISH_OFFLINE_TEXT,
  SESSION_PARENT,
  postToOf,
  sessionCurrency,
  sessionLineView,
  setPostTo,
  stepLine,
  tickLine,
  withLineAsk,
  type CookSession,
  type FinishOutcome,
} from "./cook-session";
import {
  addMinute,
  backToSteps,
  chooseMode,
  countWhistle,
  goToStep,
  guidedScreen,
  longPrepDone,
  longPrepMarks,
  markStepDone,
  pauseTimer,
  resumeTimer,
  seeTimer,
  setScreenOn,
  setTimesSaved,
  showPrep,
  startAndGoOn,
  startCooking,
  startTimer,
  stepBy,
  tickPrep,
  tickTool,
  todaysStepTimes,
  writtenStepTimes,
} from "./cook-guided";
import {
  doneScreen,
  prepScreen,
  promptView,
  sessionCostMinor,
  stepScreen,
  timerBanner,
  timerStrip,
  waitScreen,
  type MeanwhileItem,
  type StripItem,
} from "./cook-guided-screens";
import { primeBell, readAloud, stepSwipeGoes, stepSwipeRule, stopReading, type ScreenLockState } from "./cook-guided-device";
import { useCancelServerTimers, useGuideTimers, usePageVisible, usePushReady, useSaveStepTimes, useScreenLock } from "./cook-guided-data";
import {
  GuideDoneView,
  GuidePrepView,
  GuidePromptView,
  GuideStepView,
  GuideWaitView,
  TimerBannerCard,
  type StepHandlers,
  type WaitHandlers,
} from "./cook-guided-ui";
import { useKitchenRouter } from "./transition-ui";

/**
 * Guided mode (cookpool-guided GC-5, design §3) at `/cook/session`: the same
 * session as RC-6's, from a recipe with steps — the prompt, Before you start,
 * one step at a time, waiting with Meanwhile, Done, then RC-6's own Finish
 * sheet (Who ate?), which posts the dish with its step log.
 *
 * Every change is the pure draft's (`cook-guided.ts`), written back at once,
 * so it survives a reload and follows the cook across tabs. The clock ticks
 * each second; the server timers follow the session's own
 * (`useGuideTimers`); the screen stays on while a guided screen is visible
 * (`useScreenLock`). It shows only in the new frame, as the session does.
 */
export function GuidedCook({ meId, session, onLeave }: { meId: string; session: CookSession; onLeave: () => void }) {
  const router = useKitchenRouter();
  const minimize = useBack();
  const now = useNow(1000);
  const visible = usePageVisible();
  const { toast } = useToast();
  const save = React.useCallback((change: (s: CookSession) => CookSession) => cookSessions.update(meId, change), [meId]);
  const at = () => new Date();
  const screen = guidedScreen(session, newFrame()) ?? "prompt";
  const g = session.guide!;

  useFreshTakes(session, save);
  // Ask before use (cookpool-pantry PN-9): Gather's lines the cook must ask for ask, as RC-6's do.
  useSessionAsks(session, save);
  const cookAsk = useCookAsk(meId, save);
  const cancelAsk = useCancelAsk();
  useGuideTimers(meId, session, now, visible);
  const lockState = useScreenLock(screen !== "prompt" && g.screenOn && visible);
  const [canLock, setCanLock] = React.useState(true);
  React.useEffect(() => setCanLock(typeof navigator !== "undefined" && "wakeLock" in navigator), []);
  const shownLock: ScreenLockState = canLock ? lockState : "unsupported";
  const pushHint = usePushReady() === false;
  const cancelTimers = useCancelServerTimers();
  const saveTimes = useSaveStepTimes();

  const balances = useMyBalances();
  const groups = balances.data?.groups ?? NO_GROUPS;
  const recentSlugs = useRecentGroupSlugs();
  const names = useMemberNames();
  const postTo = postToOf(session, groups, recentSlugs);
  const group = postTo === JUST_ME ? null : (groups.find((x) => x.orgId === postTo) ?? null);

  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [finishOpen, setFinishOpen] = React.useState(false);
  const [alert, setAlert] = React.useState<string | null>(null);
  const [savingTimes, setSavingTimes] = React.useState(false);

  // The recipe page's long prep (GC-6) agrees with this session's: done, or the soak and its timer.
  const marks = longPrepMarks(session);
  const marksKey = JSON.stringify(marks);
  React.useEffect(() => {
    const memory = readLongPrep();
    const changed = Object.entries(marks).filter(([key, mark]) => JSON.stringify(memory[key]) !== JSON.stringify(mark));
    if (changed.length > 0) writeLongPrep({ ...memory, ...Object.fromEntries(changed) });
    // `marks` is new each render; its text says when it changed.
  }, [marksKey]);

  // A new step stops what was being read of the last one.
  React.useEffect(() => stopReading, [g.current, screen]);

  // Swipe between steps (design §3.3), on PW-7's gestures: the step follows the finger a little, and moves on letting go far enough.
  const surface = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = surface.current;
    if (!el || screen !== "step") return;
    const still = prefersReducedMotion();
    return listenForDrags(el, {
      begin: (start, target) => stepSwipeRule(start, target, el as unknown as ElementLike),
      move(dx) {
        if (still) return;
        el.style.transition = "none";
        el.style.transform = `translate3d(${Math.round(dx * 0.35)}px, 0, 0)`;
      },
      end(drag, cancelled) {
        el.style.transition = still ? "" : `transform ${SETTLE_MS}ms ${SETTLE_EASE}`;
        el.style.transform = "";
        if (cancelled) return;
        const d = stepSwipeGoes(drag.dx, el.clientWidth || window.innerWidth, drag.vx);
        if (d !== 0) save((s) => stepBy(s, d, new Date()));
      },
    });
  }, [screen, save]);

  /** Discard and Finish: every server timer cancelled, the draft cleared, then away. */
  const leave = (path: string, how: "push" | "replace") => {
    onLeave();
    cancelTimers(cookSessions.read(meId) ?? session);
    stopReading();
    cookSessions.clear(meId);
    if (how === "push") router.push(path);
    else router.replace(path);
  };
  const discard = () => leave(SESSION_PARENT, "replace");
  const finished = (out: FinishOutcome) => {
    setFinishOpen(false);
    if (out.ok) {
      leave(dishHref(out.dish.id), "push");
      return;
    }
    setAlert(out.message);
  };
  const openFinish = () => {
    // Finish needs signal (RC-6, design §4.1): offline it says so, and the session stays.
    if (isOffline()) {
      setAlert(FINISH_OFFLINE_TEXT);
      return;
    }
    setAlert(null);
    setFinishOpen(true);
  };

  const openStrip = (item: Pick<StripItem, "phase" | "stepKey">) =>
    save((s) => (item.phase === "prep" ? showPrep(s, at()) : goToStep(s, item.stepKey, at(), "go")));

  const shownStep = screen === "step" ? g.current : null;
  const banner = timerBanner(session, now, shownStep);
  const bannerCard = banner ? (
    <TimerBannerCard
      banner={banner}
      onOpen={() => {
        save((s) => seeTimer(s, banner.timerId));
        openStrip(banner);
      }}
      onDismiss={() => save((s) => seeTimer(s, banner.timerId))}
    />
  ) : null;
  const strip = timerStrip(session, now, shownStep);

  const useTimes = async (on: boolean) => {
    if (!session.recipeId || savingTimes) return;
    const today = todaysStepTimes(session);
    const body = on ? today : today ? writtenStepTimes(session, today.steps.map((st) => st.key)) : null;
    if (!body) return;
    setSavingTimes(true);
    const r = await saveTimes(session.recipeId, body);
    setSavingTimes(false);
    if (r.ok) {
      save((s) => setTimesSaved(s, on));
      toast({ kind: "success", title: on ? "Next time reads today's times" : "Your recipe's times are back" });
    } else {
      toast({ kind: "warning", title: "The times weren't saved", description: r.error.message });
    }
  };

  let body: React.ReactNode = null;
  if (screen === "prompt") {
    const view = promptView(session, now);
    if (view) {
      body = (
        <GuidePromptView
          view={view}
          lockState={shownLock}
          pushHint={pushHint}
          on={{
            onMinimize: minimize,
            onGuided: () => {
              primeBell();
              save((s) => chooseMode(s, "guided", at()));
            },
            onTick: () => save((s) => chooseMode(s, "tick", at())),
            onSoak: (key) => {
              primeBell();
              save((s) => startTimer(s, key, at()));
            },
            onLongPrepDone: (key) => save((s) => longPrepDone(s, key, at())),
            onDiscard: discard,
          }}
        />
      );
    }
  } else if (screen === "prep") {
    const view = prepScreen(session, now);
    if (view) {
      body = (
        <GuidePrepView
          view={view}
          gather={session.lines.map((l) => sessionLineView(l, { meId, names, now }))}
          openKey={openKey}
          strip={strip}
          banner={bannerCard}
          on={{
            onMinimize: minimize,
            onTickLine: (key) => save((s) => tickLine(s, key)),
            onAskLine: (key, who) => cookAsk(session, key, who),
            onCancelAskLine: (key) => {
              const a = session.lines.find((l) => l.key === key)?.ask;
              if (!a) return;
              save((s) => withLineAsk(s, key, null));
              void cancelAsk({ id: a.id, orgId: a.orgId });
            },
            onToggleLine: (key) => setOpenKey((k) => (k === key ? null : key)),
            onStepLine: (key, d) => save((s) => stepLine(s, key, d)),
            onTickTool: (i) => save((s) => tickTool(s, i)),
            onTickPrep: (key) => save((s) => tickPrep(s, key, at())),
            onStartPrep: (key) => {
              primeBell();
              save((s) => startTimer(s, key, at()));
            },
            onStrip: openStrip,
            onStart: () => {
              primeBell();
              save((s) => startCooking(s, at()));
            },
            onDiscard: discard,
          }}
        />
      );
    }
  } else if (screen === "step") {
    const view = stepScreen(session, now);
    if (view) {
      const key = view.key;
      const stepOn: StepHandlers = {
        onMinimize: minimize,
        onReadAloud: () => void readAloud(view.speech),
        onTickChip: (line) => save((s) => tickLine(s, line)),
        onStart: () => {
          primeBell();
          save((s) => (view.timer?.handsOff ? startAndGoOn(s, key, at()) : startTimer(s, key, at())));
        },
        onPause: (id) => save((s) => pauseTimer(s, id, at())),
        onResume: (id) => {
          primeBell();
          save((s) => resumeTimer(s, id, at()));
        },
        onPlus: (id) => save((s) => addMinute(s, id, at())),
        onBack: () => save((s) => stepBy(s, -1, at())),
        onDone: () => save((s) => markStepDone(s, key, at())),
        onStrip: openStrip,
      };
      const wait = waitScreen(session, view, now);
      if (wait) {
        const waitOn: WaitHandlers = {
          ...stepOn,
          onCountWhistle: () => {
            primeBell();
            save((s) => countWhistle(s, key, at()));
          },
          onWhistleHelp: (seconds) => {
            primeBell();
            save((s) => startTimer(s, key, at(), seconds));
          },
          onScreenOn: (on) => save((s) => setScreenOn(s, on)),
          onMeanwhile: (item: MeanwhileItem) => save((s) => (item.kind === "prep" ? tickPrep(s, item.key, at()) : goToStep(s, item.key, at(), "go"))),
          onGoOn: (next) => save((s) => goToStep(s, next, at(), "go")),
        };
        body = <GuideWaitView view={view} wait={wait} strip={strip} screenOn={g.screenOn} lockState={shownLock} pushHint={pushHint} on={waitOn} banner={bannerCard} />;
      } else {
        body = <GuideStepView view={view} strip={strip} pushHint={pushHint} on={stepOn} banner={bannerCard} />;
      }
    }
  } else {
    const view = doneScreen(session, now);
    if (view) {
      const cost = formatMinor(sessionCostMinor(session), sessionCurrency(session, group?.currency ?? null));
      body = (
        <GuideDoneView
          view={view}
          whoAteSub={`${cost} · ${group ? `post to ${group.name}` : "just for you"}`}
          strip={strip}
          savingTimes={savingTimes}
          alert={alert}
          on={{
            onMinimize: minimize,
            onBackToSteps: () => save((s) => backToSteps(s, at())),
            onUseTimes: (on) => void useTimes(on),
            onWhoAte: openFinish,
            onStrip: openStrip,
            onDiscard: discard,
          }}
        />
      );
    }
  }

  return (
    <>
      <div ref={surface} className="touch-pan-y">
        {body}
      </div>
      {finishOpen ? (
        <FinishSheet
          session={session}
          meId={meId}
          groups={groups}
          groupsLoading={balances.loading}
          postTo={postTo}
          onPostTo={(to) => save((s) => setPostTo(s, to))}
          onClose={() => setFinishOpen(false)}
          onPoint={() => undefined}
          onDone={finished}
        />
      ) : null}
    </>
  );
}

const NO_GROUPS: readonly MyGroupBalance[] = [];
