"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AiRecipePhotoResponse, AiStatus } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { newFrame } from "@/lib/features";
import { useSession } from "@/lib/session";
import { qk } from "@/lib/query";
import { useAiSwitch } from "@/lib/ai-switches";
import { useAiStatus } from "./receipt-data";
import { recipePhotoError, recipePhotoShows } from "./recipe-photo";

/**
 * Recipe from a photo's reads (cookpool-ai AI-9, design §4): whether it shows
 * (AI-8's `useAiStatus`, read only in the new frame with the switch on) and
 * the read itself (`POST /v1/kitchen/me/ai/recipe-photo`, AI-4). Nothing here
 * writes: Save is RC-5's `useSaveRecipe`.
 */

/** Whether Recipe from a photo shows here (new frame, AI available with `features.import`, the switch on). */
export function useRecipePhotoShows(): { shows: boolean; loading: boolean } {
  const isNew = newFrame();
  const switchOn = useAiSwitch("import");
  const enabled = isNew && switchOn;
  const status = useAiStatus(enabled);
  return { shows: recipePhotoShows({ isNewFrame: isNew, status: status.data, switchOn }), loading: enabled && status.loading };
}

/**
 * Read a recipe photo (base64 JPEG). No key or the month's budget marks the
 * status unavailable at once, so every From a photo hides; any answer reads
 * the status again (today's count).
 */
export function useReadRecipePhoto() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (image: string, signal?: AbortSignal): Promise<ApiResult<AiRecipePhotoResponse>> => {
      const r = await wrap(() => client.kitchen.aiRecipePhoto(image, signal ? { signal } : {}));
      if (signal?.aborted) return r;
      const kind = r.ok ? null : recipePhotoError(r.error, r.status).kind;
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
