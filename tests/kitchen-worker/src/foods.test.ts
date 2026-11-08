// The food list (Cookpool RC-4, cookpool-recipes design §2, §3.4) through the
// router: searching it, items linked to a food as they are added (personal
// and group, and what a dish's cook just bought), the "asked once" answers —
// who may give one and what it relinks — and Always have.

import type { AlwaysHaveResponse, CookDishResponse, FoodsResponse, SetFoodAnswerResponse } from "@saas/contracts/kitchen";
import { ANU, DEV, OLU, RAHUL, VIK, addItem, foodOf, me, world, type World } from "./recipes-helpers.js";

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.h.close());

describe("GET /v1/kitchen/foods (RC-4)", () => {
  it("finds a food by any of its names, best match first, for anyone signed in", async () => {
    const pyaz = await w.call<FoodsResponse>("GET", "/v1/kitchen/foods?q=Pyaz", OLU);
    expect(pyaz.status).toBe(200);
    expect(pyaz.body.data.foods).toEqual([
      { key: "onion", name: "Onion", dimension: "mass", eachG: 150, category: "veg", gPerMl: 0.65, matchedName: "pyaz" },
      { key: "spring_onion", name: "Spring onion", dimension: "mass", eachG: 15, category: "veg", gPerMl: 0.42, matchedName: "hara pyaz" },
    ]);
    // "dal" itself, then names that start with it (dalchini, dalia: RC-7's list), then a word that does.
    const dal = await w.call<FoodsResponse>("GET", "/v1/kitchen/foods?q=dal&limit=3", RAHUL);
    expect(dal.body.data.foods.map((f) => f.key)).toEqual(["toor_dal", "cinnamon", "dalia"]);
    // The whole list is longer than the largest page (about 300 foods since RC-7).
    const all = await w.call<FoodsResponse>("GET", "/v1/kitchen/foods?limit=100", RAHUL);
    expect(all.body.data.foods).toHaveLength(100);
    const anda = await w.call<FoodsResponse>("GET", "/v1/kitchen/foods?q=anda", RAHUL);
    expect(anda.body.data.foods[0]).toMatchObject({ key: "egg", dimension: "count", eachG: 50, category: "protein", gPerMl: null });
  });

  it("asks for a signed-in caller, and refuses a query or limit out of range", async () => {
    expect((await w.call("GET", "/v1/kitchen/foods", null)).status).toBe(401);
    const long = await w.call("GET", `/v1/kitchen/foods?q=${"x".repeat(101)}`, RAHUL);
    expect(long.status).toBe(422);
    expect(long.body.error.details.fields).toHaveProperty("q");
    expect((await w.call("GET", "/v1/kitchen/foods?limit=0", RAHUL)).status).toBe(422);
    expect((await w.call("POST", "/v1/kitchen/foods", RAHUL, {})).status).toBe(405);
  });
});

describe("items link to a food as they are added (RC-4, design §2)", () => {
  it("links a personal or group item when exactly one food matches its name, and leaves anything else unlinked", async () => {
    expect(foodOf(w, await addItem(w, RAHUL, null, { name: "Pyaz", quantity: "1", unit: "kg" }))).toBe("onion");
    expect(foodOf(w, await addItem(w, ANU, w.flat, { name: "Tomatoes", quantity: "500", unit: "g" }))).toBe("tomato");
    expect(foodOf(w, await addItem(w, DEV, w.flat, { name: "Eggs", quantity: "12", unit: "pcs" }))).toBe("egg");
    expect(foodOf(w, await addItem(w, RAHUL, null, { name: "Amul taaza", quantity: "1", unit: "L", category: "dairy" }))).toBeNull();
  });

  it("links what a cook just bought for a dish the same way", async () => {
    w.tick();
    const cooked = await w.call<CookDishResponse>("POST", me("dishes"), RAHUL, {
      name: "Omelette",
      portionsHalf: 2,
      splitMode: "assign",
      newItems: [{ name: "Eggs", quantity: "6", unit: "pcs", priceMinor: 4200, useQuantity: "2" }],
    });
    expect(cooked.status).toBe(201);
    expect(foodOf(w, { id: cooked.body.data.dish.ingredients[0]!.itemId })).toBe("egg");
  });
});

describe("PUT /v1/kitchen/me/food-answers (RC-4): asked once", () => {
  it("keeps the caller's answer for their own pantry and links their items of that name at once — nobody else's", async () => {
    const mine = await addItem(w, RAHUL, null, { name: "Kanda mix", quantity: "1", unit: "kg" });
    const flats = await addItem(w, ANU, w.flat, { name: "Kanda mix", quantity: "1", unit: "kg" });
    const res = await w.call<SetFoodAnswerResponse>("PUT", me("food-answers"), RAHUL, { nameKey: " Kanda MIX ", foodKey: "onion" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ answer: { nameKey: "kanda mix", foodKey: "onion", orgId: null }, linkedItems: 1 });
    expect([foodOf(w, mine), foodOf(w, flats)]).toEqual(["onion", null]);
    // Items of that name added later follow the answer.
    expect(foodOf(w, await addItem(w, RAHUL, null, { name: "Kanda Mix", quantity: "500", unit: "g" }))).toBe("onion");
  });

  it("answers for a group's pantry from anyone who may use its items — not a viewer, not an outsider", async () => {
    const flats = await addItem(w, ANU, w.flat, { name: "Hara pyaaz", quantity: "200", unit: "g" });
    const body = { nameKey: "hara pyaaz", foodKey: "onion", orgId: w.flat.publicId };
    expect((await w.call("PUT", me("food-answers"), VIK, body)).status).toBe(404);
    expect((await w.call("PUT", me("food-answers"), OLU, body)).status).toBe(404);
    expect(foodOf(w, flats)).toBeNull();
    const res = await w.call<SetFoodAnswerResponse>("PUT", me("food-answers"), DEV, body);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ answer: { nameKey: "hara pyaaz", foodKey: "onion", orgId: w.flat.publicId }, linkedItems: 1 });
    expect(foodOf(w, flats)).toBe("onion");
  });

  it("takes 'none of these' as an answer: the items unlink, and the name is never matched again in that pantry", async () => {
    const onions = await addItem(w, ANU, w.flat, { name: "Onions", quantity: "1", unit: "kg" });
    expect(foodOf(w, onions)).toBe("onion");
    const res = await w.call<SetFoodAnswerResponse>("PUT", me("food-answers"), ANU, { nameKey: "onions", foodKey: null, orgId: w.flat.publicId });
    expect(res.body.data).toEqual({ answer: { nameKey: "onions", foodKey: null, orgId: w.flat.publicId }, linkedItems: 1 });
    expect(foodOf(w, onions)).toBeNull();
    expect(foodOf(w, await addItem(w, ANU, w.flat, { name: "Onions", quantity: "1", unit: "kg" }))).toBeNull();
    expect(foodOf(w, await addItem(w, RAHUL, null, { name: "Onions", quantity: "1", unit: "kg" }))).toBe("onion");
  });

  it("refuses a food not on the list, a malformed body and a malformed group", async () => {
    const unknown = await w.call("PUT", me("food-answers"), RAHUL, { nameKey: "kanda", foodKey: "dragonfruit" });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details.fields).toEqual({ foodKey: ['No food "dragonfruit" on the food list'] });
    const bad = await w.call("PUT", me("food-answers"), RAHUL, { nameKey: "", foodKey: "Onion!", orgId: "flat" });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.details.fields as object).sort()).toEqual(["foodKey", "nameKey", "orgId"]);
    expect((await w.call("PUT", me("food-answers"), RAHUL, undefined, {})).status).toBe(422);
    expect((await w.call("GET", me("food-answers"), RAHUL)).status).toBe(405);
  });
});

describe("Always have (RC-4, design §3.4)", () => {
  it("starts with salt and water, saves a list — an empty one too — and keeps it per person", async () => {
    const first = await w.call<AlwaysHaveResponse>("GET", me("always-have"), RAHUL);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({
      foods: [
        { key: "salt", name: "Salt", dimension: "mass", eachG: null, category: "spices", gPerMl: 1.2 },
        { key: "water", name: "Water", dimension: "volume", eachG: null, category: "other", gPerMl: 1 },
      ],
      isDefault: true,
    });
    const saved = await w.call<AlwaysHaveResponse>("PUT", me("always-have"), RAHUL, { foodKeys: ["turmeric", "salt", "garam_masala"] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.foods.map((f) => f.key)).toEqual(["garam_masala", "salt", "turmeric"]);
    expect(saved.body.data.isDefault).toBe(false);
    const emptied = await w.call<AlwaysHaveResponse>("PUT", me("always-have"), RAHUL, { foodKeys: [] });
    expect(emptied.body.data).toEqual({ foods: [], isDefault: false });
    expect((await w.call<AlwaysHaveResponse>("GET", me("always-have"), RAHUL)).body.data).toEqual({ foods: [], isDefault: false });
    expect((await w.call<AlwaysHaveResponse>("GET", me("always-have"), ANU)).body.data.isDefault).toBe(true);
  });

  it("refuses a food not on the list, one twice, too many, and anything but a list", async () => {
    const unknown = await w.call("PUT", me("always-have"), RAHUL, { foodKeys: ["salt", "saffron_threads"] });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details.fields).toEqual({ "foodKeys[1]": ['No food "saffron_threads" on the food list'] });
    expect((await w.call("PUT", me("always-have"), RAHUL, { foodKeys: ["salt", "salt"] })).body.error.details.fields).toEqual({
      "foodKeys[1]": ["Name each food once"],
    });
    expect((await w.call("PUT", me("always-have"), RAHUL, { foodKeys: Array.from({ length: 51 }, () => "salt") })).status).toBe(422);
    expect((await w.call("PUT", me("always-have"), RAHUL, { foodKeys: "salt" })).status).toBe(422);
    // Nothing was saved.
    expect((await w.call<AlwaysHaveResponse>("GET", me("always-have"), RAHUL)).body.data.isDefault).toBe(true);
    expect((await w.call("DELETE", me("always-have"), RAHUL)).status).toBe(405);
  });
});
