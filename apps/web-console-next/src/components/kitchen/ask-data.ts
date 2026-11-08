"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApproveAskRequest, AskSource, AsksResponse, KitchenAsk, KitchenItem, KitchenMeasure } from "@saas/contracts/kitchen";
import { measureLabel } from "@saas/contracts/kitchen";
import { fromMilli } from "@saas/kitchen-engine/units";
import { wrap, type ApiResult } from "@/lib/api";
import { applyPatches, pendingId } from "@/lib/optimistic";
import { useApiQuery, qk } from "@/lib/query";
import { useSession } from "@/lib/session";
import { newFrame } from "@/lib/features";
import { useToast } from "@/components/ui/toast";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { REFUSAL_MS, refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { refreshPantry, useLogUse } from "./pantry-data";
import { countedWords } from "./measures";
import { amountText } from "./item-use";
import type { ItemRef } from "./pantry";
import type { MemberNames } from "./members";
import {
  askItemPatches,
  askRefusal,
  askRequest,
  askSavedText,
  askSettingBody,
  askSettingRefusal,
  askedText,
  asksPatch,
  pendingAsk,
  withAskChanged,
  withMineAsk,
  type AskDraft,
} from "./ask-before-use";
import type { AskUndo } from "./ask-card";
import { cookAskRequest, lineAskOf, lineAskTake, syncLineAsks, withLineAsk, type CookSession, type SessionLineAsk } from "./cook-session";

/**
 * Ask before use's reads and writes (cookpool-pantry PN-9, design §8),
 * through PN-8's SDK: the caller's asks (`asks()`, read again every 20 s
 * while one waits), asking (at once, with Undo — which cancels it), Cancel,
 * the buyer's answers and their Undo, Who can use it's Save (at once, with
 * Undo), and a cook session's line. In the new frame only.
 */

/** While one of your asks waits, it is read again this often (the answer comes as a push to the buyer, not to you). */
export const ASKS_POLL_MS = 20_000;

/** The asks you answer and your own from the last day; read only in the new frame. */
export function useAsks(enabled: boolean = newFrame()) {
  const { client } = useSession();
  const qc = useQueryClient();
  const asks = useApiQuery<AsksResponse>(qk.kitchenAsks(), () => wrap(() => client.kitchen.asks()), { enabled });
  const waitingKey = (asks.data?.mine ?? []).filter((a) => a.state === "pending").map((a) => a.id).join(",");
  // An answer to one of yours moved stock: read the pantry again when one stops waiting.
  const seen = React.useRef<string>("");
  React.useEffect(() => {
    const before = seen.current ? seen.current.split(",") : [];
    seen.current = waitingKey;
    const now = new Set(waitingKey ? waitingKey.split(",") : []);
    if (before.some((id) => !id.startsWith("pending_") && !now.has(id))) refreshPantry(qc, null);
  }, [waitingKey, qc]);
  React.useEffect(() => {
    if (!enabled || !waitingKey) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void qc.invalidateQueries({ queryKey: qk.kitchenAsks(), exact: true });
    }, ASKS_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, waitingKey, qc]);
  return asks;
}

export interface AskToUseInput {
  ref: ItemRef & { kind: "group" };
  item: KitchenItem;
  qtyMilli: number;
  consumers: readonly string[];
  idempotencyKey: string;
  /** The amount in words ("1 pinch"); the amount itself by default. */
  what?: string;
  /** Given in one of the item's measures (as a use takes it); null for the unit. */
  measure?: { measure: KitchenMeasure; quantity: number } | null;
  source?: AskSource;
  meId: string | null;
  names?: MemberNames | null;
  /** Who is asked, in words ("Meera"). */
  who: string;
}

export type AskToUseResult = { ok: true; ask: KitchenAsk | null; logged: boolean } | { ok: false; message: string };

/**
 * Ask to use some (design §8.2): your row reads "Asked Meera · 1 pinch ·
 * waiting" at once and the toast says so, with Undo (which cancels the ask).
 * Nothing comes off the stock. When the server says you needn't ask
 * (`no_need`: you were let in meanwhile, or the setting is off) it is logged
 * as a use instead; a refusal puts the row back and says why.
 */
export function useAskToUse() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const logUse = useLogUse();
  return React.useCallback(
    (input: AskToUseInput): Promise<AskToUseResult> => {
      const { ref, item, qtyMilli, meId } = input;
      const counted = input.measure !== undefined ? input.measure : countedWords(item, input.what, qtyMilli);
      const body = askRequest(item, qtyMilli, input.consumers, counted, input.source ?? "pantry");
      const label = counted ? measureLabel(counted.quantity, counted.measure) : null;
      const amount = label ?? input.what ?? amountText(qtyMilli, item);
      const shown = meId
        ? pendingAsk({
            item,
            qtyMilli,
            quantity: counted ? fromMilli(qtyMilli, item.displayUnit) : Number(body.quantity),
            unit: counted ? item.displayUnit : (body.unit ?? item.displayUnit),
            label,
            amount,
            consumers: input.consumers,
            meId,
            answererName: input.who,
            source: input.source ?? "pantry",
            at: new Date(),
          })
        : null;
      const write = beginWrite(qc, shown ? [asksPatch((r) => withMineAsk(r, shown))] : []);
      const sent = write.track(wrap(() => client.kitchen.askToUse(ref.orgId, ref.itemId, body, { idempotencyKey: input.idempotencyKey })));
      const words = askedText({ who: input.who, what: amount });
      let serverId: string | null = null;
      let undone = false;
      const toast = offer({
        title: words.title,
        description: words.description,
        // Pressed before the server answered: it is cancelled once it has, if it was asked at all.
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await write.track(wrap(() => client.kitchen.cancelAsk(ref.orgId, r.data.ask.id, { idempotencyKey: crypto.randomUUID() })));
          void qc.invalidateQueries({ queryKey: qk.kitchenAsks(), exact: true });
          if (u.ok) return { ok: true, description: "Ask cancelled." };
          if (u.error.reason === "not_pending") return { ok: false, kind: "warning", title: "Already answered" };
          return { ok: false, kind: "error", title: "Couldn't cancel it", description: u.error.message };
        },
        restore: () => {
          undone = true;
          write.restore([asksPatch((r) => ({ ...r, mine: r.mine.filter((a) => a.id !== shown?.id && a.id !== serverId) }))]);
        },
      });
      return sent.then(async (r): Promise<AskToUseResult> => {
        if (!r.ok) {
          write.rollback();
          if (r.error.reason === "no_need") {
            // You needn't ask (any more): it is a use, logged as one.
            toast.close();
            applyPatches(queryCacheOf(qc), askItemPatches(item.id, { mustAsk: false }));
            const used = await logUse({
              ref,
              item: { ...item, mustAsk: false },
              qtyMilli,
              consumers: input.consumers,
              idempotencyKey: crypto.randomUUID(),
              ...(input.what !== undefined ? { what: input.what } : {}),
              measure: counted,
              meId,
              names: input.names ?? null,
            });
            return used.ok ? { ok: true, ask: null, logged: true } : { ok: false, message: used.message };
          }
          refreshPantry(qc, null);
          const message = askRefusal(r.error, { what: (m) => amountText(m, item), qtyLeftMilli: item.qtyLeftMilli });
          toast.refuse(refusedToast(`Couldn't ask for ${item.name}`, message));
          return { ok: false, message };
        }
        serverId = r.data.ask.id;
        if (!undone) applyPatches(queryCacheOf(qc), [asksPatch((res) => withMineAsk(res, r.data.ask, shown?.id))]);
        void qc.invalidateQueries({ queryKey: qk.kitchenAsks(), exact: true });
        return { ok: true, ask: r.data.ask, logged: false };
      });
    },
    [client, qc, offer, logUse],
  );
}

/** Cancel an ask that waits (the asker's): it reads as gone at once; a refusal puts it back. */
export function useCancelAsk() {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast, update } = useToast();
  return React.useCallback(
    (ask: Pick<KitchenAsk, "id" | "orgId">): Promise<ApiResult<unknown>> => {
      const write = beginWrite(qc, [asksPatch((r) => withAskChanged(r, ask.id, { state: "canceled", answeredAt: new Date().toISOString() }))]);
      const sent = write.track(wrap(() => client.kitchen.cancelAsk(ask.orgId, ask.id, { idempotencyKey: crypto.randomUUID() })));
      const id = toast({ kind: "success", title: "Ask cancelled" });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          const why = r.error.reason === "not_pending" ? "It was already answered." : r.error.reason === "lapsed" ? "It already lapsed." : r.error.message;
          update(id, { ...refusedToast("Couldn't cancel it", why), duration: REFUSAL_MS });
        }
        void qc.invalidateQueries({ queryKey: qk.kitchenAsks(), exact: true });
        return r;
      });
    },
    [client, qc, toast, update],
  );
}

/**
 * The buyer's answers (design §8.3): Approve (the use, as the asker would
 * have logged it, with Always let and what's left), Decline, and their Undo
 * — reversing the approved use's transaction (or its move), or reopening a
 * declined ask. Each reads the pantry, Home and the group's ledger again.
 */
export function useAnswerAsk() {
  const { client } = useSession();
  const qc = useQueryClient();
  return React.useMemo(() => {
    const key = () => ({ idempotencyKey: crypto.randomUUID() });
    const after = <T,>(orgId: string) => (r: ApiResult<T>): ApiResult<T> => {
      refreshPantry(qc, orgId);
      return r;
    };
    return {
      approve: (ask: Pick<KitchenAsk, "id" | "orgId">, body: ApproveAskRequest) =>
        wrap(() => client.kitchen.approveAsk(ask.orgId, ask.id, body, key())).then(after(ask.orgId)),
      decline: (ask: Pick<KitchenAsk, "id" | "orgId">) => wrap(() => client.kitchen.declineAsk(ask.orgId, ask.id, key())).then(after(ask.orgId)),
      undo: (u: AskUndo): Promise<ApiResult<unknown>> => {
        const sent: Promise<ApiResult<unknown>> =
          u.kind === "txn"
            ? wrap(() => client.kitchen.reverseTxn(u.orgId, u.txnId, {}, key()))
            : u.kind === "move"
              ? wrap(() => client.kitchen.undoGroupMove(u.orgId, u.moveId, key()))
              : wrap(() => client.kitchen.reopenAsk(u.orgId, u.askId, key()));
        return sent.then(after(u.orgId));
      },
    };
  }, [client, qc]);
}

/**
 * Who can use it's Save (design §8.1): every read of the item shows the
 * setting at once, the toast says "Saved · others ask you first" with Undo
 * (which puts the old setting back), and a refusal puts it back and says why.
 * Null when there was nothing to save.
 */
export function useSaveAskSetting() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: { item: KitchenItem; draft: AskDraft; roster: readonly string[] | null; meId: string | null }) => {
      const { item, draft } = input;
      if (item.pantry.kind !== "group") return null;
      const orgId = item.pantry.orgId;
      const body = askSettingBody(draft, item, input);
      if (!body) return null;
      const before = { askFirst: item.askFirst ?? false, allowed: item.allowed ?? [] };
      const write = beginWrite(qc, askItemPatches(item.id, { askFirst: body.askFirst, ...(body.allowed ? { allowed: body.allowed } : {}) }));
      const send = (b: typeof body) => wrap(() => client.kitchen.updateGroupItem(orgId, item.id, b));
      const sent = write.track(send(body));
      const refresh = () => void qc.invalidateQueries({ queryKey: qk.kitchenPantry() });
      let undone = false;
      const toast = offer({
        title: askSavedText(draft),
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true };
          const u = await write.track(send({ askFirst: before.askFirst, allowed: before.allowed }));
          refresh();
          return u.ok ? { ok: true } : { ok: false, kind: "error", title: "Couldn't undo it", description: askSettingRefusal(u.error) };
        },
        restore: () => {
          undone = true;
          write.restore(askItemPatches(item.id, before));
        },
      });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          refresh();
          toast.refuse(refusedToast(`Couldn't save who uses ${item.name}`, askSettingRefusal(r.error)));
          return r;
        }
        if (undone) return r;
        const saved = r.data.item;
        applyPatches(
          queryCacheOf(qc),
          askItemPatches(item.id, { askFirst: saved.askFirst ?? false, allowed: saved.allowed ?? [], mustAsk: saved.mustAsk ?? false, answerer: saved.answerer ?? null, version: saved.version, updatedAt: saved.updatedAt }),
        );
        refresh();
        return r;
      });
    },
    [client, qc, offer],
  );
}

// ── A cook session's line (design §8.4) ───────────────────────────

/**
 * Ask from a cook session's line: what it takes from the item, for the
 * cook, `source: "cook"`. The line reads "Asked Meera · waiting" at once
 * (kept in the draft) and stays out of the dish; the toast's Undo cancels it.
 * `no_need` puts the line back to a tick once the item is read again.
 */
export function useCookAsk(meId: string, save: (change: (s: CookSession) => CookSession) => void) {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  const { toast } = useToast();
  return React.useCallback(
    (session: CookSession, key: string, who: string): void => {
      const line = session.lines.find((l) => l.key === key);
      const req = line ? cookAskRequest(line, meId) : null;
      const item = line ? lineAskTake(line)?.take.item : null;
      if (!line || !req || !item) return;
      const pending: SessionLineAsk = {
        id: pendingId("ask"),
        orgId: req.orgId,
        itemId: req.itemId,
        amount: req.amount,
        answerer: item.answerer ?? null,
        answererName: null,
        state: "pending",
        expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        answeredBy: null,
      };
      const stillPending = (s: CookSession) => s.lines.find((l) => l.key === key)?.ask?.id === pending.id;
      save((s) => withLineAsk(s, key, pending));
      const sent = wrap(() => client.kitchen.askToUse(req.orgId, req.itemId, req.body, { idempotencyKey: crypto.randomUUID() }));
      const words = askedText({ who, what: `${req.amount} of ${line.name.toLowerCase()}` });
      const handle = offer({
        title: words.title,
        description: words.description,
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          save((s) => (s.lines.find((l) => l.key === key)?.ask ? withLineAsk(s, key, null) : s));
          if (!r.ok) return { ok: true };
          const u = await wrap(() => client.kitchen.cancelAsk(req.orgId, r.data.ask.id, { idempotencyKey: crypto.randomUUID() }));
          void qc.invalidateQueries({ queryKey: qk.kitchenAsks(), exact: true });
          return u.ok ? { ok: true, description: "Ask cancelled." } : { ok: false, kind: "error", title: "Couldn't cancel it", description: u.error.message };
        },
      });
      void sent.then((r) => {
        if (!r.ok) {
          save((s) => (stillPending(s) ? withLineAsk(s, key, null) : s));
          refreshPantry(qc, null);
          if (r.error.reason === "no_need") {
            handle.close();
            toast({ kind: "success", title: `No need to ask · tick ${line.name}` });
            return;
          }
          handle.refuse(refusedToast(`Couldn't ask for ${line.name}`, askRefusal(r.error, { what: (m) => amountText(m, item), qtyLeftMilli: item.qtyLeftMilli })));
          return;
        }
        save((s) => (stillPending(s) ? withLineAsk(s, key, lineAskOf(r.data.ask)) : s));
        applyPatches(queryCacheOf(qc), [asksPatch((res) => withMineAsk(res, r.data.ask))]);
        void qc.invalidateQueries({ queryKey: qk.kitchenAsks(), exact: true });
      });
    },
    [client, qc, offer, toast, meId, save],
  );
}

/** Keep a session's asks as the server has them (while any line asks): each answer reaches its line. */
export function useSessionAsks(session: CookSession, save: (change: (s: CookSession) => CookSession) => void): void {
  const asking = session.lines.some((l) => l.ask || lineAskTake(l));
  const asks = useAsks(asking && newFrame());
  const mine = asks.data?.mine ?? null;
  React.useEffect(() => {
    if (mine) save((s) => syncLineAsks(s, mine, new Date()));
  }, [mine, save]);
}

/** Now, looked at again every minute (an ask's "lapses in 23 h"). */
export function useMinuteNow(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
