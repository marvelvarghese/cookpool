// Your measures' storage (Cookpool SM-13, migration 300_kitchen_measures).
//
// A measure belongs to a name in one pantry, for one dimension: "1 onion ≈
// 150 g" for Onions in Flat 4B, whichever purchase of onions a use takes from.
// The name is keyed as lower(trim(name)) — computed by SQLite on both sides,
// when a measure is written and when it is looked up, so they cannot disagree
// (ASCII letters fold, as the pantry search folds them).
//
// Every item read carries its name's measures, so the lookup takes MANY keys
// in one statement: the keys bind as one JSON parameter and each is looked up
// through kitchen_measures_lookup_idx, which also gives them in position
// order. A name's set is replaced as a whole in one batch: the words it no
// longer has are deleted and the rest upserted, so a word kept keeps its id
// and who first set it.

import { executeBatch, type SqlExecutor, type SqlStatement } from "../d1/executor.js";
import { isCheckViolation, isUniqueViolation } from "../d1/errors.js";
import type {
  KitchenDimension,
  KitchenMeasureRecord,
  KitchenPantryOwner,
  KitchenRepository,
  KitchenResult,
} from "./types.js";

/** The measures part of the kitchen repository. */
export type MeasuresRepository = Pick<KitchenRepository, "listMeasures" | "replaceMeasures">;

const MEASURE_COLUMNS = `id, owner_kind, owner_id, name_key, dimension, one, many, count, amount_milli, position,
  created_by, updated_by, created_at, updated_at`;

type Row = Record<string, unknown>;

function mapMeasure(row: Row): KitchenMeasureRecord {
  return {
    id: row.id as string,
    ownerKind: row.owner_kind as "user" | "group",
    ownerId: row.owner_id as string,
    nameKey: row.name_key as string,
    dimension: row.dimension as KitchenDimension,
    one: row.one as string,
    many: row.many as string,
    count: Number(row.count),
    amountMilli: Number(row.amount_milli),
    position: Number(row.position),
    createdBy: row.created_by as string,
    updatedBy: row.updated_by as string,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function internal(err: unknown): KitchenResult<never> {
  return { ok: false, error: { kind: "internal", message: err instanceof Error ? err.message : String(err) } };
}

/** The pantry's owner_id: the person for a personal pantry, the group for a group's. */
function ownerIdOf(owner: KitchenPantryOwner): string {
  return owner.kind === "user" ? owner.subjectId : owner.orgId;
}

export function createMeasuresRepository(executor: SqlExecutor): MeasuresRepository {
  return {
    async listMeasures(keys) {
      if (keys.length === 0) return { ok: true, value: [] };
      try {
        // json_each's `key` is each entry's index: the rows come back by key,
        // so items sharing a name each get the list of the key they asked by.
        const result = await executor.execute(
          `SELECT k.key AS key_index, ${MEASURE_COLUMNS.split(",").map((c) => `m.${c.trim()}`).join(", ")}
           FROM json_each($1) k
           JOIN kitchen_measures m
             ON m.owner_kind = json_extract(k.value, '$[0]')
            AND m.owner_id = json_extract(k.value, '$[1]')
            AND m.name_key = lower(trim(json_extract(k.value, '$[2]')))
            AND m.dimension = json_extract(k.value, '$[3]')
           ORDER BY k.key, m.position`,
          [JSON.stringify(keys.map((k) => [k.owner.kind, ownerIdOf(k.owner), k.name, k.dimension]))],
        );
        const lists: KitchenMeasureRecord[][] = keys.map(() => []);
        for (const row of result.rows) lists[Number(row.key_index)]?.push(mapMeasure(row));
        return { ok: true, value: lists };
      } catch (err) {
        return internal(err);
      }
    },

    async replaceMeasures({ key, measures, actor, now }) {
      const ownerId = ownerIdOf(key.owner);
      const statements: SqlStatement[] = [
        {
          // The words the name no longer has.
          text: `DELETE FROM kitchen_measures
                 WHERE owner_kind = $1 AND owner_id = $2 AND name_key = lower(trim($3)) AND dimension = $4
                   AND one NOT IN (SELECT value FROM json_each($5))`,
          params: [key.owner.kind, ownerId, key.name, key.dimension, JSON.stringify(measures.map((m) => m.one))],
        },
        ...measures.map(
          (m, position): SqlStatement => ({
            // A word the name already has keeps its row (id, created_by,
            // created_at); everything else is what this request says.
            text: `INSERT INTO kitchen_measures (
                     id, owner_kind, owner_id, name_key, dimension, one, many, count, amount_milli, position,
                     created_by, updated_by, created_at, updated_at
                   ) VALUES ($1, $2, $3, lower(trim($4)), $5, $6, $7, $8, $9, $10, $11, $11, $12, $12)
                   ON CONFLICT (owner_kind, owner_id, name_key, dimension, one) DO UPDATE SET
                     many = excluded.many,
                     count = excluded.count,
                     amount_milli = excluded.amount_milli,
                     position = excluded.position,
                     updated_by = excluded.updated_by,
                     updated_at = excluded.updated_at
                   RETURNING ${MEASURE_COLUMNS}`,
            params: [
              m.id, key.owner.kind, ownerId, key.name, key.dimension, m.one, m.many, m.count, m.amountMilli, position,
              actor, now,
            ],
          }),
        ),
      ];
      try {
        const results = await executeBatch(executor, statements);
        const written = results.slice(1).flatMap((r) => r.rows.map(mapMeasure));
        written.sort((a, b) => a.position - b.position);
        return { ok: true, value: written };
      } catch (err) {
        // Every value the table CHECKs, and each word once, is validated first.
        if (isCheckViolation(err)) return { ok: false, error: { kind: "invalid", reason: "measure_out_of_range" } };
        if (isUniqueViolation(err)) return { ok: false, error: { kind: "conflict", entity: "kitchen_measure" } };
        return internal(err);
      }
    },
  };
}
