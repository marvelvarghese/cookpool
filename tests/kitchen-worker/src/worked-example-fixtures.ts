// design.md §3's worked example, as the dish routes cook it: shared by the
// cooking tests (CP-14, dishes.test.ts) and the splitting tests (CP-16,
// splitting.test.ts), so both start from the very same pantries and dish.

import type { KitchenItem } from "@saas/contracts/kitchen";
import type { Group } from "./harness.js";

export interface WorkedExamplePantries {
  paneer: KitchenItem;
  butter: KitchenItem;
  tomatoes: KitchenItem;
  onions: KitchenItem;
  flour: KitchenItem;
}

/** How a test adds an item: to someone's own pantry, or to a group's. */
export interface ItemMaker {
  myItem(as: string, body: Record<string, unknown>): Promise<KitchenItem>;
  groupItem(as: string, g: Group, body: Record<string, unknown>): Promise<KitchenItem>;
}

/** Rahul's paneer and butter; Anu's tomatoes and Dev's onions in Flat 4B; Kiran's chapati flour in the Lunch club. */
export async function stockWorkedExample(
  make: ItemMaker,
  groups: { flat: Group; lunch: Group },
  people: { rahul: string; anu: string; dev: string; kiran: string },
): Promise<WorkedExamplePantries> {
  return {
    paneer: await make.myItem(people.rahul, { name: "Paneer", quantity: "200", unit: "g", priceMinor: 9500 }),
    butter: await make.myItem(people.rahul, { name: "Butter", quantity: "500", unit: "g", priceMinor: 14000 }),
    tomatoes: await make.groupItem(people.anu, groups.flat, { name: "Tomatoes", quantity: "1", unit: "kg", priceMinor: 4000 }),
    onions: await make.groupItem(people.dev, groups.flat, { name: "Onions", quantity: "1", unit: "kg", priceMinor: 3500 }),
    flour: await make.groupItem(people.kiran, groups.lunch, {
      name: "Chapati flour", category: "Grains", quantity: "5", unit: "kg", priceMinor: 24000,
    }),
  };
}

/** Paneer butter masala with rotis, shared with Flat 4B for claims (₹211.00, 4 portions); the cream is bought on the way. */
export function paneerButterMasalaBody(p: WorkedExamplePantries, flat: Group, overrides: Record<string, unknown> = {}) {
  return {
    name: "Paneer butter masala with rotis",
    orgId: flat.publicId,
    portionsHalf: 8,
    extrasMinor: 1500,
    splitMode: "claims",
    ingredients: [
      { itemId: p.paneer.id, quantity: "200", unit: "g" }, // all of it: ₹95.00
      { itemId: p.butter.id, quantity: "100", unit: "g" }, // a fifth: ₹28.00
      { itemId: p.tomatoes.id, quantity: "300", unit: "g" }, // Anu's: ₹12.00
      { itemId: p.onions.id, quantity: "0.2", unit: "kg" }, // Dev's: ₹7.00
      { itemId: p.flour.id, quantity: "0.5" }, // Kiran's, in its own kg: ₹24.00
    ],
    newItems: [{ name: "Cream", quantity: "200", unit: "ml", priceMinor: 3000 }], // all of it: ₹30.00
    ...overrides,
  };
}
