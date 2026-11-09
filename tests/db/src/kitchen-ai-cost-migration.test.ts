import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import { createAiUsageRepository, type AiUsageRepository, type NewKitchenAiUsage } from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// Cookpool AI cost guardrails (cookpool-ai AI-13): 480_kitchen_ai_cost —
// kitchen_ai_usage.cost_micros (each action's estimated cost) and the index
// the month's total walks. Checked as text (additive, kitchen_ai_usage only),
// against a real SQLite engine with every manifest migration applied, and
// through the usage repository.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "480_kitchen_ai_cost";

const raw = () => readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`), "utf8");
const sqlOf = () => raw().replace(/--.*$/gm, "");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

function d1Over(db: DatabaseSync): D1Binding {
  return {
    prepare(query: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        all<T>() {
          return Promise.resolve({ results: db.prepare(query).all(...(bound as never[])) as T[], success: true });
        },
      };
      return statement;
    },
  } as unknown as D1Binding;
}

const NOW = new Date("2026-11-09T12:00:00.000Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("480_kitchen_ai_cost (AI-13)", () => {
  it("is registered under kitchen, right after 470, with the up.sql's checksum", () => {
    const ids = manifest.migrations.map((m) => m.id);
    const entry = manifest.migrations.find((m) => m.id === ID);
    expect(entry).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    expect(entry!.checksum).toBe(createHash("sha256").update(readFileSync(resolve(MIGRATIONS_ROOT, `${ID}/up.sql`))).digest("hex"));
    expect(ids.indexOf(ID)).toBe(ids.indexOf("470_kitchen_ai") + 1);
  });

  it("adds one column with a default and one index, and changes nothing else", () => {
    const sql = sqlOf();
    expect(sql.match(/ALTER TABLE \w+ ADD COLUMN \w+/g)).toEqual(["ALTER TABLE kitchen_ai_usage ADD COLUMN cost_micros"]);
    expect(sql).toMatch(/cost_micros INTEGER NOT NULL DEFAULT 0 CHECK \(cost_micros >= 0\);/);
    expect(sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/g)).toEqual(["CREATE INDEX IF NOT EXISTS kitchen_ai_usage_created_idx"]);
    expect(sql).toMatch(/ON kitchen_ai_usage \(created_at, cost_micros\);/);
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|INSERT|CREATE TABLE|REFERENCES)\b/i);
    expect(raw()).toMatch(/^-- column kitchen_ai_usage\.cost_micros: /m);
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    const insert = (cost?: number) =>
      db
        .prepare(
          `INSERT INTO kitchen_ai_usage (id, user_id, feature, model, ok, created_at${cost === undefined ? "" : ", cost_micros"})
           VALUES ('u1', 'usr_dev', 'uses', 'claude-haiku-5-5', 1, '${NOW.toISOString()}'${cost === undefined ? "" : `, ${cost}`})`,
        )
        .run();

    it("a row written without a cost costs 0 (as every row before 480)", () => {
      insert();
      expect(db.prepare("SELECT cost_micros FROM kitchen_ai_usage").get()).toEqual({ cost_micros: 0 });
    });

    it("refuses a negative cost", () => {
      expect(() => insert(-1)).toThrow(/CHECK constraint failed/);
    });

    it("sums the month from the (created_at, cost_micros) index alone", () => {
      const plan = db
        .prepare("EXPLAIN QUERY PLAN SELECT COALESCE(SUM(cost_micros), 0) FROM kitchen_ai_usage WHERE created_at >= ? AND created_at < ?")
        .all("2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z") as Array<{ detail: string }>;
      expect(plan.map((p) => p.detail).join(" ")).toMatch(/COVERING INDEX kitchen_ai_usage_created_idx/);
    });
  });

  describe("through the usage repository", () => {
    let db: DatabaseSync;
    let repo: AiUsageRepository;
    beforeEach(() => {
      db = migrated();
      repo = createAiUsageRepository(createSqlExecutor(d1Over(db)));
    });
    afterEach(() => db.close());

    const usage = (n: number, overrides: Partial<NewKitchenAiUsage> = {}): NewKitchenAiUsage => ({
      id: uuid(n),
      userId: "usr_dev",
      feature: "receipt",
      model: "claude-haiku-5-5",
      inputTokens: 1800,
      cachedTokens: 1200,
      outputTokens: 400,
      audioSeconds: 0,
      costMicros: 397,
      ok: true,
      now: NOW,
      ...overrides,
    });

    it("records the cost, rounded and never below 0", async () => {
      const made = await repo.recordAiUsage(usage(1));
      expect(made.ok && made.value.costMicros).toBe(397);
      const rounded = await repo.recordAiUsage(usage(2, { costMicros: 103.5 }));
      expect(rounded.ok && rounded.value.costMicros).toBe(104);
      const negative = await repo.recordAiUsage(usage(3, { costMicros: -7 }));
      expect(negative.ok && negative.value.costMicros).toBe(0);
    });

    it("sums everyone's cost in [from, to) only", async () => {
      const from = new Date("2026-11-01T00:00:00.000Z");
      const to = new Date("2026-12-01T00:00:00.000Z");
      await repo.recordAiUsage(usage(1, { costMicros: 1_000 }));
      await repo.recordAiUsage(usage(2, { costMicros: 2_500, userId: "usr_anu" }));
      await repo.recordAiUsage(usage(3, { costMicros: 4_000, now: from }));
      await repo.recordAiUsage(usage(4, { costMicros: 9_999, now: new Date("2026-10-31T23:59:59.999Z") }));
      await repo.recordAiUsage(usage(5, { costMicros: 9_999, now: to }));
      expect(await repo.aiCostBetween(from, to)).toEqual({ ok: true, value: 7_500 });
      expect(await repo.aiCostBetween(new Date("2027-01-01T00:00:00.000Z"), new Date("2027-02-01T00:00:00.000Z"))).toEqual({
        ok: true,
        value: 0,
      });
    });

    it("counts a person's receipts among their actions", async () => {
      await repo.recordAiUsage(usage(1));
      await repo.recordAiUsage(usage(2, { feature: "uses" }));
      await repo.recordAiUsage(usage(3, { userId: "usr_anu" }));
      const day = await repo.aiUsageBetween("usr_dev", new Date("2026-11-09T00:00:00.000Z"), new Date("2026-11-10T00:00:00.000Z"));
      expect(day).toEqual({ ok: true, value: { actions: 2, receipts: 1, voiceSeconds: 0 } });
    });

    it("a failed read is an error, never a zero", async () => {
      db.exec("DROP INDEX kitchen_ai_usage_created_idx");
      db.exec("ALTER TABLE kitchen_ai_usage DROP COLUMN cost_micros");
      const read = await repo.aiCostBetween(new Date("2026-11-01T00:00:00.000Z"), new Date("2026-12-01T00:00:00.000Z"));
      expect(read.ok).toBe(false);
    });
  });
});
