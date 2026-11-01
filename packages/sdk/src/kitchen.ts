import type {
  ActivityPage,
  ActivityQuery,
  BalancesResponse,
  CreateGroupItemRequest,
  CreatePersonalItemRequest,
  GroupItemsQuery,
  ItemsPage,
  ItemsQuery,
  KitchenItemResponse,
  PantriesResponse,
  SearchItemsQuery,
  SearchItemsResponse,
  UpdateGroupItemRequest,
  UpdatePersonalItemRequest,
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
 * `/v1/organizations/:orgId/kitchen/…` for one group, and
 * `/v1/kitchen/me/…` for the caller across every group.
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

  // -------------------------------------------------------------------------
  // Pantries (CP-10)
  //
  // The caller's personal pantry is under /v1/kitchen/me/… (only they can see
  // it); a group's under /v1/organizations/:orgId/kitchen/items. POSTs take
  // `opts.idempotencyKey`: the same key twice adds the item once.
  // -------------------------------------------------------------------------

  private mePath(rest: string): string {
    return `/v1/kitchen/me/${rest}`;
  }

  /**
   * GET /v1/kitchen/me/pantries
   *
   * The caller's own pantry first, then every group's they are in, by name,
   * each with its item, use-soon and expired counts and what it is worth.
   */
  pantries(opts: RequestOptions = {}): Promise<PantriesResponse> {
    return this.transport.request<PantriesResponse>({ method: "GET", path: this.mePath("pantries") }, opts);
  }

  /**
   * GET /v1/kitchen/me/items
   *
   * Items across every pantry the caller can read (`pantry`: `all`,
   * `personal` or a group's `org_…` id), soonest use-by first. Pass
   * `nextCursor` back as `cursor` for the next page.
   */
  items(query: ItemsQuery = {}, opts: RequestOptions = {}): Promise<ItemsPage> {
    return this.transport.request<ItemsPage>(
      {
        method: "GET",
        path: this.mePath("items"),
        query: { pantry: query.pantry, q: query.q, filter: query.filter, cursor: query.cursor, limit: query.limit },
      },
      opts,
    );
  }

  /**
   * GET /v1/kitchen/me/search
   *
   * Items with something left, across every pantry the caller can read, best
   * name match first — for quick use and the dish maker.
   */
  searchItems(q: string, query: Omit<SearchItemsQuery, "q"> = {}, opts: RequestOptions = {}): Promise<SearchItemsResponse> {
    return this.transport.request<SearchItemsResponse>(
      { method: "GET", path: this.mePath("search"), query: { q, limit: query.limit } },
      opts,
    );
  }

  /** POST /v1/kitchen/me/items — add to the caller's personal pantry. */
  createPersonalItem(body: CreatePersonalItemRequest, opts: RequestOptions = {}): Promise<KitchenItemResponse> {
    return this.transport.request<KitchenItemResponse>({ method: "POST", path: this.mePath("items"), body }, opts);
  }

  /** GET /v1/kitchen/me/items/:itemId — one of the caller's own items. */
  getPersonalItem(itemId: string, opts: RequestOptions = {}): Promise<KitchenItemResponse> {
    return this.transport.request<KitchenItemResponse>(
      { method: "GET", path: this.mePath(`items/${encodeURIComponent(itemId)}`) },
      opts,
    );
  }

  /**
   * PATCH /v1/kitchen/me/items/:itemId
   *
   * Quantity and price change only while nothing has been used
   * (`ConflictError`, `reason: "item_used"`); with `version`, only that
   * version (`reason: "version_conflict"`).
   */
  updatePersonalItem(
    itemId: string,
    body: UpdatePersonalItemRequest,
    opts: RequestOptions = {},
  ): Promise<KitchenItemResponse> {
    return this.transport.request<KitchenItemResponse>(
      { method: "PATCH", path: this.mePath(`items/${encodeURIComponent(itemId)}`), body },
      opts,
    );
  }

  /** DELETE /v1/kitchen/me/items/:itemId — added by mistake; refused once used (`reason: "item_used"`). */
  removePersonalItem(itemId: string, opts: RequestOptions = {}): Promise<KitchenItemResponse> {
    return this.transport.request<KitchenItemResponse>(
      { method: "DELETE", path: this.mePath(`items/${encodeURIComponent(itemId)}`) },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/kitchen/items — one group's pantry, with the same filters as `items`. */
  groupItems(orgId: string, query: GroupItemsQuery = {}, opts: RequestOptions = {}): Promise<ItemsPage> {
    return this.transport.request<ItemsPage>(
      {
        method: "GET",
        path: this.groupPath(orgId, "items"),
        query: { q: query.q, filter: query.filter, cursor: query.cursor, limit: query.limit },
      },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/items
   *
   * Members, owners and admins. In the group's currency; `paidBy` (default:
   * the caller) must be in the group (`ValidationError`, `reason:
   * "not_in_group"`).
   */
  createGroupItem(orgId: string, body: CreateGroupItemRequest, opts: RequestOptions = {}): Promise<KitchenItemResponse> {
    return this.transport.request<KitchenItemResponse>(
      { method: "POST", path: this.groupPath(orgId, "items"), body },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/kitchen/items/:itemId */
  getGroupItem(orgId: string, itemId: string, opts: RequestOptions = {}): Promise<KitchenItemResponse> {
    return this.transport.request<KitchenItemResponse>(
      { method: "GET", path: this.groupPath(orgId, `items/${encodeURIComponent(itemId)}`) },
      opts,
    );
  }

  /**
   * PATCH /v1/organizations/:orgId/kitchen/items/:itemId
   *
   * Its buyer, or an owner or admin (`ForbiddenError`, `reason:
   * "not_buyer"`). Quantity and price only while nothing has been used.
   */
  updateGroupItem(
    orgId: string,
    itemId: string,
    body: UpdateGroupItemRequest,
    opts: RequestOptions = {},
  ): Promise<KitchenItemResponse> {
    return this.transport.request<KitchenItemResponse>(
      { method: "PATCH", path: this.groupPath(orgId, `items/${encodeURIComponent(itemId)}`), body },
      opts,
    );
  }

  /** DELETE /v1/organizations/:orgId/kitchen/items/:itemId — its buyer, or an owner or admin; refused once used. */
  removeGroupItem(orgId: string, itemId: string, opts: RequestOptions = {}): Promise<KitchenItemResponse> {
    return this.transport.request<KitchenItemResponse>(
      { method: "DELETE", path: this.groupPath(orgId, `items/${encodeURIComponent(itemId)}`) },
      opts,
    );
  }
}
