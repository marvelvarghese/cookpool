import type { Uuid } from "../ids/index.js";

// ── Result type ─────────────────────────────────────────────

export type KitchenRepositoryError =
  | { kind: "not_found" }
  | { kind: "conflict"; entity: string }
  /** The group's currency is fixed once its settings row exists. */
  | { kind: "currency_locked"; currency: string }
  /** The database refused a value its CHECK constraints forbid. */
  | { kind: "invalid"; reason: string }
  | { kind: "internal"; message: string };

export type KitchenResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: KitchenRepositoryError };

// ── Group settings ──────────────────────────────────────────

export type KitchenWastePolicy = "split_equally" | "buyer_absorbs";

/** What a group without a settings row reads as. */
export const KITCHEN_DEFAULT_CURRENCY = "INR";
export const KITCHEN_DEFAULT_WASTE_POLICY: KitchenWastePolicy = "split_equally";

export interface KitchenGroupSettings {
  orgId: string;
  currency: string;
  wastePolicy: KitchenWastePolicy;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertGroupSettingsInput {
  orgId: Uuid;
  /**
   * ISO 4217 code. Written when the row is created; on an existing row it must
   * equal the stored value, or the upsert changes nothing and returns
   * `currency_locked`. Omit to keep the stored value (or the default on create).
   */
  currency?: string;
  /** Omit to keep the stored value (or the default on create). */
  wastePolicy?: KitchenWastePolicy;
  now: Date;
}

// ── Repository ──────────────────────────────────────────────

export interface KitchenRepository {
  /** The group's settings row, or `null` when it has none (it uses the defaults). */
  getGroupSettings(orgId: Uuid): Promise<KitchenResult<KitchenGroupSettings | null>>;
  /**
   * Create the group's settings row or change it, in one statement. The
   * currency lock is enforced inside that statement, so two racing first
   * writes cannot leave the currency different from what either was told.
   */
  upsertGroupSettings(input: UpsertGroupSettingsInput): Promise<KitchenResult<KitchenGroupSettings>>;
}
