// Shared set-up for the RC-4 suites (foods, recipes, the match, Cook now):
// the router over real SQLite with every migration applied, the real policy
// grants and membership's answers (see ./harness.ts), and the people the
// cookpool-recipes design uses — Anu owns Flat 4B, Rahul and Dev cook in it,
// Vik only reads it, Rahul is also in the Lunch club, and Olu is in another
// flat altogether.

import { randomUUID } from "node:crypto";
import type { KitchenItem, KitchenItemResponse, RecipeResponse } from "@saas/contracts/kitchen";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

export const NOW = new Date("2026-11-08T08:00:00.000Z");
const MINUTE = 60_000;

export const ANU = "usr_anu"; // owner of Flat 4B
export const RAHUL = "usr_rahul"; // builder in Flat 4B and the Lunch club
export const DEV = "usr_dev"; // builder in Flat 4B
export const VIK = "usr_vik"; // viewer in Flat 4B: reads it, may not use it
export const OLU = "usr_olu"; // another flat altogether

export interface World {
  h: Harness;
  flat: Group;
  lunch: Group;
  elsewhere: Group;
  /** Move the clock on a minute (every write stamps it). */
  tick(): void;
  call<T>(method: string, url: string, as: string | null, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Envelope<T> }>;
}

export function world(): World {
  let clock = NOW;
  const h = createHarness({ deps: { now: () => clock } });
  const flat = newGroup("Flat 4B");
  const lunch = newGroup("Lunch club");
  const elsewhere = newGroup("Another flat");
  h.grant(ANU, flat, "owner");
  h.grant(RAHUL, flat, "builder");
  h.grant(DEV, flat, "builder");
  h.grant(VIK, flat, "viewer");
  h.grant(RAHUL, lunch, "builder");
  h.grant(OLU, elsewhere, "owner");
  h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
  h.profile(RAHUL, { displayName: "Rahul", email: "rahul@example.com" });
  h.profile(DEV, { displayName: "Dev", email: "dev@example.com" });
  h.profile(OLU, { displayName: "Olu", email: "olu@example.com" });
  return {
    h,
    flat,
    lunch,
    elsewhere,
    tick() {
      clock = new Date(clock.getTime() + MINUTE);
    },
    async call<T>(method: string, url: string, as: string | null, body?: unknown, headers?: Record<string, string>) {
      const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
      return { status: res.status, body: await envelope<T>(res) };
    },
  };
}

export const me = (rest: string) => `/v1/kitchen/me/${rest}`;
export const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

/** Add an item to the caller's own pantry (g null) or a group's. */
export async function addItem(w: World, as: string, g: Group | null, body: Record<string, unknown>): Promise<KitchenItem> {
  w.tick();
  const res = await w.call<KitchenItemResponse>("POST", g ? groupPath(g, "items") : me("items"), as, { category: "veg", priceMinor: 1000, ...body });
  if (res.status !== 201) throw new Error(`add ${String(body.name)}: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.item;
}

/** The food an item links to, as stored. */
export function foodOf(w: World, item: { id: string }): string | null {
  const id = item.id.replace(/^itm_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  return (w.h.db.prepare("SELECT food_key FROM kitchen_items WHERE id = ?").get(id) as { food_key: string | null }).food_key;
}

/** Write a recipe as `as`; throws unless it is 201. */
export async function writeRecipe(w: World, as: string, body: Record<string, unknown>): Promise<RecipeResponse["recipe"]> {
  w.tick();
  const res = await w.call<RecipeResponse>("POST", me("recipes"), as, body);
  if (res.status !== 201) throw new Error(`recipe ${String(body.name)}: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.recipe;
}

/** Chicken curry as the design writes it: 1 kg of chicken scales every line. */
export const chickenCurry = {
  name: "Chicken curry",
  servesHalf: 8,
  minutes: 45,
  kind: "dal_curry",
  lines: [
    { foodKey: "chicken", name: "Chicken", quantity: "1", unit: "kg", isMain: true },
    { foodKey: "onion", name: "Onions, sliced", quantity: 2, unit: "onion" },
    { foodKey: "tomato", name: "Tomatoes", quantity: "200", unit: "g" },
    { foodKey: "turmeric", name: "Turmeric", quantity: "1", unit: "tsp" },
    { foodKey: "salt", name: "Salt", toTaste: true },
  ],
  steps: ["Brown the onions", "Add the chicken and the spices", "Simmer 30 minutes"],
};

/** Put a Cookpool recipe straight into the table, as RC-7's migration will: lines given as [food, name, qtyMilli, unit, main]. */
export function systemRecipe(
  w: World,
  name: string,
  servesHalf: number,
  lines: Array<[string | null, string, number | null, string | null, boolean]>,
  kind: string | null = null,
): string {
  const id = randomUUID();
  w.h.db.prepare("INSERT INTO kitchen_recipes (id, owner_id, name, serves_half, visibility, is_system, kind) VALUES (?, 'usr_cookpool', ?, ?, 'groups', 1, ?)").run(
    id, name, servesHalf, kind,
  );
  lines.forEach(([food, line, qty, unit, main], position) => {
    w.h.db.prepare(
      "INSERT INTO kitchen_recipe_lines (recipe_id, position, food_key, name, qty_milli, unit, to_taste, is_main) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, position, food, line, qty, unit, qty === null ? 1 : 0, main ? 1 : 0);
  });
  return `rcp_${id.replace(/-/g, "")}`;
}
