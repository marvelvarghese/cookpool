import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import type { AiReceiptResponse, ItemHistoryEntry, KitchenStaple, ShoppingItem, StaplePantry, StaplesResponse } from "@saas/contracts/kitchen";
import {
  LIST_RUN_HREF,
  addedToast,
  boxChange,
  doneBar,
  fromList,
  gotKey,
  gotLabel,
  listBox,
  listUnitOf,
  listedNames,
  needCountText,
  needGroups,
  needSuggestions,
  parseGot,
  toggleGot,
} from "@web-console-next/components/kitchen/shopping-list";
import { adjustText, destChoices, extraRow, matchReceipt, payerChoices, runStartRows, runView, type RunInput } from "@web-console-next/components/kitchen/list-run";
import { spreadAdjustment } from "@web-console-next/components/kitchen/receipt-adjust";
import { tabBarHidden } from "@web-console-next/components/kitchen/nav";
import { ANU, DEV, FLAT, ME, NAMES, TRIP } from "./kitchen-pantry-fixtures";

// cookpool-revamp RV-22 (the boards RvShopping and RvShoppingRun): the
// shopping list's rows, amounts, ticks, suggestions and Done shopping; the
// run's rows by where they go, the receipt's matches and extras, the one
// taxes question, Paid by, and what Add to kitchen saves — staples split
// equally through their Bought, everything else in one purchase, then the
// list cleared.

const SRC = `${cwd()}/../../apps/web-console-next/src`;
const read = (file: string) => readFileSync(`${SRC}/${file}`, "utf8");

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
  staples: [
    staple({ name: "Tea", status: "out", lastPriceMinor: 18000, lastQtyMilli: 250_000, lastUnit: "g", foodKey: "tea" }),
    staple({ name: "Cooking oil", status: "low", lastPriceMinor: 19000, lastQtyMilli: 1_000_000, lastUnit: "L" }),
    staple({ name: "Salt" }),
  ],
  isSet: true,
  items: [line({ name: "Onions", addedBy: ANU, qtyMilli: 1_000_000, unit: "kg" })],
};
const MINE: StaplePantry = {
  owner: { kind: "personal" },
  currency: "INR",
  splitAmong: [],
  staples: [staple({ name: "Coffee", status: "low", lastPriceMinor: 32000, lastQtyMilli: 200_000, lastUnit: "g" })],
  isSet: true,
  items: [line({ name: "Lemons", qtyMilli: 4000, unit: "pcs" })],
};
const TRIP_PANTRY: StaplePantry = { owner: { kind: "group", ...TRIP }, currency: "INR", splitAmong: [ME, ANU], staples: [], isSet: true, items: [] };
const RES: StaplesResponse = { pantries: [MINE, FLAT_PANTRY, TRIP_PANTRY] };
const ALL = [MINE, FLAT_PANTRY, TRIP_PANTRY];
const yes = () => true;

const k = (pantry: string, source: "staple" | "hand", name: string) => gotKey(pantry, source, name);
const TEA = k(FLAT.orgId, "staple", "Tea");
const OIL = k(FLAT.orgId, "staple", "Cooking oil");
const ONIONS = k(FLAT.orgId, "hand", "Onions");
const COFFEE = k("personal", "staple", "Coffee");
const LEMONS = k("personal", "hand", "Lemons");

describe("the shopping list (RV-22, RvShopping)", () => {
  it("groups what each pantry needs: Always have with its Low/Out dot, then what people added and who", () => {
    const groups = needGroups(RES, { meId: ME, names: NAMES, got: [TEA, ONIONS], canEdit: yes });
    expect(groups.map((g) => [g.title, g.sub, g.done])).toEqual([
      ["Mine", "", ""],
      ["Flat 4B", "· split equally", "2 of 3 got"],
    ]);
    expect(groups[1]!.rows.map((r) => [r.name, r.always, r.dot, r.fact, r.got])).toEqual([
      ["Tea", true, "out", "Out", true],
      ["Cooking oil", true, "low", "Low", false],
      ["Onions", false, null, "Anu", true],
    ]);
    expect(groups[0]!.rows.map((r) => r.fact)).toEqual(["Low", "You"]);
    expect(needCountText(groups)).toBe("· 5");
  });

  it("never ticks a viewer's rows", () => {
    const groups = needGroups(RES, { meId: ME, got: [TEA], canEdit: (p) => p.owner.kind === "personal" });
    expect(groups[1]!.canEdit).toBe(false);
    expect(groups[1]!.rows[0]!.got).toBe(false);
  });

  it("shows the saved amount in grey in its unit, converts in the family, and saves only a change", () => {
    const tea = { qtyMilli: 250_000, unit: "g" };
    const ghost = listBox(tea, { typed: "", unit: null });
    expect([ghost.ghost, ghost.unit.id, ghost.units.map((u) => u.id), ghost.words]).toEqual(["250", "u:g", ["u:g", "u:kg"], "250 g"]);
    expect(boxChange(tea, ghost)).toBeNull();
    const kg = listBox(tea, { typed: "", unit: "u:kg" });
    expect([kg.ghost, kg.qtyMilli]).toEqual(["0.25", 250_000]);
    expect(boxChange(tea, kg)).toEqual({ qtyMilli: 250_000, unit: "kg" });
    const typed = listBox(tea, { typed: "500", unit: null });
    expect([typed.number, typed.typed, boxChange(tea, typed)]).toEqual(["500", true, { qtyMilli: 500_000, unit: "g" }]);
    const bad = listBox(tea, { typed: "abc", unit: null });
    expect([bad.invalid, boxChange(tea, bad)]).toEqual([true, null]);
    // No amount yet: one piece.
    expect(listBox({ qtyMilli: null, unit: null }, { typed: "", unit: null }).words).toBe("1 pcs");
    expect([listUnitOf("tbsp"), listUnitOf("loaf"), listUnitOf("L")]).toEqual(["ml", "pcs", "L"]);
  });

  it("keeps ticks by pantry, source and name, so an added line keeps its tick when its id arrives", () => {
    expect(TEA).toBe(`${FLAT.orgId}|staple|tea`);
    expect(toggleGot(toggleGot([], TEA), TEA)).toEqual([]);
    expect(parseGot(JSON.stringify([TEA, 3, ONIONS]))).toEqual([TEA, ONIONS]);
    expect(parseGot("{not json")).toEqual([]);
    expect(gotLabel("250 g", "Tea", false)).toBe("Got it: 250 g of Tea");
    expect(gotLabel("250 g", "Tea", true)).toBe("Got 250 g of Tea, untick");
    expect(addedToast("Ginger", "Flat 4B", true)).toBe("Ginger · Flat 4B · got it");
  });

  it("Done shopping counts what was got and names it; nothing got shows no bar", () => {
    const bar = doneBar([
      { name: "Tea", amount: "250 g", got: true },
      { name: "Cooking oil", amount: "1 L", got: true },
      { name: "Onions", amount: "1 kg", got: false },
    ]);
    expect(bar).toEqual({ title: "Done shopping · 2 items", sub: "Tea 250 g · Cooking oil 1 L", count: 2 });
    expect(doneBar([{ name: "Tea", amount: "250 g", got: false }])).toBeNull();
    expect(LIST_RUN_HREF).toBe("/pantry/run?from=list");
    expect([fromList("?from=list"), fromList(""), fromList("scan=1")]).toEqual([true, false, false]);
  });

  it("suggests past buys with pantry, amount and when, then foods, then the new name to each pantry", () => {
    const history: ItemHistoryEntry[] = [
      { name: "Ginger", category: "veg", dimension: "mass", unit: "g", quantity: 100, qtyMilli: 100_000, priceMinor: 3000, currency: "INR", pantry: { kind: "group", orgId: FLAT.orgId, name: "Flat 4B" }, paidBy: ME, wastePolicy: null, useByDays: null, times: 2, lastBoughtOn: "2026-10-31" },
      { name: "Onions", category: "veg", dimension: "mass", unit: "kg", quantity: 1, qtyMilli: 1_000_000, priceMinor: 4000, currency: "INR", pantry: { kind: "group", orgId: FLAT.orgId, name: "Flat 4B" }, paidBy: ME, wastePolicy: null, useByDays: null, times: 5, lastBoughtOn: "2026-10-30" },
    ];
    const pantries = ALL.map((p) => ({ key: p.owner.kind === "personal" ? "personal" : p.owner.orgId, pantry: p, label: p.owner.kind === "personal" ? "Mine" : p.owner.name }));
    const ctx = { history, foods: [{ key: "garlic", name: "Garlic" }], pantries, listed: listedNames(RES), today: "2026-11-02" };
    const s = needSuggestions("g", ctx);
    expect(s.map((x) => [x.name, x.fact, x.pantryKey, x.qtyMilli, x.unit])).toEqual([
      ["Ginger", "100 g · Flat 4B · Sat", FLAT.orgId, 100_000, "g"],
      ["Garlic", "Food · to Mine", "personal", null, null],
      ["G", "New · to Mine", "personal", null, null],
      ["G", "New · to Flat 4B", FLAT.orgId, null, null],
      ["G", "New · to Goa trip", TRIP.orgId, null, null],
    ]);
    // Onions is on Flat 4B's list already; an exact name offers no new line.
    expect(needSuggestions("onions", ctx).map((x) => [x.name, x.fact])).toEqual([
      ["Onions", "New · to Mine"],
      ["Onions", "New · to Goa trip"],
    ]);
    expect(needSuggestions("ginger", ctx).map((x) => x.name)).toEqual(["Ginger"]);
    expect(needSuggestions("  ", ctx)).toEqual([]);
  });

  it("hides the tab bar on the list and on the run opened from it, not on the old run", () => {
    expect(tabBarHidden(true, "/pantry/list")).toBe(true);
    expect(tabBarHidden(true, "/pantry/run", "?from=list")).toBe(true);
    expect(tabBarHidden(true, "/pantry/run")).toBe(false);
    expect(tabBarHidden(false, "/pantry/run", "from=list")).toBe(false);
  });

  it("draws the rows with the shared TickRow box, and has no Bought wording", () => {
    const ui = read("components/kitchen/shopping-list-ui.tsx");
    expect(ui).toContain("<TickRow");
    expect(ui).toContain('placeholder="Add what we need…"');
    expect(ui).toContain("bottom-[var(--cp-bottom-bar,");
    for (const f of ["components/kitchen/shopping-list-ui.tsx", "components/kitchen/list-run-ui.tsx", "components/kitchen/shopping-list.ts", "components/kitchen/list-run.ts"]) {
      const shown = read(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "").replace(/stapleBought|\/bought|StapleBought\w*/g, "");
      expect([f, /\bBought\b/.test(shown)]).toEqual([f, false]);
    }
  });
});

// ── The run ───────────────────────────────────────────────────────

const GOT = [TEA, OIL, ONIONS, COFFEE];
const base = (o: Partial<RunInput> = {}): RunInput => ({
  rows: runStartRows(RES, GOT),
  extras: [],
  receipt: null,
  edits: {},
  removed: new Set(),
  adjustIn: true,
  pantries: ALL,
  meId: ME,
  names: NAMES,
  payer: null,
  ...o,
});

const RECEIPT: AiReceiptResponse = {
  store: "DMart",
  currency: "INR",
  sumMinor: 0,
  totalMatches: true,
  lines: [
    { text: "TATA TEA GOLD 250G", name: "Tata Tea Gold", foodId: "tea", quantity: 250, unit: "g", priceMinor: 17500, confidence: "sure" },
    { text: "OIL 1L", name: "Cooking oil", quantity: 1, unit: "L", priceMinor: 19800, confidence: "sure" },
    { text: "ONION", name: "Onions", quantity: 1, unit: "kg", priceMinor: 3800, confidence: "sure" },
    { text: "ATTA 5KG", name: "Atta", quantity: 5, unit: "kg", priceMinor: 24500, pantry: { kind: "group", ...FLAT }, confidence: "sure" },
    { text: "CARRY BAG", name: "Carry bag", priceMinor: 500, confidence: "check", reason: "not_food" },
  ],
  adjustments: [
    { kind: "tax", label: "GST", amountMinor: 4200 },
    { kind: "charge", label: "Delivery", amountMinor: 3000 },
    { kind: "discount", label: "Coupon", amountMinor: -5000 },
  ],
};

describe("the shopping run from the list (RV-22, RvShoppingRun)", () => {
  it("takes the rows ticked on the list: a staple to its Always have, a hand line to its pantry, with amounts and last prices", () => {
    const rows = runStartRows(RES, GOT);
    expect(rows.map((r) => [r.name, r.origin.kind, r.dest, r.qtyMilli, r.unit, r.lastPriceMinor])).toEqual([
      ["Coffee", "staple", { kind: "staple" }, 200_000, "g", 32000],
      ["Tea", "staple", { kind: "staple" }, 250_000, "g", 18000],
      ["Cooking oil", "staple", { kind: "staple" }, 1_000_000, "L", 19000],
      ["Onions", "hand", { kind: "item", pantry: FLAT.orgId }, 1_000_000, "kg", null],
    ]);
    // Lemons wasn't ticked.
    expect(rows.some((r) => r.key === LEMONS)).toBe(false);
  });

  it("puts the rows under Mine, Flat 4B · split equally and Flat 4B · by use, totals by last price, and moves a row by its name", () => {
    const v = runView(base());
    expect(v.sections.map((s) => [s.title, s.sub, s.total, s.rows.map((r) => [r.name, r.chip, r.priceGhost, r.price])])).toEqual([
      ["Mine", "", "₹320", [["Coffee", "Mine", "320", ""]]],
      ["Flat 4B", "· split equally", "₹370", [["Tea", "Flat 4B", "180", ""], ["Cooking oil", "Flat 4B", "190", ""]]],
      ["Flat 4B", "· by use", "₹0", [["Onions", "Flat 4B", "0", ""]]],
    ]);
    expect(v.mainLabel).toBe("Add to kitchen · ₹690");
    const tea = runStartRows(RES, GOT)[1]!;
    expect(destChoices(tea, { kind: "staple" }, ALL).map((c) => [c.label, c.on])).toEqual([
      ["Flat 4B · equally", true],
      ["Mine", false],
      ["Flat 4B · by use", false],
      ["Goa trip · by use", false],
    ]);
    // Your own staple: Mine is its Always have, with no second Mine.
    const coffee = runStartRows(RES, GOT)[0]!;
    expect(destChoices(coffee, { kind: "staple" }, ALL).map((c) => c.label)).toEqual(["Mine", "Flat 4B · by use", "Goa trip · by use"]);
    const moved = runView(base({ edits: { [TEA]: { dest: { kind: "item", pantry: "personal" } } } }));
    expect(moved.sections[0]!.rows.map((r) => r.name)).toEqual(["Coffee", "Tea"]);
  });

  it("asks for a price before a group's Always have is split equally", () => {
    const free = runView(base({ edits: { [TEA]: { price: "0" } } }));
    expect(free.problem).toBe("Tea needs a price · it's split equally");
    expect(free.plan).toBeNull();
    expect(runView(base({ edits: { [ONIONS]: { qty: "x" } } })).problem).toBe("Onions needs an amount");
  });

  it("saves staples through their Bought, the rest in one purchase, and clears each pantry's lines", () => {
    const v = runView(base({ edits: { [ONIONS]: { price: "40" }, [OIL]: { dest: { kind: "item", pantry: TRIP.orgId }, qty: "2" } } }));
    const plan = v.plan!;
    expect(plan.staples.map((s) => [s.name, s.pantry, s.stapleId, s.body])).toEqual([
      ["Coffee", null, "stp_coffee", { priceMinor: 32000, currency: "INR", qtyMilli: 200_000, unit: "g" }],
      ["Tea", FLAT.orgId, "stp_tea", { priceMinor: 18000, currency: "INR", qtyMilli: 250_000, unit: "g" }],
    ]);
    expect(plan.purchase!.lines).toEqual([
      { pantry: TRIP.orgId, name: "Cooking oil", category: "other", quantity: "2", unit: "L", priceMinor: 19000, currency: "INR" },
      { pantry: FLAT.orgId, name: "Onions", category: "other", quantity: "1", unit: "kg", priceMinor: 4000, currency: "INR" },
    ]);
    expect(plan.purchase!.paidBy).toBeUndefined();
    // The oil moved to the Goa trip still leaves Flat 4B's list.
    expect(plan.clears).toEqual([
      { pantry: null, itemIds: [], stapleIds: ["stp_coffee"] },
      { pantry: FLAT.orgId, itemIds: ["shp_onions"], stapleIds: ["stp_tea", "stp_cookingoil"] },
    ]);
    expect(plan.restore.staples.map((s) => [s.stapleId, s.status])).toEqual([
      ["stp_coffee", "low"],
      ["stp_tea", "out"],
      ["stp_cookingoil", "low"],
    ]);
    expect(plan.restore.items.map((i) => i.item.name)).toEqual(["Onions"]);
    expect(plan.gotKeys).toEqual([COFFEE, TEA, OIL, ONIONS]);
    expect(v.toast).toBe("Added 4 items · ₹730");
  });

  it("Paid by offers whoever is in every group the run pays into, and names them on the group writes only", () => {
    expect(payerChoices([FLAT.orgId, "personal"], ALL, ME, NAMES)).toEqual([ME, ANU, DEV]);
    expect(payerChoices([FLAT.orgId, TRIP.orgId], ALL, ME, NAMES)).toEqual([ME, ANU]);
    expect(payerChoices(["personal"], ALL, ME, NAMES)).toEqual([ME]);
    const v = runView(base({ payer: ANU }));
    expect(v.payer).toBe(ANU);
    expect(v.plan!.purchase!.paidBy).toBe(ANU);
    expect(v.plan!.staples.map((s) => [s.name, s.body.paidBy])).toEqual([
      ["Coffee", undefined],
      ["Tea", ANU],
      ["Cooking oil", ANU],
    ]);
    // Someone not in every group falls back to you.
    const trip = runView(base({ payer: DEV, edits: { [ONIONS]: { dest: { kind: "item", pantry: TRIP.orgId } } } }));
    expect(trip.payer).toBe(ME);
    expect(trip.plan!.purchase!.paidBy).toBeUndefined();
  });

  it("the receipt fills the prices it finds, ticks them, adds the rest as removable rows, and leaves non-food out", () => {
    const m = matchReceipt(runStartRows(RES, GOT), RECEIPT);
    expect([...m.matched.entries()]).toEqual([
      [TEA, 0],
      [OIL, 1],
      [ONIONS, 2],
    ]);
    expect(m.extra).toEqual([3]);
    const v = runView(base({ receipt: { res: RECEIPT, at: new Date(2026, 10, 2, 18, 40), categories: { 3: "grains" } }, adjustIn: false }));
    expect(v.receipt).toEqual({ title: "DMart · today 6:40 pm", fact: "3 matched · 1 added · ₹976", adjust: "GST ₹42 · Delivery ₹30 · −₹50 off", asks: true });
    const rows = v.sections.flatMap((s) => s.rows.map((r) => [r.name, r.matched, r.price, r.note, r.removable]));
    expect(rows).toEqual([
      ["Coffee", false, "", "not on receipt", false],
      ["Tea", true, "175", "", false],
      ["Cooking oil", true, "198", "", false],
      ["Onions", true, "38", "", false],
      ["Atta", false, "245", "", true],
    ]);
    expect(v.sections.at(-1)!.title).toBe("Also on the receipt");
    expect(v.plan!.purchase!.lines.at(-1)).toEqual({ pantry: FLAT.orgId, name: "Atta", category: "grains", quantity: "5", unit: "kg", priceMinor: 24500, currency: "INR" });
    // Removing it takes it off; Undo of the remove is the caller putting the key back.
    const gone = runView(base({ receipt: { res: RECEIPT, at: new Date(), categories: {} }, removed: new Set(["rcpt:3"]) }));
    expect(gone.sections.some((s) => s.title === "Also on the receipt")).toBe(false);
  });

  it("one Yes spreads the taxes, charges and discounts over the priced lines by price; No leaves them out", () => {
    const at = new Date(2026, 10, 2, 18, 40);
    const no = runView(base({ receipt: { res: RECEIPT, at, categories: {} }, adjustIn: false }));
    const yes = runView(base({ receipt: { res: RECEIPT, at, categories: {} }, adjustIn: true }));
    expect(yes.totalMinor - no.totalMinor).toBe(4200 + 3000 - 5000);
    // Only the receipt's own lines take a share: Coffee, not on it, keeps its price.
    const printed = [17500, 19800, 3800, 24500];
    const spread = spreadAdjustment(printed, 2200);
    expect(yes.plan!.staples.map((s) => s.body.priceMinor)).toEqual([32000, spread[0], spread[1]]);
    expect(yes.plan!.purchase!.lines.map((l) => l.priceMinor)).toEqual([spread[2], spread[3]]);
    // The boxes keep the printed prices.
    expect(yes.sections[1]!.rows[0]!.price).toBe("175");
    expect(adjustText({ currency: "INR", adjustments: [{ kind: "roundoff", label: "Round off", amountMinor: 20 }] })).toBe("");
  });

  it("+ Add something else adds one piece to Mine under Not on the list, removable", () => {
    const v = runView(base({ extras: [extraRow("bananas", 0)] }));
    const last = v.sections.at(-1)!;
    expect([last.title, last.sub, last.rows.map((r) => [r.name, r.chip, r.qtyGhost, r.unit, r.removable])]).toEqual(["Not on the list", "· 1", [["Bananas", "Mine", "1", "pcs", true]]]);
    expect(v.plan!.purchase!.lines.at(-1)).toMatchObject({ pantry: "personal", name: "Bananas", quantity: "1", unit: "pcs", priceMinor: 0 });
  });

  it("is what /pantry/run renders from the list, keeping the old run otherwise, and its bar sits on --cp-bottom-bar", () => {
    const page = read("app/(kitchen)/pantry/run/page.tsx");
    expect(page).toContain("list ? <ListRun /> : <ShoppingRun />");
    expect(page).toContain('useNewFrameOnly("/pantry/run")');
    const ui = read("components/kitchen/list-run-ui.tsx");
    expect(ui).toContain("bottom-[var(--cp-bottom-bar,");
    expect(ui).toContain("Scan the receipt");
    expect(ui).toContain("Include in item costs?");
    expect(ui).toContain(") : scan.shows ? (");
  });
});
