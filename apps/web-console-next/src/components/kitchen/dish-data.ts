"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DishesPage, KitchenDish } from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { qk, type AsyncState } from "@/lib/query";
import { useToast } from "@/components/ui/toast";
import { refreshLedger, UNDO_MS } from "./ledger-data";
import {
  claimRefusal,
  claimedToast,
  dishHref,
  finalizedToast,
  portionsText,
  shareRequests,
  sharesOf,
  splitRefusal,
  type ShareDraft,
} from "./dish";
import type { MemberNames } from "./members";

/**
 * Cookpool's dish reads and writes (CP-17), through the CP-14/CP-16 SDK. Every
 * read is cached under `qk.kitchenDishes()`. A write's answer is the dish
 * itself, so it goes straight into the dish's cache entry; the lists are
 * refreshed, and a write that moved money (finalize, correct, cancel) also
 * refreshes the ledgers it touched and every pantry (leftovers, stock put
 * back). Claims and assignments confirm by a ten-second Undo that sets them
 * back; finalize is final but correctable, so its toast offers "Correct it".
 */

/** An open dish (or one being split) is read again every 20 seconds while on screen (design §7). */
export const DISH_POLL_MS = 20_000;

/** A claim stepped with + and − is sent once the taps stop. */
export const CLAIM_SETTLE_MS = 700;

const GROUP_DISHES_PAGE = 20;

async function unwrap<T>(fn: () => Promise<T>): Promise<T> {
  const r = await wrap(fn);
  if (!r.ok) throw r.error;
  return r.data;
}

/** One dish, by its `dsh_…` id: its cook, or any member of its group, may read it. */
export function useDish(dishId: string | null): AsyncState<KitchenDish> {
  const { client } = useSession();
  const q = useQuery<KitchenDish, ApiErrorBody>({
    queryKey: qk.kitchenDish(dishId ?? ""),
    queryFn: () => unwrap(async () => (await client.kitchen.getDish(dishId ?? "")).dish),
    enabled: dishId !== null,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "open" || state === "draft" ? DISH_POLL_MS : false;
    },
    retry: (count, error) => error.code !== "not_found" && count < 1,
  });
  return {
    data: q.data ?? null,
    loading: q.isLoading,
    error: q.error ? { code: q.error.code ?? "error", message: q.error.message ?? "Request failed" } : null,
    reload: () => void q.refetch(),
  };
}

/** The dishes shared with a group, newest first, a page at a time. */
export function useGroupDishes(orgId: string) {
  const { client } = useSession();
  return useInfiniteQuery<DishesPage, ApiErrorBody>({
    queryKey: qk.kitchenGroupDishes(orgId),
    queryFn: ({ pageParam }) =>
      unwrap(() =>
        client.kitchen.groupDishes(
          orgId,
          typeof pageParam === "string" ? { cursor: pageParam, limit: GROUP_DISHES_PAGE } : { limit: GROUP_DISHES_PAGE },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Put a write's answer in the dish's cache entry and refresh every other dish read. */
function putDish(qc: QueryClient, dish: KitchenDish): void {
  qc.setQueryData(qk.kitchenDish(dish.id), dish);
  void qc.invalidateQueries({
    queryKey: qk.kitchenDishes(),
    predicate: (q) => !(q.queryKey[1] === "dish" && q.queryKey[2] === dish.id),
  });
}

/** After a write that moved money: the ledgers it touched, the cross-group reads, every pantry. */
function refreshMoney(qc: QueryClient, dish: KitchenDish, alsoSources: boolean): void {
  const groups = new Set<string>();
  if (dish.orgId) groups.add(dish.orgId);
  if (alsoSources) {
    for (const o of dish.owes) groups.add(o.orgId);
    for (const i of dish.ingredients) if (i.orgId) groups.add(i.orgId);
  }
  for (const orgId of groups) refreshLedger(qc, orgId);
  void qc.invalidateQueries({ queryKey: qk.kitchenMe() });
  void qc.invalidateQueries({ queryKey: qk.kitchenPantry() });
}

export type DishWrite = { ok: true; dish: KitchenDish } | { ok: false; error: ApiErrorBody; status: number };

/** The server answered (a refusal is stored against its key at the edge): the next try needs a new key. */
export function answered(r: { status: number }): boolean {
  return r.status > 0 && r.status < 500;
}

/** The dish writes, each putting its answer in the cache; a refusal reads the dish again. */
export function useDishWrites() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useMemo(() => {
    const settle = (dish: KitchenDish, r: ApiResult<{ dish: KitchenDish }>): DishWrite => {
      if (!r.ok) {
        void qc.invalidateQueries({ queryKey: qk.kitchenDish(dish.id) });
        return { ok: false, error: r.error, status: r.status };
      }
      putDish(qc, r.data.dish);
      return { ok: true, dish: r.data.dish };
    };
    return {
      /** PUT …/claims/me — the caller's half portions (0 takes the claim back). */
      claim: async (dish: KitchenDish, portionsHalf: number) =>
        settle(dish, await wrap(() => client.kitchen.claimDish(dish.orgId ?? "", dish.id, { portionsHalf }))),
      /** PUT …/shares — the cook sets everyone's share (draft or open). */
      setShares: async (dish: KitchenDish, shares: readonly ShareDraft[]) =>
        settle(dish, await wrap(() => client.kitchen.setDishShares(dish.orgId ?? "", dish.id, { shares: shareRequests(shares) }))),
      /** Finalize: in the group, or — a dish just for its cook — on the cook's own route. */
      finalize: async (dish: KitchenDish, idempotencyKey: string) => {
        const r = await wrap(() =>
          dish.orgId
            ? client.kitchen.finalizeDish(dish.orgId, dish.id, { idempotencyKey })
            : client.kitchen.finalizeMyDish(dish.id, { idempotencyKey }),
        );
        const out = settle(dish, r);
        if (out.ok) refreshMoney(qc, out.dish, false);
        return out;
      },
      /** A finalized dish's shares, corrected: a reversal and a new dish transaction. */
      correct: async (dish: KitchenDish, shares: readonly ShareDraft[], note: string, idempotencyKey: string) => {
        const body = note.trim() ? { shares: shareRequests(shares), note: note.trim() } : { shares: shareRequests(shares) };
        const out = settle(dish, await wrap(() => client.kitchen.correctDish(dish.orgId ?? "", dish.id, body, { idempotencyKey })));
        if (out.ok) refreshMoney(qc, out.dish, false);
        return out;
      },
      /** The cook cancels a draft or open dish: every ingredient goes back, its charges are reversed. */
      cancel: async (dish: KitchenDish, idempotencyKey: string) => {
        const out = settle(dish, await wrap(() => client.kitchen.cancelDish(dish.id, { idempotencyKey })));
        if (out.ok) refreshMoney(qc, out.dish, true);
        return out;
      },
    };
  }, [client, qc]);
}

/**
 * The viewer's own claim on an open dish, one tap at a time: `set(half)`
 * shows it at once (the engine previews what it costs), sends it when the
 * taps settle (or at once with `now`), and offers Undo, which sets it back.
 * A claim waiting to be sent is sent when the screen goes away.
 */
export function useClaimer(dish: KitchenDish, meId: string | null, names: MemberNames) {
  const writes = useDishWrites();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = React.useRef(false);
  const want = React.useRef<number | null>(null);
  // What the screen shows, as of the latest tap (state lags a render behind).
  const shown = React.useRef<number | null>(null);
  const base = React.useRef(dish.myClaimHalf);
  const latest = React.useRef({ dish, meId, names });
  React.useEffect(() => {
    latest.current = { dish, meId, names };
  }, [dish, meId, names]);

  const undo = React.useCallback(
    async (answer: KitchenDish, back: number) => {
      const { meId: me, names: known } = latest.current;
      const r = await writes.claim(answer, back);
      if (r.ok) {
        toast({ kind: "success", title: "Undone", description: back === 0 ? "Your claim is taken back." : `You're back to ${portionsText(back)}.` });
      } else {
        toast({ kind: "error", title: "Couldn't undo it", description: claimRefusal(r.error, { dish: answer, meId: me, names: known }) });
      }
    },
    [writes, toast],
  );

  const send = React.useCallback(
    async (half: number) => {
      timer.current = null;
      want.current = null;
      const { dish: current, meId: me, names: known } = latest.current;
      const before = base.current;
      if (!me || !current.orgId || half === before) {
        shown.current = null;
        setPending(null);
        return;
      }
      inflight.current = true;
      setBusy(true);
      const r = await writes.claim(current, half);
      inflight.current = false;
      setBusy(false);
      // A tap made while this was on its way waits for its own send.
      if (want.current === null) {
        shown.current = null;
        setPending(null);
      }
      if (!r.ok) {
        setError(claimRefusal(r.error, { dish: current, meId: me, names: known }));
        return;
      }
      base.current = half;
      const text = claimedToast({ dish: r.dish, meId: me, names: known, half });
      toast({
        kind: "success",
        title: text.title,
        description: text.description,
        duration: UNDO_MS,
        action: { label: "Undo", onClick: () => void undo(r.dish, before) },
      });
    },
    [writes, toast, undo],
  );

  const set = React.useCallback(
    (half: number, opts: { now?: boolean } = {}) => {
      if (!latest.current.meId) return;
      // A new burst of taps starts from what the server has.
      if (timer.current === null && !inflight.current) base.current = latest.current.dish.myClaimHalf;
      if (timer.current) clearTimeout(timer.current);
      setError(null);
      setPending(half);
      shown.current = half;
      want.current = half;
      timer.current = setTimeout(() => void send(half), opts.now ? 0 : CLAIM_SETTLE_MS);
    },
    [send],
  );

  // Leaving the screen sends a claim still waiting for the taps to settle.
  React.useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (want.current !== null) void send(want.current);
      }
    },
    [send],
  );

  /** Half a portion more or less than the latest tap, between none and `max`. */
  const step = React.useCallback(
    (delta: 1 | -1, max: number) => {
      const from = shown.current ?? latest.current.dish.myClaimHalf;
      set(Math.max(0, Math.min(max, from + delta)));
    },
    [set],
  );

  return { half: pending ?? dish.myClaimHalf, pending: pending !== null, busy, error, set, step, clearError: () => setError(null) };
}

export type DishBusy = null | "shares" | "finalize" | "correct" | "cancel";

/**
 * The cook's (or an owner's or admin's) writes on the dish page, with their
 * toasts: save everyone's shares (Undo sets them back), finalize (a toast
 * with "Correct it"), correct, and cancel. Each POST keeps its idempotency
 * key until the server answers, and takes a new one after a refusal.
 */
export function useDishActions(input: {
  dish: KitchenDish;
  meId: string | null;
  names: MemberNames;
  groupName: string | null;
  /** "Correct it" on the finalize toast; by default it opens the dish page in correct mode. */
  onCorrect?: () => void;
}) {
  const { dish, meId, names, groupName, onCorrect } = input;
  const writes = useDishWrites();
  const { toast } = useToast();
  const router = useRouter();
  const keys = React.useRef({ finalize: crypto.randomUUID(), correct: crypto.randomUUID(), cancel: crypto.randomUUID() });
  const [busy, setBusy] = React.useState<DishBusy>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refusal = (r: Extract<DishWrite, { ok: false }>) => splitRefusal(r.error, { dish, meId, names });

  const undoShares = React.useCallback(
    async (answer: KitchenDish, back: readonly ShareDraft[]) => {
      const r = await writes.setShares(answer, back);
      if (r.ok) toast({ kind: "success", title: "Undone", description: "Everyone's share is back as it was." });
      else toast({ kind: "error", title: "Couldn't undo it", description: splitRefusal(r.error, { dish: answer, meId, names }) });
    },
    [writes, toast, meId, names],
  );

  /** Save the shares on screen; false when refused (the message is in `error`). */
  const saveShares = async (shares: readonly ShareDraft[], opts: { toast?: boolean } = {}): Promise<KitchenDish | null> => {
    setBusy("shares");
    setError(null);
    const before = sharesOf(dish);
    const r = await writes.setShares(dish, shares);
    setBusy(null);
    if (!r.ok) {
      setError(refusal(r));
      return null;
    }
    if (opts.toast ?? true) {
      toast({
        kind: "success",
        title: "Saved who had what",
        description: r.dish.state === "open" ? "Members can still change their own claims until you finalize." : "Finalize when it's right.",
        duration: UNDO_MS,
        action: { label: "Undo", onClick: () => void undoShares(r.dish, before) },
      });
    }
    return r.dish;
  };

  /** Finalize; with `shares`, save them first (the cook's unsaved edit). */
  const finalize = async (shares?: readonly ShareDraft[]): Promise<boolean> => {
    let current = dish;
    if (shares) {
      const saved = await saveShares(shares, { toast: false });
      if (!saved) return false;
      current = saved;
    }
    setBusy("finalize");
    setError(null);
    const r = await writes.finalize(current, keys.current.finalize);
    setBusy(null);
    if (!r.ok) {
      if (answered(r)) keys.current.finalize = crypto.randomUUID();
      setError(refusal(r));
      return false;
    }
    keys.current.finalize = crypto.randomUUID();
    const text = finalizedToast({ dish: r.dish, meId, names, groupName });
    toast({
      kind: "success",
      title: text.title,
      description: text.description,
      duration: UNDO_MS,
      action: r.dish.orgId
        ? { label: "Correct it", onClick: onCorrect ?? (() => router.push(`${dishHref(r.dish.id)}?correct=1`)) }
        : undefined,
    });
    return true;
  };

  const correct = async (shares: readonly ShareDraft[], note: string): Promise<boolean> => {
    setBusy("correct");
    setError(null);
    const r = await writes.correct(dish, shares, note, keys.current.correct);
    setBusy(null);
    if (!r.ok) {
      if (answered(r)) keys.current.correct = crypto.randomUUID();
      setError(refusal(r));
      return false;
    }
    keys.current.correct = crypto.randomUUID();
    toast({
      kind: "success",
      title: `Corrected ${r.dish.name}`,
      description: "The old split was reversed and the new one posted. Nothing was overwritten.",
    });
    return true;
  };

  const cancel = async (): Promise<boolean> => {
    setBusy("cancel");
    setError(null);
    const r = await writes.cancel(dish, keys.current.cancel);
    setBusy(null);
    if (!r.ok) {
      if (answered(r)) keys.current.cancel = crypto.randomUUID();
      setError(refusal(r));
      return false;
    }
    keys.current.cancel = crypto.randomUUID();
    toast({
      kind: "success",
      title: `Canceled ${r.dish.name}`,
      description: "Every ingredient is back in its pantry, and what cooking charged was reversed.",
    });
    return true;
  };

  return { busy, error, setError, saveShares, finalize, correct, cancel };
}
