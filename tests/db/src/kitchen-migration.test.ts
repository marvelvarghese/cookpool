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

  it("only creates kitchen_* tables, each guarded with IF NOT EXISTS", () => {
    for (const m of kitchen) {
      // Statements only: the header comments may name what they describe.
      const sql = readFileSync(resolve(MIGRATIONS_ROOT, m.path), "utf8").replace(/--.*$/gm, "");
      const creates = [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(IF NOT EXISTS\s+)?([a-z_]+)/gi)];
      expect(creates.length).toBeGreaterThan(0);
      for (const [, kind, guard, name] of creates) {
        expect(guard).toBeDefined();
        if (kind!.toUpperCase() === "TABLE") expect(name).toMatch(/^kitchen_/);
      }
    }
  });

  it("creates kitchen_group_settings keyed by the group", () => {
    const sql = readFileSync(resolve(MIGRATIONS_ROOT, "210_kitchen_settings/up.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kitchen_group_settings/);
    expect(sql).toMatch(/org_id\s+TEXT PRIMARY KEY/);
  });

  it("adds the ledger as 220_kitchen_ledger, right after the settings", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(kitchen.map((m) => m.id)).toEqual(["210_kitchen_settings", "220_kitchen_ledger"]);
    expect(ids.indexOf("220_kitchen_ledger")).toBe(ids.indexOf("210_kitchen_settings") + 1);
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
});
