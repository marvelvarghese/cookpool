// Always have per pantry and the shopping list (cookpool-revamp RV-21,
// migration 600) through the router: your own staples (the default salt and
// water, written out on the first change; Cook now's list is the same rows),
// a group's (members read them, item adders change them, a viewer and an
// outsider can't), Bought — a group's posts one expense split equally among
// its current members, exact to the minor unit, once per Idempotency-Key —
// and the hand-added list lines with their amounts.

import type {
  AlwaysHaveResponse,
  ClearShoppingResponse,
  KitchenTxn,
  ShoppingItemResponse,
  StapleBoughtResponse,
  StapleResponse,
  StaplePantry,
  StaplesResponse,
} from "@saas/contracts/kitchen";
import { ANU, DEV, OLU, RAHUL, VIK, groupPath, me, world, type World } from "./recipes-helpers.js";

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.h.close());

const mine = async (as: string) => (await w.call<StaplesResponse>("GET", me("staples"), as)).body.data.pantries;
const flatOf = (pantries: StaplePantry[]) => pantries.find((p) => p.owner.kind === "group" && p.owner.name === "Flat 4B")!;
const add = (as: string, url: string, body: unknown) => w.call<StapleResponse>("POST", url, as, body);
const idem = (key: string) => ({ "idempotency-key": key });

describe("your own staples (RV-21)", () => {
  it("reads the default salt and water until the first change writes them out, under the same ids", async () => {
    const first = await mine(RAHUL);
    expect(first[0]).toMatchObject({ owner: { kind: "personal" }, isSet: false, splitAmong: [], items: [], currency: "INR" });
    expect(first[0]!.staples.map((s) => [s.name, s.foodKey, s.status])).toEqual([
      ["Salt", "salt", "ok"],
      ["Water", "water", "ok"],
    ]);
    const salt = first[0]!.staples[0]!;
    // A second read gives the same ids.
    expect((await mine(RAHUL))[0]!.staples[0]!.id).toBe(salt.id);

    const low = await w.call<StapleResponse>("PATCH", me(`staples/${salt.id}`), RAHUL, { status: "low" });
    expect(low.status).toBe(200);
    expect(low.body.data.staple).toMatchObject({ id: salt.id, name: "Salt", status: "low" });
    const after = (await mine(RAHUL))[0]!;
    expect(after.isSet).toBe(true);
    expect(after.staples.map((s) => [s.name, s.status])).toEqual([
      ["Salt", "low"],
      ["Water", "ok"],
    ]);
    // Nobody else's list moved.
    expect((await mine(ANU))[0]!.isSet).toBe(false);
  });

  it("is Cook now's Always have: an added food counts, a free name doesn't, and the PUT writes the same rows", async () => {
    const coffee = await add(RAHUL, me("staples"), { name: "Coffee" });
    expect(coffee.status).toBe(201);
    expect(coffee.body.data.staple).toMatchObject({ name: "Coffee", foodKey: "coffee_powder", status: "ok", lastPriceMinor: null });
    const soap = await add(RAHUL, me("staples"), { name: "Dish soap" });
    expect(soap.body.data.staple.foodKey).toBeNull();
    const list = await w.call<AlwaysHaveResponse>("GET", me("always-have"), RAHUL);
    expect(list.body.data.foods.map((f) => f.key)).toEqual(["coffee_powder", "salt", "water"]);
    expect(list.body.data.isDefault).toBe(false);

    const put = await w.call<AlwaysHaveResponse>("PUT", me("always-have"), RAHUL, { foodKeys: ["salt", "sugar"] });
    expect(put.body.data.foods.map((f) => f.key)).toEqual(["salt", "sugar"]);
    expect((await mine(RAHUL))[0]!.staples.map((s) => s.name)).toEqual(["Dish soap", "Salt", "Sugar"]);
  });

  it("refuses the same name twice, an unknown food and a bad status; removes with the row back for Undo", async () => {
    await add(RAHUL, me("staples"), { name: "Tea" });
    const again = await add(RAHUL, me("staples"), { name: " tea " });
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe("already_listed");
    expect((await add(RAHUL, me("staples"), { name: "X", foodKey: "dragonfruit" })).status).toBe(422);
    const tea = (await mine(RAHUL))[0]!.staples.find((s) => s.name === "Tea")!;
    expect((await w.call("PATCH", me(`staples/${tea.id}`), RAHUL, { status: "gone" })).status).toBe(422);
    const removed = await w.call<StapleResponse>("DELETE", me(`staples/${tea.id}`), RAHUL);
    expect(removed.body.data.staple).toMatchObject({ id: tea.id, name: "Tea" });
    expect((await w.call("DELETE", me(`staples/${tea.id}`), RAHUL)).status).toBe(404);
    // Someone else's id is not found in your pantry.
    expect((await w.call("PATCH", me(`staples/${tea.id}`), ANU, { status: "low" })).status).toBe(404);
  });

  it("Bought records the price and amount, nothing split, and the list's own amount goes", async () => {
    const coffee = (await add(RAHUL, me("staples"), { name: "Coffee" })).body.data.staple;
    await w.call("PATCH", me(`staples/${coffee.id}`), RAHUL, { status: "out", wantQtyMilli: 500_000, wantUnit: "g" });
    const got = await w.call<StapleBoughtResponse>("POST", me(`staples/${coffee.id}/bought`), RAHUL, { priceMinor: 32000, qtyMilli: 250_000, unit: "g" });
    expect(got.status).toBe(200);
    expect(got.body.data.txn).toBeNull();
    expect(got.body.data.staple).toMatchObject({ status: "ok", lastPriceMinor: 32000, currency: "INR", lastQtyMilli: 250_000, lastUnit: "g", wantQtyMilli: null, wantUnit: null });
    expect(got.body.data.staple.boughtAt).not.toBeNull();
  });
});

describe("a group's staples (RV-21): members only", () => {
  it("are read by every member, changed by those who add items, and hidden from outsiders", async () => {
    const salt = await add(ANU, groupPath(w.flat, "staples"), { name: "Salt" });
    expect(salt.status).toBe(201);
    expect((await add(VIK, groupPath(w.flat, "staples"), { name: "Tea" })).status).toBe(404);
    expect((await add(OLU, groupPath(w.flat, "staples"), { name: "Tea" })).status).toBe(404);
    const id = salt.body.data.staple.id;
    expect((await w.call("PATCH", groupPath(w.flat, `staples/${id}`), VIK, { status: "low" })).status).toBe(404);
    expect((await w.call("PATCH", groupPath(w.flat, `staples/${id}`), OLU, { status: "low" })).status).toBe(404);
    expect((await w.call("PATCH", groupPath(w.flat, `staples/${id}`), DEV, { status: "low" })).status).toBe(200);

    const viewer = await w.call<StaplePantry>("GET", groupPath(w.flat, "staples"), VIK);
    expect(viewer.status).toBe(200);
    expect(viewer.body.data.staples.map((s) => [s.name, s.status])).toEqual([["Salt", "low"]]);
    expect(viewer.body.data.splitAmong.sort()).toEqual([ANU, DEV, RAHUL, VIK].sort());
    expect((await w.call("GET", groupPath(w.flat, "staples"), OLU)).status).toBe(404);

    // The cross-pantry read lists your own, then each group by name, each with its own rows.
    const all = await mine(RAHUL);
    expect(all.map((p) => (p.owner.kind === "group" ? p.owner.name : "mine"))).toEqual(["mine", "Flat 4B", "Lunch club"]);
    expect(flatOf(all).staples.map((s) => s.name)).toEqual(["Salt"]);
    expect(all[2]!.staples).toEqual([]);
    expect((await mine(OLU)).some((p) => p.owner.kind === "group" && p.owner.name === "Flat 4B")).toBe(false);
  });

  it("Bought posts one expense split equally among the current members, exact to the paisa, and sets it back to ok", async () => {
    const tea = (await add(ANU, groupPath(w.flat, "staples"), { name: "Tea" })).body.data.staple;
    await w.call("PATCH", groupPath(w.flat, `staples/${tea.id}`), ANU, { status: "out" });
    // ₹100.00 among four: largest remainder, so the parts add up.
    const got = await w.call<StapleBoughtResponse>("POST", groupPath(w.flat, `staples/${tea.id}/bought`), RAHUL, { priceMinor: 10001, qtyMilli: 250_000, unit: "g" }, idem("tea-1"));
    expect(got.status).toBe(201);
    const txn = got.body.data.txn as KitchenTxn;
    expect(txn).toMatchObject({ kind: "expense", title: "Tea", totalMinor: 10001, currency: "INR", createdBy: RAHUL });
    const owed = txn.splits.map((s) => s.owedMinor);
    expect(owed.reduce((a, b) => a + b, 0)).toBe(10001);
    expect([...owed].sort((a, b) => b - a)).toEqual([2501, 2500, 2500, 2500]);
    expect(txn.splits.map((s) => s.subjectId).sort()).toEqual([ANU, DEV, RAHUL, VIK].sort());
    expect(txn.splits.find((s) => s.subjectId === RAHUL)!.paidMinor).toBe(10001);
    expect(got.body.data.staple).toMatchObject({ status: "ok", lastPriceMinor: 10001, currency: "INR", lastQtyMilli: 250_000, lastUnit: "g" });

    // The same key again posts nothing more; another key posts another bill.
    const replay = await w.call<StapleBoughtResponse>("POST", groupPath(w.flat, `staples/${tea.id}/bought`), RAHUL, { priceMinor: 10001 }, idem("tea-1"));
    expect(replay.status).toBe(201);
    expect(replay.body.data.txn!.id).toBe(txn.id);
    const count = () => (w.h.db.prepare("SELECT count(*) AS n FROM kitchen_txns WHERE title = 'Tea'").get() as { n: number }).n;
    expect(count()).toBe(1);

    // A member who left is no longer in the split.
    w.h.revoke(VIK, w.flat);
    const second = await w.call<StapleBoughtResponse>("POST", groupPath(w.flat, `staples/${tea.id}/bought`), DEV, { priceMinor: 18000 }, idem("tea-2"));
    expect(second.body.data.txn!.splits.map((s) => s.owedMinor)).toEqual([6000, 6000, 6000]);
    expect(count()).toBe(2);
  });

  it("Bought puts the bill on Paid by (RV-22) when it names a member, and refuses anyone else", async () => {
    const tea = (await add(ANU, groupPath(w.flat, "staples"), { name: "Tea" })).body.data.staple;
    const url = groupPath(w.flat, `staples/${tea.id}/bought`);
    const got = await w.call<StapleBoughtResponse>("POST", url, RAHUL, { priceMinor: 18000, paidBy: ANU }, idem("paid-1"));
    expect(got.status).toBe(201);
    const txn = got.body.data.txn as KitchenTxn;
    expect(txn.createdBy).toBe(RAHUL);
    expect(txn.splits.find((s) => s.subjectId === ANU)!.paidMinor).toBe(18000);
    expect(txn.splits.find((s) => s.subjectId === RAHUL)!.paidMinor).toBe(0);
    const outsider = await w.call("POST", url, RAHUL, { priceMinor: 18000, paidBy: OLU }, idem("paid-2"));
    expect(outsider.status).toBe(422);
    expect(outsider.body.error.details).toMatchObject({ reason: "not_in_group", subjectIds: [OLU] });
    // Your own Always have names nobody.
    const coffee = (await add(RAHUL, me("staples"), { name: "Coffee" })).body.data.staple;
    const mineBad = await w.call("POST", me(`staples/${coffee.id}/bought`), RAHUL, { priceMinor: 100, paidBy: ANU });
    expect([mineBad.status, Object.keys(mineBad.body.error.details.fields as object)]).toEqual([422, ["paidBy"]]);
    expect((w.h.db.prepare("SELECT count(*) AS n FROM kitchen_txns").get() as { n: number }).n).toBe(1);
  });

  it("refuses a free Bought, another currency, a viewer and an outsider; writes nothing then", async () => {
    const oil = (await add(ANU, groupPath(w.flat, "staples"), { name: "Cooking oil" })).body.data.staple;
    await w.call("PATCH", groupPath(w.flat, `staples/${oil.id}`), ANU, { status: "low" });
    const url = groupPath(w.flat, `staples/${oil.id}/bought`);
    expect((await w.call("POST", url, ANU, { priceMinor: 0 }, idem("a"))).status).toBe(422);
    const usd = await w.call("POST", url, ANU, { priceMinor: 100, currency: "USD" }, idem("b"));
    expect(usd.status).toBe(422);
    expect(usd.body.error.details.reason).toBe("currency_mismatch");
    expect((await w.call("POST", url, VIK, { priceMinor: 100 }, idem("c"))).status).toBe(404);
    expect((await w.call("POST", url, OLU, { priceMinor: 100 }, idem("d"))).status).toBe(404);
    expect((await w.call("POST", groupPath(w.flat, "staples/stp_00000000000000000000000000000000/bought"), ANU, { priceMinor: 100 }, idem("e"))).status).toBe(404);
    const now = (await w.call<StaplePantry>("GET", groupPath(w.flat, "staples"), ANU)).body.data.staples[0]!;
    expect(now).toMatchObject({ status: "low", lastPriceMinor: null });
    expect((w.h.db.prepare("SELECT count(*) AS n FROM kitchen_txns").get() as { n: number }).n).toBe(0);
  });
});

describe("hand-added list lines (RV-21)", () => {
  it("adds with an optional amount, changes it, refuses the same name twice, and removes", async () => {
    const onions = await w.call<ShoppingItemResponse>("POST", groupPath(w.flat, "shopping"), DEV, { name: "Onions", qtyMilli: 1_000_000, unit: "kg" });
    expect(onions.status).toBe(201);
    expect(onions.body.data.item).toMatchObject({ name: "Onions", qtyMilli: 1_000_000, unit: "kg", addedBy: DEV });
    const lemons = await w.call<ShoppingItemResponse>("POST", me("shopping"), RAHUL, { name: "Lemons" });
    expect(lemons.body.data.item).toMatchObject({ qtyMilli: null, unit: null });
    expect((await w.call("POST", me("shopping"), RAHUL, { name: "lemons" })).status).toBe(409);
    expect((await w.call("POST", me("shopping"), RAHUL, { name: "Mint", qtyMilli: 5 })).status).toBe(422);
    expect((await w.call("POST", groupPath(w.flat, "shopping"), VIK, { name: "Mint" })).status).toBe(404);

    const id = onions.body.data.item.id;
    const two = await w.call<ShoppingItemResponse>("PATCH", groupPath(w.flat, `shopping/${id}`), ANU, { qtyMilli: 2_000_000, unit: "kg" });
    expect(two.body.data.item.qtyMilli).toBe(2_000_000);
    const all = await mine(RAHUL);
    expect(all[0]!.items.map((i) => i.name)).toEqual(["Lemons"]);
    expect(flatOf(all).items.map((i) => [i.name, i.qtyMilli])).toEqual([["Onions", 2_000_000]]);

    expect((await w.call("DELETE", groupPath(w.flat, `shopping/${id}`), OLU)).status).toBe(404);
    expect((await w.call("DELETE", groupPath(w.flat, `shopping/${id}`), ANU)).status).toBe(200);
    expect(flatOf(await mine(RAHUL)).items).toEqual([]);
  });
});

describe("clearing the list when a run is saved (RV-21)", () => {
  it("deletes the hand-added lines and sets the staples back to ok, in that pantry only, with nothing split", async () => {
    const tea = (await add(ANU, groupPath(w.flat, "staples"), { name: "Tea" })).body.data.staple;
    await w.call("PATCH", groupPath(w.flat, `staples/${tea.id}`), ANU, { status: "out" });
    const onions = (await w.call<ShoppingItemResponse>("POST", groupPath(w.flat, "shopping"), DEV, { name: "Onions" })).body.data.item;
    const lemons = (await w.call<ShoppingItemResponse>("POST", me("shopping"), RAHUL, { name: "Lemons" })).body.data.item;
    const url = groupPath(w.flat, "shopping/clear");
    expect((await w.call("POST", url, VIK, { itemIds: [onions.id] })).status).toBe(404);
    expect((await w.call("POST", url, ANU, {})).status).toBe(422);
    expect((await w.call("POST", url, ANU, { itemIds: ["stp_x"] })).status).toBe(422);
    const cleared = await w.call<ClearShoppingResponse>("POST", url, ANU, { itemIds: [onions.id, lemons.id], stapleIds: [tea.id] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.items.map((i) => i.name)).toEqual(["Onions"]);
    expect(cleared.body.data.staples.map((s) => [s.name, s.status, s.lastPriceMinor])).toEqual([["Tea", "ok", null]]);
    const all = await mine(RAHUL);
    expect(flatOf(all).items).toEqual([]);
    expect(all[0]!.items.map((i) => i.name)).toEqual(["Lemons"]);
    expect((w.h.db.prepare("SELECT count(*) AS n FROM kitchen_txns").get() as { n: number }).n).toBe(0);
    expect((await w.call<ClearShoppingResponse>("POST", me("shopping/clear"), RAHUL, { itemIds: [lemons.id] })).body.data.items).toHaveLength(1);
  });
});

describe("before migration 600 has run (the worker deploys beside db-migrate)", () => {
  it("Cook now's Always have falls back to the old list, and the staple routes answer 503", async () => {
    await w.call("PUT", me("always-have"), RAHUL, { foodKeys: ["salt", "sugar"] });
    w.h.db.exec("DROP TABLE kitchen_staples; DROP TABLE kitchen_shopping_items;");
    const list = await w.call<AlwaysHaveResponse>("GET", me("always-have"), RAHUL);
    expect(list.status).toBe(200);
    expect(list.body.data.foods.map((f) => f.key)).toEqual(["salt", "sugar"]);
    const put = await w.call<AlwaysHaveResponse>("PUT", me("always-have"), RAHUL, { foodKeys: ["water"] });
    expect(put.status).toBe(200);
    expect(put.body.data.foods.map((f) => f.key)).toEqual(["water"]);
    expect((await w.call("GET", me("cook-now"), RAHUL)).status).toBe(200);
    for (const [method, url, body] of [
      ["GET", me("staples"), undefined],
      ["POST", me("staples"), { name: "Tea" }],
      ["POST", me("shopping"), { name: "Mint" }],
      ["GET", groupPath(w.flat, "staples"), undefined],
      ["POST", groupPath(w.flat, "shopping/clear"), { itemIds: ["shp_00000000000000000000000000000000"] }],
    ] as const) {
      const res = await w.call(method, url, RAHUL, body);
      expect([url, res.status, res.body.error?.code]).toEqual([url, 503, "internal_error"]); // the worker's pinned 503 (`unavailable()`)
    }
  });
});
