// Receipts (cookpool-ai AI-3, design §3): matching the lines read to the
// caller, on the server and with no model — their purchases (restock names
// and item history) and the food list. Sure only when the name and the kind
// of unit match and the price is plausible (±50% of last time's for the same
// amount, or no history but exactly a food); else check with a reason. The
// pantry is the name's last purchase's (one the caller can add to), else
// their most-used pantry for the food's kind; non-food lines are not_food.

import { AI_RECEIPT_NOT_FOOD } from "@saas/contracts/kitchen";
import { KIRAN, MEERA, NOW, RAHUL, aiWorld, groupPath, type AiWorld } from "./ai-helpers.js";
import { line, scan, type ModelLine } from "./ai-receipt-helpers.js";

const MINE = { kind: "personal", name: expect.any(String) };
const groupRef = (g: AiWorld["flat"]) => ({ kind: "group", orgId: g.publicId, slug: g.slug, name: g.name });

async function one(w: AiWorld, l: ModelLine) {
  const data = await scan(w, { lines: [l] });
  return data.lines[0]!;
}

describe("receipts: matching to the caller's history (AI-3)", () => {
  it("a name bought before, same kind of unit, price within ±50%: sure, in last time's pantry, from last time's item", async () => {
    const w = aiWorld();
    const paneer = await w.addMine({ name: "Paneer", quantity: "200", unit: "g", priceMinor: 9000 });
    expect(await one(w, line("MLK PNR 200G", "Paneer", 200, "g", 9500))).toEqual({
      text: "MLK PNR 200G",
      name: "Paneer",
      foodId: "paneer",
      quantity: 200,
      unit: "g",
      priceMinor: 9500,
      pantry: MINE,
      fromItemId: paneer.id,
      confidence: "sure",
    });
    w.close();
  });

  it("compares the price for the same amount: 400 g at 2× last time's 200 g is sure; far above is check", async () => {
    const w = aiWorld();
    await w.addMine({ name: "Paneer", quantity: "200", unit: "g", priceMinor: 9000 });
    expect(await one(w, line("PANEER 400G", "Paneer", 400, "g", 17000))).toMatchObject({ confidence: "sure" });
    // ±50%: 27000 is the most for 400 g; 13500 the least.
    expect(await one(w, line("PANEER 400G", "Paneer", 400, "g", 27000))).toMatchObject({ confidence: "sure" });
    expect(await one(w, line("PANEER 400G", "Paneer", 400, "g", 9000))).toMatchObject({ confidence: "sure" });
    expect(await one(w, line("PANEER 400G", "Paneer", 400, "g", 27001))).toMatchObject({
      confidence: "check",
      reason: "price far from last time's",
    });
    expect(await one(w, line("PANEER 400G", "Paneer", 400, "g", 8999))).toMatchObject({ confidence: "check" });
    w.close();
  });

  it("compares across units of the same kind: 1 L against last time's 1000 ml", async () => {
    const w = aiWorld();
    const milk = await w.addTo(w.flat, { name: "Milk", quantity: "1000", unit: "ml", priceMinor: 6800 });
    expect(await one(w, line("AMUL TAAZA 1L", "Milk", 1, "L", 7000))).toMatchObject({
      name: "Milk",
      pantry: groupRef(w.flat),
      fromItemId: milk.id,
      confidence: "sure",
    });
    w.close();
  });

  it("another kind of unit than last time: check, still in last time's pantry", async () => {
    const w = aiWorld();
    const milk = await w.addTo(w.flat, { name: "Milk", quantity: "1000", unit: "ml", priceMinor: 6800 });
    expect(await one(w, line("MILK PKT 2", "Milk", 2, "pcs", 13600))).toMatchObject({
      pantry: groupRef(w.flat),
      fromItemId: milk.id,
      confidence: "check",
      reason: "bought in ml before",
    });
    w.close();
  });

  it("names match folded (case, plural) and by food: “Pyaz” is last time's “Onions”", async () => {
    const w = aiWorld();
    const onions = await w.addTo(w.flat, { name: "Onions", quantity: "1", unit: "kg", priceMinor: 4000, category: "Veg" });
    expect(await one(w, line("PYAZ 2KG", "Pyaz", 2, "kg", 9000))).toMatchObject({
      name: "Onions",
      foodId: "onion",
      pantry: groupRef(w.flat),
      fromItemId: onions.id,
      confidence: "sure",
    });
    expect(await one(w, line("ONION 1KG", "onion", 1, "kg", 4000))).toMatchObject({ name: "Onions", fromItemId: onions.id, confidence: "sure" });
    w.close();
  });

  it("the newest purchase of the name decides the pantry", async () => {
    let clock = new Date(NOW.getTime() - 3 * 86_400_000);
    const w = aiWorld({ now: () => clock });
    await w.addTo(w.lunch, { name: "Rice", quantity: "5", unit: "kg", priceMinor: 40000, category: "Grains" });
    clock = NOW;
    const mine = await w.addMine({ name: "Rice", quantity: "1", unit: "kg", priceMinor: 8000, category: "Grains" });
    expect(await one(w, line("SONA MASOORI 5KG", "Rice", 5, "kg", 41000))).toMatchObject({
      pantry: MINE,
      fromItemId: mine.id,
      confidence: "sure",
    });
    w.close();
  });

  it("last bought where the caller cannot add (a viewer): their most-used pantry for that kind, still from last time's item", async () => {
    const w = aiWorld();
    const saffron = await w.addTo(w.books, { name: "Saffron", quantity: "1", unit: "g", priceMinor: 30000, category: "Spices" }, MEERA);
    await w.addTo(w.lunch, { name: "Salt", quantity: "1", unit: "kg", priceMinor: 2800, category: "Spices" });
    await w.addTo(w.lunch, { name: "Jeera", quantity: "100", unit: "g", priceMinor: 5000, category: "Spices" });
    await w.addMine({ name: "Haldi", quantity: "100", unit: "g", priceMinor: 4000, category: "Spices" });
    expect(await one(w, line("KESAR 1G", "Saffron", 1, "g", 32000))).toMatchObject({
      pantry: groupRef(w.lunch),
      fromItemId: saffron.id,
      confidence: "sure",
    });
    w.close();
  });
});

describe("receipts: no history (AI-3)", () => {
  it("exactly a food, with a unit of its kind: sure, in the caller's most-used pantry for the food's kind", async () => {
    const w = aiWorld();
    await w.addTo(w.flat, { name: "Onions", quantity: "1", unit: "kg", priceMinor: 4000, category: "Veg" });
    await w.addTo(w.flat, { name: "Carrots", quantity: "1", unit: "kg", priceMinor: 6000, category: "Veg" });
    await w.addMine({ name: "Bhindi", quantity: "500", unit: "g", priceMinor: 3000, category: "Veg" });
    const l = await one(w, line("TOMATO 1KG", "Tomato", 1, "kg", 3000));
    expect(l).toMatchObject({ name: "Tomato", foodId: "tomato", pantry: groupRef(w.flat), confidence: "sure" });
    expect(l.fromItemId).toBeUndefined();
    w.close();
  });

  it("a counted food may be weighed, and a weighed one counted (it has a piece weight)", async () => {
    const w = aiWorld();
    expect(await one(w, line("TOMATO 6", "Tomato", 6, "pcs", 3000))).toMatchObject({ confidence: "sure", pantry: MINE });
    expect(await one(w, line("EGGS 1KG", "Eggs", 1, "kg", 9000))).toMatchObject({ foodId: "egg", confidence: "sure" });
    w.close();
  });

  it("a food in a unit of another kind (milk in pcs): check", async () => {
    const w = aiWorld();
    expect(await one(w, line("MILK 2", "Milk", 2, "pcs", 6000))).toMatchObject({
      foodId: "milk",
      confidence: "check",
      reason: "Milk isn't counted in pcs",
    });
    w.close();
  });

  it("not a food and never bought: check, “not sure what … is”, in their own pantry", async () => {
    const w = aiWorld();
    const l = await one(w, line("MLK PNR XYZ", null, 1, "pcs", 5000));
    expect(l).toMatchObject({ text: "MLK PNR XYZ", confidence: "check", reason: "not sure what MLK PNR XYZ is", pantry: MINE });
    expect(l.foodId).toBeUndefined();
    expect(l.fromItemId).toBeUndefined();
    w.close();
  });

  it("the food is found from the printed text when the name reads nothing", async () => {
    const w = aiWorld();
    expect(await one(w, line("Paneer", null, 200, "g", 9000))).toMatchObject({ name: "Paneer", foodId: "paneer", confidence: "sure" });
    w.close();
  });

  it("bought before with no price: like no history — sure on an exact food, else check", async () => {
    const w = aiWorld();
    await w.addMine({ name: "Curd", quantity: "400", unit: "g", priceMinor: 0 });
    await w.addMine({ name: "Gift box", quantity: "1", unit: "pcs", priceMinor: 0 });
    expect(await one(w, line("DAHI 400G", "Curd", 400, "g", 4000))).toMatchObject({ foodId: "curd", confidence: "sure" });
    expect(await one(w, line("GIFT BOX", "Gift box", 1, "pcs", 50000))).toMatchObject({ confidence: "check", reason: "no price from before" });
    w.close();
  });
});

describe("receipts: non-food lines, currency and sums (AI-3)", () => {
  it("a non-food line is check, not_food, with no pantry, food or item — and out of sumMinor", async () => {
    const w = aiWorld();
    await w.addMine({ name: "Surf Excel", quantity: "1", unit: "kg", priceMinor: 14600 });
    const data = await scan(w, {
      total: 23600,
      lines: [line("SURF EXCEL 1KG", "Detergent", 1, "kg", 14600, false), line("PANEER 200G", "Paneer", 200, "g", 9000)],
    });
    expect(data.lines[0]).toEqual({
      text: "SURF EXCEL 1KG",
      name: "Detergent",
      quantity: 1,
      unit: "kg",
      priceMinor: 14600,
      confidence: "check",
      reason: AI_RECEIPT_NOT_FOOD,
    });
    expect(data.sumMinor).toBe(9000);
    expect(data.totalMatches).toBe(true);
    w.close();
  });

  it("the currency is the chosen pantries': a group's own currency", async () => {
    const w = aiWorld();
    expect((await w.call("PATCH", groupPath(w.lunch, "settings"), KIRAN, { currency: "USD" })).status).toBe(200);
    await w.addTo(w.lunch, { name: "Rice", quantity: "1", unit: "kg", priceMinor: 300, category: "Grains" });
    const data = await scan(w, { lines: [line("RICE 1KG", "Rice", 1, "kg", 320)] });
    expect(data.currency).toBe("USD");
    expect(data.lines[0]!.pantry).toEqual(groupRef(w.lunch));
    w.close();
  });

  it("nothing chosen, or the caller's own pantry: INR", async () => {
    const w = aiWorld();
    expect((await scan(w, { lines: [] })).currency).toBe("INR");
    expect((await scan(w, { lines: [line("PANEER 200G", "Paneer", 200, "g", 9000)] })).currency).toBe("INR");
    w.close();
  });

  it("matching reads only the caller's pantries: another person's own items are not history", async () => {
    const w = aiWorld();
    await w.call("POST", "/v1/kitchen/me/items", KIRAN, { name: "Ghee", category: "Dairy", quantity: "1", unit: "L", priceMinor: 60000 });
    const l = await one(w, line("GHEE 1L", "Ghee", 1, "L", 65000));
    expect(l.fromItemId).toBeUndefined();
    expect(l.pantry).toEqual(MINE);
    expect(RAHUL).toBe("usr_rahul");
    w.close();
  });
});
