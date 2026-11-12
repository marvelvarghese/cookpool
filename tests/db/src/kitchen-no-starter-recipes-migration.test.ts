import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// Cookpool's recipes replaced (Cookpool RV-20): 590_kitchen_no_starter_recipes
// soft-deletes every one of 360's 42 recipes the way the app deletes a recipe
// (deleted_at), then seeds 13 Kerala recipes under usr_cookpool with their
// lines and guided steps. Checked as text (the delete first, no hard delete
// of a recipe, no LIKE or GLOB, plain INSERT for everything a CHECK guards)
// and against a real SQLite engine: what is left live, that nothing else is
// touched (a person's recipe, a copy saved of an old one, the old rows
// themselves), and that a rerun changes nothing. The recipes' content
// through the app (units, scaling, guided steps) is kitchen-worker's
// kerala-recipes suite.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "590_kitchen_no_starter_recipes";

const raw = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8");
/** The migration's SQL without its comments, and with every string literal emptied. */
const sqlOf = (id: string) => raw(id).replace(/--.*$/gm, "").replace(/'(?:[^']|'')*'/g, "''");
/** The runner's statements, each without the comment lines that lead it. */
const statementsOf = (id: string) => D1ApiAdapter.splitStatements(raw(id)).map((s) => s.replace(/^(?:\s*--[^\n]*\n)+/, "").trim());

/** Every manifest migration applied, or those numbered up to `through`. */
function migrated(through = Infinity): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations.filter((x) => Number(x.id.slice(0, 3)) <= through)) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

function apply590(db: DatabaseSync): void {
  for (const statement of statementsOf(ID)) db.exec(statement);
}

const NEW_ID = (n: number) => `c00c0590-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OLD_ID = (n: number) => `c00c0360-0000-4000-8000-${String(n).padStart(12, "0")}`;

const KERALA = [
  "Chicken curry (Kerala style)",
  "Chilli chicken",
  "Chicken kondattam",
  "Chettinad chicken curry",
  "Chicken roast (Kerala)",
  "Beef roast (Kerala ularthiyathu)",
  "Ghee rice with kaima curry",
  "Vadi matta rice",
  "Pork vindaloo",
  "Chilli pork",
  "Fish curry (Kerala, with kudampuli)",
  "Fish fry (Kerala masala)",
  "Beef fry (Kerala)",
];

describe("590_kitchen_no_starter_recipes (RV-20)", () => {
  it("is registered under kitchen, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    for (const earlier of ids.filter((id) => Number(id.slice(0, 3)) < 590)) expect(ids.indexOf(earlier)).toBeLessThan(ids.indexOf(ID));
  });

  it("deletes first and softly, hard-deletes no recipe, uses no pattern, and guards every CHECKed insert with plain INSERT", () => {
    const statements = statementsOf(ID);
    // The soft delete comes first, and spares 590's own ids, so a rerun after the inserts deletes nothing new.
    expect(statements[0]).toMatch(/^UPDATE kitchen_recipes\nSET deleted_at = strftime\('%Y-%m-%dT%H:%M:%fZ','now'\),\n {4}updated_at = strftime/);
    expect(statements[0]).toContain("AND deleted_at IS NULL");
    expect(statements[0]).toContain("AND substr(id, 1, 8) <> 'c00c0590'");
    const sql = sqlOf(ID);
    expect(sql).not.toMatch(/\b(DROP|ALTER|LIKE|GLOB)\b/i);
    expect(sql).not.toMatch(/DELETE FROM kitchen_recipes\b(?!_)/);
    // Only the new recipes' own lines and steps are ever deleted (to be inserted again).
    const deletes = statements.filter((s) => s.startsWith("DELETE"));
    expect(deletes).toHaveLength(26);
    for (const d of deletes) expect(d).toMatch(/^DELETE FROM kitchen_recipe_(lines|steps) WHERE recipe_id = 'c00c0590-0000-4000-8000-0000000000(0[1-9]|1[0-3])';?$/);
    // OR IGNORE only for the names; the recipe row skips only itself on a rerun.
    expect(sql.match(/INSERT OR IGNORE INTO (\w+)/g)).toEqual(["INSERT OR IGNORE INTO kitchen_food_names"]);
    expect(statements.filter((s) => s.startsWith("INSERT INTO kitchen_recipes ")).map((s) => /ON CONFLICT \(id\) DO NOTHING;?$/.test(s))).toEqual([true]);
    expect(statements.filter((s) => s.startsWith("INSERT INTO kitchen_recipe_lines"))).toHaveLength(13);
    expect(statements.filter((s) => s.startsWith("INSERT INTO kitchen_recipe_steps"))).toHaveLength(13);
    for (const statement of statements) expect(Buffer.byteLength(statement)).toBeLessThan(50_000);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    const all = <T>(query: string, ...params: unknown[]) => db.prepare(query).all(...(params as never[])) as T[];
    const one = <T>(query: string, ...params: unknown[]) => db.prepare(query).get(...(params as never[])) as T;

    it("leaves exactly the 13 Kerala recipes live under Cookpool, newest first in the owner's order", () => {
      const live = all<{ id: string; name: string; owner_id: string; is_system: number; visibility: string; serves_half: number; kind: string; tools: string }>(
        "SELECT * FROM kitchen_recipes WHERE is_system = 1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC",
      );
      expect(live.map((r) => r.name)).toEqual(KERALA);
      expect(live.map((r) => r.id)).toEqual(KERALA.map((_, i) => NEW_ID(i + 1)));
      for (const r of live) {
        expect(r).toMatchObject({ owner_id: "usr_cookpool", is_system: 1, visibility: "groups", serves_half: 8 });
        expect(["dal_curry", "rice", "snack"]).toContain(r.kind);
        expect((JSON.parse(r.tools) as string[]).length).toBeGreaterThanOrEqual(1);
      }
      // Every line a food on the list; every step keyed c00c0590-<recipe>-<step>.
      expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM kitchen_recipe_lines l LEFT JOIN kitchen_foods f ON f.key = l.food_key WHERE f.key IS NULL").n).toBe(0);
      for (const [i, r] of live.entries()) {
        const keys = all<{ step_key: string }>("SELECT step_key FROM kitchen_recipe_steps WHERE recipe_id = ? ORDER BY position", r.id).map((s) => s.step_key);
        expect(keys).toEqual(keys.map((_, p) => `c00c0590-${String(i + 1).padStart(2, "0")}-${String(p + 1).padStart(2, "0")}`));
        expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM kitchen_recipe_lines WHERE recipe_id = ? AND is_main = 1 AND to_taste = 0", r.id).n).toBe(1);
      }
    });

    it("soft-deletes all 42 old recipes and keeps every row of theirs", () => {
      const old = all<{ id: string; deleted_at: string | null; updated_at: string }>(
        "SELECT id, deleted_at, updated_at FROM kitchen_recipes WHERE substr(id, 1, 8) = 'c00c0360'",
      );
      expect(old).toHaveLength(42);
      for (const r of old) {
        expect(r.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(r.updated_at).toBe(r.deleted_at);
      }
      // Their lines and steps stay for what references them.
      expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM kitchen_recipe_lines WHERE substr(recipe_id, 1, 8) = 'c00c0360'").n).toBeGreaterThan(400);
      expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM kitchen_recipe_steps WHERE substr(recipe_id, 1, 8) = 'c00c0360'").n).toBeGreaterThan(200);
    });

    it("touches no person's recipe, and a copy saved of an old one stays live with its source", () => {
      const before = migrated(580);
      const now = "2026-11-12T10:00:00.000Z";
      before.exec(`INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility, source_recipe_id, source_owner_id, source_owner_name, created_at, updated_at)
                   VALUES ('11111111-1111-4111-8111-111111111111', 'usr_anu', 'Masala chai', 4, 'only_me', '${OLD_ID(32)}', 'usr_cookpool', 'Cookpool', '${now}', '${now}'),
                          ('22222222-2222-4222-8222-222222222222', 'usr_anu', 'My dal', 4, 'groups', NULL, NULL, NULL, '${now}', '${now}')`);
      apply590(before);
      const mine = before.prepare("SELECT id, deleted_at, updated_at, source_recipe_id FROM kitchen_recipes WHERE owner_id = 'usr_anu' ORDER BY id").all();
      expect(mine).toEqual([
        { id: "11111111-1111-4111-8111-111111111111", deleted_at: null, updated_at: now, source_recipe_id: OLD_ID(32) },
        { id: "22222222-2222-4222-8222-222222222222", deleted_at: null, updated_at: now, source_recipe_id: null },
      ]);
      before.close();
    });

    it("changes nothing when it runs again", () => {
      const snapshot = () =>
        ["kitchen_recipes", "kitchen_recipe_lines", "kitchen_recipe_steps", "kitchen_food_names", "kitchen_foods"].map((t) =>
          JSON.stringify(all(`SELECT * FROM ${t} ORDER BY 1, 2`)),
        );
      const first = snapshot();
      apply590(db);
      expect(snapshot()).toEqual(first);
    });

    it("adds names for kaima and matta rice, thenga kothu and Malabar tamarind, keeping names already taken, and links items named so", () => {
      const food = (name: string) => one<{ food_key: string } | undefined>("SELECT food_key FROM kitchen_food_names WHERE name_key = ?", name)?.food_key;
      expect([food("kaima rice"), food("jeerakasala rice"), food("vadi matta rice"), food("thenga kothu"), food("malabar tamarind")]).toEqual([
        "rice", "rice", "rice", "coconut", "kokum",
      ]);
      // Names 360 already gave stay where they were.
      expect([food("kudampuli"), food("matta rice"), food("keema")]).toEqual(["kokum", "rice", "mutton"]);

      // Items still unlinked and named one of the new names link once; an answered name and anything else stay.
      const before = migrated(580);
      const insert = before.prepare(
        `INSERT INTO kitchen_items (id, owner_kind, owner_subject_id, name, category, dimension, display_unit, qty_bought_milli,
           qty_left_milli, price_minor, currency, paid_by, bought_on, created_by, idem_key, food_key)
         VALUES (?, 'user', ?, ?, 'other', 'mass', 'g', 1000, 1000, 100, 'INR', ?, '2026-11-01', ?, ?, ?)`,
      );
      const items: Array<[string, string, string | null]> = [
        ["usr_anu", "Kaima rice", null],
        ["usr_anu", " Thenga kothu", null],
        ["usr_anu", "Basmati", "rice"], // linked already
        ["usr_anu", "Amul taaza", null], // still nothing
        ["usr_rahul", "Kaima rice", null], // Rahul's pantry said "none of these" for it
      ];
      items.forEach(([who, name, f], i) => insert.run(`i${i}`, who, name, who, who, `k${i}`, f));
      before.prepare("INSERT INTO kitchen_food_answers (owner_kind, owner_id, name_key, food_key, answered_by) VALUES ('user', 'usr_rahul', 'kaima rice', NULL, 'usr_rahul')").run();
      apply590(before);
      expect((before.prepare("SELECT food_key FROM kitchen_items ORDER BY id").all() as { food_key: string | null }[]).map((r) => r.food_key)).toEqual([
        "rice", "coconut", "rice", null, null,
      ]);
      before.close();
    });
  });
});
