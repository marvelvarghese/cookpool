import type {
  ActivityPage,
  BalancesResponse,
  CreateExpenseRequest,
  CreateGroupItemRequest,
  CreatePersonalItemRequest,
  CreateSettlementRequest,
  ItemsPage,
  KitchenAction,
  KitchenItem,
  KitchenSettings,
  KitchenTxn,
  Pantry,
  PantriesResponse,
  ReachableItem,
  ReachableItemsPage,
  SearchItemsResponse,
  SettlePlan,
  StockMoveResponse,
  TransferItemRequest,
  UseGroupItemRequest,
  UsePersonalItemRequest,
  UsualsResponse,
  WasteItemRequest,
  MovesResponse,
  UpdateGroupItemRequest,
  UpdateKitchenSettingsRequest,
  CookDishRequest,
  DishResponse,
  DishesPage,
  KitchenDish,
} from "@saas/contracts/kitchen";
import type { SubjectOrganizationsResponse } from "@saas/contracts/membership";
import {
  CURRENCY_CODE_RE,
  DEFAULT_KITCHEN_CURRENCY,
  DEFAULT_WASTE_POLICY,
  DIMENSIONS,
  FLAG_STATES,
  ITEM_FILTERS,
  ITEM_STATES,
  KITCHEN_ACTIONS,
  KITCHEN_ERROR_REASONS,
  SETTLEMENT_METHODS,
  SPLIT_MODES,
  STOCK_MOVE_KINDS,
  TXN_KINDS,
  USE_SOON_DAYS,
  USUALS_DAYS,
  WASTE_POLICIES,
  DISH_STATES,
  DISH_SPLIT_MODES,
  MAX_DISH_INGREDIENTS,
} from "@saas/contracts/kitchen";
import { ERROR_CODES } from "@saas/contracts/errors";

describe("contracts: kitchen actions (Cookpool CP-4)", () => {
  it("names the fifteen kitchen.* actions of design.md §6, once each", () => {
    expect(KITCHEN_ACTIONS).toHaveLength(15);
    expect(new Set(KITCHEN_ACTIONS).size).toBe(KITCHEN_ACTIONS.length);
    for (const action of KITCHEN_ACTIONS) expect(action).toMatch(/^kitchen\.[a-z]+\.[a-z_]+$/);
  });

  it("types an action as one of them", () => {
    const action: KitchenAction = "kitchen.settings.manage";
    expect(KITCHEN_ACTIONS).toContain(action);
  });
});

describe("contracts: kitchen group settings", () => {
  it("defaults a group to INR and splitting waste equally", () => {
    expect(DEFAULT_KITCHEN_CURRENCY).toBe("INR");
    expect(DEFAULT_WASTE_POLICY).toBe("split_equally");
    expect(WASTE_POLICIES).toEqual(["split_equally", "buyer_absorbs"]);
  });

  it("accepts three capital letters as a currency code", () => {
    for (const code of ["INR", "USD", "EUR"]) expect(code).toMatch(CURRENCY_CODE_RE);
    for (const code of ["inr", "RUPEE", "IN", "1NR", " INR"]) expect(code).not.toMatch(CURRENCY_CODE_RE);
  });

  it("reads null updatedAt for a group still on the defaults", () => {
    const settings: KitchenSettings = { currency: "INR", wastePolicy: "split_equally", updatedAt: null };
    const change: UpdateKitchenSettingsRequest = { wastePolicy: "buyer_absorbs" };
    expect(settings.updatedAt).toBeNull();
    expect(change.currency).toBeUndefined();
  });

  it("reports a locked currency as a reason on an existing error code", () => {
    expect(KITCHEN_ERROR_REASONS.CURRENCY_LOCKED).toBe("currency_locked");
    expect(Object.values(ERROR_CODES)).toContain("conflict");
    expect(Object.values(ERROR_CODES)).not.toContain(KITCHEN_ERROR_REASONS.CURRENCY_LOCKED);
  });
});

describe("contracts: the kitchen ledger (Cookpool CP-7)", () => {
  it("names the six transaction kinds, four split modes, four payment methods and two flag states", () => {
    expect(TXN_KINDS).toEqual(["expense", "use", "dish", "waste", "settlement", "reversal"]);
    expect(SPLIT_MODES).toEqual(["equal", "exact", "percent", "shares"]);
    expect(SETTLEMENT_METHODS).toEqual(["upi", "cash", "bank", "other"]);
    expect(FLAG_STATES).toEqual(["open", "resolved"]);
  });

  it("carries every ledger and pantry refusal as a reason on an existing error code", () => {
    expect(KITCHEN_ERROR_REASONS).toEqual({
      CURRENCY_LOCKED: "currency_locked",
      CURRENCY_MISMATCH: "currency_mismatch",
      NOT_IN_GROUP: "not_in_group",
      ALREADY_REVERSED: "already_reversed",
      IDEMPOTENCY_KEY_REUSED: "idempotency_key_reused",
      NOT_A_PARTY: "not_a_party",
      NOT_CREATOR: "not_creator",
      ITEM_USED: "item_used",
      NOT_BUYER: "not_buyer",
      VERSION_CONFLICT: "version_conflict",
      INSUFFICIENT_STOCK: "insufficient_stock",
      STALE: "stale",
      NOT_LATEST: "not_latest",
      HAS_TRANSACTION: "has_transaction",
      NOT_REVERSIBLE: "not_reversible",
      DISH_NOT_OPEN: "dish_not_open",
    });
    for (const reason of Object.values(KITCHEN_ERROR_REASONS)) {
      expect(Object.values(ERROR_CODES)).not.toContain(reason);
    }
    for (const code of ["conflict", "validation_failed", "forbidden"]) expect(Object.values(ERROR_CODES)).toContain(code);
  });

  it("types a request and the shapes the routes answer with", () => {
    const expense: CreateExpenseRequest = {
      title: "Dinner",
      totalMinor: 1000,
      payers: [{ subjectId: "usr_rahul", amountMinor: 1000 }],
      mode: "shares",
      participants: [{ subjectId: "usr_anu", value: 2 }, { subjectId: "usr_dev", value: 1 }],
    };
    const payment: CreateSettlementRequest = { fromSubjectId: "usr_anu", toSubjectId: "usr_rahul", amountMinor: 500 };
    const txn: KitchenTxn = {
      id: "txn_1", orgId: "org_1", kind: "settlement", title: "Payment", totalMinor: 500, currency: "INR",
      occurredAt: "2026-11-02T08:00:00.000Z", createdBy: "usr_anu", createdAt: "2026-11-02T08:00:00.000Z",
      sourceKind: null, sourceId: null, reverses: null, reversed: false, reversedBy: null, method: "upi", note: null,
      splits: [
        { subjectId: "usr_anu", paidMinor: 500, owedMinor: 0 },
        { subjectId: "usr_rahul", paidMinor: 0, owedMinor: 500 },
      ],
    };
    const page: ActivityPage = { items: [txn], nextCursor: null };
    const balances: BalancesResponse = { currency: "INR", balances: [{ subjectId: "usr_anu", balanceMinor: 500 }] };
    const plan: SettlePlan = { currency: "INR", payments: [], working: { debts: 0, pairs: 0, payments: 0 } };
    expect(expense.mode).toBe("shares");
    expect(payment.method).toBeUndefined();
    expect(page.items[0]!.splits.reduce((a, s) => a + s.paidMinor - s.owedMinor, 0)).toBe(0);
    expect(balances.balances).toHaveLength(1);
    expect(plan.working.payments).toBe(plan.payments.length);
  });
});

describe("contracts: pantries and items (Cookpool CP-10)", () => {
  it("names the item states, dimensions and list filters, and how far ahead 'use soon' looks", () => {
    expect(ITEM_STATES).toEqual(["active", "used_up", "wasted", "removed"]);
    expect(DIMENSIONS).toEqual(["count", "mass", "volume", "pack"]);
    expect(ITEM_FILTERS).toEqual(["all", "soon", "expired"]);
    expect(USE_SOON_DAYS).toBe(3);
  });

  it("types the requests and the shapes the routes answer with", () => {
    const personal: CreatePersonalItemRequest = { name: "Rice", category: "Grains", quantity: "1.25", unit: "kg", priceMinor: 12500 };
    const shared: CreateGroupItemRequest = { ...personal, paidBy: "usr_anu", wastePolicy: null };
    const edit: UpdateGroupItemRequest = { expiresOn: null, wastePolicy: "buyer_absorbs", version: 2 };
    const item: KitchenItem = {
      id: "itm_1", pantry: { kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B" }, name: "Rice", category: "Grains",
      dimension: "mass", displayUnit: "kg", qtyBought: 1.25, qtyLeft: 1.25, qtyBoughtMilli: 1_250_000, qtyLeftMilli: 1_250_000,
      priceMinor: 12500, currency: "INR", unitPriceMinor: 10000, worthMinor: 12500, paidBy: "usr_anu", boughtOn: "2026-11-02",
      expiresOn: null, daysToUseBy: null, wastePolicy: "split_equally", wastePolicyOverride: null, state: "active", version: 1,
      createdBy: "usr_rahul", createdAt: "2026-11-02T08:00:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z",
    };
    const pantries: Pantry[] = [
      { kind: "personal", name: "My pantry", itemCount: 0, useSoonCount: 0, expiredCount: 0, worthMinor: 0, currency: "INR" },
      {
        kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B", itemCount: 1, useSoonCount: 0, expiredCount: 0,
        worthMinor: 12500, currency: "INR", wastePolicy: "split_equally",
      },
    ];
    const response: PantriesResponse = { pantries };
    const page: ItemsPage = { items: [item], nextCursor: null };
    const groups: SubjectOrganizationsResponse = { organizations: [{ orgId: "org_1", slug: "flat-4b", name: "Flat 4B", role: "builder" }] };
    expect(shared.paidBy).toBe("usr_anu");
    expect(edit.quantity).toBeUndefined();
    expect(response.pantries[0]!.kind).toBe("personal");
    expect(page.items[0]!.qtyLeftMilli).toBe(page.items[0]!.qtyBoughtMilli);
    expect(groups.organizations).toHaveLength(1);
  });
});

describe("contracts: using things (Cookpool CP-11)", () => {
  it("names the six stock move kinds, and how far back usuals look", () => {
    expect(STOCK_MOVE_KINDS).toEqual(["use", "dish", "waste", "transfer", "adjust", "reversal"]);
    expect(USUALS_DAYS).toBe(90);
  });

  it("types the requests and the shapes the routes answer with", () => {
    const use: UseGroupItemRequest = { quantity: "250", unit: "ml", consumers: ["usr_rahul", "usr_anu"], weights: [1, 1] };
    const personal: UsePersonalItemRequest = { quantity: 0.25 };
    const waste: WasteItemRequest = {};
    const transfer: TransferItemRequest = { orgId: "org_1" };
    const item: ReachableItem = {
      id: "itm_1", pantry: { kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B" }, name: "Milk", category: "Dairy",
      dimension: "volume", displayUnit: "L", qtyBought: 1, qtyLeft: 0.75, qtyBoughtMilli: 1_000_000, qtyLeftMilli: 750_000,
      priceMinor: 6000, currency: "INR", unitPriceMinor: 6000, worthMinor: 4500, paidBy: "usr_meera", boughtOn: "2026-11-02",
      expiresOn: null, daysToUseBy: null, wastePolicy: "split_equally", wastePolicyOverride: null, state: "active", version: 2,
      createdBy: "usr_meera", createdAt: "2026-11-02T08:00:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z", canUse: true,
    };
    const moved: StockMoveResponse = {
      item,
      move: {
        id: "mov_1", itemId: "itm_1", kind: "use", qtyMilli: 250_000, quantity: 250, unit: "ml", costMinor: 1500,
        actor: "usr_rahul", consumers: ["usr_rahul", "usr_anu"], txnId: null, reverses: null,
        at: "2026-11-02T08:00:00.000Z", undone: false, undoneBy: null,
      },
      txn: null,
    };
    const moves: MovesResponse = { moves: [moved.move] };
    const page: ReachableItemsPage = { items: [item], nextCursor: null };
    const found: SearchItemsResponse = { items: [item] };
    const usuals: UsualsResponse = {
      usuals: [{
        itemId: "itm_1", name: "Milk", pantry: item.pantry, lastQtyMilli: 250_000, lastQuantity: 250, lastUnit: "ml",
        consumers: ["usr_rahul"], usedCount: 3, lastUsedAt: "2026-11-02T08:00:00.000Z", qtyLeftMilli: 750_000,
      }],
    };
    expect(use.consumers).toHaveLength(2);
    expect(personal.unit).toBeUndefined();
    expect(waste.quantity).toBeUndefined();
    expect(transfer.orgId).toBe("org_1");
    expect(moves.moves[0]!.costMinor).toBe(1500);
    expect(page.items[0]!.canUse).toBe(true);
    expect(found.items).toHaveLength(1);
    expect(usuals.usuals[0]!.usedCount).toBe(3);
  });
});

describe("contracts: dishes (Cookpool CP-14)", () => {
  it("names the four dish states and two split modes, and caps the ingredients one write takes", () => {
    expect(DISH_STATES).toEqual(["draft", "open", "finalized", "canceled"]);
    expect(DISH_SPLIT_MODES).toEqual(["assign", "claims"]);
    expect(MAX_DISH_INGREDIENTS).toBe(30);
  });

  it("types the request and the shapes the routes answer with", () => {
    const cook: CookDishRequest = {
      name: "Paneer butter masala",
      orgId: "org_1",
      portionsHalf: 8,
      extrasMinor: 1500,
      splitMode: "claims",
      ingredients: [{ itemId: "itm_1", quantity: "300", unit: "g" }],
      newItems: [{ name: "Cream", quantity: "200", unit: "ml", priceMinor: 3000 }],
    };
    const dish: KitchenDish = {
      id: "dsh_1", cook: "usr_rahul", orgId: "org_1", name: "Paneer butter masala", portionsHalf: 8, portions: 4,
      extrasMinor: 1500, ingredientsMinor: 4200, totalMinor: 5700, currency: "INR", splitMode: "claims", state: "open",
      txnId: null, leftoverItemId: null, cookedAt: "2026-11-02T12:00:00.000Z", finalizedAt: null, canceledAt: null,
      createdAt: "2026-11-02T12:00:00.000Z", updatedAt: "2026-11-02T12:00:00.000Z",
      ingredients: [
        {
          itemId: "itm_1", name: "Tomatoes", orgId: "org_1", paidBy: "usr_anu", qtyMilli: 300_000, quantity: 300, unit: "g",
          costMinor: 1200, useTxnId: "txn_1",
        },
        {
          itemId: "itm_2", name: "Cream", orgId: null, paidBy: "usr_rahul", qtyMilli: 200_000, quantity: 200, unit: "ml",
          costMinor: 3000, useTxnId: null,
        },
      ],
      fromMineMinor: 3000,
      owes: [{ orgId: "org_1", buyerId: "usr_anu", amountMinor: 1200 }],
    };
    const response: DishResponse = { dish };
    const page: DishesPage = { dishes: [dish], nextCursor: null };
    expect(cook.newItems).toHaveLength(1);
    expect(response.dish.totalMinor).toBe(response.dish.ingredientsMinor + response.dish.extrasMinor);
    expect(dish.fromMineMinor + dish.owes.reduce((a, o) => a + o.amountMinor, 0)).toBe(dish.ingredientsMinor);
    expect(page.dishes[0]!.portions * 2).toBe(page.dishes[0]!.portionsHalf);
  });
});
