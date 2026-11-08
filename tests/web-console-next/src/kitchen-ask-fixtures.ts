// Fixtures for ask before use's view-model tests (cookpool-pantry PN-9):
// Meera's saffron in Flat 4B, guarded with Ask me first, and Dev's ask for a
// pinch of it for him and Anu — shaped as PN-8's API answers them.

import type { KitchenAsk, ReachableItem } from "@saas/contracts/kitchen";
import { ANU, DEV, FLAT, MEERA, groupRef, makeItem } from "./kitchen-pantry-fixtures";

/** When the tests look: two minutes after Dev asked. */
export const ASK_NOW = new Date("2026-11-08T12:00:00.000Z");

/** 2 g of saffron for ₹480, Meera paid, 1.4 g left; Dev must ask her. */
export function saffron(o: Partial<ReachableItem> = {}): ReachableItem {
  return {
    ...makeItem({ id: "itm_0000000000000000000000000000saf1", name: "Saffron", pantry: groupRef(FLAT), unit: "g", bought: "2", left: "1.4", priceMinor: 48_000, paidBy: MEERA, category: "spices" }),
    askFirst: true,
    allowed: [],
    mustAsk: true,
    answerer: MEERA,
    ...o,
  };
}

/** The same saffron before Meera turned it on: it asks nobody (no list, no answerer). */
export function plainSaffron(): ReachableItem {
  const item: ReachableItem = { ...saffron(), askFirst: false };
  delete item.allowed;
  delete item.mustAsk;
  delete item.answerer;
  return item;
}

/** Dev's ask for 1 pinch, for Dev and Anu: ₹12, all of it back to Meera. */
export function makeAsk(o: Partial<KitchenAsk> = {}): KitchenAsk {
  return {
    id: "ask_00000000000000000000000000000a01",
    orgId: FLAT.orgId,
    item: {
      id: "itm_0000000000000000000000000000saf1",
      ref: `org:${FLAT.orgId}:itm_0000000000000000000000000000saf1`,
      name: "Saffron",
      pantry: groupRef(FLAT),
      displayUnit: "g",
      qtyLeftMilli: 1_400,
      qtyLeft: 1.4,
      state: "active",
    },
    asker: DEV,
    askerName: "Dev",
    qtyMilli: 50,
    quantity: 0.05,
    unit: "g",
    label: "1 pinch",
    amount: "1 pinch",
    consumers: [DEV, ANU],
    consumerNames: ["Dev", "Anu"],
    weights: null,
    source: "pantry",
    state: "pending",
    createdAt: "2026-11-08T11:58:00.000Z",
    expiresAt: "2026-11-09T11:58:00.000Z",
    answeredAt: null,
    answeredBy: null,
    answerer: MEERA,
    answererName: "Meera",
    paidBy: MEERA,
    costMinor: 1_200,
    backMinor: 1_200,
    currency: "INR",
    enough: true,
    moveId: null,
    txnId: null,
    ...o,
  };
}
