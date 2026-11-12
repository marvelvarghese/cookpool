// Shopping runs (PN-3, cookpool-pantry design §6.3–§6.4):
// POST /v1/kitchen/me/purchases and DELETE /v1/kitchen/me/purchases/{pur}
// through the router, against real SQLite, the real policy grants and
// membership's answers. One write with one payer across the caller's own
// pantry and two groups; one pantry out of reach refusing all of it; the
// groups' currencies; what Bought again copies; retries; and the Undo,
// which keeps what was used since and is the purchaser's alone.

import type { KitchenItem, PurchaseResponse, ReachableItemsPage } from "@saas/contracts/kitchen";
import { PURCHASE_MAX_LINES } from "@saas/contracts/kitchen";
import { ANU, DEV, KIRAN, NOW, RAHUL, groupPath, me, uuidOf, world, type World } from "./restock-helpers.js";

let w: World;
const TODAY = NOW.toISOString().slice(0, 10);

beforeEach(() => {
  w = world();
  w.daysAgo(0);
});

afterEach(() => w.close());

const bread = { pantry: "personal", name: "Bread", category: "Grains", quantity: "1", unit: "pcs", priceMinor: 4500 };
const atta = () => ({ pantry: w.flat.publicId, name: "Atta", category: "Grains", quantity: "5", unit: "kg", priceMinor: 28000 });
const milk = () => ({
  pantry: w.lunch.publicId,
  name: "Milk",
  category: "Dairy",
  quantity: "1",
  unit: "L",
  priceMinor: 6800,
  expiresOn: "2026-11-11",
  note: "Full cream",
});

const count = (table: string) => (w.h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const added = () =>
  (w.h.db.prepare("SELECT payload FROM events_event_log WHERE type = 'kitchen.item.added' ORDER BY rowid").all() as Array<{ payload: string }>).map(
    (r) => JSON.parse(r.payload) as Record<string, unknown>,
  );

/** Count the worker's D1 batches from now on. */
function countBatches(): () => number {
  const real = w.h.env.PLATFORM_DB!;
  let batches = 0;
  (w.h.env as { PLATFORM_DB?: D1Database }).PLATFORM_DB = {
    prepare: (query: string) => real.prepare(query),
    batch(s: D1PreparedStatement[]) {
      batches += 1;
      return real.batch(s);
    },
  } as unknown as D1Database;
  return () => batches;
}

async function myItems(as: string): Promise<KitchenItem[]> {
  return (await w.call<ReachableItemsPage>("GET", me("items"), as)).body.data.items;
}

describe("POST /v1/kitchen/me/purchases", () => {
  it("adds a run across the caller's own pantry and two groups in one write, paid by the caller, under one pur_ id", async () => {
    const batches = countBatches();
    const res = await w.buy(RAHUL, [bread, atta(), milk()], "run-1");
    expect(res.status).toBe(201);
    expect(batches()).toBe(1);

    const { purchaseId, items } = res.body.data;
    expect(purchaseId).toMatch(/^pur_[0-9a-f]{32}$/);
    expect(items.map((i) => [i.pantry.name, i.name, i.qtyBoughtMilli, i.priceMinor, i.currency, i.paidBy, i.createdBy, i.boughtOn, i.state])).toEqual([
      ["My pantry", "Bread", 1_000, 4500, "INR", RAHUL, RAHUL, TODAY, "active"],
      ["Flat 4B", "Atta", 5_000_000, 28000, "INR", RAHUL, RAHUL, TODAY, "active"],
      ["Lunch club", "Milk", 1_000_000, 6800, "INR", RAHUL, RAHUL, TODAY, "active"],
    ]);
    expect(items[2]).toMatchObject({ expiresOn: "2026-11-11", note: "Full cream", wastePolicy: "split_equally", wastePolicyOverride: null });

    // Every item is in the purchase; the group items carry Add item's audit event, naming it.
    const stored = w.h.db.prepare("SELECT purchase_id FROM kitchen_items ORDER BY rowid").all() as Array<{ purchase_id: string }>;
    expect(stored.map((r) => r.purchase_id)).toEqual(Array(3).fill(uuidOf(purchaseId)));
    expect(added().map((p) => [p.name, p.paidBy, p.purchaseId])).toEqual([
      ["Atta", RAHUL, purchaseId],
      ["Milk", RAHUL, purchaseId],
    ]);
    expect((await myItems(RAHUL)).map((i) => i.id).sort()).toEqual(items.map((i) => i.id).sort());
  });

  it("puts the group lines on Paid by (RV-22) when it is someone in every group, keeps the personal line the caller's, and refuses an outsider", async () => {
    const flatOnly = await w.call<PurchaseResponse>("POST", me("purchases"), RAHUL, { lines: [bread, atta()], paidBy: ANU }, { "idempotency-key": "paid-1" });
    expect(flatOnly.status).toBe(201);
    expect(flatOnly.body.data.items.map((i) => [i.name, i.paidBy, i.createdBy])).toEqual([
      ["Bread", RAHUL, RAHUL],
      ["Atta", ANU, RAHUL],
    ]);
    expect(added().map((p) => [p.name, p.paidBy])).toEqual([["Atta", ANU]]);
    // The caller still undoes it: the purchase is theirs.
    expect((await w.undo(RAHUL, flatOnly.body.data.purchaseId)).body.data.removed).toHaveLength(2);

    // Anu isn't in the Lunch club: nothing is written.
    const both = await w.call("POST", me("purchases"), RAHUL, { lines: [atta(), milk()], paidBy: ANU }, { "idempotency-key": "paid-2" });
    expect(both.status).toBe(422);
    expect(both.body.error.details).toMatchObject({ reason: "not_in_group", subjectIds: [ANU] });
    const bad = await w.call("POST", me("purchases"), RAHUL, { lines: [atta()], paidBy: "not an id!" }, { "idempotency-key": "paid-3" });
    expect([bad.status, Object.keys(bad.body.error.details.fields as object)]).toEqual([422, ["paidBy"]]);
    expect(count("kitchen_items")).toBe(2);
  });

  it("refuses the whole run when any pantry is out of reach, naming each such line", async () => {
    const books = { ...atta(), pantry: w.books.publicId }; // Rahul only reads the Book club
    const elsewhere = { ...atta(), pantry: w.elsewhere.publicId }; // and is not in Another flat
    const res = await w.buy(RAHUL, [bread, books, atta(), elsewhere]);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.details.fields).toEqual({
      "lines[1].pantry": ["Must be a pantry you can add to"],
      "lines[3].pantry": ["Must be a pantry you can add to"],
    });
    expect([count("kitchen_items"), added()]).toEqual([0, []]);
    // Asked of the policy engine with Add item's action, once per group.
    const asked = w.h.decisions.filter((d) => d.request.action === "kitchen.item.create").map((d) => [d.request.resource, d.allow]);
    expect(asked).toEqual(
      expect.arrayContaining([
        [{ kind: "organization", orgId: w.books.id }, false],
        [{ kind: "organization", orgId: w.flat.id }, true],
      ]),
    );
  });

  it(`takes 1 to ${PURCHASE_MAX_LINES} lines and names every field that fails under its line`, async () => {
    for (const lines of [undefined, [], Array(PURCHASE_MAX_LINES + 1).fill(bread)]) {
      const res = await w.call("POST", me("purchases"), RAHUL, lines === undefined ? {} : { lines });
      expect([res.status, Object.keys(res.body.error.details.fields as object)]).toEqual([422, ["lines"]]);
    }
    const res = await w.buy(RAHUL, [
      { ...bread, pantry: "flat" },
      { ...atta(), name: "", quantity: "lots" },
      { ...bread, fromItemId: "itm_nope" },
      "milk",
    ]);
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details.fields as object).sort()).toEqual(
      ["lines[0].pantry", "lines[1].name", "lines[1].quantity", "lines[2].fromItemId", "lines[3]"].sort(),
    );
    expect((await w.buy(RAHUL, Array(PURCHASE_MAX_LINES).fill(bread))).status).toBe(201);
    expect(count("kitchen_items")).toBe(PURCHASE_MAX_LINES);
  });

  it("puts a group line in its group's currency, refuses another, and lets a personal line name its own", async () => {
    expect((await w.call("PATCH", groupPath(w.lunch, "settings"), KIRAN, { currency: "EUR" })).status).toBe(200);
    const refused = await w.buy(RAHUL, [bread, { ...milk(), currency: "INR" }]);
    expect(refused.status).toBe(422);
    expect(refused.body.error.details).toEqual({ reason: "currency_mismatch", currency: "EUR", line: 1 });
    expect(count("kitchen_items")).toBe(0);

    const res = await w.buy(RAHUL, [{ ...bread, currency: "USD" }, milk(), { ...milk(), currency: "EUR" }]);
    expect(res.status).toBe(201);
    expect(res.body.data.items.map((i) => i.currency)).toEqual(["USD", "EUR", "EUR"]);
  });

  it("writes nothing at all when a group's currency is fixed to another between the read and the write", async () => {
    w.h.beforeNextBatch((db) =>
      db.prepare("INSERT INTO kitchen_group_settings (org_id, currency, created_at, updated_at) VALUES (?, 'EUR', ?, ?)").run(
        w.flat.id,
        NOW.toISOString(),
        NOW.toISOString(),
      ),
    );
    const res = await w.buy(RAHUL, [bread, atta()]);
    expect(res.status).toBe(422);
    expect(res.body.error.details).toMatchObject({ reason: "currency_mismatch", currency: "EUR" });
    expect([count("kitchen_items"), added()]).toEqual([0, []]);
  });

  it("copies the waste rule from the item it buys again, into that item's own group only", async () => {
    const ghee = await w.addTo(ANU, w.flat, { name: "Ghee", wastePolicy: "buyer_absorbs" });
    const line = { pantry: w.flat.publicId, name: "Ghee", category: "Dairy", quantity: "500", unit: "g", priceMinor: 32000, fromItemId: ghee.id };
    const res = await w.buy(RAHUL, [
      line,
      { ...line, wastePolicy: null }, // the line's own word wins
      { ...line, pantry: w.lunch.publicId }, // another group's rule is not this item's
      { ...line, pantry: "personal" },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.items.map((i) => [i.pantry.name, i.wastePolicyOverride, i.wastePolicy])).toEqual([
      ["Flat 4B", "buyer_absorbs", "buyer_absorbs"],
      ["Flat 4B", null, "split_equally"],
      ["Lunch club", null, "split_equally"],
      ["My pantry", null, null],
    ]);

    const theirs = await w.addTo("usr_outsider", w.elsewhere, { name: "Ghee" });
    const unknown = await w.buy(RAHUL, [{ ...line, fromItemId: theirs.id }]);
    expect([unknown.status, unknown.body.error.details.fields]).toEqual([422, { "lines[0].fromItemId": ["Must be an item in one of your pantries"] }]);
  });

  it("adds a retried run once, answering with the purchase it made; someone else's key in the same pantry is 409", async () => {
    const first = await w.buy(RAHUL, [atta(), bread], "run-7");
    const again = await w.buy(RAHUL, [atta(), bread], "run-7");
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body.data.purchaseId).toBe(first.body.data.purchaseId);
    expect(again.body.data.items.map((i) => i.id)).toEqual(first.body.data.items.map((i) => i.id));
    expect([count("kitchen_items"), added().length]).toEqual([2, 1]);

    const theirs = await w.buy(DEV, [atta()], "run-7");
    expect([theirs.status, theirs.body.error.details.reason]).toEqual([409, "idempotency_key_reused"]);
    // A run's keys are its lines': Add item's own key does not collide with them.
    expect((await w.call("POST", groupPath(w.flat, "items"), RAHUL, { ...atta(), pantry: undefined }, { "idempotency-key": "run-8" })).status).toBe(201);
    expect((await w.buy(RAHUL, [atta()], "run-8")).status).toBe(201);
    // Without a key, every run is its own.
    await w.buy(RAHUL, [bread]);
    await w.buy(RAHUL, [bread]);
    expect(count("kitchen_items")).toBe(6);
  });

  it("is 401 without an actor, 405 for another method, and 503 when membership cannot be read", async () => {
    expect((await w.call("POST", me("purchases"), null, { lines: [bread] })).status).toBe(401);
    expect((await w.call("GET", me("purchases"), RAHUL)).status).toBe(405);
    w.h.failGroups = true;
    expect((await w.buy(RAHUL, [bread])).status).toBe(503);
    expect(count("kitchen_items")).toBe(0);
  });
});

describe("DELETE /v1/kitchen/me/purchases/{purchaseId}", () => {
  async function run(): Promise<{ purchaseId: string; items: KitchenItem[] }> {
    const res = await w.buy(RAHUL, [bread, atta(), milk()]);
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it("removes every item of the run while nothing of it is used, and a repeat answers the same", async () => {
    const { purchaseId, items } = await run();
    const undone = await w.undo(RAHUL, purchaseId);
    expect(undone.status).toBe(200);
    expect(undone.body.data.purchaseId).toBe(purchaseId);
    expect(undone.body.data.removed.map((i) => [i.id, i.state])).toEqual(items.map((i) => [i.id, "removed"]));
    expect(undone.body.data.kept).toEqual([]);
    expect(await myItems(RAHUL)).toEqual([]);

    const again = await w.undo(RAHUL, purchaseId);
    expect(again.status).toBe(200);
    expect(again.body.data.removed.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("keeps an item used since, and removes the rest", async () => {
    const { purchaseId, items } = await run();
    const used = await w.useIn(RAHUL, w.lunch, items[2]!, "200", "ml");
    const undone = await w.undo(RAHUL, purchaseId);
    expect(undone.status).toBe(200);
    expect(undone.body.data.removed.map((i) => i.name)).toEqual(["Bread", "Atta"]);
    expect(undone.body.data.kept.map((i) => [i.name, i.state, i.qtyLeftMilli])).toEqual([["Milk", "active", 800_000]]);
    expect(used.item.qtyLeftMilli).toBe(800_000);
    expect((await myItems(RAHUL)).map((i) => i.name)).toEqual(["Milk"]);
  });

  it("keeps a group's items once the caller may no longer change items there", async () => {
    const { purchaseId } = await run();
    w.h.grant(RAHUL, w.lunch, "viewer");
    const undone = await w.undo(RAHUL, purchaseId);
    expect(undone.body.data.removed.map((i) => i.name)).toEqual(["Bread", "Atta"]);
    expect(undone.body.data.kept.map((i) => [i.pantry.name, i.name])).toEqual([["Lunch club", "Milk"]]);
  });

  it("is the purchaser's alone: anyone else, an unknown id or a malformed one is the opaque 404", async () => {
    const { purchaseId } = await run();
    for (const [as, id] of [
      [ANU, purchaseId], // owner of Flat 4B, where Atta went
      [DEV, purchaseId],
      [RAHUL, `pur_${"0".repeat(32)}`],
      [RAHUL, "pur_nope"],
      [RAHUL, purchaseId.replace("pur_", "itm_")],
    ] as const) {
      const res = await w.undo(as, id);
      expect([as, id, res.status, res.body.error.message]).toEqual([as, id, 404, "Not found"]);
    }
    expect(count("kitchen_items")).toBe(3);
    expect((await myItems(RAHUL)).every((i) => i.state === "active")).toBe(true);
    expect((await w.call("DELETE", me(`purchases/${purchaseId}`), null)).status).toBe(401);
  });
});
