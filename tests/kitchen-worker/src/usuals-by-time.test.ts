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
