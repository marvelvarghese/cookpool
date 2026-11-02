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
  MovesQuery,
  MovesResponse,
  PantriesResponse,
  ReachableItemsPage,
  SearchItemsQuery,
  SearchItemsResponse,
  StockMoveResponse,
  TransferItemRequest,
  UseGroupItemRequest,
  UsePersonalItemRequest,
  UsualsQuery,
  UsualsResponse,
  WasteItemRequest,
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
  CancelDishResponse,
  CookDishRequest,
  CookDishResponse,
  DishResponse,
  DishesPage,
  DishesQuery,
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
   * `personal` or a group's `org_…` id), soonest use-by first, each saying
   * whether the caller may use it (`canUse`; `usable: true` keeps only those).
   * Pass `nextCursor` back as `cursor` for the next page.
   */
  items(query: ItemsQuery = {}, opts: RequestOptions = {}): Promise<ReachableItemsPage> {
    return this.transport.request<ReachableItemsPage>(
      {
        method: "GET",
        path: this.mePath("items"),
        query: {
          pantry: query.pantry,
          q: query.q,
          filter: query.filter,
          cursor: query.cursor,
          limit: query.limit,
          usable: query.usable ? 1 : undefined,
        },
      },
      opts,
    );
  }

  /**
   * GET /v1/kitchen/me/search
   *
   * Items with something left, across every pantry the caller can read, best
   * name match first — for quick use and the dish maker. Pass `usable: true`
   * to leave out groups where the caller may only read.
   */
  searchItems(q: string, query: Omit<SearchItemsQuery, "q"> = {}, opts: RequestOptions = {}): Promise<SearchItemsResponse> {
    return this.transport.request<SearchItemsResponse>(
      {
        method: "GET",
        path: this.mePath("search"),
        query: { q, limit: query.limit, usable: query.usable ? 1 : undefined },
      },
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

  // -------------------------------------------------------------------------
  // Using things (CP-11)
  //
  // Every write answers `{ item, move, txn }`: the item as it is now, the
  // stock move, and the transaction it posted (null when it moved no money).
  // POSTs take `opts.idempotencyKey`: the same key twice moves the stock once.
  // -------------------------------------------------------------------------

  /**
   * POST /v1/organizations/:orgId/kitchen/items/:itemId/uses
   *
   * Members, owners and admins. `consumers` (default: the caller) owe the
   * cost — equally, or by `weights` — and the buyer is paid back. More than
   * is left is a `ConflictError` with `reason: "insufficient_stock"`; someone
   * not in the group a `ValidationError` with `reason: "not_in_group"`.
   */
  useGroupItem(
    orgId: string,
    itemId: string,
    body: UseGroupItemRequest,
    opts: RequestOptions = {},
  ): Promise<StockMoveResponse> {
    return this.transport.request<StockMoveResponse>(
      { method: "POST", path: this.groupPath(orgId, `items/${encodeURIComponent(itemId)}/uses`), body },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/items/:itemId/waste
   *
   * Everything left unless `quantity` says otherwise. Split equally (a
   * `waste` transaction every member shares) or absorbed by the buyer, by the
   * item's rule or the group's.
   */
  wasteGroupItem(
    orgId: string,
    itemId: string,
    body: WasteItemRequest = {},
    opts: RequestOptions = {},
  ): Promise<StockMoveResponse> {
    return this.transport.request<StockMoveResponse>(
      { method: "POST", path: this.groupPath(orgId, `items/${encodeURIComponent(itemId)}/waste`), body },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/kitchen/items/:itemId/moves — the item's history, newest first. */
  groupItemMoves(orgId: string, itemId: string, query: MovesQuery = {}, opts: RequestOptions = {}): Promise<MovesResponse> {
    return this.transport.request<MovesResponse>(
      {
        method: "GET",
        path: this.groupPath(orgId, `items/${encodeURIComponent(itemId)}/moves`),
        query: { limit: query.limit },
      },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/moves/:moveId/undo
   *
   * Puts back a group move that moved no money (a buyer's own use, waste the
   * buyer absorbed): its logger, or an owner or admin. A move with a
   * transaction is undone with `reverseTxn` (`reason: "has_transaction"`);
   * only the latest move of an item (`reason: "not_latest"`).
   */
  undoGroupMove(orgId: string, moveId: string, opts: RequestOptions = {}): Promise<StockMoveResponse> {
    return this.transport.request<StockMoveResponse>(
      { method: "POST", path: this.groupPath(orgId, `moves/${encodeURIComponent(moveId)}/undo`), body: {} },
      opts,
    );
  }

  /** POST /v1/kitchen/me/items/:itemId/uses — use some of the caller's own item (no ledger). */
  usePersonalItem(itemId: string, body: UsePersonalItemRequest, opts: RequestOptions = {}): Promise<StockMoveResponse> {
    return this.transport.request<StockMoveResponse>(
      { method: "POST", path: this.mePath(`items/${encodeURIComponent(itemId)}/uses`), body },
      opts,
    );
  }

  /** POST /v1/kitchen/me/items/:itemId/waste — everything left unless `quantity` says otherwise. */
  wastePersonalItem(itemId: string, body: WasteItemRequest = {}, opts: RequestOptions = {}): Promise<StockMoveResponse> {
    return this.transport.request<StockMoveResponse>(
      { method: "POST", path: this.mePath(`items/${encodeURIComponent(itemId)}/waste`), body },
      opts,
    );
  }

  /**
   * POST /v1/kitchen/me/items/:itemId/transfer
   *
   * Move an unused personal item into a group's pantry (`reason:
   * "item_used"` once any is used; `"currency_mismatch"` for a group counting
   * in another currency).
   */
  transferPersonalItem(
    itemId: string,
    body: TransferItemRequest,
    opts: RequestOptions = {},
  ): Promise<StockMoveResponse> {
    return this.transport.request<StockMoveResponse>(
      { method: "POST", path: this.mePath(`items/${encodeURIComponent(itemId)}/transfer`), body },
      opts,
    );
  }

  /** GET /v1/kitchen/me/items/:itemId/moves — the item's history, newest first. */
  personalItemMoves(itemId: string, query: MovesQuery = {}, opts: RequestOptions = {}): Promise<MovesResponse> {
    return this.transport.request<MovesResponse>(
      { method: "GET", path: this.mePath(`items/${encodeURIComponent(itemId)}/moves`), query: { limit: query.limit } },
      opts,
    );
  }

  /** POST /v1/kitchen/me/moves/:moveId/undo — put back the latest use or waste of one of the caller's items. */
  undoPersonalMove(moveId: string, opts: RequestOptions = {}): Promise<StockMoveResponse> {
    return this.transport.request<StockMoveResponse>(
      { method: "POST", path: this.mePath(`moves/${encodeURIComponent(moveId)}/undo`), body: {} },
      opts,
    );
  }

  /** GET /v1/kitchen/me/usuals — what the caller often uses, most first: presets and "Do it again". */
  usuals(query: UsualsQuery = {}, opts: RequestOptions = {}): Promise<UsualsResponse> {
    return this.transport.request<UsualsResponse>(
      { method: "GET", path: this.mePath("usuals"), query: { limit: query.limit } },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Dishes (CP-14)
  //
  // A dish takes ingredients from the caller's own pantry and any group
  // pantry they may use, charging them each buyer's share in that group.
  // POSTs take `opts.idempotencyKey`: the same key twice cooks once.
  // -------------------------------------------------------------------------

  /**
   * POST /v1/kitchen/me/dishes
   *
   * Cook: every ingredient's stock comes out and the cook owes each buyer in
   * their group, in one write. An ingredient the caller may not use is a
   * `NotFoundError`; not that much left a `ConflictError` with `reason:
   * "insufficient_stock"`; another currency a `ValidationError` with
   * `reason: "currency_mismatch"`. Nothing is written on any refusal.
   */
  cookDish(body: CookDishRequest, opts: RequestOptions = {}): Promise<CookDishResponse> {
    return this.transport.request<CookDishResponse>({ method: "POST", path: this.mePath("dishes"), body }, opts);
  }

  /** GET /v1/kitchen/me/dishes — dishes the caller cooked or that are shared with their groups, newest first. */
  myDishes(query: DishesQuery = {}, opts: RequestOptions = {}): Promise<DishesPage> {
    return this.transport.request<DishesPage>(
      {
        method: "GET",
        path: this.mePath("dishes"),
        query: { state: query.state, cursor: query.cursor, limit: query.limit },
      },
      opts,
    );
  }

  /** GET /v1/kitchen/me/dishes/:dishId — its cook, or a member of its group. */
  getDish(dishId: string, opts: RequestOptions = {}): Promise<DishResponse> {
    return this.transport.request<DishResponse>(
      { method: "GET", path: this.mePath(`dishes/${encodeURIComponent(dishId)}`) },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/kitchen/dishes — the dishes shared with one group, newest first. */
  groupDishes(orgId: string, query: DishesQuery = {}, opts: RequestOptions = {}): Promise<DishesPage> {
    return this.transport.request<DishesPage>(
      {
        method: "GET",
        path: this.groupPath(orgId, "dishes"),
        query: { state: query.state, cursor: query.cursor, limit: query.limit },
      },
      opts,
    );
  }

  /**
   * POST /v1/kitchen/me/dishes/:dishId/cancel
   *
   * Its cook, while it is not finalized (`ConflictError`, `reason:
   * "dish_not_open"`): every ingredient goes back and its charges are
   * reversed, in one write.
   */
  cancelDish(dishId: string, opts: RequestOptions = {}): Promise<CancelDishResponse> {
    return this.transport.request<CancelDishResponse>(
      { method: "POST", path: this.mePath(`dishes/${encodeURIComponent(dishId)}/cancel`), body: {} },
      opts,
    );
  }
}
