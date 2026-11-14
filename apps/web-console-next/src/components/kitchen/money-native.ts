/**
 * Cookpool's Money, native (money-native MY-8), as pure wiring: where its
 * pages live, which side is open, and the console client's calls behind the
 * settle box and the expense box. The pages themselves are
 * `@saas/spliteco-ui`'s (theme `cookpool`); this file holds nothing visual.
 * Dependency-free of React so it is unit-testable.
 */

import type {
  SplitecoExpenseRequest,
  SplitecoGroupResponse,
  SplitecoReceivedPaymentRequest,
  SplitecoSettlementRequest,
} from "@saas/contracts/spliteco";
import { settlementBody, type PaymentRequest, type SettleApi } from "@saas/spliteco-ui/settle-box";
import type { ExpenseGroup } from "@saas/spliteco-ui/expense";

/**
 * Where + Group and the Add group row go: the Add group sheet (MY-9),
 * hosted at `app/(kitchen)/money/add-group/page.tsx`.
 */
export const MONEY_ADD_GROUP_HREF = "/money/add-group";

export type MoneyView = { kind: "groups" } | { kind: "people" } | { kind: "person"; subjectId: string };

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * What `/money`'s query names, as the first build of the native pages spelled
 * it: `?person=<subject>` a person's page, `?side=people` the People side;
 * Groups otherwise. Since MY-21 these are routes of their own
 * (`/money/people`, `/money/people/<subject>`), so Back works; the query is
 * read only to send an old link, an open tab or the installed app's saved
 * address to its route (`legacyMoneyHref`).
 */
export function moneyViewFrom(params: { get(name: string): string | null } | null | undefined): MoneyView {
  const person = params?.get("person") ?? null;
  if (person && ID.test(person)) return { kind: "person", subjectId: person };
  return params?.get("side") === "people" ? { kind: "people" } : { kind: "groups" };
}

/** The route of a view: `/money` (Groups), `/money/people`, `/money/people/<subject id>`. */
export function moneyHref(view: MoneyView): string {
  if (view.kind === "person") return `/money/people/${encodeURIComponent(view.subjectId)}`;
  return view.kind === "people" ? "/money/people" : "/money";
}

/** Where an old `/money?side=people` or `/money?person=…` address goes; null for `/money` as it is. */
export function legacyMoneyHref(params: { get(name: string): string | null } | null | undefined): string | null {
  const view = moneyViewFrom(params);
  return view.kind === "groups" ? null : moneyHref(view);
}

/**
 * Where the floating buttons (Expense, Settle up, Pay) sit: over the tab bar,
 * which is 68px tall and `max(14px, safe inset)` from the bottom, with a 22px
 * margin above it (`BAR_CLEARANCE` over the bar's 14px). The bar rides the
 * home indicator's safe area on an installed phone, so the inset is measured
 * by the page (`useSafeBottom`) and passed here: 104 on a phone with none.
 */
export const BAR_CLEARANCE = 90;

export function barOffset(safeBottomPx: number): number {
  return Math.max(14, safeBottomPx) + BAR_CLEARANCE;
}

/** A group's Manage page (MY-11): any group on Money's list opens it, by id. */
export function moneyGroupHref(groupId: string): string {
  return `/money/group?id=${encodeURIComponent(groupId)}`;
}

/** The expense box's groups from the groups' own reads: a Cookpool group has exactly one currency. */
export function expenseGroupsFrom(details: readonly (SplitecoGroupResponse | null | undefined)[]): ExpenseGroup[] {
  const out: ExpenseGroup[] = [];
  for (const d of details) {
    if (!d || d.members.length === 0) continue;
    out.push({
      id: d.group.id,
      name: d.group.name,
      currency: d.group.currency,
      members: d.members.map((m) => ({ subjectId: m.subjectId, name: m.name })),
    });
  }
  return out;
}

/** The slice of the console's client the settle and expense boxes call. */
export interface MoneyWriteClient {
  spliteco: {
    settle(groupId: string, body: SplitecoSettlementRequest, opts?: { idempotencyKey?: string }): Promise<unknown>;
    paymentReceived(body: SplitecoReceivedPaymentRequest, opts?: { idempotencyKey?: string }): Promise<unknown>;
    createExpense(groupId: string, body: SplitecoExpenseRequest, opts?: { idempotencyKey?: string }): Promise<unknown>;
  };
}

/**
 * One idempotency key per write: the same write sent again (a retry after a
 * failure) reuses its key, so the edge answers from the first; a write that
 * landed is forgotten, so paying the same amount again later is a new one.
 */
export function idempotencyKeys(make: () => string = () => crypto.randomUUID()) {
  const open = new Map<string, string>();
  return {
    keyFor(content: string): string {
      let key = open.get(content);
      if (!key) {
        key = make();
        open.set(content, key);
      }
      return key;
    },
    landed(content: string): void {
      open.delete(content);
    },
  };
}

/** The settle box's two writes through the console's own client. Nothing opens Spliteco. */
export function settleApiFor(client: MoneyWriteClient, keys = idempotencyKeys()): SettleApi {
  const write = async <T>(content: string, send: (idempotencyKey: string) => Promise<T>): Promise<T> => {
    const res = await send(keys.keyFor(content));
    keys.landed(content);
    return res;
  };
  return {
    recordPayment: (r: PaymentRequest) =>
      write(`pay:${r.groupId}:${JSON.stringify(settlementBody(r))}`, (idempotencyKey) => client.spliteco.settle(r.groupId, settlementBody(r), { idempotencyKey })),
    paymentReceived: (body) => write(`got:${JSON.stringify(body)}`, (idempotencyKey) => client.spliteco.paymentReceived(body, { idempotencyKey })),
  };
}

/** The expense box's write: Spliteco's own create-expense call, retried under one key. */
export function createExpenseFor(client: MoneyWriteClient, keys = idempotencyKeys()) {
  return async (groupId: string, body: SplitecoExpenseRequest): Promise<unknown> => {
    const content = `expense:${groupId}:${JSON.stringify(body)}`;
    const res = await client.spliteco.createExpense(groupId, body, { idempotencyKey: keys.keyFor(content) });
    keys.landed(content);
    return res;
  };
}
