import type { KitchenItem, RestockResponse } from "@saas/contracts/kitchen";
import {
  addFormFrom,
  boughtAgainItem,
  finishedOpen,
  finishedRow,
  finishedRows,
  historyEntryOfItem,
  itemRestockKey,
  parseFromParam,
  purchaseRefusal,
  restockBoughtPatch,
  restockKey,
  restockWithout,
  toggleFinishedFold,
  undoPurchaseResult,
  weekdayText,
} from "@web-console-next/components/kitchen/restock";
import { historyFill } from "@web-console-next/components/kitchen/from-before";
import { boughtAgainLine, boughtAgainTitle, buyLikeHref } from "@web-console-next/components/kitchen/item-page";
import { itemRefOf } from "@web-console-next/components/kitchen/pantry";
import { initialItemForm } from "@web-console-next/components/kitchen/item-form";
import { frameRedirect } from "@web-console-next/lib/features";
import { quickUseFieldHref } from "@web-console-next/components/kitchen/pantry-list";
import { FLAT, LUNCH, ME, PERSONAL_REF, groupPantry, groupRef, makeItem, personalPantry } from "./kitchen-pantry-fixtures";
import { NOW, TODAY, at, finished, last, runningLow, usual as usualLine } from "./kitchen-restock-fixtures";

// cookpool-pantry PN-6: Finished this week, Bought again and `?from=` as
// pure view-models.

const ALL = { kind: "all" } as const;

describe("Finished this week's rows", () => {
  it("say how and when it finished, and where: used up or went bad, the weekday", () => {
    const bread = finishedRow(finished(), NOW);
    expect(bread.sub).toBe("Finished Tue · Flat 4B");
    expect(bread.label).toBe("Bread · finished Tue · Flat 4B");
    expect(bread.price).toBe("₹45");
    expect(bread.canAdd).toBe(true);
    expect(bread.key).toBe(`${FLAT.orgId}:bread`);
    const curd = finishedRow(finished({ name: "Curd", how: "wasted", at: at(2), pantry: PERSONAL_REF }), NOW);
    expect(curd.sub).toBe("Went bad Mon · Me");
    expect(curd.label).toBe("Curd · went bad Mon · Me");
  });

  it("read today and yesterday in words, and an older day as its date", () => {
    expect(finishedRow(finished({ at: at(5, 8) }), NOW).sub).toBe("Finished today · Flat 4B");
    expect(finishedRow(finished({ how: "wasted", at: at(4, 20) }), NOW).sub).toBe("Went bad yesterday · Flat 4B");
    expect(weekdayText(new Date(2026, 9, 31, 9).toISOString(), NOW)).toBe("Sat"); // five days back
    expect(weekdayText(new Date(2026, 9, 28, 9).toISOString(), NOW)).toBe("28 Oct");
    expect(weekdayText("not a date", NOW)).toBe("");
  });

  it("show every finished line on All, a pantry's on its chip, none under Use soon or Running low, narrowed by the search", () => {
    const restock = { finished: [finished(), finished({ name: "Butter", pantry: PERSONAL_REF }), finished({ name: "Brown bread", pantry: groupRef(LUNCH) })] };
    expect(finishedRows(restock, { show: ALL, now: NOW }).map((r) => r.name)).toEqual(["Bread", "Butter", "Brown bread"]);
    expect(finishedRows(restock, { show: { kind: "pantry", key: "personal" }, now: NOW }).map((r) => r.name)).toEqual(["Butter"]);
    expect(finishedRows(restock, { show: { kind: "soon" }, now: NOW })).toEqual([]);
    expect(finishedRows(restock, { show: { kind: "low" }, now: NOW })).toEqual([]);
    expect(finishedRows(restock, { show: ALL, query: "bread", now: NOW }).map((r) => r.name)).toEqual(["Bread", "Brown bread"]);
    // Empty: the section isn't drawn.
    expect(finishedRows({ finished: [] }, { show: ALL, now: NOW })).toEqual([]);
    expect(finishedRows(null, { show: ALL, now: NOW })).toEqual([]);
  });

  it("offer no Bought again in a pantry you only view", () => {
    expect(finishedRow(finished({ canAdd: false }), NOW).canAdd).toBe(false);
  });

  it("fold like the sections, remembered beside them, and stay open while searching", () => {
    const none = new Set<string>(["dairy"]);
    expect(finishedOpen(none, false)).toBe(true);
    const folded = toggleFinishedFold(none);
    expect([...folded].sort()).toEqual(["dairy", "finished"]);
    expect(none.has("finished")).toBe(false);
    expect(finishedOpen(folded, false)).toBe(false);
    expect(finishedOpen(folded, true)).toBe(true);
    expect(toggleFinishedFold(folded).has("finished")).toBe(false);
  });
});

describe("Bought again's one line, from last time", () => {
  // Bought again is PN-7's one-line purchase (item-page.ts's `boughtAgainLine`), fed a restock line's `last` as an item.
  const lineOf = (l: Parameters<typeof boughtAgainItem>[0], today = TODAY) => boughtAgainLine(boughtAgainItem(l, { today }), today);

  it("buys the same amount in its unit, at its price and currency, in its pantry, from that item, paid by you", () => {
    const line = lineOf(finished({ last: last({ unit: "L", qty: "2", priceMinor: 13600, itemId: "itm_milk1", wastePolicy: "buyer_absorbs" }), name: "Milk", category: "dairy" }));
    expect(line).toEqual({
      pantry: FLAT.orgId,
      name: "Milk",
      category: "dairy",
      quantity: "2",
      unit: "L",
      priceMinor: 13600,
      currency: "INR",
      fromItemId: "itm_milk1",
      expiresOn: "2026-11-08",
    });
    // No payer (the caller pays) and no waste rule: the server copies `fromItemId`'s into its own group.
    expect(line).not.toHaveProperty("paidBy");
    expect(line).not.toHaveProperty("wastePolicy");
  });

  it("sends a use-by only when last time had one, as many days from today", () => {
    expect(lineOf(finished({ last: last({ expiresAfterDays: null }) }))).not.toHaveProperty("expiresOn");
    expect(lineOf(finished({ last: last({ expiresAfterDays: 0 }) })).expiresOn).toBe(TODAY);
    expect(lineOf(finished({ last: last({ expiresAfterDays: 14 }) }), "2026-11-25").expiresOn).toBe("2026-12-09");
  });

  it("goes to your own pantry as 'personal', in last time's currency", () => {
    const mine = lineOf(finished({ pantry: PERSONAL_REF, last: last({ currency: "USD", priceMinor: 350 }) }));
    expect(mine.pantry).toBe("personal");
    expect(mine.currency).toBe("USD");
    expect(mine.priceMinor).toBe(350);
  });

  it("writes the quantity as a decimal in the unit it was bought in", () => {
    expect(lineOf(finished({ last: last({ unit: "kg", qty: "1.5" }) })).quantity).toBe("1.5");
    expect(lineOf(finished({ last: last({ unit: "ml", qty: "250" }) })).quantity).toBe("250");
    expect(lineOf(finished({ last: last({ unit: "dozen", qty: "1" }) })).quantity).toBe("1");
    expect(lineOf(finished({ last: last({ unit: "pcs", qty: "6" }) })).quantity).toBe("6");
  });

  it("reads the last purchase as an untouched item: its id, amount, price, waste rule (the group's when it follows it)", () => {
    const item = boughtAgainItem(finished({ last: last({ unit: "kg", qty: "5", priceMinor: 24500, itemId: "itm_atta1", expiresAfterDays: 60 }), name: "Atta" }), { today: TODAY, groupWastePolicy: "buyer_absorbs" });
    expect(item).toMatchObject({ id: "itm_atta1", name: "Atta", dimension: "mass", displayUnit: "kg", qtyBought: 5, qtyLeftMilli: 5_000_000, priceMinor: 24500, worthMinor: 24500, unitPriceMinor: 4900, boughtOn: TODAY, expiresOn: "2027-01-04", daysToUseBy: 60, wastePolicy: "buyer_absorbs", wastePolicyOverride: null, state: "active" });
    expect(boughtAgainItem(finished({ last: last({ wastePolicy: "split_equally" }) }), { today: TODAY, groupWastePolicy: "buyer_absorbs" }).wastePolicy).toBe("split_equally");
    expect(boughtAgainItem(finished({ pantry: PERSONAL_REF }), { today: TODAY }).wastePolicy).toBeNull();
  });

  it("toasts 'Got more Bread · ₹45', and Change opens the add form filled from that item", () => {
    expect(boughtAgainTitle(boughtAgainItem(finished(), { today: TODAY }))).toBe("Got more Bread · ₹45");
    expect(boughtAgainTitle(boughtAgainItem(finished({ name: "Milk", last: last({ priceMinor: 6850 }) }), { today: TODAY }))).toBe("Got more Milk · ₹68.50");
    const ref = itemRefOf(boughtAgainItem(finished(), { today: TODAY }));
    expect(ref).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: "itm_bread1" });
    expect(buyLikeHref(ref)).toBe(`/pantry/new?from=org%3A${FLAT.orgId}%3Aitm_bread1`);
    expect(buyLikeHref(itemRefOf(boughtAgainItem(finished({ pantry: PERSONAL_REF }), { today: TODAY })))).toBe("/pantry/new?from=me%3Aitm_bread1");
  });

  it("says what its Undo came to, and when someone used some", () => {
    const bread = makeItem({ name: "Bread" });
    const milk = makeItem({ name: "Milk" });
    expect(undoPurchaseResult({ removed: [bread], kept: [] })).toEqual({ ok: true, description: "Bread is off the list." });
    expect(undoPurchaseResult({ removed: [bread, milk], kept: [] })).toEqual({ ok: true, description: "2 things are off the list." });
    expect(undoPurchaseResult({ removed: [bread], kept: [milk] })).toEqual({ ok: false, kind: "warning", title: "Someone already used some", description: "Milk stays in the pantry · 1 taken off." });
    expect(undoPurchaseResult({ removed: [], kept: [milk, bread] })).toEqual({ ok: false, kind: "warning", title: "Someone already used some", description: "Milk and Bread stay in their pantries." });
  });

  it("says why a purchase was refused, in one line", () => {
    expect(purchaseRefusal({ code: "validation_failed", message: "Invalid", details: { fields: { "lines[0].pantry": ["Must be a pantry you can add to"] } } }, "Flat 4B")).toBe("You can't add to Flat 4B any more.");
    expect(purchaseRefusal({ code: "validation_failed", message: "Invalid", details: { fields: { "lines[2].pantry": ["…"] } } }, null)).toBe("You can't add to one of those pantries any more.");
    expect(purchaseRefusal({ code: "validation_failed", reason: "currency_mismatch", message: "x", details: { currency: "USD" } }, "Flat 4B")).toBe("Flat 4B counts in USD now. Reload and try again.");
    expect(purchaseRefusal({ code: "validation_failed", message: "Invalid", details: { fields: { "lines[0].priceMinor": ["Too large"] } } }, null)).toBe("Too large");
    expect(purchaseRefusal({ code: "internal", message: "Something broke" }, null)).toBe("Something broke");
  });
});

describe("the restock read while a purchase is on its way", () => {
  const data: RestockResponse = { finished: [finished()], runningLow: [runningLow({ name: "Atta" })], usual: [usualLine({ name: "Milk", pantry: PERSONAL_REF })] };

  it("drops the names bought from every group, and is the same answer when none are", () => {
    const pending = makeItem({ name: " bread ", pantry: groupRef(FLAT) });
    expect(itemRestockKey(pending)).toBe(restockKey(finished()));
    const next = restockWithout(data, new Set([itemRestockKey(pending), "personal:milk"]));
    expect(next.finished).toEqual([]);
    expect(next.runningLow.map((l) => l.name)).toEqual(["Atta"]);
    expect(next.usual).toEqual([]);
    expect(restockWithout(data, new Set(["personal:bread"]))).toBe(data);
    const patch = restockBoughtPatch([`${FLAT.orgId}:atta`]);
    expect(patch.prefix).toEqual(["kitchenPantry", "restock"]);
    expect((patch.update(data, ["kitchenPantry", "restock"]) as RestockResponse).runningLow).toEqual([]);
  });
});

describe("/pantry/new?from=: the add form filled from an item", () => {
  const pantries = [personalPantry(), groupPantry(FLAT)];
  const milk: KitchenItem = makeItem({ name: "Milk", unit: "L", bought: "2", left: "0", priceMinor: 13600, category: "dairy", paidBy: "usr_0000000000000000000000000000b0b0", boughtOn: "2026-10-30", expiresOn: "2026-11-02", wastePolicyOverride: "buyer_absorbs", state: "used_up" });

  it("reads the item's ref, in the new frame only", () => {
    expect(parseFromParam(`org:${FLAT.orgId}:itm_milk1`)).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: "itm_milk1" });
    expect(parseFromParam("me%3Aitm_milk1")).toEqual({ kind: "personal", itemId: "itm_milk1" });
    expect(parseFromParam("nonsense")).toBeNull();
    expect(addFormFrom("me:itm_milk1", true)).toEqual({ kind: "personal", itemId: "itm_milk1" });
    expect(addFormFrom("me:itm_milk1", false)).toBeNull();
  });

  it("maps the item to last time's entry, with you as the payer", () => {
    expect(historyEntryOfItem(milk, ME)).toEqual({
      name: "Milk",
      category: "dairy",
      dimension: "volume",
      unit: "L",
      quantity: 2,
      qtyMilli: 2_000_000,
      priceMinor: 13600,
      currency: "INR",
      pantry: { kind: "group", orgId: FLAT.orgId, name: "Flat 4B" },
      paidBy: ME,
      wastePolicy: "buyer_absorbs",
      useByDays: 3,
      times: 1,
      lastBoughtOn: "2026-10-30",
    });
    expect(historyEntryOfItem(milk, null).paidBy).toBe(milk.paidBy);
    expect(historyEntryOfItem(makeItem({ pantry: PERSONAL_REF, expiresOn: null }), ME)).toMatchObject({ pantry: { kind: "personal", orgId: null }, useByDays: null });
  });

  it("fills the form the way Like last time does", () => {
    const form = initialItemForm({ today: TODAY, pantry: "personal", meId: ME });
    const fill = historyFill(historyEntryOfItem(milk, ME), form, { today: TODAY, pantries, fallbackPantry: "personal", meId: ME });
    expect(fill.form).toMatchObject({ name: "Milk", category: "dairy", quantity: "2", unit: "L", price: "136", pantry: FLAT.orgId, paidBy: ME, waste: "buyer_absorbs", expiresOn: "2026-11-08", boughtOn: TODAY });
    expect(fill.pantryFellBack).toBe(false);
    // A group you no longer add to: your own pantry instead, the rest kept.
    const away = historyFill(historyEntryOfItem(milk, ME), form, { today: TODAY, pantries: [personalPantry()], fallbackPantry: "personal", meId: ME });
    expect(away.form).toMatchObject({ pantry: "personal", name: "Milk", price: "136" });
    expect(away.pantryFellBack).toBe(true);
  });
});

describe("today's frame is unchanged", () => {
  it("has no shopping run (its visitor goes to the Pantry) and Home's field still opens Use", () => {
    expect(frameRedirect("/pantry/run", false)).toBe("/pantry");
    expect(frameRedirect("/pantry/run", true)).toBeNull();
    expect(frameRedirect("/pantry/new", false)).toBeNull();
    expect(quickUseFieldHref(false)).toBe("/use");
  });
});
