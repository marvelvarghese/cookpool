"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AiReceiptResponse, AiStatus } from "@saas/contracts/kitchen";
import { wrap, type ApiResult } from "@/lib/api";
import { newFrame } from "@/lib/features";
import { useSession } from "@/lib/session";
import { qk, useApiQuery } from "@/lib/query";
import { useAiSwitch } from "@/lib/ai-switches";
import type { RestockResponse } from "@saas/contracts/kitchen";
import { categoryLookups, foodCategory, receiptError, receiptScanShows } from "./receipt-run";

/**
 * Cookpool AI's reads for Scan a receipt (cookpool-ai AI-8, design §1, §3):
 * whether AI is available (`GET /v1/kitchen/me/ai`) and the receipt read
 * itself (`POST /v1/kitchen/me/ai/receipt`), through the SDK. Nothing here
 * writes: the run's Add is PN-6's `useShoppingRun`.
 */

/** Whether AI is available, the server's features and today's use (read only in the new frame). */
export function useAiStatus(enabled = true) {
  const { client } = useSession();
  return useApiQuery<AiStatus>(qk.kitchenAiStatus(), () => wrap(() => client.kitchen.ai()), { enabled });
}

/**
 * Whether Scan a receipt shows here: the new frame, AI available with the
 * server reading receipts, and this device's "Scan receipts" switch on. It
 * reads nothing in today's frame, and hides while the status is loading or
 * failed.
 */
export function useReceiptScanShows(): boolean {
  const isNew = newFrame();
  const switchOn = useAiSwitch("receipt");
  const status = useAiStatus(isNew && switchOn);
  return receiptScanShows({ isNewFrame: isNew, status: status.data, switchOn });
}

/**
 * Read a receipt photo (base64 JPEG). An answer that AI isn't set up marks
 * the status unavailable at once, so every Scan a receipt hides.
 */
export function useReadReceipt() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (image: string, signal?: AbortSignal): Promise<ApiResult<AiReceiptResponse>> => {
      const r = await wrap(() => client.kitchen.aiReceipt(image, signal ? { signal } : {}));
      if (!r.ok && receiptError(r.error, r.status).kind === "unavailable") {
        qc.setQueryData<AiStatus>(qk.kitchenAiStatus(), (s) => (s ? { ...s, available: false } : s));
      }
      if (!r.ok && receiptError(r.error, r.status).kind === "limit") void qc.invalidateQueries({ queryKey: qk.kitchenAiStatus() });
      return r;
    },
    [client, qc],
  );
}

/**
 * The categories of a receipt's lines (AI-3's lines carry none): each line
 * the restock read doesn't already know is read from its `fromItemId` item,
 * else its `foodId` food, all at once while "matching to your pantries…"
 * shows. A read that fails leaves its line as "other".
 */
export function useReceiptCategories() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useCallback(
    async (res: AiReceiptResponse, signal?: AbortSignal): Promise<Record<number, string>> => {
      const lookups = categoryLookups(res, qc.getQueryData<RestockResponse>(qk.kitchenRestock()));
      const opts = signal ? { signal } : {};
      const found = await Promise.all(
        lookups.map(async (l): Promise<[number, string | null]> => {
          try {
            if (l.kind === "item") {
              const { item } = l.pantry.kind === "group" ? await client.kitchen.getGroupItem(l.pantry.orgId, l.itemId, opts) : await client.kitchen.getPersonalItem(l.itemId, opts);
              return [l.index, item.category || null];
            }
            const foods = await client.kitchen.foods({ q: l.q, limit: 6 }, opts);
            return [l.index, foodCategory(foods.foods, l.foodId)];
          } catch {
            return [l.index, null];
          }
        }),
      );
      const out: Record<number, string> = {};
      for (const [i, c] of found) if (c) out[i] = c;
      return out;
    },
    [client, qc],
  );
}
