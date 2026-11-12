import type { AiReceiptLine, AiReceiptResponse, AiStatus } from "@saas/contracts/kitchen";
import { frameRedirect } from "@web-console-next/lib/features";
import { aiSwitchOn, parseAiSwitches } from "@web-console-next/lib/ai-switches";
import { boughtHref } from "@web-console-next/components/kitchen/pantry-list";
import { pantryPick, pricePick, runSummary, runToast, stepPick, tickedLine, toggleTick } from "@web-console-next/components/kitchen/shopping-run";
import {
  RECEIPT_SCAN_HREF,
  answerChange,
  answerYes,
  checkQuestion,
  clockText,
  isNonFood,
  nonFoodText,
  readingText,
  receiptCard,
  receiptError,
  receiptLineName,
  receiptPrice,
  receiptQuantity,
  receiptRun,
  receiptScanShows,
  receiptStartPicks,
  receiptUnit,
  categoryLookups,
  foodCategory,
  receiptPantryKey,
  renamePick,
  scanRequested,
  type ReceiptState,
} from "@web-console-next/components/kitchen/receipt-run";
import { FLAT, LUNCH, ME, PERSONAL_REF, TRIP, groupPantry, groupRef, personalPantry } from "./kitchen-pantry-fixtures";
import { TODAY, last, runningLow, usual } from "./kitchen-restock-fixtures";

// cookpool-ai AI-8: Scan a receipt fills the shopping run — a receipt read
// mapped into the run's lines (MATCHED ticked, CHECK asked, non-food left
// out), the bill compared, the questions answered, the refusals, and where
// Scan a receipt shows.

// Where lines can go: yours and the groups you add to (not Lunch club, where you only view).
const writable = [personalPantry(), groupPantry(FLAT), groupPantry(TRIP, { currency: "USD" })];
const MILK = usual({ name: "Milk", category: "dairy", last: last({ unit: "L", qty: "2", priceMinor: 13600, itemId: "itm_milk1", expiresAfterDays: 3 }) });
const ATTA = runningLow({ name: "Atta", category: "grains", last: last({ unit: "kg", qty: "5", priceMinor: 24500, itemId: "itm_atta1", wastePolicy: "buyer_absorbs", expiresAfterDays: 60 }) });
const restock = { finished: [], runningLow: [ATTA], usual: [MILK] };
const ctx = { restock, pantries: writable, meId: ME };

const line = (o: Partial<AiReceiptLine> & Pick<AiReceiptLine, "text">): AiReceiptLine => ({ confidence: "sure", ...o });
const DMART: AiReceiptResponse = {
  store: "DMart",
  total: 66200,
  currency: "INR",
  sumMinor: 66200,
  totalMatches: true,
  lines: [
    line({ text: "AMUL TAAZA 1L x2        136.00", name: "Milk", quantity: 2, unit: "L", priceMinor: 13600, pantry: groupRef(FLAT), fromItemId: "itm_milk1" }),
    line({ text: "AASHIRVAAD ATTA 5KG     245.00", name: "Atta", quantity: 5, unit: "KG", priceMinor: 24500, pantry: groupRef(FLAT), fromItemId: "itm_atta1" }),
    line({ text: "DISH SOAP                44.00", name: "Dish soap", priceMinor: 4400, confidence: "check", reason: "not_food" }),
    line({ text: "MLK PNR 200              95.00", name: "Paneer", quantity: 200, unit: "g", priceMinor: 9500, pantry: groupRef(FLAT), confidence: "check", reason: "no_match" }),
    line({ text: "EGGS WHITE 12N           84.00", name: "Eggs", quantity: 12, unit: "N", priceMinor: 8400, pantry: PERSONAL_REF, fromItemId: "itm_eggs_old" }),
    line({ text: "ONION 1KG                38.00", name: "Onions", quantity: 1, unit: "kg", priceMinor: 3800, pantry: groupRef(FLAT) }),
    line({ text: "XYZ 0042                 20.00", priceMinor: 2000, confidence: "check" }),
  ],
};
const BARE = { currency: "", sumMinor: 0, totalMatches: false };
const run = receiptRun(DMART, ctx);
const byName = (name: string) => run.lines.find((l) => l.name === name || l.receipt?.text.startsWith(name))!;
const start = (): ReceiptState => ({ picks: receiptStartPicks(run), answers: {} });
const summaryOf = (s: ReceiptState) => runSummary(run.lines, s.picks, { pantries: writable, today: TODAY });
const at640 = new Date(2026, 10, 5, 18, 40);

describe("a receipt read into the run", () => {
  it("puts sure food under MATCHED, the rest under CHECK, non-food left out, in the receipt's order", () => {
    expect(run.store).toBe("DMart");
    expect(run.totalMinor).toBe(66200);
    expect(run.lineCount).toBe(7);
    expect(run.matched.map((l) => l.name)).toEqual(["Milk", "Atta", "Eggs", "Onions"]);
    expect(run.check.map(receiptLineName)).toEqual(["Paneer", "XYZ 0042                 20.00"]);
    expect(run.nonFood.map((l) => l.name)).toEqual(["Dish soap"]);
    expect(run.lines.map((l) => l.key)).toEqual(["rcpt:0", "rcpt:1", "rcpt:4", "rcpt:5", "rcpt:3", "rcpt:6", "rcpt:2"]);
    expect(isNonFood({ reason: "not_food" })).toBe(true);
    expect(isNonFood({ reason: "no_match" })).toBe(false);
  });

  it("reads the receipt's amount, unit and price into the line", () => {
    expect(run.matched.map(receiptQuantity)).toEqual(["2 L", "5 kg", "12 pcs", "1 kg"]);
    expect(run.matched.map(receiptPrice)).toEqual(["₹136", "₹245", "₹84", "₹38"]);
    expect(run.matched.map((l) => l.receipt!.text.slice(0, 10))).toEqual(["AMUL TAAZA", "AASHIRVAAD", "EGGS WHITE", "ONION 1KG "]);
    expect([receiptUnit("KG"), receiptUnit("ltr"), receiptUnit("nos"), receiptUnit("Pkt"), receiptUnit("L"), receiptUnit("bags"), receiptUnit(undefined)]).toEqual([
      "kg",
      "L",
      "pcs",
      "pack",
      "L",
      null,
      null,
    ]);
    // No amount or unit read: one piece; an unknown unit takes last time's.
    const bare = receiptRun({ ...BARE, lines: [line({ text: "BREAD", name: "Bread", priceMinor: 4500 }), line({ text: "MILK 2 BAGS", name: "Milk", quantity: 2, unit: "bags", priceMinor: 6800, fromItemId: "itm_milk1" })] }, ctx);
    expect(bare.lines.map(receiptQuantity)).toEqual(["1 pc", "2 L"]);
  });

  it("takes the kind, use-by gap and waste rule from last time when the server matched it", () => {
    const [milk, atta, eggs, onions] = run.matched;
    expect([milk!.line.category, atta!.line.category, eggs!.line.category, onions!.line.category]).toEqual(["dairy", "grains", "other", "other"]);
    expect(atta!.receipt).toEqual({ text: DMART.lines[1]!.text, fromItemId: "itm_atta1", sendRule: true, priced: true });
    expect(eggs!.receipt?.sendRule).toBe(false);
    expect(onions!.receipt?.fromItemId).toBeNull();
  });

  it("puts a line in its pantry, or yours when it names one you can't add to", () => {
    expect(run.lines.map((l) => l.line.pantry.kind === "group" ? l.line.pantry.name : "Me")).toEqual(["Flat 4B", "Flat 4B", "Me", "Flat 4B", "Flat 4B", "Me", "Me"]);
    const viewer = receiptRun({ ...BARE, lines: [line({ text: "SAFFRON 1G", name: "Saffron", priceMinor: 30000, pantry: groupRef(LUNCH) })] }, ctx);
    expect(viewer.lines[0]!.line.pantry.kind).toBe("personal");
    expect(viewer.lines[0]!.tickable).toBe(true);
  });

  it("starts with MATCHED ticked and CHECK and non-food unticked", () => {
    const s = summaryOf(start());
    expect(s.count).toBe(4);
    expect(s.label).toBe("Add 4 · ₹503");
    expect(s.ticked.map((t) => t.key)).toEqual(["rcpt:0", "rcpt:1", "rcpt:4", "rcpt:5"]);
  });

  it("sends each line as PN-6 does, buying again only what was matched", () => {
    const s = summaryOf(start());
    expect(s.request?.lines).toEqual([
      { pantry: FLAT.orgId, name: "Milk", category: "dairy", quantity: "2", unit: "L", priceMinor: 13600, currency: "INR", fromItemId: "itm_milk1", wastePolicy: null, expiresOn: "2026-11-08" },
      { pantry: FLAT.orgId, name: "Atta", category: "grains", quantity: "5", unit: "kg", priceMinor: 24500, currency: "INR", fromItemId: "itm_atta1", wastePolicy: "buyer_absorbs", expiresOn: "2027-01-04" },
      { pantry: "personal", name: "Eggs", category: "other", quantity: "12", unit: "pcs", priceMinor: 8400, currency: "INR", fromItemId: "itm_eggs_old" },
      { pantry: FLAT.orgId, name: "Onions", category: "other", quantity: "1", unit: "kg", priceMinor: 3800, currency: "INR" },
    ]);
    expect(runToast(s)).toBe("Added 4 to your kitchen · ₹503");
  });

  it("keeps every line editable like a run line: the ladder from the receipt's amount, the price scaled, the pantry", () => {
    const milk = byName("Milk");
    let picks = start().picks;
    picks = stepPick(picks, milk, 1);
    expect(tickedLine(milk, picks[milk.key]!, { pantries: writable, today: TODAY })).toMatchObject({ priceText: "272", step: { words: "4 L" } });
    picks = stepPick(picks, milk, -1);
    picks = stepPick(picks, milk, -1);
    expect(tickedLine(milk, picks[milk.key]!, { pantries: writable, today: TODAY })).toMatchObject({ priceText: "68", step: { words: "1 L" } });
    picks = pricePick(picks, milk.key, "70");
    expect(summaryOf({ picks, answers: {} }).label).toBe("Add 4 · ₹437");
    // To your own pantry: no waste rule goes with it.
    picks = pantryPick(picks, milk.key, "personal", writable);
    const sent = summaryOf({ picks, answers: {} }).request!.lines[0]!;
    expect(sent.pantry).toBe("personal");
    expect(sent.wastePolicy).toBeUndefined();
    // Untick.
    expect(toggleTick(picks, milk)[milk.key]).toBeUndefined();
  });
});

describe("categories and currency (AI-3's lines carry no category)", () => {
  it("looks up a category only for lines the restock read doesn't know: by item, else by food", () => {
    const r: AiReceiptResponse = {
      ...BARE,
      lines: [
        line({ text: "MILK", name: "Milk", fromItemId: "itm_milk1", pantry: groupRef(FLAT) }),
        line({ text: "EGGS", name: "Eggs", fromItemId: "itm_eggs_old", foodId: "egg", pantry: PERSONAL_REF }),
        line({ text: "ONION", name: "Onions", foodId: "onion", pantry: groupRef(FLAT) }),
        line({ text: "SOAP", name: "Soap", foodId: "soap", confidence: "check", reason: "not_food" }),
        line({ text: "XYZ", confidence: "check" }),
      ],
    };
    expect(categoryLookups(r, restock)).toEqual([
      { index: 1, kind: "item", itemId: "itm_eggs_old", pantry: PERSONAL_REF },
      { index: 2, kind: "food", foodId: "onion", q: "Onions" },
    ]);
    expect(foodCategory([{ key: "onion", category: "veg" }, { key: "onion_spring", category: "veg" }], "onion")).toBe("veg");
    expect(foodCategory([{ key: "garlic", category: "veg" }], "onion")).toBeNull();
    const mapped = receiptRun(r, { ...ctx, categories: { 1: "protein", 2: "veg" } });
    expect(mapped.lines.map((l) => [l.name || "?", l.line.category])).toEqual([
      ["Milk", "dairy"],
      ["Eggs", "protein"],
      ["Onions", "veg"],
      ["?", "other"],
      ["Soap", "other"],
    ]);
  });

  it("reads the pantry as the PantryRef AI-3 sends", () => {
    expect(receiptPantryKey({ pantry: groupRef(FLAT) })).toBe(FLAT.orgId);
    expect(receiptPantryKey({ pantry: PERSONAL_REF })).toBe("personal");
    expect(receiptPantryKey({})).toBeNull();
  });

  it("prices in the receipt's currency: a line headed for a pantry in another starts empty", () => {
    const r = receiptRun({ ...BARE, currency: "INR", total: 4500, lines: [line({ text: "BREAD", name: "Bread", priceMinor: 4500, pantry: groupRef(TRIP) })] }, ctx);
    expect(r.currency).toBe("INR");
    const s = runSummary(r.lines, receiptStartPicks(r), { pantries: writable, today: TODAY });
    expect(s.ticked[0]).toMatchObject({ currency: "USD", priceText: "" });
    expect(s.problem).toBe("Price for Bread");
    // Moved to your own (INR) pantry, the receipt's price comes back.
    const moved = pantryPick(receiptStartPicks(r), r.lines[0]!.key, "personal", writable);
    expect(runSummary(r.lines, moved, { pantries: writable, today: TODAY }).ticked[0]).toMatchObject({ currency: "INR", priceText: "45" });
  });
});

describe("the receipt card and the bill", () => {
  it("names the store, the time, the lines and the bill", () => {
    const card = receiptCard(run, summaryOf(start()).ticked, at640);
    expect(card.title).toBe("DMart · today 6:40 pm");
    expect(card.sub).toBe("7 lines · bill ₹662");
    expect([clockText(new Date(2026, 10, 5, 0, 5)), clockText(new Date(2026, 10, 5, 12, 0))]).toEqual(["12:05 am", "12:00 pm"]);
  });

  it("compares what is ticked (plus the non-food left out) with the bill", () => {
    let s = start();
    expect(receiptCard(run, summaryOf(s).ticked, at640).total).toEqual({ ok: false, text: "₹115 of the bill isn't ticked" });
    s = answerYes(s, byName("Paneer"));
    expect(receiptCard(run, summaryOf(s).ticked, at640).total).toEqual({ ok: false, text: "₹20 of the bill isn't ticked" });
    const xyz = byName("XYZ");
    s = answerChange(s, xyz);
    s = { ...s, picks: renamePick(s.picks, xyz.key, "Jaggery") };
    expect(receiptCard(run, summaryOf(s).ticked, at640).total).toEqual({ ok: true, text: "Lines add up to the bill ✓" });
    // A typed price above the receipt's: over the bill.
    s = { ...s, picks: pricePick(s.picks, xyz.key, "32") };
    expect(receiptCard(run, summaryOf(s).ticked, at640).total).toEqual({ ok: false, text: "₹12 more than the bill" });
    // Ticking the non-food line too still adds up: it's counted once.
    s = { ...s, picks: pricePick(s.picks, xyz.key, "20") };
    s = { ...s, picks: toggleTick(s.picks, byName("Dish soap")) };
    expect(receiptCard(run, summaryOf(s).ticked, at640).total?.ok).toBe(true);
  });

  it("reads the bill in its pantries' currency, and leaves out lines moved to another", () => {
    expect(run.currency).toBe("INR");
    let s = start();
    s = { ...s, picks: pantryPick(s.picks, "rcpt:5", TRIP.orgId, writable) };
    const sum = summaryOf(s);
    expect(sum.problem).toBe("Price for Onions");
    s = { ...s, picks: pricePick(s.picks, "rcpt:5", "0.45") };
    expect(summaryOf(s).totalText).toBe("₹465 + $0.45");
    expect(receiptCard(run, summaryOf(s).ticked, at640).total?.text).toBe("₹153 of the bill isn't ticked");
    const dollars = receiptRun({ ...BARE, currency: "USD", store: "Trader Joe's", total: 1250, lines: [line({ text: "MILK", name: "Milk", priceMinor: 1250, pantry: groupRef(TRIP) })] }, ctx);
    expect(dollars.currency).toBe("USD");
    expect(receiptCard(dollars, runSummary(dollars.lines, receiptStartPicks(dollars), { pantries: writable, today: TODAY }).ticked, at640)).toEqual({
      title: "Trader Joe's · today 6:40 pm",
      sub: "1 line · bill $12.50",
      total: { ok: true, text: "Lines add up to the bill ✓" },
    });
  });

  it("counts the receipt's own adjustments when the server says the lines reconcile with the bill", () => {
    // A ₹10 discount: the lines come to ₹672, the bill ₹662, and the server found them to reconcile.
    const discounted = receiptRun({ ...DMART, total: 66200, lines: [...DMART.lines, line({ text: "CURD 400G 10.00", name: "Curd", quantity: 400, unit: "g", priceMinor: 1000 })] }, ctx);
    expect(discounted.adjustMinor).toBe(-1000);
    let s: ReceiptState = { picks: receiptStartPicks(discounted), answers: {} };
    const sum = () => runSummary(discounted.lines, s.picks, { pantries: writable, today: TODAY }).ticked;
    s = answerYes(s, discounted.lines.find((l) => l.name === "Paneer")!);
    const xyz = discounted.lines.find((l) => l.receipt?.text.startsWith("XYZ"))!;
    s = answerChange(s, xyz);
    s = { ...s, picks: renamePick(s.picks, xyz.key, "Jaggery") };
    expect(receiptCard(discounted, sum(), at640).total).toEqual({ ok: true, text: "Lines add up to the bill ✓" });
    // When the server says they don't reconcile, the bill itself is the measure.
    const off = receiptRun({ ...DMART, totalMatches: false }, ctx);
    expect(off.adjustMinor).toBe(0);
  });

  it("says nothing about a bill it didn't read, and calls a nameless store Receipt", () => {
    const plain = receiptRun({ ...BARE, lines: [line({ text: "MILK", name: "Milk", priceMinor: 6800 })] }, ctx);
    expect(receiptCard(plain, [], at640)).toEqual({ title: "Receipt · today 6:40 pm", sub: "1 line", total: null });
  });
});

describe("answering a CHECK question", () => {
  it("asks about the line as read", () => {
    expect(checkQuestion(byName("Paneer"))).toEqual({ question: "Is this Paneer · 200 g · ₹95?", yes: "Yes, paneer", change: "Change" });
    expect(checkQuestion(byName("XYZ"))).toEqual({ question: "What is this · ₹20?", yes: null, change: "Name it" });
    const unpriced = receiptRun({ ...BARE, lines: [line({ text: "??", confidence: "check" })] }, ctx).lines[0]!;
    expect(checkQuestion(unpriced).question).toBe("What is this?");
  });

  it("Yes ticks the line as read", () => {
    const paneer = byName("Paneer");
    const s = answerYes(start(), paneer);
    expect(s.answers).toEqual({ [paneer.key]: "yes" });
    const sum = summaryOf(s);
    expect(sum.label).toBe("Add 5 · ₹598");
    expect(sum.request!.lines[4]).toEqual({ pantry: FLAT.orgId, name: "Paneer", category: "other", quantity: "200", unit: "g", priceMinor: 9500, currency: "INR" });
    // A nameless line can't be said yes to.
    expect(answerYes(start(), byName("XYZ"))).toEqual(start());
  });

  it("Change ticks it with its name open; a blank name holds Add", () => {
    const xyz = byName("XYZ");
    let s = answerChange(start(), xyz);
    expect(s.answers[xyz.key]).toBe("change");
    expect(s.picks[xyz.key]?.name).toBe("");
    expect(summaryOf(s)).toMatchObject({ ready: false, problem: "A name for XYZ 0042                 20.00" });
    s = { ...s, picks: renamePick(s.picks, xyz.key, "  Jaggery ") };
    expect(summaryOf(s).request!.lines.at(-1)).toMatchObject({ name: "Jaggery", priceMinor: 2000, pantry: "personal" });
    // Change on a named line keeps its name to edit.
    const paneer = byName("Paneer");
    expect(answerChange(start(), paneer).picks[paneer.key]?.name).toBe("Paneer");
  });

  it("a line without a price asks for one before Add", () => {
    const r = receiptRun({ ...BARE, lines: [line({ text: "CURD 400G", name: "Curd", quantity: 400, unit: "g" })] }, ctx);
    const s = runSummary(r.lines, receiptStartPicks(r), { pantries: writable, today: TODAY });
    expect(s.ticked[0]!.priceText).toBe("");
    expect(s.problem).toBe("Price for Curd");
    // Stepping keeps it empty rather than ₹0.
    const stepped = stepPick(receiptStartPicks(r), r.lines[0]!, 1);
    expect(runSummary(r.lines, stepped, { pantries: writable, today: TODAY }).ticked[0]!.priceText).toBe("");
  });

  it("says what was left out", () => {
    expect(nonFoodText(run.nonFood)).toBe("1 non-food line left out · Dish soap ₹44");
    expect(nonFoodText([...run.nonFood, ...run.nonFood])).toBe("2 non-food lines left out");
    expect(nonFoodText([])).toBeNull();
  });

  it("reads while it waits", () => {
    expect(readingText(null)).toBe("Reading the lines…");
    expect(readingText(9)).toBe("Found 9 lines · matching to your kitchen…");
    expect(readingText(1)).toBe("Found 1 line · matching to your kitchen…");
  });
});

describe("refusals", () => {
  it("hides Scan a receipt when AI isn't set up", () => {
    expect(receiptError({ code: "internal_error", reason: "ai_unavailable" }, 503).kind).toBe("unavailable");
    expect(receiptError({ code: "internal_error", details: { reason: "ai_unavailable" } }, 503).kind).toBe("unavailable");
    expect(receiptError({ code: "internal_error" }, 503).kind).toBe("unavailable");
  });

  it("says to come back tomorrow after today's limit", () => {
    expect(receiptError({ code: "rate_limited", reason: "ai_daily_limit" }, 429)).toEqual({ kind: "limit", title: "You've used today's AI scans · try tomorrow" });
    expect(receiptError({ code: "rate_limited" }, 429).kind).toBe("limit");
  });

  it("offers Retake or adding by hand when the read failed", () => {
    const failed = { kind: "failed", title: "Couldn't read this receipt · Retake or add by hand" };
    expect(receiptError({ code: "internal_error", reason: "ai_failed" }, 502)).toEqual(failed);
    expect(receiptError({ code: "network_error", reason: "offline" }, 0)).toEqual(failed);
    expect(receiptError(null)).toEqual(failed);
  });
});

describe("where Scan a receipt shows", () => {
  const status = (o: Partial<AiStatus> & { receipt?: boolean } = {}): AiStatus => ({
    available: o.available ?? true,
    features: { sayIt: true, receipt: o.receipt ?? true, import: false, voice: false, swaps: false },
    today: { actions: 3, actionsLimit: 50, voiceSeconds: 0, voiceSecondsLimit: 1800 },
  });

  it("shows in the new frame with AI available, the server reading receipts and the switch on", () => {
    expect(receiptScanShows({ isNewFrame: true, status: status(), switchOn: true })).toBe(true);
    expect(receiptScanShows({ isNewFrame: true, status: status({ available: false }), switchOn: true })).toBe(false);
    expect(receiptScanShows({ isNewFrame: true, status: status({ receipt: false }), switchOn: true })).toBe(false);
    expect(receiptScanShows({ isNewFrame: true, status: status(), switchOn: false })).toBe(false);
    expect(receiptScanShows({ isNewFrame: true, status: undefined, switchOn: true })).toBe(false);
  });

  it("the switch is on until turned off on this device", () => {
    expect(aiSwitchOn(null, "receipt")).toBe(true);
    expect(aiSwitchOn('{"receipt":false}', "receipt")).toBe(false);
    expect(aiSwitchOn('{"sayIt":false}', "receipt")).toBe(true);
    expect(aiSwitchOn("not json", "receipt")).toBe(true);
    expect(parseAiSwitches('{"receipt":false,"voice":true,"x":0}')).toEqual({ receipt: false });
    expect(parseAiSwitches("[false]")).toEqual({});
  });

  it("the Pantry's camera opens the run's camera once", () => {
    expect(RECEIPT_SCAN_HREF).toBe("/pantry/run?scan=1");
    expect(scanRequested("?scan=1")).toBe(true);
    expect(scanRequested(new URLSearchParams("scan=1&x=2"))).toBe(true);
    expect(scanRequested("")).toBe(false);
    expect(scanRequested(null)).toBe(false);
  });

  it("with newFrame false nothing changes: no scan, the run sends to the Pantry, + Bought as before", () => {
    expect(receiptScanShows({ isNewFrame: false, status: status(), switchOn: true })).toBe(false);
    expect(frameRedirect("/pantry/run", false)).toBe("/pantry");
    expect(boughtHref()).toBe("/pantry/run");
  });
});
