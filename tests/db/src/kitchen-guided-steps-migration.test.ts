import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// Steps that guide (Cookpool GC-2, cookpool-guided design §1, §5, §6):
// 370_kitchen_guided_steps — every step's stable key (backfilled for the
// steps written before), its phase, lines, flame, time range or whistles,
// hands off, time rule, checkpoint and its sense, and tip; a recipe's tools;
// and kitchen_dish_step_times, one row per dish and step key. Checked as
// text (additive: ALTER, one backfill, CREATE … IF NOT EXISTS) and against a
// real SQLite engine: the backfill, and every rule the tables keep.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "370_kitchen_guided_steps";

const raw = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8");
/** The migration's SQL without its comments. */
const sqlOf = (id: string) => raw(id).replace(/--.*$/gm, "");
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

const STEP_COLUMNS = [
  "step_key", "phase", "line_refs", "heat", "min_seconds", "max_seconds", "whistles", "hands_off", "time_rule", "checkpoint", "sense", "tip",
];

describe("370_kitchen_guided_steps (GC-2)", () => {
  it("is registered under kitchen right after 360, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    expect(ids.indexOf(ID)).toBe(ids.indexOf("360_kitchen_cookpool_recipes") + 1);
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 370);
    expect(ids.slice(0, before.length)).toEqual(before);
  });

  it("only adds: twelve step columns and recipe tools, one backfill of keys, one table and two indexes", () => {
    const sql = sqlOf(ID);
    for (const column of STEP_COLUMNS) expect(sql).toMatch(new RegExp(`ALTER TABLE kitchen_recipe_steps ADD COLUMN ${column} `));
    expect(sql).toMatch(/ALTER TABLE kitchen_recipes ADD COLUMN tools TEXT NOT NULL DEFAULT '\[\]'/);
    expect(sql.match(/\bALTER\b/gi)).toHaveLength(13);
    expect(sql.match(/\bUPDATE\b/gi)).toHaveLength(1);
    expect(sql).toMatch(/UPDATE kitchen_recipe_steps SET step_key = lower\(hex\(randomblob\(16\)\)\) WHERE step_key IS NULL;/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kitchen_dish_step_times \(/);
    expect(sql).toMatch(/PRIMARY KEY \(dish_id, step_key\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS kitchen_recipe_steps_key_uq\s+ON kitchen_recipe_steps \(recipe_id, step_key\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS kitchen_dish_step_times_root_idx\s+ON kitchen_dish_step_times \(recipe_root_id, step_key\)/);
    expect(sql).not.toMatch(/\b(DROP|DELETE|INSERT)\b/i);
    // The key is backfilled before the unique index is built over it.
    const statements = statementsOf(ID);
    const backfill = statements.findIndex((s) => s.startsWith("UPDATE kitchen_recipe_steps"));
    const unique = statements.findIndex((s) => s.startsWith("CREATE UNIQUE INDEX"));
    expect(backfill).toBeGreaterThan(statements.findIndex((s) => s.includes("ADD COLUMN step_key")));
    expect(unique).toBeGreaterThan(backfill);
  });

  it("gives every step written before its own key, and reads it as a cook step of text only", () => {
    // Cookpool's 42 recipes (360) and one of a person's, written before 370.
    const db = migrated(360);
    const recipe = randomUUID();
    db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility) VALUES (?, 'usr_anu', 'Dal', 4, 'groups')").run(recipe);
    ["Wash the dal", "Pressure-cook it", "Temper"].forEach((text, position) =>
      db.prepare("INSERT INTO kitchen_recipe_steps (recipe_id, position, text) VALUES (?, ?, ?)").run(recipe, position, text),
    );
    const before = (db.prepare("SELECT COUNT(*) AS n FROM kitchen_recipe_steps").get() as { n: number }).n;
    for (const statement of statementsOf(ID)) db.exec(statement);

    const steps = db.prepare(`SELECT recipe_id, ${STEP_COLUMNS.join(", ")} FROM kitchen_recipe_steps`).all() as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(before);
    expect(before).toBeGreaterThan(200);
    for (const step of steps) {
      expect(step.step_key).toMatch(/^[0-9a-f]{32}$/);
      expect(step).toMatchObject({
        phase: "cook", line_refs: "[]", heat: null, min_seconds: null, max_seconds: null, whistles: null, hands_off: 0,
        time_rule: "fixed", checkpoint: null, sense: null, tip: null,
      });
    }
    // Each draws its own.
    expect(new Set(steps.map((s) => s.step_key)).size).toBe(steps.length);
    expect((db.prepare("SELECT DISTINCT tools FROM kitchen_recipes").all() as { tools: string }[]).map((r) => r.tools)).toEqual(["[]"]);
    db.close();
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    let recipe: string;
    beforeEach(() => {
      db = migrated();
      recipe = randomUUID();
      db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility) VALUES (?, 'usr_anu', 'Rajma', 4, 'groups')").run(recipe);
    });
    afterEach(() => db.close());

    type Step = Partial<Record<(typeof STEP_COLUMNS)[number] | "position" | "recipe_id", string | number | null>>;
    /** Insert one step (position 0, a fresh key, text "Stir") with these columns set. */
    const step = (values: Step) => () => {
      const row: Step = { recipe_id: recipe, position: 0, step_key: randomUUID().replace(/-/g, ""), ...values };
      const columns = [...Object.keys(row), "text"];
      db.prepare(`INSERT INTO kitchen_recipe_steps (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
        ...(Object.values(row) as never[]),
        "Stir",
      );
    };

    it("takes a fully guided step, and a pressure cooker's whistles", () => {
      expect(step({
        phase: "prep", line_refs: "[0, 3]", heat: 2, min_seconds: 480, max_seconds: 600, hands_off: 1, time_rule: "partly",
        checkpoint: "golden brown", sense: "look", tip: "Don't crowd the pan",
      })).not.toThrow();
      expect(step({ position: 1, whistles: 3, heat: 3, hands_off: 1 })).not.toThrow();
      expect(step({ position: 2, min_seconds: 0, max_seconds: 0 })).not.toThrow();
      expect(step({ position: 3, min_seconds: 86_400, max_seconds: 86_400, step_key: "rajma-soak_1" })).not.toThrow();
      expect(step({ position: 4, checkpoint: "Until it smells sweet" })).not.toThrow(); // a checkpoint with no sense
      const row = db.prepare("SELECT * FROM kitchen_recipe_steps WHERE recipe_id = ? AND position = 1").get(recipe) as Record<string, unknown>;
      expect(row).toMatchObject({ phase: "cook", line_refs: "[]", whistles: 3, min_seconds: null, time_rule: "fixed" });
    });

    it("refuses every value out of range, and the rules between columns", () => {
      for (const bad of [
        { phase: "serve" },
        { line_refs: "{}" },
        { line_refs: "not json" },
        { line_refs: JSON.stringify(Array.from({ length: 41 }, (_, i) => i % 40)) },
        { heat: 4 },
        { heat: -1 },
        { min_seconds: 60 }, // min with no max
        { max_seconds: 60 }, // max with no min
        { min_seconds: 600, max_seconds: 480 },
        { min_seconds: -1, max_seconds: 60 },
        { min_seconds: 60, max_seconds: 86_401 },
        { whistles: 0 },
        { whistles: 11 },
        { whistles: 2, min_seconds: 60, max_seconds: 120 }, // whistles never with seconds
        { hands_off: 2 },
        { time_rule: "quadratic" },
        { sense: "look" }, // a sense needs its checkpoint
        { sense: "hear", checkpoint: "it hisses" },
        { checkpoint: "" },
        { checkpoint: "x".repeat(81) },
        { tip: "" },
        { tip: "x".repeat(161) },
        { step_key: "" },
        { step_key: "has space" },
        { step_key: "x".repeat(65) },
      ] as Step[]) {
        expect(step(bad)).toThrow(/CHECK constraint failed/);
      }
      expect(step({ checkpoint: "x".repeat(80), tip: "x".repeat(160) })).not.toThrow();
    });

    it("keeps a key to one step of its recipe; another recipe may use the same key", () => {
      expect(step({ step_key: "soak" })).not.toThrow();
      expect(step({ position: 1, step_key: "soak" })).toThrow(/UNIQUE constraint failed/);
      const other = randomUUID();
      db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility) VALUES (?, 'usr_rahul', 'Rajma', 4, 'only_me')").run(other);
      expect(step({ recipe_id: other, step_key: "soak" })).not.toThrow();
    });

    it("keeps a recipe's tools to a JSON array of at most ten", () => {
      const tools = (value: string) => () => db.prepare("UPDATE kitchen_recipes SET tools = ? WHERE id = ?").run(value, recipe);
      expect(tools(JSON.stringify(["Pressure cooker", "Kadai with a lid"]))).not.toThrow();
      expect(tools(JSON.stringify(Array.from({ length: 10 }, (_, i) => `Tool ${i}`)))).not.toThrow();
      for (const bad of ['{"a": 1}', "Pressure cooker", JSON.stringify(Array.from({ length: 11 }, (_, i) => `Tool ${i}`))]) {
        expect(tools(bad)).toThrow(/CHECK constraint failed/);
      }
    });

    it("keeps one time per dish and step, for a dish and a recipe that exist, in range", () => {
      const dish = randomUUID();
      db.prepare(
        `INSERT INTO kitchen_dishes (id, cook, org_id, name, portions_half, extras_minor, ingredients_minor, total_minor,
                                     currency, split_mode, state, cooked_at, idem_key, recipe_id, recipe_factor_milli)
         VALUES (?, 'usr_rahul', NULL, 'Rajma', 4, 0, 0, 0, 'INR', 'assign', 'draft', '2026-11-08T12:00:00.000Z', 'rajma-1', ?, 450)`,
      ).run(dish, recipe);
      const time = (values: { dish?: string; key?: string; root?: string; seconds?: number; factor?: number | null; cook?: string }) => () =>
        db.prepare(
          `INSERT INTO kitchen_dish_step_times (dish_id, step_key, recipe_root_id, seconds, factor_milli, cook_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(values.dish ?? dish, values.key ?? "soak", values.root ?? recipe, values.seconds ?? 540,
          values.factor === undefined ? 450 : values.factor, values.cook ?? "usr_rahul");
      expect(time({})).not.toThrow();
      expect(time({ key: "fry", seconds: 0, factor: null })).not.toThrow();
      expect(time({ key: "boil", seconds: 86_400, factor: 20_000 })).not.toThrow();
      expect(time({})).toThrow(/UNIQUE|PRIMARY KEY/);
      for (const bad of [
        { key: "a", seconds: -1 },
        { key: "b", seconds: 86_401 },
        { key: "c", factor: 9 },
        { key: "d", factor: 20_001 },
        { key: "" },
        { key: "e", cook: "" },
      ]) {
        expect(time(bad)).toThrow(/CHECK constraint failed/);
      }
      expect(time({ key: "f", dish: randomUUID() })).toThrow(/FOREIGN KEY/);
      expect(time({ key: "g", root: randomUUID() })).toThrow(/FOREIGN KEY/);
      const row = db.prepare("SELECT created_at FROM kitchen_dish_step_times WHERE step_key = 'soak'").get() as { created_at: string };
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const plan = (db.prepare(
        "EXPLAIN QUERY PLAN SELECT seconds, factor_milli FROM kitchen_dish_step_times WHERE recipe_root_id = ? AND step_key = 'soak'",
      ).all(recipe) as { detail: string }[]).map((p) => p.detail);
      expect(plan.join("\n")).toMatch(/kitchen_dish_step_times_root_idx/);
    });

    it("skips a step that fails a CHECK without a word under INSERT OR IGNORE — so a seed of steps is applied strictly", () => {
      const insert = (verb: string) => () =>
        db.prepare(`${verb} INTO kitchen_recipe_steps (recipe_id, position, text, step_key, whistles, min_seconds, max_seconds) VALUES (?, 0, 'Cook', 'k', 3, 60, 60)`).run(recipe);
      expect(insert("INSERT OR IGNORE")).not.toThrow();
      expect((db.prepare("SELECT COUNT(*) AS n FROM kitchen_recipe_steps WHERE recipe_id = ?").get(recipe) as { n: number }).n).toBe(0);
      expect(insert("INSERT")).toThrow(/CHECK constraint failed/);
    });
  });
});
