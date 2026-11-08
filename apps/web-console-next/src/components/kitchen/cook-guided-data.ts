"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CreateKitchenTimerRequest, KitchenTimerResponse, RecipeResponse, UpdateStepTimesRequest } from "@saas/contracts/kitchen";
import { wrap } from "@/lib/api";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { readDeviceState } from "@/lib/push-device";
import { cookSessions } from "@/lib/cook-session-store";
import type { CookSession, FinishAnswer } from "./cook-session";
import { afterCancel, afterCreate, handOver, markRang, markShort, serverTimerIds, timerWork, type TimerWork } from "./cook-guided";
import { browserScreenLockEnv, createScreenLock, ringBell, type ScreenLockState } from "./cook-guided-device";

/**
 * Guided mode's reads and writes (cookpool-guided GC-5, design §4's console
 * side): the server timers set and cancelled with the session's own (GC-3's
 * `createTimer` / `cancelTimer`), the ring in the page, "Use today's times"
 * (GC-2's `updateStepTimes`), whether this device can hear a push, and the
 * page's visibility and screen lock.
 */

/** GC-3's timer routes, as the client answers them. */
export interface TimerServer {
  create(request: CreateKitchenTimerRequest): Promise<FinishAnswer<KitchenTimerResponse>>;
  cancel(serverId: string): Promise<FinishAnswer<unknown>>;
}

/** A cancel that failed is tried again after this long. */
export const CANCEL_RETRY_MS = 15_000;

export interface TimerRun {
  /** The draft now (the store's). */
  read(): CookSession | null;
  /** Change the draft in place (the store's `update`). */
  save(change: (s: CookSession) => CookSession): void;
  server: TimerServer;
  now: Date;
  visible: boolean;
  /** Ring the page's bell (Web Audio and vibration). */
  ring(): void;
  /** Creates and cancels on their way, so a pass never asks twice. */
  inFlight: Set<string>;
  /** When each cancel last failed (ms). */
  failedAt: Map<string, number>;
}

/**
 * One pass of the timers' work (`timerWork`), against the server: the
 * hand-overs, short timers and rings are written at once (and the bell
 * rung); then each server timer to set is created, and each to cancel is
 * cancelled, every answer written back as it comes (`afterCreate`,
 * `afterCancel`). Resolves when every call is answered.
 */
export async function runTimerWork(run: TimerRun): Promise<TimerWork> {
  const before = run.read();
  if (!before?.guide) return { create: [], cancel: [], handOver: [], short: [], ring: [], quiet: [] };
  const work = timerWork(before, run.now, run.visible);
  if (work.handOver.length + work.short.length + work.ring.length + work.quiet.length > 0) {
    run.save((s) => markRang(markShort(handOver(s, work.handOver), work.short), [...work.ring, ...work.quiet]));
  }
  if (work.ring.length > 0) run.ring();

  const calls: Promise<void>[] = [];
  for (const c of work.create) {
    const tag = `create:${c.timerId}@${c.endsAt}`;
    if (run.inFlight.has(tag)) continue;
    run.inFlight.add(tag);
    calls.push(
      run.server
        .create(c.request)
        .then((answer) => run.save((s) => afterCreate(s, c, answer)))
        .finally(() => run.inFlight.delete(tag)),
    );
  }
  const cancels = run.read()?.guide?.cancels ?? [];
  const nowMs = run.now.getTime();
  for (const serverId of new Set(cancels)) {
    const tag = `cancel:${serverId}`;
    const failed = run.failedAt.get(serverId);
    if (run.inFlight.has(tag) || (failed !== undefined && nowMs - failed < CANCEL_RETRY_MS)) continue;
    run.inFlight.add(tag);
    calls.push(
      run.server
        .cancel(serverId)
        .then((answer) => {
          if (answer.ok || answer.status === 404) run.failedAt.delete(serverId);
          else run.failedAt.set(serverId, nowMs);
          run.save((s) => afterCancel(s, serverId, answer));
        })
        .finally(() => run.inFlight.delete(tag)),
    );
  }
  await Promise.all(calls);
  return work;
}

/** The client's timer routes. */
function useTimerServer(): TimerServer {
  const { client } = useSession();
  return React.useMemo<TimerServer>(
    () => ({
      create: (request) => wrap(() => client.kitchen.createTimer(request, { idempotencyKey: crypto.randomUUID() })),
      cancel: (serverId) => wrap(() => client.kitchen.cancelTimer(serverId)),
    }),
    [client],
  );
}

/**
 * The session's timers against the server, every tick of `now` and every
 * change of the draft: server timers set and cancelled, the page taking a
 * timer over just before its end, and the bell when one ends in view.
 */
export function useGuideTimers(meId: string, session: CookSession | null, now: Date, visible: boolean): void {
  const server = useTimerServer();
  const inFlight = React.useRef(new Set<string>());
  const failedAt = React.useRef(new Map<string, number>());
  const g = session?.guide;
  const busy = !!g && (g.timers.length > 0 || g.cancels.length > 0);
  React.useEffect(() => {
    if (!busy) return;
    void runTimerWork({
      read: () => cookSessions.read(meId),
      save: (change) => cookSessions.update(meId, change),
      server,
      now,
      visible,
      ring: () => void ringBell(),
      inFlight: inFlight.current,
      failedAt: failedAt.current,
    });
  }, [busy, meId, server, now, visible, session]);
}

/**
 * Cancel every server timer a session holds (Discard, Finish): sent at
 * once, not waited for — the draft is cleared right after, and a timer
 * that slips through only pings once.
 */
export function useCancelServerTimers(): (session: CookSession | null) => void {
  const server = useTimerServer();
  return React.useCallback(
    (session) => {
      for (const id of serverTimerIds(session)) void server.cancel(id);
    },
    [server],
  );
}

/** Use today's times next time: GC-2's PATCH of the steps' times; the recipe's reads are refreshed. */
export function useSaveStepTimes(): (recipeId: string, body: UpdateStepTimesRequest) => Promise<FinishAnswer<RecipeResponse>> {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (recipeId, body) => {
      const r = await wrap(() => client.kitchen.updateStepTimes(recipeId, body, { idempotencyKey: crypto.randomUUID() }));
      if (r.ok) {
        qc.setQueryData(qk.kitchenRecipe(recipeId), r.data);
        void qc.invalidateQueries({ queryKey: qk.kitchenRecipeBook() });
      }
      return r;
    },
    [client, qc],
  );
}

/**
 * Whether a timer can reach this phone locked: notifications allowed here and
 * this device subscribed (PW-6). Null while it is read. Read again when the
 * page comes back (the person may have just turned them on).
 */
export function usePushReady(): boolean | null {
  const [ready, setReady] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let live = true;
    const check = () =>
      void readDeviceState().then(
        (d) => live && setReady(d.permission === "granted" && d.endpoint !== null),
        () => live && setReady(false),
      );
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return ready;
}

/** Whether the page is visible (`visibilitychange`). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    const check = () => setVisible(document.visibilityState === "visible");
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
  return visible;
}

/** Hold the screen on while `wanted` (design §3.7), taken again whenever the page comes back; its state, for the switch's words. */
export function useScreenLock(wanted: boolean): ScreenLockState {
  const [state, setState] = React.useState<ScreenLockState>("off");
  const lock = React.useRef<ReturnType<typeof createScreenLock> | null>(null);
  React.useEffect(() => {
    const l = createScreenLock(browserScreenLockEnv(), setState);
    lock.current = l;
    return () => {
      lock.current = null;
      l.dispose();
    };
  }, []);
  React.useEffect(() => {
    lock.current?.want(wanted);
  }, [wanted]);
  return state;
}
