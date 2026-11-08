"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RecipeResponse, UpdateStepTimesRequest } from "@saas/contracts/kitchen";
import { wrap } from "@/lib/api";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { readDeviceState } from "@/lib/push-device";
import { cookSessions } from "@/lib/cook-session-store";
import type { CookSession, FinishAnswer } from "./cook-session";
import { runTimerWork, serverTimerIds, type TimerServer } from "./cook-guided";
import { browserScreenLockEnv, createScreenLock, ringBell, type ScreenLockState } from "./cook-guided-device";

/**
 * Guided mode's reads and writes (cookpool-guided GC-5, design §4's console
 * side): the server timers set and cancelled with the session's own (GC-3's
 * `createTimer` / `cancelTimer`), the ring in the page, "Use today's times"
 * (GC-2's `updateStepTimes`), whether this device can hear a push, and the
 * page's visibility and screen lock.
 */

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

/** Use today's times next time: GC-2's PATCH of the steps' times; the recipe's reads (the page's and the session's) are refreshed. */
export function useSaveStepTimes(): (recipeId: string, body: UpdateStepTimesRequest) => Promise<FinishAnswer<RecipeResponse>> {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (recipeId, body) => {
      const r = await wrap(() => client.kitchen.updateStepTimes(recipeId, body, { idempotencyKey: crypto.randomUUID() }));
      // Read again rather than kept: a write's answer carries no learned ranges (GC-7).
      if (r.ok) void qc.invalidateQueries({ queryKey: qk.kitchenRecipeBook() });
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
