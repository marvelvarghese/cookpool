import { DatabaseSync } from "node:sqlite";

// An in-memory SQLite database that keeps the D1 rules these suites rely on
// (Cookpool PK-7). Plain SQLite and D1 differ in their limits, and a
// statement SQLite runs is not always one D1 runs:
//   * D1 limits a LIKE or GLOB pattern to 50 bytes (SQLite's default is
//     50,000). 510's 132-character GLOB on identity_passkeys.id passed every
//     test here and failed every insert on D1 ("LIKE or GLOB pattern too
//     complex"). node:sqlite sets the same limit through `limits` where it
//     supports it (Node 25 does); older versions ignore the option, which is
//     why `likePatternsOver` checks the schema's patterns on any version.
//   * D1 enforces foreign keys.

/** D1's SQLITE_LIMIT_LIKE_PATTERN_LENGTH. */
export const D1_LIKE_PATTERN_LIMIT = 50;

export function openD1Sqlite(): DatabaseSync {
  const options = { limits: { likePatternLength: D1_LIKE_PATTERN_LIMIT } };
  const db = new DatabaseSync(":memory:", options as unknown as ConstructorParameters<typeof DatabaseSync>[1]);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/** Whether this node:sqlite enforces D1's pattern limit. */
export function enforcesD1PatternLimit(db: DatabaseSync): boolean {
  try {
    db.prepare("SELECT ? GLOB ? AS r").get("a", "a".repeat(D1_LIKE_PATTERN_LIMIT + 1));
    return false;
  } catch (err) {
    return /pattern too complex/i.test(String(err));
  }
}

/**
 * Every LIKE or GLOB string literal in the schema (tables, indexes, triggers,
 * views) longer than D1 allows, with the object it is in.
 */
export function likePatternsOver(db: DatabaseSync, limit = D1_LIKE_PATTERN_LIMIT): Array<{ name: string; pattern: string }> {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL").all() as Array<{ name: string; sql: string }>;
  const out: Array<{ name: string; pattern: string }> = [];
  for (const { name, sql } of rows) {
    for (const m of sql.matchAll(/\b(?:LIKE|GLOB)\s+'((?:[^']|'')*)'/gi)) {
      const pattern = m[1]!.replace(/''/g, "'");
      if (Buffer.byteLength(pattern, "utf8") > limit) out.push({ name, pattern });
    }
  }
  return out;
}
