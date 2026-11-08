// Usuals by time of day and by food (cookpool-pantry PN-2, design §2.1):
// GET /v1/kitchen/me/usuals?tzOffset= — the current bucket in the caller's
// zone, each past use in the bucket of its own local hour (across midnight
// too), usuals kept per food in a pantry so a new pack inherits them, `now`
// from 2 uses in the bucket and `strip` from 3, reversed uses left out, and a
// 60-day window for `now` beside the 90 days of the last use — through the
// router, against real SQLite with every migration applied.

import type {
  InboxResponse,
  KitchenItem,
  KitchenItemResponse,
  KitchenTxn,
  KitchenUsual,
  StockMoveResponse,
  UseSoonInboxItem,
  UsualsResponse,
} from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-02T08:00:00.000Z"); // 08:00 UTC, 13:30 in India
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RAHUL = "usr_rahul";
const MEERA = "usr_meera"; // buys the milk
const ANU = "usr_anu";

let h: Harness;
let clock: Date;
let flat: Group;
let lunch: Group;

beforeEach(() => {
  clock = NOW;
  h = createHarness({ deps: { now: () => clock } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  h.grant(RAHUL, flat, "owner");
  h.grant(MEERA, flat, "builder");
  h.grant(ANU, flat, "builder");
  h.grant(ANU, lunch, "owner");
  h.grant(RAHUL, lunch, "builder");
});

afterEach(() => h.close());

async function call<T>(method: string, url: string, as: string, body?: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

const me = (rest: string) => `/v1/kitchen/me/${rest}`;
const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

const milk = { name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 6000 };
const oats = { name: "Oats", category: "Grains", quantity: "500", unit: "g", priceMinor: 9900 };

async function groupItem(as: string, g: Group, body: Record<string, unknown> = milk): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function myItem(as: string, body: Record<string, unknown> = oats): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", me("items"), as, body);
  expect(res.status).toBe(201);
  return res.body.data.item;
}

/** A use at `when` (the clock moves there and back). */
async function useAt(when: Date, as: string, g: Group | null, item: KitchenItem, body: Record<string, unknown>): Promise<StockMoveResponse> {
  const was = clock;
  clock = when;
  const res = await call<StockMoveResponse>("POST", g ? groupPath(g, `items/${item.id}/uses`) : me(`items/${item.id}/uses`), as, body);
  clock = was;
  expect(res.status).toBe(201);
  return res.body.data;
}

/** `days` before NOW at hh:mm UTC. */
function utc(days: number, hhmm: string): Date {
  const day = new Date(NOW.getTime() - days * DAY).toISOString().slice(0, 10);
  return new Date(`${day}T${hhmm}:00.000Z`);
}

async function usuals(as: string, query = ""): Promise<UsualsResponse> {
  const res = await call<UsualsResponse>("GET", me(`usuals${query}`), as);
  expect(res.status).toBe(200);
  return res.body.data;
}

function byName(found: UsualsResponse): Record<string, KitchenUsual> {
  return Object.fromEntries(found.usuals.map((u) => [u.name, u]));
}

describe("GET /v1/kitchen/me/usuals?tzOffset=: the bucket", () => {
  it("answers the current bucket in the caller's zone, UTC by default", async () => {
    expect((await usuals(RAHUL)).bucket).toBe("morning"); // 08:00
    expect((await usuals(RAHUL, "?tzOffset=0")).bucket).toBe("morning");
    expect((await usuals(RAHUL, "?tzOffset=330")).bucket).toBe("midday"); // 13:30
    expect((await usuals(RAHUL, "?tzOffset=480")).bucket).toBe("evening"); // 16:00
    expect((await usuals(RAHUL, "?tzOffset=-300")).bucket).toBe("night"); // 03:00
    expect((await usuals(RAHUL, "?tzOffset=-180")).bucket).toBe("morning"); // 05:00
    expect((await usuals(RAHUL, "?tzOffset=840")).bucket).toBe("night"); // 22:00
    expect((await usuals(RAHUL, "?tzOffset=-720")).bucket).toBe("evening"); // 20:00 the day before
  });

  it("is 422 for an offset that is not whole minutes from −720 to 840, and takes a limit up to 100", async () => {
    for (const bad of ["841", "-721", "5.5", "abc", "1e2", "+60", "99999"]) {
      const res = await call<UsualsResponse>("GET", me(`usuals?tzOffset=${encodeURIComponent(bad)}`), RAHUL);
      expect([bad, res.status]).toEqual([bad, 422]);
      expect(res.body.error.details.fields).toHaveProperty(["tzOffset"]);
    }
    expect((await call("GET", me("usuals?tzOffset="), RAHUL)).status).toBe(200);
    expect((await call("GET", me("usuals?limit=100"), RAHUL)).status).toBe(200);
    expect((await call("GET", me("usuals?limit=101"), RAHUL)).status).toBe(422);
  });

  it("puts each use in the bucket of its own local hour, across midnight and at the 05:00 edge", async () => {
    const flatMilk = await groupItem(MEERA, flat, { ...milk, quantity: "5" });
    const tea = await myItem(RAHUL, { name: "Tea", category: "Drinks", quantity: "250", unit: "g", priceMinor: 3000 });
    // Milk late each evening in UTC: 23:00–23:20.
    await useAt(utc(3, "23:00"), RAHUL, flat, flatMilk, { quantity: "250", unit: "ml" });
    await useAt(utc(2, "23:10"), RAHUL, flat, flatMilk, { quantity: "250", unit: "ml" });
    await useAt(utc(1, "23:20"), RAHUL, flat, flatMilk, { quantity: "250", unit: "ml" });
    // Tea at 23:30, 23:30 and 23:29 UTC: 05:00, 05:00 and 04:59 in India.
    await useAt(utc(3, "23:30"), RAHUL, null, tea, { quantity: "5", unit: "g" });
    await useAt(utc(2, "23:30"), RAHUL, null, tea, { quantity: "5", unit: "g" });
    await useAt(utc(1, "23:29"), RAHUL, null, tea, { quantity: "5", unit: "g" });
    clock = utc(0, "01:00");

    const at = async (tzOffset: number) => {
      const found = await usuals(RAHUL, `?tzOffset=${tzOffset}`);
      const all = byName(found);
      return { bucket: found.bucket, milk: [all.Milk!.now?.count ?? null, all.Milk!.strip], tea: [all.Tea!.now?.count ?? null, all.Tea!.strip] };
    };
    // UTC: 01:00 is night, and so is every use.
    expect(await at(0)).toEqual({ bucket: "night", milk: [3, true], tea: [3, true] });
    // UTC+6: 07:00 is morning; the milk fell at 05:00–05:20 the next day, morning too; the tea at 05:29–05:30.
    expect(await at(360)).toEqual({ bucket: "morning", milk: [3, true], tea: [3, true] });
    // India: 06:30 is morning; the milk fell at 04:30–04:50, still night; two teas at 05:00 count, the one at 04:59 doesn't.
    expect(await at(330)).toEqual({ bucket: "morning", milk: [null, false], tea: [2, false] });
    // UTC−2: 23:00 the day before is night; the milk at 21:00–21:20 is night.
    expect(await at(-120)).toEqual({ bucket: "night", milk: [3, true], tea: [3, true] });
    // UTC−3: 22:00 is night; the milk at 20:00–20:20 and the tea at 20:29–20:30 were evening.
    expect(await at(-180)).toEqual({ bucket: "night", milk: [null, false], tea: [null, false] });
    // The bucket usual says which bucket it is for.
    expect(byName(await usuals(RAHUL, "?tzOffset=360")).Tea!.now).toEqual({
      bucket: "morning", qtyMilli: 5000, quantity: 5, unit: "g", label: null, consumerIds: [RAHUL], count: 3,
    });
  });
});

describe("GET /v1/kitchen/me/usuals: kept per food, in one pantry", () => {
  it("gives a new pack the old one's usual, and the same name in another pantry or counted another way none", async () => {
    const first = await groupItem(MEERA, flat);
    // Four mornings' glasses, the last for Anu too, then the rest: the first pack is used up.
    await useAt(utc(3, "07:00"), RAHUL, flat, first, { quantity: "250", unit: "ml" });
    await useAt(utc(2, "07:00"), RAHUL, flat, first, { quantity: "250", unit: "ml" });
    await useAt(utc(1, "07:00"), RAHUL, flat, first, { quantity: "250", unit: "ml", consumers: [RAHUL, ANU] });
    const rest = await useAt(utc(1, "07:05"), RAHUL, flat, first, { quantity: "250", unit: "ml" });
    expect(rest.item.state).toBe("used_up");
    expect((await usuals(RAHUL)).usuals).toEqual([]);

    // A new pack, its name typed differently; the same name in my own pantry, in the Lunch club, and in packs.
    const second = await groupItem(MEERA, flat, { ...milk, name: "  MILK ", expiresOn: "2026-11-03" });
    expect(second.name).toBe("MILK");
    await myItem(RAHUL, milk);
    await groupItem(ANU, lunch, milk);
    await groupItem(MEERA, flat, { ...milk, quantity: "2", unit: "pack" });

    const found = await usuals(RAHUL);
    expect(found).toEqual({
      bucket: "morning",
      usuals: [
        {
          itemId: second.id,
          name: "MILK",
          pantry: { kind: "group", orgId: flat.publicId, slug: flat.slug, name: "Flat 4B" },
          lastQtyMilli: 250_000,
          lastQuantity: 250,
          lastUnit: "ml",
          lastLabel: null,
          consumers: [RAHUL],
          usedCount: 4,
          lastUsedAt: utc(1, "07:05").toISOString(),
          qtyLeftMilli: 1_000_000,
          measures: [],
          now: { bucket: "morning", qtyMilli: 250_000, quantity: 250, unit: "ml", label: null, consumerIds: [RAHUL], count: 4 },
          strip: true,
        },
      ],
    });
    // Anu was named once: the food is hers too, but once is no bucket usual.
    expect((await usuals(ANU)).usuals.map((u) => [u.itemId, u.usedCount, u.consumers, u.now, u.strip])).toEqual([
      [second.id, 1, [RAHUL, ANU], null, false],
    ]);
    // Home's use-soon card reads the same usual for the new pack.
    const inbox = (await call<InboxResponse>("GET", me("inbox"), RAHUL)).body.data.items;
    const soon = inbox.filter((i): i is UseSoonInboxItem => i.kind === "use_soon");
    expect(soon.map((i) => [i.item.id, i.usual])).toEqual([[second.id, { quantity: 250, unit: "ml", qtyMilli: 250_000 }]]);

    // Once the new pack has a use of its own, its last use is its own; the bucket still counts the food.
    await useAt(NOW, RAHUL, flat, second, { quantity: "100", unit: "ml" });
    expect((await usuals(RAHUL)).usuals.map((u) => [u.itemId, u.lastQtyMilli, u.usedCount, u.now?.qtyMilli, u.now?.count])).toEqual([
      [second.id, 100_000, 5, 250_000, 5],
    ]);
  });

  it("keeps each open pack's own last use, and counts the food for both", async () => {
    const a = await groupItem(MEERA, flat, { name: "Paneer", category: "Dairy", quantity: "200", unit: "g", priceMinor: 9000 });
    const b = await groupItem(MEERA, flat, { name: "paneer", category: "Dairy", quantity: "200", unit: "g", priceMinor: 9000 });
    await useAt(utc(0, "07:00"), RAHUL, flat, a, { quantity: "50", unit: "g" });
    await useAt(utc(0, "07:10"), RAHUL, flat, b, { quantity: "30", unit: "g" });
    expect((await usuals(RAHUL)).usuals.map((u) => [u.itemId, u.lastQtyMilli, u.usedCount, u.lastUsedAt, u.now?.qtyMilli])).toEqual([
      [b.id, 30_000, 2, utc(0, "07:10").toISOString(), 30_000],
      [a.id, 50_000, 2, utc(0, "07:00").toISOString(), 30_000],
    ]);
  });
});

describe("GET /v1/kitchen/me/usuals: now and strip", () => {
  it("needs 2 uses in the bucket for now and 3 for the strip, and takes the most frequent amount, ties to the most recent", async () => {
    const rice = await myItem(RAHUL, { name: "Rice", category: "Grains", quantity: "5", unit: "kg", priceMinor: 40000 });
    const dal = await myItem(RAHUL, { name: "Dal", category: "Grains", quantity: "1", unit: "kg", priceMinor: 15000 });
    const flatMilk = await groupItem(MEERA, flat, { ...milk, quantity: "5" });
    // Rice once in the morning; dal twice, two amounts.
    await useAt(utc(2, "08:00"), RAHUL, null, rice, { quantity: "100", unit: "g" });
    await useAt(utc(2, "09:00"), RAHUL, null, dal, { quantity: "100", unit: "g" });
    await useAt(utc(1, "09:00"), RAHUL, null, dal, { quantity: "200", unit: "g" });
    // Milk: 250 ml twice (the later for Anu too), 100 ml once and last — and every evening 500 ml, which doesn't count now.
    await useAt(utc(3, "07:00"), RAHUL, flat, flatMilk, { quantity: "250", unit: "ml" });
    await useAt(utc(2, "07:00"), RAHUL, flat, flatMilk, { quantity: "0.25", unit: "L", consumers: [RAHUL, ANU] });
    await useAt(utc(1, "07:00"), RAHUL, flat, flatMilk, { quantity: "100", unit: "ml" });
    for (const days of [3, 2, 1]) await useAt(utc(days, "18:00"), RAHUL, flat, flatMilk, { quantity: "500", unit: "ml" });

    const morning = byName(await usuals(RAHUL));
    expect(Object.fromEntries(Object.entries(morning).map(([name, u]) => [name, [u.now?.qtyMilli ?? null, u.now?.count ?? null, u.strip]]))).toEqual({
      Rice: [null, null, false],
      Dal: [200_000, 2, false],
      Milk: [250_000, 3, true],
    });
    // The 250 ml as it was last logged: in litres, for Rahul and Anu.
    expect(morning.Milk!.now).toEqual({
      bucket: "morning", qtyMilli: 250_000, quantity: 0.25, unit: "L", label: null, consumerIds: [RAHUL, ANU], count: 3,
    });
    // The last use is still the last one, whatever the bucket: the evening's 500 ml.
    expect([morning.Milk!.lastQtyMilli, morning.Milk!.usedCount]).toEqual([500_000, 6]);
    // At 18:30 the bucket is the evening, and the milk's usual the 500 ml.
    clock = utc(0, "18:30");
    const evening = byName(await usuals(RAHUL));
    expect(evening.Milk!.now).toMatchObject({ bucket: "evening", qtyMilli: 500_000, count: 3 });
    expect([evening.Dal!.now, evening.Rice!.strip]).toEqual([null, false]);
  });

  it("leaves out reversed uses", async () => {
    const mine = await myItem(RAHUL);
    const flatMilk = await groupItem(MEERA, flat, { ...milk, quantity: "5" });
    await useAt(utc(2, "08:00"), RAHUL, null, mine, { quantity: "40", unit: "g" });
    await useAt(utc(1, "08:00"), RAHUL, null, mine, { quantity: "40", unit: "g" });
    const third = await useAt(utc(0, "07:00"), RAHUL, null, mine, { quantity: "60", unit: "g" });
    await useAt(utc(2, "08:00"), RAHUL, flat, flatMilk, { quantity: "200", unit: "ml" });
    const charged = await useAt(utc(1, "08:00"), RAHUL, flat, flatMilk, { quantity: "200", unit: "ml" });
    let all = byName(await usuals(RAHUL));
    expect([all.Oats!.lastQtyMilli, all.Oats!.now?.qtyMilli, all.Oats!.now?.count, all.Oats!.strip]).toEqual([60_000, 40_000, 3, true]);
    expect([all.Milk!.now?.count, all.Milk!.usedCount]).toEqual([2, 2]);

    // Undo my own oats; reverse the charge for the milk.
    expect((await call("POST", me(`moves/${third.move.id}/undo`), RAHUL)).status).toBe(201);
    const reversed = await call<{ txn: KitchenTxn }>("POST", groupPath(flat, `txns/${charged.txn!.id}/reverse`), RAHUL);
    expect(reversed.status).toBe(201);
    all = byName(await usuals(RAHUL));
    expect([all.Oats!.lastQtyMilli, all.Oats!.usedCount, all.Oats!.now?.count, all.Oats!.strip]).toEqual([40_000, 2, 2, false]);
    expect([all.Milk!.usedCount, all.Milk!.now, all.Milk!.strip]).toEqual([1, null, false]);
  });

  it("looks back 60 days for now, and keeps the last use for 90", async () => {
    clock = new Date(NOW.getTime() - 120 * DAY);
    const rice = await myItem(RAHUL, { name: "Rice", category: "Grains", quantity: "5", unit: "kg", priceMinor: 40000 });
    const dal = await myItem(RAHUL, { name: "Dal", category: "Grains", quantity: "1", unit: "kg", priceMinor: 15000 });
    clock = NOW;
    // Dal: three mornings, 100 days ago — past both windows.
    for (const days of [102, 101, 100]) await useAt(utc(days, "08:00"), RAHUL, null, dal, { quantity: "50", unit: "g" });
    // Rice: three mornings 70 days ago, then one 59 days ago.
    for (const days of [72, 71, 70]) await useAt(utc(days, "08:00"), RAHUL, null, rice, { quantity: "100", unit: "g" });
    await useAt(utc(59, "08:00"), RAHUL, null, rice, { quantity: "150", unit: "g" });

    let found = await usuals(RAHUL);
    expect(found.usuals.map((u) => [u.name, u.usedCount, u.lastQtyMilli, u.now, u.strip])).toEqual([["Rice", 4, 150_000, null, false]]);
    // One more morning inside 60 days: two there, so a usual — the most recent of two amounts.
    await useAt(utc(1, "08:00"), RAHUL, null, rice, { quantity: "100", unit: "g" });
    found = await usuals(RAHUL);
    expect(found.usuals.map((u) => [u.name, u.usedCount, u.now?.qtyMilli, u.now?.count, u.strip])).toEqual([["Rice", 5, 100_000, 2, false]]);
  });
});
