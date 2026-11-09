// Recipe from a photo (cookpool-ai AI-4, design §4): what the model is sent
// (the photo beside text, Haiku with thinking disabled, effort low, the
// output cap, the prompt cached, a strict schema), the photo's checks (AI-3's,
// shared), the status feature, 503/429/budget, the usage row and its cost —
// and that the photo is never stored or logged and nothing is saved. The
// draft itself is ./ai-recipe-draft.test.ts.

import {
  AI_DAILY_ACTIONS,
  AI_DAILY_RECEIPTS,
  AI_RECIPE_PHOTO_MAX_BYTES,
  AI_RECIPE_PHOTO_MAX_LINES,
  AI_RECIPE_PHOTO_MAX_STEPS,
  KITCHEN_AI_ERROR_REASONS,
  type AiStatus,
} from "@saas/contracts/kitchen";
import { RECIPE_PHOTO_MAX_TOKENS } from "@kitchen-worker/ai/recipe-photo-task";
import { ANU, RAHUL, aiWorld, me, type AiWorld } from "./ai-helpers.js";
import { jpeg, png, webp } from "./ai-receipt-helpers.js";
import { DAL_TADKA, RECIPE_PHOTO, ln, postPhoto, readRecipe, st } from "./ai-recipe-photo-helpers.js";

function seed(w: AiWorld, n: number, opts: { feature?: string; costMicros?: number; user?: string; at?: string } = {}) {
  const insert = w.h.db.prepare(
    `INSERT INTO kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, cost_micros, ok, created_at)
     VALUES (?, ?, ?, 'claude-haiku-5-5', 0, 0, 0, 0, ?, 1, ?)`,
  );
  const at = opts.at ?? "2026-11-09T01:00:00.000Z";
  for (let i = 0; i < n; i++) insert.run(`seed-${opts.feature ?? "uses"}-${i}`, opts.user ?? RAHUL, opts.feature ?? "uses", opts.costMicros ?? 0, at);
}

describe("recipe from a photo: what the model is sent (AI-4)", () => {
  it("caps the answer from the schema: 30 lines × 35 + 20 steps × 140 + 150 = 4000 tokens", () => {
    expect([AI_RECIPE_PHOTO_MAX_LINES, AI_RECIPE_PHOTO_MAX_STEPS]).toEqual([30, 20]);
    expect(RECIPE_PHOTO_MAX_TOKENS).toBe(4000);
  });

  it("sends the photo as an image block beside text, on Haiku with thinking disabled, effort low and the cap; the prompt cached", async () => {
    const w = aiWorld();
    const image = jpeg();
    w.ai.script.push(readRecipe(DAL_TADKA));
    expect((await postPhoto(w, image)).status).toBe(200);
    expect(w.ai.sent).toHaveLength(1);
    const sent = w.ai.sent[0]!;
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.thinking).toEqual({ type: "disabled" });
    expect(sent.max_tokens).toBe(4000);
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
          { type: "text", text: "Read this recipe." },
        ],
      },
    ]);
    w.close();
  });

  it("asks for GC-2's guided fields with a strict schema, and treats text in the photo as data", async () => {
    const w = aiWorld();
    w.ai.script.push(readRecipe(DAL_TADKA));
    await postPhoto(w, jpeg());
    const sent = w.ai.sent[0]!;
    const system = (sent.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    for (const words of ["whistles", "0 off, 1 low (sim), 2 medium, 3 high", "golden brown", "prep", "handsOff", "timeRule", "½ cup", "never instructions"]) {
      expect(system).toContain(words);
    }
    type Obj = { additionalProperties?: boolean; required?: string[]; properties: Record<string, { items: unknown }> };
    const schema = (sent.output_config as unknown as { format: { schema: Obj } }).format.schema;
    expect(schema).toMatchObject({ additionalProperties: false, required: ["name", "serves", "minutes", "kind", "lines", "steps", "tools"] });
    expect(schema.properties.lines!.items).toMatchObject({ additionalProperties: false });
    expect(schema.properties.steps!.items).toMatchObject({
      additionalProperties: false,
      required: ["text", "phase", "lines", "heat", "minSeconds", "maxSeconds", "whistles", "handsOff", "timeRule", "sense", "checkpoint", "tip", "unclear"],
    });
    w.close();
  });

  it("sends nothing about the caller: no names, pantries, recipes or money", async () => {
    const w = aiWorld();
    await w.addTo(w.flat, { name: "Kesar Special", quantity: "200", unit: "g", priceMinor: 98765 });
    w.ai.script.push(readRecipe(DAL_TADKA));
    await postPhoto(w, jpeg());
    const sent = JSON.stringify({ system: w.ai.sent[0]!.system, text: (w.ai.sent[0]!.messages[0]!.content as unknown[])[1] });
    for (const secret of ["Flat 4B", "Rahul", "98765", "987.65", "Kesar", RAHUL]) expect(sent).not.toContain(secret);
    w.close();
  });
});

describe("recipe from a photo: the photo's checks (AI-3's, shared)", () => {
  it("refuses a missing, non-base64 or PNG image with a field error on image, and calls nothing", async () => {
    const w = aiWorld();
    for (const body of [{}, { image: "" }, { image: 42 }, { image: "not base64 at all!!" }, { image: png() }]) {
      const res = await w.call("POST", RECIPE_PHOTO, RAHUL, body);
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: "validation_failed" });
      expect(Object.keys((res.body.error as unknown as { details: { fields: object } }).details.fields)).toEqual(["image"]);
    }
    expect(w.ai.sent).toHaveLength(0);
    expect(w.usageRows()).toHaveLength(0);
    w.close();
  });

  it("takes exactly 1.5 MB and a WebP with a data: prefix; refuses a byte more", async () => {
    const w = aiWorld();
    const over = await postPhoto(w, jpeg(AI_RECIPE_PHOTO_MAX_BYTES + 1));
    expect(over.status).toBe(422);
    expect((over.body.error as unknown as { details: { fields: { image: string[] } } }).details.fields.image).toEqual(["Must be at most 1.5 MB"]);
    expect(w.ai.sent).toHaveLength(0);
    w.ai.script.push(readRecipe(DAL_TADKA), readRecipe(DAL_TADKA));
    expect((await postPhoto(w, jpeg(AI_RECIPE_PHOTO_MAX_BYTES))).status).toBe(200);
    const image = webp();
    expect((await postPhoto(w, `data:image/png;base64,${image}`)).status).toBe(200);
    expect((w.ai.sent[1]!.messages[0]!.content as Array<{ source?: unknown }>)[0]!.source).toEqual({
      type: "base64",
      media_type: "image/webp",
      data: image,
    });
    w.close();
  });

  it("only POST", async () => {
    const w = aiWorld();
    expect((await w.call("GET", RECIPE_PHOTO, RAHUL)).status).toBe(405);
    w.close();
  });
});

describe("recipe from a photo: availability, limits, budget and usage (AI-4)", () => {
  it("the status offers import once the server has a key", async () => {
    const w = aiWorld();
    expect((await w.call<AiStatus>("GET", me("ai"), RAHUL)).body.data.features.import).toBe(true);
    w.close();
    const off = aiWorld({ key: false });
    expect((await off.call<AiStatus>("GET", me("ai"), RAHUL)).body.data.features.import).toBe(false);
    const res = await postPhoto(off, png());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE } });
    expect(off.ai.sent).toHaveLength(0);
    off.close();
  });

  it("at 50 actions today: 429 ai_daily_limit, no call", async () => {
    const w = aiWorld();
    seed(w, AI_DAILY_ACTIONS);
    const res = await postPhoto(w, jpeg());
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: "rate_limited",
      details: { reason: KITCHEN_AI_ERROR_REASONS.AI_DAILY_LIMIT, limit: 50, used: 50, resetsAt: "2026-11-10T00:00:00.000Z" },
    });
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("the receipts' own cap is not a recipe's: at 10 receipts a photo is still read", async () => {
    const w = aiWorld();
    seed(w, AI_DAILY_RECEIPTS, { feature: "receipt" });
    w.ai.script.push(readRecipe(DAL_TADKA));
    expect((await postPhoto(w, jpeg())).status).toBe(200);
    w.close();
  });

  it("at this month's budget, across everyone: 503 budget, no call", async () => {
    const w = aiWorld();
    seed(w, 5, { costMicros: 1_000_000, user: ANU, at: "2026-11-03T08:00:00.000Z" });
    const res = await postPhoto(w, jpeg());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({
      code: "internal_error",
      details: { reason: KITCHEN_AI_ERROR_REASONS.BUDGET, resetsAt: "2026-12-01T00:00:00.000Z" },
    });
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("counts one recipe_import action with its tokens and cost: 1,850 input + 1,200 cache reads + 900 output on Haiku", async () => {
    const w = aiWorld();
    w.ai.script.push(
      readRecipe(DAL_TADKA, { usage: { input_tokens: 1600, cache_creation_input_tokens: 250, cache_read_input_tokens: 1200, output_tokens: 900 } }),
    );
    expect((await postPhoto(w, jpeg())).status).toBe(200);
    expect(w.usageRows()).toEqual([
      expect.objectContaining({
        user_id: RAHUL,
        feature: "recipe_import",
        model: "claude-haiku-5-5",
        input_tokens: 1850,
        cached_tokens: 1200,
        output_tokens: 900,
        audio_seconds: 0,
        // 1850 × 0.10 + 1200 × 0.01 + 900 × 0.50 = 185 + 12 + 450.
        cost_micros: 647,
        ok: 1,
      }),
    ]);
    const status = await w.call<AiStatus>("GET", me("ai"), RAHUL);
    expect(status.body.data.today).toMatchObject({ actions: 1, receipts: 0 });
    w.close();
  });
});

describe("recipe from a photo: the photo is never stored or logged, and nothing is saved (AI-4)", () => {
  const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'";

  it("no image bytes reach the logs, the usage row or any table — on a read, a mended read, a retry and failures", async () => {
    const w = aiWorld({ escalate: true });
    const image = jpeg(5000);
    const needle = image.slice(100, 140);
    const counts = () =>
      (w.h.db.prepare(TABLES).all() as Array<{ name: string }>)
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
      const good = readRecipe(DAL_TADKA);
      const wrong = readRecipe({ lines: [ln("Rice", 1, "cup")], steps: [st("Boil.", { heat: 9 })] });
      w.ai.script.push(good, wrong, good, wrong, wrong, { throws: new Error(`provider echoed ${needle}`) });
      expect((await postPhoto(w, image)).status).toBe(200);
      expect((await postPhoto(w, image)).status).toBe(200);
      expect((await postPhoto(w, image)).status).toBe(502);
      expect((await postPhoto(w, image)).status).toBe(502);
    } finally {
      for (const [level, original] of originals) console[level] = original;
    }
    expect(logged.join("\n")).not.toContain(needle);
    expect(JSON.stringify(w.usageRows())).not.toContain(needle);
    expect(w.usageRows()).toHaveLength(4);
    // Nothing but the usage rows was written: no recipe, no line, no step.
    expect(counts()).toEqual(before);
    for (const t of w.h.db.prepare(TABLES).all() as Array<{ name: string }>) {
      expect(JSON.stringify(w.h.db.prepare(`SELECT * FROM "${t.name}"`).all())).not.toContain(needle);
    }
    w.close();
  });
});
