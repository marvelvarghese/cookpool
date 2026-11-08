import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlExecutor, type D1Binding } from "@saas/db/d1";
import {
  createKitchenRepository,
  type KitchenRepository,
  type NewKitchenItem,
  type NewKitchenRecipe,
} from "@saas/db/kitchen";
import { asUuid, manifest } from "@saas/db";
import { D1ApiAdapter } from "@saas/db/runner";

// The food list and recipes' repositories (Cookpool RC-4, migrations 340 and
// 350) against a REAL SQLite engine with every migration applied: matching a
// name to a food, linking items as they are added, the "asked once" answers,
// Always have, and recipes — written, read in scopes, edited, deleted, linked
// — with the dish's recipe link and the viewer's last cook.

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

/** A D1 binding over `db` that records every statement it is sent. */
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

const RAHUL = "usr_rahul";
const ANU = "usr_anu";
const flat = asUuid("d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1");
const lunch = asUuid("d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2");
const mine = { kind: "user", subjectId: RAHUL } as const;
const inFlat = { kind: "group", orgId: flat } as const;
const now = new Date("2026-11-08T08:00:00.000Z");

let db: DatabaseSync;
let sent: string[];
let repo: KitchenRepository;
let seq = 0;

beforeEach(() => {
  db = migrated();
  sent = [];
  repo = createKitchenRepository(createSqlExecutor(d1Over(db, sent)));
});

afterEach(() => db.close());

function item(overrides: Partial<NewKitchenItem> = {}): NewKitchenItem {
  seq += 1;
  return {
    id: asUuid(randomUUID()),
    owner: mine,
    name: "Onions",
    category: "veg",
    dimension: "mass",
    displayUnit: "kg",
    qtyMilli: 1_000_000,
    priceMinor: 4000,
    currency: "INR",
    paidBy: RAHUL,
    boughtOn: "2026-11-08",
    expiresOn: null,
    wastePolicy: null,
    createdBy: RAHUL,
    idemKey: `add-${seq}`,
    now,
    ...overrides,
  };
}

async function add(overrides: Partial<NewKitchenItem> = {}): Promise<string> {
  const created = await repo.createItem({ item: item(overrides) });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  return created.value.item.id;
}

const foodOf = (itemId: string) =>
  (db.prepare("SELECT food_key FROM kitchen_items WHERE id = ?").get(itemId) as { food_key: string | null }).food_key;

describe("the food list, against a real SQLite engine (340_kitchen_foods)", () => {
  it("matches a name as itself, folded, then without a plural es or s — and nothing it cannot be sure of", async () => {
    const match = async (name: string) => {
      const found = await repo.matchFood(name);
      if (!found.ok) throw new Error("read failed");
      return found.value?.key ?? null;
    };
    expect(await match("Onions")).toBe("onion");
    expect(await match("  PYAZ ")).toBe("onion");
    expect(await match("Kanda")).toBe("onion");
    expect(await match("Tomatoes")).toBe("tomato"); // tomato, not "tomatoe"
    expect(await match("Green Chillies")).toBe("green_chilli");
    expect(await match("eggs")).toBe("egg");
    expect(await match("Toor Dal")).toBe("toor_dal");
    expect(await match("Amul Taaza")).toBeNull();
    expect(await match("s")).toBeNull();
    expect(await match("")).toBeNull();
  });

  it("links an item to its food in the add's own batch, personal or group, and leaves an unknown name unlinked", async () => {
    const before = sent.length;
    const onions = await add();
    // The insert and the link: one batch, no read first.
    expect(sent.length - before).toBe(2);
    expect(foodOf(onions)).toBe("onion");
    expect(foodOf(await add({ owner: inFlat, name: "Dahi", category: "dairy" }))).toBe("curd");
    expect(foodOf(await add({ name: "Amul taaza", category: "dairy", dimension: "volume", displayUnit: "L" }))).toBeNull();
  });

  it("keeps a pantry's answer for a name, links that pantry's items of that name at once, and follows it for items added later", async () => {
    const kandaMine = await add({ name: "Kanda batata mix" });
    const kandaFlat = await add({ owner: inFlat, name: "Kanda batata mix" });
    expect([foodOf(kandaMine), foodOf(kandaFlat)]).toEqual([null, null]);

    const answered = await repo.setFoodAnswer({ owner: inFlat, name: " KANDA batata MIX", foodKey: "onion", actor: ANU, now });
    expect(answered.ok && answered.value).toEqual({
      answer: expect.objectContaining({ ownerKind: "group", ownerId: flat, nameKey: "kanda batata mix", foodKey: "onion", answeredBy: ANU }),
      linkedItems: 1,
    });
    // Only that pantry's items.
    expect([foodOf(kandaMine), foodOf(kandaFlat)]).toEqual([null, "onion"]);
    expect(foodOf(await add({ owner: inFlat, name: "Kanda Batata Mix" }))).toBe("onion");
    expect(foodOf(await add({ owner: { kind: "group", orgId: lunch }, name: "Kanda batata mix" }))).toBeNull();

    // "None of these" is an answer too: it unlinks, and keeps the names table out.
    const onionsFlat = await add({ owner: inFlat, name: "Onions" });
    expect(foodOf(onionsFlat)).toBe("onion");
    const none = await repo.setFoodAnswer({ owner: inFlat, name: "onions", foodKey: null, actor: ANU, now });
    expect(none.ok && none.value.linkedItems).toBe(1);
    expect(foodOf(onionsFlat)).toBeNull();
    expect(foodOf(await add({ owner: inFlat, name: "Onions" }))).toBeNull();
    expect(foodOf(await add({ name: "Onions" }))).toBe("onion");

    // Answering again replaces the answer.
    await repo.setFoodAnswer({ owner: inFlat, name: "onions", foodKey: "onion", actor: RAHUL, now });
    expect(foodOf(onionsFlat)).toBe("onion");
    expect((db.prepare("SELECT COUNT(*) AS n FROM kitchen_food_answers").get() as { n: number }).n).toBe(2);
    expect(await repo.setFoodAnswer({ owner: mine, name: "x", foodKey: "no_such_food", actor: RAHUL, now })).toEqual({
      ok: false,
      error: { kind: "invalid", reason: "unknown_food" },
    });
  });

  it("starts everyone with salt and water, keeps a saved list — an empty one too — and refuses a food not on the list", async () => {
    expect(await repo.getAlwaysHave(RAHUL)).toEqual({ ok: true, value: { foodKeys: ["salt", "water"], isSet: false } });
    expect(await repo.setAlwaysHave(RAHUL, ["turmeric", "salt", "garam_masala", "salt"], now)).toEqual({
      ok: true,
      value: { foodKeys: ["garam_masala", "salt", "turmeric"], isSet: true },
    });
    expect(await repo.setAlwaysHave(RAHUL, [], now)).toEqual({ ok: true, value: { foodKeys: [], isSet: true } });
    expect(await repo.getAlwaysHave(RAHUL)).toEqual({ ok: true, value: { foodKeys: [], isSet: true } });
    expect(await repo.getAlwaysHave(ANU)).toEqual({ ok: true, value: { foodKeys: ["salt", "water"], isSet: false } });
    expect(await repo.setAlwaysHave(RAHUL, ["saffron_threads"], now)).toEqual({ ok: false, error: { kind: "invalid", reason: "unknown_food" } });
    expect(await repo.getAlwaysHave(RAHUL)).toEqual({ ok: true, value: { foodKeys: [], isSet: true } });
  });

  it("searches names best match first, each food once with the name that matched", async () => {
    const search = async (q: string | null, limit = 10) => {
      const found = await repo.searchFoods(q, limit);
      if (!found.ok) throw new Error("read failed");
      return found.value.map((f) => `${f.key}:${f.matchedName}`);
    };
    // The name itself, then names that start with it, then a word that does (360's list, RC-7).
    expect(await search("pyaz")).toEqual(["onion:pyaz", "spring_onion:hara pyaz"]);
    expect((await search("dal")).slice(0, 6)).toEqual([
      "toor_dal:dal", "cinnamon:dalchini", "dalia:dalia", "namkeen:dal moth", "pomegranate:dalimb", "chana_dal:chana dal",
    ]);
    expect(await search("chilli")).toEqual([
      "green_chilli:chilli", "chilli_flakes:chilli flakes", "red_chilli_powder:chilli powder", "red_chilli_sauce:chilli sauce",
      "dried_red_chilli:red chilli", "green_chilli_sauce:green chilli sauce",
    ]);
    expect(await search("chilli", 1)).toEqual(["green_chilli:chilli"]);
    expect(await search("zzz")).toEqual([]);
    const everything = await repo.searchFoods(null, 100);
    expect(everything.ok && everything.value.length).toBeGreaterThanOrEqual(55);
    expect(everything.ok && everything.value[0]!.name.localeCompare(everything.value[1]!.name)).toBeLessThan(0);
    // A LIKE wildcard is a character.
    expect(await search("%")).toEqual([]);
  });

  it("reads usable items of the foods asked for, and one unlinked item per name, in one statement each", async () => {
    await add({ name: "Onions" });
    await add({ name: "Onions", idemKey: "again" });
    await add({ owner: inFlat, name: "Tomatoes" });
    await add({ owner: { kind: "group", orgId: lunch }, name: "Onions" });
    await add({ name: "Amul taaza" });
    await add({ name: "Amul Taaza" });
    await add({ owner: inFlat, name: "Kanda" + " mix" });
    const scope = { ownerSubjectId: RAHUL, orgIds: [flat] };
    const before = sent.length;
    const items = await repo.listFoodItems(scope, ["onion", "tomato"]);
    expect(sent.length - before).toBe(1);
    expect(items.ok && items.value.map((i) => [i.item.name, i.foodKey]).sort()).toEqual([
      ["Onions", "onion"],
      ["Onions", "onion"],
      ["Tomatoes", "tomato"],
    ]);
    const unlinked = await repo.listUnlinkedItems(scope, 20);
    expect(unlinked.ok && unlinked.value.map((i) => i.name.toLowerCase()).sort()).toEqual(["amul taaza", "kanda mix"]);
    await repo.setFoodAnswer({ owner: mine, name: "Amul taaza", foodKey: null, actor: RAHUL, now });
    const after = await repo.listUnlinkedItems(scope, 20);
    expect(after.ok && after.value.map((i) => i.name)).toEqual(["Kanda mix"]);
    expect(await repo.listFoodItems({ ownerSubjectId: null, orgIds: [] }, ["onion"])).toEqual({ ok: true, value: [] });
  });
});

describe("recipes, against a real SQLite engine (350_kitchen_recipes)", () => {
  function recipe(overrides: Partial<NewKitchenRecipe> = {}): NewKitchenRecipe {
    return {
      id: asUuid(randomUUID()),
      ownerId: ANU,
      name: "Chicken curry",
      servesHalf: 8,
      minutes: 45,
      kind: "dal_curry",
      visibility: "groups",
      linkCode: null,
      source: null,
      lines: [
        { foodKey: "chicken", name: "Chicken", qtyMilli: 1_000_000, unit: "kg", toTaste: false, isMain: true },
        { foodKey: "onion", name: "Onions", qtyMilli: 2_000, unit: "onion", toTaste: false, isMain: false },
        { foodKey: "salt", name: "Salt", qtyMilli: null, unit: null, toTaste: true, isMain: false },
      ],
      steps: ["Brown the onions", "Add the chicken"],
      now,
      ...overrides,
    };
  }

  async function create(overrides: Partial<NewKitchenRecipe> = {}) {
    const created = await repo.createRecipe(recipe(overrides));
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    return created.value;
  }

  it("writes a recipe, its lines and its steps in one batch of three statements, however many lines", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({
      foodKey: i === 0 ? "rice" : null, name: `Line ${i}`, qtyMilli: 1_000 * (i + 1), unit: "g", toTaste: false, isMain: i === 0,
    }));
    const before = sent.length;
    const written = await create({ lines, steps: Array.from({ length: 20 }, (_, i) => `Step ${i}`) });
    // The batch (three statements), then the read back (one row, its lines, its steps).
    expect(sent.length - before).toBe(6);
    expect(written).toMatchObject({ ownerId: ANU, name: "Chicken curry", servesHalf: 8, visibility: "groups", savedBy: 0, lastCookedAt: null });
    expect(written.lines).toHaveLength(40);
    expect(written.lines[39]).toEqual({ position: 39, foodKey: null, name: "Line 39", qtyMilli: 40_000, unit: "g", toTaste: false, isMain: false });
    expect(written.steps[19]).toBe("Step 19");
  });

  it("refuses two main lines, a to-taste main, a food not on the list and a taken link code — writing nothing", async () => {
    // People's recipes (Cookpool's own, seeded by 360, aside).
    const count = () => (db.prepare("SELECT COUNT(*) AS n FROM kitchen_recipes WHERE is_system = 0").get() as { n: number }).n;
    const bad = [
      recipe({ lines: [...recipe().lines, { foodKey: "rice", name: "Rice", qtyMilli: 1_000, unit: "g", toTaste: false, isMain: true }] }),
      recipe({ lines: [{ foodKey: "salt", name: "Salt", qtyMilli: null, unit: null, toTaste: true, isMain: true }] }),
      recipe({ lines: [{ foodKey: "dragonfruit", name: "X", qtyMilli: 1_000, unit: "g", toTaste: false, isMain: true }] }),
    ];
    const results = [];
    for (const r of bad) results.push(await repo.createRecipe(r));
    expect(results.map((r) => !r.ok && r.error)).toEqual([
      { kind: "invalid", reason: "two_main_lines" },
      { kind: "invalid", reason: "recipe_out_of_range" },
      { kind: "invalid", reason: "unknown_food" },
    ]);
    await create({ visibility: "link", linkCode: "AbCdEfGhJk" });
    expect(await repo.createRecipe(recipe({ visibility: "link", linkCode: "AbCdEfGhJk" }))).toEqual({
      ok: false,
      error: { kind: "conflict", entity: "kitchen_recipe_link" },
    });
    expect(count()).toBe(1);
  });

  it("lists the owner's own, Cookpool's and others' shared ones — never only-me ones of others, nor deleted ones", async () => {
    // Cookpool's seeded recipes (360) aside, so each scope is counted exactly.
    db.exec(`DELETE FROM kitchen_recipe_steps WHERE recipe_id IN (SELECT id FROM kitchen_recipes WHERE is_system = 1);
             DELETE FROM kitchen_recipe_lines WHERE recipe_id IN (SELECT id FROM kitchen_recipes WHERE is_system = 1);
             DELETE FROM kitchen_recipes WHERE is_system = 1;`);
    const mineOnly = await create({ ownerId: RAHUL, visibility: "only_me", name: "Rahul's secret dal" });
    const anuGroups = await create({ name: "Anu's curry" });
    const anuLink = await create({ name: "Anu's poha", visibility: "link", linkCode: "PohaPohaPo", kind: "breakfast" });
    await create({ name: "Anu's own", visibility: "only_me" });
    db.prepare(
      "INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility, is_system) VALUES (?, 'usr_cookpool', 'Masala chai', 4, 'groups', 1)",
    ).run(randomUUID());
    const gone = await create({ ownerId: RAHUL, name: "Gone" });
    await repo.deleteRecipe(asUuid(gone.id), RAHUL, now);

    const names = async (query: Parameters<KitchenRepository["listRecipes"]>[0]) => {
      const found = await repo.listRecipes(query);
      if (!found.ok) throw new Error("read failed");
      return found.value.map((r) => r.name).sort();
    };
    const base = { viewer: RAHUL, q: null, kind: null, limit: 50 };
    expect(await names({ ...base, ownerId: RAHUL })).toEqual([mineOnly.name]);
    expect(await names({ ...base, sharedBy: [ANU] })).toEqual([anuGroups.name, anuLink.name].sort());
    expect(await names({ ...base, system: true })).toEqual(["Masala chai"]);
    expect(await names({ ...base, ownerId: RAHUL, system: true, sharedBy: [ANU] })).toHaveLength(4);
    expect(await names({ ...base, sharedBy: [ANU], kind: "breakfast" })).toEqual([anuLink.name]);
    expect(await names({ ...base, sharedBy: [ANU], q: "CURRY" })).toEqual([anuGroups.name]);
    expect(await names({ ...base })).toEqual([]);
    // A link opens only a live link recipe.
    expect((await repo.getRecipeByLinkCode("PohaPohaPo", RAHUL)).ok).toBe(true);
    expect(await repo.getRecipe(asUuid(gone.id), RAHUL)).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("edits only its owner's live recipe, replacing lines and steps whole, and turns a link on, keeps it, and off", async () => {
    const r = await create();
    const id = asUuid(r.id);
    expect(await repo.updateRecipe({ recipeId: id, ownerId: RAHUL, changes: { name: "Mine now" }, now })).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    const later = new Date(now.getTime() + 60_000);
    const edited = await repo.updateRecipe({
      recipeId: id,
      ownerId: ANU,
      changes: { name: "Chicken curry, less oil", servesHalf: 6, minutes: null, visibility: "link", newLinkCode: "CodeCode12" },
      lines: [{ foodKey: "chicken", name: "Chicken thighs", qtyMilli: 750_000, unit: "g", toTaste: false, isMain: true }],
      steps: [],
      now: later,
    });
    expect(edited.ok && edited.value).toMatchObject({
      name: "Chicken curry, less oil", servesHalf: 6, minutes: null, visibility: "link", linkCode: "CodeCode12", updatedAt: later, steps: [],
    });
    expect(edited.ok && edited.value.lines.map((l) => l.name)).toEqual(["Chicken thighs"]);
    // Link again: the code stays.
    const again = await repo.updateRecipe({ recipeId: id, ownerId: ANU, changes: { visibility: "link", newLinkCode: "OtherCode1" }, now: later });
    expect(again.ok && again.value.linkCode).toBe("CodeCode12");
    // Rotate, then off.
    const rotated = await repo.setRecipeLink(id, ANU, "Rotated123", later);
    expect(rotated.ok && [rotated.value.visibility, rotated.value.linkCode]).toEqual(["link", "Rotated123"]);
    expect((await repo.getRecipeByLinkCode("CodeCode12", RAHUL)).ok).toBe(false);
    const off = await repo.setRecipeLink(id, ANU, null, later);
    expect(off.ok && [off.value.visibility, off.value.linkCode]).toEqual(["groups", null]);
    const onlyMe = await repo.updateRecipe({ recipeId: id, ownerId: ANU, changes: { visibility: "only_me" }, now: later });
    expect(onlyMe.ok && [onlyMe.value.visibility, onlyMe.value.linkCode]).toEqual(["only_me", null]);
    expect(await repo.setRecipeLink(id, RAHUL, "Stolen1234", later)).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("counts live copies as saved by, never lets Cookpool's own be edited, and deletes softly with copies kept", async () => {
    const source = await create();
    const copy = await create({ ownerId: RAHUL, visibility: "only_me", source: { recipeId: source.id, ownerId: ANU, ownerName: "Anu" } });
    await create({ ownerId: "usr_dev", visibility: "only_me", source: { recipeId: source.id, ownerId: ANU, ownerName: "Anu" } });
    const read = await repo.getRecipe(asUuid(source.id), ANU);
    expect(read.ok && read.value.savedBy).toBe(2);
    expect(copy).toMatchObject({ sourceRecipeId: source.id, sourceOwnerId: ANU, sourceOwnerName: "Anu", savedBy: 0 });

    const deleted = await repo.deleteRecipe(asUuid(source.id), ANU, now);
    expect(deleted.ok && deleted.value.deletedAt).toEqual(now);
    expect(await repo.deleteRecipe(asUuid(source.id), ANU, now)).toEqual({ ok: false, error: { kind: "not_found" } });
    const kept = await repo.getRecipe(asUuid(copy.id), RAHUL);
    expect(kept.ok && kept.value.lines).toEqual(copy.lines);

    const chai = asUuid(randomUUID());
    db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility, is_system) VALUES (?, 'usr_cookpool', 'Masala chai', 4, 'groups', 1)").run(chai);
    expect(await repo.updateRecipe({ recipeId: chai, ownerId: "usr_cookpool", changes: { name: "Mine" }, now })).toEqual({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await repo.deleteRecipe(chai, "usr_cookpool", now)).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("keeps the dish's recipe, factor and each ingredient's line, and reads the viewer's last cook of it", async () => {
    const r = await create();
    const chicken = item({ name: "Chicken", category: "protein", qtyMilli: 1_000_000, priceMinor: 30000 });
    await repo.createItem({ item: chicken });
    const cookAt = async (at: Date, factor: number, qtyMilli: number, idemKey: string, state?: "canceled") => {
      const dishId = asUuid(randomUUID());
      const current = await repo.getItem(mine, chicken.id);
      if (!current.ok) throw new Error("no item");
      const cooked = await repo.cookDish({
        dish: {
          id: dishId, cook: RAHUL, orgId: null, name: "Chicken curry", portionsHalf: 4, extrasMinor: 0, currency: "INR",
          splitMode: "assign", state: "draft", idemKey, now: at, recipeId: asUuid(r.id), recipeFactorMilli: factor,
        },
        newItems: [],
        ingredients: [
          {
            owner: mine, itemId: chicken.id, expectedVersion: current.value.version, qtyMilli, unit: "g", costMinor: 1000,
            paidBy: RAHUL, useTxnId: null, moveId: asUuid(randomUUID()), recipeLine: 0,
          },
        ],
        txns: [],
        audits: [],
      });
      if (!cooked.ok) throw new Error(JSON.stringify(cooked.error));
      if (state) db.prepare("UPDATE kitchen_dishes SET state = 'canceled', canceled_at = ? WHERE id = ?").run(at.toISOString(), dishId);
      return cooked.value.dish;
    };
    expect(await repo.lastCook(RAHUL, asUuid(r.id))).toEqual({ ok: true, value: null });
    const first = await cookAt(now, 450, 450_000, "c1");
    expect(first).toMatchObject({ recipeId: r.id, recipeFactorMilli: 450 });
    expect(first.ingredients[0]).toMatchObject({ recipeLine: 0, qtyMilli: 450_000 });
    const later = new Date(now.getTime() + 86_400_000);
    await cookAt(later, 300, 300_000, "c2");
    await cookAt(new Date(later.getTime() + 1_000), 200, 200_000, "c3", "canceled");

    const last = await repo.lastCook(RAHUL, asUuid(r.id));
    expect(last.ok && last.value).toMatchObject({ cookedAt: later, recipeFactorMilli: 300, portionsHalf: 4 });
    expect(last.ok && last.value!.ingredients.map((i) => [i.recipeLine, i.qtyMilli, i.name])).toEqual([[0, 300_000, "Chicken"]]);
    expect(await repo.lastCook(ANU, asUuid(r.id))).toEqual({ ok: true, value: null });
    const read = await repo.getRecipe(asUuid(r.id), RAHUL);
    expect(read.ok && read.value.lastCookedAt).toEqual(later);
    const theirs = await repo.getRecipe(asUuid(r.id), ANU);
    expect(theirs.ok && theirs.value.lastCookedAt).toBeNull();

    // A dish cooked without a recipe reads none.
    const plain = await repo.getDish(first.id as never, { cook: RAHUL, orgIds: [] });
    expect(plain.ok && plain.value.recipeId).toBe(r.id);
  });
});
