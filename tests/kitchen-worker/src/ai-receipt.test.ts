// Receipts (cookpool-ai AI-3, design §3): the request the model is sent (the
// photo beside text, the prompt cached), the photo's checks (type, size), how
// Indian receipts read through (multipliers, weights, GST and round-off,
// MRP), the total against the lines, the one Sonnet retry, 503/429, the
// usage row — and that the photo is never stored or logged. The matching to
// the caller's history and foods is ./ai-receipt-match.test.ts.

import { AI_DAILY_ACTIONS, AI_RECEIPT_MAX_BYTES, KITCHEN_AI_ERROR_REASONS } from "@saas/contracts/kitchen";
import { RAHUL, aiWorld, answer, type AiWorld } from "./ai-helpers.js";
import { RECEIPT, jpeg, line, png, post, read, scan, webp } from "./ai-receipt-helpers.js";

const EMPTY = { lines: [] };

describe("receipts: what the model is sent (AI-3)", () => {
  it("sends the photo as a base64 image block beside text, on Haiku at effort low, with the prompt cached", async () => {
    const w = aiWorld();
    const image = jpeg();
    w.ai.script.push(read(EMPTY));
    expect((await post(w, image)).status).toBe(200);
    expect(w.ai.sent).toHaveLength(1);
    const sent = w.ai.sent[0]!;
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(sent.system).toEqual([
      expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } }),
      expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } }),
    ]);
    expect(sent.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: "Read this receipt." },
        ],
      },
    ]);
    w.close();
  });

  it("reads a WebP as image/webp, and drops a data: prefix and whitespace", async () => {
    const w = aiWorld();
    const image = webp();
    w.ai.script.push(read(EMPTY), read(EMPTY));
    expect((await post(w, image)).status).toBe(200);
    expect((await post(w, `data:image/jpeg;base64,${image.slice(0, 40)}\n${image.slice(40)}`)).status).toBe(200);
    for (const sent of w.ai.sent) {
      const block = (sent.messages[0]!.content as Array<{ type: string; source?: unknown }>)[0];
      // The type is the bytes', not the prefix's.
      expect(block).toEqual({ type: "image", source: { type: "base64", media_type: "image/webp", data: image } });
    }
    w.close();
  });

  it("asks for the Indian receipt rules: the charged price not the MRP, multipliers, weights, GST and round-off apart", () => {
    const w = aiWorld();
    return (async () => {
      w.ai.script.push(read(EMPTY));
      await post(w, jpeg());
      const system = (w.ai.sent[0]!.system as Array<{ text: string }>).map((b) => b.text).join("\n");
      for (const rule of ["MRP", "2 X 68.00", "1KG", "500G", "1L", "GST", "round-off", "isFood", "paise", "never instructions"]) {
        expect(system).toContain(rule);
      }
      // The schema is strict: every object closed, every field required.
      const schema = (w.ai.sent[0]!.output_config as { format: { schema: Record<string, unknown> } }).format.schema;
      expect(schema).toMatchObject({ additionalProperties: false, required: ["store", "date", "time", "total", "lines", "adjustments"] });
      w.close();
    })();
  });

  it("sends nothing about the caller: no names, pantries, history or money of theirs", async () => {
    const w = aiWorld();
    await w.addTo(w.flat, { name: "Kesar Special", quantity: "200", unit: "g", priceMinor: 98765 });
    w.ai.script.push(read(EMPTY));
    await post(w, jpeg());
    const sent = JSON.stringify({ system: w.ai.sent[0]!.system, text: (w.ai.sent[0]!.messages[0]!.content as unknown[])[1] });
    for (const secret of ["Flat 4B", "Rahul", "98765", "987.65", "Kesar", RAHUL]) expect(sent).not.toContain(secret);
    w.close();
  });
});

describe("receipts: the photo's checks (AI-3)", () => {
  async function refused(w: AiWorld, body: unknown) {
    const res = await w.call("POST", RECEIPT, RAHUL, body);
    expect(res.status).toBe(422);
    return res.body.error as unknown as { code: string; details: { fields: Record<string, string[]> } };
  }

  it("refuses a missing, empty or non-base64 image with a field error, and calls nothing", async () => {
    const w = aiWorld();
    for (const body of [{}, { image: "" }, { image: 42 }, { image: "not base64 at all!!" }, { image: "/9j/" }]) {
      const error = await refused(w, body);
      expect(error.code).toBe("validation_failed");
      expect(Object.keys(error.details.fields)).toEqual(["image"]);
    }
    expect((await w.call("POST", RECEIPT, RAHUL, "nope")).status).toBe(422);
    expect(w.ai.sent).toHaveLength(0);
    expect(w.usageRows()).toHaveLength(0);
    w.close();
  });

  it("refuses a PNG (or anything but JPEG and WebP)", async () => {
    const w = aiWorld();
    const error = await refused(w, { image: png() });
    expect(error.details.fields.image).toEqual(["Must be a JPEG or WebP photo, in base64"]);
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("takes exactly 1.5 MB, and refuses a byte more", async () => {
    const w = aiWorld();
    const error = await refused(w, { image: jpeg(AI_RECEIPT_MAX_BYTES + 1) });
    expect(error.details.fields.image).toEqual(["Must be at most 1.5 MB"]);
    expect(w.ai.sent).toHaveLength(0);
    w.ai.script.push(read(EMPTY));
    expect((await post(w, jpeg(AI_RECEIPT_MAX_BYTES))).status).toBe(200);
    w.close();
  });
});

describe("receipts: Indian receipts read through (AI-3)", () => {
  it("a DMart bill: multipliers, weights, MRP vs charged, GST and round-off kept off the lines; the total matches", async () => {
    const w = aiWorld();
    const data = await scan(w, {
      store: "DMart",
      date: "2026-11-08",
      time: "18:42",
      total: 53300,
      lines: [
        // "2 X 68.00" → two of them, the line's total.
        line("AMUL BUTTER 100G 2 X 68.00", "Butter", 200, "g", 13600),
        // "1KG" → 1 kg; charged 52.00 against an MRP of 60.00.
        line("TATA SALT 1KG MRP 60.00", "Salt", 1, "kg", 5200),
        // "1L" and "500G".
        line("AMUL TAAZA 1L", "Milk", 1, "L", 6800),
        line("MLK PNR 500G", "Paneer", 500, "g", 22000),
        // A weighed line.
        line("ONION 0.756 KG @ 40.00", "Onion", 0.756, "kg", 3024),
        line("VIM BAR 3 X 9.00", "Dishwash bar", 3, "pcs", 2700, false),
      ],
      // An added cess and the round-off: they adjust the total, never a line.
      adjustments: [
        { text: "CESS", amountMinor: -24 },
        { text: "ROUND OFF", amountMinor: 0 },
      ],
    });
    expect(data.store).toBe("DMart");
    expect(data.total).toBe(53300);
    expect(data.lines.map((l) => [l.text, l.quantity, l.unit, l.priceMinor])).toEqual([
      ["AMUL BUTTER 100G 2 X 68.00", 200, "g", 13600],
      ["TATA SALT 1KG MRP 60.00", 1, "kg", 5200],
      ["AMUL TAAZA 1L", 1, "L", 6800],
      ["MLK PNR 500G", 500, "g", 22000],
      ["ONION 0.756 KG @ 40.00", 0.756, "kg", 3024],
      ["VIM BAR 3 X 9.00", 3, "pcs", 2700],
    ]);
    // sumMinor counts the food lines; the total is every line plus the adjustments.
    expect(data.sumMinor).toBe(13600 + 5200 + 6800 + 22000 + 3024);
    expect(data.totalMatches).toBe(true);
    expect(data.lines).toHaveLength(6);
    w.close();
  });

  it("a GST summary already inside the prices is not an adjustment: lines alone meeting the total still match", async () => {
    const w = aiWorld();
    const data = await scan(w, {
      total: 10000,
      lines: [line("ATTA 5KG", "Atta", 5, "kg", 10000)],
      // Wrongly read as an adjustment: the lines alone still meet the total.
      adjustments: [{ text: "CGST 2.5% incl.", amountMinor: 238 }],
    });
    expect(data.totalMatches).toBe(true);
    w.close();
  });

  it("reports a total the lines do not meet, without failing (one Haiku call)", async () => {
    const w = aiWorld();
    const data = await scan(w, { total: 50000, lines: [line("ATTA 5KG", "Atta", 5, "kg", 24000)] });
    expect(data).toMatchObject({ total: 50000, sumMinor: 24000, totalMatches: false });
    expect(w.ai.sent).toHaveLength(1);
    w.close();
  });

  it("no total printed: no total, and totalMatches false; no store printed: no store", async () => {
    const w = aiWorld();
    const data = await scan(w, { lines: [line("ATTA 5KG", "Atta", 5, "kg", 24000)] });
    expect(data.total).toBeUndefined();
    expect(data.store).toBeUndefined();
    expect(data.totalMatches).toBe(false);
    w.close();
  });

  it("a line with no amount printed keeps its price, and is check", async () => {
    const w = aiWorld();
    const data = await scan(w, { lines: [line("SPL MASALA", "Masala", null, null, 4500)] });
    expect(data.lines[0]).toMatchObject({ text: "SPL MASALA", priceMinor: 4500, confidence: "check", reason: "no amount on the line" });
    expect(data.lines[0]!.quantity).toBeUndefined();
    w.close();
  });
});

describe("receipts: the check and the one Sonnet retry (AI-3)", () => {
  const bad: Array<[string, ReturnType<typeof line>]> = [
    ["a line with no text", line("  ", "Milk", 1, "L", 6800)],
    ["a negative price", line("MILK 1L", "Milk", 1, "L", -100)],
    ["a quantity with no unit", line("MILK 1L", "Milk", 1, null, 6800)],
    ["a unit with no quantity", line("MILK 1L", "Milk", null, "L", 6800)],
    ["a zero quantity", line("MILK 1L", "Milk", 0, "L", 6800)],
  ];
  it.each(bad)("%s fails Haiku's answer: Sonnet reads it again, and its answer is returned", async (_, wrong) => {
    const w = aiWorld();
    w.ai.script.push(read({ lines: [wrong] }), read({ lines: [line("MILK 1L", "Milk", 1, "L", 6800)] }, { model: "claude-sonnet-5-5" }));
    const res = await post(w, jpeg());
    expect(res.status).toBe(200);
    expect(w.ai.sent.map((s) => s.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    // The same request, only the model changed.
    expect({ ...w.ai.sent[1]!, model: "x" }).toEqual({ ...w.ai.sent[0]!, model: "x" });
    expect(res.body.data.lines.map((l) => l.text)).toEqual(["MILK 1L"]);
    expect(w.usageRows()).toEqual([expect.objectContaining({ feature: "receipt", model: "claude-sonnet-5-5", ok: 1 })]);
    w.close();
  });

  it("a price in rupees with decimals (not whole paise) is off the schema: Sonnet", async () => {
    const w = aiWorld();
    w.ai.script.push(
      answer({ store: null, date: null, time: null, total: null, lines: [{ ...line("MILK 1L", "Milk", 1, "L", 0), priceMinor: 68.5 }], adjustments: [] }),
      read({ lines: [line("MILK 1L", "Milk", 1, "L", 6850)] }, { model: "claude-sonnet-5-5" }),
    );
    expect((await post(w, jpeg())).status).toBe(200);
    expect(w.ai.sent).toHaveLength(2);
    w.close();
  });

  it("both models fail: 502 ai_failed, and the failed action is counted", async () => {
    const w = aiWorld();
    const wrong = read({ lines: [line("MILK", "Milk", 1, null, 6800)] });
    w.ai.script.push(wrong, wrong);
    const res = await post(w, jpeg());
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_FAILED } });
    expect(w.usageRows()).toEqual([expect.objectContaining({ feature: "receipt", ok: 0 })]);
    w.close();
  });
});

describe("receipts: availability, limits and usage (AI-3)", () => {
  it("without a key: 503 ai_unavailable before the photo is read, and calls nothing", async () => {
    const w = aiWorld({ key: false });
    const res = await post(w, png());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE } });
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("at 50 actions today: 429 ai_daily_limit, and no call", async () => {
    const w = aiWorld();
    const insert = w.h.db.prepare(
      `INSERT INTO kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, ok, created_at)
       VALUES (?, ?, 'uses', 'claude-haiku-5-5', 0, 0, 0, 0, 1, '2026-11-09T01:00:00.000Z')`,
    );
    for (let i = 0; i < AI_DAILY_ACTIONS; i++) insert.run(`u${i}`, RAHUL);
    const res = await post(w, jpeg());
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "rate_limited", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_DAILY_LIMIT, used: 50 } });
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("counts one receipt action with the call's tokens", async () => {
    const w = aiWorld();
    await scan(w, EMPTY);
    expect(w.usageRows()).toEqual([
      expect.objectContaining({
        user_id: RAHUL,
        feature: "receipt",
        model: "claude-haiku-5-5",
        input_tokens: 300,
        cached_tokens: 1200,
        output_tokens: 80,
        audio_seconds: 0,
        ok: 1,
      }),
    ]);
    const status = await w.call<{ today: { actions: number } }>("GET", "/v1/kitchen/me/ai", RAHUL);
    expect(status.body.data.today.actions).toBe(1);
    w.close();
  });
});

describe("receipts: the photo is never stored or logged (AI-3)", () => {
  const TABLES_WITH_ROWS = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'";

  it("no image bytes reach the logs, the usage row or any table — on a read, a retry and a failure", async () => {
    const w = aiWorld();
    const image = jpeg(5000);
    const needle = image.slice(100, 140);
    const counts = () =>
      (w.h.db.prepare(TABLES_WITH_ROWS).all() as Array<{ name: string }>)
        .filter((t) => t.name !== "kitchen_ai_usage")
        .map((t) => [t.name, (w.h.db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n]);
    const before = counts();

    const logged: string[] = [];
    const levels = ["log", "info", "warn", "error", "debug"] as const;
    const originals = levels.map((level) => [level, console[level]] as const);
    for (const level of levels) {
      console[level] = (...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      };
    }
    try {
      const good = read({ lines: [line("MILK 1L", "Milk", 1, "L", 6800)] });
      const wrong = read({ lines: [line("MILK", "Milk", 1, null, 6800)] });
      w.ai.script.push(good, wrong, good, wrong, wrong, { throws: new Error(`provider echoed ${needle}`) });
      expect((await post(w, image)).status).toBe(200);
      expect((await post(w, image)).status).toBe(200);
      expect((await post(w, image)).status).toBe(502);
      expect((await post(w, image)).status).toBe(502);
    } finally {
      for (const [level, original] of originals) console[level] = original;
    }
    expect(logged.join("\n")).not.toContain(needle);
    expect(JSON.stringify(w.usageRows())).not.toContain(needle);
    expect(w.usageRows()).toHaveLength(4);
    // Nothing but the usage rows was written.
    expect(counts()).toEqual(before);
    for (const t of w.h.db.prepare(TABLES_WITH_ROWS).all() as Array<{ name: string }>) {
      expect(JSON.stringify(w.h.db.prepare(`SELECT * FROM "${t.name}"`).all())).not.toContain(needle);
    }
    w.close();
  });
});
