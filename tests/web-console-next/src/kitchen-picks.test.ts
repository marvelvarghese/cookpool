import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { KitchenMeasure, ReachableItem } from "@saas/contracts/kitchen";
import { TICK_EMPTY, tickAmount, tickStart, tickUnitChoice, tickWrite, unitPickerOn } from "@web-console-next/components/kitchen/tick-row";
import {
  itemsWord,
  logBar,
  loggedMeta,
  pickStep,
  pickToast,
  pickWords,
  togglePick,
  withPicks,
  withoutPicks,
} from "@web-console-next/components/kitchen/kitchen-picks";
import { sendInOrder, undoLastFirst } from "@web-console-next/components/kitchen/log-several";
import { itemLadder } from "@web-console-next/components/kitchen/pantry-set";
import { FLAT, PERSONAL_REF, groupRef, makeItem, makeUsual, morningUsual } from "./kitchen-pantry-fixtures";

// cookpool-revamp RV-13 (the canvas's RvKitchen, "Tick to log — the rules"
// 3 and 6): in the Kitchen a tick only picks the row, its amount and unit
// stay editable, one Log button logs every picked row with one Undo, and the
// unit button with its ▾ works on picked and unpicked rows alike.

const GLASS: KitchenMeasure = { id: "msr_glass", one: "glass", many: "glasses", count: 1, amountMilli: 250_000 };
const milk = (): ReachableItem => ({
  ...makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "2", left: "1.5", priceMinor: 13600, pantry: groupRef(FLAT) }),
  measures: [GLASS],
});
const eggs = () => makeItem({ name: "Eggs", category: "protein", unit: "pcs", bought: "6", left: "4", priceMinor: 8400, pantry: PERSONAL_REF });
const startOf = (item: ReachableItem, qtyMilli: number) => tickStart(item, itemLadder(item, makeUsual(item, { lastQtyMilli: qtyMilli, now: morningUsual(qtyMilli, 4) })).suggestion);

const root = `${cwd()}/../../apps/web-console-next/src/components/kitchen`;
const read = (file: string) => readFileSync(`${root}/${file}`, "utf8");

describe("a tick picks (nothing is written)", () => {
  it("picks, and ticking again unpicks, keeping the order things were picked in", () => {
    const one = togglePick(new Set(), "itm_milk");
    const two = togglePick(one, "itm_eggs");
    expect([...two]).toEqual(["itm_milk", "itm_eggs"]);
    expect([...togglePick(two, "itm_milk")]).toEqual(["itm_eggs"]);
    // Never mutates.
    expect([...one]).toEqual(["itm_milk"]);
  });

  it("takes logged rows out and puts refused or undone ones back", () => {
    const picked = new Set(["a", "b", "c"]);
    expect([...withoutPicks(picked, ["a", "c"])]).toEqual(["b"]);
    expect([...withPicks(withoutPicks(picked, ["a", "c"]), ["c"])]).toEqual(["b", "c"]);
  });

  it("is a pick in the Kitchen: the row writes nothing on tick (no single-use write is left in it)", () => {
    const ui = read("kitchen-tick-ui.tsx");
    expect(ui).not.toMatch(/useLogUse/);
    expect(ui).toContain("ticks.toggle(row.id)");
    expect(ui).toContain("picked={picked}");
  });
});

describe("the Log button", () => {
  it("says how many and lists what and how much, the thing's own word left out", () => {
    expect(itemsWord(1)).toBe("1 item");
    expect(pickWords({ name: "Milk", number: "1", word: "glass" })).toBe("Milk 1 glass");
    expect(pickWords({ name: "Eggs", number: "2", word: "eggs" })).toBe("Eggs 2");
    expect(
      logBar([
        { id: "a", name: "Milk", number: "1", word: "glass" },
        { id: "b", name: "Eggs", number: "2", word: "eggs" },
      ]),
    ).toEqual({ title: "Log 2 items", sub: "Milk 1 glass · Eggs 2", label: "Log 2 items: Milk 1 glass · Eggs 2" });
    expect(logBar([{ id: "a", name: "Milk", number: "1", word: "glass" }])?.title).toBe("Log 1 item");
    expect(logBar([])).toBeNull();
  });

  it("sits above the tab bar, clear of the safe area, marked for toasts to lift above it", () => {
    const ui = read("kitchen-tick-ui.tsx");
    expect(ui).toContain("sticky z-30");
    // RV-21: RV-19's --cp-bottom-bar (0 where a pushed screen hides the bar), 6 px above the bar's room.
    expect(ui).toContain("bottom-[calc(var(--cp-bottom-bar,calc(max(14px,env(safe-area-inset-bottom))+76px))+6px)]");
    expect(ui).toMatch(/data-toast-above=""/);
  });
});

describe("Log once: every picked row, one toast, one Undo", () => {
  it("writes each picked row as its own use: a measure as a count of it, else an amount", () => {
    const m = milk();
    const a = tickAmount(m, startOf(m, 250_000), TICK_EMPTY)!;
    expect(pickStep(m, a)).toMatchObject({ qtyMilli: 250_000, words: "1 glass", rest: false, amount: { kind: "measure", quantity: 1, qtyMilli: 250_000 } });
    const typedMl = tickAmount(m, startOf(m, 250_000), { typed: "300", unit: "u:ml" })!;
    expect(pickStep(m, typedMl)).toMatchObject({ qtyMilli: 300_000, amount: { kind: "unit", qtyMilli: 300_000 } });
    // Exactly what a tick logged before RV-13.
    expect(pickStep(m, a).qtyMilli).toBe(tickWrite(m, a).qtyMilli);
  });

  it("goes through Log several once, with its own idempotency key per use, one toast and Undo putting the picks back", () => {
    const ui = read("kitchen-tick-ui.tsx");
    expect(ui.match(/logSeveral\(/g)).toHaveLength(1);
    expect(ui).toContain("toast: pickToast");
    expect(ui).toContain("onRestore");
    const data = read("log-several-data.ts");
    expect(data.match(/idempotencyKey: crypto\.randomUUID\(\)/g)?.length).toBe(2);
    expect(data).toContain("ctx.onRestore?.()");
  });

  it("sends one after another and undoes every written one, the last first, the refused skipped", async () => {
    const order: number[] = [];
    const answers = await Promise.all(sendInOrder([0, 1, 2].map((i) => () => Promise.resolve({ i, ok: i !== 1 }))));
    const r = await undoLastFirst(answers, (a) => a.ok, async (i) => (order.push(i), true));
    expect(order).toEqual([2, 0]);
    expect(r).toEqual({ undone: [2, 0], refused: [] });
  });

  it("toasts once: Logged 2 items; which were refused, still ticked", () => {
    expect(pickToast([{ name: "Milk" }, { name: "Eggs" }])).toEqual({ title: "Logged 2 items" });
    expect(pickToast([{ name: "Milk" }], [])).toEqual({ title: "Logged 1 item" });
    expect(pickToast([{ name: "Milk" }, { name: "Eggs" }], [{ name: "Milk" }])).toEqual({ title: "Logged 1 of 2 items", description: "Couldn't log Milk. Still ticked." });
  });

  it("says on the row what it logged, in the accent text, until reload", () => {
    expect(loggedMeta("1 glass")).toEqual({ text: "Logged 1 glass · just now", tone: "logged" });
  });
});

describe("the unit picker on the row", () => {
  const ui = read("tick-row-ui.tsx");

  it("opens with its ▾ on an unpicked row and on a picked one, and the box stays editable when picked", () => {
    const m = milk();
    const a = tickAmount(m, startOf(m, 250_000), TICK_EMPTY)!;
    expect(unitPickerOn(a, false)).toBe(true);
    // The button and its ▾ follow the one rule; only `done` disables the box.
    expect(ui).toContain("disabled={!canUnit}");
    expect(ui).toContain("{canUnit ? <ChevronDown");
    expect(ui).toContain("disabled={!!done}");
    expect(ui).not.toMatch(/disabled=\{[^}]*picked/);
  });

  it("opens for an item with one unit too (the one stage hid), offering Add a measure on its page", () => {
    const e = eggs();
    const a = tickAmount(e, startOf(e, 2_000), TICK_EMPTY)!;
    expect(a.units).toHaveLength(1);
    expect(unitPickerOn(a, false)).toBe(true);
    expect(ui).toContain("Add a measure");
  });

  it("on a picked row, converts the grey amount, and what Log writes follows", () => {
    const m = milk();
    const start = startOf(m, 250_000);
    const ml = tickAmount(m, start, tickUnitChoice({ typed: "2", unit: null }, "u:ml"))!;
    expect(ml).toMatchObject({ ghost: "250", word: "ml", qtyMilli: 250_000, typed: false });
    expect(pickStep(m, ml)).toMatchObject({ qtyMilli: 250_000, words: "250 ml", amount: { kind: "unit" } });
    expect(logBar([{ id: m.id, name: m.name, number: ml.number, word: ml.word }])?.sub).toBe("Milk 250 ml");
  });

  it("stays locked once done, as the cook session's tick has it (RV-11)", () => {
    const m = milk();
    expect(unitPickerOn(tickAmount(m, startOf(m, 250_000), TICK_EMPTY), true)).toBe(false);
    expect(unitPickerOn(null, false)).toBe(false);
    // The cook session still passes `done`, never `picked`.
    expect(read("cook-tick-ui.tsx")).toContain("done={done}");
    expect(read("cook-tick-ui.tsx")).not.toContain("picked=");
  });
});
