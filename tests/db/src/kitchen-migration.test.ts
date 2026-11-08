import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest, BOUNDED_CONTEXTS } from "@saas/db";

// The kitchen bounded context (Cookpool CP-4): its migrations are registered
// under `kitchen`, follow the baseline's, and only touch kitchen_* tables.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");

describe("kitchen migrations", () => {
  const kitchen = manifest.migrations.filter((m) => m.context === "kitchen");

  it("registers kitchen as a bounded context", () => {
    expect(BOUNDED_CONTEXTS).toContain("kitchen");
  });

  it("starts with 210_kitchen_settings, after the join codes (200)", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen[0]?.id).toBe("210_kitchen_settings");
    expect(ids.indexOf("210_kitchen_settings")).toBe(ids.indexOf("200_membership_join_codes") + 1);
  });

  it("only creates, alters or writes kitchen_* tables, each create guarded with IF NOT EXISTS", () => {
    for (const m of kitchen) {
      // Statements only: the header comments may name what they describe, and a seed's words may say anything.
      const sql = readFileSync(resolve(MIGRATIONS_ROOT, m.path), "utf8").replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
      const creates = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(IF NOT EXISTS\s+)?([a-z_]+)/gi)];
      const alters = [...sql.matchAll(/ALTER\s+TABLE\s+([a-z_]+)/gi)];
      const writes = [...sql.matchAll(/(?:INSERT\s+(?:OR\s+[A-Z]+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)];
      // A migration that only adds a column (290) has no CREATE, and one that only rewrites seed rows (390, GC-4)
      // neither; every one does something.
      expect(creates.length + alters.length + writes.length).toBeGreaterThan(0);
      for (const [, kind, guard, name] of creates) {
        expect(guard).toBeDefined();
        if (kind!.toUpperCase() === "TABLE") expect(name).toMatch(/^kitchen_/);
      }
      for (const [, table] of alters) expect(table).toMatch(/^kitchen_/);
      for (const [, table] of writes) expect([m.id, table]).toEqual([m.id, expect.stringMatching(/^kitchen_/)]);
    }
  });

  it("creates kitchen_group_settings keyed by the group", () => {
    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "210_kitchen_settings/up.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kitchen_group_settings/);
    expect(sql).toMatch(/org_id\s+TEXT PRIMARY KEY/);
  });

  it("adds the ledger as 220_kitchen_ledger, right after the settings", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(0, 2)).toEqual(["210_kitchen_settings", "220_kitchen_ledger"]);
    expect(ids.indexOf("220_kitchen_ledger")).toBe(ids.indexOf("210_kitchen_settings") + 1);
  });

  it("adds the pantries as 230_kitchen_pantry, right after the ledger", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(0, 3)).toEqual(["210_kitchen_settings", "220_kitchen_ledger", "230_kitchen_pantry"]);
    expect(ids.indexOf("230_kitchen_pantry")).toBe(ids.indexOf("220_kitchen_ledger") + 1);
  });

  it("adds what stock moves record as 240_kitchen_stock_moves, right after the pantries", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(0, 4)).toEqual([
      "210_kitchen_settings",
      "220_kitchen_ledger",
      "230_kitchen_pantry",
      "240_kitchen_stock_moves",
    ]);
    expect(ids.indexOf("240_kitchen_stock_moves")).toBe(ids.indexOf("230_kitchen_pantry") + 1);

    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "240_kitchen_stock_moves/up.sql"), "utf8").replace(/--.*$/gm, "");
    // Additive: nullable columns on the moves table and partial unique indexes; nothing dropped or rewritten.
    for (const column of ["consumers", "unit", "reverses", "idem_key"]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE kitchen_stock_moves ADD COLUMN ${column} TEXT`));
    }
    expect(sql).toMatch(/reverses TEXT REFERENCES kitchen_stock_moves\(id\)/);
    expect(sql).toMatch(/\(kind = 'reversal'\) = \(reverses IS NOT NULL\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS kitchen_stock_moves_reverses_uq\s+ON kitchen_stock_moves \(reverses\) WHERE reverses IS NOT NULL/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS kitchen_stock_moves_item_idem_uq\s+ON kitchen_stock_moves \(item_id, idem_key\) WHERE idem_key IS NOT NULL/);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE)\b/i);
  });

  it("creates items with their owner rule and stock moves tied to the ledger", () => {
    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "230_kitchen_pantry/up.sql"), "utf8").replace(/--.*$/gm, "");
    for (const table of ["kitchen_items", "kitchen_stock_moves"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    }
    expect(sql).toMatch(/owner_kind = 'user' AND owner_subject_id IS NOT NULL AND org_id IS NULL/);
    expect(sql).toMatch(/owner_kind = 'group' AND org_id IS NOT NULL AND owner_subject_id IS NULL/);
    expect(sql).toMatch(/qty_left_milli >= 0 AND qty_left_milli <= qty_bought_milli/);
    expect(sql).toMatch(/price_minor\s+INTEGER NOT NULL CHECK \(price_minor >= 0\)/);
    expect(sql).toMatch(/kind IN \('use', 'dish', 'waste', 'transfer', 'adjust', 'reversal'\)/);
    expect(sql).toMatch(/txn_id\s+TEXT REFERENCES kitchen_txns\(id\)/);
    expect(sql).toMatch(/kitchen_items \(owner_subject_id, state\)/);
    expect(sql).toMatch(/kitchen_items \(org_id, state\)/);
    expect(sql).toMatch(/kitchen_items \(expires_on\) WHERE state = 'active'/);
    // Additive only.
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE)\b/i);
  });

  it("creates the ledger's three tables, its once-only reversal and its idempotency key", () => {
    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "220_kitchen_ledger/up.sql"), "utf8").replace(/--.*$/gm, "");
    for (const table of ["kitchen_txns", "kitchen_txn_splits", "kitchen_flags"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    }
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS kitchen_txns_reverses_uq\s+ON kitchen_txns \(reverses\) WHERE reverses IS NOT NULL/);
    expect(sql).toMatch(/UNIQUE \(org_id, idem_key\)/);
    expect(sql).toMatch(/PRIMARY KEY \(txn_id, subject_id\)/);
    expect(sql).toMatch(/kitchen_txns \(org_id, occurred_at DESC, id DESC\)/);
    // Append-only: the ledger migration never alters or drops anything.
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE)\b/i);
  });

  it("adds dishes as 250_kitchen_dishes, right after the stock moves", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(0, 5)).toEqual([
      "210_kitchen_settings",
      "220_kitchen_ledger",
      "230_kitchen_pantry",
      "240_kitchen_stock_moves",
      "250_kitchen_dishes",
    ]);
    expect(ids.indexOf("250_kitchen_dishes")).toBe(ids.indexOf("240_kitchen_stock_moves") + 1);

    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "250_kitchen_dishes/up.sql"), "utf8").replace(/--.*$/gm, "");
    for (const table of ["kitchen_dishes", "kitchen_dish_ingredients"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    }
    expect(sql).toMatch(/portions_half\s+INTEGER NOT NULL CHECK \(portions_half > 0\)/);
    expect(sql).toMatch(/CHECK \(total_minor = ingredients_minor \+ extras_minor\)/);
    expect(sql).toMatch(/split_mode IN \('assign', 'claims'\)/);
    expect(sql).toMatch(/state IN \('draft', 'open', 'finalized', 'canceled'\)/);
    expect(sql).toMatch(/UNIQUE \(cook, idem_key\)/);
    expect(sql).toMatch(/txn_id\s+TEXT REFERENCES kitchen_txns\(id\)/);
    expect(sql).toMatch(/PRIMARY KEY \(dish_id, item_id\)/);
    expect(sql).toMatch(/use_txn_id\s+TEXT REFERENCES kitchen_txns\(id\)/);
    // kitchen_stock_moves.dish_id gets an index, not a foreign key: SQLite
    // cannot add one to an existing column without rebuilding the table.
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS kitchen_stock_moves_dish_idx\s+ON kitchen_stock_moves \(dish_id\) WHERE dish_id IS NOT NULL/);
    // Additive only.
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE)\b/i);
  });

  it("adds dish shares as 260_kitchen_dish_shares, right after the dishes", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(0, 6)).toEqual([
      "210_kitchen_settings",
      "220_kitchen_ledger",
      "230_kitchen_pantry",
      "240_kitchen_stock_moves",
      "250_kitchen_dishes",
      "260_kitchen_dish_shares",
    ]);
    expect(ids.indexOf("260_kitchen_dish_shares")).toBe(ids.indexOf("250_kitchen_dishes") + 1);

    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "260_kitchen_dish_shares/up.sql"), "utf8").replace(/--.*$/gm, "");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kitchen_dish_shares \(/);
    expect(sql).toMatch(/dish_id\s+TEXT NOT NULL REFERENCES kitchen_dishes\(id\)/);
    expect(sql).toMatch(/UNIQUE \(dish_id, subject_id\)/);
    expect(sql).toMatch(/CHECK \(\(portions_half IS NULL\) <> \(exact_minor IS NULL\)\)/);
    expect(sql).toMatch(/source\s+TEXT NOT NULL CHECK \(source IN \('cook', 'self'\)\)/);
    // Additive: one new table, and one column with a constant default on the dishes.
    expect(sql).toMatch(/ALTER TABLE kitchen_dishes ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK \(version >= 1\)/);
    expect(sql.match(/\bALTER\b/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE)\b/i);
  });

  it("adds the daily sweep's record as 270_kitchen_sweeps, right after the dish shares", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(5, 7)).toEqual(["260_kitchen_dish_shares", "270_kitchen_sweeps"]);
    expect(ids.indexOf("270_kitchen_sweeps")).toBe(ids.indexOf("260_kitchen_dish_shares") + 1);

    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "270_kitchen_sweeps/up.sql"), "utf8").replace(/--.*$/gm, "");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kitchen_sweeps \(/);
    // One row per UTC day swept.
    expect(sql).toMatch(/sweep_date\s+TEXT PRIMARY KEY/);
    for (const column of ["started_at", "finished_at"]) expect(sql).toMatch(new RegExp(`${column}\\s+TEXT NOT NULL`));
    for (const column of ["items", "people", "sent", "failed"]) {
      expect(sql).toMatch(new RegExp(`${column}\\s+INTEGER NOT NULL DEFAULT 0 CHECK \\(${column} >= 0\\)`));
    }
    // Additive only, and nothing about anyone: counts, not names or addresses.
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE)\b/i);
    expect(sql).not.toMatch(/subject|email|address/i);
  });

  it("records who set each dish share as 290_kitchen_dish_share_setter, the next kitchen migration after the sweeps", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(0, 8)).toEqual([
      "210_kitchen_settings",
      "220_kitchen_ledger",
      "230_kitchen_pantry",
      "240_kitchen_stock_moves",
      "250_kitchen_dishes",
      "260_kitchen_dish_shares",
      "270_kitchen_sweeps",
      "290_kitchen_dish_share_setter",
    ]);
    // 280 is identity's (SI-2): 290 follows it in the manifest.
    expect(ids.indexOf("290_kitchen_dish_share_setter")).toBe(ids.indexOf("280_identity_login_attempts") + 1);

    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "290_kitchen_dish_share_setter/up.sql"), "utf8").replace(/--.*$/gm, "");
    // Additive: one nullable column with no default, so shares written before read as NULL.
    expect(sql.trim()).toBe("ALTER TABLE kitchen_dish_shares ADD COLUMN set_by TEXT;");
    expect(sql).not.toMatch(/\b(CREATE|DROP|UPDATE|DELETE|DEFAULT|NOT NULL)\b/i);
  });

  it("adds your measures as 300_kitchen_measures, the next migration after 290 (SM-13)", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(7, 9)).toEqual(["290_kitchen_dish_share_setter", "300_kitchen_measures"]);
    // 300 follows 290 in the manifest.
    expect(ids.indexOf("300_kitchen_measures")).toBe(ids.indexOf("290_kitchen_dish_share_setter") + 1);

    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "300_kitchen_measures/up.sql"), "utf8").replace(/--.*$/gm, "");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kitchen_measures \(/);
    // The pantry the way kitchen_items keys it, the name, the dimension.
    expect(sql).toMatch(/owner_kind\s+TEXT NOT NULL CHECK \(owner_kind IN \('user', 'group'\)\)/);
    expect(sql).toMatch(/owner_id\s+TEXT NOT NULL,/);
    expect(sql).toMatch(/dimension\s+TEXT NOT NULL CHECK \(dimension IN \('count', 'mass', 'volume', 'pack'\)\)/);
    // Exact: whole numbers above zero; at most three places.
    expect(sql).toMatch(/count\s+INTEGER NOT NULL CHECK \(count > 0\)/);
    expect(sql).toMatch(/amount_milli\s+INTEGER NOT NULL CHECK \(amount_milli > 0\)/);
    expect(sql).toMatch(/position\s+INTEGER NOT NULL CHECK \(position BETWEEN 0 AND 2\)/);
    expect(sql).toMatch(/UNIQUE \(owner_kind, owner_id, name_key, dimension, one\)/);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS kitchen_measures_lookup_idx\s+ON kitchen_measures \(owner_kind, owner_id, name_key, dimension, position\)/,
    );
    // Additive: two nullable labels with no default, so older moves and ingredients read as NULL.
    for (const table of ["kitchen_stock_moves", "kitchen_dish_ingredients"]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ADD COLUMN label TEXT\\s+CHECK \\(label IS NULL OR length\\(label\\) BETWEEN 1 AND 64\\);`));
    }
    expect(sql.match(/\bALTER\b/gi)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE)\b/i);
  });

  it("adds item notes as 330_kitchen_item_notes, the next kitchen migration after 300 (RC-3)", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id).slice(8, 10)).toEqual(["300_kitchen_measures", "330_kitchen_item_notes"]);
    // 310 and 320 are notifications' (PW-5): 330 follows them in the manifest.
    expect(ids.indexOf("330_kitchen_item_notes")).toBe(ids.indexOf("320_notification_push_preferences") + 1);
    expect(manifest.migrations.find((m) => m.id === "330_kitchen_item_notes")).toMatchObject({
      context: "kitchen",
      path: "330_kitchen_item_notes/up.sql",
    });

    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "330_kitchen_item_notes/up.sql"), "utf8").replace(/--.*$/gm, "");
    // Additive: one nullable column with no default, at most 80 characters, so items written before read as NULL.
    expect(sql.trim()).toBe("ALTER TABLE kitchen_items ADD COLUMN note TEXT\n  CHECK (note IS NULL OR length(note) <= 80);");
    expect(sql).not.toMatch(/\b(CREATE|DROP|UPDATE|DELETE|DEFAULT|NOT NULL)\b/i);
  });
});
