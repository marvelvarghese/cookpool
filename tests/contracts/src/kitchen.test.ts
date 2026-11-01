import type {
  KitchenAction,
  KitchenSettings,
  UpdateKitchenSettingsRequest,
} from "@saas/contracts/kitchen";
import {
  CURRENCY_CODE_RE,
  DEFAULT_KITCHEN_CURRENCY,
  DEFAULT_WASTE_POLICY,
  KITCHEN_ACTIONS,
  KITCHEN_ERROR_REASONS,
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
