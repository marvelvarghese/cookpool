import type { SqlExecutor } from "../d1/executor.js";
import type { Uuid } from "../ids/index.js";
import type {
  KitchenGroupSettings,
  KitchenRepository,
  KitchenResult,
  KitchenWastePolicy,
  UpsertGroupSettingsInput,
} from "./types.js";
import { KITCHEN_DEFAULT_CURRENCY, KITCHEN_DEFAULT_WASTE_POLICY } from "./types.js";
import { isCheckViolation } from "../d1/errors.js";
import { createLedgerRepository } from "./ledger.js";
import { createPantryRepository } from "./pantry.js";
import { createStockRepository } from "./stock.js";
import { createDishesRepository } from "./dishes.js";
import { createSweepRepository } from "./sweep.js";
import { createHistoryRepository } from "./history.js";
import { createMeasuresRepository } from "./measures.js";
import { createFoodsRepository } from "./foods.js";
import { createRecipesRepository } from "./recipes.js";
import { createAsksRepository } from "./asks.js";
import { createCommunityRepository } from "./community.js";

// ── Row mappers ────────────────────────────────────────────

const GROUP_SETTINGS_COLUMNS = "org_id, currency, waste_policy, created_at, updated_at";

function mapGroupSettings(row: Record<string, unknown>): KitchenGroupSettings {
  return {
    orgId: row.org_id as string,
    currency: row.currency as string,
    wastePolicy: row.waste_policy as KitchenWastePolicy,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

// ── Repository ─────────────────────────────────────────────

export function createKitchenRepository(executor: SqlExecutor): KitchenRepository {
  async function getGroupSettings(orgId: Uuid): Promise<KitchenResult<KitchenGroupSettings | null>> {
    try {
      const result = await executor.execute(
        `SELECT ${GROUP_SETTINGS_COLUMNS} FROM kitchen_group_settings WHERE org_id = $1`,
        [orgId],
      );
      const row = result.rows[0];
      return { ok: true, value: row ? mapGroupSettings(row) : null };
    } catch (err) {
      return internal(err);
    }
  }

  async function listGroupSettings(orgIds: readonly string[]): Promise<KitchenResult<KitchenGroupSettings[]>> {
    if (orgIds.length === 0) return { ok: true, value: [] };
    try {
      // The groups bind as ONE JSON parameter, however many there are.
      const result = await executor.execute(
        `SELECT ${GROUP_SETTINGS_COLUMNS} FROM kitchen_group_settings
         WHERE org_id IN (SELECT value FROM json_each($1))`,
        [JSON.stringify(orgIds)],
      );
      return { ok: true, value: result.rows.map(mapGroupSettings) };
    } catch (err) {
      return internal(err);
    }
  }

  async function upsertGroupSettings(
    input: UpsertGroupSettingsInput,
  ): Promise<KitchenResult<KitchenGroupSettings>> {
    try {
      // One statement, so the currency lock holds under concurrent writes:
      // the first write creates the row with the requested (or default)
      // currency; any later write updates only when it names no currency or
      // the stored one. A conflicting currency matches the DO UPDATE's WHERE
      // on nothing, so the statement changes nothing and returns no row.
      const result = await executor.execute(
        `INSERT INTO kitchen_group_settings (org_id, currency, waste_policy, created_at, updated_at)
         VALUES ($1, COALESCE($2, $5), COALESCE($3, $6), $4, $4)
         ON CONFLICT (org_id) DO UPDATE SET
           waste_policy = COALESCE($3, kitchen_group_settings.waste_policy),
           updated_at = $4
         WHERE $2 IS NULL OR kitchen_group_settings.currency = $2
         RETURNING ${GROUP_SETTINGS_COLUMNS}`,
        [
          input.orgId,
          input.currency ?? null,
          input.wastePolicy ?? null,
          input.now,
          KITCHEN_DEFAULT_CURRENCY,
          KITCHEN_DEFAULT_WASTE_POLICY,
        ],
      );
      const row = result.rows[0];
      if (row) return { ok: true, value: mapGroupSettings(row) };

      // No row back means the group already has a different currency.
      const current = await getGroupSettings(input.orgId);
      if (current.ok && current.value) {
        return { ok: false, error: { kind: "currency_locked", currency: current.value.currency } };
      }
      return current.ok ? internal("kitchen: settings upsert returned no row") : current;
    } catch (err) {
      if (isCheckViolation(err)) {
        return { ok: false, error: { kind: "invalid", reason: "settings_out_of_range" } };
      }
      return internal(err);
    }
  }

  return {
    getGroupSettings,
    listGroupSettings,
    upsertGroupSettings,
    ...createLedgerRepository(executor),
    ...createPantryRepository(executor),
    ...createStockRepository(executor),
    ...createDishesRepository(executor),
    ...createSweepRepository(executor),
    ...createHistoryRepository(executor),
    ...createMeasuresRepository(executor),
    ...createFoodsRepository(executor),
    ...createRecipesRepository(executor),
    // Ask before use (PN-8).
    ...createAsksRepository(executor),
    // Profiles, follows, blocks and mutes (CM-2).
    ...createCommunityRepository(executor),
  };
}
