import type {
  ActivityPage,
  BalancesResponse,
  CreateExpenseRequest,
  CreateSettlementRequest,
  KitchenAction,
  KitchenSettings,
  KitchenTxn,
  SettlePlan,
  UpdateKitchenSettingsRequest,
} from "@saas/contracts/kitchen";
import {
  CURRENCY_CODE_RE,
  DEFAULT_KITCHEN_CURRENCY,
  DEFAULT_WASTE_POLICY,
  FLAG_STATES,
  KITCHEN_ACTIONS,
  KITCHEN_ERROR_REASONS,
  SETTLEMENT_METHODS,
  SPLIT_MODES,
  TXN_KINDS,
  WASTE_POLICIES,
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

  it("carries every ledger refusal as a reason on an existing error code", () => {
    expect(KITCHEN_ERROR_REASONS).toEqual({
      CURRENCY_LOCKED: "currency_locked",
      CURRENCY_MISMATCH: "currency_mismatch",
      NOT_IN_GROUP: "not_in_group",
      ALREADY_REVERSED: "already_reversed",
      IDEMPOTENCY_KEY_REUSED: "idempotency_key_reused",
      NOT_A_PARTY: "not_a_party",
      NOT_CREATOR: "not_creator",
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
