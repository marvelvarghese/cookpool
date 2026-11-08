import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest } from "@saas/db";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import {
  KITCHEN_AI_USAGE_FEATURES,
  createAiUsageRepository,
  type AiUsageRepository,
  type NewKitchenAiUsage,
} from "@saas/db/kitchen";
import { D1ApiAdapter } from "@saas/db/runner";

// Cookpool AI (cookpool-ai AI-2, design §1): 470_kitchen_ai — one row per AI
// action a person takes, for the daily limits. Checked as text (additive,
// kitchen_* only, one table — the URL cache the design first named was
// dropped with links and pasted text), against a real SQLite engine (every
// manifest migration applied: the rules the table keeps and the index the
// day's count walks), and through the usage repository over that engine.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");
const ID = "470_kitchen_ai";

const sqlOf = (id: string) => readFileSync(resolve(MIGRATIONS_ROOT, `${id}/up.sql`), "utf8").replace(/--.*$/gm, "");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

/** A D1 binding over `db`: the subset the SQL executor uses. */
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

describe("470_kitchen_ai (AI-2)", () => {
  it("is registered under kitchen, after every earlier migration", () => {
    const ids = manifest.migrations.map((m) => m.id);
    expect(manifest.migrations.find((m) => m.id === ID)).toMatchObject({ context: "kitchen", path: `${ID}/up.sql` });
    // 450 and 460 belong to other tasks, whichever lands first.
    const before = ids.filter((id) => Number(id.slice(0, 3)) < 470);
    expect(ids.slice(0, before.length)).toEqual(before);
    expect(ids[before.length]).toBe(ID);
  });

  it("creates one table and one index, IF NOT EXISTS, and changes nothing else", () => {
    const sql = sqlOf(ID);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)).toEqual(["CREATE TABLE IF NOT EXISTS kitchen_ai_usage"]);
    expect(sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/g)).toEqual(["CREATE INDEX IF NOT EXISTS kitchen_ai_usage_user_idx"]);
    expect(sql).toMatch(/ON kitchen_ai_usage \(user_id, created_at\);/);
    expect(sql).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE|INSERT|REFERENCES)\b/i);
    expect(sql).not.toMatch(/kitchen_ai_imports/);
    expect(new Set(sql.match(/\bON \w+/g))).toEqual(new Set(["ON kitchen_ai_usage"]));
  });

  describe("against a real SQLite engine", () => {
    let db: DatabaseSync;
    beforeEach(() => {
      db = migrated();
    });
    afterEach(() => db.close());

    const insert = (row: Partial<Record<string, string | number>> = {}) => {
      const r = {
        id: "u1",
        user_id: "usr_dev",
        feature: "uses",
        model: "claude-haiku-5-5",
        input_tokens: 900,
        cached_tokens: 0,
        output_tokens: 120,
        audio_seconds: 0,
        ok: 1,
        created_at: NOW.toISOString(),
        ...row,
      };
      db.prepare(
        `INSERT INTO kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, ok, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(r.id, r.user_id, r.feature, r.model, r.input_tokens, r.cached_tokens, r.output_tokens, r.audio_seconds, r.ok, r.created_at);
    };

    it("keeps a row with every column the design names, and nothing more", () => {
      insert();
      const cols = (db.prepare("PRAGMA table_info(kitchen_ai_usage)").all() as Array<{ name: string; notnull: number }>).map(
        (c) => `${c.name}${c.notnull ? "!" : ""}`,
      );
      expect(cols).toEqual([
        "id",
        "user_id!",
        "feature!",
        "model!",
        "input_tokens!",
        "cached_tokens!",
        "output_tokens!",
        "audio_seconds!",
        "ok!",
        "created_at!",
      ]);
    });

    it("has no URL cache table", () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'kitchen_ai%'").all();
      expect(tables).toEqual([{ name: "kitchen_ai_usage" }]);
    });

    it("accepts every feature of the epic", () => {
      KITCHEN_AI_USAGE_FEATURES.forEach((feature, i) => insert({ id: `u${i}`, feature }));
      expect(db.prepare("SELECT COUNT(*) AS n FROM kitchen_ai_usage").get()).toEqual({ n: KITCHEN_AI_USAGE_FEATURES.length });
    });

    it.each([
      ["an unknown feature", { feature: "chat" }],
      ["an empty user", { user_id: "" }],
      ["an empty model", { model: "" }],
      ["negative input tokens", { input_tokens: -1 }],
      ["negative cached tokens", { cached_tokens: -1 }],
      ["negative output tokens", { output_tokens: -1 }],
      ["negative audio seconds", { audio_seconds: -1 }],
      ["ok other than 0 or 1", { ok: 2 }],
    ])("refuses %s", (_label, row) => {
      expect(() => insert(row)).toThrow(/CHECK constraint failed/);
    });

    it("counts a person's day through the (user_id, created_at) index", () => {
      const plan = db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT COUNT(*) FROM kitchen_ai_usage WHERE user_id = ? AND created_at >= ? AND created_at < ?",
        )
        .all("usr_dev", "2026-11-09T00:00:00.000Z", "2026-11-10T00:00:00.000Z") as Array<{ detail: string }>;
      expect(plan.map((p) => p.detail).join(" ")).toMatch(/kitchen_ai_usage_user_idx/);
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
      feature: "uses",
      model: "claude-haiku-5-5",
      inputTokens: 900,
      cachedTokens: 2048,
      outputTokens: 120,
      audioSeconds: 0,
      ok: true,
      now: NOW,
      ...overrides,
    });

    it("records an action and reads it back", async () => {
      const made = await repo.recordAiUsage(usage(1, { model: "claude-sonnet-5-5", ok: false }));
      expect(made).toEqual({
        ok: true,
        value: {
          id: uuid(1),
          userId: "usr_dev",
          feature: "uses",
          model: "claude-sonnet-5-5",
          inputTokens: 900,
          cachedTokens: 2048,
          outputTokens: 120,
          audioSeconds: 0,
          ok: false,
          createdAt: NOW,
        },
      });
    });

    it("rounds counts and keeps them at zero or more", async () => {
      const made = await repo.recordAiUsage(usage(1, { inputTokens: -5, outputTokens: 10.6, audioSeconds: Number.NaN }));
      expect(made.ok && [made.value.inputTokens, made.value.outputTokens, made.value.audioSeconds]).toEqual([0, 11, 0]);
    });

    it("counts one person's actions and voice seconds in a UTC day only", async () => {
      const from = new Date("2026-11-09T00:00:00.000Z");
      const to = new Date("2026-11-10T00:00:00.000Z");
      await repo.recordAiUsage(usage(1));
      await repo.recordAiUsage(usage(2, { feature: "receipt", ok: false }));
      await repo.recordAiUsage(usage(3, { feature: "ask_step" }));
      await repo.recordAiUsage(usage(4, { feature: "transcribe", model: "@cf/openai/whisper-large-v3-turbo", audioSeconds: 12 }));
      await repo.recordAiUsage(usage(5, { feature: "transcribe", model: "@cf/openai/whisper-large-v3-turbo", audioSeconds: 9 }));
      // Someone else, and the days either side.
      await repo.recordAiUsage(usage(6, { userId: "usr_anu" }));
      await repo.recordAiUsage(usage(7, { now: new Date("2026-11-08T23:59:59.999Z") }));
      await repo.recordAiUsage(usage(8, { now: to }));
      expect(await repo.aiUsageBetween("usr_dev", from, to)).toEqual({ ok: true, value: { actions: 3, voiceSeconds: 21 } });
      expect(await repo.aiUsageBetween("usr_nobody", from, to)).toEqual({ ok: true, value: { actions: 0, voiceSeconds: 0 } });
    });
  });
});
