// Pantries (CP-10): a personal pantry per person and a pantry per group —
// items in any unit, the all-pantries view with its counts, filters and
// search, and who may change what — through the router, against real SQLite
// (every migration applied), the real policy grants and membership's answers.

import type {
  ItemsPage,
  KitchenItem,
  KitchenItemResponse,
  KitchenSettings,
  PantriesResponse,
  SearchItemsResponse,
} from "@saas/contracts/kitchen";
import { createSqlExecutor } from "@saas/db/d1";
import { asUuid } from "@saas/db/ids";
import { createKitchenRepository } from "@saas/db/kitchen";
import { pricePerUnit } from "@saas/kitchen-engine/units";
import { createHarness, d1Over, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-02T08:00:00.000Z");
const TODAY = "2026-11-02";

const RAHUL = "usr_rahul"; // owner of Flat 4B
const ADMIN = "usr_admin";
const ANU = "usr_anu";
const DEV = "usr_dev";
const VIEWER = "usr_viewer";
const OUTSIDER = "usr_outsider";

let h: Harness;
let flat: Group;
let lunch: Group;
let elsewhere: Group;

beforeEach(() => {
  h = createHarness({ deps: { now: () => NOW } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  elsewhere = newGroup("Another flat");
  h.grant(RAHUL, flat, "owner");
  h.grant(ADMIN, flat, "admin");
  h.grant(ANU, flat, "builder");
  h.grant(DEV, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(ANU, lunch, "owner");
  h.grant(RAHUL, lunch, "viewer");
  h.grant(OUTSIDER, elsewhere, "owner");
});

afterEach(() => h.close());

async function call<T>(
  method: string,
  url: string,
  as: string | null,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

const me = (rest: string) => `/v1/kitchen/me/${rest}`;
const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

const rice = { name: "Rice", category: "Grains", quantity: "1.25", unit: "kg", priceMinor: 12500 };

const addMine = (as: string, body: unknown, headers?: Record<string, string>) =>
  call<KitchenItemResponse>("POST", me("items"), as, body, headers);
const addToGroup = (as: string, g: Group, body: unknown, headers?: Record<string, string>) =>
  call<KitchenItemResponse>("POST", groupPath(g, "items"), as, body, headers);

async function mine(as: string, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await addMine(as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function inGroup(as: string, g: Group, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await addToGroup(as, g, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

function count(table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function uuidOf(publicId: string): string {
  return publicId.replace(/^[a-z]+_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

/** Pretend some of an item was used (CP-11 writes this): `milli` taken, costing `cost`. */
function use(item: KitchenItem, milli: number, cost: number): void {
  h.db
    .prepare("UPDATE kitchen_items SET qty_left_milli = qty_left_milli - ?, cost_taken_minor = cost_taken_minor + ? WHERE id = ?")
    .run(milli, cost, uuidOf(item.id));
}

describe("units", () => {
  it.each([
    ["kg", "1.25", "mass", 1_250_000, 1.25],
    ["L", "2", "volume", 2_000_000, 2],
    ["dozen", "1.5", "count", 18_000, 1.5],
    ["cup", "2", "volume", 480_000, 2],
    ["pack", "3", "pack", 3_000, 3],
    ["g", "250", "mass", 250_000, 250],
    ["pcs", 6, "count", 6_000, 6],
  ] as const)("round-trips %s: %s stored as thousandths of the base unit", async (unit, quantity, dimension, milli, shown) => {
    const added = await mine(RAHUL, { ...rice, quantity, unit, priceMinor: 9000 });
    expect(added).toMatchObject({
      dimension,
      displayUnit: unit,
      qtyBought: shown,
      qtyLeft: shown,
      qtyBoughtMilli: milli,
      qtyLeftMilli: milli,
      priceMinor: 9000,
      unitPriceMinor: pricePerUnit(9000, milli, unit),
      worthMinor: 9000,
    });
    const read = await call<KitchenItemResponse>("GET", me(`items/${added.id}`), RAHUL);
    expect(read.body.data.item).toEqual(added);
  });

  it("prices per display unit: ₹125.00 for 1.25 kg is ₹100.00 a kg", async () => {
    expect((await mine(RAHUL, rice)).unitPriceMinor).toBe(10000);
  });

  it.each([
    [{ ...rice, unit: "stone" }, "unit"],
    [{ ...rice, quantity: "0" }, "quantity"],
    [{ ...rice, quantity: "-1" }, "quantity"],
    [{ ...rice, quantity: "1,5" }, "quantity"],
    [{ ...rice, quantity: true }, "quantity"],
    [{ ...rice, priceMinor: -1 }, "priceMinor"],
    [{ ...rice, priceMinor: 12.5 }, "priceMinor"],
    [{ ...rice, name: " " }, "name"],
    [{ ...rice, category: undefined }, "category"],
    [{ ...rice, currency: "rupees" }, "currency"],
    [{ ...rice, boughtOn: "2026-02-30" }, "boughtOn"],
    [{ ...rice, expiresOn: "soon" }, "expiresOn"],
    [{ ...rice, boughtOn: "2026-11-02", expiresOn: "2026-11-01" }, "expiresOn"],
  ])("is 422 for a malformed item (%#), writing nothing", async (body, field) => {
    const { status, body: res } = await addMine(RAHUL, body);
    expect(status).toBe(422);
    expect(res.error.code).toBe("validation_failed");
    expect(res.error.details.fields).toHaveProperty([field]);
    expect(count("kitchen_items")).toBe(0);
  });
});

describe("the personal pantry", () => {
  it("adds an item for its owner: bought today, INR unless the request names a currency", async () => {
    const added = await mine(RAHUL, { ...rice, expiresOn: "2026-11-05" });
    expect(added).toMatchObject({
      pantry: { kind: "personal", name: "My pantry" },
      name: "Rice",
      category: "Grains",
      currency: "INR",
      paidBy: RAHUL,
      createdBy: RAHUL,
      boughtOn: TODAY,
      expiresOn: "2026-11-05",
      daysToUseBy: 3,
      wastePolicy: null,
      wastePolicyOverride: null,
      state: "active",
      version: 1,
      createdAt: NOW.toISOString(),
    });
    expect(added.id).toMatch(/^itm_[0-9a-f]{32}$/);
    expect((await mine(RAHUL, { ...rice, currency: "USD" })).currency).toBe("USD");
  });

  it("writes no ledger transaction and no audit event, and never asks policy", async () => {
    await mine(RAHUL, rice);
    expect(count("kitchen_txns")).toBe(0);
    expect(count("events_event_log")).toBe(0);
    expect(h.decisions).toHaveLength(0);
  });

  it("is another person's 404: they cannot read, change or remove it, or find it", async () => {
    const added = await mine(ANU, { ...rice, name: "Anu's rice" });
    for (const [method, body] of [["GET", undefined], ["PATCH", { name: "Mine now" }], ["DELETE", undefined]] as const) {
      const res = await call(method, me(`items/${added.id}`), RAHUL, body);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "not_found", message: "Not found" });
    }
    // Nor through a group's routes.
    expect((await call("GET", groupPath(flat, `items/${added.id}`), RAHUL)).status).toBe(404);
    const list = await call<ItemsPage>("GET", me("items"), RAHUL);
    expect(list.body.data.items).toEqual([]);
    const found = await call<SearchItemsResponse>("GET", me("search?q=rice"), RAHUL);
    expect(found.body.data.items).toEqual([]);
    expect((await call<KitchenItemResponse>("GET", me(`items/${added.id}`), ANU)).body.data.item.name).toBe("Anu's rice");
  });

  it("answers a retried add with the item it added", async () => {
    const first = await addMine(RAHUL, rice, { "idempotency-key": "add-rice" });
    const again = await addMine(RAHUL, { ...rice, name: "Different" }, { "idempotency-key": "add-rice" });
    expect(again.status).toBe(201);
    expect(again.body.data.item.id).toBe(first.body.data.item.id);
    expect(count("kitchen_items")).toBe(1);
    // The key is per pantry: another person may use it too.
    expect((await addMine(ANU, rice, { "idempotency-key": "add-rice" })).body.data.item.id).not.toBe(first.body.data.item.id);
  });

  it("edits the name, category and use-by date, bumping the version", async () => {
    const added = await mine(RAHUL, rice);
    const { status, body } = await call<KitchenItemResponse>("PATCH", me(`items/${added.id}`), RAHUL, {
      name: "Basmati rice",
      category: "Staples",
      expiresOn: "2026-12-01",
    });
    expect(status).toBe(200);
    expect(body.data.item).toMatchObject({ name: "Basmati rice", category: "Staples", expiresOn: "2026-12-01", version: 2 });
    const cleared = await call<KitchenItemResponse>("PATCH", me(`items/${added.id}`), RAHUL, { expiresOn: null });
    expect(cleared.body.data.item).toMatchObject({ expiresOn: null, daysToUseBy: null, version: 3 });
  });

  it("changes quantity and price while nothing is used, in the item's unit or another", async () => {
    const added = await mine(RAHUL, rice);
    const same = await call<KitchenItemResponse>("PATCH", me(`items/${added.id}`), RAHUL, { quantity: "2", priceMinor: 20000 });
    expect(same.body.data.item).toMatchObject({ displayUnit: "kg", qtyBoughtMilli: 2_000_000, qtyLeftMilli: 2_000_000, priceMinor: 20000 });
    const other = await call<KitchenItemResponse>("PATCH", me(`items/${added.id}`), RAHUL, { quantity: 3, unit: "pack" });
    expect(other.body.data.item).toMatchObject({ dimension: "pack", displayUnit: "pack", qtyBought: 3, qtyLeftMilli: 3000 });
  });

  it("refuses to change what was bought, or remove the item, once some of it is used", async () => {
    const added = await mine(RAHUL, rice);
    use(added, 250_000, 2500);
    for (const body of [{ quantity: "2" }, { priceMinor: 1 }, { name: "Rice", priceMinor: 1 }]) {
      const res = await call("PATCH", me(`items/${added.id}`), RAHUL, body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "conflict", details: { reason: "item_used" } });
    }
    const removed = await call("DELETE", me(`items/${added.id}`), RAHUL);
    expect(removed.status).toBe(409);
    expect(removed.body.error.details).toEqual({ reason: "item_used" });
    // Naming it is still fine.
    const renamed = await call<KitchenItemResponse>("PATCH", me(`items/${added.id}`), RAHUL, { name: "Old rice" });
    expect(renamed.body.data.item).toMatchObject({ name: "Old rice", qtyLeftMilli: 1_000_000, worthMinor: 10000, priceMinor: 12500 });
  });

  it("counts a charged use as a use even when nothing left the pantry", async () => {
    const added = await mine(RAHUL, rice);
    h.db.prepare("UPDATE kitchen_items SET cost_taken_minor = 1 WHERE id = ?").run(uuidOf(added.id));
    expect((await call("PATCH", me(`items/${added.id}`), RAHUL, { priceMinor: 100 })).status).toBe(409);
  });

  it("refuses an edit based on a stale version, saying which is current", async () => {
    const added = await mine(RAHUL, rice);
    await call("PATCH", me(`items/${added.id}`), RAHUL, { name: "Basmati", version: 1 });
    const stale = await call("PATCH", me(`items/${added.id}`), RAHUL, { name: "Jasmine", version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toEqual({ reason: "version_conflict", version: 2 });
  });

  it.each([
    [{}, "body"],
    [{ unit: "kg" }, "unit"],
    [{ quantity: "0" }, "quantity"],
    [{ quantity: "1", unit: "bushel" }, "unit"],
    [{ expiresOn: "2026-13-01" }, "expiresOn"],
    [{ version: 0 }, "version"],
    [{ wastePolicy: "buyer_absorbs" }, "body"],
  ])("is 422 for a malformed edit (%#)", async (body, field) => {
    const added = await mine(RAHUL, rice);
    const res = await call("PATCH", me(`items/${added.id}`), RAHUL, body);
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields).toHaveProperty([field]);
  });

  it("removes an unused item: it is gone from reads and lists", async () => {
    const added = await mine(RAHUL, rice);
    const removed = await call<KitchenItemResponse>("DELETE", me(`items/${added.id}`), RAHUL);
    expect(removed.status).toBe(200);
    expect(removed.body.data.item).toMatchObject({ state: "removed", version: 2 });
    expect((await call("GET", me(`items/${added.id}`), RAHUL)).status).toBe(404);
    expect((await call("DELETE", me(`items/${added.id}`), RAHUL)).status).toBe(404);
    expect((await call<ItemsPage>("GET", me("items"), RAHUL)).body.data.items).toEqual([]);
  });

  it("is 401 without an actor, 405 for a method the route lacks, 404 for a malformed id", async () => {
    expect((await call("GET", me("items"), null)).status).toBe(401);
    expect((await call("PUT", me("items"), RAHUL)).status).toBe(405);
    expect((await call("POST", me("pantries"), RAHUL)).status).toBe(405);
    expect((await call("GET", me("items/itm_nope"), RAHUL)).status).toBe(404);
    expect((await call("GET", me("items/txn_00000000000040008000000000000000"), RAHUL)).status).toBe(404);
  });
});

describe("a group pantry", () => {
  it("lets a member add an item, in the group's currency, paid by them unless they say who", async () => {
    const added = await inGroup(ANU, flat, { ...rice, expiresOn: "2026-11-04" });
    expect(added).toMatchObject({
      pantry: { kind: "group", orgId: flat.publicId, slug: flat.slug, name: "Flat 4B" },
      currency: "INR",
      paidBy: ANU,
      createdBy: ANU,
      wastePolicy: "split_equally",
      wastePolicyOverride: null,
      daysToUseBy: 2,
    });
    const forDev = await inGroup(ANU, flat, { ...rice, paidBy: DEV, wastePolicy: "buyer_absorbs" });
    expect(forDev).toMatchObject({ paidBy: DEV, createdBy: ANU, wastePolicy: "buyer_absorbs", wastePolicyOverride: "buyer_absorbs" });
  });

  it("records kitchen.item.added and no ledger transaction: buying splits nothing", async () => {
    const added = await inGroup(ANU, flat, rice);
    expect(count("kitchen_txns")).toBe(0);
    const events = h.db.prepare("SELECT * FROM events_event_log").all() as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "kitchen.item.added",
      source: "kitchen-worker",
      actor_id: ANU,
      org_id: flat.id,
      subject_kind: "kitchen_item",
      subject_id: uuidOf(added.id),
    });
    expect(JSON.parse(events[0]!.payload as string)).toMatchObject({
      orgId: flat.publicId,
      itemId: added.id,
      qtyMilli: 1_250_000,
      priceMinor: 12500,
      currency: "INR",
      paidBy: ANU,
    });
    expect(count("events_audit_entries")).toBe(1);
  });

  it("is 422 not_in_group when whoever paid is not in the group", async () => {
    const res = await addToGroup(ANU, flat, { ...rice, paidBy: OUTSIDER });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual({ reason: "not_in_group", subjectIds: [OUTSIDER] });
    expect(count("kitchen_items")).toBe(0);
  });

  describe("currency", () => {
    it("fixes the group's currency with its first item, as the ledger's first transaction does", async () => {
      await inGroup(ANU, flat, rice);
      const settings = await call<KitchenSettings>("GET", groupPath(flat, "settings"), RAHUL);
      expect(settings.body.data).toMatchObject({ currency: "INR", updatedAt: NOW.toISOString() });
      const locked = await call("PATCH", groupPath(flat, "settings"), RAHUL, { currency: "USD" });
      expect(locked.status).toBe(409);
      expect(locked.body.error.details).toMatchObject({ reason: "currency_locked" });
    });

    it("adds in the currency the group saved, and refuses another", async () => {
      expect((await call("PATCH", groupPath(lunch, "settings"), ANU, { currency: "EUR" })).status).toBe(200);
      expect((await inGroup(ANU, lunch, rice)).currency).toBe("EUR");
      expect((await inGroup(ANU, lunch, { ...rice, currency: "EUR" })).currency).toBe("EUR");
      const refused = await addToGroup(ANU, lunch, { ...rice, currency: "INR" });
      expect(refused.status).toBe(422);
      expect(refused.body.error.details).toEqual({ reason: "currency_mismatch", currency: "EUR" });
    });

    it("writes nothing when the group's currency changed between the read and the write", async () => {
      // Another write saved USD first; the add read INR. The batch must refuse it whole.
      const repo = createKitchenRepository(createSqlExecutor(d1Over(h.db)));
      await repo.upsertGroupSettings({ orgId: flat.id, currency: "USD", now: NOW });
      const result = await repo.createItem({
        item: {
          id: asUuid("11111111-1111-4111-8111-111111111111"),
          owner: { kind: "group", orgId: flat.id },
          name: "Rice", category: "Grains", dimension: "mass", displayUnit: "kg", qtyMilli: 1_000_000, priceMinor: 100,
          currency: "INR", paidBy: ANU, boughtOn: TODAY, expiresOn: null, wastePolicy: null, createdBy: ANU, idemKey: "k", now: NOW,
        },
        audit: {
          event: {
            id: "e".repeat(32), type: "kitchen.item.added", version: 1, source: "kitchen-worker", occurredAt: NOW,
            actorType: "user", actorId: ANU, orgId: flat.id, subjectKind: "kitchen_item", subjectId: "x", requestId: "r", payload: {},
          },
          audit: { id: "a".repeat(32), category: "kitchen", description: "x" },
        },
      });
      expect(result).toEqual({ ok: false, error: { kind: "currency_mismatch", currency: "USD" } });
      expect(count("kitchen_items")).toBe(0);
      expect(count("events_event_log")).toBe(0);
    });
  });

  describe("who may do what", () => {
    it("lets every member read: owner, admin, member and viewer", async () => {
      const added = await inGroup(ANU, flat, rice);
      for (const as of [RAHUL, ADMIN, ANU, VIEWER]) {
        const list = await call<ItemsPage>("GET", groupPath(flat, "items"), as);
        expect(list.status).toBe(200);
        expect(list.body.data.items.map((i) => i.id)).toEqual([added.id]);
        expect((await call<KitchenItemResponse>("GET", groupPath(flat, `items/${added.id}`), as)).body.data.item).toEqual(added);
      }
    });

    it("is the opaque 404 outside the group, for reads and writes alike", async () => {
      const added = await inGroup(ANU, flat, rice);
      for (const [method, path, body] of [
        ["GET", groupPath(flat, "items"), undefined],
        ["POST", groupPath(flat, "items"), rice],
        ["GET", groupPath(flat, `items/${added.id}`), undefined],
        ["PATCH", groupPath(flat, `items/${added.id}`), { name: "x" }],
        ["DELETE", groupPath(flat, `items/${added.id}`), undefined],
      ] as const) {
        const res = await call(method, path, OUTSIDER, body);
        expect(res.status).toBe(404);
        expect(res.body.error).toMatchObject({ code: "not_found", message: "Not found", details: {} });
      }
      // An item of another group reads as missing in this one.
      const theirs = await inGroup(OUTSIDER, elsewhere, rice);
      expect((await call("GET", groupPath(flat, `items/${theirs.id}`), RAHUL)).status).toBe(404);
    });

    it("lets members and admins add, but not a viewer", async () => {
      for (const as of [RAHUL, ADMIN, ANU]) expect((await addToGroup(as, flat, rice)).status).toBe(201);
      expect((await addToGroup(VIEWER, flat, rice)).status).toBe(404);
      expect(h.decisions.at(-1)?.request.action).toBe("kitchen.item.create");
    });

    it("lets only the buyer, or an owner or admin, change or remove an item", async () => {
      const added = await inGroup(ANU, flat, { ...rice, paidBy: DEV });
      // Anu added it, but Dev paid: Dev is the buyer.
      const byAnu = await call("PATCH", groupPath(flat, `items/${added.id}`), ANU, { name: "Anu's" });
      expect(byAnu.status).toBe(403);
      expect(byAnu.body.error).toMatchObject({ code: "forbidden", details: { reason: "not_buyer" } });
      expect((await call("DELETE", groupPath(flat, `items/${added.id}`), ANU)).status).toBe(403);
      // A viewer may not edit items at all: the route's grant, so the opaque 404.
      expect((await call("PATCH", groupPath(flat, `items/${added.id}`), VIEWER, { name: "x" })).status).toBe(404);

      for (const [as, name] of [[DEV, "Dev's rice"], [ADMIN, "Admin's fix"], [RAHUL, "Owner's fix"]] as const) {
        const res = await call<KitchenItemResponse>("PATCH", groupPath(flat, `items/${added.id}`), as, { name });
        expect(res.status).toBe(200);
        expect(res.body.data.item.name).toBe(name);
      }
      const removed = await call<KitchenItemResponse>("DELETE", groupPath(flat, `items/${added.id}`), ADMIN);
      expect(removed.body.data.item.state).toBe("removed");
      expect((await call("GET", groupPath(flat, `items/${added.id}`), RAHUL)).status).toBe(404);
    });

    it("changes the item's waste rule, and refuses quantity or price once it is used", async () => {
      const added = await inGroup(ANU, flat, rice);
      const overridden = await call<KitchenItemResponse>("PATCH", groupPath(flat, `items/${added.id}`), ANU, {
        wastePolicy: "buyer_absorbs",
      });
      expect(overridden.body.data.item).toMatchObject({ wastePolicy: "buyer_absorbs", wastePolicyOverride: "buyer_absorbs" });
      const followed = await call<KitchenItemResponse>("PATCH", groupPath(flat, `items/${added.id}`), ANU, { wastePolicy: null });
      expect(followed.body.data.item).toMatchObject({ wastePolicy: "split_equally", wastePolicyOverride: null });

      use(added, 1_250_000, 12500);
      const refused = await call("PATCH", groupPath(flat, `items/${added.id}`), RAHUL, { priceMinor: 100 });
      expect(refused.status).toBe(409);
      expect(refused.body.error.details).toEqual({ reason: "item_used" });
      expect((await call("DELETE", groupPath(flat, `items/${added.id}`), ANU)).status).toBe(409);
    });

    it("follows the group's waste rule until the item has its own", async () => {
      await call("PATCH", groupPath(flat, "settings"), RAHUL, { wastePolicy: "buyer_absorbs" });
      expect((await inGroup(ANU, flat, rice)).wastePolicy).toBe("buyer_absorbs");
    });
  });
});

describe("every pantry I can reach", () => {
  /** Rahul: his own pantry, Flat 4B (owner) and the Lunch club (viewer). */
  async function stock(): Promise<Record<string, KitchenItem>> {
    return {
      milk: await mine(RAHUL, { name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 6000, expiresOn: "2026-11-03" }),
      oats: await mine(RAHUL, { name: "Oats", category: "Grains", quantity: "500", unit: "g", priceMinor: 9900 }),
      curd: await mine(RAHUL, { name: "Curd", category: "Dairy", quantity: "400", unit: "g", priceMinor: 4000, expiresOn: "2026-10-30" }),
      tomatoes: await inGroup(ANU, flat, { name: "Tomatoes", category: "Veg", quantity: "1", unit: "kg", priceMinor: 4000, expiresOn: "2026-11-05" }),
      onions: await inGroup(DEV, flat, { name: "Onions", category: "Veg", quantity: "2", unit: "kg", priceMinor: 7000, expiresOn: "2026-11-20" }),
      eggs: await inGroup(ANU, flat, { name: "Eggs", category: "Dairy", quantity: "1", unit: "dozen", priceMinor: 8400, expiresOn: "2026-11-01" }),
      flour: await inGroup(ANU, lunch, { name: "Chapati flour", category: "Grains", quantity: "5", unit: "kg", priceMinor: 24000, expiresOn: "2026-11-04" }),
      // Not Rahul's: another person's pantry and a group he is not in.
      anus: await mine(ANU, { name: "Anu's milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 6000 }),
      theirs: await inGroup(OUTSIDER, elsewhere, { name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 6000 }),
    };
  }

  it("lists my pantry first, then each group by name, with counts and what each is worth", async () => {
    const items = await stock();
    use(items.tomatoes!, 500_000, 2000);
    await call("PATCH", groupPath(lunch, "settings"), ANU, { wastePolicy: "buyer_absorbs" });

    const before = h.groupsCalls;
    const { status, body } = await call<PantriesResponse>("GET", me("pantries"), RAHUL);
    expect(status).toBe(200);
    expect(body.data.pantries).toEqual([
      { kind: "personal", name: "My pantry", itemCount: 3, useSoonCount: 1, expiredCount: 1, worthMinor: 19900, currency: "INR" },
      {
        kind: "group", orgId: flat.publicId, slug: flat.slug, name: "Flat 4B",
        itemCount: 3, useSoonCount: 1, expiredCount: 1, worthMinor: 2000 + 7000 + 8400, currency: "INR", wastePolicy: "split_equally",
      },
      {
        kind: "group", orgId: lunch.publicId, slug: lunch.slug, name: "Lunch club",
        itemCount: 1, useSoonCount: 1, expiredCount: 0, worthMinor: 24000, currency: "INR", wastePolicy: "buyer_absorbs",
      },
    ]);
    // Membership is asked once, and policy not at all: every group role reads its pantry.
    expect(h.groupsCalls - before).toBe(1);
  });

  it("shows an empty personal pantry, and a person in no group, in INR", async () => {
    const { body } = await call<PantriesResponse>("GET", me("pantries"), "usr_new");
    expect(body.data.pantries).toEqual([
      { kind: "personal", name: "My pantry", itemCount: 0, useSoonCount: 0, expiredCount: 0, worthMinor: 0, currency: "INR" },
    ]);
  });

  it("values a personal pantry in the currency most of its items are in", async () => {
    await mine(RAHUL, { ...rice, currency: "USD", priceMinor: 300 });
    await mine(RAHUL, { ...rice, currency: "USD", priceMinor: 200 });
    await mine(RAHUL, { ...rice, priceMinor: 9999 });
    const { body } = await call<PantriesResponse>("GET", me("pantries"), RAHUL);
    expect(body.data.pantries[0]).toMatchObject({ itemCount: 3, worthMinor: 500, currency: "USD" });
  });

  it("lists items across every pantry, soonest use-by first, then by name, undated last", async () => {
    const items = await stock();
    const { body } = await call<ItemsPage>("GET", me("items"), RAHUL);
    expect(body.data.items.map((i) => i.name)).toEqual(["Curd", "Eggs", "Milk", "Chapati flour", "Tomatoes", "Onions", "Oats"]);
    expect(body.data.nextCursor).toBeNull();
    const byName = Object.fromEntries(body.data.items.map((i) => [i.name, i]));
    expect(byName.Curd).toMatchObject({ pantry: { kind: "personal" }, daysToUseBy: -3 });
    expect(byName.Eggs).toMatchObject({ pantry: { kind: "group", orgId: flat.publicId, name: "Flat 4B" }, daysToUseBy: -1 });
    expect(byName["Chapati flour"]).toMatchObject({ pantry: { kind: "group", orgId: lunch.publicId, name: "Lunch club" } });
    expect(byName.Oats!.daysToUseBy).toBeNull();
    expect(body.data.items.map((i) => i.id)).not.toContain(items.anus!.id);
    expect(body.data.items.map((i) => i.id)).not.toContain(items.theirs!.id);
  });

  it.each([
    ["soon", ["Milk", "Chapati flour", "Tomatoes"]],
    ["expired", ["Curd", "Eggs"]],
    ["all", ["Curd", "Eggs", "Milk", "Chapati flour", "Tomatoes", "Onions", "Oats"]],
  ])("filters %s: soon is today to three days ahead, expired is before today", async (filter, names) => {
    await stock();
    const { body } = await call<ItemsPage>("GET", me(`items?filter=${filter}`), RAHUL);
    expect(body.data.items.map((i) => i.name)).toEqual(names);
  });

  it("narrows to one pantry, and searches names", async () => {
    await stock();
    const names = async (query: string) =>
      (await call<ItemsPage>("GET", me(`items?${query}`), RAHUL)).body.data.items.map((i) => i.name);
    expect(await names("pantry=personal")).toEqual(["Curd", "Milk", "Oats"]);
    expect(await names(`pantry=${lunch.publicId}`)).toEqual(["Chapati flour"]);
    expect(await names(`pantry=${flat.publicId}&filter=soon`)).toEqual(["Tomatoes"]);
    expect(await names("q=MIL")).toEqual(["Milk"]);
    expect(await names("q=o&pantry=personal")).toEqual(["Oats"]);
    expect(await names("q=50%25")).toEqual([]);
  });

  it("is the opaque 404 for a group I am not in, and 422 for a malformed query", async () => {
    await stock();
    expect((await call("GET", me(`items?pantry=${elsewhere.publicId}`), RAHUL)).status).toBe(404);
    for (const [query, field] of [
      ["pantry=everything", "pantry"],
      ["filter=old", "filter"],
      ["limit=0", "limit"],
      ["limit=101", "limit"],
      ["cursor=nope", "cursor"],
      [`q=${"x".repeat(101)}`, "q"],
    ]) {
      const res = await call("GET", me(`items?${query}`), RAHUL);
      expect(res.status).toBe(422);
      expect(res.body.error.details.fields).toHaveProperty([field]);
    }
  });

  it("pages with a cursor, in the same order", async () => {
    await stock();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `items?limit=3&cursor=${cursor}` : "items?limit=3";
      const { body } = await call<ItemsPage>("GET", me(query), RAHUL);
      expect(body.meta.cursor).toBe(body.data.nextCursor);
      seen.push(...body.data.items.map((i) => i.name));
      cursor = body.data.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual(["Curd", "Eggs", "Milk", "Chapati flour", "Tomatoes", "Onions", "Oats"]);
  });

  it("pages names that are not ASCII", async () => {
    for (const name of ["Ändra", "दूध", "Zeera", "आटा", "Ēggs"]) await mine(RAHUL, { ...rice, name });
    const first = await call<ItemsPage>("GET", me("items?limit=2"), RAHUL);
    const rest = await call<ItemsPage>("GET", me(`items?limit=10&cursor=${first.body.data.nextCursor}`), RAHUL);
    const all = [...first.body.data.items, ...rest.body.data.items].map((i) => i.name);
    expect(new Set(all).size).toBe(5);
  });

  it("is 503 when membership cannot say which groups I am in", async () => {
    h.failGroups = true;
    expect((await call("GET", me("pantries"), RAHUL)).status).toBe(503);
    expect((await call("GET", me("items"), RAHUL)).status).toBe(503);
    expect((await call("GET", me("search?q=milk"), RAHUL)).status).toBe(503);
    // My own pantry alone needs nothing from membership.
    expect((await call("GET", me("items?pantry=personal"), RAHUL)).status).toBe(200);
  });
});

describe("GET /v1/kitchen/me/search", () => {
  it("ranks exact names, then names starting with it, then a word starting with it, then the rest — soonest first in each", async () => {
    await mine(RAHUL, { name: "Buttermilk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 100, expiresOn: "2026-11-02" });
    await mine(RAHUL, { name: "Soy milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 100, expiresOn: "2026-11-09" });
    await inGroup(ANU, flat, { name: "Almond milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 100, expiresOn: "2026-11-03" });
    await inGroup(ANU, lunch, { name: "Milk powder", category: "Dairy", quantity: "1", unit: "pack", priceMinor: 100 });
    await inGroup(ANU, flat, { name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 100, expiresOn: "2026-11-10" });
    await inGroup(ANU, flat, { name: "Rice", category: "Grains", quantity: "1", unit: "kg", priceMinor: 100 });
    await inGroup(OUTSIDER, elsewhere, { name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 100 });

    const { status, body } = await call<SearchItemsResponse>("GET", me("search?q=milk"), RAHUL);
    expect(status).toBe(200);
    expect(body.data.items.map((i) => i.name)).toEqual(["Milk", "Milk powder", "Almond milk", "Soy milk", "Buttermilk"]);
    expect(body.data.items.map((i) => i.pantry.kind)).toEqual(["group", "group", "group", "personal", "personal"]);
  });

  it("finds only items with something left, and limits the answer", async () => {
    const gone = await mine(RAHUL, { ...rice, name: "Rice flour" });
    use(gone, 1_250_000, 12500);
    const removed = await mine(RAHUL, { ...rice, name: "Rice noodles" });
    await call("DELETE", me(`items/${removed.id}`), RAHUL);
    await mine(RAHUL, rice);
    await mine(RAHUL, { ...rice, name: "Rice bran oil" });

    const found = await call<SearchItemsResponse>("GET", me("search?q=rice"), RAHUL);
    expect(found.body.data.items.map((i) => i.name)).toEqual(["Rice", "Rice bran oil"]);
    const one = await call<SearchItemsResponse>("GET", me("search?q=rice&limit=1"), RAHUL);
    expect(one.body.data.items.map((i) => i.name)).toEqual(["Rice"]);
    expect((await call("GET", me("search?limit=51"), RAHUL)).status).toBe(422);
  });

  it("answers everything with something left, soonest first, for an empty query", async () => {
    await mine(RAHUL, { ...rice, name: "Late", expiresOn: "2026-12-01" });
    await mine(RAHUL, { ...rice, name: "Soon", expiresOn: "2026-11-03" });
    const { body } = await call<SearchItemsResponse>("GET", me("search"), RAHUL);
    expect(body.data.items.map((i) => i.name)).toEqual(["Soon", "Late"]);
  });
});
