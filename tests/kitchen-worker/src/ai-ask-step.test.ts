// Ask the step (cookpool-ai AI-5, design §5): a question about the step the
// cook is on, answered by a stubbed Haiku in ≤ 60 words from the recipe
// scaled to the size — the recipe block (lines at the factor, every step's
// flame, time at that size, checkpoint and tip) cached and the same bytes on
// every step and for all three stove tasks; where the cook is and the
// question after it. The body's checks, who may ask about which recipe, the
// limits and the usage row, a long answer trimmed or retried, and nothing
// about people or money in the prompt.

import { AI_DAILY_ACTIONS, KITCHEN_AI_ERROR_REASONS, type AiAskStepResponse, type RecipeResponse } from "@saas/contracts/kitchen";
import { ASK_STEP_MAX_TOKENS } from "@kitchen-worker/ai/stove-tasks";
import { ANU, PRICE, RAHUL, answer, me, type AiWorld } from "./ai-helpers.js";
import { ASK, CHECK, CURRY, RESCUE, promptText, stoveWorld, userText, type StoveWorld } from "./ai-stove-helpers.js";
import { jpeg } from "./ai-receipt-helpers.js";

const ask = (w: AiWorld, body: Record<string, unknown>, as = RAHUL) => w.call<AiAskStepResponse>("POST", ASK, as, body);
const said = (text: string, opts: Parameters<typeof answer>[1] = {}) => answer({ answer: text }, opts);
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

/** The user turn's blocks. */
const blocks = (w: StoveWorld, i = 0) => w.ai.sent[i]!.messages[0]!.content as Array<{ type: string; text?: string; cache_control?: unknown }>;

describe("ask-step: what the model is sent (AI-5)", () => {
  it("Haiku at effort low, thinking off, a 200-token cap, the prompt and the recipe block cached, then where the cook is and the question", async () => {
    const w = await stoveWorld();
    w.ai.script.push(said("Keep them moving on medium till golden, about 10 to 12 minutes."));
    const res = await ask(w, { recipeId: w.curry.id, factor: 1500, stepKey: w.keys[1], question: "How long do the onions take?" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ answer: "Keep them moving on medium till golden, about 10 to 12 minutes." });
    const sent = w.ai.sent[0]!;
    expect(sent).toMatchObject({ model: "claude-haiku-5-5", max_tokens: ASK_STEP_MAX_TOKENS, thinking: { type: "disabled" } });
    expect(ASK_STEP_MAX_TOKENS).toBe(200);
    expect(sent.output_config).toMatchObject({ effort: "low", format: { type: "json_schema", schema: { required: ["answer"], additionalProperties: false } } });
    expect(sent.system).toEqual([
      expect.objectContaining({ cache_control: { type: "ephemeral" } }),
      expect.objectContaining({ cache_control: { type: "ephemeral" } }),
    ]);
    const [block, tail, ...rest] = blocks(w);
    expect(rest).toEqual([]);
    expect(block).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(tail!.cache_control).toBeUndefined();
    expect(tail!.text).toContain("The cook is on S2 of 5: Brown the onions");
    expect(tail!.text).toContain("Next: S3 Add the tomatoes and cook them down");
    expect(tail!.text).toContain("Lines used so far: L1, L2, L4, L5");
    expect(tail!.text).toContain("<question>How long do the onions take?</question>");
    w.close();
  });

  it("the recipe block: every line scaled to the factor, every step's flame, time at that size, whistles, checkpoint and tip", async () => {
    const w = await stoveWorld();
    w.ai.script.push(said("Yes."), said("Yes."));
    await ask(w, { recipeId: w.curry.id, factor: 1500, stepKey: w.keys[3], question: "More water?" });
    const block = blocks(w)[0]!.text!;
    for (const part of [
      "Recipe: Chicken curry",
      "Size: × 1.5 of the recipe as written, serves 6",
      "Tools: Kadai with a lid",
      "L1 Chicken: 1.5 kg",
      "L2 Onions, sliced: 3 onion",
      "L3 Tomatoes: 300 g",
      "L4 Turmeric: 1.5 tsp",
      "L5 Salt: to taste",
      "S1 (prep) Marinate the chicken with turmeric and salt | uses L1, L4, L5 | 30 min | hands off",
      // "A bit longer" (× √1.5) and "Longer" (× 1.5), in whole minutes.
      "S2 Brown the onions | uses L2 | flame medium | 10 min to 12 min | check by look: golden brown | tip: Don't crowd the pan",
      "S3 Add the tomatoes and cook them down | uses L3 | flame medium | 5 min | check by look: the oil separates",
      "S4 Add the chicken and simmer covered until cooked | uses L1 | flame low | 38 min to 45 min | check by look: the chicken is cooked through",
      "S5 Rest five minutes and serve",
    ]) {
      expect(block).toContain(part);
    }
    await ask(w, { recipeId: w.rajma.id, stepKey: w.rajma.guidedSteps![0]!.key, question: "How many whistles?" });
    const rajma = blocks(w, 1)[0]!.text!;
    expect(rajma).toContain("S1 Pressure-cook the rajma | uses L1 | flame high | 6 whistles | hands off | check by sound: the sixth whistle");
    expect(rajma).toContain("Size: × 1 of the recipe as written, serves 4");
    expect(blocks(w, 1)[1]!.text).toContain("S1 of 2");
    w.close();
  });

  it("the cached block is the same bytes on every step and for ask, check and rescue — and another size is another block", async () => {
    const w = await stoveWorld();
    w.ai.script.push(
      said("Fine."),
      said("Fine."),
      answer({ verdict: "not_yet", say: "A few more minutes.", problem: null }),
      answer({ title: "Thin it", steps: ["Add a splash of hot water."], say: "Add a splash of hot water." }),
      said("Fine."),
    );
    const ref = { recipeId: w.curry.id, factor: 1500 };
    await ask(w, { ...ref, stepKey: w.keys[0], question: "Ok?" });
    await ask(w, { ...ref, stepKey: w.keys[4], question: "Ok?" });
    await w.call("POST", CHECK, RAHUL, { ...ref, stepKey: w.keys[2], image: jpeg() });
    await w.call("POST", RESCUE, RAHUL, { ...ref, stepKey: w.keys[2], problem: "too_thick" });
    await ask(w, { ...ref, factor: 1000, stepKey: w.keys[0], question: "Ok?" });
    const firstBlocks = w.ai.sent.map((s) => (s.messages[0]!.content as Array<{ text?: string }>)[0]!.text);
    expect(new Set(firstBlocks.slice(0, 4)).size).toBe(1);
    expect(firstBlocks[4]).not.toBe(firstBlocks[0]);
    // The system prompt and reference are shared by the three tasks too.
    expect(new Set(w.ai.sent.map((s) => JSON.stringify(s.system))).size).toBe(1);
    w.close();
  });

  it("sends nothing about people or money: no names, groups, prices, owner or ids", async () => {
    const w = await stoveWorld();
    await w.addTo(w.flat, { name: "Chicken", quantity: "1", unit: "kg" });
    w.ai.script.push(said("Yes."));
    await ask(w, { recipeId: w.curry.id, stepKey: w.keys[1], question: "Is this right?" });
    const prompt = promptText(w.ai.sent[0]!);
    for (const secret of ["Rahul", "Mehta", "Flat 4B", "Lunch club", RAHUL, String(PRICE), "987.65", w.curry.id, "₹"]) {
      expect(prompt).not.toContain(secret);
    }
    w.close();
  });
});

describe("ask-step: the body, the recipe and the step (AI-5)", () => {
  const fieldsOf = (res: { status: number; body: { error?: { details?: Record<string, unknown> } } }) => {
    expect(res.status).toBe(422);
    return Object.keys((res.body.error?.details?.fields ?? {}) as object).sort();
  };

  it("names each bad field, and calls nothing", async () => {
    const w = await stoveWorld();
    const good = { recipeId: w.curry.id, stepKey: w.keys[0], question: "Ok?" };
    expect(fieldsOf(await ask(w, {}))).toEqual(["question", "recipeId", "stepKey"]);
    for (const factor of [1.5, 0, 9, 20_001, "1500"]) expect(fieldsOf(await ask(w, { ...good, factor }))).toEqual(["factor"]);
    for (const question of ["", "   ", "x".repeat(301), 42]) expect(fieldsOf(await ask(w, { ...good, question }))).toEqual(["question"]);
    expect(fieldsOf(await ask(w, { ...good, stepKey: "has spaces" }))).toEqual(["stepKey"]);
    expect(fieldsOf(await ask(w, { ...good, code: "!" }))).toEqual(["code"]);
    expect((await w.call("POST", ASK, RAHUL, "nope")).status).toBe(422);
    expect(w.ai.sent).toHaveLength(0);
    expect(w.usageRows()).toHaveLength(0);
    w.close();
  });

  it("takes 300 characters, and factors from 10 to 20000", async () => {
    const w = await stoveWorld();
    w.ai.script.push(said("Ok."), said("Ok."), said("Ok."));
    const good = { recipeId: w.curry.id, stepKey: w.keys[0] };
    expect((await ask(w, { ...good, question: "x".repeat(300) })).status).toBe(200);
    expect((await ask(w, { ...good, factor: 10, question: "Ok?" })).status).toBe(200);
    expect((await ask(w, { ...good, factor: 20_000, question: "Ok?" })).status).toBe(200);
    w.close();
  });

  it("a recipe the caller may not see is the opaque 404; a group's shared recipe answers", async () => {
    const w = await stoveWorld();
    const write = async (body: Record<string, unknown>) =>
      (await w.call<RecipeResponse>("POST", me("recipes"), ANU, body)).body.data.recipe;
    const hidden = await write({ ...CURRY, name: "Anu's own", visibility: "only_me" });
    const shared = await write({ ...CURRY, name: "Flat curry", visibility: "groups" });
    expect((await ask(w, { recipeId: hidden.id, stepKey: hidden.guidedSteps![0]!.key, question: "Ok?" })).status).toBe(404);
    expect((await ask(w, { recipeId: "rcp_00000000000000000000000000000000", stepKey: w.keys[0], question: "Ok?" })).status).toBe(404);
    expect(w.ai.sent).toHaveLength(0);
    w.ai.script.push(said("Ok."));
    expect((await ask(w, { recipeId: shared.id, stepKey: shared.guidedSteps![0]!.key, question: "Ok?" })).status).toBe(200);
    w.close();
  });

  it("a step key that is not one of the recipe's is 422 on stepKey", async () => {
    const w = await stoveWorld();
    const res = await ask(w, { recipeId: w.curry.id, stepKey: w.rajma.guidedSteps![0]!.key, question: "Ok?" });
    expect(res.status).toBe(422);
    expect(res.body.error?.details).toEqual({ fields: { stepKey: ["Not a step of this recipe"] } });
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("the last step says it is the last", async () => {
    const w = await stoveWorld();
    w.ai.script.push(said("Serve it hot."));
    await ask(w, { recipeId: w.curry.id, stepKey: w.keys[4], question: "Now what?" });
    expect(blocks(w)[1]!.text).toContain("S5 is the last step.");
    w.close();
  });
});

describe("ask-step: availability, limits and usage (AI-5)", () => {
  it("503 ai_unavailable without a key, before the body is read", async () => {
    const w = await stoveWorld({ key: false });
    const res = await w.call("POST", ASK, RAHUL, "not even json");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ details: { reason: KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE } });
    w.close();
  });

  it("needs only the key: ask, check and rescue answer without the Workers AI binding (voice off)", async () => {
    const w = await stoveWorld({ binding: false });
    w.ai.script.push(
      said("Ok."),
      answer({ verdict: "not_yet", say: "Keep going.", problem: null }),
      answer({ title: "Thin it", steps: ["Add hot water."], say: "Add hot water." }),
    );
    expect((await ask(w, { recipeId: w.curry.id, stepKey: w.keys[0], question: "Ok?" })).status).toBe(200);
    expect((await w.call("POST", CHECK, RAHUL, { recipeId: w.curry.id, stepKey: w.keys[1], image: jpeg() })).status).toBe(200);
    expect((await w.call("POST", RESCUE, RAHUL, { recipeId: w.curry.id, stepKey: w.keys[2], problem: "too_thick" })).status).toBe(200);
    const status = (await w.call<{ features: Record<string, boolean> }>("GET", me("ai"), RAHUL)).body.data;
    expect(status.features).toMatchObject({ sayIt: true, receipt: true, voice: false });
    w.close();
  });

  it("one action per question, counted as ask_step with its cost; at 50 today it is 429 ai_daily_limit with no call", async () => {
    const w = await stoveWorld();
    w.ai.script.push(said("Ok."));
    await ask(w, { recipeId: w.curry.id, stepKey: w.keys[0], question: "Ok?" });
    const [row] = w.usageRows();
    // 300 input × 0.10 + 1200 cache reads × 0.01 + 80 output × 0.50 = 82 µ$.
    expect(row).toMatchObject({ feature: "ask_step", model: "claude-haiku-5-5", ok: 1, audio_seconds: 0, cost_micros: 82 });
    const insert = w.h.db.prepare(
      "INSERT INTO kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, cost_micros, ok, created_at) VALUES (?, ?, 'uses', 'm', 0, 0, 0, 0, 0, 1, '2026-11-09T08:00:00.000Z')",
    );
    for (let i = 1; i < AI_DAILY_ACTIONS; i++) insert.run(`seed-${i}`, RAHUL);
    const res = await ask(w, { recipeId: w.curry.id, stepKey: w.keys[0], question: "Ok?" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: "rate_limited", details: { reason: "ai_daily_limit", limit: 50, used: 50 } });
    expect(w.ai.sent).toHaveLength(1);
    w.close();
  });

  it("at the month's budget: 503 budget, no call", async () => {
    const w = await stoveWorld({ env: { AI_MONTHLY_BUDGET_USD: "0" } });
    const res = await ask(w, { recipeId: w.curry.id, stepKey: w.keys[0], question: "Ok?" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ details: { reason: "budget" } });
    expect(w.ai.sent).toHaveLength(0);
    w.close();
  });

  it("a refusal or a provider error is 502 ai_failed, counted", async () => {
    const w = await stoveWorld();
    w.ai.script.push(said("", { stop: "refusal" }), { throws: new Error("overloaded") });
    for (let i = 0; i < 2; i++) {
      const res = await ask(w, { recipeId: w.curry.id, stepKey: w.keys[0], question: "Ok?" });
      expect(res.status).toBe(502);
      expect(res.body.error).toMatchObject({ details: { reason: KITCHEN_AI_ERROR_REASONS.AI_FAILED } });
    }
    expect(w.usageRows().map((r) => r.ok)).toEqual([0, 0]);
    w.close();
  });
});

describe("ask-step: an answer over 60 words (AI-5)", () => {
  it("escalation off: trimmed to 60 words at a sentence end, with no second call", async () => {
    const w = await stoveWorld();
    const long = `${words(40)}. ${words(30)}.`;
    w.ai.script.push(said(long));
    const res = await ask(w, { recipeId: w.curry.id, stepKey: w.keys[2], question: "Tell me everything" });
    expect(res.status).toBe(200);
    expect(res.body.data.answer).toBe(`${words(40)}.`);
    expect(w.ai.sent).toHaveLength(1);
    w.close();
  });

  it("escalation on: the same request once on Sonnet, whose answer is returned", async () => {
    const w = await stoveWorld({ escalate: true });
    w.ai.script.push(said(words(61)), said("Short and right.", { model: "claude-sonnet-5-5" }));
    const res = await ask(w, { recipeId: w.curry.id, stepKey: w.keys[2], question: "Tell me everything" });
    expect(res.body.data).toEqual({ answer: "Short and right." });
    expect(w.ai.sent.map((s) => s.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(userText(w.ai.sent[1]!)).toBe(userText(w.ai.sent[0]!));
    expect(w.usageRows()).toHaveLength(1);
    expect(w.usageRows()[0]).toMatchObject({ model: "claude-sonnet-5-5", ok: 1 });
    w.close();
  });

  it("exactly 60 words passes as it is", async () => {
    const w = await stoveWorld();
    w.ai.script.push(said(words(60)));
    expect((await ask(w, { recipeId: w.curry.id, stepKey: w.keys[2], question: "Ok?" })).body.data.answer).toBe(words(60));
    w.close();
  });
});
