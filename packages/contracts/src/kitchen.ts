// Kitchen contract types (Cookpool, epic cookpool-kitchen).
//
// The kitchen bounded context is served by `apps/kitchen-worker` behind
// `api-edge` (`/v1/organizations/{org}/kitchen/…` for one group,
// `/v1/kitchen/me/…` for the caller across every group). Money is integer
// minor units (paise for INR) in the group's one currency.

// ── Policy actions ──────────────────────────────────────────

/** Every kitchen policy action, in the order design.md §6 lists them. */
export const KITCHEN_ACTIONS = [
  "kitchen.pantry.read",
  "kitchen.ledger.read",
  "kitchen.item.create",
  "kitchen.item.use",
  "kitchen.item.edit",
  "kitchen.dish.cook",
  "kitchen.dish.claim",
  "kitchen.dish.finalize",
  "kitchen.expense.create",
  "kitchen.settlement.create",
  "kitchen.txn.flag",
  "kitchen.item.manage",
  "kitchen.dish.finalize_any",
  "kitchen.txn.reverse_any",
  "kitchen.settings.manage",
] as const;

export type KitchenAction = (typeof KITCHEN_ACTIONS)[number];

// ── Error reasons ───────────────────────────────────────────
//
// ERROR_CODES are pinned; kitchen-specific outcomes ride on an existing code
// with `details.reason` set to one of these.

export const KITCHEN_ERROR_REASONS = {
  /** 409 `conflict`: the group's currency is fixed once its settings exist. */
  CURRENCY_LOCKED: "currency_locked",
} as const;

export type KitchenErrorReason = (typeof KITCHEN_ERROR_REASONS)[keyof typeof KITCHEN_ERROR_REASONS];

// ── Group settings ──────────────────────────────────────────

/** Who pays for food that goes to waste: everyone in the group, or its buyer. */
export const WASTE_POLICIES = ["split_equally", "buyer_absorbs"] as const;
export type WastePolicy = (typeof WASTE_POLICIES)[number];

/** What a group reads as until its settings are first changed. */
export const DEFAULT_KITCHEN_CURRENCY = "INR";
export const DEFAULT_WASTE_POLICY: WastePolicy = "split_equally";

/** ISO 4217 alphabetic code: three uppercase letters. */
export const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/**
 * GET / PATCH /v1/organizations/{org}/kitchen/settings → `data`.
 * `updatedAt` is null while the group still uses the defaults.
 */
export interface KitchenSettings {
  currency: string;
  wastePolicy: WastePolicy;
  updatedAt: string | null;
}

/**
 * PATCH /v1/organizations/{org}/kitchen/settings (owner/admin:
 * `kitchen.settings.manage`). At least one field. `currency` is accepted only
 * while the group has never saved settings, or when it equals the current
 * value; otherwise 409 `conflict` with `details.reason: "currency_locked"`.
 */
export interface UpdateKitchenSettingsRequest {
  wastePolicy?: WastePolicy;
  currency?: string;
}

export type GetKitchenSettingsResponse = KitchenSettings;
export type UpdateKitchenSettingsResponse = KitchenSettings;
