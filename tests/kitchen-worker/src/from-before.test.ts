// From before (SM-8): what the caller bought and cooked before, for the
// type-ahead on Bought and Cook — GET /v1/kitchen/me/items/history and
// GET /v1/kitchen/me/dishes/recipes — through the router, against real SQLite
// (every migration applied), the real policy grants and membership's answers.
// Grouping by name, what the newest record fills in, the match ranking, who
// sees what, the limits, and that each read stays one D1 statement however
// much there is.

import type {
  DishResponse,
  ItemHistoryEntry,
  ItemHistoryResponse,
  KitchenItem,
  KitchenItemResponse,
  Recipe,
  RecipesResponse,
} from "@saas/contracts/kitchen";
import { FROM_BEFORE_DEFAULT_LIMIT, FROM_BEFORE_MAX_LIMIT } from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-04T08:00:00.000Z");

const RAHUL = "usr_rahul"; // the caller: builder in Flat 4B and the Lunch club, viewer in the Book club, billing admin of the Office
const ANU = "usr_anu"; // owner of Flat 4B and of Anu's flat
const DEV = "usr_dev";
const KIRAN = "usr_kiran"; // owner of the Lunch club
const MEERA = "usr_meera"; // owner of the Book club and the Office
const OUTSIDER = "usr_outsider"; // another flat altogether

let h: Harness;
let clock: Date;
let flat: Group;
let lunch: Group;
let books: Group;
let office: Group;
let anusFlat: Group;
let elsewhere: Group;

beforeEach(() => {
  clock = NOW;
  h = createHarness({ deps: { now: () => clock } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  books = newGroup("Book club");
  office = newGroup("Office");
  anusFlat = newGroup("Anu's flat");
  elsewhere = newGroup("Another flat");
  h.grant(RAHUL, flat, "builder");
  h.grant(ANU, flat, "owner");
  h.grant(DEV, flat, "builder");
  h.grant(KIRAN, lunch, "owner");
  h.grant(RAHUL, lunch, "builder");
  h.grant(MEERA, books, "owner");
  h.grant(RAHUL, books, "viewer");
  h.grant(MEERA, office, "owner");
  h.grant(RAHUL, office, "billing_admin");
  h.grant(ANU, anusFlat, "owner");
  h.grant(OUTSIDER, elsewhere, "owner");
});

afterEach(() => h.close());

/** A minute later: what is written next is newer. */
function tick(): void {
  clock = new Date(clock.getTime() + 60_000);
}

async function call<T>(
  method: string,
  url: string,
  as: string | null,
  body?: unknown,
): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

const me = (rest: string) => `/v1/kitchen/me/${rest}`;
const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

async function myItem(as: string, body: Record<string, unknown>): Promise<KitchenItem> {
  tick();
  const res = await call<KitchenItemResponse>("POST", me("items"), as, { category: "Dairy", priceMinor: 5000, ...body });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function groupItem(as: string, g: Group, body: Record<string, unknown>): Promise<KitchenItem> {
  tick();
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, { category: "Dairy", priceMinor: 5000, ...body });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

function uuidOf(publicId: string): string {
  return publicId.replace(/^[a-z]+_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

/** Nothing left of a group item: every bit of it used (CP-11's writes, as they leave the row). */
function useUp(item: KitchenItem): void {
  h.db
    .prepare("UPDATE kitchen_items SET qty_left_milli = 0, cost_taken_minor = price_minor, state = 'used_up' WHERE id = ?")
    .run(uuidOf(item.id));
}

async function history(as: string, query = ""): Promise<ItemHistoryEntry[]> {
  const res = await call<ItemHistoryResponse>("GET", me(`items/history${query}`), as);
  expect(res.status).toBe(200);
  return res.body.data.items;
}

async function cook(as: string, body: Record<string, unknown>): Promise<DishResponse["dish"]> {
  tick();
  const res = await call<DishResponse>("POST", me("dishes"), as, { portionsHalf: 4, splitMode: "assign", ...body });
  expect(res.status).toBe(201);
  return res.body.data.dish;
}

async function recipes(as: string, query = ""): Promise<Recipe[]> {
  const res = await call<RecipesResponse>("GET", me(`dishes/recipes${query}`), as);
  expect(res.status).toBe(200);
  return res.body.data.recipes;
}

/** Count every statement the worker prepares on D1 from now on. */
function countStatements(): () => number {
  const real = h.env.PLATFORM_DB!;
  let statements = 0;
  (h.env as { PLATFORM_DB?: D1Database }).PLATFORM_DB = {
    prepare(query: string) {
      statements += 1;
      return real.prepare(query);
    },
    batch: (s: D1PreparedStatement[]) => real.batch(s),
  } as unknown as D1Database;
  return () => statements;
}

const personal = { kind: "personal", orgId: null, name: "My pantry" } as const;
const inFlat = () => ({ kind: "group", orgId: flat.publicId, name: "Flat 4B" }) as const;

// ── Items bought before ────────────────────────────────────

describe("GET /v1/kitchen/me/items/history", () => {
  it("groups past items by name, case-insensitively: the newest record fills every field, and every record bought counts", async () => {
    // Bought four times, in two pantries, by two people; one of them used up, one wasted.
    const wasted = await myItem(RAHUL, { name: "Milk", quantity: "1", unit: "L", priceMinor: 5600, boughtOn: "2026-10-10" });
    expect((await call("POST", me(`items/${wasted.id}/waste`), RAHUL)).status).toBe(201);
    const used = await myItem(RAHUL, { name: "MILK", quantity: "500", unit: "ml", priceMinor: 3000, boughtOn: "2026-10-20", expiresOn: "2026-10-23" });
    expect((await call("POST", me(`items/${used.id}/uses`), RAHUL, { quantity: "500", unit: "ml" })).status).toBe(201);
    await groupItem(RAHUL, flat, { name: "milk", quantity: "2", unit: "L", priceMinor: 12000, boughtOn: "2026-10-28" });
    // The newest: Anu bought it for the flat, with its own waste rule and a use-by five days on.
    await groupItem(ANU, flat, {
      name: "Milk", quantity: "1", unit: "L", priceMinor: 6800, boughtOn: "2026-11-01", expiresOn: "2026-11-06", wastePolicy: "buyer_absorbs",
    });
    // Added by mistake today, then removed: never bought, so it neither counts nor wins.
    const mistake = await myItem(RAHUL, { name: "Milk", quantity: "9", unit: "L", priceMinor: 1, boughtOn: "2026-11-04" });
    expect((await call("DELETE", me(`items/${mistake.id}`), RAHUL)).status).toBe(200);
    // Leftovers were cooked, not bought (CP-16 writes them with the dish they came from).
    const leftovers = await myItem(RAHUL, { name: "milk", quantity: "1", unit: "L", boughtOn: "2026-11-03" });
    h.db.prepare("UPDATE kitchen_items SET source_dish_id = ? WHERE id = ?").run(crypto.randomUUID(), uuidOf(leftovers.id));

    expect(await history(RAHUL, "?q=milk")).toEqual<ItemHistoryEntry[]>([
      {
        name: "Milk",
        category: "Dairy",
        dimension: "volume",
        unit: "L",
        quantity: 1,
        qtyMilli: 1_000_000,
        priceMinor: 6800,
        currency: "INR",
        pantry: inFlat(),
        paidBy: ANU,
        wastePolicy: "buyer_absorbs",
        useByDays: 5,
        times: 4,
        lastBoughtOn: "2026-11-01",
      },
    ]);
  });

  it("takes the record bought last, then the one added last, and says so for a personal item", async () => {
    await myItem(RAHUL, { name: "Paneer", quantity: "200", unit: "g", priceMinor: 9000, boughtOn: "2026-11-02" });
    // Logged later, but bought earlier: not last time.
    await myItem(RAHUL, { name: "Paneer", quantity: "1", unit: "kg", priceMinor: 40000, boughtOn: "2026-10-01" });
    // The same day, logged later: this one.
    await myItem(RAHUL, { name: "paneer", quantity: "250", unit: "g", priceMinor: 11000, boughtOn: "2026-11-02" });
    expect(await history(RAHUL, "?q=paneer")).toEqual([
      expect.objectContaining({
        name: "paneer", quantity: 250, unit: "g", qtyMilli: 250_000, priceMinor: 11000, pantry: personal, paidBy: RAHUL,
        wastePolicy: null, useByDays: null, times: 3, lastBoughtOn: "2026-11-02",
      }),
    ]);
  });

  it("puts names starting with the text first, then names with a word starting with it, then any containing it — newest first in each", async () => {
    await myItem(RAHUL, { name: "Milk", quantity: "1", unit: "L", boughtOn: "2026-10-25" });
    await myItem(RAHUL, { name: "Mint leaves", quantity: "1", unit: "pack", boughtOn: "2026-10-30" });
    await myItem(RAHUL, { name: "Almond milk", quantity: "1", unit: "L", boughtOn: "2026-11-02" });
    await myItem(RAHUL, { name: "Jasmine rice", quantity: "1", unit: "kg", boughtOn: "2026-11-03" });
    await myItem(RAHUL, { name: "Bread", quantity: "1", unit: "pack", boughtOn: "2026-11-04" });
    const names = (items: ItemHistoryEntry[]) => items.map((i) => i.name);

    expect(names(await history(RAHUL, "?q=mi"))).toEqual(["Mint leaves", "Milk", "Almond milk", "Jasmine rice"]);
    expect(names(await history(RAHUL, "?q=MIL"))).toEqual(["Milk", "Almond milk"]);
    expect(names(await history(RAHUL, "?q=%20%20milk%20"))).toEqual(["Milk", "Almond milk"]);
    expect(await history(RAHUL, "?q=cheese")).toEqual([]);
    // LIKE's wildcards are the characters themselves.
    expect(await history(RAHUL, "?q=%25")).toEqual([]);
    expect(await history(RAHUL, "?q=_")).toEqual([]);
    // No text: the most recent.
    expect(names(await history(RAHUL))).toEqual(["Bread", "Jasmine rice", "Almond milk", "Mint leaves", "Milk"]);
    expect(names(await history(RAHUL, "?q="))).toEqual(names(await history(RAHUL)));
  });

  it("returns 8 by default and at most 20; anything else is refused", async () => {
    for (let i = 0; i < 22; i++) {
      await myItem(RAHUL, { name: `Item ${String(i).padStart(2, "0")}`, quantity: "1", unit: "pcs", boughtOn: "2026-11-01" });
    }
    expect(FROM_BEFORE_DEFAULT_LIMIT).toBe(8);
    expect(FROM_BEFORE_MAX_LIMIT).toBe(20);
    const recent = await history(RAHUL);
    expect(recent.map((i) => i.name)).toEqual(Array.from({ length: 8 }, (_, i) => `Item ${21 - i}`));
    expect(await history(RAHUL, "?limit=2")).toHaveLength(2);
    expect(await history(RAHUL, "?limit=20")).toHaveLength(20);
    for (const query of ["?limit=21", "?limit=0", "?limit=two", `?q=${"x".repeat(101)}`]) {
      const res = await call("GET", me(`items/history${query}`), RAHUL);
      expect([query, res.status, res.body.error.code]).toEqual([query, 422, "validation_failed"]);
    }
  });

  it("reads only the caller's own pantry and the groups they read: another group's, another person's and a billing admin's never show", async () => {
    await myItem(RAHUL, { name: "Milk", quantity: "1", unit: "L", priceMinor: 6000, boughtOn: "2026-10-01" });
    // Somewhere Rahul is not: none of these show, nor count towards his Milk.
    await groupItem(OUTSIDER, elsewhere, { name: "Milk", quantity: "5", unit: "L", boughtOn: "2026-11-03" });
    await groupItem(OUTSIDER, elsewhere, { name: "Saffron", quantity: "1", unit: "g", boughtOn: "2026-11-03" });
    await myItem(ANU, { name: "Milk", quantity: "3", unit: "L", boughtOn: "2026-11-03" });
    await groupItem(ANU, anusFlat, { name: "Ghee", quantity: "500", unit: "ml", boughtOn: "2026-11-03" });
    // Billing admin is no part of a group's kitchen (design.md §6).
    await groupItem(MEERA, office, { name: "Coffee", quantity: "250", unit: "g", boughtOn: "2026-11-03" });
    // A viewer reads the Book club's pantry, so what it bought is Rahul's to buy again.
    await groupItem(MEERA, books, { name: "Biscuits", quantity: "2", unit: "pack", boughtOn: "2026-11-02" });
    await groupItem(KIRAN, lunch, { name: "Rice", quantity: "5", unit: "kg", boughtOn: "2026-11-01" });

    const seen = await history(RAHUL);
    expect(seen.map((i) => [i.name, i.pantry.name, i.times])).toEqual([
      ["Biscuits", "Book club", 1],
      ["Rice", "Lunch club", 1],
      ["Milk", "My pantry", 1],
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/Saffron|Ghee|Coffee|Another flat|Anu's flat|Office/);

    // Once he leaves the Lunch club, its pantry is no longer his to read.
    h.revoke(RAHUL, lunch);
    expect((await history(RAHUL)).map((i) => i.name)).toEqual(["Biscuits", "Milk"]);
    expect(await history(OUTSIDER, "?q=sa")).toEqual([expect.objectContaining({ name: "Saffron", times: 1 })]);
  });

  it("asks membership once and reads D1 once, however much history there is", async () => {
    const statements = countStatements();
    const measure = async () => {
      const before = { statements: statements(), groups: h.groupsCalls };
      await history(RAHUL, "?q=i");
      return { statements: statements() - before.statements, groups: h.groupsCalls - before.groups };
    };
    await myItem(RAHUL, { name: "Milk", quantity: "1", unit: "L" });
    const few = await measure();
    expect(few).toEqual({ statements: 1, groups: 1 });

    const more = [newGroup("Group 1"), newGroup("Group 2"), newGroup("Group 3")];
    for (const g of more) h.grant(RAHUL, g, "owner");
    for (let i = 0; i < 30; i++) {
      await myItem(RAHUL, { name: `Thing ${i % 7}`, quantity: "1", unit: "pcs" });
      await groupItem(RAHUL, more[i % 3]!, { name: `Thing ${i % 5}`, quantity: "1", unit: "pcs" });
      await groupItem(ANU, flat, { name: `Flat thing ${i}`, quantity: "1", unit: "pcs" });
    }
    expect(await measure()).toEqual(few);
  });

  it("needs an actor, answers GET only, and is unavailable when membership is", async () => {
    expect((await call("GET", me("items/history"), null)).status).toBe(401);
    expect((await call("POST", me("items/history"), RAHUL, {})).status).toBe(405);
    expect((await call("DELETE", me("items/history"), RAHUL)).status).toBe(405);
    h.failGroups = true;
    expect((await call("GET", me("items/history"), RAHUL)).status).toBe(503);
  });
});

// ── Dishes cooked before ───────────────────────────────────

describe("GET /v1/kitchen/me/dishes/recipes", () => {
  it("groups dishes by name: the newest fills portions, extras and the ingredients, in the cook's order", async () => {
    const eggs = await myItem(RAHUL, { name: "Eggs", category: "Eggs", quantity: "12", unit: "pcs", priceMinor: 8400 });
    const rice = await groupItem(ANU, flat, { name: "Basmati rice", category: "Grains", quantity: "2", unit: "kg", priceMinor: 24000 });
    const oil = await groupItem(DEV, flat, { name: "Oil", category: "Oil", quantity: "1", unit: "L", priceMinor: 20000 });
    await cook(RAHUL, {
      name: "Egg fried rice", orgId: flat.publicId, portionsHalf: 8, extrasMinor: 1000,
      ingredients: [{ itemId: eggs.id, quantity: "2", unit: "pcs" }, { itemId: rice.id, quantity: "200", unit: "g" }],
    });
    const last = await cook(RAHUL, {
      name: "egg fried rice", orgId: flat.publicId, portionsHalf: 10, extrasMinor: 1500, splitMode: "claims",
      ingredients: [
        { itemId: rice.id, quantity: "0.25", unit: "kg" },
        { itemId: eggs.id, quantity: "4", unit: "pcs" },
        { itemId: oil.id, quantity: "2", unit: "tbsp" },
      ],
      newItems: [{ name: "Spring onions", quantity: "1", unit: "pack", priceMinor: 1500 }],
    });
    await cook(RAHUL, { name: "Omelette", ingredients: [{ itemId: eggs.id, quantity: "2", unit: "pcs" }] });

    const found = await recipes(RAHUL, "?q=egg");
    expect(found.map((r) => r.name)).toEqual(["egg fried rice"]);
    const [recipe] = found;
    expect(recipe).toMatchObject({
      name: "egg fried rice",
      times: 2,
      lastCookedAt: last.cookedAt,
      portionsHalf: 10,
      extrasMinor: 1500,
      totalMinor: last.totalMinor,
      currency: "INR",
      orgId: flat.publicId,
    });
    expect(recipe!.ingredients.map((i) => [i.name, i.quantity, i.unit, i.qtyMilli, i.dimension, i.pantry])).toEqual([
      ["Basmati rice", 0.25, "kg", 250_000, "mass", inFlat()],
      ["Eggs", 4, "pcs", 4_000, "count", personal],
      ["Oil", 2, "tbsp", 30_000, "volume", inFlat()],
      // Bought on the way: it went into the cook's own pantry, and all of it into the dish.
      ["Spring onions", 1, "pack", 1_000, "pack", personal],
    ]);
    // What is left now: eggs in Rahul's pantry, the flat's rice and oil; the spring onions are gone.
    expect(recipe!.ingredients.map((i) => i.match)).toEqual([
      { itemId: rice.id, ref: `org:${flat.publicId}:${rice.id}`, pantry: { kind: "group", orgId: flat.publicId, slug: flat.slug, name: "Flat 4B" }, qtyLeftMilli: 1_550_000, canUse: true },
      { itemId: eggs.id, ref: `me:${eggs.id}`, pantry: { kind: "personal", name: "My pantry" }, qtyLeftMilli: 4_000, canUse: true },
      { itemId: oil.id, ref: `org:${flat.publicId}:${oil.id}`, pantry: { kind: "group", orgId: flat.publicId, slug: flat.slug, name: "Flat 4B" }, qtyLeftMilli: 970_000, canUse: true },
      null,
    ]);
    // Without text: the most recent first.
    expect((await recipes(RAHUL)).map((r) => [r.name, r.times, r.orgId])).toEqual([
      ["Omelette", 1, null],
      ["egg fried rice", 2, flat.publicId],
    ]);
  });

  it("matches the same name and dimension, usable now: the pantry it came from first, then the one with most left", async () => {
    const eggs = await myItem(RAHUL, { name: "Eggs", quantity: "6", unit: "pcs" });
    const rice = await groupItem(ANU, flat, { name: "Basmati rice", quantity: "1", unit: "kg" });
    const oil = await groupItem(DEV, flat, { name: "Oil", quantity: "1", unit: "L" });
    const butter = await myItem(RAHUL, { name: "Butter", quantity: "100", unit: "g" });
    const onions = await myItem(RAHUL, { name: "Spring onions", quantity: "1", unit: "pack" });
    await cook(RAHUL, {
      name: "Egg fried rice", orgId: flat.publicId,
      ingredients: [
        { itemId: eggs.id, quantity: "2", unit: "pcs" },
        { itemId: rice.id, quantity: "250", unit: "g" },
        { itemId: oil.id, quantity: "30", unit: "ml" },
        { itemId: butter.id, quantity: "100", unit: "g" }, // all of it
        { itemId: onions.id, quantity: "1", unit: "pack" }, // all of it
      ],
    });

    // More eggs in the flat, more rice in Rahul's own pantry: last time's pantries still win.
    await groupItem(ANU, flat, { name: "eggs", quantity: "30", unit: "pcs" });
    await myItem(RAHUL, { name: "BASMATI RICE", quantity: "5", unit: "kg" });
    // The flat's oil runs out: the oil with most left wherever Rahul may use it.
    useUp(oil);
    await myItem(RAHUL, { name: "Oil", quantity: "500", unit: "ml" });
    const lunchOil = await groupItem(KIRAN, lunch, { name: "oil", quantity: "2", unit: "L" });
    await groupItem(OUTSIDER, elsewhere, { name: "Oil", quantity: "5", unit: "L" }); // not his
    // Butter only where Rahul may read but not use (a viewer), or used up: no match.
    await groupItem(MEERA, books, { name: "Butter", quantity: "500", unit: "g" });
    const usedButter = await myItem(RAHUL, { name: "Butter", quantity: "100", unit: "g" });
    expect((await call("POST", me(`items/${usedButter.id}/uses`), RAHUL, { quantity: "100", unit: "g" })).status).toBe(201);
    // Spring onions by weight do not measure what a pack does; a removed pack was a mistake.
    await myItem(RAHUL, { name: "Spring onions", quantity: "200", unit: "g" });
    const removed = await myItem(RAHUL, { name: "Spring onions", quantity: "1", unit: "pack" });
    expect((await call("DELETE", me(`items/${removed.id}`), RAHUL)).status).toBe(200);

    const [recipe] = await recipes(RAHUL, "?q=egg");
    expect(recipe!.ingredients.map((i) => [i.name, i.match?.itemId ?? null, i.match?.pantry.name ?? null])).toEqual([
      ["Eggs", eggs.id, "My pantry"],
      ["Basmati rice", rice.id, "Flat 4B"],
      ["Oil", lunchOil.id, "Lunch club"],
      ["Butter", null, null],
      ["Spring onions", null, null],
    ]);
    // Several in the same pantry: the one with most left.
    const moreEggs = await myItem(RAHUL, { name: "Eggs", quantity: "12", unit: "pcs" });
    const [again] = await recipes(RAHUL, "?q=egg");
    expect(again!.ingredients[0]!.match).toMatchObject({ itemId: moreEggs.id, qtyLeftMilli: 12_000 });
  });

  it("names only pantries the caller can see: another cook's own pantry and a group they are not in read as unknown", async () => {
    const lentils = await myItem(ANU, { name: "Lentils", quantity: "1", unit: "kg" });
    const ghee = await groupItem(ANU, anusFlat, { name: "Ghee", quantity: "500", unit: "ml" });
    const onions = await groupItem(DEV, flat, { name: "Onions", quantity: "1", unit: "kg" });
    await cook(ANU, {
      name: "Dal", orgId: flat.publicId,
      ingredients: [
        { itemId: lentils.id, quantity: "250", unit: "g" },
        { itemId: ghee.id, quantity: "1", unit: "tbsp" },
        { itemId: onions.id, quantity: "100", unit: "g" },
      ],
    });
    const mine = await myItem(RAHUL, { name: "lentils", quantity: "500", unit: "g" });

    const found = await recipes(RAHUL, "?q=dal");
    expect(found.map((r) => [r.name, r.orgId])).toEqual([["Dal", flat.publicId]]);
    expect(found[0]!.ingredients.map((i) => [i.name, i.pantry, i.match?.itemId ?? null])).toEqual([
      ["Lentils", null, mine.id], // Anu's own pantry; Rahul's lentils now
      ["Ghee", null, null], // a group Rahul is not in
      ["Onions", inFlat(), onions.id],
    ]);
    expect(JSON.stringify(found)).not.toContain(anusFlat.publicId);
    expect(JSON.stringify(found)).not.toContain("Anu's flat");
    // Anu, its cook, sees both of her pantries.
    const [hers] = await recipes(ANU, "?q=dal");
    expect(hers!.ingredients.map((i) => i.pantry?.name ?? null)).toEqual(["My pantry", "Anu's flat", "Flat 4B"]);
    expect(hers!.ingredients.map((i) => i.match?.itemId ?? null)).toEqual([lentils.id, ghee.id, onions.id]);
  });

  it("reads the caller's dishes and those shared with their groups — a viewer's too — never another group's, a canceled one or one just for someone else", async () => {
    const eggs = await myItem(RAHUL, { name: "Eggs", quantity: "30", unit: "pcs" });
    const anusEggs = await myItem(ANU, { name: "Eggs", quantity: "30", unit: "pcs" });
    const meerasEggs = await myItem(MEERA, { name: "Eggs", quantity: "30", unit: "pcs" });
    const outsidersEggs = await myItem(OUTSIDER, { name: "Eggs", quantity: "30", unit: "pcs" });
    const take = (item: KitchenItem) => [{ itemId: item.id, quantity: "1", unit: "pcs" }];

    await cook(RAHUL, { name: "Boiled eggs", orgId: lunch.publicId, ingredients: take(eggs) });
    await cook(ANU, { name: "Egg curry", orgId: flat.publicId, ingredients: take(anusEggs) });
    await cook(MEERA, { name: "Egg sandwich", orgId: books.publicId, ingredients: take(meerasEggs) });
    await cook(ANU, { name: "Egg bhurji", ingredients: take(anusEggs) }); // just for Anu
    await cook(OUTSIDER, { name: "Eggs benedict", orgId: elsewhere.publicId, ingredients: take(outsidersEggs) });
    const oops = await cook(RAHUL, { name: "Egg salad", ingredients: take(eggs) });
    expect((await call("POST", me(`dishes/${oops.id}/cancel`), RAHUL)).status).toBe(200);
    // Canceled ones do not count towards a name either.
    const twice = await cook(RAHUL, { name: "Boiled eggs", ingredients: take(eggs) });
    expect((await call("POST", me(`dishes/${twice.id}/cancel`), RAHUL)).status).toBe(200);

    expect((await recipes(RAHUL)).map((r) => [r.name, r.times, r.orgId])).toEqual([
      ["Egg sandwich", 1, books.publicId],
      ["Egg curry", 1, flat.publicId],
      ["Boiled eggs", 1, lunch.publicId],
    ]);

    // Out of the Lunch club, his own dish stays his, but not for that group; out of Flat 4B, Anu's curry goes.
    h.revoke(RAHUL, lunch);
    h.revoke(RAHUL, flat);
    expect((await recipes(RAHUL)).map((r) => [r.name, r.orgId])).toEqual([
      ["Egg sandwich", books.publicId],
      ["Boiled eggs", null],
    ]);
  });

  it("ranks like the item history, returns 8 by default and at most 20, and refuses anything else", async () => {
    const eggs = await myItem(RAHUL, { name: "Eggs", quantity: "30", unit: "pcs" });
    for (const name of ["Egg curry", "Scrambled eggs", "Veggie burger", "Eggplant bake"]) {
      await cook(RAHUL, { name, ingredients: [{ itemId: eggs.id, quantity: "1", unit: "pcs" }] });
    }
    expect((await recipes(RAHUL, "?q=egg")).map((r) => r.name)).toEqual(["Eggplant bake", "Egg curry", "Scrambled eggs", "Veggie burger"]);
    for (let i = 0; i < 18; i++) {
      await cook(RAHUL, { name: `Dish ${String(i).padStart(2, "0")}`, ingredients: [{ itemId: eggs.id, quantity: "1", unit: "pcs" }] });
    }
    expect(await recipes(RAHUL)).toHaveLength(8);
    expect((await recipes(RAHUL))[0]!.name).toBe("Dish 17");
    expect(await recipes(RAHUL, "?limit=20")).toHaveLength(20);
    expect(await recipes(RAHUL, "?limit=1")).toHaveLength(1);
    for (const query of ["?limit=21", "?limit=0", `?q=${"x".repeat(101)}`]) {
      const res = await call("GET", me(`dishes/recipes${query}`), RAHUL);
      expect([query, res.status, res.body.error.code]).toEqual([query, 422, "validation_failed"]);
    }
    expect((await call("GET", me("dishes/recipes"), null)).status).toBe(401);
    expect((await call("POST", me("dishes/recipes"), RAHUL, {})).status).toBe(405);
    h.failGroups = true;
    expect((await call("GET", me("dishes/recipes"), RAHUL)).status).toBe(503);
  });

  it("asks membership once and reads D1 once, however many dishes, ingredients and items there are", async () => {
    const statements = countStatements();
    const measure = async () => {
      const before = { statements: statements(), groups: h.groupsCalls };
      const found = await recipes(RAHUL, "?limit=20");
      return { statements: statements() - before.statements, groups: h.groupsCalls - before.groups, recipes: found.length };
    };
    const eggs = await myItem(RAHUL, { name: "Eggs", quantity: "100", unit: "pcs" });
    await cook(RAHUL, { name: "Omelette", ingredients: [{ itemId: eggs.id, quantity: "2", unit: "pcs" }] });
    expect(await measure()).toEqual({ statements: 1, groups: 1, recipes: 1 });

    const stock: KitchenItem[] = [];
    for (let i = 0; i < 12; i++) {
      stock.push(await groupItem(ANU, flat, { name: `Spice ${i}`, quantity: "1", unit: "kg" }));
      await myItem(RAHUL, { name: `Spice ${i}`, quantity: "500", unit: "g" });
    }
    for (let i = 0; i < 15; i++) {
      await cook(i % 2 ? ANU : RAHUL, {
        name: `Curry ${i}`, orgId: flat.publicId,
        ingredients: stock.slice(0, 8).map((item) => ({ itemId: item.id, quantity: "10", unit: "g" })),
      });
    }
    expect(await measure()).toEqual({ statements: 1, groups: 1, recipes: 16 });
  });
});
