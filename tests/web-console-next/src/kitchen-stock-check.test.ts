import { buildUse, buildWaste } from "@saas/kitchen-engine/ledger";
import { costOfUse } from "@saas/kitchen-engine/money";
import type { UnitKey } from "@saas/kitchen-engine/units";
import {
  MORE_TEXT,
  checkDiff,
  checkMarks,
  checkOptions,
  checkRefusal,
  checkRequest,
  checkStep,
  checkTitle,
  checkToast,
  checkUndoRefusal,
  checkWrite,
  clampLevel,
  defaultGone,
  fixButton,
  levelAt,
  levelKeyOf,
  levelPercent,
  levelText,
  levelValueText,
  stepLevel,
  thinksAndSays,
  whereTitle,
} from "@web-console-next/components/kitchen/stock-check";
import { frameRedirect } from "@web-console-next/lib/features";
import { SCREENS_WITH_PARENT, backParent } from "@web-console-next/components/kitchen/back";
import { routeDepth, transitionKind } from "@web-console-next/components/kitchen/transitions";
import { STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";
import { isPendingId } from "@web-console-next/lib/optimistic";
import { ANU, DEV, ME, MEERA, NAMES, PERSONAL_REF, makeItem } from "./kitchen-pantry-fixtures";

// cookpool-pantry PN-7 (design §7, the canvas's StockCheck): the stock check
// screen — set what is really left, say where the rest went.

// Milk in Flat 4B: 2 L for ₹68, Meera paid; Cookpool thinks 1 L is left (₹34).
const milk = (o: Parameters<typeof makeItem>[0] = {}) =>
  makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "2", left: "1", priceMinor: 6800, paidBy: MEERA, ...o });
// Flat 4B's members, oldest first.
const FLAT_4B = [MEERA, ME, ANU, DEV];

describe("the level", () => {
  it("has marks for Empty, ¼, ½, ¾ and Full of what was bought, top to bottom", () => {
    expect(checkMarks(milk()).map((m) => [m.label, m.qtyMilli])).toEqual([
      ["Full", 2_000_000],
      ["¾", 1_500_000],
      ["½", 1_000_000],
      ["¼", 500_000],
      ["Empty", 0],
    ]);
    expect(checkMarks(milk({ bought: "0.75", left: "0.5" }))[3]!.qtyMilli).toBe(187_500);
  });

  it("steps by a size that suits what was bought", () => {
    const step = (unit: UnitKey, bought: string) => checkStep(makeItem({ unit, bought }));
    expect([step("L", "2"), step("ml", "500"), step("g", "250"), step("g", "100"), step("g", "50")]).toEqual([50_000, 25_000, 10_000, 5_000, 1_000]);
    expect([step("pcs", "12"), step("pcs", "2"), step("pack", "1")]).toEqual([1_000, 500, 250]);
  });

  it("drags on the grid, settles on a mark or on what Cookpool thinks, and stops at Full", () => {
    const item = milk();
    expect(levelAt(item, 0.375)).toBe(750_000);
    expect(levelAt(item, 0.51)).toBe(1_000_000);
    expect(levelAt(item, 1.2)).toBe(2_000_000);
    expect(levelAt(item, -0.1)).toBe(0);
    expect(levelAt(item, Number.NaN)).toBe(0);
    // 433 g of 1 kg: a drag near it lands on it, so "It's right" is a drag away.
    const flour = makeItem({ unit: "kg", bought: "1", left: "0.433" });
    expect(levelAt(flour, 0.44)).toBe(433_000);
    expect(levelAt(flour, 0.6)).toBe(600_000);
    expect(clampLevel(item, 2_500_000)).toBe(2_000_000);
  });

  it("moves by the arrow keys, Page Up and Down, Home and End", () => {
    const item = milk();
    expect(["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "PageUp", "PageDown", "Home", "End", "a"].map(levelKeyOf)).toEqual([
      "up", "up", "down", "down", "page-up", "page-down", "home", "end", null,
    ]);
    expect(stepLevel(item, 1_000_000, "up")).toBe(1_050_000);
    expect(stepLevel(item, 1_000_000, "down")).toBe(950_000);
    expect(stepLevel(item, 2_000_000, "up")).toBe(2_000_000);
    expect(stepLevel(item, 0, "down")).toBe(0);
    expect(stepLevel(item, 1_020_000, "page-up")).toBe(1_500_000);
    expect(stepLevel(item, 1_020_000, "page-down")).toBe(1_000_000);
    expect(stepLevel(item, 2_000_000, "page-up")).toBe(2_000_000);
    expect([stepLevel(item, 700_000, "home"), stepLevel(item, 700_000, "end")]).toEqual([0, 2_000_000]);
    // Off the grid, what Cookpool thinks is a stop on the way.
    const flour = makeItem({ unit: "kg", bought: "1", left: "0.433" });
    expect(stepLevel(flour, 450_000, "down")).toBe(433_000);
    expect(stepLevel(flour, 433_000, "down")).toBe(400_000);
    expect(stepLevel(flour, 400_000, "up")).toBe(433_000);
    expect(stepLevel(flour, 433_000, "up")).toBe(450_000);
  });

  it("reads as an amount, a share of the level and a slider value", () => {
    const item = milk();
    expect([levelText(item, 750_000), levelText(item, 1_500_000), levelText(item, 0)]).toEqual(["750 ml", "1.5 L", "Empty"]);
    expect(levelValueText(item, 750_000)).toBe("750 ml of 2 L");
    expect(levelValueText(item, 0)).toBe("Empty");
    expect([levelPercent(item, 500_000), levelPercent(item, 3_000_000), levelPercent(item, -1)]).toEqual([25, 100, 0]);
  });
});

describe("Cookpool thinks · You say", () => {
  it("says the difference", () => {
    const item = milk();
    expect(thinksAndSays(item, 750_000)).toEqual({ thinks: "1 L", says: "750 ml" });
    expect(thinksAndSays(milk({ left: "0", state: "used_up" }), 0)).toEqual({ thinks: "Empty", says: "Empty" });
    expect(checkDiff(item, 750_000)).toEqual({ kind: "less", qtyMilli: 250_000, text: "250 ml" });
    expect(checkDiff(item, 1_250_000)).toEqual({ kind: "more", qtyMilli: 250_000, text: "250 ml" });
    expect(checkDiff(item, 1_000_000)).toEqual({ kind: "same" });
    // Above Full is Full.
    expect(checkDiff(item, 2_500_000)).toEqual({ kind: "more", qtyMilli: 1_000_000, text: "1 L" });
    expect(whereTitle({ kind: "less", qtyMilli: 250_000, text: "250 ml" })).toBe("Where did 250 ml go?");
    expect(MORE_TEXT).toBe("More than Cookpool thought. Fixing it moves no money.");
    expect(checkTitle(item)).toEqual({ title: "How much is left?", what: "Milk · Flat 4B" });
    expect(checkTitle(makeItem({ name: "Eggs", pantry: PERSONAL_REF })).what).toBe("Eggs · Personal");
  });
});

describe("where it went (checkOptions)", () => {
  const options = (o: Partial<Parameters<typeof checkOptions>[0]> = {}) =>
    checkOptions({ item: milk(), says: 750_000, roster: FLAT_4B, meId: ME, names: NAMES, ...o });

  it("offers Split, I used it and It went bad for a group's item, Split first", () => {
    const [split, used, bad] = options();
    expect(defaultGone(milk())).toBe("split");
    // 250 ml of ₹68 for 2 L: ₹8.50, by the engine.
    const cost = costOfUse({ priceMinor: 6800, qtyBoughtMilli: 2_000_000, qtyLeftMilli: 1_000_000, costTakenMinor: 3400 }, 250_000);
    expect(cost).toBe(850);
    expect([split!.gone, split!.title, split!.costMinor]).toEqual(["split", "Split with Flat 4B", 850]);
    // ₹8.50 four ways: the odd paisa to the earliest, as the server splits it.
    expect(split!.lines.map((l) => [l.subjectId, l.amountMinor])).toEqual([
      [MEERA, 213],
      [ME, 213],
      [ANU, 212],
      [DEV, 212],
    ]);
    const owed = new Map(buildUse({ costMinor: 850, buyerId: MEERA, consumers: FLAT_4B }).map((s) => [s.subjectId, s.owedMinor]));
    for (const l of split!.lines) expect(l.amountMinor).toBe(owed.get(l.subjectId));
    expect(split!.sub).toBe("≈ ₹2.13 each");
    expect([used!.gone, used!.title, used!.sub]).toEqual(["me", "I used it", "₹8.50 to you · Meera gets it back"]);
    expect([bad!.gone, bad!.title, bad!.sub]).toEqual(["waste", "It went bad", "Waste · ≈ ₹2.13 each"]);
    const wasteOwed = new Map(buildWaste({ unusedMinor: 850, buyerId: MEERA, members: FLAT_4B }).map((s) => [s.subjectId, s.owedMinor]));
    for (const l of bad!.lines) expect(l.amountMinor).toBe(wasteOwed.get(l.subjectId));
  });

  it("says each when it divides evenly, and the rest of the price when it's empty", () => {
    expect(options({ item: milk({ priceMinor: 6400 }) })[0]!.sub).toBe("₹2.00 each");
    // Empty: the last of it costs exactly what is left of the price (₹34), three ways.
    const [split] = options({ says: 0, roster: [MEERA, ME, ANU] });
    expect(split!.costMinor).toBe(3400);
    expect(split!.lines.map((l) => l.amountMinor)).toEqual([1134, 1133, 1133]);
    expect(split!.sub).toBe("≈ ₹11.33 each");
  });

  it("says what the buyer's own answers do", () => {
    const [split, used, bad] = options({ meId: MEERA });
    expect(used!.sub).toBe("₹8.50 · you paid, so no money moves");
    expect(split!.lines[0]).toMatchObject({ subjectId: MEERA, tone: "own" });
    expect(bad!.sub).toBe("Waste · ≈ ₹2.13 each");
    expect(options({ meId: MEERA, item: milk({ wastePolicy: "buyer_absorbs" }) })[2]!.sub).toBe("Waste · You absorb it");
    expect(options({ item: milk({ wastePolicy: "buyer_absorbs" }) })[2]!.sub).toBe("Waste · Meera absorbs it");
    // A group of one: nobody else pays.
    expect(options({ roster: [MEERA], meId: MEERA })[0]!.sub).toBe("₹8.50");
    expect(options({ roster: [MEERA], meId: MEERA })[2]!.sub).toBe("Waste · Nobody else is charged");
  });

  it("waits for the group's members before saying what Split and waste cost", () => {
    const [split, used, bad] = options({ roster: null });
    expect([split!.sub, used!.sub, bad!.sub]).toEqual([null, "₹8.50 to you · Meera gets it back", null]);
  });

  it("offers your own item I used it and It went bad, and never Split", () => {
    const own = milk({ pantry: PERSONAL_REF });
    expect(defaultGone(own)).toBe("me");
    const opts = checkOptions({ item: own, says: 750_000, roster: null, meId: ME });
    expect(opts.map((o) => [o.gone, o.title, o.sub])).toEqual([
      ["me", "I used it", "Logged as yours"],
      ["waste", "It went bad", "Waste · Nothing to split"],
    ]);
  });

  it("asks nothing when more is left, or the same", () => {
    expect(options({ says: 1_250_000 })).toEqual([]);
    expect(options({ says: 1_000_000 })).toEqual([]);
  });
});

describe("Fix", () => {
  it("reads Fix to the level, or It's right at the level Cookpool thinks", () => {
    const item = milk();
    expect(fixButton(item, 1_000_000)).toEqual({ label: "It's right", same: true });
    expect(fixButton(item, 750_000)).toEqual({ label: "Fix to 750 ml", same: false });
    expect(fixButton(item, 0)).toEqual({ label: "Fix to empty", same: false });
    expect(fixButton(item, 2_000_000)).toEqual({ label: "Fix to 2 L", same: false });
  });

  it("sends the level in the base unit, with where it went only when less", () => {
    const item = milk();
    expect(checkRequest(item, 750_000, "split")).toEqual({ left: { quantity: "750", unit: "ml" }, gone: "split" });
    expect(checkRequest(item, 750_000, "waste")).toEqual({ left: { quantity: "750", unit: "ml" }, gone: "waste" });
    expect(checkRequest(item, 0, "me")).toEqual({ left: { quantity: "0", unit: "ml" }, gone: "me" });
    expect(checkRequest(item, 1_250_000, "split")).toEqual({ left: { quantity: "1250", unit: "ml" } });
    expect(checkRequest(item, 3_000_000, "split")).toEqual({ left: { quantity: "2000", unit: "ml" } });
    // "It's right" sends nothing.
    expect(checkRequest(item, 1_000_000, "split")).toBeNull();
    // Your own item never splits.
    expect(checkRequest(milk({ pantry: PERSONAL_REF }), 750_000, "split")).toEqual({ left: { quantity: "750", unit: "ml" }, gone: "me" });
    expect(checkRequest(makeItem({ unit: "dozen", bought: "1", left: "1" }), 2_500, "me")).toEqual({ left: { quantity: "2.5", unit: "pcs" }, gone: "me" });
    expect(checkRequest(makeItem({ unit: "kg", bought: "1", left: "0.5" }), 433_000, "me")).toEqual({ left: { quantity: "433", unit: "g" }, gone: "me" });
  });

  it("shows the check at once: a use or waste of the difference, or a raise with no money", () => {
    const at = "2026-11-02T10:00:00.000Z";
    const write = (says: number, gone: "me" | "split" | "waste", o: Parameters<typeof makeItem>[0] = {}) =>
      checkWrite({ item: milk(o), says, gone, roster: FLAT_4B, meId: ME, at });
    const split = write(750_000, "split")!;
    expect(split.kind).toBe("take");
    expect(split.change).toEqual({ itemId: expect.any(String), kind: "use", qtyMilli: 250_000, costMinor: 850 });
    expect(split.move).toMatchObject({ kind: "use", qtyMilli: 250_000, quantity: 250, unit: "ml", costMinor: 850, actor: ME, consumers: FLAT_4B, via: "check", at, undone: false });
    expect(isPendingId(split.move.id)).toBe(true);
    expect(write(750_000, "me")!.move.consumers).toEqual([ME]);
    expect(write(750_000, "waste")!.move).toMatchObject({ kind: "waste", consumers: null, costMinor: 850 });
    expect(write(750_000, "me", { pantry: PERSONAL_REF })!.move.consumers).toBeNull();
    const raise = write(1_250_000, "split")!;
    expect(raise.kind).toBe("raise");
    expect(raise.change).toMatchObject({ qtyMilli: 250_000, costMinor: 0 });
    expect(raise.move).toMatchObject({ kind: "adjust", qtyMilli: 250_000, costMinor: 0, consumers: null, via: "check" });
    expect(write(1_000_000, "split")).toBeNull();
  });

  it("says in its toast what happened to the difference", () => {
    const toast = (gone: "me" | "split" | "waste", o: { says?: number; meId?: string; item?: ReturnType<typeof milk> } = {}) => {
      const item = o.item ?? milk();
      const says = o.says ?? 750_000;
      const meId = o.meId ?? ME;
      const option = checkOptions({ item, says, roster: FLAT_4B, meId, names: NAMES }).find((x) => x.gone === gone) ?? null;
      return checkToast({ item, says, option, meId, names: NAMES });
    };
    expect(toast("split")).toEqual({ title: "Fixed Milk to 750 ml", description: "250 ml split with Flat 4B · ≈ ₹2.13 each" });
    expect(toast("me")).toEqual({ title: "Fixed Milk to 750 ml", description: "250 ml logged as yours · ₹8.50 to Meera" });
    expect(toast("me", { meId: MEERA }).description).toBe("250 ml logged as yours");
    expect(toast("me", { item: milk({ pantry: PERSONAL_REF }) }).description).toBe("250 ml logged as yours");
    expect(toast("waste").description).toBe("250 ml wasted · ≈ ₹2.13 each");
    expect(toast("waste", { item: milk({ wastePolicy: "buyer_absorbs" }) }).description).toBe("250 ml wasted · Meera absorbs it");
    expect(toast("split", { says: 1_250_000 })).toEqual({ title: "Fixed Milk to 1.25 L", description: "No money moved." });
    expect(toast("split", { says: 0 }).title).toBe("Fixed Milk to empty");
  });

  it("reads a raise's refused Undo as already used, and a refused check in one line", () => {
    expect(checkUndoRefusal({ reason: "insufficient_stock" })).toEqual({
      ok: false,
      kind: "warning",
      title: "Already used",
      description: "What the check added has been used since.",
    });
    expect(checkUndoRefusal({ reason: "already_reversed" })).toBeNull();
    expect(checkRefusal({ reason: "unchanged", message: "x" })).toMatch(/someone fixed it meanwhile/);
    expect(checkRefusal({ reason: "more_than_bought", message: "x" })).toBe("That's more than was bought.");
    expect(checkRefusal({ message: "Boom" })).toBe("Boom");
  });
});

describe("the screen's place in the app", () => {
  it("is a static page, a step under its item, that only the new frame has", () => {
    expect(STATIC_PAGES).toContain("/pantry/:itemRef/check");
    expect(SCREENS_WITH_PARENT).toContain("/pantry/:itemRef/check");
    expect(backParent("/pantry/me:itm_abc123/check")).toBe("/pantry/me:itm_abc123");
    expect(routeDepth("/pantry/me:itm_1/check")).toBe(2);
    expect(transitionKind("/pantry/me:itm_1", "/pantry/me:itm_1/check", { newFrame: true })).toBe("forward");
    // With newFrame false, a visitor is sent to the Pantry.
    expect(frameRedirect("/pantry/:itemRef/check", false)).toBe("/pantry");
    expect(frameRedirect("/pantry/:itemRef/check", true)).toBeNull();
    expect(frameRedirect("/pantry/:itemRef", false)).toBeNull();
  });
});
