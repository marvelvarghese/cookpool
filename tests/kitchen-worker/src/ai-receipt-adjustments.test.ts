// Receipts, round two (cookpool-ai AI-14): the read returns the receipt's
// discounts, taxes, charges and round-off as their own `adjustments`, each
// `{ kind, label, amountMinor }` — discounts negative, the rest positive,
// round-off either way — and `totalMatches` means the lines plus those
// adjustments meet the printed total. The model replies are canned: GST
// added on top, a store discount, delivery and packing charges, round-off,
// an item discount printed under its line, and none at all.

import { AI_RECEIPT_ADJUSTMENT_KINDS, type AiReceiptResponse } from "@saas/contracts/kitchen";
import { RAHUL, aiWorld } from "./ai-helpers.js";
import { jpeg, line, post, read, scan, type ModelAdjustment } from "./ai-receipt-helpers.js";

const adj = (kind: ModelAdjustment["kind"], text: string, amountMinor: number): ModelAdjustment => ({ kind, text, amountMinor });

async function scanned(r: Parameters<typeof scan>[1]): Promise<AiReceiptResponse> {
  const w = aiWorld();
  try {
    return await scan(w, r);
  } finally {
    w.close();
  }
}

describe("AI-14: what the model is asked for", () => {
  it("asks for each adjustment's kind in the strict schema, and names the four kinds in the prompt", async () => {
    const w = aiWorld();
    w.ai.script.push(read({ lines: [] }));
    await post(w, jpeg());
    const sent = w.ai.sent[0]!;
    const schema = (sent.output_config as unknown as { format: { schema: { properties: Record<string, unknown> } } }).format.schema;
    expect(schema.properties["adjustments"]).toEqual({
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "amountMinor"],
        properties: { kind: { type: "string", enum: AI_RECEIPT_ADJUSTMENT_KINDS }, text: { type: "string" }, amountMinor: { type: "integer" } },
      },
    });
    const system = (sent.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    for (const words of ["kind discount", "tax (a tax ADDED", "charge (a delivery, packing", "roundoff", "printed under it"]) expect(system).toContain(words);
    // Fees are adjustments now, never non-food lines.
    expect(system).not.toContain("delivery or packing fees");
    expect(AI_RECEIPT_ADJUSTMENT_KINDS).toEqual(["discount", "tax", "charge", "roundoff"]);
    w.close();
  });
});

describe("AI-14: the adjustments come back as their own lines", () => {
  it("GST added on top of the prices: CGST and SGST are tax lines, and the total matches", async () => {
    const data = await scanned({
      total: 15750,
      lines: [line("AASHIRVAAD ATTA 5KG", "Atta", 5, "kg", 10000), line("TOOR DAL 1KG", "Toor dal", 1, "kg", 5000)],
      adjustments: [adj("tax", "CGST 2.5%", 375), adj("tax", "SGST 2.5%", 375)],
    });
    expect(data.adjustments).toEqual([
      { kind: "tax", label: "CGST 2.5%", amountMinor: 375 },
      { kind: "tax", label: "SGST 2.5%", amountMinor: 375 },
    ]);
    expect(data).toMatchObject({ total: 15750, sumMinor: 15000, totalMatches: true });
  });

  it("a store discount is negative — even when the model writes it as a positive amount", async () => {
    const data = await scanned({
      store: "More",
      total: 27000,
      lines: [line("GHEE 1L", "Ghee", 1, "L", 20000), line("SUGAR 2KG", "Sugar", 2, "kg", 10000)],
      adjustments: [adj("discount", "BILL DISCOUNT", 3000)],
    });
    expect(data.adjustments).toEqual([{ kind: "discount", label: "BILL DISCOUNT", amountMinor: -3000 }]);
    expect(data.totalMatches).toBe(true);
  });

  it("delivery, packing and handling fees are charges, not lines", async () => {
    const data = await scanned({
      store: "Blinkit",
      total: 33600,
      lines: [line("Amul Taaza Milk 1 L", "Milk", 2, "L", 13600), line("Onion 1 kg", "Onion", 1, "kg", 16400)],
      adjustments: [adj("charge", "Delivery fee", 2500), adj("charge", "Packing charge", 500), adj("charge", "Handling charge", 600)],
    });
    expect(data.lines).toHaveLength(2);
    expect(data.adjustments!.map((a) => [a.kind, a.label, a.amountMinor])).toEqual([
      ["charge", "Delivery fee", 2500],
      ["charge", "Packing charge", 500],
      ["charge", "Handling charge", 600],
    ]);
    expect(data.totalMatches).toBe(true);
  });

  it("round-off keeps its sign, up or down", async () => {
    const down = await scanned({ total: 24500, lines: [line("RICE 5KG", "Rice", 5, "kg", 24540)], adjustments: [adj("roundoff", "ROUND OFF", -40)] });
    expect(down.adjustments).toEqual([{ kind: "roundoff", label: "ROUND OFF", amountMinor: -40 }]);
    expect(down.totalMatches).toBe(true);
    const up = await scanned({ total: 24600, lines: [line("RICE 5KG", "Rice", 5, "kg", 24575)], adjustments: [adj("roundoff", "Rounding", 25)] });
    expect(up.adjustments).toEqual([{ kind: "roundoff", label: "Rounding", amountMinor: 25 }]);
    expect(up.totalMatches).toBe(true);
  });

  it("GST, a coupon, a delivery fee and round-off on one bill: every kind, in the order printed", async () => {
    const data = await scanned({
      total: 41200,
      lines: [line("PANEER 400G", "Paneer", 400, "g", 18000), line("BASMATI 1KG", "Rice", 1, "kg", 20000), line("SURF 500G", "Detergent", 500, "g", 5000, false)],
      adjustments: [adj("tax", "IGST 5%", 2150), adj("discount", "COUPON SAVE50", -5000), adj("charge", "Delivery", 1000), adj("roundoff", "Round off", 50)],
    });
    expect(data.adjustments!.map((a) => a.kind)).toEqual(["tax", "discount", "charge", "roundoff"]);
    // Every line, food or not, plus the adjustments: 43000 + 2150 − 5000 + 1000 + 50 = 41200.
    expect(data).toMatchObject({ sumMinor: 38000, totalMatches: true });
  });

  it("an item discount printed under its line is taken off that line, not returned as an adjustment", async () => {
    const data = await scanned({
      total: 13500,
      // "PANEER 200G 95.00" then "  DISC -10.00": the model writes the line at 85.00.
      lines: [line("PANEER 200G", "Paneer", 200, "g", 8500), line("CURD 400G", "Curd", 400, "g", 5000)],
    });
    expect(data.lines[0]).toMatchObject({ text: "PANEER 200G", priceMinor: 8500 });
    expect(data.adjustments).toEqual([]);
    expect(data.totalMatches).toBe(true);
  });

  it("an item discount the model lists as a discount still reconciles: lines plus adjustments meet the total", async () => {
    const data = await scanned({
      total: 13500,
      lines: [line("PANEER 200G", "Paneer", 200, "g", 9500), line("CURD 400G", "Curd", 400, "g", 5000)],
      adjustments: [adj("discount", "DISC", -1000)],
    });
    expect(data.adjustments).toEqual([{ kind: "discount", label: "DISC", amountMinor: -1000 }]);
    expect(data.totalMatches).toBe(true);
  });

  it("none at all: adjustments is [] (always sent), and the lines alone meet the total", async () => {
    const data = await scanned({ total: 24000, lines: [line("ATTA 5KG", "Atta", 5, "kg", 24000)] });
    expect(data.adjustments).toEqual([]);
    expect(data.totalMatches).toBe(true);
  });
});

describe("AI-14: signs, labels and the total", () => {
  it("a tax or charge read as negative is money off: a discount; zero amounts are dropped; a blank label is the kind's name", async () => {
    const data = await scanned({
      total: 9700,
      lines: [line("MILK 1L", "Milk", 1, "L", 10000)],
      adjustments: [adj("charge", "PROMO", -300), adj("tax", "  ", 0), adj("roundoff", "  ", 0), adj("tax", "   ", 0)],
    });
    expect(data.adjustments).toEqual([{ kind: "discount", label: "PROMO", amountMinor: -300 }]);
    expect(data.totalMatches).toBe(true);
    const blank = await scanned({ total: 10050, lines: [line("MILK 1L", "Milk", 1, "L", 10000)], adjustments: [adj("tax", "  ", 50)] });
    expect(blank.adjustments).toEqual([{ kind: "tax", label: "Tax", amountMinor: 50 }]);
  });

  it("a GST summary already inside the prices (the lines alone meet the total) is dropped, not returned", async () => {
    const data = await scanned({
      total: 10000,
      lines: [line("ATTA 5KG", "Atta", 5, "kg", 10000)],
      adjustments: [adj("tax", "CGST 2.5% incl.", 238), adj("tax", "SGST 2.5% incl.", 238)],
    });
    expect(data.adjustments).toEqual([]);
    expect(data.totalMatches).toBe(true);
  });

  it("lines plus adjustments that miss the total: false, and the adjustments are still returned", async () => {
    const data = await scanned({ total: 50000, lines: [line("ATTA 5KG", "Atta", 5, "kg", 24000)], adjustments: [adj("tax", "GST", 1200)] });
    expect(data.adjustments).toEqual([{ kind: "tax", label: "GST", amountMinor: 1200 }]);
    expect(data.totalMatches).toBe(false);
  });

  it("no total printed: the adjustments come back, totalMatches is false", async () => {
    const data = await scanned({ lines: [line("ATTA 5KG", "Atta", 5, "kg", 24000)], adjustments: [adj("charge", "Delivery", 2000)] });
    expect(data.adjustments).toEqual([{ kind: "charge", label: "Delivery", amountMinor: 2000 }]);
    expect(data.totalMatches).toBe(false);
  });

  it("is still one receipt action, costed on Haiku", async () => {
    const w = aiWorld();
    await scan(w, { total: 10500, lines: [line("ATTA 5KG", "Atta", 5, "kg", 10000)], adjustments: [adj("tax", "GST 5%", 500)] });
    expect(w.ai.sent.map((s) => [s.model, s.max_tokens])).toEqual([["claude-haiku-5-5", 1760]]);
    const rows = w.usageRows();
    expect(rows).toEqual([expect.objectContaining({ user_id: RAHUL, feature: "receipt", model: "claude-haiku-5-5", ok: 1 })]);
    expect(rows[0]!["cost_micros"]).toBeGreaterThan(0);
    w.close();
  });
});
