"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AiStatus, AiUsesResponse } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { newFrame } from "@/lib/features";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useAiSwitch } from "@/lib/ai-switches";
import { useAiStatus } from "./receipt-data";
import { useLogSeveral } from "./log-several-data";
import { saidEntries, saidToast, sayItError, sayItShows, type SaidLogRow } from "./say-it";
import type { MemberNames } from "./members";

/**
 * Say what you used's reads and its one write (cookpool-ai AI-7, design §2):
 * whether it shows (AI-8's status read and this device's switch), the read
 * of a sentence (`POST /v1/kitchen/me/ai/uses`, which writes nothing), and
 * Log — PN-5's Log several, one use after another with one Undo.
 */

/** Whether the Pantry's box and Home's ✨ show: the new frame, AI available reading sentences, the switch on. */
export function useSayItShows(): boolean {
  const isNew = newFrame();
  const switchOn = useAiSwitch("sayIt");
  const status = useAiStatus(isNew && switchOn);
  return sayItShows({ isNewFrame: isNew, status: status.data, switchOn });
}

/**
 * Read one sentence. AI not set up (or its month's budget spent) marks the
 * status unavailable at once, so the box hides; any answer changes today's
 * count, so the status is read again.
 */
export function useReadSentence() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (text: string, signal?: AbortSignal): Promise<ApiResult<AiUsesResponse>> => {
      const r = await wrap(() => client.kitchen.aiUses(text, signal ? { signal } : {}));
      if (signal?.aborted) return r;
      const kind = r.ok ? null : sayItError(r.error, r.status).kind;
      if (kind === "unavailable" || kind === "budget") {
        qc.setQueryData<AiStatus>(qk.kitchenAiStatus(), (s) => (s ? { ...s, available: false, ...(kind === "budget" ? { budget: "reached" as const } : {}) } : s));
      } else {
        void qc.invalidateQueries({ queryKey: qk.kitchenAiStatus() });
      }
      return r;
    },
    [client, qc],
  );
}

/** Log the rows as they stand: one use each, one after another, with one Undo ("Logged 2 · ₹42.50"). */
export function useLogSaid() {
  const logSeveral = useLogSeveral();
  return React.useCallback(
    (rows: readonly SaidLogRow[], ctx: { meId: string | null; names?: MemberNames | null }): Promise<void> =>
      logSeveral(saidEntries(rows), { meId: ctx.meId, names: ctx.names ?? null, toast: saidToast }).then(() => undefined),
    [logSeveral],
  );
}
