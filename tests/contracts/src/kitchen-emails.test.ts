// Cookpool's emails (CP-18, SM-6's portion set for you and PW-5's payment to
// you): the template
// keys kitchen-worker enqueues and notifications-worker renders, the digest's
// window, and the digest's flat templateData — numbered item keys — written
// and read back.

import {
  KITCHEN_EMAILS,
  KITCHEN_EMAIL_CATEGORY,
  USE_SOON_DAYS,
  USE_SOON_EMAIL_DAYS,
  USE_SOON_EMAIL_MAX_ITEMS,
  readUseSoonEmail,
  useSoonEmailData,
  type DishPostedEmail,
  type LoggedForYouEmail,
  type PortionSetEmail,
  type UseSoonEmail,
} from "@saas/contracts/kitchen";
import { NOTIFICATIONS_INTERNAL_ACTOR_VALUES } from "@saas/contracts/notifications";

describe("kitchen emails", () => {
  it("are five templates, sent as product email, from an allowed internal caller", () => {
    expect(KITCHEN_EMAILS).toEqual({
      USE_SOON: "kitchen.use_soon",
      DISH_POSTED: "kitchen.dish_posted",
      LOGGED_FOR_YOU: "kitchen.logged_for_you",
      // SM-6: someone else set your portion of a dish.
      PORTION_SET: "kitchen.portion_set",
      // PW-5: someone recorded a payment to you.
      PAID_YOU: "kitchen.paid_you",
    });
    expect(KITCHEN_EMAIL_CATEGORY).toBe("product");
    expect(NOTIFICATIONS_INTERNAL_ACTOR_VALUES).toContain("kitchen-worker");
  });

  it("look two days ahead in the digest — design.md §8 — while the app's filter looks further", () => {
    expect(USE_SOON_EMAIL_DAYS).toBe(2);
    expect(USE_SOON_DAYS).toBeGreaterThanOrEqual(USE_SOON_EMAIL_DAYS);
    expect(USE_SOON_EMAIL_MAX_ITEMS).toBe(10);
  });

  it("carry the digest's items as numbered keys, and read them back", () => {
    const digest: UseSoonEmail = {
      recipientName: "Rahul",
      date: "2026-11-02",
      count: 2,
      items: [
        { name: "Milk", pantry: "My pantry", useBy: "2026-11-02" },
        { name: "Paneer", pantry: "Flat 4B", useBy: "2026-11-04" },
      ],
      homeUrl: "https://stage.cookpool.store/home",
    };
    const data = useSoonEmailData(digest);
    expect(data).toEqual({
      recipientName: "Rahul",
      date: "2026-11-02",
      count: 2,
      listed: 2,
      homeUrl: "https://stage.cookpool.store/home",
      item1Name: "Milk",
      item1Pantry: "My pantry",
      item1UseBy: "2026-11-02",
      item2Name: "Paneer",
      item2Pantry: "Flat 4B",
      item2UseBy: "2026-11-04",
    });
    expect(Object.values(data).every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))).toBe(true);
    expect(readUseSoonEmail(data)).toEqual(digest);
  });

  it("list at most ten items, counting the rest, and read a malformed digest as empty", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ name: `Item ${i + 1}`, pantry: "My pantry", useBy: "2026-11-03" }));
    const data = useSoonEmailData({ recipientName: null, date: "2026-11-02", count: 12, items, homeUrl: "" });
    expect(data.listed).toBe(10);
    expect(data).not.toHaveProperty("item11Name");
    const read = readUseSoonEmail(data);
    expect(read.items).toHaveLength(10);
    expect(read.count).toBe(12);
    expect(read.recipientName).toBeNull();

    expect(readUseSoonEmail({ listed: "lots", count: -3 })).toEqual({ recipientName: null, date: "", count: 0, items: [], homeUrl: "" });
  });

  it("type the event emails as flat templateData", () => {
    const dish: DishPostedEmail = {
      cookName: "Meera",
      dishName: "Egg fried rice",
      groupName: "Flat 4B",
      portions: "4½",
      total: "₹240.00",
      dishUrl: "https://stage.cookpool.store/dishes/dsh_1",
    };
    const logged: LoggedForYouEmail = {
      kind: "expense",
      actorName: null,
      what: "Groceries",
      groupName: "Flat 4B",
      total: "₹600.00",
      yourShare: "₹200.00",
      youPaid: null,
      groupUrl: "https://stage.cookpool.store/groups/flat-4b",
    };
    const portion: PortionSetEmail = {
      actorName: "Anu",
      dishName: "Egg fried rice",
      groupName: "Flat 4B",
      portions: "1",
      yourShare: "₹8.89",
      dishUrl: "https://stage.cookpool.store/dishes/dsh_1",
    };
    expect(Object.keys(dish)).toHaveLength(6);
    expect(Object.keys(logged)).toHaveLength(8);
    expect(Object.keys(portion)).toHaveLength(6);
  });
});
