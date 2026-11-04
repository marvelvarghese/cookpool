"use client";

import * as React from "react";
import { useInfiniteQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ActivityPage, CreateExpenseRequest, KitchenTxn } from "@saas/contracts/kitchen";
import { wrap, type ApiErrorBody, type ApiResult } from "@/lib/api";
import { useSession } from "@/lib/session";
import { afterWrites, useApiQuery, qk } from "@/lib/query";
import { refusedToast, undoFailed, type UndoResult } from "./undo";
import { useUndoToast } from "./undo-toast";
import { expenseTxn, txnAddedPatches, txnReversedPatches } from "./cache-patches";
import { beginWrite } from "./optimistic-data";
import { memberLabel, type MemberNames } from "./members";
import { canManageGroup, canWriteInGroup, roleFromKitchen, type GroupRole } from "./groups";
import { useGroupMembers } from "./people-data";

/**
 * Cookpool's ledger reads and writes (CP-8), per group, through the CP-7 SDK.
 * Every read is cached under `qk.kitchenLedger(orgId)`, so one invalidation
 * after a write refreshes the feed, the balances and the plan together.
 */

const ACTIVITY_PAGE = 25;
/** The debts behind a plan read the whole feed: 100 a page, up to 5,000 entries. */
const ALL_PAGE = 100;
const ALL_MAX_PAGES = 50;

async function unwrap<T>(fn: () => Promise<T>): Promise<T> {
  const r = await wrap(fn);
  if (!r.ok) throw r.error;
  return r.data;
}

/** The group's activity, newest first, a page at a time ("Load more"). */
export function useActivityFeed(orgId: string) {
  const { client } = useSession();
  const qc = useQueryClient();
  return useInfiniteQuery<ActivityPage, ApiErrorBody>({
    queryKey: qk.kitchenActivity(orgId),
    queryFn: ({ pageParam }) => afterWrites(qc, qk.kitchenActivity(orgId), () => loadActivityPage(client, orgId, pageParam))(),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

export interface AllActivity {
  txns: KitchenTxn[];
  /** More than the app reads at once: the debts shown are the newest ones only. */
  truncated: boolean;
}

/** The whole feed (for "Show the debts behind this"); only fetched when `enabled`. */
export function useAllActivity(orgId: string, enabled: boolean) {
  const { client } = useSession();
  return useApiQuery<AllActivity>(
    qk.kitchenActivityAll(orgId),
    () =>
      wrap(async () => {
        const txns: KitchenTxn[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < ALL_MAX_PAGES; page++) {
          const res: ActivityPage = await client.kitchen.activity(
            orgId,
            cursor ? { cursor, limit: ALL_PAGE } : { limit: ALL_PAGE },
          );
          txns.push(...res.items);
          cursor = res.nextCursor;
          if (!cursor) return { txns, truncated: false };
        }
        return { txns, truncated: true };
      }),
    { enabled },
  );
}

type Client = ReturnType<typeof useSession>["client"];

/** Read a group's balances (its page's read; Home reads it ahead, SM-5). */
export function loadBalances(client: Client, orgId: string) {
  return wrap(() => client.kitchen.balances(orgId));
}

/** Read one page of a group's activity, newest first. */
export function loadActivityPage(client: Client, orgId: string, cursor: unknown): Promise<ActivityPage> {
  return unwrap(() =>
    client.kitchen.activity(orgId, typeof cursor === "string" ? { cursor, limit: ACTIVITY_PAGE } : { limit: ACTIVITY_PAGE }),
  );
}

export function useBalances(orgId: string) {
  const { client } = useSession();
  return useApiQuery(qk.kitchenBalances(orgId), () => loadBalances(client, orgId));
}

export function useSettlePlan(orgId: string, enabled = true) {
  const { client } = useSession();
  return useApiQuery(qk.kitchenSettlePlan(orgId), () => wrap(() => client.kitchen.settlePlan(orgId)), { enabled });
}

/**
 * Refresh everything the ledger shows for a group after a write — and the
 * cross-group reads (Home, People, a person's view), which add it up.
 */
export function refreshLedger(qc: QueryClient, orgId: string): void {
  void qc.invalidateQueries({ queryKey: qk.kitchenLedger(orgId) });
  void qc.invalidateQueries({ queryKey: qk.kitchenMe() });
}

/**
 * The signed-in person's role in a group, from the group's member list
 * (`…/kitchen/members`, which every member may read — CP-9). `canWrite` is
 * false for a viewer, who sees the ledger but adds, records, undoes and flags
 * nothing, and while the role is loading; if the list cannot be read, the
 * write actions show and the server stays the judge. Shares the members
 * cache with the group page.
 */
export function useGroupRole(orgId: string, myId: string | null) {
  const members = useGroupMembers(orgId);
  const me = myId ? members.data?.find((m) => m.subjectId === myId) : undefined;
  const role: GroupRole | null = me ? roleFromKitchen(me.role) : null;
  const roleKnown = role !== null || members.error !== null || (members.data !== null && !me);
  const canWrite = roleKnown && (role === null || canWriteInGroup(role));
  return { members, role, roleKnown, manager: canManageGroup(role), canWrite };
}

export { UNDO_MS } from "./undo";

/**
 * Money actions confirm by undo, not by a dialog (design §7): after a write,
 * the one Undo toast (`useUndoToast`, CP-23) offers Undo for ten seconds,
 * which posts a reversal of what was just written.
 */
export function useOfferUndo() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (orgId: string, txn: KitchenTxn, title: string, description?: string) => {
      offer({
        title,
        description,
        undo: async (): Promise<UndoResult> => {
          const r = await wrap(() => client.kitchen.reverseTxn(orgId, txn.id, {}, { idempotencyKey: crypto.randomUUID() }));
          refreshLedger(qc, orgId);
          return r.ok ? { ok: true, description: `“${txn.title}” is reversed.` } : undoFailed(r.error);
        },
      });
    },
    [client, qc, offer],
  );
}

/** Why an expense was refused, in one line (the add form's own messages, CP-8). */
export function expenseRefusal(
  error: ApiErrorBody,
  ctx: { groupName: string; meId: string | null; names?: MemberNames | null },
): string {
  const details = error.details ?? {};
  if (error.reason === "not_in_group") {
    const ids = Array.isArray(details["subjectIds"]) ? (details["subjectIds"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
    return ids.length > 0
      ? `${ids.map((id) => memberLabel(id, ctx.meId, ctx.names)).join(", ")} ${ids.length === 1 ? "has" : "have"} left ${ctx.groupName}. Add it again without them.`
      : "Someone on this expense has left the group. Add it again without them.";
  }
  if (error.reason === "currency_mismatch") return `${ctx.groupName} counts in ${String(details["currency"] ?? "another currency")}. Reload and try again.`;
  return error.message;
}

/**
 * Add an expense (the add form), at once (Cookpool SM-5): its row is at the
 * top of the group's activity — who paid, and each share as the form showed
 * it (`owed`, the same engine split) — and the one Undo toast is up before
 * the server answers. The balances are the server's: they are read again
 * once it answers. A refusal takes the row off and the toast says why in one
 * line; Undo reverses it (at once on screen, on the server once it landed).
 */
export function useAddExpense() {
  const { client } = useSession();
  const qc = useQueryClient();
  const offer = useUndoToast();
  return React.useCallback(
    (input: {
      orgId: string;
      groupName: string;
      request: CreateExpenseRequest;
      /** Each participant's share, as the form split it. */
      owed: ReadonlyMap<string, number>;
      /** The group's people in the form's order (the row's order). */
      order: readonly string[];
      currency: string;
      meId: string | null;
      names?: MemberNames | null;
      title: string;
      description?: string;
    }): Promise<ApiResult<{ txn: KitchenTxn }>> => {
      const { orgId, request } = input;
      const shown = expenseTxn(orgId, request, input.owed, {
        currency: input.currency,
        createdBy: input.meId ?? request.payers[0]?.subjectId ?? "",
        at: new Date().toISOString(),
        order: input.order,
      });
      const write = beginWrite(qc, txnAddedPatches(shown));
      const sent = write.track(wrap(() => client.kitchen.createExpense(orgId, request, { idempotencyKey: crypto.randomUUID() })));
      let undone = false;
      let posted: string | null = null;
      const toast = offer({
        title: input.title,
        description: input.description,
        undo: async (): Promise<UndoResult> => {
          const r = await sent;
          if (!r.ok) return { ok: true, description: "Nothing was added." };
          const u = await write.track(wrap(() => client.kitchen.reverseTxn(orgId, r.data.txn.id, {}, { idempotencyKey: crypto.randomUUID() })));
          refreshLedger(qc, orgId);
          return u.ok ? { ok: true, description: `“${r.data.txn.title}” is reversed.` } : undoFailed(u.error);
        },
        restore: () => {
          undone = true;
          write.restore(posted ? txnReversedPatches(orgId, posted) : []);
        },
      });
      return sent.then((r) => {
        if (!r.ok) {
          write.rollback();
          if (r.error.reason === "currency_mismatch") refreshLedger(qc, orgId);
          toast.refuse(refusedToast(`Couldn't add ${request.title}`, expenseRefusal(r.error, { groupName: input.groupName, meId: input.meId, names: input.names ?? null })));
          return r;
        }
        posted = r.data.txn.id;
        if (!undone) refreshLedger(qc, orgId);
        return r;
      });
    },
    [client, qc, offer],
  );
}
