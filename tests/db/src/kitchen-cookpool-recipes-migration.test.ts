import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// The full food list and Cookpool's own recipes (Cookpool RC-7,
// cookpool-recipes design §2, §3.3, §5.5, §6): 360_kitchen_cookpool_recipes
// adds kitchen_foods.g_per_ml, brings the list to about 300 foods with their
// names in English, Hindi and regional words, and seeds about 40 recipes under
// usr_cookpool. Checked as text (additive, seeds that ignore only re-runs) and
// against a real SQLite engine (every manifest migration applied): the
// column, the counts, RC-4's foods untouched, every name on one food, the
// densities, the recipes' shape, and the backfill of items already in
// pantries. The recipes' content against the contracts (units, scaling) is
// kitchen-worker's cookpool-recipes suite.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "360_kitchen_cookpool_recipes";

const raw = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8");
/** The migration's SQL without its comments, and with every string literal emptied (a step may say "drop"). */
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

const KINDS = ["breakfast", "dal_curry", "rice", "roti", "snack", "sweet", "drink", "other"];
const CATEGORIES = ["veg", "fruit", "dairy", "grains", "protein", "spices", "other"];

describe("360_kitchen_cookpool_recipes (RC-7)", () => {
  it("is registered under kitchen right after 350, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    expect(ids.indexOf(ID)).toBe(ids.indexOf("350_kitchen_recipes") + 1);
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 360);
    expect(ids.slice(0, before.length)).toEqual(before);
  });

  it("adds one nullable REAL column, seeds with INSERT OR IGNORE only, and updates only unset densities and unlinked items", () => {
    const sql = sqlOf(ID);
    expect(sql).toMatch(/ALTER TABLE kitchen_foods ADD COLUMN g_per_ml REAL NULL CHECK \(g_per_ml IS NULL OR \(g_per_ml > 0 AND g_per_ml <= 5\)\);/);
    expect(sql.match(/\bALTER\b/gi)).toHaveLength(1);
    const inserts = sql.match(/\bINSERT\b/gi)!.length;
    expect(inserts).toBeGreaterThan(10);
    expect(sql.match(/INSERT OR IGNORE INTO kitchen_(foods|food_names|recipes|recipe_lines|recipe_steps) /g)).toHaveLength(inserts);
    // Two updates: RC-4's densities where unset, and items still unlinked whose pantry never answered for the name.
    expect(sql.match(/\bUPDATE\b/gi)).toHaveLength(2);
    expect(sql).toMatch(/UPDATE kitchen_foods SET g_per_ml = CASE key[\s\S]*?\nEND\nWHERE g_per_ml IS NULL AND key IN \(/);
    expect(sql).toMatch(/UPDATE kitchen_items SET food_key = COALESCE\([\s\S]*\)\nWHERE food_key IS NULL\n {2}AND NOT EXISTS \(\n {4}SELECT 1 FROM kitchen_food_answers a/);
    expect(sql).not.toMatch(/\b(DROP|DELETE)\b/i);
    // Every statement stays well under D1's 100 KB statement limit.
    for (const statement of statementsOf(ID)) expect(Buffer.byteLength(statement)).toBeLessThan(50_000);
  });

  it("lands every seed row — plain INSERT on top of 350 refuses none — and adds nothing when its seed runs again", () => {
    // INSERT OR IGNORE skips a row that fails a CHECK without a word, so the seed is applied strictly first.
    const db = migrated(350);
    for (const statement of statementsOf(ID)) db.exec(statement.replace(/^INSERT OR IGNORE INTO/, "INSERT INTO"));
    const counts = () =>
      ["kitchen_foods", "kitchen_food_names", "kitchen_recipes", "kitchen_recipe_lines", "kitchen_recipe_steps"].map(
        (t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
      );
    const first = counts();
    for (const statement of statementsOf(ID).filter((s) => !s.startsWith("ALTER"))) db.exec(statement);
    expect(counts()).toEqual(first);
    db.close();
  });

  it("links the items already in pantries to the new names once, and leaves a name a pantry answered alone", () => {
    const db = migrated(350);
    const insert = db.prepare(
      `INSERT INTO kitchen_items (id, owner_kind, owner_subject_id, name, category, dimension, display_unit, qty_bought_milli,
         qty_left_milli, price_minor, currency, paid_by, bought_on, created_by, idem_key, food_key)
       VALUES (?, 'user', ?, ?, 'other', 'mass', 'g', 1000, 1000, 100, 'INR', ?, '2026-11-01', ?, ?, ?)`,
    );
    const items: Array<[string, string, string | null]> = [
      ["usr_anu", "Kaju", null], // a new food
      ["usr_anu", "Arhar", null], // a new name of RC-4's toor dal
      ["usr_anu", "Sabudana ", null],
      ["usr_anu", "Amul taaza", null], // still nothing
      ["usr_anu", "Onions", "potato"], // linked already (here, oddly): left as it is
      ["usr_rahul", "Kaju", null], // Rahul's pantry said "none of these" for kaju
    ];
    items.forEach(([who, name, food], i) => insert.run(`i${i}`, who, name, who, who, `k${i}`, food));
    db.prepare("INSERT INTO kitchen_food_answers (owner_kind, owner_id, name_key, food_key, answered_by) VALUES ('user', 'usr_rahul', 'kaju', NULL, 'usr_rahul')").run();
    for (const statement of statementsOf(ID)) db.exec(statement);
    const linked = () => (db.prepare("SELECT food_key FROM kitchen_items ORDER BY id").all() as { food_key: string | null }[]).map((r) => r.food_key);
    expect(linked()).toEqual(["cashews", "toor_dal", "sabudana", null, "potato", null]);
    // Running the backfill again changes nothing that is linked.
    db.prepare("UPDATE kitchen_items SET food_key = 'almonds' WHERE id = 'i0'").run();
    db.exec(statementsOf(ID).find((s) => s.startsWith("UPDATE kitchen_items"))!);
    expect(linked()[0]).toBe("almonds");
    db.close();
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    // Every migration before 590, which deleted these recipes and seeded 13 in
    // their place (RV-20; kitchen-no-starter-recipes-migration checks what it leaves).
    beforeEach(() => {
      db = migrated(580);
    });
    afterEach(() => db.close());

    const all = <T>(query: string, ...params: unknown[]) => db.prepare(query).all(...(params as never[])) as T[];
    const one = <T>(query: string, ...params: unknown[]) => db.prepare(query).get(...(params as never[])) as T;
    const named = (name: string) => one<{ food_key: string } | undefined>("SELECT food_key FROM kitchen_food_names WHERE name_key = ?", name)?.food_key;
    const density = (key: string) => one<{ g_per_ml: number | null }>("SELECT g_per_ml FROM kitchen_foods WHERE key = ?", key).g_per_ml;

    it("adds kitchen_foods.g_per_ml: a nullable REAL with no default, above zero and at most 5", () => {
      expect(all<{ name: string; type: string; notnull: number; dflt_value: unknown }>("PRAGMA table_info(kitchen_foods)").find((c) => c.name === "g_per_ml")).toEqual(
        expect.objectContaining({ type: "REAL", notnull: 0, dflt_value: null }),
      );
      const insert = (key: string, d: number | null) => () =>
        db.prepare("INSERT INTO kitchen_foods (key, name, dimension, each_g, category, g_per_ml) VALUES (?, 'X', 'mass', NULL, 'other', ?)").run(key, d);
      expect(insert("kohlrabi", null)).not.toThrow();
      expect(insert("kohlrabi_2", 0.55)).not.toThrow();
      for (const bad of [insert("x1", 0), insert("x2", -0.5), insert("x3", 5.5)]) expect(bad).toThrow(/CHECK constraint failed/);
    });

    it("brings the list to about 300 foods, each in a pantry category and named by its own key in words; counted ones weigh something", () => {
      const foods = all<{ key: string; name: string; dimension: string; each_g: number | null; category: string }>(
        "SELECT key, name, dimension, each_g, category FROM kitchen_foods ORDER BY key",
      );
      expect(foods.length).toBeGreaterThanOrEqual(280);
      expect(foods.length).toBeLessThanOrEqual(340);
      for (const food of foods) {
        expect(CATEGORIES).toContain(food.category);
        expect(food.key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(named(food.key.replace(/_/g, " "))).toBe(food.key);
        if (food.dimension === "count") expect(food.each_g).not.toBeNull();
      }
      // Every part of the kitchen the design names.
      const byCategory = (c: string) => foods.filter((f) => f.category === c).length;
      expect(byCategory("veg")).toBeGreaterThanOrEqual(50);
      expect(byCategory("fruit")).toBeGreaterThanOrEqual(20);
      expect(byCategory("grains")).toBeGreaterThanOrEqual(40);
      expect(byCategory("spices")).toBeGreaterThanOrEqual(50);
      expect(byCategory("dairy")).toBeGreaterThanOrEqual(12);
      expect(byCategory("protein")).toBeGreaterThanOrEqual(12);
      for (const key of [
        "sweet_potato", "bottle_gourd", "drumstick", "mango", "pomegranate", "sabudana", "ragi_flour", "whole_moong", "black_chana",
        "buttermilk", "prawns", "cumin_powder", "sambar_powder", "kasuri_methi", "coconut_oil", "soy_sauce", "baking_soda", "cashews", "papad",
        "coffee_powder", "coconut_water", "juice",
      ]) {
        expect(foods.map((f) => f.key)).toContain(key);
      }
      // People count these: an egg is about 50 g, an onion about 150 g, a banana about 120 g.
      expect(foods.find((f) => f.key === "egg")).toMatchObject({ dimension: "count", each_g: 50 });
      expect(foods.find((f) => f.key === "onion")).toMatchObject({ each_g: 150 });
      expect(foods.find((f) => f.key === "banana")).toMatchObject({ each_g: 120 });
      expect(foods.find((f) => f.key === "pav")).toMatchObject({ dimension: "count", each_g: 40 });
    });

    it("keeps RC-4's 70 foods and every name 340 gave them as they were, and adds names to them", () => {
      const before = migrated(350);
      const foodsOf = (d: DatabaseSync) => d.prepare("SELECT key, name, dimension, each_g, category FROM kitchen_foods ORDER BY key").all();
      const rc4 = foodsOf(before) as { key: string }[];
      expect(rc4).toHaveLength(70);
      const now = new Map((foodsOf(db) as { key: string }[]).map((f) => [f.key, f]));
      for (const food of rc4) expect(now.get(food.key)).toEqual(food);
      const rc4Names = before.prepare("SELECT name_key, food_key FROM kitchen_food_names ORDER BY name_key").all() as { name_key: string; food_key: string }[];
      expect(rc4Names.length).toBeGreaterThanOrEqual(330);
      for (const { name_key, food_key } of rc4Names) expect(named(name_key)).toBe(food_key);
      before.close();
      // New words for old foods.
      expect(["arhar", "tuvar", "kandi pappu", "takkali", "pachi mirchi", "kariveppila", "rohu", "surmai", "keema", "boneless chicken", "perugu", "doi"].map(named)).toEqual([
        "toor_dal", "toor_dal", "toor_dal", "tomato", "green_chilli", "curry_leaves", "fish", "fish", "mutton", "chicken", "curd", "curd",
      ]);
    });

    it("keeps every name folded and on exactly one food, in English, Hindi and the regional words", () => {
      const names = all<{ name_key: string }>("SELECT name_key FROM kitchen_food_names");
      expect(names.length).toBeGreaterThanOrEqual(1500);
      expect(new Set(names.map((n) => n.name_key)).size).toBe(names.length);
      for (const { name_key } of names) {
        expect(name_key).toBe(name_key.trim().toLowerCase());
        expect(name_key).toMatch(/^[a-z0-9][a-z0-9 -]*$/);
      }
      expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM kitchen_food_names n LEFT JOIN kitchen_foods f ON f.key = n.food_key WHERE f.key IS NULL").n).toBe(0);
      expect([
        "kaju", "badam", "sabudana", "javvarisi", "saggubiyyam", "saunf", "sombu", "methi dana", "vendhayam", "ajwain", "omam", "kalonji",
        "lauki", "sorakkai", "karela", "pavakkai", "korola", "shevga", "murungakkai", "chaas", "majjiga", "moru", "jhinga", "chingri", "kolambi",
      ].map(named)).toEqual([
        "cashews", "almonds", "sabudana", "sabudana", "sabudana", "fennel_seeds", "fennel_seeds", "fenugreek_seeds", "fenugreek_seeds", "ajwain", "ajwain", "kalonji",
        "bottle_gourd", "bottle_gourd", "bitter_gourd", "bitter_gourd", "bitter_gourd", "drumstick", "drumstick", "buttermilk", "buttermilk", "buttermilk", "prawns", "prawns", "prawns",
      ]);
      expect(() => db.prepare("INSERT INTO kitchen_food_names (name_key, food_key) VALUES ('kaju', 'almonds')").run()).toThrow(/UNIQUE|PRIMARY KEY/);
    });

    it("gives the foods measured by the spoon or cup a density: spices, salt, sugar, flours, rice, dals, oil and ghee", () => {
      expect(density("turmeric")).toBeCloseTo(0.6);
      expect(density("salt")).toBeCloseTo(1.2);
      expect(density("sugar")).toBeCloseTo(0.85);
      expect(density("oil")).toBeCloseTo(0.92);
      expect(density("ghee")).toBeCloseTo(0.9);
      expect(density("rice")).toBeCloseTo(0.8);
      for (const spice of ["red_chilli_powder", "coriander_powder", "cumin", "cumin_powder", "garam_masala", "black_pepper", "chaat_masala", "sambar_powder", "amchur"]) {
        expect(density(spice)).toBeGreaterThanOrEqual(0.35);
        expect(density(spice)).toBeLessThanOrEqual(0.7);
      }
      for (const flour of ["atta", "maida", "rice_flour", "ragi_flour", "cornflour"]) {
        expect(density(flour)).toBeGreaterThanOrEqual(0.45);
        expect(density(flour)).toBeLessThanOrEqual(0.65);
      }
      for (const dal of ["toor_dal", "moong_dal", "masoor_dal", "chana_dal", "urad_dal", "whole_moong"]) {
        expect(density(dal)).toBeGreaterThanOrEqual(0.75);
        expect(density(dal)).toBeLessThanOrEqual(0.9);
      }
      // Liquids weigh about what water does.
      for (const liquid of ["water", "milk", "buttermilk", "coconut_milk"]) {
        expect(density(liquid)).toBeGreaterThanOrEqual(1);
        expect(density(liquid)).toBeLessThanOrEqual(1.05);
      }
      // Not everything has one: paneer is cubed, chicken is weighed.
      expect([density("paneer"), density("chicken"), density("egg"), density("bay_leaf")]).toEqual([null, null, null, null]);
      expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM kitchen_foods WHERE g_per_ml IS NOT NULL").n).toBeGreaterThanOrEqual(150);
    });

    it("seeds about 40 Cookpool recipes under usr_cookpool: everyone sees them, nobody edits them, each filed under a kind", () => {
      const recipes = all<{
        id: string; owner_id: string; name: string; serves_half: number; minutes: number | null; visibility: string; link_code: string | null;
        source_recipe_id: string | null; is_system: number; kind: string; created_at: string; deleted_at: string | null;
      }>("SELECT * FROM kitchen_recipes ORDER BY created_at DESC");
      expect(recipes.length).toBeGreaterThanOrEqual(38);
      // Explore lists at most 50: every one of them fits on it.
      expect(recipes.length).toBeLessThanOrEqual(50);
      for (const r of recipes) {
        expect(r).toMatchObject({ owner_id: "usr_cookpool", is_system: 1, visibility: "groups", link_code: null, source_recipe_id: null, deleted_at: null });
        expect(KINDS).toContain(r.kind);
        expect(r.serves_half % 2).toBe(0);
        expect(r.serves_half).toBeGreaterThanOrEqual(4);
        expect(r.serves_half).toBeLessThanOrEqual(12);
        expect(r.minutes).toBeGreaterThan(0);
      }
      expect(new Set(recipes.map((r) => r.name)).size).toBe(recipes.length);
      expect(new Set(recipes.map((r) => r.created_at)).size).toBe(recipes.length);
      // The home staples.
      const names = recipes.map((r) => r.name.toLowerCase()).join(" | ");
      for (const staple of [
        "poha", "upma", "egg bhurji", "masala omelette", "aloo paratha", "plain paratha", "chapati", "dal tadka", "dal fry", "rajma", "chole",
        "sambar", "rasam", "palak paneer", "paneer bhurji", "matar paneer", "aloo gobi", "bhindi fry", "baingan bharta", "chicken curry",
        "egg curry", "fish curry", "jeera rice", "veg pulao", "lemon rice", "curd rice", "khichdi", "fried rice", "masala chai", "filter coffee",
        "lassi", "onion pakoda", "sheera", "kheer", "besan ladoo",
      ]) {
        expect(names).toContain(staple);
      }
      // Every chip has something under it.
      for (const kind of ["breakfast", "dal_curry", "rice", "roti", "snack", "sweet", "drink"]) expect(recipes.some((r) => r.kind === kind)).toBe(true);
    });

    it("gives every Cookpool recipe exactly one main line with an amount, every line a food on the list, and 3 to 8 steps of at most 200 characters", () => {
      const recipes = all<{ id: string }>("SELECT id FROM kitchen_recipes WHERE is_system = 1");
      const asSeeded = migrated(380);
      for (const { id } of recipes) {
        const lines = all<{ food_key: string | null; qty_milli: number | null; unit: string | null; to_taste: number; is_main: number }>(
          "SELECT food_key, qty_milli, unit, to_taste, is_main FROM kitchen_recipe_lines WHERE recipe_id = ? ORDER BY position", id,
        );
        expect(lines.length).toBeGreaterThanOrEqual(3);
        const mains = lines.filter((l) => l.is_main === 1);
        expect(mains).toHaveLength(1);
        expect(mains[0]!.to_taste).toBe(0);
        for (const line of lines) {
          expect(line.food_key).not.toBeNull();
          if (line.to_taste === 0) expect(line.qty_milli).toBeGreaterThan(0);
        }
        // 360's own steps, before GC-4's 390 rewrote them as guided steps (kitchen-cookpool-guided-migration).
        const steps = asSeeded.prepare("SELECT text FROM kitchen_recipe_steps WHERE recipe_id = ? ORDER BY position").all(id) as { text: string }[];
        expect(steps.length).toBeGreaterThanOrEqual(3);
        expect(steps.length).toBeLessThanOrEqual(8);
        for (const { text } of steps) expect(text.length).toBeLessThanOrEqual(200);
      }
      // Every line's food is on the list (the foreign key, checked here too).
      expect(
        one<{ n: number }>("SELECT COUNT(*) AS n FROM kitchen_recipe_lines l LEFT JOIN kitchen_foods f ON f.key = l.food_key WHERE f.key IS NULL").n,
      ).toBe(0);
      asSeeded.close();
    });
  });
});
