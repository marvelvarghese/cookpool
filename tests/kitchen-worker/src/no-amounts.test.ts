// Finish without amounts (RV-7, cookpool-revamp design §5): a cook with no
// ingredients and nothing just bought is a dish that costs ₹0 (or only its
// extras), takes nothing from any pantry and charges no one — and the rest of
// a dish's life works as for any other: claims, shares, finalize, split
// later, cancel and posting. Through the router against real SQLite.

import { MAX_DISH_INGREDIENTS, type DishResponse, type KitchenDish, type PostResponse, type SetDishSharesResponse } from "@saas/contracts/kitchen";
import {
  ANU,
  DEV,
  MEERA,
  RAHUL,
  activity,
  balances,
  count,
  dishPath,
  me,
  split,
  stock,
  world,
  type World,
} from "./split-later-helpers.js";

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.h.close());

const cook = (body: Record<string, unknown>, as = RAHUL, key?: string) =>
  w.call<DishResponse>("POST", me("dishes"), as, body, key ? { "idempotency-key": key } : undefined);

/** Everything a cook could take, move or charge. */
function pantryState() {
  return {
    items: w.h.db.prepare("SELECT id, qty_left_milli, version FROM kitchen_items ORDER BY id").all(),
    moves: count(w, "kitchen_stock_moves"),
    txns: count(w, "kitchen_txns"),
    splits: count(w, "kitchen_txn_splits"),
  };
}

const claim = (as: string, dish: KitchenDish, portionsHalf: number) =>
  w.call<DishResponse>("PUT", dishPath(w.flat, dish, "claims/me"), as, { portionsHalf });
const finalize = (as: string, dish: KitchenDish) =>
  w.call<DishResponse>("POST", dishPath(w.flat, dish, "finalize"), as, undefined, { "idempotency-key": `fin-${dish.id}` });

describe("cooking with no amounts", () => {
  it("saves a ₹0 dish with no ingredients, whether the lists are empty or left out, and takes nothing from any pantry", async () => {
    await stock(w); // Rahul's own pantry and Flat 4B's and the Lunch club's are all stocked
    const before = pantryState();
    for (const [i, lists] of [{}, { ingredients: [], newItems: [] }, { ingredients: [] }].entries()) {
      const res = await cook({ name: "Dal tadka", orgId: null, portionsHalf: 4, splitMode: "assign", ...lists }, RAHUL, `none-${i}`);
      expect(res.status).toBe(201);
      expect(res.body.data.dish).toMatchObject({
        name: "Dal tadka", orgId: null, state: "draft", portions: 2,
        ingredientsMinor: 0, extrasMinor: 0, totalMinor: 0, currency: "INR",
        ingredients: [], owes: [], fromMineMinor: 0, txnId: null,
      });
    }
    expect(count(w, "kitchen_dishes")).toBe(3);
    expect(count(w, "kitchen_dish_ingredients")).toBe(0);
    expect(pantryState()).toEqual(before);
    expect(await balances(w, w.flat, ANU)).toEqual({});
  });

  it("costs only its extras when there are some, paid by the cook", async () => {
    const res = await cook({ name: "Maggi", orgId: null, portionsHalf: 2, splitMode: "assign", extrasMinor: 1500 });
    expect(res.status).toBe(201);
    expect(res.body.data.dish).toMatchObject({ ingredientsMinor: 0, extrasMinor: 1500, totalMinor: 1500, ingredients: [] });
  });

  it("cooks into a group for claims: open, ₹0, and the group's ledger untouched", async () => {
    await stock(w);
    const before = pantryState();
    const res = await cook({ name: "Khichdi", orgId: w.flat.publicId, portionsHalf: 8, splitMode: "claims" });
    expect(res.status).toBe(201);
    expect(res.body.data.dish).toMatchObject({ orgId: w.flat.publicId, state: "open", totalMinor: 0, ingredients: [], owes: [] });
    expect(pantryState()).toEqual(before);
    expect(await activity(w, w.flat, ANU)).toEqual([]);
  });

  it("still refuses more than MAX_DISH_INGREDIENTS lines", async () => {
    const p = await stock(w);
    const ingredients = Array.from({ length: MAX_DISH_INGREDIENTS + 1 }, () => ({ itemId: p.paneer.id, quantity: "1" }));
    const res = await cook({ name: "Too much", orgId: null, portionsHalf: 2, splitMode: "assign", ingredients });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details.fields as Record<string, unknown>)).toContain("ingredients");
    expect(count(w, "kitchen_dishes")).toBe(0);
  });
});

describe("splitting a ₹0 dish", () => {
  it("is claimed and finalized like any dish, and posts nothing: no dish transaction, no balances, no leftovers worth anything", async () => {
    const dish = (await cook({ name: "Khichdi", orgId: w.flat.publicId, portionsHalf: 8, splitMode: "claims" })).body.data.dish;
    for (const [who, halves] of [[ANU, 2], [DEV, 2], [MEERA, 1]] as const) {
      expect((await claim(who, dish, halves)).status).toBe(200);
    }
    const done = await finalize(RAHUL, dish);
    expect(done.status).toBe(200);
    const final = done.body.data.dish;
    expect(final).toMatchObject({ state: "finalized", totalMinor: 0, txnId: null, unclaimedHalf: 3, unclaimedMinor: 0 });
    expect(final.amounts.every((a) => a.owedMinor === 0)).toBe(true);
    expect(final.netting.every((n) => n.netMinor === 0)).toBe(true);
    expect(await activity(w, w.flat, ANU)).toEqual([]);
    expect(await balances(w, w.flat, ANU)).toEqual({});
  });

  it("splits later with a group, by claims or by the cook's own shares, and finalizes to nothing owed", async () => {
    const own = (await cook({ name: "Poha", orgId: null, portionsHalf: 4, splitMode: "assign" })).body.data.dish;
    const opened = await split(w, RAHUL, own, { orgId: w.flat.publicId });
    expect(opened.status).toBe(200);
    expect(opened.body.data.dish).toMatchObject({ state: "open", orgId: w.flat.publicId, totalMinor: 0 });
    expect((await claim(ANU, own, 2)).status).toBe(200);
    expect((await finalize(RAHUL, own)).body.data.dish).toMatchObject({ state: "finalized", txnId: null });

    const assigned = (await cook({ name: "Upma", orgId: null, portionsHalf: 4, splitMode: "assign" })).body.data.dish;
    expect((await split(w, RAHUL, assigned, { orgId: w.flat.publicId, splitMode: "assign" })).status).toBe(200);
    const shares = await w.call<SetDishSharesResponse>("PUT", dishPath(w.flat, assigned, "shares"), RAHUL, {
      shares: [{ subjectId: RAHUL, portionsHalf: 2 }, { subjectId: DEV, portionsHalf: 2 }],
    });
    expect(shares.status).toBe(200);
    expect((await finalize(RAHUL, assigned)).body.data.dish).toMatchObject({ state: "finalized", txnId: null });

    expect(await activity(w, w.flat, ANU)).toEqual([]);
    expect(await balances(w, w.flat, ANU)).toEqual({});
  });

  it("can be canceled, and posted to Community", async () => {
    const posted = (await cook({ name: "Toast", orgId: null, portionsHalf: 2, splitMode: "assign" })).body.data.dish;
    const post = await w.call<PostResponse>("POST", me("posts"), RAHUL, { dishId: posted.id, audience: "me", show: { ate: true } });
    expect(post.status).toBe(201);

    const canceled = (await cook({ name: "Tea", orgId: null, portionsHalf: 2, splitMode: "assign" })).body.data.dish;
    const res = await w.call<DishResponse>("POST", me(`dishes/${canceled.id}/cancel`), RAHUL);
    expect(res.status).toBe(200);
    expect(res.body.data.dish.state).toBe("canceled");
    expect(count(w, "kitchen_stock_moves")).toBe(0);
    expect(count(w, "kitchen_txns")).toBe(0);
  });
});
