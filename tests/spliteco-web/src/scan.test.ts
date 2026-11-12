// SE4: a receipt read by Cookpool's reader becomes a draft to check — doubtful
// lines flagged, the total checked, and the Itemized screen prefilled.

import type { AiReceiptResponse } from "@saas/contracts/kitchen";
import {
  addCharge,
  aiFallback,
  applyScan,
  chargeKind,
  confirmLine,
  draftFromReceipt,
  fixLine,
  prefillItems,
  readSummary,
  removeLine,
  scanStatus,
  setTotal,
  stashScan,
  takeScan,
  SCAN_DRAFT_KEY,
} from "@/lib/scan";
import { buildRequest, newForm, totalOf } from "@/lib/split-form";
import { base64Bytes, fitWithin } from "@/lib/photo";

// The canvas's Beach Shack bill: 6 items, GST and service printed apart, ₹4,416.
const BEACH: AiReceiptResponse = {
  store: "The Beach Shack",
  total: 441600,
  currency: "INR",
  sumMinor: 384000,
  totalMatches: true,
  lines: [
    { text: "Prawn curry", name: "Prawn curry", priceMinor: 68000, confidence: "check", reason: "no price from before" },
    { text: "Fish thali x2", name: "Fish thali", quantity: 2, unit: "pcs", priceMinor: 84000, confidence: "sure" },
    { text: "Chkn xacuti", name: "Chicken xacuti", priceMinor: 56000, confidence: "check", reason: "not sure what Chkn xacuti is" },
    { text: "Kingfshr x6", name: "Kingfisher", quantity: 6, unit: "pcs", priceMinor: 108000, confidence: "check", reason: "unclear" },
    { text: "Garlic naan x4", name: "Garlic naan", quantity: 4, unit: "pcs", priceMinor: 36000, confidence: "sure" },
    { text: "Bebinca", name: "Bebinca", priceMinor: 32000, confidence: "check", reason: "not_food" },
    { text: "GST 5%", priceMinor: 19200, confidence: "check", reason: "not_food" },
    { text: "Svc chg 10%", priceMinor: 38400, confidence: "check", reason: "not_food" },
  ],
};

describe("reading the receipt", () => {
  it("keeps the items as lines and the tax and service as charges", () => {
    const d = draftFromReceipt(BEACH);
    expect(d.lines.map((l) => [l.name, l.qty, l.priceMinor])).toEqual([
      ["Prawn curry", 1, 68000],
      ["Fish thali", 2, 84000],
      ["Chicken xacuti", 1, 56000],
      ["Kingfisher", 6, 108000],
      ["Garlic naan", 4, 36000],
      ["Bebinca", 1, 32000],
    ]);
    expect(d.charges.map((c) => [c.kind, c.label, c.amountMinor])).toEqual([
      ["tax", "GST 5%", 19200],
      ["service", "Svc chg 10%", 38400],
    ]);
    expect(readSummary(d)).toBe("Read 6 items and 2 charges.");
    expect(d.store).toBe("The Beach Shack");
  });

  it("knows a charge line from an item", () => {
    expect(chargeKind("CGST 2.5%", 960)).toBe("tax");
    expect(chargeKind("Service charge", 3840)).toBe("service");
    expect(chargeKind("Discount 10%", 5000)).toBe("discount");
    expect(chargeKind("Round off", -40)).toBe("discount");
    expect(chargeKind("Round off", 30)).toBe("tax");
    expect(chargeKind("Paneer tikka", 32000)).toBeNull();
    expect(chargeKind("Tandoori roti", 4000)).toBeNull();
  });

  it("flags only lines whose reading is in doubt, not Cookpool's kitchen-history checks", () => {
    const d = draftFromReceipt(BEACH);
    const flagged = d.lines.filter((l) => !l.checked).map((l) => [l.name, l.doubt]);
    expect(flagged).toEqual([
      ["Chicken xacuti", "Not sure what this is"],
      ["Kingfisher", "Hard to read"],
    ]);
    const noPrice = draftFromReceipt({ ...BEACH, lines: [{ text: "Lassi", name: "Lassi", confidence: "check", reason: "unclear" }] });
    expect(noPrice.lines[0]).toMatchObject({ priceMinor: null, doubt: "No price could be read", checked: false });
  });

  it("shows the receipt's own unlisted charges as one line when the reader says they make the total", () => {
    const d = draftFromReceipt({ ...BEACH, lines: BEACH.lines.slice(0, 6) });
    expect(d.charges).toEqual([expect.objectContaining({ kind: "tax", label: "Taxes and charges", amountMinor: 57600 })]);
    const off = draftFromReceipt({ ...BEACH, total: 383960, lines: BEACH.lines.slice(0, 6) });
    expect(off.charges).toEqual([expect.objectContaining({ kind: "discount", amountMinor: 40 })]);
  });
});

describe("assigning waits until it is checked and adds up", () => {
  it("is off until every flagged line is confirmed or fixed", () => {
    let d = draftFromReceipt(BEACH);
    expect(scanStatus(d)).toMatchObject({ matches: true, ready: false });
    expect(scanStatus(d).toCheck).toHaveLength(2);
    d = confirmLine(d, d.lines[2]!.key);
    expect(scanStatus(d).ready).toBe(false);
    d = fixLine(d, d.lines[3]!.key, { name: "Kingfisher pint", qty: 6, priceMinor: 108000 });
    expect(scanStatus(d)).toMatchObject({ ready: true, gapMinor: 0 });
    expect(d.lines[3]).toMatchObject({ name: "Kingfisher pint", checked: true });
  });

  it("is off while the lines and charges disagree with the printed total, and says by how much", () => {
    let d = draftFromReceipt({ ...BEACH, totalMatches: false, total: 450000 });
    for (const l of d.lines) d = confirmLine(d, l.key);
    expect(scanStatus(d)).toMatchObject({ matches: false, ready: false, gapMinor: 441600 - 450000 });
    d = addCharge(d, "service", 8400);
    expect(scanStatus(d)).toMatchObject({ matches: true, ready: true });
    // Fixing a line to the wrong price breaks it again.
    d = fixLine(d, d.lines[0]!.key, { priceMinor: 67000 });
    expect(scanStatus(d)).toMatchObject({ gapMinor: -1000, ready: false });
  });

  it("needs a total when none was printed, and a price on every line", () => {
    const noTotal: AiReceiptResponse = { ...BEACH, totalMatches: false };
    delete noTotal.total;
    let d = draftFromReceipt(noTotal);
    for (const l of d.lines) d = confirmLine(d, l.key);
    expect(scanStatus(d)).toMatchObject({ gapMinor: null, ready: false });
    d = setTotal(d, 441600);
    expect(scanStatus(d).ready).toBe(true);
    d = fixLine(d, d.lines[0]!.key, { priceMinor: null });
    expect(scanStatus(d).ready).toBe(false);
    d = removeLine(d, d.lines[0]!.key);
    expect(scanStatus(d).gapMinor).toBe(-68000);
  });
});

describe("the prefill", () => {
  const members = ["usr_me", "usr_anu", "usr_dev"];
  let ready = draftFromReceipt(BEACH);
  for (const l of ready.lines) ready = confirmLine(ready, l.key);

  it("opens Itemized with the items, nobody on them yet, and the charges as amounts", () => {
    const { items, adjustments } = prefillItems(ready);
    expect(items.map((i) => [i.name, i.qtyText, i.totalText, Object.keys(i.shares).length])).toEqual([
      ["Prawn curry", "1", "680", 0],
      ["Fish thali", "2", "840", 0],
      ["Chicken xacuti", "1", "560", 0],
      ["Kingfisher", "6", "1080", 0],
      ["Garlic naan", "4", "360", 0],
      ["Bebinca", "1", "320", 0],
    ]);
    expect(adjustments.map((a) => [a.kind, a.label, a.mode, a.valueText])).toEqual([
      ["tax", "GST 5%", "amount", "192"],
      ["service", "Svc chg 10%", "amount", "384"],
    ]);
    const form = applyScan(newForm(members, "usr_me", "items"), ready, "items");
    expect(form).toMatchObject({ method: "items", title: "The Beach Shack", category: "food" });
    // The bill on the Itemized screen is the printed total, to the paisa.
    expect(totalOf(form)).toBe(441600);
    // Nothing saves until people are on the items.
    expect(buildRequest(form).ok).toBe(false);
  });

  it("splits the printed total equally", () => {
    const form = applyScan(newForm(members, "usr_me"), ready, "equal");
    expect(form).toMatchObject({ method: "equal", amountText: "4416", items: [] });
    const built = buildRequest(form, "INR");
    expect(built.ok && built.request.totalMinor).toBe(441600);
    expect(built.ok && built.request.split).toEqual({ method: "equal", participants: members });
  });

  it("travels to Add expense once, in this tab only", () => {
    const store = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void store.set(k, v), getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) };
    stashScan(storage, { groupId: "org_x", how: "items", draft: ready });
    expect(store.has(SCAN_DRAFT_KEY)).toBe(true);
    expect(takeScan(storage)).toMatchObject({ groupId: "org_x", how: "items", draft: { lines: expect.any(Array) } });
    expect(takeScan(storage)).toBeNull();
    store.set(SCAN_DRAFT_KEY, "{not json");
    expect(takeScan(storage)).toBeNull();
  });
});

describe("when the reader is not there", () => {
  it("falls back to entering items by hand without a key, a budget or today's receipts", () => {
    expect(aiFallback("ai_unavailable", 503)).toBe("unavailable");
    expect(aiFallback("budget", 503)).toBe("unavailable");
    expect(aiFallback("receipt_daily_limit", 429)).toBe("limit");
    expect(aiFallback("ai_daily_limit", 429)).toBe("limit");
    expect(aiFallback(null, 503)).toBe("unavailable");
    // A photo it could not read is "try another photo", not the fallback.
    expect(aiFallback("ai_failed", 502)).toBeNull();
    expect(aiFallback(null, 422)).toBeNull();
  });
});

describe("the photo sent", () => {
  it("is shrunk to 1200 px on the long side, never enlarged", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin(1000, 3000)).toEqual({ width: 400, height: 1200 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("counts its decoded bytes against the route's limit", () => {
    expect(base64Bytes(Buffer.from("hello world").toString("base64"))).toBe(11);
    expect(base64Bytes(Buffer.from("hello").toString("base64"))).toBe(5);
  });
});
