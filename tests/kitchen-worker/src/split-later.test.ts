// Cooked, then split later (Cookpool CM-8, cookpool-community design §2a),
// through the router against real SQLite with every migration applied:
// finishing a cook as the cook's own (group items charged as uses, no dish
// transaction), splitting it with a group later — open for Who ate, then
// finalized into exactly the dish transaction and balances a dish cooked into
// the group has — every refusal (nothing written), and posting any finished
// dish before or after a split, with servings for `ate`.

import type { DishResponse, KitchenDish, PostResponse, SetDishSharesResponse } from "@saas/contracts/kitchen";
import { newGroup } from "./harness.js";
import {
  ANU,
  DEV,
  KIRAN,
  MEERA,
  NOW,
  RAHUL,
  activity,
  balances,
  cookOwn,
  cookWorkedExample,
  dishPath,
  groupPath,
  me,
  split,
  world,
  written,
  type World,
} from "./split-later-helpers.js";

const LATER = new Date("2026-11-02T20:00:00.000Z");

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.h.close());

const claim = (as: string, dish: KitchenDish, portionsHalf: number) =>
  w.call<DishResponse>("PUT", dishPath(w.flat, dish, "claims/me"), as, { portionsHalf });
const finalize = (as: string, dish: KitchenDish) =>
  w.call<DishResponse>("POST", dishPath(w.flat, dish, "finalize"), as, undefined, { "idempotency-key": `fin-${dish.id}` });
const dishTxns = async (as: string) => (await activity(w, w.flat, as)).filter((t) => t.kind === "dish");

describe("finishing a cook without a group", () => {
  it("saves the dish as the cook's own, takes group pantry items and charges them to the cook as uses — and posts no dish transaction", async () => {
    const dish = await cookWorkedExample(w, "own");
    expect(dish).toMatchObject({
      orgId: null, state: "draft", splitMode: "assign", totalMinor: 21100, portionsHalf: 8, splitAt: null, txnId: null,
    });
    // The cook owes each buyer for what they took, in the buyer's group, as cooking into a group does.
    expect(dish.owes).toEqual([
      { orgId: w.flat.publicId, buyerId: ANU, amountMinor: 1200 },
      { orgId: w.flat.publicId, buyerId: DEV, amountMinor: 700 },
      { orgId: w.lunch.publicId, buyerId: KIRAN, amountMinor: 2400 },
    ]);
    expect(await balances(w, w.flat, ANU)).toEqual({ [ANU]: 1200, [DEV]: 700, [RAHUL]: -1900 });
    expect(await balances(w, w.lunch, KIRAN)).toEqual({ [KIRAN]: 2400, [RAHUL]: -2400 });
    expect((await activity(w, w.flat, ANU)).map((t) => [t.kind, t.totalMinor])).toEqual([["use", 1900]]);
    expect(await dishTxns(ANU)).toEqual([]);
    // The group it took from sees its own part, and the dish is no one's but the cook's.
    expect((await w.call<DishResponse>("GET", me(`dishes/${dish.id}`), ANU)).status).toBe(404);
  });
});

/** The dish transaction and every balance after Rahul's worked example is claimed and finalized, cooked `how`. */
async function workedExampleOutcome(how: "group" | "split later") {
  let dish = await cookWorkedExample(w, how === "group" ? "group" : "own");
  if (how === "split later") {
    const res = await split(w, RAHUL, dish, { orgId: w.flat.publicId }, "split-paneer");
    expect(res.status).toBe(200);
    dish = res.body.data.dish;
  }
  // You 1½, Anu 1, Dev 1, Meera ½.
  for (const [who, halves] of [[MEERA, 1], [ANU, 2], [RAHUL, 3], [DEV, 2]] as const) {
    expect((await claim(who, dish, halves)).status).toBe(200);
  }
  // Nothing has moved for the dish itself until it is finalized.
  expect(await dishTxns(MEERA)).toEqual([]);
  expect(await balances(w, w.flat, ANU)).toEqual({ [ANU]: 1200, [DEV]: 700, [RAHUL]: -1900 });
  w.clock = LATER;
  const done = await finalize(RAHUL, dish);
  expect(done.status).toBe(200);
  const [txn] = await dishTxns(MEERA);
  return {
    dish: done.body.data.dish,
    txn: { title: txn!.title, totalMinor: txn!.totalMinor, currency: txn!.currency, splits: txn!.splits, createdBy: txn!.createdBy },
    flat: await balances(w, w.flat, MEERA),
    lunch: await balances(w, w.lunch, KIRAN),
  };
}

describe("splitting it later", () => {
  it("puts it where a dish cooked into the group is, and finalizing posts the same dish transaction and balances", async () => {
    const later = await workedExampleOutcome("split later");
    w.h.close();
    w = world();
    const cookedIn = await workedExampleOutcome("group");

    expect(later.txn).toEqual(cookedIn.txn);
    expect(later.flat).toEqual(cookedIn.flat);
    expect(later.lunch).toEqual(cookedIn.lunch);
    // design.md §3's numbers, to the paisa.
    expect(later.flat).toEqual({ [RAHUL]: 11287, [ANU]: -4075, [DEV]: -4575, [MEERA]: -2637 });
    expect(later.lunch).toEqual({ [KIRAN]: 2400, [RAHUL]: -2400 });
    expect(later.txn).toMatchObject({ totalMinor: 21100, createdBy: RAHUL });
    for (const field of ["state", "totalMinor", "amounts", "netting", "unclaimedHalf", "leftoverItemId"] as const) {
      expect(later.dish[field]).toEqual(cookedIn.dish[field]);
    }
    expect(later.dish.splitAt).toBe(NOW.toISOString());
    expect(cookedIn.dish.splitAt).toBeNull();
  });

  it("answers the dish open for claims in the group, keeps its money as cooked, tells the group, and audits kitchen.dish.split there", async () => {
    w.h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
    w.h.profile(DEV, { displayName: "Dev", email: "dev@example.com" });
    w.h.profile(RAHUL, { displayName: "Rahul", email: "rahul@example.com" });
    const dish = await cookWorkedExample(w, "own");
    const before = { flat: await balances(w, w.flat, ANU), lunch: await balances(w, w.lunch, KIRAN) };
    w.clock = LATER;
    const res = await split(w, RAHUL, dish, { orgId: w.flat.publicId });
    expect(res.status).toBe(200);
    const open = res.body.data.dish;
    expect(open).toMatchObject({
      id: dish.id, orgId: w.flat.publicId, state: "open", splitMode: "claims", splitAt: LATER.toISOString(),
      cookedAt: NOW.toISOString(), totalMinor: 21100, ingredientsMinor: dish.ingredientsMinor, extrasMinor: 1500,
      currency: dish.currency, txnId: null, finalizedAt: null, owes: dish.owes,
    });
    // Nothing moved: the uses stand as cooked, and there is no dish transaction yet.
    expect({ flat: await balances(w, w.flat, ANU), lunch: await balances(w, w.lunch, KIRAN) }).toEqual(before);
    expect(await dishTxns(ANU)).toEqual([]);
    // The group reads it as one of its dishes now.
    expect((await w.call<DishResponse>("GET", me(`dishes/${dish.id}`), MEERA)).status).toBe(200);
    const listed = await w.call<{ dishes: KitchenDish[] }>("GET", groupPath(w.flat, "dishes"), DEV);
    expect(listed.body.data.dishes.map((d) => d.id)).toEqual([dish.id]);
    // The dish-posted email, as cooking it for claims would send: Anu and Dev, never the cook.
    const mails = w.h.notifications.filter((n) => n.request.templateKey === "kitchen.dish_posted" && !n.replayed);
    expect(mails.map((n) => n.request.recipient.subjectId).sort()).toEqual([ANU, DEV].sort());
    // One audit event, in Flat 4B only.
    const events = w.h.db.prepare("SELECT org_id, payload FROM events_event_log WHERE type = 'kitchen.dish.split'").all() as Array<{ org_id: string; payload: string }>;
    expect(events.map((e) => e.org_id)).toEqual([w.flat.id]);
    expect(JSON.parse(events[0]!.payload)).toMatchObject({
      orgId: w.flat.publicId, dishId: dish.id, cook: RAHUL, shared: true, portionsHalf: 8, splitMode: "claims", totalMinor: 21100,
    });
  });

  it("splits for the cook's own shares (assign): a draft, then shares and finalize post the dish transaction", async () => {
    const dish = await cookOwn(w, RAHUL, { portionsHalf: 4, priceMinor: 4000 });
    const res = await split(w, RAHUL, dish, { orgId: w.flat.publicId, splitMode: "assign" });
    expect(res.body.data.dish).toMatchObject({ state: "draft", splitMode: "assign", orgId: w.flat.publicId });
    const shares = await w.call<SetDishSharesResponse>("PUT", dishPath(w.flat, dish, "shares"), RAHUL, {
      shares: [{ subjectId: RAHUL, portionsHalf: 2 }, { subjectId: ANU, portionsHalf: 2 }],
    });
    expect(shares.status).toBe(200);
    expect((await finalize(RAHUL, dish)).status).toBe(200);
    expect(await balances(w, w.flat, ANU)).toEqual({ [RAHUL]: 2000, [ANU]: -2000 });
  });

  it("takes a dish its cook marked finalized as just theirs (which posted nothing), and opens it again", async () => {
    const dish = await cookOwn(w, RAHUL);
    const marked = await w.call<DishResponse>("POST", me(`dishes/${dish.id}/finalize`), RAHUL);
    expect(marked.body.data.dish).toMatchObject({ state: "finalized", txnId: null });
    const res = await split(w, RAHUL, dish, { orgId: w.flat.publicId });
    expect(res.status).toBe(200);
    expect(res.body.data.dish).toMatchObject({ state: "open", finalizedAt: null, orgId: w.flat.publicId });
    expect((await claim(DEV, dish, 4)).status).toBe(200);
    expect((await finalize(RAHUL, dish)).status).toBe(200);
    expect(await balances(w, w.flat, DEV)).toEqual({ [RAHUL]: 1000, [DEV]: -1000 });
  });

  it("can still be canceled after the split: every charge reversed, nothing left in any ledger", async () => {
    const dish = await cookWorkedExample(w, "own");
    expect((await split(w, RAHUL, dish, { orgId: w.flat.publicId })).status).toBe(200);
    expect((await w.call<DishResponse>("POST", me(`dishes/${dish.id}/cancel`), RAHUL)).body.data.dish.state).toBe("canceled");
    expect(await balances(w, w.flat, ANU)).toEqual({});
    expect(await balances(w, w.lunch, KIRAN)).toEqual({});
  });
});

describe("what a split refuses — and writes nothing for", () => {
  it("someone else's dish, or one nobody has: the opaque 404", async () => {
    const dish = await cookOwn(w, RAHUL);
    const before = written(w);
    expect((await split(w, ANU, dish, { orgId: w.flat.publicId })).status).toBe(404);
    expect((await split(w, RAHUL, "dsh_00000000000000000000000000000000", { orgId: w.flat.publicId })).status).toBe(404);
    expect((await split(w, RAHUL, "itm_1", { orgId: w.flat.publicId })).status).toBe(404);
    expect(written(w)).toEqual(before);
  });

  it("a dish in a group already — cooked into it, or split before: 409 already_split with its group", async () => {
    const cookedIn = await cookWorkedExample(w, "group");
    const own = await cookOwn(w, RAHUL);
    expect((await split(w, RAHUL, own, { orgId: w.lunch.publicId })).status).toBe(200);
    const before = written(w);
    for (const [dish, orgId] of [[cookedIn, w.flat.publicId], [own, w.lunch.publicId]] as const) {
      for (const target of [w.flat, w.lunch]) {
        const res = await split(w, RAHUL, dish, { orgId: target.publicId });
        expect(res.status).toBe(409);
        expect(res.body.error.details).toEqual({ reason: "already_split", orgId });
      }
    }
    // Even someone in the group who isn't the cook can't: it isn't theirs.
    expect((await split(w, ANU, cookedIn, { orgId: w.flat.publicId })).status).toBe(404);
    expect(written(w)).toEqual(before);
  });

  it("a canceled dish: 409 dish_not_open", async () => {
    const dish = await cookOwn(w, RAHUL);
    expect((await w.call("POST", me(`dishes/${dish.id}/cancel`), RAHUL)).status).toBe(200);
    const before = written(w);
    const res = await split(w, RAHUL, dish, { orgId: w.flat.publicId });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "dish_not_open", state: "canceled" });
    expect(written(w)).toEqual(before);
  });

  it("a group the cook isn't in, or may only view: 404", async () => {
    const dish = await cookOwn(w, RAHUL);
    const before = written(w);
    expect((await split(w, RAHUL, dish, { orgId: w.elsewhere.publicId })).status).toBe(404);
    expect((await split(w, RAHUL, dish, { orgId: newGroup("Nowhere").publicId })).status).toBe(404);
    expect((await split(w, RAHUL, dish, { orgId: w.books.publicId })).status).toBe(404);
    expect(written(w)).toEqual(before);
  });

  it("a group that counts in another currency: 422 currency_mismatch", async () => {
    const trip = newGroup("Trip");
    w.h.grant(RAHUL, trip, "owner");
    expect((await w.call("PATCH", groupPath(trip, "settings"), RAHUL, { currency: "USD" })).status).toBe(200);
    const dish = await cookOwn(w, RAHUL);
    const before = written(w);
    const res = await split(w, RAHUL, dish, { orgId: trip.publicId });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toMatchObject({ reason: "currency_mismatch", currency: "USD" });
    expect(written(w)).toEqual(before);
  });

  it("a body it can't read: 422 with the fields", async () => {
    const dish = await cookOwn(w, RAHUL);
    for (const [body, field] of [
      [{}, "orgId"],
      [{ orgId: "flat" }, "orgId"],
      [{ orgId: w.flat.publicId, splitMode: "potluck" }, "splitMode"],
    ] as const) {
      const res = await split(w, RAHUL, dish, body);
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.error.details.fields as object)).toContain(field);
    }
  });

  it("a dish that changed between the read and the write is split as it now is, once", async () => {
    const dish = await cookOwn(w, RAHUL);
    // Marked finalized (just Rahul's) in between: the guard misses, the split reads it again and goes through.
    w.h.beforeNextBatch((db) =>
      db.prepare("UPDATE kitchen_dishes SET state = 'finalized', finalized_at = ?, version = version + 1 WHERE cook = ?").run(NOW.toISOString(), RAHUL),
    );
    const res = await split(w, RAHUL, dish, { orgId: w.flat.publicId });
    expect(res.status).toBe(200);
    expect(res.body.data.dish).toMatchObject({ state: "open", orgId: w.flat.publicId });
    // Cooked (1), marked finalized in between (2), split (3).
    expect(w.h.db.prepare("SELECT version FROM kitchen_dishes").get()).toEqual({ version: 3 });
    expect(w.h.db.prepare("SELECT COUNT(*) AS n FROM events_event_log WHERE type = 'kitchen.dish.split'").get()).toEqual({ n: 1 });
  });
});

describe("posting any finished dish (CM-3's rule, relaxed by CM-8)", () => {
  const post = (dishId: string) =>
    w.call<PostResponse>("POST", me("posts"), RAHUL, { dishId, audience: "me", show: { ate: true } });

  it("posts the cook's own dish before a split, and the split leaves the post as it is", async () => {
    const dish = await cookOwn(w, RAHUL, { portionsHalf: 6 });
    const res = await post(dish.id);
    expect(res.status).toBe(201);
    // How many it served: its 3 portions.
    expect(res.body.data.post.stats).toEqual({ ate: 3 });
    expect((await split(w, RAHUL, dish, { orgId: w.flat.publicId })).status).toBe(200);
    expect((await w.call<PostResponse>("GET", `/v1/kitchen/posts/${res.body.data.post.id}`, RAHUL)).body.data.post.stats).toEqual({ ate: 3 });
  });

  it("posts a split dish while open for Who ate, and one finalized; servings, not shares, are `ate`", async () => {
    const open = await cookOwn(w, RAHUL, { portionsHalf: 3, name: "Dal" });
    expect((await split(w, RAHUL, open, { orgId: w.flat.publicId })).status).toBe(200);
    const first = await post(open.id);
    expect(first.status).toBe(201);
    // 1½ portions serve two.
    expect(first.body.data.post.stats).toEqual({ ate: 2 });

    const done = await cookOwn(w, RAHUL, { portionsHalf: 8, name: "Biryani" });
    expect((await split(w, RAHUL, done, { orgId: w.flat.publicId })).status).toBe(200);
    expect((await claim(ANU, done, 2)).status).toBe(200);
    expect((await finalize(RAHUL, done)).status).toBe(200);
    // Two had some; it made four portions.
    expect((await post(done.id)).body.data.post.stats).toEqual({ ate: 4 });
  });

  it("never posts a canceled dish (409 not_postable)", async () => {
    const dish = await cookOwn(w, RAHUL);
    expect((await w.call("POST", me(`dishes/${dish.id}/cancel`), RAHUL)).status).toBe(200);
    expect((await post(dish.id)).body.error.details).toEqual({ reason: "not_postable" });
  });
});
