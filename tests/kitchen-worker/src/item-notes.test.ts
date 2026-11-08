// Item notes (Cookpool RC-3, design §1.5): one line about an item, "For
// Sunday's curry" — taken by the add and the edit (trimmed, empty is none,
// more than 80 characters is 422), returned by every read of the item, seen
// by exactly who can see the item (you alone in your own pantry, everyone in
// a group's), and never money: a note writes no ledger transaction, no stock
// move and no audit event. Through the router, against real SQLite (every
// migration applied), the real policy grants and membership's answers.

import type {
  ItemsPage,
  KitchenItem,
  KitchenItemResponse,
  ReachableItemsPage,
  SearchItemsResponse,
  StockMoveResponse,
} from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-08T08:00:00.000Z");

const RAHUL = "usr_rahul"; // owner of Flat 4B
const ANU = "usr_anu";
const DEV = "usr_dev";
const VIEWER = "usr_viewer";
const OUTSIDER = "usr_outsider";

const CURRY = "For Sunday's curry";

let h: Harness;
let flat: Group;
let elsewhere: Group;

beforeEach(() => {
  h = createHarness({ deps: { now: () => NOW } });
  flat = newGroup("Flat 4B");
  elsewhere = newGroup("Another flat");
  h.grant(RAHUL, flat, "owner");
  h.grant(ANU, flat, "builder");
  h.grant(DEV, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(OUTSIDER, elsewhere, "owner");
});

afterEach(() => h.close());

async function call<T>(method: string, url: string, as: string | null, body?: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

const me = (rest: string) => `/v1/kitchen/me/${rest}`;
const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

const paneer = { name: "Paneer", category: "Dairy", quantity: "200", unit: "g", priceMinor: 9000 };

async function mine(as: string, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", me("items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function inGroup(as: string, g: Group, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

const editMine = (as: string, item: KitchenItem, body: unknown) => call<KitchenItemResponse>("PATCH", me(`items/${item.id}`), as, body);
const editInGroup = (as: string, g: Group, item: KitchenItem, body: unknown) =>
  call<KitchenItemResponse>("PATCH", groupPath(g, `items/${item.id}`), as, body);

function count(table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** What a note write must leave alone: the ledger, the stock moves, the audit log. */
function moneyAndStock(): Record<string, number> {
  return Object.fromEntries(
    ["kitchen_txns", "kitchen_txn_splits", "kitchen_stock_moves", "events_event_log"].map((t) => [t, count(t)]),
  );
}

/** The note column as stored, by the item's public id. */
function stored(item: KitchenItem): unknown {
  const uuid = item.id.replace(/^itm_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  return (h.db.prepare("SELECT note FROM kitchen_items WHERE id = ?").get(uuid) as { note: unknown }).note;
}

describe("a note on your own item", () => {
  it("is set on the add, trimmed, and every read of the item returns it", async () => {
    const added = await mine(RAHUL, { ...paneer, note: `  ${CURRY} ` });
    expect(added.note).toBe(CURRY);
    expect(stored(added)).toBe(CURRY);

    const one = await call<KitchenItemResponse>("GET", me(`items/${added.id}`), RAHUL);
    expect(one.body.data.item.note).toBe(CURRY);
    const list = await call<ReachableItemsPage>("GET", me("items"), RAHUL);
    expect(list.body.data.items.map((i) => [i.name, i.note])).toEqual([["Paneer", CURRY]]);
    const personal = await call<ReachableItemsPage>("GET", me("items?pantry=personal"), RAHUL);
    expect(personal.body.data.items[0]!.note).toBe(CURRY);
    const found = await call<SearchItemsResponse>("GET", me("search?q=pan"), RAHUL);
    expect(found.body.data.items.map((i) => i.note)).toEqual([CURRY]);
    // A use answers with the item, note and all.
    const used = await call<StockMoveResponse>("POST", me(`items/${added.id}/uses`), RAHUL, { quantity: "50" });
    expect(used.status).toBe(201);
    expect(used.body.data.item).toMatchObject({ note: CURRY, qtyLeftMilli: 150_000 });
  });

  it("reads as null when none was given, or only spaces", async () => {
    expect((await mine(RAHUL, paneer)).note).toBeNull();
    const blank = await mine(RAHUL, { ...paneer, name: "Rice", note: "   " });
    expect(blank.note).toBeNull();
    expect(stored(blank)).toBeNull();
    expect((await mine(RAHUL, { ...paneer, name: "Dal", note: null })).note).toBeNull();
  });

  it("is set and cleared by an edit — even once some is used — and the version moves", async () => {
    const added = await mine(RAHUL, paneer);
    await call("POST", me(`items/${added.id}/uses`), RAHUL, { quantity: "50" });
    const before = moneyAndStock();

    const set = await editMine(RAHUL, added, { note: " Half for Anu ", version: 2 });
    expect(set.status).toBe(200);
    expect(set.body.data.item).toMatchObject({ note: "Half for Anu", version: 3, qtyLeftMilli: 150_000, priceMinor: 9000 });

    // A stale version is refused, as for any edit.
    const stale = await editMine(RAHUL, added, { note: "Late", version: 2 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toMatchObject({ reason: "version_conflict", version: 3 });

    for (const clear of ["", "  ", null]) {
      await editMine(RAHUL, added, { note: "Again" });
      const cleared = await editMine(RAHUL, added, { note: clear });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.item.note).toBeNull();
      expect(stored(added)).toBeNull();
    }
    // A note alone is an edit: no other field is needed.
    expect((await editMine(RAHUL, added, { note: "Top shelf" })).body.data.item.note).toBe("Top shelf");
    expect(moneyAndStock()).toEqual(before);
  });

  it("is seen by its owner alone", async () => {
    const added = await mine(RAHUL, { ...paneer, note: CURRY });
    expect((await call("GET", me(`items/${added.id}`), ANU)).status).toBe(404);
    expect((await call<ReachableItemsPage>("GET", me("items"), ANU)).body.data.items).toEqual([]);
    expect((await call<SearchItemsResponse>("GET", me("search?q=paneer"), ANU)).body.data.items).toEqual([]);
    expect((await editMine(ANU, added, { note: "Mine now" })).status).toBe(404);
    expect(stored(added)).toBe(CURRY);
  });

  it("moves with the item into a group, where the group then sees it", async () => {
    const added = await mine(RAHUL, { ...paneer, note: CURRY });
    const moved = await call<StockMoveResponse>("POST", me(`items/${added.id}/transfer`), RAHUL, { orgId: flat.publicId });
    expect(moved.status).toBe(201);
    expect(moved.body.data.item).toMatchObject({ pantry: { kind: "group", orgId: flat.publicId }, note: CURRY });
    const read = await call<KitchenItemResponse>("GET", groupPath(flat, `items/${added.id}`), ANU);
    expect(read.body.data.item.note).toBe(CURRY);
  });
});

describe("a note on a group's item", () => {
  it("is set on the add, and everyone in the group reads it — a viewer too — on every read", async () => {
    const added = await inGroup(ANU, flat, { ...paneer, note: CURRY });
    expect(added.note).toBe(CURRY);
    for (const who of [RAHUL, ANU, DEV, VIEWER]) {
      const one = await call<KitchenItemResponse>("GET", groupPath(flat, `items/${added.id}`), who);
      expect(one.status).toBe(200);
      expect(one.body.data.item.note).toBe(CURRY);
      const pantry = await call<ItemsPage>("GET", groupPath(flat, "items"), who);
      expect(pantry.body.data.items.map((i) => i.note)).toEqual([CURRY]);
      const all = await call<ReachableItemsPage>("GET", me("items"), who);
      expect(all.body.data.items.map((i) => i.note)).toEqual([CURRY]);
      const found = await call<SearchItemsResponse>("GET", me("search?q=paneer"), who);
      expect(found.body.data.items.map((i) => i.note)).toEqual([CURRY]);
    }
  });

  it("is not seen by anyone outside the group", async () => {
    const added = await inGroup(ANU, flat, { ...paneer, note: CURRY });
    expect((await call("GET", groupPath(flat, `items/${added.id}`), OUTSIDER)).status).toBe(404);
    expect((await call("GET", groupPath(flat, "items"), OUTSIDER)).status).toBe(404);
    expect((await call<ReachableItemsPage>("GET", me("items"), OUTSIDER)).body.data.items).toEqual([]);
    expect((await call<SearchItemsResponse>("GET", me("search?q=paneer"), OUTSIDER)).body.data.items).toEqual([]);
    // Not through someone else's group either.
    expect((await call("GET", groupPath(elsewhere, `items/${added.id}`), OUTSIDER)).status).toBe(404);
    expect((await editInGroup(OUTSIDER, flat, added, { note: "Hi" })).status).toBe(404);

    // And once someone leaves, they read it no more.
    h.revoke(DEV, flat);
    expect((await call("GET", groupPath(flat, `items/${added.id}`), DEV)).status).toBe(404);
    expect((await call<ReachableItemsPage>("GET", me("items"), DEV)).body.data.items).toEqual([]);
  });

  it("is changed by the buyer or an owner, as any edit is — not by another member or a viewer", async () => {
    const added = await inGroup(ANU, flat, paneer);
    const before = moneyAndStock();
    const byBuyer = await editInGroup(ANU, flat, added, { note: CURRY });
    expect(byBuyer.status).toBe(200);
    expect(byBuyer.body.data.item).toMatchObject({ note: CURRY, version: 2 });
    const byOwner = await editInGroup(RAHUL, flat, added, { note: "Top shelf", version: 2 });
    expect(byOwner.body.data.item).toMatchObject({ note: "Top shelf", version: 3 });

    const byOther = await editInGroup(DEV, flat, added, { note: "Mine" });
    expect(byOther.status).toBe(403);
    expect(byOther.body.error.details).toMatchObject({ reason: "not_buyer" });
    expect((await editInGroup(VIEWER, flat, added, { note: "Mine" })).status).toBe(404);
    expect(stored(added)).toBe("Top shelf");

    const cleared = await editInGroup(ANU, flat, added, { note: null });
    expect(cleared.body.data.item.note).toBeNull();
    // A note is words: no transaction, no split, no move, no audit event.
    expect(moneyAndStock()).toEqual(before);
  });

  it("adding with a note writes what adding without one writes, and no ledger transaction", async () => {
    await inGroup(ANU, flat, paneer);
    const plain = moneyAndStock();
    await inGroup(ANU, flat, { ...paneer, name: "Rice", note: CURRY });
    const after = moneyAndStock();
    expect(after["kitchen_txns"]).toBe(0);
    expect(after["kitchen_txn_splits"]).toBe(0);
    expect(after["kitchen_stock_moves"]).toBe(0);
    // One kitchen.item.added each, as before.
    expect(after["events_event_log"]).toBe(plain["events_event_log"]! * 2);
    const audit = h.db.prepare("SELECT payload FROM events_event_log WHERE type = 'kitchen.item.added'").all() as Array<{ payload: string }>;
    expect(audit).toHaveLength(2);
    expect(audit.every((e) => !String(e.payload).includes(CURRY))).toBe(true);
  });
});

describe("the note's limits", () => {
  it("takes 80 characters, counted as characters: an emoji is one", async () => {
    expect((await mine(RAHUL, { ...paneer, note: "x".repeat(80) })).note).toHaveLength(80);
    const curry = "🍛".repeat(80);
    expect((await mine(RAHUL, { ...paneer, name: "Curry", note: curry })).note).toBe(curry);
    // Spaces around it do not count.
    expect((await mine(RAHUL, { ...paneer, name: "Dal", note: ` ${"y".repeat(80)} ` })).note).toBe("y".repeat(80));
  });

  it.each([
    ["more than 80 characters", "x".repeat(81)],
    ["81 emoji", "🍛".repeat(81)],
    ["a number", 42],
    ["a list", ["Sunday"]],
  ])("refuses %s with 422 on note, writing nothing — personal and group, add and edit", async (_what, note) => {
    const personal = await call("POST", me("items"), RAHUL, { ...paneer, note });
    const shared = await call("POST", groupPath(flat, "items"), ANU, { ...paneer, note });
    for (const res of [personal, shared]) {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      expect(res.body.error.details["fields"]).toHaveProperty(["note"]);
    }
    expect(count("kitchen_items")).toBe(0);

    const own = await mine(RAHUL, { ...paneer, note: CURRY });
    const theirs = await inGroup(ANU, flat, { ...paneer, note: CURRY });
    for (const res of [await editMine(RAHUL, own, { note }), await editInGroup(ANU, flat, theirs, { note })]) {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
      expect(res.body.error.details["fields"]).toHaveProperty(["note"]);
    }
    expect([stored(own), stored(theirs)]).toEqual([CURRY, CURRY]);
  });
});
