import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// Cookpool's recipes with guided steps (Cookpool GC-4, cookpool-guided design
// §1, §6): 390_kitchen_cookpool_guided gives each of 360's 42 recipes its tools
// and replaces its steps with guided ones under fixed keys. Checked as text
// (three statements a recipe, only Cookpool's rows, plain INSERT) and against
// a real SQLite engine: every row lands under the table's CHECKs, a re-run
// changes nothing, each recipe reads as guided (keys, phases, flames, lines,
// tools, long prep), and nothing else — lines, a person's recipes, copies —
// changes. The steps' content through the recipe read is kitchen-worker's
// cookpool-guided suite.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "390_kitchen_cookpool_guided";

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

/** 360's fixed id of Cookpool recipe `n` (1–42). */
const recipeId = (n: number) => `c00c0360-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RECIPE_IDS = Array.from({ length: 42 }, (_, i) => recipeId(i + 1));

interface StepRow {
  recipe_id: string;
  position: number;
  text: string;
  step_key: string | null;
  phase: string;
  line_refs: string;
  heat: number | null;
  min_seconds: number | null;
  max_seconds: number | null;
  whistles: number | null;
  hands_off: number;
  time_rule: string;
  sense: string | null;
  checkpoint: string | null;
  tip: string | null;
}

describe("390_kitchen_cookpool_guided (GC-4)", () => {
  it("is registered under kitchen right after 380, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    expect(ids.indexOf(ID)).toBe(ids.indexOf("380_kitchen_timers") + 1);
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 390);
    expect(ids.slice(0, before.length)).toEqual(before);
  });

  it("is three statements a recipe — its tools, then DELETE and one plain INSERT of its steps — naming only Cookpool's 42", () => {
    const sql = sqlOf(ID);
    expect(sql).not.toMatch(/\b(ALTER|DROP|CREATE|REPLACE|IGNORE)\b/i);
    expect(sql.match(/\bUPDATE\b/gi)).toHaveLength(42);
    expect(sql.match(/\bDELETE\b/gi)).toHaveLength(42);
    expect(sql.match(/\bINSERT\b/gi)).toHaveLength(42);

    const statements = statementsOf(ID);
    expect(statements).toHaveLength(42 * 3);
    RECIPE_IDS.forEach((id, i) => {
      const [tools, del, insert] = statements.slice(i * 3, i * 3 + 3) as [string, string, string];
      expect(tools).toMatch(new RegExp(`^UPDATE kitchen_recipes SET tools = '\\[[^']+\\]' WHERE id = '${id}'$`));
      expect(del).toBe(`DELETE FROM kitchen_recipe_steps WHERE recipe_id = '${id}'`);
      expect(insert).toMatch(
        /^INSERT INTO kitchen_recipe_steps \(recipe_id, position, step_key, phase, text, line_refs, heat, min_seconds, max_seconds, whistles, hands_off, time_rule, sense, checkpoint, tip\) VALUES\n/,
      );
      // Every row of the insert is this recipe's.
      const rows = insert.split("\n").slice(1);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const row of rows) expect(row.startsWith(`  ('${id}', `)).toBe(true);
    });
    // Each statement stays well under D1's 100 KB statement limit.
    for (const statement of statements) expect(Buffer.byteLength(statement)).toBeLessThan(20_000);
  });

  it("lands every step under the table's CHECKs, on top of 380 — and running it again leaves the same rows", () => {
    // The seed is plain INSERT already: a step failing a CHECK throws here rather than going missing.
    const db = migrated(380);
    const statements = statementsOf(ID);
    for (const statement of statements) db.exec(statement);
    const rowsOf = () => db.prepare("SELECT * FROM kitchen_recipe_steps ORDER BY recipe_id, position").all();
    const tools = () => db.prepare("SELECT id, tools FROM kitchen_recipes ORDER BY id").all();
    const written = statements.filter((s) => s.startsWith("INSERT")).reduce((n, s) => n + s.split("\n").length - 1, 0);
    expect(rowsOf()).toHaveLength(written);
    expect(written).toBeGreaterThanOrEqual(42 * 4);
    const first = [rowsOf(), tools()];
    for (const statement of statements) db.exec(statement);
    expect([rowsOf(), tools()]).toEqual(first);
    db.close();
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeAll(() => {
      db = migrated();
    });
    afterAll(() => db.close());

    const all = <T>(query: string, ...params: unknown[]) => db.prepare(query).all(...(params as never[])) as T[];
    const stepsOf = (id: string) => all<StepRow>("SELECT * FROM kitchen_recipe_steps WHERE recipe_id = ? ORDER BY position", id);

    it("gives every Cookpool recipe guided steps under fixed keys, prep before cook, a flame on every cook step", () => {
      const system = all<{ id: string }>("SELECT id FROM kitchen_recipes WHERE is_system = 1 ORDER BY id").map((r) => r.id);
      expect(system).toEqual(RECIPE_IDS);
      const keys: string[] = [];
      RECIPE_IDS.forEach((id, i) => {
        const steps = stepsOf(id);
        expect(steps.length).toBeGreaterThanOrEqual(3);
        expect(steps.length).toBeLessThanOrEqual(20);
        steps.forEach((s, position) => {
          // c00c0390-<recipe>-<step>, the step counted from 1.
          expect([id, s.position, s.step_key]).toEqual([
            id, position, `c00c0390-${String(i + 1).padStart(2, "0")}-${String(position + 1).padStart(2, "0")}`,
          ]);
          keys.push(s.step_key!);
          if (s.phase === "cook") expect([id, position, s.heat]).toEqual([id, position, expect.any(Number)]);
        });
        // Prep first (Before you start), then at least one cook step.
        const phases = steps.map((s) => s.phase).join(" ");
        expect(phases).toMatch(/^(prep )*cook( cook)*$/);
      });
      // No key is shared, even across recipes.
      expect(new Set(keys).size).toBe(keys.length);
      // Every step written before 390 is gone: none keeps 370's random key.
      expect(all<{ n: number }>("SELECT COUNT(*) AS n FROM kitchen_recipe_steps WHERE step_key GLOB '[0-9a-f]*' AND length(step_key) = 32")[0]!.n).toBe(0);
    });

    it("gives every Cookpool recipe its tools: one to ten short names, each once", () => {
      for (const { id, tools } of all<{ id: string; tools: string }>("SELECT id, tools FROM kitchen_recipes WHERE is_system = 1")) {
        const names = JSON.parse(tools) as unknown[];
        expect([id, names.length >= 1 && names.length <= 10]).toEqual([id, true]);
        for (const name of names) {
          expect(typeof name).toBe("string");
          expect((name as string).length).toBeGreaterThanOrEqual(1);
          expect((name as string).length).toBeLessThanOrEqual(40);
          expect((name as string).trim()).toBe(name);
        }
        expect(new Set(names.map((n) => (n as string).toLowerCase())).size).toBe(names.length);
      }
      expect(JSON.parse(all<{ tools: string }>("SELECT tools FROM kitchen_recipes WHERE id = ?", recipeId(12))[0]!.tools)).toContain("Pressure cooker");
    });

    it("keeps every rule between a step's columns, and every line it names is one of its recipe's", () => {
      const violations = (where: string) =>
        all<{ n: number }>(`SELECT COUNT(*) AS n FROM kitchen_recipe_steps WHERE recipe_id IN (SELECT id FROM kitchen_recipes WHERE is_system = 1) AND (${where})`)[0]!.n;
      expect(violations("(min_seconds IS NULL) <> (max_seconds IS NULL)")).toBe(0); // both seconds or neither
      expect(violations("min_seconds > max_seconds")).toBe(0);
      expect(violations("whistles IS NOT NULL AND min_seconds IS NOT NULL")).toBe(0); // whistles never with seconds
      expect(violations("sense IS NOT NULL AND checkpoint IS NULL")).toBe(0); // a sense needs a checkpoint
      expect(violations("hands_off = 1 AND min_seconds IS NULL AND whistles IS NULL")).toBe(0); // a wait is timed
      expect(violations("whistles IS NOT NULL AND time_rule <> 'fixed'")).toBe(0); // whistles never scale
      // Every line ref is a position the recipe's lines have, each once in a step.
      const refs = all<{ recipe_id: string; position: number; ref: number; lines: number }>(
        `SELECT s.recipe_id, s.position, j.value AS ref,
                (SELECT COUNT(*) FROM kitchen_recipe_lines l WHERE l.recipe_id = s.recipe_id) AS lines
           FROM kitchen_recipe_steps s, json_each(s.line_refs) j
          WHERE s.recipe_id IN (SELECT id FROM kitchen_recipes WHERE is_system = 1)`,
      );
      expect(refs.length).toBeGreaterThan(477);
      for (const r of refs) expect([r.recipe_id, r.position, Number.isInteger(r.ref) && r.ref >= 0 && r.ref < r.lines]).toEqual([r.recipe_id, r.position, true]);
      expect(new Set(refs.map((r) => `${r.recipe_id} ${r.position} ${r.ref}`)).size).toBe(refs.length);
      // And every line goes in at some step.
      expect(
        all<{ n: number }>(
          `SELECT COUNT(*) AS n FROM kitchen_recipe_lines l
            WHERE l.recipe_id IN (SELECT id FROM kitchen_recipes WHERE is_system = 1)
              AND NOT EXISTS (SELECT 1 FROM kitchen_recipe_steps s, json_each(s.line_refs) j
                               WHERE s.recipe_id = l.recipe_id AND j.value = l.position)`,
        )[0]!.n,
      ).toBe(0);
    });

    it("gives rajma and chole their overnight soak as long prep — a hands-off prep step of six hours or more", () => {
      const longPrep = all<{ name: string; position: number; min_seconds: number; max_seconds: number }>(
        `SELECT r.name, s.position, s.min_seconds, s.max_seconds FROM kitchen_recipe_steps s JOIN kitchen_recipes r ON r.id = s.recipe_id
          WHERE r.is_system = 1 AND s.phase = 'prep' AND s.hands_off = 1 AND s.min_seconds >= 3600 ORDER BY r.created_at DESC`,
      );
      for (const dish of ["Rajma", "Chole"]) {
        const soak = longPrep.filter((p) => p.name === dish);
        expect(soak).toHaveLength(1);
        expect(soak[0]).toMatchObject({ position: 0 });
        expect(soak[0]!.min_seconds).toBeGreaterThanOrEqual(6 * 3600);
        expect(soak[0]!.max_seconds).toBeLessThanOrEqual(12 * 3600);
      }
      // Sabudana soaks for hours too, and fried rice wants its rice cooked and cooled ahead; nothing else waits an hour.
      expect(longPrep.map((p) => p.name)).toEqual(["Sabudana khichdi", "Rajma", "Chole", "Veg fried rice"]);
    });

    it("counts whistles on the pressure-cooker recipes, then lets the pressure drop off the heat", () => {
      const whistling = all<{ name: string; recipe_id: string; position: number; whistles: number }>(
        `SELECT r.name, s.recipe_id, s.position, s.whistles FROM kitchen_recipe_steps s JOIN kitchen_recipes r ON r.id = s.recipe_id
          WHERE r.is_system = 1 AND s.whistles IS NOT NULL ORDER BY r.created_at DESC`,
      );
      expect(whistling.map((w) => w.name)).toEqual(
        expect.arrayContaining(["Dal tadka", "Dal fry", "Rajma", "Chole", "Sambar", "Moong dal khichdi"]),
      );
      for (const w of whistling) {
        const after = stepsOf(w.recipe_id).slice(w.position + 1);
        // Hands-off steps follow (a timed low flame where the recipe needs one) until one off the heat: the drop.
        const drop = after.findIndex((s) => s.heat === 0);
        expect([w.name, drop >= 0]).toEqual([w.name, true]);
        for (const s of after.slice(0, drop + 1)) expect([w.name, s.position, s.hands_off, s.min_seconds !== null]).toEqual([w.name, s.position, 1, true]);
      }
      // Rajma: whistles, then the low flame, then the drop.
      const rajma = stepsOf(recipeId(12));
      const at = rajma.findIndex((s) => s.whistles !== null);
      expect(rajma.slice(at, at + 3).map((s) => [s.whistles, s.heat, s.hands_off, s.min_seconds === null])).toEqual([
        [3, 3, 1, true],
        [null, 1, 1, false],
        [null, 0, 1, false],
      ]);
    });

    it("changes nothing else: Cookpool's lines and recipe rows but for tools, a person's recipe, and a copy saved before 390", () => {
      const before = migrated(380);
      // A person's own recipe, and a copy of Cookpool's rajma saved before 390 (its steps and keys copied, as GC-2 copies).
      const own = randomUUID();
      const copy = randomUUID();
      before.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility) VALUES (?, 'usr_anu', 'Dal', 4, 'only_me')").run(own);
      before.prepare(
        "INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility, source_recipe_id, source_owner_id, source_owner_name) VALUES (?, 'usr_anu', 'Rajma', 8, 'only_me', ?, 'usr_cookpool', 'Cookpool')",
      ).run(copy, recipeId(12));
      before.prepare("INSERT INTO kitchen_recipe_steps (recipe_id, position, text, step_key, phase, heat) VALUES (?, 0, 'Boil it', 'mine1', 'cook', 2)").run(own);
      before.exec(`INSERT INTO kitchen_recipe_steps (recipe_id, position, text, step_key)
                   SELECT '${copy}', position, text, step_key FROM kitchen_recipe_steps WHERE recipe_id = '${recipeId(12)}'`);
      const read = (d: DatabaseSync) => ({
        lines: d.prepare("SELECT * FROM kitchen_recipe_lines ORDER BY recipe_id, position").all(),
        recipes: d.prepare("SELECT * FROM kitchen_recipes ORDER BY id").all().map((r) => ({ ...r, tools: undefined })),
        others: d.prepare("SELECT * FROM kitchen_recipe_steps WHERE recipe_id IN (?, ?) ORDER BY recipe_id, position").all(own, copy),
        otherTools: d.prepare("SELECT tools FROM kitchen_recipes WHERE id IN (?, ?)").all(own, copy),
      });
      const was = read(before);
      expect(was.others.length).toBeGreaterThan(3);
      for (const statement of statementsOf(ID)) before.exec(statement);
      expect(read(before)).toEqual(was);
      before.close();
    });
  });
});
