"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { KitchenDish, SplitReminderInboxItem } from "@saas/contracts/kitchen";
import { wrap } from "@/lib/api";
import { refuseIfOffline } from "@/lib/connection";
import { qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/ui/toast";
import { beginWrite } from "./optimistic-data";
import { refreshAfterDish } from "./dish-maker-data";
import { refusedToast, undoFailed, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import {
  REMINDER_DISMISSED,
  cookedSeedKey,
  parseCookedSeed,
  reminderDismissPatches,
  reminderRestorePatches,
  splitPlan,
  splitRefusalText,
  splitToast,
  withoutReminder,
  type CookedSeed,
} from "./cooked";

/**
 * Cooked, then post or split (cookpool-community CM-9): the writes and the
 * device memory behind Cooked!, Split with a group and Home's reminder.
 *
 * - **Split** is CM-8's `splitDish` (claims), then the eaters' shares — the
 *   same two writes a dish cooked into the group made. It moves no money
 *   (that waits for finalize) and has no reversal route, so it confirms when
 *   the server answers, with no Undo; the dish's answer goes into its cache.
 * - **Dismiss** is instant with Undo (SM-5): the card leaves Home at once,
 *   and Undo restores it (`restoreSplitReminder`).
 */

/** Finish leaves the session's time and steps for Cooked! (this tab only): the dish read doesn't carry them. */
export function rememberCookedSeed(dishId: string, seed: CookedSeed): void {
  if (seed.minutes === null && seed.steps === null) return;
  try {
    window.sessionStorage.setItem(cookedSeedKey(dishId), JSON.stringify(seed));
  } catch {
    // Private mode: Cooked! shows what the dish read has.
  }
}

/** What Finish left for this dish, read once. */
export function useCookedSeed(dishId: string): CookedSeed {
  const [seed] = React.useState<CookedSeed>(() => {
    if (typeof window === "undefined") return parseCookedSeed(null);
    try {
      return parseCookedSeed(window.sessionStorage.getItem(cookedSeedKey(dishId)));
    } catch {
      return parseCookedSeed(null);
    }
  });
  return seed;
}

export type SplitOutcome = { ok: true; dish: KitchenDish } | { ok: false; message: string };

/** Split a dish of yours with a group: `splitDish`, then who ate. */
export function useSplitDish() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  return React.useCallback(
    async (
      dish: KitchenDish,
      input: { orgId: string; groupName: string; halves: Readonly<Record<string, number>>; roster: readonly string[]; meId: string },
    ): Promise<SplitOutcome> => {
      if (refuseIfOffline()) return { ok: false, message: "You're offline · nothing was split" };
      const plan = splitPlan(input.orgId, input);
      const r = await wrap(() => client.kitchen.splitDish(dish.id, plan.split, { idempotencyKey: crypto.randomUUID() }));
      if (!r.ok) {
        // Split elsewhere meanwhile, or canceled: read it again.
        if (r.error.reason === "already_split" || r.error.reason === "dish_not_open") refreshAfterDish(qc, dish);
        return { ok: false, message: splitRefusalText(r.error, input.groupName) };
      }
      let out = r.data.dish;
      if (plan.shares) {
        const s = await wrap(() => client.kitchen.setDishShares(input.orgId, dish.id, plan.shares!, { idempotencyKey: crypto.randomUUID() }));
        if (s.ok) out = s.data.dish;
        else toast({ kind: "warning", title: "Who ate wasn't saved", description: `${s.error.message} · set it on the dish` });
      }
      qc.setQueryData(qk.kitchenDish(out.id), out);
      qc.setQueryData(qk.kitchenInbox(), (d: unknown) => (d ? withoutReminder(d as Parameters<typeof withoutReminder>[0], dish.id) : d));
      refreshAfterDish(qc, out);
      toast({ kind: "success", ...splitToast(out.name, input.groupName, plan.shares?.shares.length ?? 0) });
      return { ok: true, dish: out };
    },
    [client, qc, toast],
  );
}

/** Dismiss Home's reminder for a dish: gone at once, Undo brings it back. */
export function useDismissSplitReminder() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (item: SplitReminderInboxItem): void => {
      const write = beginWrite(qc, reminderDismissPatches(item.dish.id));
      const sent = write.track(wrap(() => client.kitchen.dismissSplitReminder(item.dish.id, { idempotencyKey: crypto.randomUUID() })));
      const handle = offer({
        ...REMINDER_DISMISSED,
        undo: async (): Promise<UndoResult> => {
          const first = await sent;
          if (!first.ok) return { ok: true };
          const u = await wrap(() => client.kitchen.restoreSplitReminder(item.dish.id, { idempotencyKey: crypto.randomUUID() }));
          void qc.invalidateQueries({ queryKey: qk.kitchenInbox() });
          return u.ok ? { ok: true, description: `Home reminds you about ${item.dish.name} again` } : undoFailed(u.error);
        },
        restore: () => write.restore(reminderRestorePatches(item)),
      });
      void sent.then((r) => {
        if (r.ok) return;
        write.rollback();
        handle.refuse(refusedToast(`Couldn't dismiss ${item.dish.name}`, r.error.message));
      });
    },
    [client, qc, offer],
  );
}
