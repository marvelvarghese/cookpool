// Cooked, then split later (Cookpool CM-8): the world the split-later and
// split-reminder suites share — design.md §3's people and groups, the worked
// example's pantries, and the calls they make through the router.

import type { BalancesResponse, DishResponse, KitchenDish, KitchenItem, KitchenItemResponse, KitchenTxn, ActivityPage } from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";
import { paneerButterMasalaBody, stockWorkedExample, type WorkedExamplePantries } from "./worked-example-fixtures.js";

export const NOW = new Date("2026-11-02T12:00:00.000Z");

export const RAHUL = "usr_rahul"; // cooks; builder in Flat 4B and the Lunch club, viewer in the Book club
export const ANU = "usr_anu"; // owner of Flat 4B
export const DEV = "usr_dev";
export const MEERA = "usr_meera";
export const KIRAN = "usr_kiran"; // the Lunch club only
export const LONER = "usr_loner"; // in no group at all

export interface World {
  h: Harness;
  /** The clock every request reads; move it with `w.clock = …`. */
  clock: Date;
  flat: Group;
  lunch: Group;
  books: Group;
  elsewhere: Group;
  call<T>(method: string, url: string, as: string | null, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Envelope<T> }>;
}

export const me = (rest: string) => `/v1/kitchen/me/${rest}`;
export const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;
export const dishPath = (g: Group, dish: KitchenDish | string, rest: string) =>
  groupPath(g, `dishes/${typeof dish === "string" ? dish : dish.id}/${rest}`);

export function world(): World {
  const w = {
    clock: NOW,
    flat: newGroup("Flat 4B"),
    lunch: newGroup("Lunch club"),
    books: newGroup("Book club"),
    elsewhere: newGroup("Another flat"),
  } as World;
  w.h = createHarness({ deps: { now: () => w.clock } });
  w.h.grant(RAHUL, w.flat, "builder");
  w.h.grant(ANU, w.flat, "owner");
  w.h.grant(DEV, w.flat, "builder");
  w.h.grant(MEERA, w.flat, "builder");
  w.h.grant(KIRAN, w.lunch, "owner");
  w.h.grant(RAHUL, w.lunch, "builder");
  w.h.grant(MEERA, w.books, "owner");
  w.h.grant(RAHUL, w.books, "viewer");
  w.h.grant(ANU, w.elsewhere, "owner");
  w.call = async <T>(method: string, url: string, as: string | null, body?: unknown, headers?: Record<string, string>) => {
    const res = await w.h.call(method, url, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
    return { status: res.status, body: await envelope<T>(res) };
  };
  return w;
}

export async function groupItem(w: World, as: string, g: Group, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await w.call<KitchenItemResponse>("POST", groupPath(g, "items"), as, { category: "Veg", ...body });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

export async function myItem(w: World, as: string, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await w.call<KitchenItemResponse>("POST", me("items"), as, { category: "Dairy", ...body });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

/** design.md §3's pantries: Rahul's paneer and butter, Anu's tomatoes and Dev's onions in Flat 4B, Kiran's flour in the Lunch club. */
export function stock(w: World): Promise<WorkedExamplePantries> {
  return stockWorkedExample(
    { myItem: (as, body) => myItem(w, as, body), groupItem: (as, g, body) => groupItem(w, as, g, body) },
    { flat: w.flat, lunch: w.lunch },
    { rahul: RAHUL, anu: ANU, dev: DEV, kiran: KIRAN },
  );
}

/** design.md §3's dish: into Flat 4B for claims, or (`own`) finished as Rahul's own, as Cooked! saves it. */
export async function cookWorkedExample(w: World, how: "group" | "own", key?: string): Promise<KitchenDish> {
  const body = paneerButterMasalaBody(await stock(w), w.flat, how === "own" ? { orgId: null, splitMode: "assign" } : {});
  const res = await w.call<DishResponse>("POST", me("dishes"), RAHUL, body, key ? { "idempotency-key": key } : undefined);
  expect(res.status).toBe(201);
  return res.body.data.dish;
}

/** A dish of the cook's own just-bought things (no pantry item), `portionsHalf` big. */
export async function cookOwn(
  w: World,
  as: string,
  opts: { name?: string; portionsHalf?: number; priceMinor?: number } = {},
): Promise<KitchenDish> {
  const res = await w.call<DishResponse>("POST", me("dishes"), as, {
    name: opts.name ?? "Egg fried rice",
    orgId: null,
    portionsHalf: opts.portionsHalf ?? 8,
    splitMode: "assign",
    newItems: [{ name: "Rice", quantity: "1", unit: "kg", priceMinor: opts.priceMinor ?? 2000 }],
  });
  expect(res.status).toBe(201);
  return res.body.data.dish;
}

/** POST …/split, as `as`. */
export function split(w: World, as: string, dish: KitchenDish | string, body: unknown, key?: string) {
  const id = typeof dish === "string" ? dish : dish.id;
  return w.call<DishResponse>("POST", me(`dishes/${id}/split`), as, body, key ? { "idempotency-key": key } : undefined);
}

/** Every non-zero balance in the group (they always add up to zero). */
export async function balances(w: World, g: Group, as: string): Promise<Record<string, number>> {
  const res = await w.call<BalancesResponse>("GET", groupPath(g, "balances"), as);
  expect(res.status).toBe(200);
  const all = res.body.data.balances;
  expect(all.reduce((a, b) => a + b.balanceMinor, 0)).toBe(0);
  return Object.fromEntries(all.filter((b) => b.balanceMinor !== 0).map((b) => [b.subjectId, b.balanceMinor]));
}

export async function activity(w: World, g: Group, as: string): Promise<KitchenTxn[]> {
  const res = await w.call<ActivityPage>("GET", groupPath(g, "activity"), as);
  expect(res.status).toBe(200);
  return res.body.data.items;
}

export function count(w: World, table: string, where = ""): number {
  return (w.h.db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number }).n;
}

/** What a refused split must leave untouched. */
export function written(w: World): Record<string, unknown> {
  return {
    txns: count(w, "kitchen_txns"),
    events: count(w, "events_event_log"),
    settings: count(w, "kitchen_group_settings"),
    dishes: w.h.db.prepare("SELECT id, org_id, state, version, split_at FROM kitchen_dishes ORDER BY id").all(),
  };
}
