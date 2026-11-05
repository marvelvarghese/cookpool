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
import { finalizePatches, portionChange, portionPatches } from "./cache-patches";
import { beginWrite, type OptimisticWrite } from "./optimistic-data";
import {
  claimRefusal,
  dishHref,
  finalizedToast,
  portionLabel,
  portionLimit,
  portionOf,
  portionRefusedTitle,
  portionToast,
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
      /** PUT …/claims/{subjectId} — anyone's half portions, set by the caller (SM-6/SM-7; 0 takes them back). */
      setPortion: async (dish: KitchenDish, subjectId: string, portionsHalf: number) =>
        settle(dish, await wrap(() => client.kitchen.setPortion(dish.orgId ?? "", dish.id, subjectId, { portionsHalf }))),
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

/** One burst of taps on someone's portion: what the server had before it, the patch on screen, its toast. */
interface PortionBurst {
  /** Whose portion (the caller's own claim, or — SM-7 — anyone's in the group). */
  subjectId: string;
  /** The half portions before the first tap (what Undo goes back to). */
  base: number;
  /** What the latest tap set. */
  latest: number;
  write: OptimisticWrite;
  toast: UndoToastHandle | null;
  /** The last write sent for it, on its way or answered. */
  request: Promise<DishWrite> | null;
  /** Undo was pressed. */
  undone: boolean;
}

/**
 * Everyone's portions of an open dish, one tap at a time (Cookpool SM-5;
 * anyone's since SM-7): `set(subjectId, half)` shows it at once wherever the
 * dish is cached — the dish page, its group's Dishes tab, Home's card ("2 of
 * 5 portions left") — through `portionPatches`, the share reading as set by
 * you, and opens the Undo toast at once. Each person's taps are a burst of
 * their own, sent when they settle (or at once with `now`): yours on
 * `…/claims/me`, anyone else's on `…/claims/{subjectId}`. A refusal puts the
 * dish back exactly and the toast says why. Undo sets it back to what it was
 * before the taps, at once, and sends that once the write on its way has
 * landed. One toast at a time: stepping another person closes the last
 * one's (its write still goes; a refusal still says so). A write waiting to
 * be sent is sent when the screen goes away.
 */
export function usePortions(dish: KitchenDish, meId: string | null, names: MemberNames) {
  const writes = useDishWrites();
  const qc = useQueryClient();
  const offerUndo = useUndoToast();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<ReadonlyMap<string, number>>(() => new Map());
  const [inFlight, setInFlight] = React.useState(0);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const bursts = React.useRef(new Map<string, PortionBurst>());
  // What the screen shows, as of the latest tap (state lags a render behind).
  const shown = React.useRef(new Map<string, number>());
  const latest = React.useRef({ dish, meId, names });
  React.useEffect(() => {
    latest.current = { dish, meId, names };
  }, [dish, meId, names]);

  const finish = React.useCallback((b: PortionBurst) => {
    if (bursts.current.get(b.subjectId) === b) bursts.current.delete(b.subjectId);
    shown.current.delete(b.subjectId);
    setPending((cur) => {
      if (!cur.has(b.subjectId)) return cur;
      const next = new Map(cur);
      next.delete(b.subjectId);
      return next;
    });
  }, []);

  const patchFor = React.useCallback((b: PortionBurst, me: string, half: number, from: number) => {
    b.write.patch(portionPatches(portionChange(latest.current.dish.id, b.subjectId, me, half, new Date().toISOString()), from));
  }, []);

  const send = React.useCallback(
    async (b: PortionBurst) => {
      timers.current.delete(b.subjectId);
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
      setInFlight((n) => n + 1);
      const request = b.write.track(b.subjectId === me ? writes.claim(current, half) : writes.setPortion(current, b.subjectId, half));
      b.request = request;
      const r = await request;
      setInFlight((n) => n - 1);
      if (b.undone) {
        // Undo showed the portion as it was; keep it so over the answer until the undo lands.
        if (r.ok) patchFor(b, me, b.base, half);
        return;
      }
      if (b.latest !== half) {
        // A tap made while this was on its way waits for its own send: keep it on screen over the answer.
        if (r.ok) patchFor(b, me, b.latest, half);
        return;
      }
      if (!r.ok) {
        b.write.rollback();
        const said = refusedToast(
          portionRefusedTitle({ dish: current, subjectId: b.subjectId, meId: me, names: known, half }),
          claimRefusal(r.error, { dish: current, meId: me, names: known, subjectId: b.subjectId }),
        );
        if (b.toast) b.toast.refuse(said);
        else toast({ ...said, duration: REFUSAL_MS });
        finish(b);
        return;
      }
      b.toast?.update(portionToast({ dish: r.dish, subjectId: b.subjectId, meId: me, names: known, half }));
      finish(b);
    },
    [writes, finish, patchFor, toast],
  );

  /** Undo, pressed: the portion as it was before the taps, at once. */
  const restore = React.useCallback(
    (b: PortionBurst) => {
      b.undone = true;
      const me = latest.current.meId;
      const timer = timers.current.get(b.subjectId);
      if (bursts.current.get(b.subjectId) === b && timer) {
        clearTimeout(timer);
        timers.current.delete(b.subjectId);
      }
      if (b.request === null) b.write.rollback();
      else if (me) patchFor(b, me, b.base, b.latest);
      b.latest = b.base;
      finish(b);
    },
    [finish, patchFor],
  );

  /** …and on the server: once the write on its way has landed, set it back (portions are PUTs: no reversal to post). */
  const undo = React.useCallback(
    async (b: PortionBurst): Promise<UndoResult> => {
      const back = b.base;
      const { meId: me0 } = latest.current;
      const said =
        b.subjectId === me0
          ? back === 0
            ? "Your claim is taken back."
            : `You're back to ${portionsText(back)}.`
          : `${portionLabel(b.subjectId, back, me0, latest.current.names)}.`;
      if (b.request === null) return { ok: true, description: said };
      const sent = await b.request;
      // Refused: nothing was written, and the screen already shows what the server has.
      if (!sent.ok) return { ok: true, description: said };
      const { meId: me, names: known } = latest.current;
      const r = await b.write.track(b.subjectId === me ? writes.claim(sent.dish, back) : writes.setPortion(sent.dish, b.subjectId, back));
      if (r.ok) return { ok: true, description: said };
      void qc.invalidateQueries({ queryKey: qk.kitchenDish(sent.dish.id) });
      return { ok: false, title: "Couldn't undo it", description: claimRefusal(r.error, { dish: sent.dish, meId: me, names: known, subjectId: b.subjectId }) };
    },
    [writes, qc],
  );

  /** What the cache (else the screen) has for `subjectId` now: yours is `myClaimHalf`. */
  const savedHalf = React.useCallback(
    (subjectId: string): number => {
      const { dish: current, meId: me } = latest.current;
      const cached = qc.getQueryData<KitchenDish>(qk.kitchenDish(current.id)) ?? current;
      return subjectId === me ? cached.myClaimHalf : portionOf(cached, subjectId);
    },
    [qc],
  );

  const set = React.useCallback(
    (subjectId: string, half: number, opts: { now?: boolean } = {}) => {
      const { dish: current, meId: me, names: known } = latest.current;
      if (!me) return;
      let b = bursts.current.get(subjectId);
      if (!b) {
        // A new burst of taps starts from what the cache has.
        const from = savedHalf(subjectId);
        b = { subjectId, base: from, latest: from, write: beginWrite(qc, []), toast: null, request: null, undone: false };
        bursts.current.set(subjectId, b);
      }
      const mine = b;
      if (half !== mine.latest) patchFor(mine, me, half, mine.latest);
      mine.latest = half;
      shown.current.set(subjectId, half);
      setPending((cur) => new Map(cur).set(subjectId, half));
      const text = portionToast({ dish: current, subjectId, meId: me, names: known, half });
      if (half === mine.base && mine.request === null) {
        // Back where it started (or "None" on a dish not claimed): nothing to say or undo.
        mine.toast?.close();
        mine.toast = null;
      } else if (!mine.toast) {
        // One toast at a time: the last person's closes (its write still goes).
        for (const other of bursts.current.values()) {
          if (other !== mine && other.toast) {
            other.toast.close();
            other.toast = null;
          }
        }
        mine.toast = offerUndo({ title: text.title, description: text.description, undo: () => undo(mine), restore: () => restore(mine) });
      } else {
        mine.toast.update({ title: text.title, description: text.description });
      }
      const timer = timers.current.get(subjectId);
      if (timer) clearTimeout(timer);
      timers.current.set(
        subjectId,
        setTimeout(() => void send(mine), opts.now ? 0 : CLAIM_SETTLE_MS),
      );
    },
    [qc, offerUndo, undo, restore, send, savedHalf, patchFor],
  );

  // Leaving the screen sends what is still waiting for the taps to settle.
  React.useEffect(() => {
    const waiting = timers.current;
    const open = bursts.current;
    return () => {
      for (const [subjectId, timer] of waiting) {
        clearTimeout(timer);
        const b = open.get(subjectId);
        if (b) void send(b);
      }
      waiting.clear();
    };
  }, [send]);

  /** What `subjectId` has on screen: the latest tap, else the dish's. */
  const halfOf = React.useCallback(
    (subjectId: string): number => pending.get(subjectId) ?? (subjectId === meId ? dish.myClaimHalf : portionOf(dish, subjectId)),
    [pending, dish, meId],
  );

  /** Half a portion more or less than the latest tap, between none and what is free for them (`portionLimit`). */
  const step = React.useCallback(
    (subjectId: string, delta: 1 | -1) => {
      const { dish: current } = latest.current;
      const cached = qc.getQueryData<KitchenDish>(qk.kitchenDish(current.id)) ?? current;
      const from = shown.current.get(subjectId) ?? savedHalf(subjectId);
      const next = Math.max(0, Math.min(portionLimit(cached, subjectId), from + delta));
      if (next !== from) set(subjectId, next);
    },
    [qc, savedHalf, set],
  );

  return {
    halfOf,
    /** The most `subjectId` may have now (a + past it is off). */
    limitOf: (subjectId: string) => portionLimit(dish, subjectId),
    /** A tap for `subjectId` is on screen and not answered yet. */
    isPending: (subjectId: string) => pending.has(subjectId),
    /** Any portion on screen is not answered yet (finalizing waits). */
    pending: pending.size > 0,
    busy: inFlight > 0,
    set,
    step,
  };
}

/**
 * The viewer's own claim, one tap at a time — `usePortions` for the caller
 * (Home's claim chips and "How much did you have?").
 */
export function useClaimer(dish: KitchenDish, meId: string | null, names: MemberNames) {
  const portions = usePortions(dish, meId, names);
  const me = meId ?? "";
  const { set: setFor, step: stepFor } = portions;
  const set = React.useCallback((half: number, opts?: { now?: boolean }) => setFor(me, half, opts), [setFor, me]);
  const step = React.useCallback((delta: 1 | -1) => stepFor(me, delta), [stepFor, me]);
  return { half: meId ? portions.halfOf(meId) : dish.myClaimHalf, pending: meId ? portions.isPending(meId) : false, busy: portions.busy, set, step };
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
      offerUndo({ title: "Saved who had what", undo: () => undoShares(r.dish, before) });
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
    update(id, { title: text.title });
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
    offerUndo({ title: `Corrected ${r.dish.name}`, undo: () => undoCorrection(r.dish, before) });
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
    toast({ kind: "success", title: `Canceled ${r.dish.name}` });
    return true;
  };

  return { busy, error, setError, saveShares, finalize, correct, cancel };
}
