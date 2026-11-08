// Cooked, then split later (Cookpool CM-8, cookpool-community design §2a,
// migration 460_kitchen_split_later).
//
// Cooking can end with the dish as its cook's own (org_id NULL — a "just me"
// dish, as before). Splitting it later is ONE batch: the group's currency
// pinned to the dish's (as cooking into the group would pin it), the dish row
// moved into the group — org_id, split mode, the state a freshly cooked group
// dish has (open for claims, a draft for its cook's shares), split_at — and
// the audit event in that group. The row is guarded the way every dish write
// is: the update sets state NULL, failing the whole batch, unless the dish is
// still the cook's own and unsplit, draft or (a "just me" dish finalized,
// which posted nothing) finalized, at the version it was read at, with no
// dish transaction or leftovers, and the group counts in the dish's currency.
// A refusal is read back afterwards. Its money (ingredients, extras, total)
// is never touched: the dish transaction posts when the split is finalized.
//
// Home's split reminder reads the cook's own unsplit dishes of the last days
// that used group items or made enough portions to share; dismissing it is
// split_dismissed_at.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation } from "../d1/errors.js";
import { eventWithAuditStatements } from "../events/repository.js";
import type { AppendEventWithAuditInput } from "../events/types.js";
import { DISH_COLUMNS, dishesWithParts } from "./dishes.js";
import { pinGroupCurrencyStatement } from "./ledger.js";
import type { KitchenDishRecord, KitchenDishResult, KitchenDishSplitMode, KitchenResult } from "./types.js";

/** Split a dish cooked as its cook's own with one group (see the file comment). */
export interface SplitDishLaterInput {
  /** The dish as read: its cook's own (org_id NULL), its version the guard. */
  dish: KitchenDishRecord;
  /** The group (UUID) it is split with. */
  orgId: string;
  splitMode: KitchenDishSplitMode;
  now: Date;
  /** `kitchen.dish.split`, in that group. */
  audit: AppendEventWithAuditInput;
}

export interface UnsplitDishesQuery {
  cook: string;
  /** Cooked at or after this instant. */
  since: Date;
  /** Portions × 2 at which a dish is worth splitting without group items. */
  minPortionsHalf: number;
  limit: number;
}

export interface SplitLaterRepository {
  /**
   * Split the cook's own dish with a group, in ONE batch. Refusals:
   * `not_found` (gone, or not this cook's), `conflict` with entity
   * `kitchen_dish_split` (it has a group already), `dish_not_open` (canceled),
   * `stale` (changed since it was read), `currency_mismatch` (the group counts
   * in another currency). Nothing is written on any of them.
   */
  splitDishLater(input: SplitDishLaterInput): Promise<KitchenDishResult<KitchenDishRecord>>;
  /**
   * The cook's own dishes Home reminds them to split, newest first: no group,
   * not canceled, not dismissed, cooked since `since`, and either taking
   * something from a group pantry or of at least `minPortionsHalf`.
   */
  listUnsplitDishes(query: UnsplitDishesQuery): Promise<KitchenResult<KitchenDishRecord[]>>;
  /** The group (UUID) of the cook's latest dish in one of `orgIds`, not canceled; null when none. */
  latestGroupDishOrg(cook: string, orgIds: readonly string[]): Promise<KitchenResult<string | null>>;
  /**
   * Dismiss (`at`) or bring back (null) Home's split reminder for one of the
   * cook's dishes; `not_found` for anyone else's.
   */
  setSplitReminderDismissed(cook: string, dishId: string, at: Date | null): Promise<KitchenResult<{ dismissedAt: Date | null }>>;
}

function internal(err: unknown): { ok: false; error: { kind: "internal"; message: string } } {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

export function createSplitLaterRepository(executor: SqlExecutor): SplitLaterRepository {
  async function findDish(dishId: string): Promise<KitchenDishRecord | null> {
    const result = await executor.execute(`SELECT ${DISH_COLUMNS} FROM kitchen_dishes d WHERE d.id = $1`, [dishId]);
    const [dish] = await dishesWithParts(executor, result.rows);
    return dish ?? null;
  }

  return {
    async splitDishLater({ dish, orgId, splitMode, now, audit }) {
      const state = splitMode === "claims" ? "open" : "draft";
      const statements: SqlStatement[] = [
        // The group counts in the dish's currency from now on, as cooking into it would have fixed it.
        pinGroupCurrencyStatement(orgId, dish.currency, now),
        {
          // The guard: anything but the cook's own unsplit dish, at the version
          // read, in the group's currency, sets state NULL and fails the batch.
          text: `UPDATE kitchen_dishes SET
                   state = CASE
                     WHEN cook = $2 AND org_id IS NULL AND state IN ('draft', 'finalized') AND version = $3
                       AND txn_id IS NULL AND leftover_item_id IS NULL
                       AND EXISTS (SELECT 1 FROM kitchen_group_settings s WHERE s.org_id = $4 AND s.currency = kitchen_dishes.currency)
                     THEN $5 END,
                   org_id = $4,
                   split_mode = $6,
                   finalized_at = NULL,
                   split_at = $7,
                   split_dismissed_at = NULL,
                   version = version + 1,
                   updated_at = $7
                 WHERE id = $1`,
          params: [dish.id, dish.cook, dish.version, orgId, state, splitMode, now],
        },
        ...eventWithAuditStatements(audit),
      ];
      try {
        await executeBatch(executor, statements);
      } catch (err) {
        if (!isCheckViolation(err)) return internal(err);
        try {
          const current = await findDish(dish.id);
          if (!current || current.cook !== dish.cook) return { ok: false, error: { kind: "not_found" } };
          if (current.state === "canceled") return { ok: false, error: { kind: "dish_not_open", state: current.state } };
          if (current.orgId !== null) return { ok: false, error: { kind: "conflict", entity: "kitchen_dish_split" } };
          if (current.version !== dish.version) return { ok: false, error: { kind: "stale" } };
          const counts = await executor.execute("SELECT currency FROM kitchen_group_settings WHERE org_id = $1", [orgId]);
          const currency = counts.rows[0]?.currency;
          if (typeof currency === "string" && currency !== current.currency) {
            return { ok: false, error: { kind: "currency_mismatch", currency } };
          }
          return { ok: false, error: { kind: "invalid", reason: "dish_not_splittable" } };
        } catch (followUp) {
          return internal(followUp);
        }
      }
      try {
        const split = await findDish(dish.id);
        return split ? { ok: true, value: split } : { ok: false, error: { kind: "not_found" } };
      } catch (err) {
        return internal(err);
      }
    },

    async listUnsplitDishes({ cook, since, minPortionsHalf, limit }) {
      try {
        const result = await executor.execute(
          `SELECT ${DISH_COLUMNS} FROM kitchen_dishes d
           WHERE d.cook = $1 AND d.org_id IS NULL AND d.state IN ('draft', 'finalized')
             AND d.split_dismissed_at IS NULL AND d.cooked_at >= $2
             AND (d.portions_half >= $3
                  OR EXISTS (SELECT 1 FROM kitchen_dish_ingredients di WHERE di.dish_id = d.id AND di.org_id IS NOT NULL))
           ORDER BY d.cooked_at DESC, d.id DESC
           LIMIT $4`,
          [cook, since.toISOString(), minPortionsHalf, limit],
        );
        return { ok: true, value: await dishesWithParts(executor, result.rows) };
      } catch (err) {
        return internal(err);
      }
    },

    async latestGroupDishOrg(cook, orgIds) {
      if (orgIds.length === 0) return { ok: true, value: null };
      try {
        const result = await executor.execute(
          `SELECT d.org_id FROM kitchen_dishes d
           WHERE d.cook = $1 AND d.state <> 'canceled'
             AND d.org_id IN (SELECT value FROM json_each($2))
           ORDER BY d.cooked_at DESC, d.id DESC
           LIMIT 1`,
          [cook, JSON.stringify(orgIds)],
        );
        const orgId = result.rows[0]?.org_id;
        return { ok: true, value: typeof orgId === "string" ? orgId : null };
      } catch (err) {
        return internal(err);
      }
    },

    async setSplitReminderDismissed(cook, dishId, at) {
      try {
        const result = await executor.execute(
          `UPDATE kitchen_dishes SET split_dismissed_at = $3
           WHERE id = $1 AND cook = $2
           RETURNING split_dismissed_at`,
          [dishId, cook, at],
        );
        const row = result.rows[0];
        if (!row) return { ok: false, error: { kind: "not_found" } };
        const value = row.split_dismissed_at;
        return { ok: true, value: { dismissedAt: value === null || value === undefined ? null : new Date(value as string) } };
      } catch (err) {
        return internal(err);
      }
    },
  };
}
