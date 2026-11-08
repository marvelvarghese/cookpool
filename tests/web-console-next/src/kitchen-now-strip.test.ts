import type { KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import {
  NOW_STRIP_MAX,
  NOW_STRIP_USUALS,
  PANTRY_USUALS_LIMIT,
  USUALS_LIMIT,
  inTray,
  msToNextBucket,
  nowHeading,
  nowStrip,
  toggleTray,
  trayButton,
  trayLine,
  trayToast,
  trayWords,
  usualsRead,
  type TrayEntry,
} from "@web-console-next/components/kitchen/now-strip";
import { pantryRow } from "@web-console-next/components/kitchen/pantry-list";
import { itemRefOf } from "@web-console-next/components/kitchen/pantry";
import { qk } from "@web-console-next/lib/query-keys";
import { ANU, ME, NAMES, makeItem, makeUsual as usual, morningUsual as morning } from "./kitchen-pantry-fixtures";

// cookpool-pantry PN-5 (design §1.3, §2.1, §3): the Now strip — the bucket's
// usuals, then what to use soon — Log several's tray, and the usuals read
// (its offset, its limit and its key per part of the day).

const row = (item: ReachableItem, u: KitchenUsual | null = null) => ({ ...pantryRow(item, { usual: u, showPantry: true, meId: ME, names: NAMES }), item });
const liquid = (name: string, o: Parameters<typeof makeItem>[0] = {}) => makeItem({ name, category: "dairy", unit: "L", bought: "1", priceMinor: 6800, ...o });

describe("the Now strip (design §3)", () => {
  it("is headed with the part of the day", () => {
    expect(nowHeading("morning")).toBe("NOW · MORNING");
    expect(nowHeading("night")).toBe("NOW · NIGHT");
  });

  it("offers this bucket's strip usuals (most uses first), then use-soon items (soonest first)", () => {
    const milk = liquid("Milk");
    const coffee = liquid("Coffee");
    const juice = liquid("Juice");
    const paneer = makeItem({ name: "Paneer", unit: "kg", bought: "0.2", daysToUseBy: 1 });
    const curd = makeItem({ name: "Curd", unit: "kg", bought: "0.4", daysToUseBy: 0 });
    const usuals = [
      usual(milk, { now: morning(250_000, 3), strip: true }),
      usual(coffee, { now: morning(250_000, 5), strip: true }),
      usual(juice, { now: morning(250_000, 2), strip: false }),
    ];
    const rows = [row(milk, usuals[0]!), row(coffee, usuals[1]!), row(juice, usuals[2]!), row(paneer), row(curd)];
    const strip = nowStrip(rows, usuals);
    expect(strip.map((c) => c.label)).toEqual([
      "Coffee · 1 glass · Morning usual",
      "Milk · 1 glass · Morning usual",
      "Curd · 100 g · Use soon",
      "Paneer · 100 g · Use soon",
    ]);
    expect(strip.map((c) => c.from)).toEqual(["usual", "usual", "soon", "soon"]);
  });

  it("holds at most NOW_STRIP_USUALS usuals and NOW_STRIP_MAX chips, each item once", () => {
    const items = Array.from({ length: 6 }, (_, i) => liquid(`Drink ${i}`, { daysToUseBy: i % 2 }));
    const usuals = items.map((i, n) => usual(i, { now: morning(250_000, 10 - n), strip: true }));
    const strip = nowStrip(
      items.map((i, n) => row(i, usuals[n]!)).concat(Array.from({ length: 4 }, (_, i) => row(liquid(`Soon ${i}`, { daysToUseBy: i })))),
      usuals,
    );
    expect(NOW_STRIP_USUALS).toBe(4);
    expect(NOW_STRIP_MAX).toBe(6);
    expect(strip).toHaveLength(6);
    expect(strip.filter((c) => c.from === "usual")).toHaveLength(4);
    expect(new Set(strip.map((c) => c.id)).size).toBe(6);
    expect(strip.slice(4).map((c) => c.name)).toEqual(["Drink 4", "Soon 0"]);
  });

  it("leaves out what can't be logged in one tap, and is empty with nothing to offer", () => {
    const milk = liquid("Milk", { canUse: false });
    expect(nowStrip([row(milk, usual(milk, { strip: true, now: morning(250_000, 3) }))], [usual(milk, { strip: true })])).toEqual([]);
    expect(nowStrip([row(liquid("Water"))], [])).toEqual([]);
    expect(nowStrip([], null)).toEqual([]);
  });
});

describe("Log several's tray (design §1.3)", () => {
  const entry = (item: ReachableItem, u: KitchenUsual | null = null): TrayEntry => {
    const r = row(item, u);
    return { itemId: item.id, ref: itemRefOf(item), item, name: item.name, step: r.ladder.suggestion!.step };
  };
  const milk = entry(liquid("Milk"));
  const eggs = entry(makeItem({ name: "Eggs", unit: "pcs", bought: "12", priceMinor: 8400 }), null);
  const atta = entry(makeItem({ name: "Atta", category: "grains", unit: "kg", bought: "5", priceMinor: 25000 }));

  it("gathers a tap in and a second tap out, one entry per item", () => {
    let tray = toggleTray([], milk);
    tray = toggleTray(tray, eggs);
    expect(tray.map((e) => e.name)).toEqual(["Milk", "Eggs"]);
    expect(inTray(tray, milk.itemId)).toBe(true);
    tray = toggleTray(tray, milk);
    expect(tray.map((e) => e.name)).toEqual(["Eggs"]);
    expect(inTray(tray, milk.itemId)).toBe(false);
  });

  it("reads what is in it, and Log N for you", () => {
    const tray = [milk, eggs, atta];
    expect(trayWords(milk)).toBe("1 glass milk");
    expect(trayWords({ name: "Onions", step: { ...milk.step, words: "2 onions" } })).toBe("2 onions");
    expect(trayLine(tray)).toBe("1 glass milk · eggs × 1 · 100 g atta");
    expect(trayButton(tray)).toBe("Log 3 for you");
  });

  it("says in one toast what was logged and what it cost, and which were refused", () => {
    expect(trayToast([milk, atta])).toEqual({ title: "Logged 2 for you · ₹22.00" });
    expect(trayToast([milk, atta], [atta])).toEqual({ title: "Logged 1 of 2 for you", description: "Couldn't log Atta. ₹17.00" });
  });
});

describe("the usuals read (design §2.1)", () => {
  const at = new Date("2026-11-08T02:40:00.000Z");

  it("is exactly today's in today's frame", () => {
    expect(usualsRead(false, at)).toEqual({ key: qk.kitchenUsuals(), query: { limit: USUALS_LIMIT }, bucket: null });
    expect(USUALS_LIMIT).toBe(10);
  });

  it("sends the device's offset, asks for a usual per row, and is keyed by the part of the day", () => {
    const read = usualsRead(true, at);
    const tz = -at.getTimezoneOffset();
    expect(read.query).toEqual({ limit: PANTRY_USUALS_LIMIT, tzOffset: tz });
    expect(PANTRY_USUALS_LIMIT).toBe(100);
    expect(read.key).toEqual(qk.kitchenUsualsAt(read.bucket!));
    // Under the usuals' own prefix, so every stock write still refreshes it.
    expect(read.key.slice(0, 2)).toEqual([...qk.kitchenUsuals()]);
  });

  it("knows when the part of the day changes", () => {
    // 08:10 in India (UTC+5:30) is morning; midday starts at 11:00, 2 h 50 min later.
    expect(msToNextBucket(new Date("2026-11-08T02:40:00.000Z"), 330)).toBe((2 * 60 + 50) * 60_000);
    // 22:00 UTC is night, until 05:00.
    expect(msToNextBucket(new Date("2026-11-08T22:00:00.000Z"), 0)).toBe(7 * 3_600_000);
    expect(msToNextBucket(new Date("2026-11-08T10:59:59.500Z"), 0)).toBe(1_000);
  });
});

void ANU;
