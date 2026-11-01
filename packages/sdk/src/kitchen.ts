import type {
  ActivityPage,
  ActivityQuery,
  BalancesResponse,
  CreateExpenseRequest,
  CreateExpenseResponse,
  CreateSettlementRequest,
  CreateSettlementResponse,
  FlagTxnRequest,
  FlagTxnResponse,
  GetKitchenSettingsResponse,
  ReverseTxnRequest,
  ReverseTxnResponse,
  SettlePlan,
  UpdateKitchenSettingsRequest,
  UpdateKitchenSettingsResponse,
} from "@saas/contracts/kitchen";

import type { RequestOptions, Transport } from "./transport.js";

/**
 * Kitchen resource client (Cookpool).
 *
 * Covers `apps/kitchen-worker` through the api-edge kitchen facade:
 * `/v1/organizations/:orgId/kitchen/…` for one group (and, as they land,
 * `/v1/kitchen/me/…` for the caller across every group).
 */
export class KitchenClient {
  constructor(private readonly transport: Transport) {}

  // -------------------------------------------------------------------------
  // Group settings
  // -------------------------------------------------------------------------

  /**
   * GET /v1/organizations/:orgId/kitchen/settings
   *
   * Any member. A group that never saved settings reads as INR /
   * `split_equally` with `updatedAt: null`.
   */
  getSettings(orgId: string, opts: RequestOptions = {}): Promise<GetKitchenSettingsResponse> {
    return this.transport.request<GetKitchenSettingsResponse>(
      {
        method: "GET",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/kitchen/settings`,
      },
      opts,
    );
  }

  /**
   * PATCH /v1/organizations/:orgId/kitchen/settings
   *
   * Owners and admins. The currency is fixed once the group has saved
   * settings: a different one is a `ConflictError` whose details carry
   * `reason: "currency_locked"` and the current `currency`.
   */
  updateSettings(
    orgId: string,
    body: UpdateKitchenSettingsRequest,
    opts: RequestOptions = {},
  ): Promise<UpdateKitchenSettingsResponse> {
    return this.transport.request<UpdateKitchenSettingsResponse>(
      {
        method: "PATCH",
        path: `/v1/organizations/${encodeURIComponent(orgId)}/kitchen/settings`,
        body,
      },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // The ledger (CP-7)
  //
  // Every POST takes `opts.idempotencyKey`: the same key twice posts once.
  // -------------------------------------------------------------------------

  private groupPath(orgId: string, rest: string): string {
    return `/v1/organizations/${encodeURIComponent(orgId)}/kitchen/${rest}`;
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/expenses
   *
   * Members, owners and admins. Split `equal`, `exact`, `percent` or
   * `shares`. A `ValidationError` carries the fields that did not add up, or
   * `details.reason` `not_in_group` / `currency_mismatch`.
   */
  createExpense(orgId: string, body: CreateExpenseRequest, opts: RequestOptions = {}): Promise<CreateExpenseResponse> {
    return this.transport.request<CreateExpenseResponse>(
      { method: "POST", path: this.groupPath(orgId, "expenses"), body },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/settlements
   *
   * Record that `fromSubjectId` paid `toSubjectId`. Either of the two may
   * record it, or an owner or admin (`ForbiddenError`, `reason:
   * "not_a_party"`, otherwise).
   */
  createSettlement(
    orgId: string,
    body: CreateSettlementRequest,
    opts: RequestOptions = {},
  ): Promise<CreateSettlementResponse> {
    return this.transport.request<CreateSettlementResponse>(
      { method: "POST", path: this.groupPath(orgId, "settlements"), body },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/txns/:txnId/reverse
   *
   * Its creator, or an owner or admin. Answers the reversal; a transaction is
   * reversed once (`ConflictError`, `reason: "already_reversed"`).
   */
  reverseTxn(
    orgId: string,
    txnId: string,
    body: ReverseTxnRequest = {},
    opts: RequestOptions = {},
  ): Promise<ReverseTxnResponse> {
    return this.transport.request<ReverseTxnResponse>(
      { method: "POST", path: this.groupPath(orgId, `txns/${encodeURIComponent(txnId)}/reverse`), body },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/txns/:txnId/flags
   *
   * Someone the transaction names says it looks wrong.
   */
  flagTxn(orgId: string, txnId: string, body: FlagTxnRequest, opts: RequestOptions = {}): Promise<FlagTxnResponse> {
    return this.transport.request<FlagTxnResponse>(
      { method: "POST", path: this.groupPath(orgId, `txns/${encodeURIComponent(txnId)}/flags`), body },
      opts,
    );
  }

  /**
   * GET /v1/organizations/:orgId/kitchen/activity
   *
   * Newest first; pass `nextCursor` back as `cursor` for the next page.
   */
  activity(orgId: string, query: ActivityQuery = {}, opts: RequestOptions = {}): Promise<ActivityPage> {
    return this.transport.request<ActivityPage>(
      {
        method: "GET",
        path: this.groupPath(orgId, "activity"),
        query: { cursor: query.cursor, limit: query.limit },
      },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/kitchen/balances — every member's balance, largest first. */
  balances(orgId: string, opts: RequestOptions = {}): Promise<BalancesResponse> {
    return this.transport.request<BalancesResponse>({ method: "GET", path: this.groupPath(orgId, "balances") }, opts);
  }

  /** GET /v1/organizations/:orgId/kitchen/settle-plan — the fewest payments, and the working. */
  settlePlan(orgId: string, opts: RequestOptions = {}): Promise<SettlePlan> {
    return this.transport.request<SettlePlan>({ method: "GET", path: this.groupPath(orgId, "settle-plan") }, opts);
  }
}
