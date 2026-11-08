import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// Foods and recipes (Cookpool RC-4, cookpool-recipes design §2, §3, §6):
// 340_kitchen_foods — the shared food list, its names, the item's link to a
// food, the "asked once" answers and Always have, with the seed — and
// 350_kitchen_recipes — recipes, their lines and steps, and the dish's link
// to a recipe. Checked as text (additive, kitchen_* only) and against a real
// SQLite engine (every manifest migration applied): the seed, and every rule
// the tables keep themselves.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");

const sqlOf = (id: string) =>
  readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) {
      db.exec(statement);
    }
  }
  return db;
}

describe("the foods and recipes migrations (RC-4)", () => {
  const ids = manifest.migrations.map((m) => m.id);

  it("registers 340_kitchen_foods and 350_kitchen_recipes under kitchen, 350 right after 340, after every earlier migration", () => {
    const foods = manifest.migrations.find((m) => m.id === "340_kitchen_foods");
    const recipes = manifest.migrations.find((m) => m.id === "350_kitchen_recipes");
    expect(foods).toMatchObject({ context: "kitchen", path: "340_kitchen_foods/up.sql" });
    expect(recipes).toMatchObject({ context: "kitchen", path: "350_kitchen_recipes/up.sql" });
    expect(ids.indexOf("350_kitchen_recipes")).toBe(ids.indexOf("340_kitchen_foods") + 1);
    // Every migration numbered below 340 comes before it (330 is RC-3's, whichever lands first).
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 340);
    expect(ids.slice(0, before.length)).toEqual(before);
  });

  it("340 creates the food tables, links items by one nullable column, and seeds with INSERT OR IGNORE only", () => {
    const sql = sqlOf("340_kitchen_foods");
    for (const table of ["kitchen_foods", "kitchen_food_names", "kitchen_food_answers", "kitchen_always_have", "kitchen_always_have_lists"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    }
    expect(sql).toMatch(/dimension\s+TEXT NOT NULL CHECK \(dimension IN \('mass', 'volume', 'count'\)\)/);
    expect(sql).toMatch(/name_key\s+TEXT PRIMARY KEY CHECK \(length\(name_key\) BETWEEN 1 AND 120 AND name_key = lower\(trim\(name_key\)\)\)/);
    expect(sql).toMatch(/PRIMARY KEY \(owner_kind, owner_id, name_key\)/);
    expect(sql).toMatch(/PRIMARY KEY \(user_id, food_key\)/);
    // Additive: one nullable column with no default, so items added before read as unlinked.
    expect(sql).toMatch(/ALTER TABLE kitchen_items ADD COLUMN food_key TEXT REFERENCES kitchen_foods\(key\);/);
    expect(sql.match(/\bALTER\b/gi)).toHaveLength(1);
    expect(sql.match(/\bINSERT\b/gi)).toHaveLength(2);
    expect(sql.match(/INSERT OR IGNORE INTO/g)).toHaveLength(2);
    // One backfill: items already in pantries, only those still unlinked.
    expect(sql.match(/\bUPDATE\b/gi)).toHaveLength(1);
    expect(sql).toMatch(/UPDATE kitchen_items SET food_key = COALESCE\([\s\S]*\)\nWHERE food_key IS NULL;/);
    expect(sql).not.toMatch(/\b(DROP|DELETE)\b/i);
  });

  it("350 creates recipes, lines and steps, and adds three nullable columns to the dish tables", () => {
    const sql = sqlOf("350_kitchen_recipes");
    for (const table of ["kitchen_recipes", "kitchen_recipe_lines", "kitchen_recipe_steps"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    }
    expect(sql).toMatch(/visibility\s+TEXT NOT NULL CHECK \(visibility IN \('only_me', 'groups', 'link'\)\)/);
    expect(sql).toMatch(/link_code\s+TEXT UNIQUE CHECK \(link_code IS NULL OR length\(link_code\) = 10\)/);
    expect(sql).toMatch(/CHECK \(\(visibility = 'link'\) = \(link_code IS NOT NULL\)\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS kitchen_recipe_lines_main_uq\s+ON kitchen_recipe_lines \(recipe_id\) WHERE is_main = 1/);
    expect(sql).toMatch(/ALTER TABLE kitchen_dishes ADD COLUMN recipe_id TEXT;/);
    expect(sql).toMatch(/ALTER TABLE kitchen_dishes ADD COLUMN recipe_factor_milli INTEGER/);
    expect(sql).toMatch(/ALTER TABLE kitchen_dish_ingredients ADD COLUMN recipe_line INTEGER/);
    expect(sql.match(/\bALTER\b/gi)).toHaveLength(3);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT)\b/i);
  });

  it("links the items already in pantries once, by the same lookup an item added later gets", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const apply = (m: (typeof manifest.migrations)[number]) => {
      for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
    };
    const before = manifest.migrations.filter((m) => Number(m.id.slice(0, 3)) < 340);
    before.forEach(apply);
    const insert = db.prepare(
      `INSERT INTO kitchen_items (id, owner_kind, owner_subject_id, name, category, dimension, display_unit, qty_bought_milli,
         qty_left_milli, price_minor, currency, paid_by, bought_on, created_by, idem_key)
       VALUES (?, 'user', 'usr_rahul', ?, 'veg', 'mass', 'kg', 1000, 1000, 100, 'INR', 'usr_rahul', '2026-11-01', 'usr_rahul', ?)`,
    );
    const names = ["Onions", " Pyaz ", "Tomatoes", "Green chillies", "Amul taaza", "Toor dal"];
    names.forEach((name, i) => insert.run(`i${i}`, name, `k${i}`));
    manifest.migrations.filter((m) => Number(m.id.slice(0, 3)) >= 340).forEach(apply);
    const linked = () => (db.prepare("SELECT food_key FROM kitchen_items ORDER BY id").all() as { food_key: string | null }[]).map((r) => r.food_key);
    expect(linked()).toEqual(["onion", "onion", "tomato", "green_chilli", null, "toor_dal"]);
    // Running 340's backfill again changes nothing that is linked.
    db.prepare("UPDATE kitchen_items SET food_key = 'potato' WHERE id = 'i0'").run();
    const backfill = D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, "340_kitchen_foods/up.sql"), "utf8")).find((st) =>
      st.includes("UPDATE kitchen_items"),
    )!;
    db.exec(backfill);
    expect(linked()[0]).toBe("potato");
    db.close();
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    const all = <T>(query: string, ...params: unknown[]) => db.prepare(query).all(...(params as never[])) as T[];
    const one = <T>(query: string, ...params: unknown[]) => db.prepare(query).get(...(params as never[])) as T;

    it("seeds about 60 everyday foods, each in a pantry category, named by its own key and by its common names", () => {
      const foods = all<{ key: string; name: string; dimension: string; each_g: number | null; category: string }>(
        "SELECT key, name, dimension, each_g, category FROM kitchen_foods ORDER BY key",
      );
      expect(foods.length).toBeGreaterThanOrEqual(55);
      expect(foods.length).toBeLessThanOrEqual(80);
      const categories = new Set(["veg", "fruit", "dairy", "grains", "protein", "spices", "other"]);
      for (const food of foods) {
        expect(categories.has(food.category)).toBe(true);
        expect(food.key).toMatch(/^[a-z][a-z0-9_]*$/);
        // Every food answers to its own key in words ("toor dal" for toor_dal).
        expect(one<{ food_key: string }>("SELECT food_key FROM kitchen_food_names WHERE name_key = ?", food.key.replace(/_/g, " "))).toEqual({
          food_key: food.key,
        });
      }
      // The ones the design names, with the words people use for them.
      const named = (name: string) => one<{ food_key: string } | undefined>("SELECT food_key FROM kitchen_food_names WHERE name_key = ?", name)?.food_key;
      expect(["onion", "onions", "pyaz", "kanda"].map(named)).toEqual(["onion", "onion", "onion", "onion"]);
      expect(["aloo", "chawal", "dahi", "yogurt", "haldi", "dhaniya", "jeera", "dal", "atta", "besan", "paneer", "ghee"].map(named)).toEqual([
        "potato", "rice", "curd", "curd", "turmeric", "coriander_leaves", "cumin", "toor_dal", "atta", "besan", "paneer", "ghee",
      ]);
      expect(named("ginger garlic paste")).toBe("ginger_garlic_paste");
      expect(named("garam masala")).toBe("garam_masala");
      // Always have's defaults exist.
      expect(["salt", "water"].map(named)).toEqual(["salt", "water"]);
      // The things people count weigh something; an egg is about 50 g, an onion about 150 g.
      expect(foods.find((f) => f.key === "egg")).toMatchObject({ dimension: "count", each_g: 50 });
      expect(foods.find((f) => f.key === "onion")).toMatchObject({ dimension: "mass", each_g: 150 });
      expect(foods.find((f) => f.key === "milk")).toMatchObject({ dimension: "volume", each_g: null });
    });

    it("keeps every name folded and on exactly one food", () => {
      const names = all<{ name_key: string }>("SELECT name_key FROM kitchen_food_names");
      expect(names.length).toBeGreaterThan(200);
      for (const { name_key } of names) expect(name_key).toBe(name_key.trim().toLowerCase());
      expect(() => db.prepare("INSERT INTO kitchen_food_names (name_key, food_key) VALUES ('onion', 'tomato')").run()).toThrow(/UNIQUE|PRIMARY KEY/);
      for (const bad of ["Onion", " onion2", ""]) {
        expect(() => db.prepare("INSERT INTO kitchen_food_names (name_key, food_key) VALUES (?, 'onion')").run(bad)).toThrow(/CHECK constraint failed/);
      }
      expect(() => db.prepare("INSERT INTO kitchen_food_names (name_key, food_key) VALUES ('shallot', 'no_such_food')").run()).toThrow(
        /FOREIGN KEY constraint failed/,
      );
    });

    it("checks a food's key, dimension and piece weight in the table itself", () => {
      const insert = (key: string, dimension = "mass", eachG: number | null = null) => () =>
        db.prepare("INSERT INTO kitchen_foods (key, name, dimension, each_g, category) VALUES (?, 'X', ?, ?, 'veg')").run(key, dimension, eachG);
      expect(insert("shallot", "count", 20)).not.toThrow();
      for (const bad of [insert("Shallot"), insert("red onion"), insert(""), insert("leek", "weight"), insert("leek", "pack"), insert("leek", "count", 0)]) {
        expect(bad).toThrow(/CHECK constraint failed/);
      }
    });

    it("links an item to one food, keeps one answer per name in a pantry, and one Always have row per food", () => {
      db.prepare(
        `INSERT INTO kitchen_items (id, owner_kind, owner_subject_id, name, category, dimension, display_unit, qty_bought_milli,
           qty_left_milli, price_minor, currency, paid_by, bought_on, created_by, idem_key, food_key)
         VALUES ('i1', 'user', 'usr_rahul', 'Kanda', 'veg', 'mass', 'kg', 1000000, 1000000, 4000, 'INR', 'usr_rahul', '2026-11-05', 'usr_rahul', 'k1', 'onion')`,
      ).run();
      expect(one<{ food_key: string }>("SELECT food_key FROM kitchen_items WHERE id = 'i1'")).toEqual({ food_key: "onion" });
      expect(() => db.prepare("UPDATE kitchen_items SET food_key = 'no_such_food' WHERE id = 'i1'").run()).toThrow(/FOREIGN KEY/);

      const answer = (name: string, food: string | null) =>
        db.prepare("INSERT INTO kitchen_food_answers (owner_kind, owner_id, name_key, food_key, answered_by) VALUES ('user', 'usr_rahul', ?, ?, 'usr_rahul')").run(name, food);
      answer("kanda", "onion");
      answer("amul taaza", null); // "none of these" is an answer too
      expect(() => answer("kanda", "potato")).toThrow(/UNIQUE|PRIMARY KEY/);
      expect(() => answer("Kanda ", "onion")).toThrow(/CHECK constraint failed/);
      expect(() => db.prepare("INSERT INTO kitchen_food_answers (owner_kind, owner_id, name_key, food_key, answered_by) VALUES ('team', 'x', 'kanda', 'onion', 'u')").run()).toThrow(
        /CHECK constraint failed/,
      );

      db.prepare("INSERT INTO kitchen_always_have (user_id, food_key) VALUES ('usr_rahul', 'salt')").run();
      expect(() => db.prepare("INSERT INTO kitchen_always_have (user_id, food_key) VALUES ('usr_rahul', 'salt')").run()).toThrow(/UNIQUE|PRIMARY KEY/);
      expect(() => db.prepare("INSERT INTO kitchen_always_have (user_id, food_key) VALUES ('usr_rahul', 'saffron_x')").run()).toThrow(/FOREIGN KEY/);
      db.prepare("INSERT INTO kitchen_always_have_lists (user_id) VALUES ('usr_rahul')").run();
      expect(one<{ updated_at: string }>("SELECT updated_at FROM kitchen_always_have_lists").updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("keeps a recipe's visibility, link code and system owner honest", () => {
      const insert = (values: { visibility?: string; code?: string | null; system?: number; owner?: string; serves?: number; minutes?: number | null }) => () =>
        db.prepare(
          `INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, minutes, visibility, link_code, is_system)
           VALUES (?, ?, 'Dal tadka', ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(), values.owner ?? "usr_anu", values.serves ?? 4, values.minutes ?? null, values.visibility ?? "groups",
          values.code ?? null, values.system ?? 0,
        );
      expect(insert({})).not.toThrow();
      expect(insert({ visibility: "only_me" })).not.toThrow();
      expect(insert({ visibility: "link", code: "AbCdEfGhJk" })).not.toThrow();
      expect(insert({ visibility: "link", code: "AbCdEfGhJk" })).toThrow(/UNIQUE constraint failed/);
      expect(insert({ system: 1, owner: "usr_cookpool" })).not.toThrow();
      for (const bad of [
        { visibility: "public" },
        { visibility: "link" }, // no code
        { visibility: "groups", code: "ZbCdEfGhJk" }, // a code on a recipe that is not a link one
        { visibility: "link", code: "short" },
        { system: 1, owner: "usr_anu" },
        { serves: 0 },
        { serves: 201 },
        { minutes: 0 },
      ]) {
        expect(insert(bad)).toThrow(/CHECK constraint failed/);
      }
    });

    it("keeps a line to an amount in a unit or to taste, with one main line that has an amount", () => {
      const recipe = randomUUID();
      db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility) VALUES (?, 'usr_anu', 'Chicken curry', 8, 'groups')").run(recipe);
      const line = (position: number, values: { qty?: number | null; unit?: string | null; taste?: number; main?: number; food?: string | null }) => () =>
        db.prepare(
          `INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main)
           VALUES (?, ?, ?, 'Line', ?, ?, ?, ?)`,
        ).run(recipe, position, values.food === undefined ? "chicken" : values.food, values.qty === undefined ? 1_000_000 : values.qty,
          values.unit === undefined ? "kg" : values.unit, values.taste ?? 0, values.main ?? 0);
      expect(line(0, { main: 1 })).not.toThrow();
      expect(line(1, { main: 1, food: "onion", qty: 2_000, unit: "onion" })).toThrow(/UNIQUE constraint failed/);
      expect(line(1, { food: "salt", qty: null, unit: null, taste: 1 })).not.toThrow();
      expect(line(2, { food: null, qty: 5_000, unit: "tsp" })).not.toThrow(); // free text
      expect(line(0, {})).toThrow(/UNIQUE|PRIMARY KEY/);
      for (const [position, bad] of [
        [3, { taste: 1 }], // to taste with an amount
        [3, { qty: null }], // an amount-less line that is not to taste
        [3, { unit: null }],
        [3, { qty: 0 }],
        [3, { qty: null, unit: null, taste: 1, main: 1 }], // the main line to taste
        [40, {}],
        [-1, {}],
      ] as const) {
        expect(line(position, bad)).toThrow(/CHECK constraint failed/);
      }
      expect(line(3, { food: "no_such_food" })).toThrow(/FOREIGN KEY/);

      const step = (position: number, text: string) => () =>
        db.prepare("INSERT INTO kitchen_recipe_steps (recipe_id, position, text) VALUES (?, ?, ?)").run(recipe, position, text);
      expect(step(0, "Brown the onions")).not.toThrow();
      expect(step(19, "x".repeat(200))).not.toThrow();
      for (const bad of [step(20, "Serve"), step(1, ""), step(1, "x".repeat(201))]) expect(bad).toThrow(/CHECK constraint failed/);
    });

    it("leaves dishes and ingredients cooked before with no recipe, and refuses a factor or line out of range", () => {
      const cols = (table: string) => all<{ name: string; notnull: number; dflt_value: unknown }>(`PRAGMA table_info(${table})`);
      expect(cols("kitchen_dishes").filter((c) => c.name.startsWith("recipe_"))).toEqual([
        expect.objectContaining({ name: "recipe_id", notnull: 0, dflt_value: null }),
        expect.objectContaining({ name: "recipe_factor_milli", notnull: 0, dflt_value: null }),
      ]);
      expect(cols("kitchen_dish_ingredients").filter((c) => c.name === "recipe_line")).toEqual([
        expect.objectContaining({ notnull: 0, dflt_value: null }),
      ]);
      const plan = all<{ detail: string }>(
        "EXPLAIN QUERY PLAN SELECT MAX(cooked_at) FROM kitchen_dishes WHERE cook = 'usr_rahul' AND recipe_id = 'r' AND state <> 'canceled'",
      ).map((p) => p.detail);
      expect(plan.join("\n")).toMatch(/kitchen_dishes_cook_recipe_idx/);
    });
  });
});
