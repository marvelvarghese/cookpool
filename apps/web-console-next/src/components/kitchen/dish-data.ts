"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DishesPage, KitchenDish } from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { afterWrites, qk, type AsyncState } from "@/lib/query";
import { useToast } from "@/components/ui/toast";
import { refreshLedger } from "./ledger-data";
import { REFUSAL_MS, UNDO_MS, refusedToast, type UndoResult } from "./undo";
import { useUndoToast, type UndoToastHandle } from "./undo-toast";
import { finalizePatches, portionPatches, type PortionChange } from "./cache-patches";
import { beginWrite, type OptimisticWrite } from "./optimistic-data";
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

/** Read one dish (its page's read; Home reads it ahead, SM-5). */
export function loadDish(client: ReturnType<typeof useSession>["client"], dishId: string): Promise<KitchenDish> {
  return unwrap(async () => (await client.kitchen.getDish(dishId)).dish);
}

/** One dish, by its `dsh_…` id: its cook, or any member of its group, may read it. */
export function useDish(dishId: string | null): AsyncState<KitchenDish> {
  const { client } = useSession();
  const qc = useQueryClient();
  const q = useQuery<KitchenDish, ApiErrorBody>({
    queryKey: qk.kitchenDish(dishId ?? ""),
    queryFn: afterWrites(qc, qk.kitchenDish(dishId ?? ""), () => loadDish(client, dishId ?? "")),
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
  const qc = useQueryClient();
  return useInfiniteQuery<DishesPage, ApiErrorBody>({
    queryKey: qk.kitchenGroupDishes(orgId),
    queryFn: ({ pageParam }) =>
      afterWrites(qc, qk.kitchenGroupDishes(orgId), () =>
        unwrap(() =>
          client.kitchen.groupDishes(
            orgId,
            typeof pageParam === "string" ? { cursor: pageParam, limit: GROUP_DISHES_PAGE } : { limit: GROUP_DISHES_PAGE },
          ),
        ),
      )(),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Put a write's answer in the dish's cache entry and refresh every other dish read, and Home's inbox (CP-23). */
function putDish(qc: QueryClient, dish: KitchenDish): void {
  qc.setQueryData(qk.kitchenDish(dish.id), dish);
  void qc.invalidateQueries({
    queryKey: qk.kitchenDishes(),
    predicate: (q) => !(q.queryKey[1] === "dish" && q.queryKey[2] === dish.id),
  });
  void qc.invalidateQueries({ queryKey: qk.kitchenInbox() });
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

/** One burst of taps on a claim: what the server had before it, the patch on screen, its toast. */
interface ClaimBurst {
  /** The half portions before the first tap (what Undo goes back to). */
  base: number;
  /** What the latest tap set. */
  latest: number;
  write: OptimisticWrite;
  toast: UndoToastHandle | null;
  /** The last claim sent for it, on its way or answered. */
  request: Promise<DishWrite> | null;
  /** Undo was pressed. */
  undone: boolean;
}

/** The change a claim makes to the caller's own portion (`withPortion`; SM-7 passes someone else's `subjectId`). */
export function ownPortion(dishId: string, meId: string, half: number): PortionChange {
  return { dishId, subjectId: meId, half, setBy: meId, meId, at: new Date().toISOString() };
}

/**
 * The viewer's own claim on an open dish, one tap at a time: `set(half)`
 * shows it at once wherever the dish is cached — the dish page, its group's
 * Dishes tab, Home's card ("2 of 5 portions left") — through `portionPatches`,
 * and opens the one Undo toast at once (Cookpool SM-5). The claim is sent
 * when the taps settle (or at once with `now`); a refusal puts the dish back
 * exactly and the toast says why. Undo sets it back to what it was before the
 * taps, at once, and sends that once the claim on its way has landed. A claim
 * waiting to be sent is sent when the screen goes away.
 */
export function useClaimer(dish: KitchenDish, meId: string | null, names: MemberNames) {
  const writes = useDishWrites();
  const qc = useQueryClient();
  const offerUndo = useUndoToast();
  const [pending, setPending] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const burst = React.useRef<ClaimBurst | null>(null);
  // What the screen shows, as of the latest tap (state lags a render behind).
  const shown = React.useRef<number | null>(null);
  const latest = React.useRef({ dish, meId, names });
  React.useEffect(() => {
    latest.current = { dish, meId, names };
  }, [dish, meId, names]);

  const finish = React.useCallback((b: ClaimBurst) => {
    if (burst.current === b) burst.current = null;
    shown.current = null;
    setPending(null);
  }, []);

  const send = React.useCallback(
    async (b: ClaimBurst) => {
      timer.current = null;
      if (b.undone) return;
      const { dish: current, meId: me, names: known } = latest.current;
      const half = b.latest;
      if (!me || !current.orgId || (half === b.base && b.request === null)) {
        // Back where it started before anything was sent: nothing to write.
        b.write.rollback();
        b.toast?.close();
        finish(b);
        return;
      }
      setBusy(true);
      const request = b.write.track(writes.claim(current, half));
      b.request = request;
      const r = await request;
      setBusy(false);
      if (b.undone) {
        // Undo showed the claim as it was; keep it so over the answer until the undo lands.
        if (r.ok) b.write.patch(portionPatches(ownPortion(current.id, me, b.base), half));
        return;
      }
      if (b.latest !== half) {
        // A tap made while this was on its way waits for its own send: keep it on screen over the answer.
        if (r.ok) b.write.patch(portionPatches(ownPortion(current.id, me, b.latest), half));
        return;
      }
      if (!r.ok) {
        b.write.rollback();
        b.toast?.refuse(refusedToast(half === 0 ? "Couldn't take your claim back" : `Couldn't claim ${current.name}`, claimRefusal(r.error, { dish: current, meId: me, names: known })));
        finish(b);
        return;
      }
      b.toast?.update(claimedToast({ dish: r.dish, meId: me, names: known, half }));
      finish(b);
    },
    [writes, finish],
  );

  /** Undo, pressed: the claim as it was before the taps, at once. */
  const restore = React.useCallback(
    (b: ClaimBurst) => {
      b.undone = true;
      const me = latest.current.meId;
      if (burst.current === b && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (b.request === null) b.write.rollback();
      else if (me) b.write.patch(portionPatches(ownPortion(latest.current.dish.id, me, b.base), b.latest));
      b.latest = b.base;
      finish(b);
    },
    [finish],
  );

  /** …and on the server: once the claim on its way has landed, set it back (claims are PUTs: no reversal to post). */
  const undo = React.useCallback(
    async (b: ClaimBurst): Promise<UndoResult> => {
      const back = b.base;
      const said = back === 0 ? "Your claim is taken back." : `You're back to ${portionsText(back)}.`;
      if (b.request === null) return { ok: true, description: said };
      const sent = await b.request;
      // Refused: nothing was written, and the screen already shows what the server has.
      if (!sent.ok) return { ok: true, description: said };
      const { meId: me, names: known } = latest.current;
      const r = await b.write.track(writes.claim(sent.dish, back));
      if (r.ok) return { ok: true, description: said };
      void qc.invalidateQueries({ queryKey: qk.kitchenDish(sent.dish.id) });
      return { ok: false, title: "Couldn't undo it", description: claimRefusal(r.error, { dish: sent.dish, meId: me, names: known }) };
    },
    [writes, qc],
  );

  const set = React.useCallback(
    (half: number, opts: { now?: boolean } = {}) => {
      const { dish: current, meId: me, names: known } = latest.current;
      if (!me) return;
      let b = burst.current;
      if (!b) {
        // A new burst of taps starts from what the cache has.
        const from = qc.getQueryData<KitchenDish>(qk.kitchenDish(current.id))?.myClaimHalf ?? current.myClaimHalf;
        b = { base: from, latest: from, write: beginWrite(qc, []), toast: null, request: null, undone: false };
        burst.current = b;
      }
      const mine = b;
      if (half !== mine.latest) mine.write.patch(portionPatches(ownPortion(current.id, me, half), mine.latest));
      mine.latest = half;
      shown.current = half;
      setPending(half);
      const text = claimedToast({ dish: current, meId: me, names: known, half });
      if (half === mine.base && mine.request === null) {
        // Back where it started (or "None" on a dish not claimed): nothing to say or undo.
        mine.toast?.close();
        mine.toast = null;
      } else if (!mine.toast) {
        mine.toast = offerUndo({ title: text.title, description: text.description, undo: () => undo(mine), restore: () => restore(mine) });
      } else {
        mine.toast.update({ title: text.title, description: text.description });
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void send(mine), opts.now ? 0 : CLAIM_SETTLE_MS);
    },
    [qc, offerUndo, undo, restore, send],
  );

  // Leaving the screen sends a claim still waiting for the taps to settle.
  React.useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        const b = burst.current;
        if (b) void send(b);
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

  return { half: pending ?? dish.myClaimHalf, pending: pending !== null, busy, set, step };
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
  const offerUndo = useUndoToast();
  const router = useRouter();
  const qc = useQueryClient();
  const { update } = useToast();
  const keys = React.useRef({ finalize: crypto.randomUUID(), correct: crypto.randomUUID(), cancel: crypto.randomUUID() });
  const [busy, setBusy] = React.useState<DishBusy>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refusal = (r: Extract<DishWrite, { ok: false }>) => splitRefusal(r.error, { dish, meId, names });

  const undoShares = React.useCallback(
    async (answer: KitchenDish, back: readonly ShareDraft[]): Promise<UndoResult> => {
      const r = await writes.setShares(answer, back);
      if (r.ok) return { ok: true, description: "Everyone's share is back as it was." };
      return { ok: false, title: "Couldn't undo it", description: splitRefusal(r.error, { dish: answer, meId, names }) };
    },
    [writes, meId, names],
  );

  /**
   * Undo a correction (CP-23): correct it back to the shares it had — the
   * same write, so it reverses the correction's transaction and posts the
   * earlier split again. Nothing is overwritten.
   */
  const undoCorrection = React.useCallback(
    async (answer: KitchenDish, back: readonly ShareDraft[]): Promise<UndoResult> => {
      const r = await writes.correct(answer, back, "Undid a correction", crypto.randomUUID());
      if (r.ok) return { ok: true, description: "The split is back as it was. The correction stays in the history, reversed." };
      return { ok: false, title: "Couldn't undo it", description: splitRefusal(r.error, { dish: answer, meId, names }) };
    },
    [writes, meId, names],
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
      offerUndo({
        title: "Saved who had what",
        description: r.dish.state === "open" ? "Members can still change their own claims until you finalize." : "Finalize when it's right.",
        undo: () => undoShares(r.dish, before),
      });
    }
    return r.dish;
  };

  /**
   * Finalize; with `shares`, save them first (the cook's unsaved edit, which
   * waits for the server). Finalizing itself shows at once (SM-5): the dish
   * reads finalized wherever it is cached and Home's card goes, and the toast
   * (with "Correct it") is up before the server answers; what it posted —
   * who owes what — is the server's, in the toast once it answers. A refusal
   * puts the dish back and the toast says why.
   */
  const finalize = async (shares?: readonly ShareDraft[]): Promise<boolean> => {
    let current = dish;
    if (shares) {
      const saved = await saveShares(shares, { toast: false });
      if (!saved) return false;
      current = saved;
    }
    setError(null);
    const write = beginWrite(qc, finalizePatches(current.id, new Date().toISOString()));
    const shown = finalizedToast({ dish: current, meId, names, groupName });
    const id = toast({
      kind: "success",
      title: shown.title,
      duration: UNDO_MS,
      action: current.orgId
        ? { label: "Correct it", onClick: onCorrect ?? (() => router.push(`${dishHref(current.id)}?correct=1`)) }
        : undefined,
    });
    const r = await write.track(writes.finalize(current, keys.current.finalize));
    if (!r.ok) {
      if (answered(r)) keys.current.finalize = crypto.randomUUID();
      write.rollback();
      update(id, { ...refusedToast(`Couldn't finalize ${current.name}`, refusal(r)), action: undefined, duration: REFUSAL_MS });
      return false;
    }
    keys.current.finalize = crypto.randomUUID();
    const text = finalizedToast({ dish: r.dish, meId, names, groupName });
    update(id, { title: text.title, description: text.description });
    return true;
  };

  const correct = async (shares: readonly ShareDraft[], note: string): Promise<boolean> => {
    setBusy("correct");
    setError(null);
    const before = sharesOf(dish);
    const r = await writes.correct(dish, shares, note, keys.current.correct);
    setBusy(null);
    if (!r.ok) {
      if (answered(r)) keys.current.correct = crypto.randomUUID();
      setError(refusal(r));
      return false;
    }
    keys.current.correct = crypto.randomUUID();
    offerUndo({
      title: `Corrected ${r.dish.name}`,
      description: "The old split was reversed and the new one posted. Nothing was overwritten.",
      undo: () => undoCorrection(r.dish, before),
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
