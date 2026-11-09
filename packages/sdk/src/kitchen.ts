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
// The stock check (PN-4).
import type { CheckGroupItemRequest, CheckItemResponse, CheckPersonalItemRequest } from "@saas/contracts/kitchen";
// Guided steps (GC-2).
import type { UpdateStepTimesRequest } from "@saas/contracts/kitchen";
// Timers that find you (GC-3).
import type { CreateKitchenTimerRequest, KitchenTimerResponse, KitchenTimersResponse } from "@saas/contracts/kitchen";
// Cookpool AI (AI-2).
import type { AiReceiptResponse, AiRecipePhotoResponse, AiStatus, AiUsesResponse } from "@saas/contracts/kitchen";
// Restocking and shopping runs (PN-3).
import type { PurchaseLine, PurchaseResponse, RestockResponse, UndoPurchaseResponse } from "@saas/contracts/kitchen";
// Ask before use (PN-8).
import type { ApproveAskRequest, ApproveAskResponse, AskResponse, AsksResponse, AskToUseRequest } from "@saas/contracts/kitchen";
// Profiles and following (CM-2).
import type {
  BlockResponse,
  BlocksResponse,
  FollowResponse,
  HandleAvailabilityResponse,
  MuteResponse,
  MyProfileResponse,
  PeoplePage,
  PeoplePageQuery,
  PeopleSearchResponse,
  PeopleSuggestionsResponse,
  PersonProfileResponse,
  ProfileRecipesResponse,
  RemoveFollowerResponse,
  SaveMyProfileRequest,
} from "@saas/contracts/kitchen";
// Posts, the feed, Yum, comments, reports and Activity (CM-3).
import type {
  ActivityResponse,
  AddCommentRequest,
  CommentResponse,
  CommentsResponse,
  CreatePostRequest,
  CreateReportRequest,
  DeleteCommentResponse,
  DeletePostResponse,
  FeedQuery,
  FeedResponse,
  MarkActivityReadResponse,
  PostResponse,
  ProfilePostsResponse,
  ReportResponse,
  UnreadActivityResponse,
  UpdatePostRequest,
  YumResponse,
} from "@saas/contracts/kitchen";
// Cooked, then split later (CM-8).
import type { SplitDishRequest, SplitDishResponse, SplitReminderDismissResponse } from "@saas/contracts/kitchen";

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
   * `note` (RC-3) at any time. `askFirst` and `allowed` (PN-8) are the
   * buyer's alone while they are in the group, then an owner's or admin's.
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

  // -------------------------------------------------------------------------
  // The stock check (PN-4)
  //
  // Set what is really left (`left`, 0 for empty) and say where the rest went
  // (`gone`, required when it is less). Less is written as the use or waste
  // it was — so it is undone as they are: `reverseTxn` when it posted a
  // transaction, else `undo…Move`. More is an `adjust` that moves no money,
  // undone with `undo…Move` while the difference is still there. Every move
  // carries `via: "check"`. The same level is a `ValidationError` with
  // `reason: "unchanged"`; above what was bought, `reason: "more_than_bought"`.
  // POSTs take `opts.idempotencyKey`: the same key twice checks once.
  // -------------------------------------------------------------------------

  /**
   * POST /v1/organizations/:orgId/kitchen/items/:itemId/check — anyone who may
   * use the item. `gone: "split"` charges every current member an equal
   * share; `"me"` the caller; `"waste"` follows the item's waste rule.
   */
  checkGroupItem(
    orgId: string,
    itemId: string,
    body: CheckGroupItemRequest,
    opts: RequestOptions = {},
  ): Promise<CheckItemResponse> {
    return this.transport.request<CheckItemResponse>(
      { method: "POST", path: this.groupPath(orgId, `items/${encodeURIComponent(itemId)}/check`), body },
      opts,
    );
  }

  /** POST /v1/kitchen/me/items/:itemId/check — the caller's own item: `gone` is `"me"` or `"waste"`. */
  checkPersonalItem(itemId: string, body: CheckPersonalItemRequest, opts: RequestOptions = {}): Promise<CheckItemResponse> {
    return this.transport.request<CheckItemResponse>(
      { method: "POST", path: this.mePath(`items/${encodeURIComponent(itemId)}/check`), body },
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

  // -------------------------------------------------------------------------
  // Cookpool AI (AI-2)
  //
  // AI proposes, the caller confirms: nothing here writes. Without a key on
  // the server an AI call is an `InternalError` (503) with
  // `details.reason: "ai_unavailable"` — `ai()` says so up front with
  // `available: false`. Past today's limit it is a `RateLimitError` with
  // `details.reason: "ai_daily_limit"`; a refusal or a bad read is an
  // `InternalError` (502) with `details.reason: "ai_failed"`. AI-13: past
  // today's 10 receipts a `RateLimitError` with `receipt_daily_limit`; once
  // the month's AI budget is spent an `InternalError` (503) with
  // `details.reason: "budget"`, and `ai()` says `available: false`,
  // `budget: "reached"`.
  // -------------------------------------------------------------------------

  /** GET /v1/kitchen/me/ai — is AI set up, which features the server offers, and today's use against the limits. */
  ai(opts: RequestOptions = {}): Promise<AiStatus> {
    return this.transport.request<AiStatus>({ method: "GET", path: this.mePath("ai") }, opts);
  }

  /**
   * POST /v1/kitchen/me/ai/uses — read one sentence (≤ AI_USES_TEXT_MAX
   * characters) into proposed uses of the caller's items, and the words that
   * matched nothing. Log the confirmed lines through `usePersonalItem` /
   * `useGroupItem`.
   */
  aiUses(text: string, opts: RequestOptions = {}): Promise<AiUsesResponse> {
    return this.transport.request<AiUsesResponse>({ method: "POST", path: this.mePath("ai/uses"), body: { text } }, opts);
  }

  /**
   * POST /v1/kitchen/me/ai/receipt — read one receipt photo (`image`: base64
   * JPEG or WebP, ≤ AI_RECEIPT_MAX_BYTES decoded) into lines matched to the
   * caller's history and the food list, each `sure` or `check`, and the total
   * checked against them. Nothing is stored; add the confirmed lines with
   * `buy`. A bad photo is a `ValidationError` on field `image`.
   */
  aiReceipt(image: string, opts: RequestOptions = {}): Promise<AiReceiptResponse> {
    return this.transport.request<AiReceiptResponse>({ method: "POST", path: this.mePath("ai/receipt"), body: { image } }, opts);
  }

  /**
   * POST /v1/kitchen/me/ai/recipe-photo (AI-4) — read one recipe photo
   * (`image`: base64 JPEG or WebP, ≤ AI_RECIPE_PHOTO_MAX_BYTES decoded) into
   * a draft in the create route's shape, lines matched to the food list, and
   * the `checks` to mark in the form. Nothing is saved: Save the edited draft
   * with `createRecipe`. A bad photo is a `ValidationError` on field `image`.
   */
  aiRecipePhoto(image: string, opts: RequestOptions = {}): Promise<AiRecipePhotoResponse> {
    return this.transport.request<AiRecipePhotoResponse>({ method: "POST", path: this.mePath("ai/recipe-photo"), body: { image } }, opts);
  }

  // -------------------------------------------------------------------------
  // Restocking (PN-3)
  //
  // What to buy again across every pantry the caller can reach, and the
  // shopping run that buys it in one write paid by the caller. `buy` takes
  // `opts.idempotencyKey`: the same key twice buys once. A line whose pantry
  // is out of reach refuses the whole run (`ValidationError`, field
  // `lines[i].pantry`); a group line in another currency is a
  // `ValidationError` with `reason: "currency_mismatch"`.
  // -------------------------------------------------------------------------

  /**
   * GET /v1/kitchen/me/restock — `{ finished, runningLow, usual }`: each name
   * and pantry once, with its reason, why, and the last purchase to fill a
   * line from.
   */
  restock(opts: RequestOptions = {}): Promise<RestockResponse> {
    return this.transport.request<RestockResponse>({ method: "GET", path: this.mePath("restock") }, opts);
  }

  /**
   * POST /v1/kitchen/me/purchases — add 1 to 30 lines, each to its own
   * pantry, in one write under one purchase (`pur_…`), paid by the caller.
   */
  buy(lines: readonly PurchaseLine[], opts: RequestOptions = {}): Promise<PurchaseResponse> {
    return this.transport.request<PurchaseResponse>(
      { method: "POST", path: this.mePath("purchases"), body: { lines } },
      opts,
    );
  }

  /**
   * DELETE /v1/kitchen/me/purchases/:purchaseId — the run's Undo: removes
   * its items still unused and lists the ones kept. Someone else's purchase
   * is a `NotFoundError`.
   */
  undoPurchase(purchaseId: string, opts: RequestOptions = {}): Promise<UndoPurchaseResponse> {
    return this.transport.request<UndoPurchaseResponse>(
      { method: "DELETE", path: this.mePath(`purchases/${encodeURIComponent(purchaseId)}`) },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Ask before use (PN-8)
  //
  // On a group item whose buyer turned on `askFirst`, anyone else not in
  // `allowed` asks (`item.mustAsk`); using it directly is a `ForbiddenError`
  // with `reason: "ask_first"`. The answerer (`item.answerer`: the buyer, or
  // an owner or admin once they have left) approves — posting the use as the
  // asker would have, undone as that use is — declines, or reopens a
  // declined ask; the asker cancels. A pending ask lapses after 24 hours, or
  // when its item is finished or stops asking first (`ConflictError`,
  // `reason: "lapsed"`); an answered one is `reason: "not_pending"`. POSTs
  // take `opts.idempotencyKey`.
  // -------------------------------------------------------------------------

  /**
   * POST /v1/organizations/:orgId/kitchen/items/:itemId/asks — ask for an
   * amount (a unit or one of the item's measures) for `consumers` (default
   * the caller). Nothing comes off the stock. `reason: "no_need"`
   * (`ConflictError`) when the caller needn't ask: use it directly.
   */
  askToUse(orgId: string, itemId: string, body: AskToUseRequest, opts: RequestOptions = {}): Promise<AskResponse> {
    return this.transport.request<AskResponse>(
      { method: "POST", path: this.groupPath(orgId, `items/${encodeURIComponent(itemId)}/asks`), body },
      opts,
    );
  }

  /**
   * POST /v1/organizations/:orgId/kitchen/asks/:askId/approve — the answerer.
   * `{ ask, item, move, txn }`; undo with `reverseTxn` (or `undoGroupMove`
   * when `txn` is null), which puts the ask back to pending. Less left than
   * asked is a `ConflictError` with `reason: "insufficient_stock"` unless
   * `takeWhatsLeft`; `alwaysAllow` lets the asker skip asking from now on.
   */
  approveAsk(orgId: string, askId: string, body: ApproveAskRequest = {}, opts: RequestOptions = {}): Promise<ApproveAskResponse> {
    return this.transport.request<ApproveAskResponse>(
      { method: "POST", path: this.groupPath(orgId, `asks/${encodeURIComponent(askId)}/approve`), body },
      opts,
    );
  }

  /** POST /v1/organizations/:orgId/kitchen/asks/:askId/decline — the answerer; the asker hears no. */
  declineAsk(orgId: string, askId: string, opts: RequestOptions = {}): Promise<AskResponse> {
    return this.answerAsk(orgId, askId, "decline", opts);
  }

  /** POST /v1/organizations/:orgId/kitchen/asks/:askId/reopen — the answerer's Undo of a decline, inside the ask's 24 hours. */
  reopenAsk(orgId: string, askId: string, opts: RequestOptions = {}): Promise<AskResponse> {
    return this.answerAsk(orgId, askId, "reopen", opts);
  }

  /** POST /v1/organizations/:orgId/kitchen/asks/:askId/cancel — the asker's own (`ForbiddenError`, `reason: "not_creator"`, for anyone else). */
  cancelAsk(orgId: string, askId: string, opts: RequestOptions = {}): Promise<AskResponse> {
    return this.answerAsk(orgId, askId, "cancel", opts);
  }

  /** GET /v1/kitchen/me/asks — `{ toAnswer, mine }`: the pending asks the caller answers, and their own from the last 24 hours. */
  asks(opts: RequestOptions = {}): Promise<AsksResponse> {
    return this.transport.request<AsksResponse>({ method: "GET", path: this.mePath("asks") }, opts);
  }

  private answerAsk(orgId: string, askId: string, verb: "decline" | "reopen" | "cancel", opts: RequestOptions): Promise<AskResponse> {
    return this.transport.request<AskResponse>(
      { method: "POST", path: this.groupPath(orgId, `asks/${encodeURIComponent(askId)}/${verb}`), body: {} },
      opts,
    );
  }

  // -------------------------------------------------------------------------
  // Profiles and following (CM-2)
  //
  // A handle, a chosen name and privacy; follows (a private profile accepts
  // each), blocks and mutes; people search and suggestions. Names here are
  // profiles' own — never an email or an identity name. Refusals carry
  // `details.reason` (KITCHEN_COMMUNITY_ERROR_REASONS): a handle's shape or
  // reserved word is a `ValidationError`, a taken handle or one changed in
  // the last 30 days a `ConflictError`, following without a profile or a
  // private profile's lists a `ForbiddenError`, and a day's follows or blocks
  // past the limit a `RateLimitError`. Across a block a person is a
  // `NotFoundError`.
  // -------------------------------------------------------------------------

  /** GET /v1/kitchen/me/profile — yours, or `{ profile: null }` before you choose a handle. */
  myProfile(opts: RequestOptions = {}): Promise<MyProfileResponse> {
    return this.transport.request<MyProfileResponse>({ method: "GET", path: this.mePath("profile") }, opts);
  }

  /** PUT /v1/kitchen/me/profile — make or edit yours. */
  saveMyProfile(body: SaveMyProfileRequest, opts: RequestOptions = {}): Promise<MyProfileResponse> {
    return this.transport.request<MyProfileResponse>({ method: "PUT", path: this.mePath("profile"), body }, opts);
  }

  /** GET /v1/kitchen/handles/:handle — `{ handle, available, reason? }`; your own handle is available to you. */
  handleAvailable(handle: string, opts: RequestOptions = {}): Promise<HandleAvailabilityResponse> {
    return this.transport.request<HandleAvailabilityResponse>(
      { method: "GET", path: `/v1/kitchen/handles/${encodeURIComponent(handle)}` },
      opts,
    );
  }

  /** GET /v1/kitchen/profiles/:handle — the profile, counts, your relationship, who you follow that follows them, and `canSee`. */
  profile(handle: string, opts: RequestOptions = {}): Promise<PersonProfileResponse> {
    return this.transport.request<PersonProfileResponse>({ method: "GET", path: this.profilePath(handle, "") }, opts);
  }

  /** GET /v1/kitchen/profiles/:handle/recipes — their public recipes, newest first (`ForbiddenError` `private` when you can't see them). */
  profileRecipes(handle: string, query: PeoplePageQuery = {}, opts: RequestOptions = {}): Promise<ProfileRecipesResponse> {
    return this.transport.request<ProfileRecipesResponse>(
      { method: "GET", path: this.profilePath(handle, "/recipes"), query: { cursor: query.cursor || undefined } },
      opts,
    );
  }

  /** GET /v1/kitchen/profiles/:handle/followers — under the same `canSee` rule. */
  followers(handle: string, query: PeoplePageQuery = {}, opts: RequestOptions = {}): Promise<PeoplePage> {
    return this.transport.request<PeoplePage>(
      { method: "GET", path: this.profilePath(handle, "/followers"), query: { cursor: query.cursor || undefined } },
      opts,
    );
  }

  /** GET /v1/kitchen/profiles/:handle/following — under the same `canSee` rule. */
  following(handle: string, query: PeoplePageQuery = {}, opts: RequestOptions = {}): Promise<PeoplePage> {
    return this.transport.request<PeoplePage>(
      { method: "GET", path: this.profilePath(handle, "/following"), query: { cursor: query.cursor || undefined } },
      opts,
    );
  }

  /** POST /v1/kitchen/me/follows/:handle — `{ state }`: accepted for a public profile, requested for a private one. */
  follow(handle: string, opts: RequestOptions = {}): Promise<FollowResponse> {
    return this.transport.request<FollowResponse>(
      { method: "POST", path: this.mePath(`follows/${encodeURIComponent(handle)}`), body: {} },
      opts,
    );
  }

  /** DELETE /v1/kitchen/me/follows/:handle — unfollow, or take back a request. */
  unfollow(handle: string, opts: RequestOptions = {}): Promise<FollowResponse> {
    return this.transport.request<FollowResponse>({ method: "DELETE", path: this.mePath(`follows/${encodeURIComponent(handle)}`) }, opts);
  }

  /** GET /v1/kitchen/me/follow-requests — the requests waiting on you, newest first. */
  followRequests(query: PeoplePageQuery = {}, opts: RequestOptions = {}): Promise<PeoplePage> {
    return this.transport.request<PeoplePage>(
      { method: "GET", path: this.mePath("follow-requests"), query: { cursor: query.cursor || undefined } },
      opts,
    );
  }

  /** POST /v1/kitchen/me/follow-requests/:subjectId/accept */
  acceptFollow(subjectId: string, opts: RequestOptions = {}): Promise<FollowResponse> {
    return this.transport.request<FollowResponse>(
      { method: "POST", path: this.mePath(`follow-requests/${encodeURIComponent(subjectId)}/accept`), body: {} },
      opts,
    );
  }

  /** POST /v1/kitchen/me/follow-requests/:subjectId/decline */
  declineFollow(subjectId: string, opts: RequestOptions = {}): Promise<FollowResponse> {
    return this.transport.request<FollowResponse>(
      { method: "POST", path: this.mePath(`follow-requests/${encodeURIComponent(subjectId)}/decline`), body: {} },
      opts,
    );
  }

  /** DELETE /v1/kitchen/me/followers/:subjectId — they no longer follow you. */
  removeFollower(subjectId: string, opts: RequestOptions = {}): Promise<RemoveFollowerResponse> {
    return this.transport.request<RemoveFollowerResponse>(
      { method: "DELETE", path: this.mePath(`followers/${encodeURIComponent(subjectId)}`) },
      opts,
    );
  }

  /** POST /v1/kitchen/me/blocks/:subjectId — hides you from each other everywhere and ends the follows both ways. */
  block(subjectId: string, opts: RequestOptions = {}): Promise<BlockResponse> {
    return this.transport.request<BlockResponse>(
      { method: "POST", path: this.mePath(`blocks/${encodeURIComponent(subjectId)}`), body: {} },
      opts,
    );
  }

  /** DELETE /v1/kitchen/me/blocks/:subjectId — follows are not restored. */
  unblock(subjectId: string, opts: RequestOptions = {}): Promise<BlockResponse> {
    return this.transport.request<BlockResponse>({ method: "DELETE", path: this.mePath(`blocks/${encodeURIComponent(subjectId)}`) }, opts);
  }

  /** GET /v1/kitchen/me/blocks — whom you blocked, newest first. */
  blocks(opts: RequestOptions = {}): Promise<BlocksResponse> {
    return this.transport.request<BlocksResponse>({ method: "GET", path: this.mePath("blocks") }, opts);
  }

  /** POST /v1/kitchen/me/mutes/:subjectId — their posts leave your Following feed. */
  mute(subjectId: string, opts: RequestOptions = {}): Promise<MuteResponse> {
    return this.transport.request<MuteResponse>(
      { method: "POST", path: this.mePath(`mutes/${encodeURIComponent(subjectId)}`), body: {} },
      opts,
    );
  }

  /** DELETE /v1/kitchen/me/mutes/:subjectId */
  unmute(subjectId: string, opts: RequestOptions = {}): Promise<MuteResponse> {
    return this.transport.request<MuteResponse>({ method: "DELETE", path: this.mePath(`mutes/${encodeURIComponent(subjectId)}`) }, opts);
  }

  /** GET /v1/kitchen/people/search?q= — at most 20; a private profile only by its exact handle. */
  searchPeople(q: string, opts: RequestOptions = {}): Promise<PeopleSearchResponse> {
    return this.transport.request<PeopleSearchResponse>({ method: "GET", path: "/v1/kitchen/people/search", query: { q } }, opts);
  }

  /** GET /v1/kitchen/me/people/suggestions — `{ fromGroups, fromRecipes, popular }`, each with a `why`. */
  peopleSuggestions(opts: RequestOptions = {}): Promise<PeopleSuggestionsResponse> {
    return this.transport.request<PeopleSuggestionsResponse>({ method: "GET", path: this.mePath("people/suggestions") }, opts);
  }

  // Posts, the feed, Yum, comments, reports and Activity (CM-3)
  //
  // A post shares one of your dishes with only the stats you choose; who sees
  // it is the server's rule (Just me, followers, public — a private profile's
  // posts reach followers only; blocks hide both ways). A post nobody may
  // see is a `NotFoundError`. Posting beyond Just me, Yum and comments need a
  // profile (`ForbiddenError` `no_profile`); a dish not finalized or already
  // shared is a `ConflictError` (`not_postable`, `already_posted`), and more
  // than 30 comments an hour a `RateLimitError` (`comment_limit`).

  /** POST /v1/kitchen/me/posts — share a dish you cooked (`show` picks the stats; missing ones stay off). */
  createPost(body: CreatePostRequest, opts: RequestOptions = {}): Promise<PostResponse> {
    return this.transport.request<PostResponse>({ method: "POST", path: this.mePath("posts"), body }, opts);
  }

  /** PATCH /v1/kitchen/me/posts/:postId — the caption, the audience or the stats shown. */
  updatePost(postId: string, body: UpdatePostRequest, opts: RequestOptions = {}): Promise<PostResponse> {
    return this.transport.request<PostResponse>({ method: "PATCH", path: this.mePath(`posts/${encodeURIComponent(postId)}`), body }, opts);
  }

  /** DELETE /v1/kitchen/me/posts/:postId — soft: `restorePost` puts it back until `restoreUntil`. */
  deletePost(postId: string, opts: RequestOptions = {}): Promise<DeletePostResponse> {
    return this.transport.request<DeletePostResponse>({ method: "DELETE", path: this.mePath(`posts/${encodeURIComponent(postId)}`) }, opts);
  }

  /** POST /v1/kitchen/me/posts/:postId/restore — the Undo of `deletePost`, within 10 minutes. */
  restorePost(postId: string, opts: RequestOptions = {}): Promise<PostResponse> {
    return this.transport.request<PostResponse>(
      { method: "POST", path: this.mePath(`posts/${encodeURIComponent(postId)}/restore`), body: {} },
      opts,
    );
  }

  /** GET /v1/kitchen/posts/:postId — the post, with your usual time for its recipe at its size when you have one. */
  post(postId: string, opts: RequestOptions = {}): Promise<PostResponse> {
    return this.transport.request<PostResponse>({ method: "GET", path: this.postPath(postId, "") }, opts);
  }

  /** GET /v1/kitchen/me/feed — Following (default) or Discover, 20 a page. */
  feed(query: FeedQuery = {}, opts: RequestOptions = {}): Promise<FeedResponse> {
    return this.transport.request<FeedResponse>(
      { method: "GET", path: this.mePath("feed"), query: { tab: query.tab, cursor: query.cursor || undefined } },
      opts,
    );
  }

  /** GET /v1/kitchen/profiles/:handle/posts — their posts you may see (`ForbiddenError` `private` when you can't see the profile). */
  profilePosts(handle: string, query: PeoplePageQuery = {}, opts: RequestOptions = {}): Promise<ProfilePostsResponse> {
    return this.transport.request<ProfilePostsResponse>(
      { method: "GET", path: this.profilePath(handle, "/posts"), query: { cursor: query.cursor || undefined } },
      opts,
    );
  }

  /** POST /v1/kitchen/posts/:postId/yum */
  yum(postId: string, opts: RequestOptions = {}): Promise<YumResponse> {
    return this.transport.request<YumResponse>({ method: "POST", path: this.postPath(postId, "/yum"), body: {} }, opts);
  }

  /** DELETE /v1/kitchen/posts/:postId/yum */
  unyum(postId: string, opts: RequestOptions = {}): Promise<YumResponse> {
    return this.transport.request<YumResponse>({ method: "DELETE", path: this.postPath(postId, "/yum") }, opts);
  }

  /** GET /v1/kitchen/posts/:postId/comments — oldest first. */
  comments(postId: string, query: PeoplePageQuery = {}, opts: RequestOptions = {}): Promise<CommentsResponse> {
    return this.transport.request<CommentsResponse>(
      { method: "GET", path: this.postPath(postId, "/comments"), query: { cursor: query.cursor || undefined } },
      opts,
    );
  }

  /** POST /v1/kitchen/posts/:postId/comments */
  addComment(postId: string, body: AddCommentRequest, opts: RequestOptions = {}): Promise<CommentResponse> {
    return this.transport.request<CommentResponse>({ method: "POST", path: this.postPath(postId, "/comments"), body }, opts);
  }

  /** DELETE /v1/kitchen/comments/:commentId — yours, or any on your post. */
  deleteComment(commentId: string, opts: RequestOptions = {}): Promise<DeleteCommentResponse> {
    return this.transport.request<DeleteCommentResponse>(
      { method: "DELETE", path: `/v1/kitchen/comments/${encodeURIComponent(commentId)}` },
      opts,
    );
  }

  /** POST /v1/kitchen/reports — a post, a comment or a profile; a repeat answers your first report. */
  report(body: CreateReportRequest, opts: RequestOptions = {}): Promise<ReportResponse> {
    return this.transport.request<ReportResponse>({ method: "POST", path: "/v1/kitchen/reports", body }, opts);
  }

  /**
   * GET /v1/kitchen/me/activity — follow requests waiting, and what happened
   * to you, newest first (a post's Yums are one item). Named apart from
   * `activity`, which is a group's ledger activity.
   */
  communityActivity(query: PeoplePageQuery = {}, opts: RequestOptions = {}): Promise<ActivityResponse> {
    return this.transport.request<ActivityResponse>(
      { method: "GET", path: this.mePath("activity"), query: { cursor: query.cursor || undefined } },
      opts,
    );
  }

  /** POST /v1/kitchen/me/activity/read — everything up to `before` (an ISO instant) is read. */
  markActivityRead(before: string, opts: RequestOptions = {}): Promise<MarkActivityReadResponse> {
    return this.transport.request<MarkActivityReadResponse>({ method: "POST", path: this.mePath("activity/read"), body: { before } }, opts);
  }

  /** GET /v1/kitchen/me/activity/unread — `{ count }` for the badge. */
  unreadActivity(opts: RequestOptions = {}): Promise<UnreadActivityResponse> {
    return this.transport.request<UnreadActivityResponse>({ method: "GET", path: this.mePath("activity/unread") }, opts);
  }

  // Cooked, then split later (CM-8)
  //
  // Cooking can end with the dish as the cook's own (`orgId: null`); posting
  // it and splitting it with a group are separate actions, in any order. A
  // split puts the dish where one cooked into that group is — open for claims
  // (or a draft for the cook's shares) — and `setDishShares`, `claimDish` and
  // `finalizeDish` take it from there. Home's reminders to split ride in
  // `inbox().splitReminders`.

  /**
   * POST /v1/kitchen/me/dishes/:dishId/split — split your own dish with one
   * group you cook in (`splitMode` defaults to `claims`); nothing moves money
   * until it is finalized. Someone else's dish, or a group you aren't in, is a
   * `NotFoundError`; a dish in a group already a `ConflictError` with
   * `reason: "already_split"`; a canceled one `reason: "dish_not_open"`; a
   * group counting in another currency a `ValidationError` with
   * `reason: "currency_mismatch"`. Pass `opts.idempotencyKey`.
   */
  splitDish(dishId: string, body: SplitDishRequest, opts: RequestOptions = {}): Promise<SplitDishResponse> {
    return this.transport.request<SplitDishResponse>(
      { method: "POST", path: this.mePath(`dishes/${encodeURIComponent(dishId)}/split`), body },
      opts,
    );
  }

  /** POST /v1/kitchen/me/dishes/:dishId/split-reminder/dismiss — Home stops reminding you to split it. */
  dismissSplitReminder(dishId: string, opts: RequestOptions = {}): Promise<SplitReminderDismissResponse> {
    return this.transport.request<SplitReminderDismissResponse>(
      { method: "POST", path: this.mePath(`dishes/${encodeURIComponent(dishId)}/split-reminder/dismiss`), body: {} },
      opts,
    );
  }

  /** POST /v1/kitchen/me/dishes/:dishId/split-reminder/restore — the dismissal's Undo. */
  restoreSplitReminder(dishId: string, opts: RequestOptions = {}): Promise<SplitReminderDismissResponse> {
    return this.transport.request<SplitReminderDismissResponse>(
      { method: "POST", path: this.mePath(`dishes/${encodeURIComponent(dishId)}/split-reminder/restore`), body: {} },
      opts,
    );
  }

  private postPath(postId: string, rest: string): string {
    return `/v1/kitchen/posts/${encodeURIComponent(postId)}${rest}`;
  }

  private profilePath(handle: string, rest: string): string {
    return `/v1/kitchen/profiles/${encodeURIComponent(handle)}${rest}`;
  }
}
