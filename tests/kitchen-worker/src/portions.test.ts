// Anyone's portion (SM-6): PUT …/dishes/{dsh}/claims/{subjectId} — any
// member sets any member's half portions of an open dish under the claims'
// guard (never more than the portions, however many members write at once),
// every share records who set it (`set_by`, migration 290) and every dish
// read returns it, and the person whose portion someone else set is emailed
// once per dish (`kitchen.portion_set`), after the write commits. Through the
// router, against real SQLite (every migration applied), the real policy
// grants and membership's answers; notifications-worker is the harness's
// recorder.

import type { DishResponse, KitchenDish, KitchenItem, KitchenItemResponse } from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness, type RecordedNotification } from "./harness.js";

const NOW = new Date("2026-11-04T12:00:00.000Z");

const RAHUL = "usr_rahul"; // cooks; builder in Flat 4B
const ANU = "usr_anu"; // owner of Flat 4B
const DEV = "usr_dev";
const MEERA = "usr_meera";
const VIEWER = "usr_viewer"; // a viewer in Flat 4B
const KIRAN = "usr_kiran"; // the Lunch club only
const OUTSIDER = "usr_outsider";

let h: Harness;
let flat: Group;
let lunch: Group;

beforeEach(() => {
  h = createHarness({ deps: { now: () => NOW } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  h.grant(RAHUL, flat, "builder");
  h.grant(ANU, flat, "owner");
  h.grant(DEV, flat, "builder");
  h.grant(MEERA, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(KIRAN, lunch, "owner");
  h.grant(OUTSIDER, newGroup("Another flat"), "owner");
  for (const [who, name] of [[RAHUL, "Rahul"], [ANU, "Anu"], [DEV, "Dev"], [MEERA, "Meera"], [VIEWER, "Vee"]] as const) {
    h.profile(who, { displayName: name, email: `${name.toLowerCase()}@example.com` });
  }
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
const dishPath = (g: Group, dish: KitchenDish, rest: string) => groupPath(g, `dishes/${dish.id}/${rest}`);

/** `as` sets `who`'s half portions (`me` for their own). */
const setPortion = (as: string, dish: KitchenDish, who: string, portionsHalf: unknown, g = flat) =>
  call<DishResponse>("PUT", dishPath(g, dish, `claims/${who}`), as, { portionsHalf });

async function rice(): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", me("items"), RAHUL, {
    name: "Rice", category: "Grains", quantity: "1", unit: "kg", priceMinor: 6000,
  });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

/** Rahul's egg fried rice in Flat 4B: 4 portions, ₹30.00 of rice and ₹10.00 of extras — ₹10.00 a portion. */
async function eggFriedRice(splitMode: "claims" | "assign" = "claims", name = "Egg fried rice"): Promise<KitchenDish> {
  const item = await rice();
  const res = await call<DishResponse>("POST", me("dishes"), RAHUL, {
    name, orgId: flat.publicId, portionsHalf: 8, extrasMinor: 1000, splitMode,
    ingredients: [{ itemId: item.id, quantity: "500", unit: "g" }],
  });
  expect(res.status).toBe(201);
  expect(res.body.data.dish).toMatchObject({ totalMinor: 4000, state: splitMode === "claims" ? "open" : "draft" });
  return res.body.data.dish;
}

async function readDish(as: string, dish: KitchenDish): Promise<KitchenDish> {
  const res = await call<DishResponse>("GET", me(`dishes/${dish.id}`), as);
  expect(res.status).toBe(200);
  return res.body.data.dish;
}

const rows = (dish: KitchenDish) => dish.shares.map((s) => [s.subjectId, s.portionsHalf, s.source, s.setBy]);

function count(table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** What a refused write must leave untouched. */
function written(): Record<string, number> {
  return {
    shares: count("kitchen_dish_shares"),
    events: count("events_event_log"),
    version: (h.db.prepare("SELECT COALESCE(SUM(version), 0) AS v FROM kitchen_dishes").get() as { v: number }).v,
  };
}

/** The stored UUID behind a `<prefix>_<32 hex>` id. */
function uuidOf(publicId: string): string {
  const hex = publicId.slice(publicId.indexOf("_") + 1);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const sent = (): RecordedNotification[] => h.notifications.filter((n) => n.request.templateKey === "kitchen.portion_set");
const firstSends = (): RecordedNotification[] => sent().filter((n) => !n.replayed);
const to = (n: RecordedNotification) => n.request.recipient.subjectId;

// ── Setting anyone's portion ─────────────────────────────────

describe("setting someone else's portion", () => {
  it("is any member's, for any member, and the row says who set it; the latest write wins", async () => {
    const dish = await eggFriedRice();

    // Anu says Dev had a portion.
    const set = await setPortion(ANU, dish, DEV, 2);
    expect(set.status).toBe(200);
    expect(set.body.data.dish).toMatchObject({ myClaimHalf: 0, claimedHalf: 2, unclaimedHalf: 6 });
    expect(rows(set.body.data.dish)).toEqual([[DEV, 2, "self", ANU]]);
    expect(set.body.data.dish.amounts.find((a) => a.subjectId === DEV)).toEqual({ subjectId: DEV, portionsHalf: 2, exactMinor: null, owedMinor: 1000 });
    // Dev reads it as his.
    expect(await readDish(DEV, dish)).toMatchObject({ myClaimHalf: 2 });
    expect(h.db.prepare("SELECT subject_id, set_by FROM kitchen_dish_shares").all()).toEqual([{ subject_id: DEV, set_by: ANU }]);

    // Dev changes it himself; then Meera; then the cook — each the author of the latest write.
    expect(rows((await setPortion(DEV, dish, "me", 3)).body.data.dish)).toEqual([[DEV, 3, "self", DEV]]);
    expect(rows((await setPortion(MEERA, dish, DEV, 1)).body.data.dish)).toEqual([[DEV, 1, "self", MEERA]]);
    expect(rows((await setPortion(RAHUL, dish, DEV, 2)).body.data.dish)).toEqual([[DEV, 2, "self", RAHUL]]);

    // A viewer cannot set portions, but eats: anyone may set theirs. And the cook's own.
    expect((await setPortion(ANU, dish, VIEWER, 1)).status).toBe(200);
    expect((await setPortion(DEV, dish, RAHUL, 2)).status).toBe(200);
    // Naming yourself is claims/me.
    const own = await setPortion(ANU, dish, ANU, 2);
    expect(own.body.data.dish).toMatchObject({ myClaimHalf: 2, claimedHalf: 7, unclaimedHalf: 1 });
    // In split order: the cook first, then as claimed.
    expect(rows(await readDish(VIEWER, dish))).toEqual([
      [RAHUL, 2, "self", DEV],
      [DEV, 2, "self", RAHUL],
      [VIEWER, 1, "self", ANU],
      [ANU, 2, "self", ANU],
    ]);

    // 0 takes someone's portion back.
    const back = await setPortion(MEERA, dish, VIEWER, 0);
    expect(back.status).toBe(200);
    expect(back.body.data.dish.shares.map((s) => s.subjectId)).toEqual([RAHUL, DEV, ANU]);
  });

  it("keeps claims/me the caller's own, recording them as who set it", async () => {
    const dish = await eggFriedRice();
    const res = await setPortion(MEERA, dish, "me", 3);
    expect(res.status).toBe(200);
    expect(res.body.data.dish).toMatchObject({ myClaimHalf: 3 });
    expect(rows(res.body.data.dish)).toEqual([[MEERA, 3, "self", MEERA]]);
    expect(res.body.data.dish.shares[0]).toMatchObject({ id: expect.stringMatching(/^dsr_[0-9a-f]{32}$/), setBy: MEERA });
  });

  it("never lets everyone's portions exceed the dish's, and says what is free for that person", async () => {
    const dish = await eggFriedRice();
    expect((await setPortion(ANU, dish, DEV, 6)).status).toBe(200);
    const before = written();
    const over = await setPortion(MEERA, dish, RAHUL, 3);
    expect(over.status).toBe(409);
    expect(over.body.error.details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 2 });
    // Dev's own portion is not counted against him: Meera may raise it to everything.
    const all = await setPortion(MEERA, dish, DEV, 8);
    expect(all.body.data.dish).toMatchObject({ claimedHalf: 8, unclaimedHalf: 0 });
    expect(written().shares).toBe(before.shares);
    expect((await setPortion(ANU, dish, DEV, 9)).body.error.details).toMatchObject({ reason: "claims_exceed_portions", availableHalf: 8 });
  });

  it("holds the limit when another member's write lands between this one's read and its write", async () => {
    const dish = await eggFriedRice();
    // Meera sets Rahul's 3 portions just as Anu's 1½ for Dev is written: only 1 is left.
    h.beforeNextBatch((db) => {
      db.prepare(
        `INSERT INTO kitchen_dish_shares (id, dish_id, subject_id, position, portions_half, exact_minor, source, set_by)
         VALUES (?, ?, ?, 0, 6, NULL, 'self', ?)`,
      ).run(crypto.randomUUID(), uuidOf(dish.id), RAHUL, MEERA);
      db.prepare("UPDATE kitchen_dishes SET version = version + 1 WHERE id = ?").run(uuidOf(dish.id));
    });
    const res = await setPortion(ANU, dish, DEV, 3);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 2 });
    expect(rows(await readDish(DEV, dish))).toEqual([[RAHUL, 6, "self", MEERA]]);
    expect(sent()).toEqual([]);
  });

  it("lets only one of two members setting different people at once have the last portions", async () => {
    const dish = await eggFriedRice();
    const results = await Promise.all([setPortion(ANU, dish, DEV, 6), setPortion(MEERA, dish, RAHUL, 6)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = results.find((r) => r.status === 409)!;
    expect(refused.body.error.details).toEqual({ reason: "claims_exceed_portions", portionsHalf: 8, availableHalf: 2 });
    const after = await readDish(ANU, dish);
    expect(after).toMatchObject({ claimedHalf: 6, unclaimedHalf: 2 });
    expect(after.shares).toHaveLength(1);
    // Only the write that landed emails anyone.
    expect(firstSends()).toHaveLength(1);
  });

  it("is a member's: a viewer cannot, and outside the dish's group it is not there", async () => {
    const dish = await eggFriedRice();
    const before = written();
    for (const [who, g] of [[VIEWER, flat], [OUTSIDER, flat], [KIRAN, lunch], [RAHUL, lunch]] as const) {
      const res = await setPortion(who, dish, DEV, 2, g);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    }
    expect((await call("PUT", groupPath(flat, `dishes/dsh_${"0".repeat(32)}/claims/${DEV}`), ANU, { portionsHalf: 2 })).status).toBe(404);
    expect((await call("PUT", dishPath(flat, dish, `claims/${DEV}`), null, { portionsHalf: 2 })).status).toBe(401);
    expect((await call("POST", dishPath(flat, dish, `claims/${DEV}`), ANU, { portionsHalf: 2 })).status).toBe(405);
    expect(written()).toEqual(before);
    expect(sent()).toEqual([]);
  });

  it("is for someone in the group: not an outsider, not someone who left, not a malformed id", async () => {
    const dish = await eggFriedRice();
    const before = written();
    for (const who of [OUTSIDER, KIRAN]) {
      const res = await setPortion(ANU, dish, who, 2);
      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual({ reason: "not_in_group", subjectIds: [who] });
    }
    h.revoke(MEERA, flat);
    expect((await setPortion(ANU, dish, MEERA, 2)).body.error.details).toEqual({ reason: "not_in_group", subjectIds: [MEERA] });

    const malformed = await setPortion(ANU, dish, "not%20an%20id", 2);
    expect(malformed.status).toBe(422);
    expect(Object.keys(malformed.body.error.details.fields as Record<string, unknown>)).toEqual(["subjectId"]);
    for (const portionsHalf of [-1, 1.5, "2", null, 201]) {
      const res = await setPortion(ANU, dish, DEV, portionsHalf);
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.error.details.fields as Record<string, unknown>)).toEqual(["portionsHalf"]);
    }
    expect((await call("PUT", dishPath(flat, dish, `claims/${DEV}`), ANU, [2])).status).toBe(422);
    expect(written()).toEqual(before);
    expect(sent()).toEqual([]);
  });

  it("is only for an open dish: not an assigned draft, nor once finalized", async () => {
    const draft = await eggFriedRice("assign");
    const refused = await setPortion(ANU, draft, DEV, 2);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual({ reason: "dish_not_open", state: "draft" });

    const open = await eggFriedRice("claims", "Dal");
    expect((await call("POST", dishPath(flat, open, "finalize"), RAHUL)).status).toBe(200);
    expect((await setPortion(ANU, open, DEV, 2)).body.error.details).toEqual({ reason: "dish_not_open", state: "finalized" });
    expect(sent()).toEqual([]);
  });
});

// ── Who set it, on every share write ─────────────────────────

describe("who set a share", () => {
  it("is the caller of the cook's assignment and of a correction too, on every row", async () => {
    const dish = await eggFriedRice("assign");
    const assigned = await call<DishResponse>("PUT", dishPath(flat, dish, "shares"), RAHUL, {
      shares: [{ subjectId: ANU, portionsHalf: 2 }, { subjectId: DEV, exactMinor: 500 }],
    });
    expect(assigned.status).toBe(200);
    expect(rows(assigned.body.data.dish)).toEqual([[ANU, 2, "cook", RAHUL], [DEV, null, "cook", RAHUL]]);
    // An owner splitting a stuck dish is who set it.
    const byOwner = await call<DishResponse>("PUT", dishPath(flat, dish, "shares"), ANU, { shares: [{ subjectId: DEV, portionsHalf: 4 }] });
    expect(rows(byOwner.body.data.dish)).toEqual([[DEV, 4, "cook", ANU]]);

    expect((await call("POST", dishPath(flat, dish, "finalize"), RAHUL)).status).toBe(200);
    const corrected = await call<DishResponse>(
      "POST",
      dishPath(flat, dish, "correct"),
      RAHUL,
      { shares: [{ subjectId: DEV, portionsHalf: 2 }, { subjectId: MEERA, portionsHalf: 2 }] },
      { "idempotency-key": "fix-1" },
    );
    expect(corrected.status).toBe(200);
    expect(rows(corrected.body.data.dish)).toEqual([[DEV, 2, "cook", RAHUL], [MEERA, 2, "cook", RAHUL]]);
    // The cook's assignment and corrections email nobody.
    expect(sent()).toEqual([]);
  });

  it("reads as null for a share written before it was recorded, in every dish read", async () => {
    const dish = await eggFriedRice();
    h.db
      .prepare(
        `INSERT INTO kitchen_dish_shares (id, dish_id, subject_id, position, portions_half, exact_minor, source)
         VALUES (?, ?, ?, 0, 2, NULL, 'self')`,
      )
      .run(crypto.randomUUID(), uuidOf(dish.id), DEV);
    expect((await readDish(DEV, dish)).shares).toEqual([expect.objectContaining({ subjectId: DEV, setBy: null })]);
    const list = await call<{ dishes: KitchenDish[] }>("GET", groupPath(flat, "dishes"), MEERA);
    expect(list.body.data.dishes[0]!.shares[0]).toMatchObject({ subjectId: DEV, setBy: null });
    // Set again by someone, it says who.
    expect((await setPortion(MEERA, dish, DEV, 2)).body.data.dish.shares[0]).toMatchObject({ setBy: MEERA });
  });
});

// ── The email ────────────────────────────────────────────────

describe("the portion email", () => {
  it("tells the person someone else set their portion — once per dish, however often it changes", async () => {
    const dish = await eggFriedRice();
    expect((await setPortion(ANU, dish, DEV, 2)).status).toBe(200);
    expect(firstSends().map(to)).toEqual([DEV]);
    const [mail] = firstSends();
    expect(mail!.internalActor).toBe("kitchen-worker");
    expect(mail!.request).toMatchObject({
      orgId: flat.publicId,
      category: "product",
      templateKey: "kitchen.portion_set",
      recipient: { channel: "email", address: "dev@example.com", subjectKind: "user", subjectId: DEV },
      idempotencyKey: `kitchen.portion_set:${dish.id}:${DEV}`,
      templateData: {
        actorName: "Anu",
        dishName: "Egg fried rice",
        groupName: "Flat 4B",
        portions: "1",
        yourShare: "₹10.00",
        dishUrl: `https://cookpool.test/dishes/${dish.id}`,
      },
    });

    // Changed again by Anu, then by Meera: asked again, never sent twice.
    expect((await setPortion(ANU, dish, DEV, 3)).status).toBe(200);
    expect((await setPortion(MEERA, dish, DEV, 1)).status).toBe(200);
    expect(sent()).toHaveLength(3);
    expect(firstSends()).toHaveLength(1);

    // Another dish is another email.
    const dal = await eggFriedRice("claims", "Dal");
    expect((await setPortion(ANU, dal, DEV, 2)).status).toBe(200);
    expect(firstSends().map((n) => n.request.idempotencyKey)).toEqual([
      `kitchen.portion_set:${dish.id}:${DEV}`,
      `kitchen.portion_set:${dal.id}:${DEV}`,
    ]);
  });

  it("is not sent for your own portion, nor for taking someone's back", async () => {
    const dish = await eggFriedRice();
    expect((await setPortion(DEV, dish, "me", 2)).status).toBe(200);
    expect((await setPortion(ANU, dish, ANU, 2)).status).toBe(200);
    expect((await setPortion(ANU, dish, MEERA, 0)).status).toBe(200);
    expect(sent()).toEqual([]);
  });

  it("tells the cook only what their own portions cost, not the unclaimed ones", async () => {
    const dish = await eggFriedRice();
    expect((await setPortion(ANU, dish, RAHUL, 3)).status).toBe(200);
    expect(firstSends().map(to)).toEqual([RAHUL]);
    expect(firstSends()[0]!.request.templateData).toMatchObject({ portions: "1½", yourShare: "₹15.00" });
  });

  it("never fails the write: notifications-worker down, or identity unreadable", async () => {
    const dish = await eggFriedRice();
    h.failNotifications = true;
    expect((await setPortion(ANU, dish, DEV, 2)).body.data.dish.claimedHalf).toBe(2);
    h.failNotifications = false;
    h.failIdentity = true;
    expect((await setPortion(ANU, dish, MEERA, 2)).body.data.dish.claimedHalf).toBe(4);
    // The first was refused, the second had no address to send to.
    expect(sent()).toEqual([]);
  });

  it("is handed to waitUntil, after the write, when the runtime offers one", async () => {
    const deferred: Promise<unknown>[] = [];
    h.close();
    h = createHarness({ deps: { now: () => NOW, waitUntil: (work) => deferred.push(work) } });
    h.grant(RAHUL, flat, "builder");
    h.grant(ANU, flat, "owner");
    h.grant(DEV, flat, "builder");
    h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
    h.profile(DEV, { displayName: "Dev", email: "dev@example.com" });
    const dish = await eggFriedRice();
    deferred.length = 0;
    const res = await setPortion(ANU, dish, DEV, 2);
    expect(res.status).toBe(200);
    expect(deferred).toHaveLength(1);
    await Promise.all(deferred);
    expect(firstSends().map(to)).toEqual([DEV]);
  });
});
