"use client";

import * as React from "react";
import { useQueries, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  CreateGroupItemRequest,
  CreatePersonalItemRequest,
  KitchenItem,
  KitchenMeasure,
  KitchenMember,
  KitchenStockMove,
  KitchenUsual,
  Pantry,
  PantryRef,
  ReachableItem,
  StockMoveResponse,
} from "@saas/contracts/kitchen";
import { measureLabel } from "@saas/contracts/kitchen";
import { fromMilli } from "@saas/kitchen-engine/units";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApiQuery, afterWrites, prefetchApi, qk } from "@/lib/query";
import { applyPatches } from "@/lib/optimistic";
import { useToast } from "@/components/ui/toast";
import { refreshLedger } from "./ledger-data";
import { loadMembers } from "./people-data";
import { REFUSAL_MS, refusedToast, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { itemRefOf, itemRefParam, leftText, type ItemRef } from "./pantry";
import { amountCost, amountText, logRefusal, logRequest, loggedText } from "./item-use";
import { formatMinor } from "./money";
import { memberLabel, type MemberNames } from "./members";
import {
  itemAddedPatches,
  itemRemovedPatches,
  movesPatch,
  pendingItem,
  pendingMove,
  stockPatches,
  stockReturnPatches,
  type StockChange,
} from "./cache-patches";
import { beginWrite, queryCacheOf } from "./optimistic-data";
import { countedWords } from "./measures";
import { newFrame } from "@/lib/features";
import type { UsualBucket } from "@saas/contracts/kitchen-usuals";
import { msToNextBucket, tzOffsetOf, usualsRead } from "./now-strip";

/**
 * Cookpool's pantry reads and stock writes (CP-12), through the CP-10/CP-11
 * SDK. Every read is cached under `qk.kitchenPantry()`, so one invalidation
 * after a use, waste, move or undo refreshes every pantry, Home's strip, the
 * item and its history; a write that moved money also refreshes the group's
 * ledger and the cross-group reads (`refreshLedger`).
 */

type Client = ReturnType<typeof useSession>["client"];

/** Items are read 100 at a time, up to 1,000 per pantry choice. */
const ITEMS_PAGE = 100;
const ITEMS_MAX_PAGES = 10;

/** Every pantry the caller can reach (their own first, then each group by name), with totals. */
export function usePantries() {
  const { client } = useSession();
  return useApiQuery<Pantry[]>(qk.kitchenPantries(), () => wrap(async () => (await client.kitchen.pantries()).pantries));
}

export interface LoadedItems {
  items: ReachableItem[];
  /** More than the app reads at once: only the soonest 1,000 are shown. */
  truncated: boolean;
}

/** Read the items of one choice ("all", "personal" or a group's `org_…`), soonest use-by first, every page. */
function loadPantryItems(client: Client, pantry: string): Promise<ApiResult<LoadedItems>> {
  return wrap(async () => {
    const items: ReachableItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < ITEMS_MAX_PAGES; page++) {
      const res = await client.kitchen.items(cursor ? { pantry, cursor, limit: ITEMS_PAGE } : { pantry, limit: ITEMS_PAGE });
      items.push(...res.items);
      cursor = res.nextCursor;
      if (!cursor) return { items, truncated: false };
    }
    return { items, truncated: true };
  });
}

/** The items of one choice ("all", "personal" or a group's `org_…`), soonest use-by first, every page. */
export function usePantryItems(pantry: string, enabled = true) {
  const { client } = useSession();
  const qc = useQueryClient();
  return useApiQuery<LoadedItems>(qk.kitchenPantryItems(pantry), () => loadPantryItems(client, pantry), {
    enabled,
    // A pantry chip opened for the first time shows its items from "all", when that is read, until its own arrive (SM-5).
    placeholder: () => {
      if (pantry === "all") return undefined;
      const all = qc.getQueryData<LoadedItems>(qk.kitchenPantryItems("all"));
      if (!all) return undefined;
      const items = all.items.filter((i) => (pantry === "personal" ? i.pantry.kind === "personal" : i.pantry.kind === "group" && i.pantry.orgId === pantry));
      return { items, truncated: all.truncated };
    },
  });
}

/**
 * Home's strip: items to use within a few days, and the first few already
 * past their date — enough of each that the strip still fills once what the
 * inbox lists is left out (CP-23).
 */
export function useUseSoonItems() {
  const { client } = useSession();
  return useApiQuery<{ soon: ReachableItem[]; expired: ReachableItem[] }>(qk.kitchenUseSoon(), () =>
    wrap(async () => {
      const [soon, expired] = await Promise.all([
        client.kitchen.items({ filter: "soon", limit: 16 }),
        client.kitchen.items({ filter: "expired", limit: 8 }),
      ]);
      return { soon: soon.items, expired: expired.items };
    }),
  );
}

/** Read one item by its ref (its page's read; Home reads it ahead, SM-5). */
export function loadItem(client: Client, ref: ItemRef): Promise<ApiResult<KitchenItem>> {
  return wrap(async () =>
    ref.kind === "personal" ? (await client.kitchen.getPersonalItem(ref.itemId)).item : (await client.kitchen.getGroupItem(ref.orgId, ref.itemId)).item,
  );
}

/** Read an item's stock moves, newest first (its page's history). */
export function loadItemMoves(client: Client, ref: ItemRef): Promise<ApiResult<KitchenStockMove[]>> {
  return wrap(async () =>
    ref.kind === "personal"
      ? (await client.kitchen.personalItemMoves(ref.itemId, { limit: 100 })).moves
      : (await client.kitchen.groupItemMoves(ref.orgId, ref.itemId, { limit: 100 })).moves,
  );
}

/** One item, by its page ref: your own (`getPersonalItem`) or a group's (`getGroupItem`). */
export function useKitchenItem(ref: ItemRef | null) {
  const { client } = useSession();
  return useApiQuery<KitchenItem>(
    qk.kitchenItem(ref ? itemRefParam(ref) : ""),
    () => (ref ? loadItem(client, ref) : wrap<KitchenItem>(() => Promise.reject(new Error("no item")))),
    { enabled: ref !== null },
  );
}

/** The item's stock moves, newest first. */
export function useItemMoves(ref: ItemRef | null) {
  const { client } = useSession();
  return useApiQuery<KitchenStockMove[]>(
    qk.kitchenItemMoves(ref ? itemRefParam(ref) : ""),
    () => (ref ? loadItemMoves(client, ref) : wrap<KitchenStockMove[]>(() => Promise.reject(new Error("no item")))),
    { enabled: ref !== null },
  );
}

/**
 * A group's members (oldest first) when `orgId` is set — the same cache entry
 * as `useGroupMembers`, for screens where the group is a choice (the add form)
 * and may be none.
 */
export function useMembersOf(orgId: string | null) {
  const { client } = useSession();
  return useApiQuery<KitchenMember[]>(
    qk.kitchenMembers(orgId ?? ""),
    () => (orgId ? loadMembers(client, orgId) : wrap<KitchenMember[]>(() => Promise.reject(new Error("no group")))),
    { enabled: orgId !== null },
  );
}

/**
 * Refresh every pantry read after a stock write — and Home's inbox (CP-23),
 * whose use-soon cards it changes — and a group's ledger when the write was
 * in one.
 */
export function refreshPantry(qc: QueryClient, orgId: string | null): void {
  void qc.invalidateQueries({ queryKey: qk.kitchenPantry() });
  void qc.invalidateQueries({ queryKey: qk.kitchenInbox() });
  if (orgId) refreshLedger(qc, orgId);
}

/**
 * Put back a use or waste: reverse its transaction when it posted one (the
 * reversal puts the stock back in the same write), else undo the move itself.
 */
export function undoStockMove(
  client: ReturnType<typeof useSession>["client"],
  ref: ItemRef,
  move: Pick<KitchenStockMove, "id" | "txnId">,
): Promise<ApiResult<unknown>> {
  const opts = { idempotencyKey: crypto.randomUUID() };
  if (ref.kind === "personal") return wrap(() => client.kitchen.undoPersonalMove(move.id, opts));
  if (move.txnId) {
    const txnId = move.txnId;
    return wrap(() => client.kitchen.reverseTxn(ref.orgId, txnId, {}, opts));
  }
  return wrap(() => client.kitchen.undoGroupMove(ref.orgId, move.id, opts));
}

/** What to say when an undo is refused. */
export function undoRefusal(error: ApiErrorBody): { ok: false; kind: "warning" | "error"; title: string; description?: string } {
  return { ok: false, ...undoRefusalText(error) };
}

function undoRefusalText(error: ApiErrorBody): { kind: "warning" | "error"; title: string; description?: string } {
  switch (error.reason) {
    case "already_reversed":
      return { kind: "warning", title: "Already undone" };
    case "not_latest":
      return {
        kind: "warning",
        title: "Something newer came after it",
        description: "Only the latest change to an item can be put back. Undo that one first.",
      };
    case "not_reversible":
      return { kind: "warning", title: "This one can't be undone", description: "Log it again instead." };
    case "not_creator":
      return { kind: "warning", title: "Only who logged it can undo it", description: "Or an owner or admin of the group." };
    default:
      return { kind: "error", title: "Couldn't undo it", description: error.message };
  }
}

// ── Quick use (CP-13) ─────────────────────────────────────────────

/** How many usuals the app reads: quick use's strip, and the + Add sheet's Do it again (one cache entry). */
export { USUALS_LIMIT } from "./now-strip";

/**
 * The part of the day on this device (the new frame's usuals, cookpool-pantry
 * PN-5), looked at again when it should change and whenever the page comes
 * back; null in today's frame.
 */
export function useUsualBucket(isNewFrame: boolean = newFrame()): UsualBucket | null {
  const [bucket, setBucket] = React.useState<UsualBucket | null>(() => usualsRead(isNewFrame, new Date()).bucket);
  React.useEffect(() => {
    if (!isNewFrame) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = () => {
      const at = new Date();
      setBucket(usualsRead(true, at).bucket);
      if (timer) clearTimeout(timer);
      timer = setTimeout(look, msToNextBucket(at, tzOffsetOf(at)) + 1_000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") look();
    };
    look();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isNewFrame]);
  return bucket;
}

/**
 * What the caller often uses (CP-11's usuals), most used first: usable items
 * with something left. In the new frame (PN-5) every row's usual, with this
 * device's offset, read again when the part of the day changes (the last
 * answer stays on screen meanwhile); today's frame reads exactly as before.
 */
export function useUsuals(enabled = true) {
  const { client } = useSession();
  const isNew = newFrame();
  const bucket = useUsualBucket(isNew);
  const read = usualsRead(isNew, new Date());
  const key = isNew && bucket ? qk.kitchenUsualsAt(bucket) : read.key;
  return useApiQuery<KitchenUsual[]>(
    key,
    () => wrap(async () => (await client.kitchen.usuals(isNew ? { ...read.query, tzOffset: tzOffsetOf(new Date()) } : read.query)).usuals),
    isNew ? { enabled, keepPrevious: true } : { enabled },
  );
}

/** Quick use's search: items with something left across every pantry the caller may use from (`usable=1`), best match first. */
export function useItemSearch(q: string) {
  const { client } = useSession();
  const term = q.trim();
  return useApiQuery<ReachableItem[]>(
    qk.kitchenSearch(term),
    () => wrap(async () => (await client.kitchen.searchItems(term, { usable: true, limit: 20 })).items),
    // The last matches stay while the next ones come (SM-5).
    { enabled: term !== "", keepPrevious: true },
  );
}

/** The caller's usable items, soonest use-by first (quick use's strip before there are usuals). */
export function useUsableItems(enabled: boolean) {
  const { client } = useSession();
  return useApiQuery<ReachableItem[]>(
    qk.kitchenUsable(),
    () => wrap(async () => (await client.kitchen.items({ usable: true, limit: 8 })).items),
    { enabled },
  );
}

/**
 * Several items by their refs, each in the item page's cache entry: by
 * `itm_…`, the item once read, null when it cannot be (removed, moved, or no
 * longer yours to read); missing while it loads.
 */
export function useItemsByRef(refs: readonly ItemRef[]): ReadonlyMap<string, KitchenItem | null> {
  const { client } = useSession();
  const qc = useQueryClient();
  const results = useQueries({
    queries: refs.map((ref) => ({
      queryKey: qk.kitchenItem(itemRefParam(ref)),
      queryFn: afterWrites(qc, qk.kitchenItem(itemRefParam(ref)), async (): Promise<KitchenItem> => {
        const r = await loadItem(client, ref);
        if (!r.ok) throw r.error;
        return r.data;
      }),
    })),
  });
  const out = new Map<string, KitchenItem | null>();
  refs.forEach((ref, i) => {
    const q = results[i];
    if (q?.data) out.set(ref.itemId, q.data);
    else if (q?.isError) out.set(ref.itemId, null);
  });
  return out;
}

export interface LogUseInput {
  ref: ItemRef;
  item: KitchenItem;
  qtyMilli: number;
  /** Who had it, in the order sent (ignored for your own pantry's item). */
  consumers: readonly string[];
  idempotencyKey: string;
  /** The amount in words for the toast ("1 glass", "2 onions"); the amount itself by default. */
  what?: string;
  /**
   * Given in one of the item's measures (SM-14): sent as its count and word
   * (`{ quantity: "2", measure: "onion" }`), and the move keeps the words.
   * Left out, words that are one of the item's measures and take exactly
   * `qtyMilli` ("2 onions" from a usual) are sent in it; null sends the unit.
   */
  measure?: { measure: KitchenMeasure; quantity: number } | null;
  /** Kept for callers from before SM-14: the toast is one line everywhere now. */
  inPantry?: boolean;
  meId: string | null;
  names?: MemberNames | null;
}

export type LogUseResult =
  | { ok: true; response: StockMoveResponse }
  | {
      ok: false;
      message: string;
      /** People who left the group: take them off and try again. */
      gone: string[];
      /** The server answered (a refusal is stored against the key): send the next try with a new key. */
      answered: boolean;
    };

/** The server answered (a refusal is stored against its key at the edge): the next try needs a new key. */
function wasAnswered(r: { status: number }): boolean {
  return r.status > 0 && r.status < 500;
}

/** A use or waste the screen already shows: the request, its toast, its Undo. */
function useStockWrite() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: {
      ref: ItemRef;
      item: KitchenItem;
      change: StockChange;
      move: KitchenStockMove;
      send: () => Promise<ApiResult<StockMoveResponse>>;
      title: string;
      /** The toast's words once the server answers (what it did to money), when they change. */
      answered: (answer: StockMoveResponse) => { title?: string; description?: string } | undefined;
      refusal: (error: ApiErrorBody) => { title: string; message: string };
    }): Promise<ApiResult<StockMoveResponse>> => {
      const { ref, item, change } = input;
      const orgId = ref.kind === "group" ? ref.orgId : null;
      const write = beginWrite(qc, [...stockPatches(change), movesPatch(itemRefParam(ref), input.move)]);
      const request = write.track(input.send());
      let undone = false;
      const toast = offer({
        title: input.title,
        // Pressed before the server answered: it is put back once it has, if it was written at all.
        undo: async (): Promise<UndoResult> => {
          const r = await request;
          if (!r.ok) return { ok: true, description: `${item.name} is back as it was.` };
          const u = await write.track(undoStockMove(client, ref, { id: r.data.move.id, txnId: r.data.txn?.id ?? r.data.move.txnId }));
          refreshPantry(qc, orgId);
          return u.ok ? { ok: true, description: `${item.name} is back as it was.` } : undoRefusal(u.error);
        },
        restore: () => {
          undone = true;
          write.restore(stockReturnPatches(change));
        },
      });
      return request.then((r) => {
        if (!r.ok) {
          write.rollback();
          // What is left may have changed under us: read it again.
          refreshPantry(qc, null);
          const why = input.refusal(r.error);
          toast.refuse(refusedToast(why.title, why.message));
          return r;
        }
        if (undone) return r;
        // The server's item on its page at once; every other read is read again.
        qc.setQueryData(qk.kitchenItem(itemRefParam(ref)), r.data.item);
        refreshPantry(qc, orgId);
        const words = input.answered(r.data);
        if (words) toast.update(words);
        return r;
      });
    },
    [client, qc, offer],
  );
}

/**
 * Log a use — the item page's Use some, quick use, Do it again and Home's
 * one tap share it. It shows at once (Cookpool SM-5): what is left goes down
 * wherever the item is listed, its history gains the row (with the measure's
 * words, SM-14), and the one Undo toast says in one line what was logged and
 * what it cost (`loggedText`) before the server answers. A
 * refusal puts everything back exactly and the toast says why in one line
 * (`logRefusal`). The promise says how it came out: callers move on at once
 * and look only for what a refusal asks of them (who left the group).
 */
export function useLogUse() {
  const { client } = useSession();
  const stockWrite = useStockWrite();
  return React.useCallback(
    (input: LogUseInput): Promise<LogUseResult> => {
      const { ref, item, qtyMilli, meId, names } = input;
      const consumers = item.pantry.kind === "personal" ? [] : [...input.consumers];
      const counted = input.measure !== undefined ? input.measure : countedWords(item, input.what, qtyMilli);
      const body = logRequest(item, qtyMilli, consumers, counted);
      const label = counted ? measureLabel(counted.quantity, counted.measure) : null;
      const what = label ?? input.what ?? amountText(qtyMilli, item);
      // What it takes: `measureTakeMilli` of the measure (the caller's amount), as the server will.
      const change: StockChange = { itemId: item.id, kind: "use", qtyMilli, costMinor: amountCost(item, qtyMilli) };
      const textFor = (costMinor: number) => loggedText({ item, what, consumers, meId, names: names ?? null, costMinor });
      const opts = { idempotencyKey: input.idempotencyKey };
      return stockWrite({
        ref,
        item,
        change,
        move: pendingMove({
          change,
          // A use in a measure is stored in the item's own unit, with its words beside it.
          quantity: counted ? fromMilli(qtyMilli, item.displayUnit) : Number(body.quantity),
          unit: counted ? item.displayUnit : (body.unit ?? item.displayUnit),
          label,
          actor: meId ?? item.createdBy,
          consumers: item.pantry.kind === "personal" ? null : consumers,
          at: new Date().toISOString(),
        }),
        send: () =>
          wrap(() =>
            ref.kind === "group"
              ? client.kitchen.useGroupItem(ref.orgId, ref.itemId, body, opts)
              : client.kitchen.usePersonalItem(ref.itemId, body, opts),
          ),
        title: textFor(change.costMinor),
        // The server's cost, if someone used some meanwhile and it differs.
        answered: (a) => (a.move.costMinor !== change.costMinor ? { title: textFor(a.move.costMinor) } : undefined),
        refusal: (error) => ({ title: `Couldn't log ${item.name}`, message: logRefusal(error, { item, meId, names: names ?? null }).message }),
      }).then((r): LogUseResult => {
        if (r.ok) return { ok: true, response: r.data };
        const refusal = logRefusal(r.error, { item, meId, names: names ?? null });
        return { ok: false, ...refusal, answered: wasAnswered(r) };
      });
    },
    [client, stockWrite],
  );
}

/**
 * Mark the rest of an item wasted (the item page), at once like a use: none
 * left wherever it is listed, its history gains the row, and the Undo toast
 * says so before the server answers — its second line, who was charged, is
 * the server's.
 */
export function useWasteItem() {
  const { client } = useSession();
  const stockWrite = useStockWrite();
  return React.useCallback(
    (input: { ref: ItemRef; item: KitchenItem; meId: string | null; idempotencyKey: string }): Promise<ApiResult<StockMoveResponse>> => {
      const { ref, item } = input;
      const change: StockChange = { itemId: item.id, kind: "waste", qtyMilli: item.qtyLeftMilli, costMinor: item.worthMinor };
      const what = `${amountText(item.qtyLeftMilli, item)} of ${item.name}`;
      const opts = { idempotencyKey: input.idempotencyKey };
      return stockWrite({
        ref,
        item,
        change,
        move: pendingMove({
          change,
          quantity: item.qtyLeft,
          unit: item.displayUnit,
          actor: input.meId ?? item.createdBy,
          consumers: null,
          at: new Date().toISOString(),
        }),
        send: () =>
          wrap(() =>
            ref.kind === "group"
              ? client.kitchen.wasteGroupItem(ref.orgId, ref.itemId, {}, opts)
              : client.kitchen.wastePersonalItem(ref.itemId, {}, opts),
          ),
        title: `Marked ${what} wasted`,
        answered: (a) => ({
          description: a.txn ? `${formatMinor(a.txn.totalMinor, item.currency)} split equally in ${item.pantry.name}.` : "Nobody was charged.",
        }),
        refusal: (error) => ({
          title: `Couldn't mark ${item.name} wasted`,
          message: error.reason === "insufficient_stock" ? "There's nothing left to waste now." : error.message,
        }),
      });
    },
    [client, stockWrite],
  );
}

// ── Adding an item (CP-12) ────────────────────────────────────────

export type AddItemRequest =
  | { kind: "personal"; body: CreatePersonalItemRequest }
  | { kind: "group"; orgId: string; body: CreateGroupItemRequest };

/** Why an add was refused, in one line (the add form's own messages, CP-12). */
export function addRefusal(error: ApiErrorBody, ctx: { groupName: string | null; payer: string | null }): string {
  const details = error.details ?? {};
  if (error.reason === "not_in_group") return `${ctx.payer ?? "That person"} isn't in ${ctx.groupName ?? "the group"} any more. Add it again with you as the payer.`;
  if (error.reason === "currency_mismatch") return `${ctx.groupName ?? "This group"} counts in ${String(details["currency"] ?? "another currency")}. Reload and try again.`;
  const fields = details["fields"];
  if (fields && typeof fields === "object") {
    for (const messages of Object.values(fields as Record<string, unknown>)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") return messages[0];
    }
  }
  return error.message;
}

/**
 * Add an item (the add form), at once (Cookpool SM-5): the item is listed in
 * its pantry before the server answers — a row nothing can be done to yet —
 * and the toast says so, with Undo (which removes it) for whoever may remove
 * it. The server's item takes the row's place when it answers; a refusal
 * takes the row off and the toast says why in one line. `pantry` is the
 * pantry the form is adding to: its list is read ahead, so the row has a
 * list to show in.
 */
export function useAddItem(pantry: string | null) {
  const { client } = useSession();
  const qc = useQueryClient();
  const { toast, update } = useToast();
  const offer = useUndoToast();
  React.useEffect(() => {
    if (pantry) prefetchApi(qc, qk.kitchenPantryItems(pantry), () => loadPantryItems(client, pantry));
  }, [client, qc, pantry]);
  return React.useCallback(
    (input: {
      request: AddItemRequest;
      pantry: PantryRef;
      currency: string;
      groupWastePolicy: KitchenItem["wastePolicy"];
      meId: string | null;
      names: MemberNames;
      today: string;
      /** "your pantry", "Flat 4B". */
      where: string;
      /** Whoever paid for it, or an owner or admin, may take it off again (the API's rule). */
      canRemove: boolean;
      idempotencyKey: string;
    }): Promise<ApiResult<{ item: KitchenItem }>> => {
      const { request, meId } = input;
      const name = request.body.name;
      const shown = meId
        ? pendingItem({
            body: request.body,
            pantry: input.pantry,
            currency: input.currency,
            groupWastePolicy: input.groupWastePolicy,
            meId,
            today: input.today,
            at: new Date().toISOString(),
          })
        : null;
      const write = beginWrite(qc, shown ? itemAddedPatches(shown) : []);
      const opts = { idempotencyKey: input.idempotencyKey };
      const sent = write.track(
        wrap(() =>
          request.kind === "personal"
            ? client.kitchen.createPersonalItem(request.body, opts)
            : client.kitchen.createGroupItem(request.orgId, request.body, opts),
        ),
      );
      const title = `Added ${name} to ${input.where}`;
      const description = shown ? `${leftText(shown)} · nobody is charged until someone uses it.` : undefined;
      let undone = false;
      const handle = input.canRemove
        ? offer({
            title,
            description,
            undo: async (): Promise<UndoResult> => {
              const r = await sent;
              if (!r.ok) return { ok: true, description: `${name} is off the list.` };
              const item = r.data.item;
              const orgId = item.pantry.kind === "group" ? item.pantry.orgId : null;
              const u = await write.track(
                wrap(() => (orgId ? client.kitchen.removeGroupItem(orgId, item.id) : client.kitchen.removePersonalItem(item.id))),
              );
              refreshPantry(qc, null);
              if (u.ok) return { ok: true, description: `${name} is off the list.` };
              if (u.error.reason === "item_used") return { ok: false, kind: "warning", title: "Someone already used some", description: "Mark it wasted on its page instead." };
              return { ok: false, kind: "error", title: "Couldn't undo it", description: u.error.message };
            },
            restore: () => {
              undone = true;
              write.restore([]);
            },
          })
        : null;
      const plain = handle ? null : toast({ kind: "success", title, description });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          if (r.error.reason === "currency_mismatch" || r.error.reason === "not_in_group") refreshPantry(qc, null);
          const payer = request.kind === "group" && request.body.paidBy ? memberLabel(request.body.paidBy, meId, input.names) : null;
          const why = refusedToast(`Couldn't add ${name}`, addRefusal(r.error, { groupName: input.pantry.kind === "group" ? input.pantry.name : null, payer }));
          if (handle) handle.refuse(why);
          else if (plain !== null) update(plain, { ...why, duration: REFUSAL_MS });
          return r;
        }
        if (undone) {
          // Undo came first: the row stays off until the removal lands (the undo reads again).
          applyPatches(queryCacheOf(qc), itemRemovedPatches(r.data.item.id));
          return r;
        }
        // The server's item in the row's place, so it opens; then everything is read again.
        if (shown) applyPatches(queryCacheOf(qc), itemAddedPatches({ ...r.data.item, canUse: true }, shown.id));
        qc.setQueryData(qk.kitchenItem(itemRefParam(itemRefOf(r.data.item))), r.data.item);
        refreshPantry(qc, null);
        return r;
      });
    },
    [client, qc, toast, update, offer],
  );
}
