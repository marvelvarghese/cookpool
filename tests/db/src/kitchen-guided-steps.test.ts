import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import {
  MAX_RECIPE_ROOT_HOPS,
  createKitchenRepository,
  type CookDishInput,
  type CookDishStepTimes,
  type KitchenRepository,
  type NewKitchenItem,
  type NewKitchenRecipe,
  type NewKitchenRecipeStep,
} from "@saas/db/kitchen";
import { asUuid, manifest, type Uuid } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// Guided steps' storage (Cookpool GC-2, migration 370) against a REAL SQLite
// engine with every migration applied: a recipe's steps written and read with
// their keys and guided fields, and its tools; an edit and a copy keeping
// keys; "Use today's times" by key, only by the owner; a recipe's root through
// its copies; and a dish's step times written in the dish's own batch.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const m of manifest.migrations) {
    for (const statement of D1ApiAdapter.splitStatements(readFileSync(join(MIGRATIONS_ROOT, m.path), "utf8"))) db.exec(statement);
  }
  return db;
}

/** A D1 binding over `db` that records every statement it is sent; a batch is one transaction, as D1's is. */
function d1Over(db: DatabaseSync, sent: string[]): D1Binding {
  return {
    prepare(query: string) {
      sent.push(query);
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
    async batch(statements: Array<{ all(): Promise<unknown> }>) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        db.exec("COMMIT");
        return results;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Binding;
}

const ANU = "usr_anu";
const RAHUL = "usr_rahul";
const now = new Date("2026-11-08T08:00:00.000Z");
const later = new Date("2026-11-08T09:00:00.000Z");

let db: DatabaseSync;
let sent: string[];
let repo: KitchenRepository;

beforeEach(() => {
  db = migrated();
  sent = [];
  repo = createKitchenRepository(createSqlExecutor(d1Over(db, sent)));
});

afterEach(() => db.close());

const SOAK: NewKitchenRecipeStep = {
  key: "rajma-soak",
  text: "Soak the rajma",
  phase: "prep",
  minSeconds: 28_800,
  maxSeconds: 36_000,
  handsOff: true,
  tip: "Overnight is fine",
};
const FRY: NewKitchenRecipeStep = {
  text: "Fry the onions",
  lineRefs: [1, 0],
  heat: 2,
  minSeconds: 480,
  maxSeconds: 600,
  timeRule: "partly",
  checkpoint: "golden brown",
  sense: "look",
};
const COOK: NewKitchenRecipeStep = { text: "Pressure-cook", lineRefs: [0], heat: 3, whistles: 3, handsOff: true };

function recipe(overrides: Partial<NewKitchenRecipe> = {}): NewKitchenRecipe {
  return {
    id: asUuid(randomUUID()),
    ownerId: ANU,
    name: "Rajma",
    servesHalf: 8,
    minutes: 60,
    kind: "dal_curry",
    visibility: "groups",
    linkCode: null,
    source: null,
    lines: [
      { foodKey: "rajma", name: "Rajma", qtyMilli: 250_000, unit: "g", toTaste: false, isMain: true },
      { foodKey: "onion", name: "Onions", qtyMilli: 2_000, unit: "onion", toTaste: false, isMain: false },
    ],
    steps: [SOAK, FRY, COOK, "Serve with rice"],
    tools: ["Pressure cooker", "Kadai"],
    now,
    ...overrides,
  };
}

async function create(overrides: Partial<NewKitchenRecipe> = {}) {
  const created = await repo.createRecipe(recipe(overrides));
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  return created.value;
}

describe("guided steps, against a real SQLite engine (370_kitchen_guided_steps)", () => {
  it("writes and reads every guided field and the tools, still in three statements; a step with no key gets one", async () => {
    const before = sent.length;
    const r = await create();
    expect(sent.length - before).toBe(6);
    expect(r.tools).toEqual(["Pressure cooker", "Kadai"]);
    expect(r.steps).toEqual(["Soak the rajma", "Fry the onions", "Pressure-cook", "Serve with rice"]);
    const [soak, fry, cook, serve] = r.guidedSteps;
    expect(soak).toEqual({
      position: 0, key: "rajma-soak", text: "Soak the rajma", phase: "prep", lineRefs: [], heat: null, minSeconds: 28_800,
      maxSeconds: 36_000, whistles: null, handsOff: true, timeRule: "fixed", sense: null, checkpoint: null, tip: "Overnight is fine",
    });
    expect(fry).toMatchObject({
      position: 1, phase: "cook", lineRefs: [1, 0], heat: 2, minSeconds: 480, maxSeconds: 600, timeRule: "partly", sense: "look",
      checkpoint: "golden brown", handsOff: false,
    });
    expect(cook).toMatchObject({ position: 2, whistles: 3, minSeconds: null, maxSeconds: null, heat: 3, handsOff: true, lineRefs: [0] });
    expect(serve).toMatchObject({
      position: 3, text: "Serve with rice", phase: "cook", lineRefs: [], heat: null, whistles: null, handsOff: false, timeRule: "fixed",
    });
    for (const s of [fry!, cook!, serve!]) expect(s.key).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(r.guidedSteps.map((s) => s.key)).size).toBe(4);
    // Read back, and in a list.
    const read = await repo.getRecipe(asUuid(r.id), RAHUL);
    expect(read.ok && read.value.guidedSteps).toEqual(r.guidedSteps);
    const listed = await repo.listRecipes({ viewer: ANU, ownerId: ANU, q: null, kind: null, limit: 10 });
    expect(listed.ok && listed.value[0]!.tools).toEqual(["Pressure cooker", "Kadai"]);
  });

  it("reads a recipe written with no tools as none, and refuses a step the table would not keep, writing nothing", async () => {
    const untooled = recipe({ steps: ["Stir"] });
    delete untooled.tools;
    const plain = await repo.createRecipe(untooled);
    expect(plain.ok && plain.value.tools).toEqual([]);
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM kitchen_recipes WHERE is_system = 0").get() as { n: number }).n;
    const bad = await repo.createRecipe(recipe({ steps: [{ text: "Cook", whistles: 2, minSeconds: 60, maxSeconds: 60 }] }));
    expect(bad).toEqual({ ok: false, error: { kind: "invalid", reason: "recipe_out_of_range" } });
    const twice = await repo.createRecipe(recipe({ steps: [{ text: "A", key: "same" }, { text: "B", key: "same" }] }));
    expect(twice).toEqual({ ok: false, error: { kind: "invalid", reason: "duplicate_step_key" } });
    expect(count()).toBe(1);
  });

  it("an edit keeps the keys it is given and replaces the tools; one that sends no steps or tools leaves them be", async () => {
    const r = await create();
    const id = asUuid(r.id);
    const fry = r.guidedSteps[1]!;
    const edited = await repo.updateRecipe({
      recipeId: id,
      ownerId: ANU,
      changes: { tools: ["Heavy pan"] },
      steps: [{ ...fry, text: "Fry the onions well", minSeconds: 600, maxSeconds: 720 }, "Serve"],
      now: later,
    });
    expect(edited.ok && edited.value.tools).toEqual(["Heavy pan"]);
    expect(edited.ok && edited.value.guidedSteps.map((s) => [s.position, s.key === fry.key, s.text, s.minSeconds])).toEqual([
      [0, true, "Fry the onions well", 600],
      [1, false, "Serve", null],
    ]);
    const renamed = await repo.updateRecipe({ recipeId: id, ownerId: ANU, changes: { name: "Rajma chawal" }, now: later });
    expect(renamed.ok && [renamed.value.tools, renamed.value.guidedSteps.length]).toEqual([["Heavy pan"], 2]);
  });

  it("sets some steps' ranges by key for the owner only, leaving the others and whistle steps as they are", async () => {
    const r = await create();
    const id = asUuid(r.id);
    const [soak, fry, cook, serve] = r.guidedSteps;
    expect(await repo.setRecipeStepTimes({ recipeId: id, ownerId: RAHUL, steps: [{ key: fry!.key, minSeconds: 60, maxSeconds: 120 }], now })).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    const set = await repo.setRecipeStepTimes({
      recipeId: id,
      ownerId: ANU,
      steps: [
        { key: fry!.key, minSeconds: 420, maxSeconds: 540 },
        { key: serve!.key, minSeconds: 60, maxSeconds: 60 },
        { key: cook!.key, minSeconds: 900, maxSeconds: 900 }, // a whistle step: left alone
      ],
      now: later,
    });
    expect(set.ok && set.value.updatedAt).toEqual(later);
    const steps = set.ok ? set.value.guidedSteps : [];
    expect(steps.map((s) => [s.key, s.minSeconds, s.maxSeconds, s.whistles])).toEqual([
      [soak!.key, 28_800, 36_000, null],
      [fry!.key, 420, 540, null],
      [cook!.key, null, null, 3],
      [serve!.key, 60, 60, null],
    ]);
    // Everything else about the steps is as it was.
    expect(steps[1]).toEqual({ ...fry, minSeconds: 420, maxSeconds: 540 });
    expect(await repo.setRecipeStepTimes({ recipeId: asUuid(randomUUID()), ownerId: ANU, steps: [], now })).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});

describe("a recipe's root and a dish's step times (GC-2)", () => {
  it("walks a copy of a copy back to the recipe first written, through a deleted one, and stops after eight links", async () => {
    const original = await create();
    const copy = await create({ ownerId: RAHUL, visibility: "only_me", source: { recipeId: original.id, ownerId: ANU, ownerName: "Anu" } });
    const copyOfCopy = await create({ ownerId: "usr_dev", visibility: "only_me", source: { recipeId: copy.id, ownerId: RAHUL, ownerName: "Rahul" } });
    await repo.deleteRecipe(asUuid(copy.id), RAHUL, now);
    expect(await repo.recipeRootId(asUuid(copyOfCopy.id))).toEqual({ ok: true, value: original.id });
    expect(await repo.recipeRootId(asUuid(copy.id))).toEqual({ ok: true, value: original.id });
    expect(await repo.recipeRootId(asUuid(original.id))).toEqual({ ok: true, value: original.id });
    expect(await repo.recipeRootId(asUuid(randomUUID()))).toEqual({ ok: true, value: null });

    // A chain of ten copies: the root is found within eight links.
    const chain: Uuid[] = [asUuid(original.id)];
    for (let i = 0; i < 10; i += 1) {
      const next = await create({ ownerId: RAHUL, source: { recipeId: chain[chain.length - 1]!, ownerId: ANU, ownerName: null } });
      chain.push(asUuid(next.id));
    }
    expect(await repo.recipeRootId(chain[MAX_RECIPE_ROOT_HOPS]!)).toEqual({ ok: true, value: original.id });
    expect(await repo.recipeRootId(chain[10]!)).toEqual({ ok: true, value: chain[10 - MAX_RECIPE_ROOT_HOPS] });
  });

  function rahulsItem(): NewKitchenItem {
    return {
      id: asUuid(randomUUID()), owner: { kind: "user", subjectId: RAHUL }, name: "Rajma", category: "grains", dimension: "mass",
      displayUnit: "kg", qtyMilli: 1_000_000, priceMinor: 20000, currency: "INR", paidBy: RAHUL, boughtOn: "2026-11-08",
      expiresOn: null, wastePolicy: null, createdBy: RAHUL, idemKey: `add-${randomUUID()}`, now,
    };
  }

  function dishOf(recipeId: string, itemId: Uuid, version: number, stepTimes: CookDishStepTimes | null, idemKey = "rajma-1"): CookDishInput {
    return {
      dish: {
        id: asUuid(randomUUID()), cook: RAHUL, orgId: null, name: "Rajma", portionsHalf: 4, extrasMinor: 0, currency: "INR",
        splitMode: "assign", state: "draft", idemKey, now: later, recipeId: asUuid(recipeId), recipeFactorMilli: 450,
      },
      newItems: [],
      ingredients: [
        {
          owner: { kind: "user", subjectId: RAHUL }, itemId, expectedVersion: version, qtyMilli: 100_000, unit: "g", costMinor: 2000,
          paidBy: RAHUL, useTxnId: null, moveId: asUuid(randomUUID()), recipeLine: 0,
        },
      ],
      txns: [],
      audits: [],
      stepTimes,
    };
  }

  const times = () =>
    db.prepare("SELECT dish_id, step_key, recipe_root_id, seconds, factor_milli, cook_id, created_at FROM kitchen_dish_step_times ORDER BY step_key").all() as Array<
      Record<string, unknown>
    >;

  it("writes one row per step key in the dish's own batch — and none when the dish is refused", async () => {
    const original = await create();
    const copy = await create({ ownerId: RAHUL, source: { recipeId: original.id, ownerId: ANU, ownerName: "Anu" } });
    const rajma = rahulsItem();
    await repo.createItem({ item: rajma });
    const stepTimes = { recipeRootId: asUuid(original.id), factorMilli: 450, steps: [{ key: "fry", seconds: 515 }, { key: "soak", seconds: 30_000 }] };

    // Refused (the item moved on): nothing is written, step times included.
    const stale = await repo.cookDish(dishOf(copy.id, rajma.id, 99, stepTimes, "rajma-stale"));
    expect(stale.ok).toBe(false);
    expect(times()).toEqual([]);

    const cooked = await repo.cookDish(dishOf(copy.id, rajma.id, 1, stepTimes));
    if (!cooked.ok) throw new Error(JSON.stringify(cooked.error));
    const dishId = cooked.value.dish.id;
    expect(times()).toEqual([
      { dish_id: dishId, step_key: "fry", recipe_root_id: original.id, seconds: 515, factor_milli: 450, cook_id: RAHUL, created_at: later.toISOString() },
      { dish_id: dishId, step_key: "soak", recipe_root_id: original.id, seconds: 30_000, factor_milli: 450, cook_id: RAHUL, created_at: later.toISOString() },
    ]);
    // The same request again: the dish it made, and no second set of times.
    const replay = await repo.cookDish(dishOf(copy.id, rajma.id, 2, stepTimes));
    expect(replay.ok && replay.value.replayed).toBe(true);
    expect(times()).toHaveLength(2);
  });

  it("writes no step times for a dish that has none, and keeps a factor the dish did not say as null", async () => {
    const r = await create({ ownerId: RAHUL });
    const rajma = rahulsItem();
    await repo.createItem({ item: rajma });
    const before = sent.length;
    const plain = await repo.cookDish(dishOf(r.id, rajma.id, 1, { recipeRootId: asUuid(r.id), factorMilli: null, steps: [] }, "plain"));
    expect(plain.ok).toBe(true);
    expect(sent.slice(before).some((q) => q.includes("kitchen_dish_step_times"))).toBe(false);
    const again = await repo.cookDish(dishOf(r.id, rajma.id, 2, { recipeRootId: asUuid(r.id), factorMilli: null, steps: [{ key: "k", seconds: 0 }] }, "again"));
    expect(again.ok).toBe(true);
    expect(times()).toEqual([expect.objectContaining({ step_key: "k", seconds: 0, factor_milli: null })]);
  });
});
