import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { AiUseProposal, KitchenStaple, ShoppingItem, StaplePantry, StaplesResponse } from "@saas/contracts/kitchen";
import { shoppingLines } from "@saas/contracts/kitchen";
import {
  ALL_VIEW,
  boughtToast,
  kitchenRowMeta,
  kitchenTitle,
  listAmount,
  listGroups,
  nextStatus,
  parseView,
  saidTicks,
  shoppingCount,
  shoppingLabel,
  stapleChips,
  stapleSheet,
  stapleSub,
  statusToast,
  stockBar,
  switcherOptions,
  viewShow,
} from "@web-console-next/components/kitchen/kitchen-staples";

import { tabBarHidden } from "@web-console-next/components/kitchen/nav";
import { ANU, DEV, FLAT, ME, NAMES, PERSONAL_REF, groupPantry, groupRef, makeItem, personalPantry } from "./kitchen-pantry-fixtures";

// cookpool-revamp RV-21 (the canvas's RvKitchenB and RvShopping): the title
// switcher, the rows' use-soon line and stock bar, Always have per pantry
// with its sheet (Running low · Out · Got more and the equal split), the
// shopping list's count and lines, and Say it ticking rows.

const read = (file: string) => readFileSync(`${cwd()}/../../apps/web-console-next/src/components/kitchen/${file}`, "utf8");

function staple(o: Partial<KitchenStaple> & { name: string }): KitchenStaple {
  return {
    id: `stp_${o.name.toLowerCase().replace(/\W/g, "")}`,
    foodKey: null, status: "ok", lastPriceMinor: null, currency: null, lastQtyMilli: null, lastUnit: null,
    wantQtyMilli: null, wantUnit: null, boughtAt: null, updatedBy: ME, updatedAt: "2026-11-02T08:00:00.000Z",
    ...o,
  };
}
function line(o: Partial<ShoppingItem> & { name: string }): ShoppingItem {
  return { id: `shp_${o.name.toLowerCase()}`, qtyMilli: null, unit: null, addedBy: ME, createdAt: "2026-11-02T08:00:00.000Z", ...o };
}
const FLAT_PANTRY: StaplePantry = {
  owner: { kind: "group", ...FLAT },
  currency: "INR",
  splitAmong: [ANU, ME, DEV],
  staples: [staple({ name: "Cooking oil", status: "low", lastPriceMinor: 19000 }), staple({ name: "Salt" }), staple({ name: "Tea", status: "out", lastPriceMinor: 18000, lastQtyMilli: 250_000, lastUnit: "g" })],
  isSet: true,
  items: [line({ name: "Onions", addedBy: ANU, qtyMilli: 1_000_000, unit: "kg" })],
};
const MINE: StaplePantry = {
  owner: { kind: "personal" },
  currency: "INR",
  splitAmong: [],
  staples: [staple({ name: "Coffee", status: "low", lastPriceMinor: 32000 })],
  isSet: true,
  items: [line({ name: "Lemons" })],
};
const RES: StaplesResponse = { pantries: [MINE, FLAT_PANTRY] };

describe("the title switcher (RV-21)", () => {
  const pantries = [personalPantry(), groupPantry(FLAT)];
  const rows = [
    { item: makeItem({ name: "Milk" }), status: { soon: false, expired: false } },
    { item: makeItem({ name: "Paneer" }), status: { soon: true, expired: false } },
    { item: makeItem({ name: "Yogurt", pantry: PERSONAL_REF }), status: { soon: false, expired: true } },
  ];

  it("lists All kitchens, then Mine, then each group, with counts, people and use soon; the current one on", () => {
    const options = switcherOptions({ pantries, rows, staples: RES, view: FLAT.orgId });
    expect(options.map((o) => [o.key, o.name, o.count, o.soon, o.on])).toEqual([
      [ALL_VIEW, "All kitchens", "3 items", 2, false],
      ["personal", "Mine", "1 item", 1, false],
      [FLAT.orgId, "Flat 4B", "2 items · 3 people", 1, true],
    ]);
    expect(options[0]!.soonText).toBe("2 use soon");
  });

  it("titles the page, and keeps a choice only while it is still a pantry of yours", () => {
    expect(kitchenTitle(ALL_VIEW, pantries)).toBe("Kitchen");
    expect(kitchenTitle("personal", pantries)).toBe("Mine");
    expect(kitchenTitle(FLAT.orgId, pantries)).toBe("Flat 4B");
    expect(parseView(FLAT.orgId, pantries)).toBe(FLAT.orgId);
    expect(parseView("org_gone", pantries)).toBe(ALL_VIEW);
    expect(parseView(null, pantries)).toBe(ALL_VIEW);
    expect(viewShow(ALL_VIEW)).toEqual({ kind: "all" });
    expect(viewShow(FLAT.orgId)).toEqual({ kind: "pantry", key: FLAT.orgId });
  });
});

describe("rows: use soon and the stock bar (RV-21)", () => {
  it("says Use by tomorrow in amber, Expired in red, and leaves a logged line alone", () => {
    const last = { text: "1 glass · yesterday", tone: "muted" as const };
    expect(kitchenRowMeta(last, { soon: true, expired: false }, "tomorrow")).toEqual({ text: "Use by tomorrow", tone: "soon" });
    expect(kitchenRowMeta(last, { soon: false, expired: true }, "today")).toEqual({ text: "Expired", tone: "expired" });
    expect(kitchenRowMeta(last, { soon: false, expired: false }, null)).toBe(last);
    const logged = { text: "Logged 1 glass · just now", tone: "logged" as const };
    expect(kitchenRowMeta(logged, { soon: true, expired: false }, "tomorrow")).toBe(logged);
  });

  it("draws what is left, amber under a fifth, the expired tint once expired, never thinner than 4 %", () => {
    expect(stockBar({ qtyLeftMilli: 600, qtyBoughtMilli: 1000 }, { expired: false })).toEqual({ pct: 60, tone: "ok", text: "60 percent left" });
    expect(stockBar({ qtyLeftMilli: 150, qtyBoughtMilli: 1000 }, { expired: false })).toEqual({ pct: 15, tone: "low", text: "Running low, 15 percent left" });
    expect(stockBar({ qtyLeftMilli: 250, qtyBoughtMilli: 1000 }, { expired: true }).tone).toBe("expired");
    expect(stockBar({ qtyLeftMilli: 1, qtyBoughtMilli: 1000 }, { expired: false }).pct).toBe(4);
  });

  it("wires the bar and the line into the Kitchen's rows, and the Log bar onto RV-19's bottom bar", () => {
    const ui = read("kitchen-tick-ui.tsx");
    expect(ui).toContain("kitchenRowMeta(base, row.status, useBy)");
    expect(ui).toContain("<StockBar {...bar} />");
    expect(ui).toContain("var(--cp-bottom-bar,");
  });
});

describe("Always have per pantry (RV-21)", () => {
  it("draws a chip per staple with its dot, and a group's says split equally", () => {
    expect(stapleChips(FLAT_PANTRY).map((c) => [c.name, c.dot, c.label])).toEqual([
      ["Cooking oil", "low", "Cooking oil, running low, options"],
      ["Salt", null, "Salt, options"],
      ["Tea", "out", "Tea, out, options"],
    ]);
    expect(stapleSub(FLAT_PANTRY)).toBe("· split equally");
    expect(stapleSub(MINE)).toBe("");
  });

  it("toggles Running low and Out, with the board's toasts", () => {
    expect(nextStatus("ok", "low")).toBe("low");
    expect(nextStatus("low", "low")).toBe("ok");
    expect(nextStatus("low", "out")).toBe("out");
    expect(statusToast("Tea", "ok", "out")).toBe("Tea · on the shopping list");
    expect(statusToast("Tea", "out", "ok")).toBe("Tea · off the shopping list");
    expect(statusToast("Tea", "low", "out")).toBe("Tea · marked out");
  });

  it("Got more on a group's: last price to start, each share by largest remainder, you first", () => {
    const tea = FLAT_PANTRY.staples[2]!;
    const view = stapleSheet(tea, FLAT_PANTRY, { typedMinor: null, meId: ME, names: NAMES });
    expect(view).toMatchObject({ name: "Tea", sub: "Flat 4B · split equally · out", subTone: "expired", outOn: true, pricePh: "180", priceMinor: 18000 });
    expect(view.splitLine).toBe("₹60 each · You, Anu, Dev");
    expect(view.postLabel).toBe("Split ₹180 equally");
    // ₹100 among three: the biggest share is what each line says.
    expect(stapleSheet(tea, FLAT_PANTRY, { typedMinor: 10000, meId: ME, names: NAMES }).splitLine).toMatch(/^₹33\.34 each/);
    expect(boughtToast(view, FLAT_PANTRY)).toBe("Tea ₹180 · ₹60 each");
  });

  it("Got more on your own: just you, no split", () => {
    const coffee = MINE.staples[0]!;
    const view = stapleSheet(coffee, MINE, { typedMinor: null, meId: ME, names: NAMES });
    expect(view).toMatchObject({ sub: "Mine · running low", splitLine: "Just you · no split", postLabel: "Add ₹320" });
    expect(boughtToast(view, MINE)).toBe("Coffee · ₹320");
  });
});

describe("the shopping list (RV-21)", () => {
  it("counts every pantry's staples running low or out and its hand-added lines", () => {
    expect(shoppingCount(RES)).toBe(5);
    expect(shoppingCount(null)).toBe(0);
    expect(shoppingLabel(5)).toBe("Shopping list, 5 items");
  });

  it("lists by pantry: Always have first with its dot, amount and last price, then who added what", () => {
    const groups = listGroups(RES, { meId: ME, names: NAMES });
    expect(groups.map((g) => [g.title, g.sub])).toEqual([
      ["Mine", ""],
      ["Flat 4B", "· split equally"],
    ]);
    expect(groups[1]!.rows.map((r) => [r.name, r.source, r.dot, r.fact])).toEqual([
      ["Cooking oil", "staple", "low", "Running low · ₹190"],
      ["Tea", "staple", "out", "Out · 250 g · ₹180"],
      ["Onions", "hand", null, "Anu added · 1 kg"],
    ]);
    expect(groups[0]!.rows.map((r) => r.fact)).toEqual(["Running low · ₹320", "Added by you"]);
  });

  it("asks for a staple's wanted amount, else what it was last bought in", () => {
    const want = { ...FLAT_PANTRY, staples: [staple({ name: "Tea", status: "out", lastQtyMilli: 250_000, lastUnit: "g", wantQtyMilli: 500_000, wantUnit: "g" })] };
    expect(shoppingLines(want)[0]).toMatchObject({ source: "staple", qtyMilli: 500_000, unit: "g" });
    expect(listAmount(2_000_000, "kg")).toBe("2 kg");
    expect(listAmount(1000, "packet")).toBe("1 packet");
    expect(listAmount(null, "g")).toBeNull();
  });

  it("is a pushed screen without the tab bar, its own static page, and Done shopping opens the run", () => {
    expect(tabBarHidden(true, "/pantry/list")).toBe(true);
    expect(tabBarHidden(false, "/pantry/list")).toBe(false);
    const ui = read("shopping-list-ui.tsx");
    expect(ui).toContain('href="/pantry/run"');
    expect(ui).toContain('title="Done shopping"');
  });
});

describe("Say it ticks the rows it names (RV-21)", () => {
  it("ticks each pickable row once with the amount said; a row that must ask, or isn't listed, is left", () => {
    const eggs = makeItem({ name: "Eggs", unit: "pcs", bought: "12", left: "6", pantry: groupRef(FLAT) });
    const milk = makeItem({ name: "Milk", unit: "L", bought: "1", left: "1", pantry: PERSONAL_REF });
    const said = (item: typeof eggs, quantity: number, unit: string): AiUseProposal => ({
      itemRef: item.pantry.kind === "group" ? { kind: "group", orgId: item.pantry.orgId, itemId: item.id } : { kind: "personal", itemId: item.id },
      name: item.name, pantry: item.pantry, quantity, unit, consumers: [ME], label: `${quantity} ${unit}`, flags: [],
    });
    const rows = new Map([
      [eggs.id, { item: eggs, pickable: true }],
      [milk.id, { item: milk, pickable: false }],
    ]);
    const ticks = saidTicks({ lines: [said(eggs, 2, "pcs"), said(eggs, 3, "pcs"), said(milk, 250, "ml")] }, rows);
    expect(ticks).toEqual([{ id: eggs.id, box: { typed: "2", unit: "u:pcs" } }]);
  });

  it("is inside the search, hidden without AI, and the separate Say it box is gone", () => {
    const ui = read("pantry-new-ui.tsx");
    expect(ui).toContain('aria-label="Say what you used"');
    expect(ui).toContain("{sayShows ? (");
    expect(ui).not.toContain("SayItBox");
    expect(ui).not.toContain("UseSoonStrip");
    expect(ui).toContain("Groceries");
  });
});
