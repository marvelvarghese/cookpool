// The world restock.test.ts and purchases.test.ts run in (PN-3): the real
// router over real SQLite, a clock the test moves (days back from NOW, a
// minute on per write so "newer" is always strictly later), and the people
// and groups below.

import type {
  KitchenItem,
  KitchenItemResponse,
  PurchaseResponse,
  RestockResponse,
  StockMoveResponse,
  UndoPurchaseResponse,
} from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

/** Sunday 8 November 2026, 08:00 UTC. */
export const NOW = new Date("2026-11-08T08:00:00.000Z");
const DAY_MS = 86_400_000;

export const RAHUL = "usr_rahul"; // the caller: builder in Flat 4B and the Lunch club, viewer in the Book club
export const ANU = "usr_anu"; // owner of Flat 4B
export const DEV = "usr_dev"; // builder in Flat 4B
export const KIRAN = "usr_kiran"; // owner of the Lunch club
export const MEERA = "usr_meera"; // owner of the Book club
export const OUTSIDER = "usr_outsider"; // another flat altogether

export interface Result<T> {
  status: number;
  body: Envelope<T>;
}

export interface World {
  h: Harness;
  flat: Group;
  lunch: Group;
  books: Group;
  elsewhere: Group;
  /** Move the clock to `days` before NOW (at 08:00); the day it is then, as YYYY-MM-DD. */
  daysAgo(days: number): string;
  now(): Date;
  call<T>(method: string, path: string, as: string | null, body?: unknown, headers?: Record<string, string>): Promise<Result<T>>;
  /** Add to the caller's own pantry, on the clock's day unless `boughtOn` says otherwise. */
  addMine(as: string, body: Record<string, unknown>): Promise<KitchenItem>;
  addTo(as: string, group: Group, body: Record<string, unknown>): Promise<KitchenItem>;
  useMine(as: string, item: KitchenItem, quantity: string, unit?: string): Promise<StockMoveResponse>;
  useIn(as: string, group: Group, item: KitchenItem, quantity: string, unit?: string): Promise<StockMoveResponse>;
  wasteIn(as: string, group: Group, item: KitchenItem): Promise<StockMoveResponse>;
  /** GET /v1/kitchen/me/restock at NOW (the clock is moved back to it). */
  restock(as: string): Promise<RestockResponse>;
  buy(as: string, lines: unknown[], key?: string): Promise<Result<PurchaseResponse>>;
  undo(as: string, purchaseId: string): Promise<Result<UndoPurchaseResponse>>;
  close(): void;
}

export const me = (rest: string) => `/v1/kitchen/me/${rest}`;
export const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

/** The stored UUID behind a public `<prefix>_<32 hex>` id. */
export function uuidOf(publicId: string): string {
  return publicId.replace(/^[a-z]+_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

export function world(): World {
  let clock = NOW;
  const h = createHarness({ deps: { now: () => clock } });
  const flat = newGroup("Flat 4B");
  const lunch = newGroup("Lunch club");
  const books = newGroup("Book club");
  const elsewhere = newGroup("Another flat");
  h.grant(RAHUL, flat, "builder");
  h.grant(ANU, flat, "owner");
  h.grant(DEV, flat, "builder");
  h.grant(KIRAN, lunch, "owner");
  h.grant(RAHUL, lunch, "builder");
  h.grant(MEERA, books, "owner");
  h.grant(RAHUL, books, "viewer");
  h.grant(OUTSIDER, elsewhere, "owner");

  const tick = () => {
    clock = new Date(clock.getTime() + 60_000);
  };

  async function call<T>(method: string, path: string, as: string | null, body?: unknown, headers?: Record<string, string>): Promise<Result<T>> {
    const res = await h.call(method, path, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
    return { status: res.status, body: await envelope<T>(res) };
  }

  async function created<T>(res: Result<T>): Promise<T> {
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body.data;
  }

  const day = () => clock.toISOString().slice(0, 10);
  const item = (body: Record<string, unknown>) => ({ category: "Grains", priceMinor: 4500, quantity: "1", unit: "pcs", boughtOn: day(), ...body });

  return {
    h,
    flat,
    lunch,
    books,
    elsewhere,
    daysAgo(days) {
      clock = new Date(NOW.getTime() - days * DAY_MS);
      return day();
    },
    now: () => clock,
    call,
    async addMine(as, body) {
      tick();
      return (await created(await call<KitchenItemResponse>("POST", me("items"), as, item(body)))).item;
    },
    async addTo(as, group, body) {
      tick();
      return (await created(await call<KitchenItemResponse>("POST", groupPath(group, "items"), as, item(body)))).item;
    },
    async useMine(as, it, quantity, unit) {
      tick();
      return created(await call<StockMoveResponse>("POST", me(`items/${it.id}/uses`), as, { quantity, unit: unit ?? it.displayUnit }));
    },
    async useIn(as, group, it, quantity, unit) {
      tick();
      return created(await call<StockMoveResponse>("POST", groupPath(group, `items/${it.id}/uses`), as, { quantity, unit: unit ?? it.displayUnit }));
    },
    async wasteIn(as, group, it) {
      tick();
      return created(await call<StockMoveResponse>("POST", groupPath(group, `items/${it.id}/waste`), as, {}));
    },
    async restock(as) {
      clock = NOW;
      const res = await call<RestockResponse>("GET", me("restock"), as);
      if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      return res.body.data;
    },
    async buy(as, lines, key) {
      tick();
      return call<PurchaseResponse>("POST", me("purchases"), as, { lines }, key ? { "idempotency-key": key } : undefined);
    },
    async undo(as, purchaseId) {
      tick();
      return call<UndoPurchaseResponse>("DELETE", me(`purchases/${purchaseId}`), as);
    },
    close: () => h.close(),
  };
}

/** `[pantry name, name]` of each line, for compact assertions. */
export function names(lines: ReadonlyArray<{ name: string; pantry: { name: string } }>): Array<[string, string]> {
  return lines.map((l) => [l.pantry.name, l.name]);
}
