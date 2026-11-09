// Cookpool AI's plumbing (cookpool-ai AI-2, design §1): availability, the
// runner's Haiku-first escalation, refusals and errors, the daily limits and
// the usage rows, through the real router with a stubbed provider.

import type { AiStatus, AiUsesResponse } from "@saas/contracts/kitchen";
import { AI_DAILY_ACTIONS, AI_DAILY_RECEIPTS, AI_DAILY_VOICE_SECONDS, KITCHEN_AI_ERROR_REASONS } from "@saas/contracts/kitchen";
import { AI_EFFORT, AI_FIRST_MODEL, AI_RETRY_MODEL, aiRequest, runAiTask, type AiTask } from "@kitchen-worker/ai/runner";
import { RAHUL, ANU, NOW, aiWorld, answer, contextOf, me, personRef, refOf, stubProvider, type AiWorld } from "./ai-helpers.js";

const USES = me("ai/uses");

/** A world with Milk (1 L, in glasses of 250 ml) in Flat 4B. */
async function withMilk(w: AiWorld) {
  const milk = await w.addTo(w.flat, { name: "Milk", quantity: "1000", unit: "ml" });
  await w.call("PUT", `/v1/organizations/${w.flat.publicId}/kitchen/items/${milk.id}/measures`, RAHUL, {
    measures: [{ one: "glass", many: "glasses", count: 1, amountMilli: 250_000 }],
  });
  return milk;
}

/** "Anu and I had 2 glasses of milk", answered from the request's own refs. */
const twoGlasses = (opts: Parameters<typeof answer>[1] = {}) => (params: Parameters<typeof contextOf>[0]) => {
  const ctx = contextOf(params);
  return answer(
    { lines: [{ item: refOf(ctx, "Milk"), amount: 2, unit: null, measure: "glass", people: ["me", personRef(ctx, "Anu")] }], unsure: [] },
    opts,
  );
};

describe("Cookpool AI: availability (AI-2)", () => {
  it("GET /me/ai without a key says unavailable, every feature off, and still counts today", async () => {
    const w = aiWorld({ key: false });
    const res = await w.call<AiStatus>("GET", me("ai"), RAHUL);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      available: false,
      features: { sayIt: false, receipt: false, import: false, voice: false, swaps: false },
      budget: "ok",
      today: {
        actions: 0,
        actionsLimit: AI_DAILY_ACTIONS,
        voiceSeconds: 0,
        voiceSecondsLimit: AI_DAILY_VOICE_SECONDS,
        receipts: 0,
        receiptsLimit: AI_DAILY_RECEIPTS,
      },
    });
    w.close();
  });

  it("GET /me/ai with a key offers say what you used and receipts, and nothing that has not shipped", async () => {
    const w = aiWorld();
    const res = await w.call<AiStatus>("GET", me("ai"), RAHUL);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.features).toEqual({ sayIt: true, receipt: true, import: false, voice: false, swaps: false });
    w.close();
  });

  it("POST /me/ai/uses without a key is 503 ai_unavailable, before the body is read, and calls nothing", async () => {
    const w = aiWorld({ key: false });
    await withMilk(w);
    for (const body of [{ text: "Anu and I had 2 glasses of milk" }, { text: "" }]) {
      const res = await w.call("POST", USES, RAHUL, body);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE } });
    }
    expect(w.ai.sent).toHaveLength(0);
    expect(w.usageRows()).toHaveLength(0);
    w.close();
  });

  it("needs an actor, and only GET and POST", async () => {
    const w = aiWorld();
    expect((await w.call("GET", me("ai"), null)).status).toBe(401);
    expect((await w.call("POST", USES, null, { text: "milk" })).status).toBe(401);
    expect((await w.call("PUT", me("ai"), RAHUL, {})).status).toBe(405);
    expect((await w.call("GET", USES, RAHUL)).status).toBe(405);
    w.close();
  });

  it.each([
    ["no body", undefined],
    ["no text", {}],
    ["empty text", { text: "   " }],
    ["301 characters", { text: "x".repeat(301) }],
    ["a number", { text: 42 }],
  ])("refuses %s with 422 and calls nothing", async (_label, body) => {
    const w = aiWorld();
    await withMilk(w);
    const res = await w.call("POST", USES, RAHUL, body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("validation_failed");
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("reads 300 characters", async () => {
    const w = aiWorld();
    await withMilk(w);
    w.ai.script.push(twoGlasses());
    expect((await w.call("POST", USES, RAHUL, { text: "y".repeat(300) })).status).toBe(200);
    w.close();
  });
});

describe("Cookpool AI: the runner (AI-2)", () => {
  it("answers from Haiku at effort low with the strict schema, the prompts cached, and records one usage row", async () => {
    const w = aiWorld();
    await withMilk(w);
    w.ai.script.push(twoGlasses({ usage: { input_tokens: 310, cache_creation_input_tokens: 40, cache_read_input_tokens: 2100, output_tokens: 95 } }));
    const res = await w.call<AiUsesResponse>("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    expect(res.status).toBe(200);
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0]).toMatchObject({ measure: "glass", quantity: 2, consumers: [RAHUL, ANU], label: "2 glasses", flags: [] });

    expect(w.ai.sent).toHaveLength(1);
    const [sent] = w.ai.sent;
    expect(sent!.model).toBe("claude-haiku-5-5");
    expect(sent!.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    const schema = sent!.output_config!.format!.schema as { additionalProperties: boolean; required: string[] };
    expect(schema).toMatchObject({ additionalProperties: false, required: ["lines", "unsure"] });
    // The fixed prompt and the reference block are cached; so is the caller's pantries block; the sentence is not.
    const system = sent!.system as Array<{ cache_control?: unknown }>;
    expect(system).toHaveLength(2);
    for (const block of system) expect(block.cache_control).toEqual({ type: "ephemeral" });
    const content = sent!.messages[0]!.content as Array<{ text: string; cache_control?: unknown }>;
    expect(content[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(content[1]!.cache_control).toBeUndefined();
    expect(content[1]!.text).toBe("<sentence>Anu and I had 2 glasses of milk</sentence>");
    // AI-13: no thinking on Haiku, and the task's tight output cap.
    expect(sent!.thinking).toEqual({ type: "disabled" });
    expect(sent!.max_tokens).toBe(600);

    expect(w.usageRows()).toEqual([
      expect.objectContaining({
        user_id: RAHUL,
        feature: "uses",
        model: "claude-haiku-5-5",
        input_tokens: 350,
        cached_tokens: 2100,
        output_tokens: 95,
        audio_seconds: 0,
        // AI-13: 350 input × 0.10 + 2100 cache reads × 0.01 + 95 output × 0.50 = 103.5 µ$.
        cost_micros: 104,
        ok: 1,
        created_at: NOW.toISOString(),
      }),
    ]);
    w.close();
  });

  it("the system prompt is fixed: two callers with different pantries send the same one", async () => {
    const w = aiWorld();
    await withMilk(w);
    await w.addTo(w.flat, { name: "Bread", quantity: "10", unit: "pcs" }, ANU);
    w.ai.script.push(twoGlasses(), (params) => answer({ lines: [], unsure: [] }, { model: params.model }));
    await w.call("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    await w.call("POST", USES, ANU, { text: "bread" });
    expect(w.ai.sent[0]!.system).toEqual(w.ai.sent[1]!.system);
    w.close();
  });

  it("an answer that fails its check is retried once on Sonnet, same request, and the row sums both calls (AI_ESCALATE on)", async () => {
    const w = aiWorld({ escalate: true });
    await withMilk(w);
    w.ai.script.push(
      answer({ lines: [{ item: "i99", amount: 1, unit: "ml", measure: null, people: ["me"] }], unsure: [] }),
      twoGlasses({ model: "claude-sonnet-5-5" }),
    );
    const res = await w.call<AiUsesResponse>("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0]).toMatchObject({ measure: "glass", consumers: [RAHUL, ANU] });
    expect(w.ai.sent.map((p) => p.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    // The same request but the model — and Sonnet keeps its default thinking, as before AI-13.
    const { thinking, ...haiku } = w.ai.sent[0]!;
    expect(thinking).toEqual({ type: "disabled" });
    expect(w.ai.sent[1]).not.toHaveProperty("thinking");
    expect({ ...w.ai.sent[1]!, model: "same" }).toEqual({ ...haiku, model: "same" });
    expect(w.ai.sent[1]!.output_config!.effort).toBe("low");
    // Cost adds both models: Haiku 300×0.10 + 1200×0.01 + 80×0.50 = 82, Sonnet 300×2 + 1200×0.20 + 80×10 = 1640.
    expect(w.usageRows()).toEqual([
      expect.objectContaining({
        model: "claude-sonnet-5-5",
        input_tokens: 600,
        cached_tokens: 2400,
        output_tokens: 160,
        cost_micros: 1722,
        ok: 1,
      }),
    ]);
    w.close();
  });

  it.each([
    ["not JSON", answer("Sure! Here are your lines")],
    ["off the schema", answer({ lines: [{ item: "i1" }], unsure: [] })],
    ["cut short", answer({ lines: [], unsure: [] }, { stop: "max_tokens" })],
  ])("an answer %s is retried on Sonnet (AI_ESCALATE on)", async (_label, first) => {
    const w = aiWorld({ escalate: true });
    await withMilk(w);
    w.ai.script.push(first, twoGlasses({ model: "claude-sonnet-5-5" }));
    const res = await w.call<AiUsesResponse>("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    expect(res.status).toBe(200);
    expect(w.ai.sent.map((p) => p.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    w.close();
  });

  it("when both models fail the check: 502 ai_failed, no answer shown, and a failed usage row (AI_ESCALATE on)", async () => {
    const w = aiWorld({ escalate: true });
    await withMilk(w);
    const bad = answer({ lines: [{ item: "i99", amount: 1, unit: "ml", measure: null, people: ["me"] }], unsure: [] });
    w.ai.script.push(bad, bad);
    const res = await w.call<AiUsesResponse>("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_FAILED } });
    expect(res.body.data).toBeUndefined();
    expect(w.ai.sent).toHaveLength(2);
    expect(w.usageRows()).toEqual([expect.objectContaining({ model: "claude-sonnet-5-5", ok: 0 })]);
    w.close();
  });

  it("a refusal is ai_failed at once: never retried, never shown", async () => {
    const w = aiWorld();
    await withMilk(w);
    w.ai.script.push(answer({ lines: [], unsure: [] }, { stop: "refusal" }));
    const res = await w.call("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    expect(res.status).toBe(502);
    expect(res.body.error.details.reason).toBe("ai_failed");
    expect(w.ai.sent).toHaveLength(1);
    expect(w.usageRows()).toEqual([expect.objectContaining({ model: "claude-haiku-5-5", ok: 0 })]);
    w.close();
  });

  it("a provider error is ai_failed, never retried on Sonnet, and its message never reaches the caller", async () => {
    const w = aiWorld();
    await withMilk(w);
    w.ai.script.push({ throws: new Error("529 overloaded_error: secret upstream detail") });
    const res = await w.call("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    expect(res.status).toBe(502);
    expect(res.body.error.details).toEqual({ reason: "ai_failed" });
    expect(JSON.stringify(res.body)).not.toMatch(/overloaded|secret upstream/);
    expect(w.ai.sent).toHaveLength(1);
    expect(w.usageRows()).toEqual([expect.objectContaining({ model: "claude-haiku-5-5", ok: 0, input_tokens: 0 })]);
    w.close();
  });

  it("runAiTask never throws, whatever the task's check does", async () => {
    const task: AiTask<string, string> = {
      feature: "uses",
      system: "s",
      schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      maxTokens: 100,
      content: (input) => [{ type: "text", text: input }],
      check: () => {
        throw new Error("boom");
      },
    };
    const provider = stubProvider([answer({}), answer({})]);
    const result = await runAiTask(provider, task, "x", { escalate: true });
    expect(result).toMatchObject({ ok: false, reason: "ai_failed", failure: "invalid", model: AI_RETRY_MODEL });
    expect([AI_FIRST_MODEL, AI_RETRY_MODEL, AI_EFFORT]).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5", "low"]);
    expect(aiRequest(task, "x", AI_FIRST_MODEL).system).toEqual([{ type: "text", text: "s", cache_control: { type: "ephemeral" } }]);
  });
});

describe("Cookpool AI: daily limits (AI-2)", () => {
  /** A usage row for RAHUL (or `user`) at `at`. */
  function seed(w: AiWorld, n: number, at: string, overrides: { feature?: string; audio?: number; user?: string } = {}) {
    const insert = w.h.db.prepare(
      `INSERT INTO kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, ok, created_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, ?, 1, ?)`,
    );
    for (let i = 0; i < n; i++) {
      insert.run(
        `${at}-${overrides.feature ?? "uses"}-${overrides.user ?? RAHUL}-${i}`,
        overrides.user ?? RAHUL,
        overrides.feature ?? "uses",
        overrides.feature === "transcribe" ? "@cf/openai/whisper-large-v3-turbo" : "claude-haiku-5-5",
        overrides.audio ?? 0,
        at,
      );
    }
  }

  it("at 50 actions today: 429 rate_limited ai_daily_limit, with when it resets, and no call", async () => {
    const w = aiWorld();
    await withMilk(w);
    seed(w, AI_DAILY_ACTIONS, "2026-11-09T00:00:00.000Z");
    const res = await w.call("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: "rate_limited",
      details: { reason: KITCHEN_AI_ERROR_REASONS.AI_DAILY_LIMIT, limit: 50, used: 50, resetsAt: "2026-11-10T00:00:00.000Z" },
    });
    expect(w.ai.sent).toHaveLength(0);
    expect(w.usageRows()).toHaveLength(AI_DAILY_ACTIONS);
    w.close();
  });

  it("the 50th action still runs; yesterday's, other people's and voice seconds don't count", async () => {
    const w = aiWorld();
    await withMilk(w);
    seed(w, AI_DAILY_ACTIONS - 1, "2026-11-09T09:59:59.999Z");
    seed(w, 10, "2026-11-08T23:59:59.999Z");
    seed(w, 10, "2026-11-09T01:00:00.000Z", { user: ANU });
    seed(w, 3, "2026-11-09T02:00:00.000Z", { feature: "transcribe", audio: 15 });
    w.ai.script.push(twoGlasses());
    expect((await w.call("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" })).status).toBe(200);

    const status = await w.call<AiStatus>("GET", me("ai"), RAHUL);
    expect(status.body.data.today).toEqual({
      actions: AI_DAILY_ACTIONS,
      actionsLimit: AI_DAILY_ACTIONS,
      voiceSeconds: 45,
      voiceSecondsLimit: AI_DAILY_VOICE_SECONDS,
      receipts: 0,
      receiptsLimit: AI_DAILY_RECEIPTS,
    });
    // Now at the limit.
    expect((await w.call("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" })).status).toBe(429);
    expect(w.ai.sent).toHaveLength(1);
    w.close();
  });

  it("failed actions count too: they were paid for", async () => {
    const w = aiWorld();
    await withMilk(w);
    seed(w, AI_DAILY_ACTIONS - 1, "2026-11-09T03:00:00.000Z");
    w.ai.script.push(answer({}, { stop: "refusal" }));
    expect((await w.call("POST", USES, RAHUL, { text: "milk" })).status).toBe(502);
    expect((await w.call("POST", USES, RAHUL, { text: "milk" })).status).toBe(429);
    w.close();
  });

  it("30 voice minutes read as voice_daily_limit (the transcription route is AI-5's; the check is here)", async () => {
    const { overLimit } = await import("@kitchen-worker/ai/usage");
    const at = overLimit("req_1", "voice", { actions: 0, receipts: 0, voiceSeconds: AI_DAILY_VOICE_SECONDS }, NOW);
    expect(at?.status).toBe(429);
    expect(await at!.json()).toMatchObject({
      error: { code: "rate_limited", details: { reason: KITCHEN_AI_ERROR_REASONS.VOICE_DAILY_LIMIT, limit: 1800, used: 1800 } },
    });
    expect(overLimit("req_1", "voice", { actions: 999, receipts: 0, voiceSeconds: AI_DAILY_VOICE_SECONDS - 1 }, NOW)).toBeNull();
  });

  it("with nothing usable, no model is called and no action is counted", async () => {
    const w = aiWorld();
    const res = await w.call<AiUsesResponse>("POST", USES, RAHUL, { text: "Anu and I had 2 glasses of milk" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ lines: [], unsure: [] });
    expect(w.ai.sent).toHaveLength(0);
    expect(w.usageRows()).toHaveLength(0);
    w.close();
  });

  it("when the person's groups cannot be read: 503, and no call", async () => {
    const w = aiWorld();
    await withMilk(w);
    w.h.failGroups = true;
    expect((await w.call("POST", USES, RAHUL, { text: "milk" })).status).toBe(503);
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });
});

describe("Cookpool AI: the runner takes an image (for AI-3's receipts)", () => {
  it("sends a base64 image block beside text, unchanged, on both models", async () => {
    const task: AiTask<{ image: string }, { total: number }> = {
      feature: "receipt",
      system: "Read the receipt.",
      schema: { type: "object", properties: { total: { type: "number" } }, required: ["total"], additionalProperties: false },
      maxTokens: 2000,
      content: (input) => [
        { type: "image", source: { type: "base64", media_type: "image/webp", data: input.image } },
        { type: "text", text: "The receipt." },
      ],
      check: (answer) => {
        const total = (answer as { total: number }).total;
        return total > 0 ? { ok: true, value: { total } } : { ok: false, problems: ["no total"] };
      },
    };
    const provider = stubProvider([answer({ total: 0 }), answer({ total: 412.5 }, { model: AI_RETRY_MODEL })]);
    const result = await runAiTask(provider, task, { image: "UklGRgAAAABXRUJQ" }, { escalate: true });
    expect(result).toMatchObject({ ok: true, data: { total: 412.5 }, model: AI_RETRY_MODEL, escalated: true });
    for (const sent of provider.sent) {
      expect(sent.messages[0]!.content).toEqual([
        { type: "image", source: { type: "base64", media_type: "image/webp", data: "UklGRgAAAABXRUJQ" } },
        { type: "text", text: "The receipt." },
      ]);
    }
  });
});
