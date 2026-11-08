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
  ClaimDishRequest,
  ClaimDishResponse,
  CorrectDishRequest,
  CorrectDishResponse,
  FinalizeDishResponse,
  SetDishSharesRequest,
  SetDishSharesResponse,
  SetPortionRequest,
  SetPortionResponse,
  CookDishRequest,
  CookDishResponse,
  DishResponse,
  DishesPage,
  DishesQuery,
  GroupMembersResponse,
  InboxResponse,
  MyBalancesResponse,
  PersonViewResponse,
} from "@saas/contracts/kitchen";

import type { RequestOptions, Transport } from "./transport.js";
// "From before" (SM-8).
import type { ItemHistoryQuery, ItemHistoryResponse, RecipesQuery, RecipesResponse } from "@saas/contracts/kitchen";
// Your measures (SM-13).
import type { ItemScope, KitchenMeasureInput, SetMeasuresRequest, SetMeasuresResponse } from "@saas/contracts/kitchen";
// Foods and recipes (RC-4).
import type {
  AlwaysHaveResponse,
  CookNowResponse,
  CopyRecipeRequest,
  CreateRecipeBody,
  ExploreRecipesQuery,
  ExploreRecipesResponse,
  FoodsQuery,
  FoodsResponse,
  MyRecipesResponse,
  PersonRecipesResponse,
  RecipeMatchQuery,
  RecipeQuery,
  RecipeMatchResponse,
  RecipeResponse,
  SetAlwaysHaveRequest,
  SetFoodAnswerRequest,
  SetFoodAnswerResponse,
  UpdateRecipeRequest,
} from "@saas/contracts/kitchen";
// Guided steps (GC-2).
import type { UpdateStepTimesRequest } from "@saas/contracts/kitchen";
// Timers that find you (GC-3).
import type { CreateKitchenTimerRequest, KitchenTimerResponse, KitchenTimersResponse } from "@saas/contracts/kitchen";

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

  /**
   * POST /v1/kitchen/me/items — add to the caller's personal pantry. An
   * optional `note` (RC-3, at most 80 characters) is read by the caller alone.
   */
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
   * version (`reason: "version_conflict"`). `note` (RC-3) changes at any
   * time; `null` or "" clears it.
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
   * "not_in_group"`). An optional `note` (RC-3) is read by everyone in the
   * group.
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
   * "not_buyer"`). Quantity and price only while nothing has been used;
   * `note` (RC-3) at any time.
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
   * `measure` (one of the item's measures, SM-13) instead of `unit` counts
   * `quantity` in it; the move keeps its words as `label` ("2 onions").
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

  /** POST /v1/kitchen/me/items/:itemId/uses — use some of the caller's own item (no ledger); `measure` as on `useGroupItem`. */
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

  /**
   * GET /v1/kitchen/me/usuals — what the caller often uses, most first: presets and "Do it again".
   * With `tzOffset` (minutes east of UTC: `-new Date().getTimezoneOffset()`), each usual carries
   * the current bucket's `now` and `strip`, and the answer its `bucket` (PN-2).
   */
  usuals(query: UsualsQuery = {}, opts: RequestOptions = {}): Promise<UsualsResponse> {
    return this.transport.request<UsualsResponse>(
      { method: "GET", path: this.mePath("usuals"), query: { limit: query.limit, tzOffset: query.tzOffset } },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Your measures (SM-13)
  // -------------------------------------------------------------------------

  /**
   * PUT /v1/kitchen/me/items/:itemId/measures (`scope` personal) or
   * PUT /v1/organizations/:orgId/kitchen/items/:itemId/measures (`scope` a
   * group — anyone who may use its items, not a viewer).
   *
   * Replaces the measures of the item's name in its pantry, for its
   * dimension (0–3; `[]` removes them): every item of that name there reads
   * them as `measures`. `scope` is an item's `pantry`, or any
   * `{ kind: "group", orgId }`. Invalid words or numbers are a
   * `ValidationError` with field errors; an item the caller cannot use a
   * `NotFoundError`. A use or ingredient then takes `measure` (the `one`)
   * instead of `unit`.
   */
  setMeasures(
    scope: ItemScope,
    itemId: string,
    measures: KitchenMeasureInput[],
    opts: RequestOptions = {},
  ): Promise<SetMeasuresResponse> {
    const rest = `items/${encodeURIComponent(itemId)}/measures`;
    const body: SetMeasuresRequest = { measures };
    return this.transport.request<SetMeasuresResponse>(
      { method: "PUT", path: scope.kind === "group" ? this.groupPath(scope.orgId, rest) : this.mePath(rest), body },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // From before (SM-8)
  //
  // The type-ahead on Bought and Cook: what the caller (or their groups)
  // bought and cooked before, grouped by name, best match and newest first —
  // one database read each, so they can run as someone types.
  // -------------------------------------------------------------------------

  /**
   * GET /v1/kitchen/me/items/history
   *
   * Names bought before across the caller's own pantry and their groups —
   * used up and wasted ones too — each with last time's quantity, unit,
   * price, pantry, buyer, waste rule and use-by offset, and how often it was
   * bought. An empty `q` lists the most recent (`limit` 1–20, default 8).
   */
  itemHistory(q = "", query: Omit<ItemHistoryQuery, "q"> = {}, opts: RequestOptions = {}): Promise<ItemHistoryResponse> {
    return this.transport.request<ItemHistoryResponse>(
      { method: "GET", path: this.mePath("items/history"), query: { q: q || undefined, limit: query.limit } },
      opts,
    );
  }

  /**
   * GET /v1/kitchen/me/dishes/recipes
   *
   * Dishes cooked before — the caller's and those shared with their groups —
   * each with last time's portions and extras and its ingredients, every one
   * matched to an item the caller may use now (`match`, null when there is
   * none). An empty `q` lists the most recent (`limit` 1–20, default 8).
   */
  recipes(q = "", query: Omit<RecipesQuery, "q"> = {}, opts: RequestOptions = {}): Promise<RecipesResponse> {
    return this.transport.request<RecipesResponse>(
      { method: "GET", path: this.mePath("dishes/recipes"), query: { q: q || undefined, limit: query.limit } },
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

  // -------------------------------------------------------------------------
  // Splitting dishes (CP-16)
  //
  // A dish shared with a group is split among the people who ate it: members
  // claim half portions of an open dish, or its cook assigns portions or exact
  // amounts. Finalizing posts one `dish` transaction (eaters owe the cook) and
  // files unclaimed portions as leftovers in the cook's pantry; a correction
  // reverses it and posts a new one. Every route answers `{ dish }`.
  // -------------------------------------------------------------------------

  /**
   * PUT /v1/organizations/:orgId/kitchen/dishes/:dishId/claims/me
   *
   * Claim `portionsHalf` half portions of an open dish for the caller (0
   * takes the claim back). More than is free is a `ConflictError` with
   * `reason: "claims_exceed_portions"` (`details.availableHalf`); a dish that
   * is not open, `reason: "dish_not_open"`. A viewer gets a `NotFoundError`.
   */
  claimDish(orgId: string, dishId: string, body: ClaimDishRequest, opts: RequestOptions = {}): Promise<ClaimDishResponse> {
    return this.transport.request<ClaimDishResponse>(
      { method: "PUT", path: this.groupPath(orgId, `dishes/${encodeURIComponent(dishId)}/claims/me`), body },
      opts,
    );
  }

  /**
   * PUT /v1/organizations/:orgId/kitchen/dishes/:dishId/shares
   *
   * The cook (or an owner or admin) replaces every share of a draft or open
   * dish: half portions or an exact amount each. Someone outside the group is
   * a `ValidationError` with `reason: "not_in_group"`; portions over what was
   * cooked a `ConflictError` with `reason: "claims_exceed_portions"`.
   */
  setDishShares(orgId: string, dishId: string, body: SetDishSharesRequest, opts: RequestOptions = {}): Promise<SetDishSharesResponse> {
    return this.transport.request<SetDishSharesResponse>(
      { method: "PUT", path: this.groupPath(orgId, `dishes/${encodeURIComponent(dishId)}/shares`), body },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/dishes/:dishId/finalize
   *
   * The cook (or an owner or admin, for a stuck dish) finalizes a draft or
   * open dish: one `dish` transaction, and leftovers for what nobody had.
   * Finalizing a finalized dish answers it as it is. Pass
   * `opts.idempotencyKey`.
   */
  finalizeDish(orgId: string, dishId: string, opts: RequestOptions = {}): Promise<FinalizeDishResponse> {
    return this.transport.request<FinalizeDishResponse>(
      { method: "POST", path: this.groupPath(orgId, `dishes/${encodeURIComponent(dishId)}/finalize`), body: {} },
      opts,
    );
  }

  /**
   * POST /v1/kitchen/me/dishes/:dishId/finalize
   *
   * The cook finalizes their own dish: one just for them is only marked
   * finalized (nothing to split); a shared one is finalized as
   * `finalizeDish` does.
   */
  finalizeMyDish(dishId: string, opts: RequestOptions = {}): Promise<FinalizeDishResponse> {
    return this.transport.request<FinalizeDishResponse>(
      { method: "POST", path: this.mePath(`dishes/${encodeURIComponent(dishId)}/finalize`), body: {} },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/dishes/:dishId/correct
   *
   * The cook (or an owner or admin) corrects a finalized dish's shares: its
   * dish transaction is reversed and a new one posted, in one write, and its
   * untouched leftovers follow. A dish that is not finalized is a
   * `ConflictError` with `reason: "dish_not_open"`. Pass
   * `opts.idempotencyKey`: the same key twice corrects once.
   */
  correctDish(orgId: string, dishId: string, body: CorrectDishRequest, opts: RequestOptions = {}): Promise<CorrectDishResponse> {
    return this.transport.request<CorrectDishResponse>(
      { method: "POST", path: this.groupPath(orgId, `dishes/${encodeURIComponent(dishId)}/correct`), body },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Anyone's portion (SM-6)
  // -------------------------------------------------------------------------

  /**
   * PUT /v1/organizations/:orgId/kitchen/dishes/:dishId/claims/:subjectId
   *
   * Any member (not a viewer) sets any member's half portions of an open dish
   * (0 takes them back); `subjectId` `"me"` is the caller, as `claimDish`.
   * The share records who set it (`setBy`), and the person is emailed once
   * per dish when it was someone else. More than is free is a
   * `ConflictError` with `reason: "claims_exceed_portions"`
   * (`details.availableHalf`); a dish that is not open, `reason:
   * "dish_not_open"`; someone not in the group a `ValidationError` with
   * `reason: "not_in_group"`. A viewer gets a `NotFoundError`.
   */
  setPortion(
    orgId: string,
    dishId: string,
    subjectId: string,
    body: SetPortionRequest,
    opts: RequestOptions = {},
  ): Promise<SetPortionResponse> {
    return this.transport.request<SetPortionResponse>(
      {
        method: "PUT",
        path: this.groupPath(orgId, `dishes/${encodeURIComponent(dishId)}/claims/${encodeURIComponent(subjectId)}`),
        body,
      },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // People across groups (CP-9)
  // -------------------------------------------------------------------------

  /**
   * GET /v1/kitchen/me/balances
   *
   * The caller's groups (balance, role, member count), everyone they share a
   * group with and what each group's settle plan has between them, and the
   * totals per currency — one read for Home, People and Settle up.
   */
  myBalances(opts: RequestOptions = {}): Promise<MyBalancesResponse> {
    return this.transport.request<MyBalancesResponse>({ method: "GET", path: this.mePath("balances") }, opts);
  }

  /**
   * GET /v1/kitchen/me/people/:subjectId
   *
   * Every amount between the caller and one person, in each group they
   * share: the lines, what they owe each other directly, what the plan asks,
   * and the group shortcut. A `NotFoundError` when they share no group.
   */
  person(subjectId: string, opts: RequestOptions = {}): Promise<PersonViewResponse> {
    return this.transport.request<PersonViewResponse>(
      { method: "GET", path: this.mePath(`people/${encodeURIComponent(subjectId)}`) },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/kitchen/members — who is in the group, by name and role (any member). */
  groupMembers(orgId: string, opts: RequestOptions = {}): Promise<GroupMembersResponse> {
    return this.transport.request<GroupMembersResponse>({ method: "GET", path: this.groupPath(orgId, "members") }, opts);
  }

  // -------------------------------------------------------------------------
  // Home's inbox (CP-19)
  // -------------------------------------------------------------------------

  /**
   * GET /v1/kitchen/me/inbox
   *
   * Everything that needs the caller, most urgent first: dishes to claim or
   * finalize, items to use soon (with their usual amount), payments they owe
   * and open flags on their entries — each with what its one-tap action
   * needs — and how many of each.
   */
  inbox(opts: RequestOptions = {}): Promise<InboxResponse> {
    return this.transport.request<InboxResponse>({ method: "GET", path: this.mePath("inbox") }, opts);
  }

  // -------------------------------------------------------------------------
  // Foods and recipes (RC-4)
  //
  // The shared food list, Always have, recipes (templates: they never move
  // money), what your pantries hold for one, sharing (Only me · My groups ·
  // link), copies, a person's recipes, Explore and Cook now. Anything the
  // caller may not see is a `NotFoundError`; a bad body a `ValidationError`
  // with field errors. Cooking from a recipe is `cookDish` with `recipeId`,
  // `recipeFactorMilli` and each ingredient's `recipeLine`.
  // -------------------------------------------------------------------------

  /** GET /v1/kitchen/foods — the food list, foods whose names match `q` first (`matchedName` says which). */
  foods(query: FoodsQuery = {}, opts: RequestOptions = {}): Promise<FoodsResponse> {
    return this.transport.request<FoodsResponse>(
      { method: "GET", path: "/v1/kitchen/foods", query: { q: query.q || undefined, limit: query.limit } },
      opts,
    );
  }

  /**
   * PUT /v1/kitchen/me/food-answers — "Is Kanda onion?", answered once for a
   * name in the caller's own pantry (no `orgId`) or a group's (not as a
   * viewer). `foodKey: null` answers "none of these". Every item of that
   * name there is relinked at once (`linkedItems`).
   */
  setFoodAnswer(body: SetFoodAnswerRequest, opts: RequestOptions = {}): Promise<SetFoodAnswerResponse> {
    return this.transport.request<SetFoodAnswerResponse>({ method: "PUT", path: this.mePath("food-answers"), body }, opts);
  }

  /** GET /v1/kitchen/me/always-have — the caller's list (salt and water, `isDefault`, until they save one). */
  alwaysHave(opts: RequestOptions = {}): Promise<AlwaysHaveResponse> {
    return this.transport.request<AlwaysHaveResponse>({ method: "GET", path: this.mePath("always-have") }, opts);
  }

  /** PUT /v1/kitchen/me/always-have — replace the list (an empty one stays empty). */
  setAlwaysHave(foodKeys: string[], opts: RequestOptions = {}): Promise<AlwaysHaveResponse> {
    const body: SetAlwaysHaveRequest = { foodKeys };
    return this.transport.request<AlwaysHaveResponse>({ method: "PUT", path: this.mePath("always-have"), body }, opts);
  }

  /** GET /v1/kitchen/me/recipes — the caller's recipes and copies, last cooked first. */
  myRecipes(opts: RequestOptions = {}): Promise<MyRecipesResponse> {
    return this.transport.request<MyRecipesResponse>({ method: "GET", path: this.mePath("recipes") }, opts);
  }

  /**
   * POST /v1/kitchen/me/recipes — write a recipe (My groups unless said), or
   * with `fromDishId` save a dish as one: its ingredients at the amounts
   * used, its portions as serves, the heaviest as the main line.
   */
  createRecipe(body: CreateRecipeBody, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>({ method: "POST", path: this.mePath("recipes"), body }, opts);
  }

  /**
   * GET /v1/kitchen/recipes/:recipeId — a recipe the caller may see (`code`
   * lets a link holder in), with their last cook of it. Its guided steps
   * carry `learned` once cooks have taught them (GC-7), at size `f`
   * (thousandths, default 1000: the recipe as written).
   */
  getRecipe(recipeId: string, query: RecipeQuery = {}, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>(
      { method: "GET", path: `/v1/kitchen/recipes/${encodeURIComponent(recipeId)}`, query: { code: query.code, f: query.f } },
      opts,
    );
  }

  /**
   * PATCH /v1/kitchen/me/recipes/:recipeId — its owner; `lines`, `steps` and
   * `tools` replace the whole list (a step that sends its key keeps it).
   * Copies never change.
   */
  updateRecipe(recipeId: string, body: UpdateRecipeRequest, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>(
      { method: "PATCH", path: this.mePath(`recipes/${encodeURIComponent(recipeId)}`), body },
      opts,
    );
  }

  /**
   * PATCH /v1/kitchen/me/recipes/:recipeId/step-times — its owner: "Use
   * today's times" (GC-2). Sets these steps' ranges by key, at the recipe's
   * own size; every other step stays as it is.
   */
  updateStepTimes(recipeId: string, body: UpdateStepTimesRequest, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>(
      { method: "PATCH", path: this.mePath(`recipes/${encodeURIComponent(recipeId)}/step-times`), body },
      opts,
    );
  }

  /** DELETE /v1/kitchen/me/recipes/:recipeId — its owner; gone for everyone, its copies kept. */
  deleteRecipe(recipeId: string, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>(
      { method: "DELETE", path: this.mePath(`recipes/${encodeURIComponent(recipeId)}`) },
      opts,
    );
  }

  /**
   * GET /v1/kitchen/me/recipes/:recipeId/match — each line at factor `f`
   * (thousandths, default 1000) as have, short, missing or always, with the
   * items it would take, the largest factor the stock allows, and the
   * unlinked items to ask about. A read: it reserves nothing.
   */
  recipeMatch(recipeId: string, query: RecipeMatchQuery = {}, opts: RequestOptions = {}): Promise<RecipeMatchResponse> {
    return this.transport.request<RecipeMatchResponse>(
      { method: "GET", path: this.mePath(`recipes/${encodeURIComponent(recipeId)}/match`), query: { f: query.f, code: query.code } },
      opts,
    );
  }

  /** POST /v1/kitchen/me/recipes/:recipeId/link — its owner: a new link code (`recipe.linkCode`); the old one stops at once. */
  shareRecipeLink(recipeId: string, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>(
      { method: "POST", path: this.mePath(`recipes/${encodeURIComponent(recipeId)}/link`), body: {} },
      opts,
    );
  }

  /** DELETE /v1/kitchen/me/recipes/:recipeId/link — its owner: the link off, the recipe back to My groups. */
  stopRecipeLink(recipeId: string, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>(
      { method: "DELETE", path: this.mePath(`recipes/${encodeURIComponent(recipeId)}/link`) },
      opts,
    );
  }

  /** GET /v1/kitchen/recipe-links/:code — the recipe a link opens, for anyone signed in; `learned` at size `f`, as on `getRecipe`. */
  recipeByLink(code: string, query: Pick<RecipeQuery, "f"> = {}, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>(
      { method: "GET", path: `/v1/kitchen/recipe-links/${encodeURIComponent(code)}`, query: { f: query.f } },
      opts,
    );
  }

  /** POST /v1/kitchen/me/recipes/copies — save your own Only-me copy, by id or by link code ("from Anu"). */
  copyRecipe(body: CopyRecipeRequest, opts: RequestOptions = {}): Promise<RecipeResponse> {
    return this.transport.request<RecipeResponse>({ method: "POST", path: this.mePath("recipes/copies"), body }, opts);
  }

  /** GET /v1/kitchen/people/:subjectId/recipes — someone you share a group with: their My groups and link recipes. */
  personRecipes(subjectId: string, opts: RequestOptions = {}): Promise<PersonRecipesResponse> {
    return this.transport.request<PersonRecipesResponse>(
      { method: "GET", path: `/v1/kitchen/people/${encodeURIComponent(subjectId)}/recipes` },
      opts,
    );
  }

  /** GET /v1/kitchen/recipes — Explore: Cookpool's own (default) or your groups', newest first, each with its match. */
  exploreRecipes(query: ExploreRecipesQuery = {}, opts: RequestOptions = {}): Promise<ExploreRecipesResponse> {
    return this.transport.request<ExploreRecipesResponse>(
      { method: "GET", path: "/v1/kitchen/recipes", query: { source: query.source, q: query.q || undefined, kind: query.kind } },
      opts,
    );
  }

  /** GET /v1/kitchen/me/cook-now — what the caller can make: fewest missing first, then the largest factor, then the most recently cooked. */
  cookNow(opts: RequestOptions = {}): Promise<CookNowResponse> {
    return this.transport.request<CookNowResponse>({ method: "GET", path: this.mePath("cook-now") }, opts);
  }

  // -------------------------------------------------------------------------
  // Timers that find you (GC-3)
  //
  // A timer the caller sets is pushed to every device they have subscribed
  // within a minute of its end — no preference involved. Guided mode sets one
  // whenever it starts a timer and cancels it on Pause, Done early or a tick.
  // At most KITCHEN_TIMERS_MAX_ACTIVE active at once: one more is a
  // `ValidationError` whose details carry `reason: "too_many_timers"`.
  // -------------------------------------------------------------------------

  /** GET /v1/kitchen/me/timers — the caller's active timers (not sent, not cancelled), soonest first. */
  timers(opts: RequestOptions = {}): Promise<KitchenTimersResponse> {
    return this.transport.request<KitchenTimersResponse>({ method: "GET", path: this.mePath("timers") }, opts);
  }

  /**
   * POST /v1/kitchen/me/timers — set a timer ending at `endsAt`, 30 s to 24 h
   * ahead. `label` is the push's title, `body` its text, `url` the app path
   * it opens (the cooking session when left out).
   */
  createTimer(body: CreateKitchenTimerRequest, opts: RequestOptions = {}): Promise<KitchenTimerResponse> {
    return this.transport.request<KitchenTimerResponse>({ method: "POST", path: this.mePath("timers"), body }, opts);
  }

  /**
   * DELETE /v1/kitchen/me/timers/:timerId — cancel it so it is never pushed.
   * A repeat answers the same; a timer already pushed comes back with
   * `sentAt` set. Anyone else's timer is a `NotFoundError`.
   */
  cancelTimer(timerId: string, opts: RequestOptions = {}): Promise<KitchenTimerResponse> {
    return this.transport.request<KitchenTimerResponse>(
      { method: "DELETE", path: this.mePath(`timers/${encodeURIComponent(timerId)}`) },
      opts,
    );
  }
}
