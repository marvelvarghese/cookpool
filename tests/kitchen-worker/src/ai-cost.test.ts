// Cookpool AI's cost guardrails (cookpool-ai AI-13): Haiku without thinking
// and with tight output caps, no Sonnet retry unless AI_ESCALATE is on (a
// failed receipt read returns its usable lines as `check`/`unclear`), each
// action's estimated cost in kitchen_ai_usage.cost_micros, receipts capped at
// 10 a day, and the month's budget that turns AI off — closed when it cannot
// be read. Through the real router with a stubbed provider: no test reaches
// the network.

import type { AiReceiptResponse, AiStatus, AiUsesResponse } from "@saas/contracts/kitchen";
import {
  AI_DAILY_RECEIPTS,
  AI_PRICES_PER_MTOK,
  AI_RECEIPT_MAX_LINES,
  AI_RECEIPT_NOT_FOOD,
  AI_RECEIPT_UNCLEAR,
  KITCHEN_AI_ERROR_REASONS,
  aiCallCostMicros,
} from "@saas/contracts/kitchen";
import { aiEscalate } from "@kitchen-worker/ai/runner";
import { RECEIPT_MAX_TOKENS } from "@kitchen-worker/ai/receipt-task";
import { USES_MAX_TOKENS } from "@kitchen-worker/ai/uses-task";
import { aiMonthlyBudgetMicros, utcMonth } from "@kitchen-worker/ai/usage";
import { ANU, NOW, RAHUL, aiWorld, answer, contextOf, me, refOf, type AiWorld } from "./ai-helpers.js";
import { jpeg, line, post, read } from "./ai-receipt-helpers.js";

const USES = me("ai/uses");

async function withBread(w: AiWorld) {
  await w.addTo(w.flat, { name: "Bread", quantity: "10", unit: "pcs" }, ANU);
}

/** "a slice of bread", answered from the request's own refs (or a line the check fails). */
const bread = (opts: Parameters<typeof answer>[1] = {}) => (params: Parameters<typeof contextOf>[0]) =>
  answer({ lines: [{ item: refOf(contextOf(params), "Bread"), amount: 1, unit: "pcs", measure: null, people: ["me"] }], unsure: [] }, opts);
const unknownItem = answer({ lines: [{ item: "i99", amount: 1, unit: "pcs", measure: null, people: ["me"] }], unsure: [] });

/** Usage rows already spent: `n` rows of `costMicros` each, at `at`, by `user`. */
function seed(w: AiWorld, n: number, at: string, opts: { feature?: string; costMicros?: number; user?: string } = {}) {
  const insert = w.h.db.prepare(
    `INSERT INTO kitchen_ai_usage (id, user_id, feature, model, input_tokens, cached_tokens, output_tokens, audio_seconds, cost_micros, ok, created_at)
     VALUES (?, ?, ?, 'claude-haiku-5-5', 0, 0, 0, 0, ?, 1, ?)`,
  );
  for (let i = 0; i < n; i++) {
    insert.run(`${at}-${opts.feature ?? "uses"}-${opts.user ?? RAHUL}-${i}`, opts.user ?? RAHUL, opts.feature ?? "uses", opts.costMicros ?? 0, at);
  }
}

describe("AI-13: Haiku without thinking, with tight output caps", () => {
  it("names each task's cap: 600 for a sentence, 1760 for a receipt of 60 lines (AI-14: +60 for the adjustments' kind)", () => {
    expect(USES_MAX_TOKENS).toBe(600);
    expect(RECEIPT_MAX_TOKENS).toBe(1760);
    expect(AI_RECEIPT_MAX_LINES).toBe(60);
  });

  it("a receipt is read on Haiku with thinking disabled, effort low and max_tokens 1760", async () => {
    const w = aiWorld();
    w.ai.script.push(read({ lines: [line("MILK 1L", "Milk", 1, "L", 6800)] }));
    expect((await post(w, jpeg())).status).toBe(200);
    const sent = w.ai.sent[0]!;
    expect(sent).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1760, thinking: { type: "disabled" } });
    expect(sent.output_config!.effort).toBe("low");
    w.close();
  });

  it("a sentence is read on Haiku with thinking disabled and max_tokens 600", async () => {
    const w = aiWorld();
    await withBread(w);
    w.ai.script.push(bread());
    expect((await w.call("POST", USES, RAHUL, { text: "a slice of bread" })).status).toBe(200);
    expect(w.ai.sent[0]).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 600, thinking: { type: "disabled" } });
    w.close();
  });
});

describe("AI-13: no Sonnet retry unless AI_ESCALATE is on", () => {
  it.each([
    [undefined, false],
    ["off", false],
    ["true", false],
    ["ON", false],
    [" on", false],
    ["on", true],
  ])("AI_ESCALATE=%s → escalate %s", (value, on) => {
    expect(aiEscalate({ AI_ESCALATE: value })).toBe(on);
  });

  it("a receipt that fails its check returns the lines that pass, each check/unclear, after one Haiku call", async () => {
    const w = aiWorld();
    w.ai.script.push(
      read({
        total: -5,
        lines: [
          line("MILK 1L", "Milk", 1, "L", 6800),
          line("PANEER 200G", "Paneer", 0, "g", 9000), // a zero quantity: dropped
          line("SURF EXCEL", "Detergent", 1, "pcs", 12000, false),
          line("  ", "Onion", 1, "kg", 4000), // no text: dropped
        ],
        adjustments: [{ kind: "roundoff", text: "ROUND OFF", amountMinor: -20 }],
      }),
    );
    const res = await post(w, jpeg());
    expect(res.status).toBe(200);
    expect(w.ai.sent.map((s) => s.model)).toEqual(["claude-haiku-5-5"]);
    const data: AiReceiptResponse = res.body.data;
    expect(data.lines.map((l) => [l.text, l.confidence, l.reason])).toEqual([
      ["MILK 1L", "check", AI_RECEIPT_UNCLEAR],
      ["SURF EXCEL", "check", AI_RECEIPT_NOT_FOOD],
    ]);
    // The bad total was dropped; the food line keeps its amount, price and where it goes.
    expect(data.total).toBeUndefined();
    expect(data.totalMatches).toBe(false);
    expect(data.lines[0]).toMatchObject({ quantity: 1, unit: "L", priceMinor: 6800, pantry: expect.anything() });
    expect(w.usageRows()).toEqual([expect.objectContaining({ feature: "receipt", model: "claude-haiku-5-5", ok: 1 })]);
    w.close();
  });

  it("a receipt with no usable line is 502 ai_failed, after one Haiku call", async () => {
    const w = aiWorld();
    w.ai.script.push(read({ lines: [line("MILK", "Milk", 1, null, 6800), line("CURD", "Dahi", 0, "g", 3000)] }));
    const res = await post(w, jpeg());
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: "internal_error", details: { reason: KITCHEN_AI_ERROR_REASONS.AI_FAILED } });
    expect(w.ai.sent).toHaveLength(1);
    expect(w.usageRows()).toEqual([expect.objectContaining({ model: "claude-haiku-5-5", ok: 0 })]);
    w.close();
  });

  it.each([
    ["not JSON", answer("Here is the receipt")],
    ["cut short", answer({ lines: [] }, { stop: "max_tokens" })],
  ])("a receipt answer %s is ai_failed, with no retry", async (_label, first) => {
    const w = aiWorld();
    w.ai.script.push(first);
    expect((await post(w, jpeg())).status).toBe(502);
    expect(w.ai.sent).toHaveLength(1);
    w.close();
  });

  it("a sentence that fails its check is 502 ai_failed, with no Sonnet call", async () => {
    const w = aiWorld();
    await withBread(w);
    w.ai.script.push(unknownItem);
    const res = await w.call<AiUsesResponse>("POST", USES, RAHUL, { text: "a slice of bread" });
    expect(res.status).toBe(502);
    expect(res.body.error.details).toEqual({ reason: KITCHEN_AI_ERROR_REASONS.AI_FAILED });
    expect(w.ai.sent.map((s) => s.model)).toEqual(["claude-haiku-5-5"]);
    expect(w.usageRows()).toEqual([expect.objectContaining({ model: "claude-haiku-5-5", ok: 0 })]);
    w.close();
  });

  it("with AI_ESCALATE on, the same failed sentence is retried once on Sonnet, as before", async () => {
    const w = aiWorld({ escalate: true });
    await withBread(w);
    w.ai.script.push(unknownItem, bread({ model: "claude-sonnet-5-5" }));
    const res = await w.call<AiUsesResponse>("POST", USES, RAHUL, { text: "a slice of bread" });
    expect(res.status).toBe(200);
    expect(w.ai.sent.map((s) => s.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    w.close();
  });

  it("with AI_ESCALATE on, a failed receipt is read again on Sonnet, never salvaged", async () => {
    const w = aiWorld({ escalate: true });
    w.ai.script.push(
      read({ lines: [line("MILK 1L", "Milk", 1, "L", 6800), line("CURD", "Dahi", 0, "g", 3000)] }),
      read({ lines: [line("MILK 1L", "Milk", 1, "L", 6800), line("CURD 400G", "Dahi", 400, "g", 3000)] }, { model: "claude-sonnet-5-5" }),
    );
    const res = await post(w, jpeg());
    expect(res.status).toBe(200);
    expect(w.ai.sent.map((s) => s.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    expect(res.body.data.lines.map((l) => l.reason)).not.toContain(AI_RECEIPT_UNCLEAR);
    w.close();
  });
});

describe("AI-13: the cost of each action", () => {
  it("prices calls from the table, in micro-dollars per token", () => {
    expect(AI_PRICES_PER_MTOK).toEqual({
      "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
      "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
    });
    const tokens = { input: 1000, cacheRead: 2000, output: 400 };
    expect(aiCallCostMicros("claude-haiku-5-5", tokens)).toBeCloseTo(100 + 20 + 200);
    expect(aiCallCostMicros("claude-sonnet-5-5", tokens)).toBeCloseTo(2000 + 400 + 4000);
    // A model missing from the table is priced as the dearest, never free.
    expect(aiCallCostMicros("claude-something-new", tokens)).toBeCloseTo(6400);
  });

  it("a receipt's image tokens count as input: Haiku 1,850 input + 1,200 cache reads + 400 output", async () => {
    const w = aiWorld();
    const body = { store: null, date: null, time: null, total: null, lines: [line("MILK 1L", "Milk", 1, "L", 6800)], adjustments: [] };
    w.ai.script.push(
      answer(body, { usage: { input_tokens: 1800, cache_creation_input_tokens: 50, cache_read_input_tokens: 1200, output_tokens: 400 } }),
    );
    expect((await post(w, jpeg())).status).toBe(200);
    // 1850 × 0.10 + 1200 × 0.01 + 400 × 0.50 = 185 + 12 + 200.
    expect(w.usageRows()).toEqual([expect.objectContaining({ input_tokens: 1850, cached_tokens: 1200, output_tokens: 400, cost_micros: 397 })]);
    w.close();
  });

  it("an escalated receipt adds both models' calls", async () => {
    const w = aiWorld({ escalate: true });
    const usage = { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 500, output_tokens: 200 };
    const body = (priceMinor: number) => ({
      store: null,
      date: null,
      time: null,
      total: null,
      lines: [line("MILK 1L", "Milk", 1, "L", priceMinor)],
      adjustments: [],
    });
    w.ai.script.push(answer(body(-1), { usage }), answer(body(6800), { model: "claude-sonnet-5-5", usage }));
    expect((await post(w, jpeg())).status).toBe(200);
    // Haiku 100 + 5 + 100 = 205; Sonnet 2000 + 100 + 2000 = 4100.
    expect(w.usageRows()).toEqual([expect.objectContaining({ model: "claude-sonnet-5-5", cost_micros: 4305 })]);
    w.close();
  });

  it("a failed call is costed too: a refusal's tokens were paid for; a thrown error has none", async () => {
    const w = aiWorld();
    await withBread(w);
    w.ai.script.push(answer({ lines: [], unsure: [] }, { stop: "refusal" }), { throws: new Error("overloaded") });
    await w.call("POST", USES, RAHUL, { text: "bread" });
    await w.call("POST", USES, RAHUL, { text: "bread" });
    expect(w.usageRows().map((r) => r.cost_micros).sort()).toEqual([0, 82]);
    w.close();
  });
});

describe("AI-13: receipts are capped at 10 a day", () => {
  it("the 10th receipt runs; the 11th is 429 receipt_daily_limit, with no call", async () => {
    const w = aiWorld();
    seed(w, AI_DAILY_RECEIPTS - 1, "2026-11-09T02:00:00.000Z", { feature: "receipt" });
    seed(w, 5, "2026-11-08T23:00:00.000Z", { feature: "receipt" }); // yesterday
    seed(w, 5, "2026-11-09T02:00:00.000Z", { feature: "receipt", user: ANU }); // someone else
    w.ai.script.push(read({ lines: [line("MILK 1L", "Milk", 1, "L", 6800)] }));
    expect((await post(w, jpeg())).status).toBe(200);

    const res = await post(w, jpeg());
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: "rate_limited",
      details: { reason: KITCHEN_AI_ERROR_REASONS.RECEIPT_DAILY_LIMIT, limit: 10, used: 10, resetsAt: "2026-11-10T00:00:00.000Z" },
    });
    expect(w.ai.sent).toHaveLength(1);

    const status = await w.call<AiStatus>("GET", me("ai"), RAHUL);
    expect(status.body.data.today).toMatchObject({ actions: 10, receipts: 10, receiptsLimit: 10 });
    w.close();
  });

  it("at the receipt cap, a sentence still runs: the cap is the receipts' own", async () => {
    const w = aiWorld();
    await withBread(w);
    seed(w, AI_DAILY_RECEIPTS, "2026-11-09T02:00:00.000Z", { feature: "receipt" });
    w.ai.script.push(bread());
    expect((await w.call("POST", USES, RAHUL, { text: "a slice of bread" })).status).toBe(200);
    w.close();
  });
});

describe("AI-13: the monthly budget", () => {
  const SPENT = "2026-11-03T08:00:00.000Z";

  it("reads AI_MONTHLY_BUDGET_USD in micro-dollars, 5 USD when unset or not a number ≥ 0", () => {
    expect(aiMonthlyBudgetMicros({})).toBe(5_000_000);
    expect(aiMonthlyBudgetMicros({ AI_MONTHLY_BUDGET_USD: "12.5" })).toBe(12_500_000);
    expect(aiMonthlyBudgetMicros({ AI_MONTHLY_BUDGET_USD: "0" })).toBe(0);
    for (const bad of ["", "five", "-1", "Infinity"]) expect(aiMonthlyBudgetMicros({ AI_MONTHLY_BUDGET_USD: bad })).toBe(5_000_000);
    expect(utcMonth(NOW)).toEqual({ from: new Date("2026-11-01T00:00:00.000Z"), to: new Date("2026-12-01T00:00:00.000Z") });
    expect(utcMonth(new Date("2026-12-31T23:59:59.999Z")).to).toEqual(new Date("2027-01-01T00:00:00.000Z"));
  });

  it("at the budget, across everyone: 503 budget on both routes, no call, and the status says reached", async () => {
    const w = aiWorld();
    await withBread(w);
    seed(w, 4, SPENT, { costMicros: 1_000_000, user: ANU });
    seed(w, 1, SPENT, { costMicros: 1_000_000, user: "usr_someone" });
    for (const res of [await w.call("POST", USES, RAHUL, { text: "a slice of bread" }), await post(w, jpeg())]) {
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: "internal_error",
        details: { reason: KITCHEN_AI_ERROR_REASONS.BUDGET, resetsAt: "2026-12-01T00:00:00.000Z" },
      });
    }
    expect(w.ai.sent).toHaveLength(0);
    expect(w.usageRows()).toHaveLength(5);

    const status = await w.call<AiStatus>("GET", me("ai"), RAHUL);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({
      available: false,
      budget: "reached",
      features: { sayIt: false, receipt: false, import: false, voice: false, swaps: false },
    });
    w.close();
  });

  it("under the budget AI runs; last month's spend and a higher AI_MONTHLY_BUDGET_USD don't count against it", async () => {
    const w = aiWorld({ env: { AI_MONTHLY_BUDGET_USD: "8" } });
    await withBread(w);
    seed(w, 5, SPENT, { costMicros: 1_000_000, user: ANU });
    seed(w, 50, "2026-10-31T23:59:59.999Z", { costMicros: 1_000_000, user: ANU });
    w.ai.script.push(bread());
    expect((await w.call("POST", USES, RAHUL, { text: "a slice of bread" })).status).toBe(200);
    const status = await w.call<AiStatus>("GET", me("ai"), RAHUL);
    expect(status.body.data).toMatchObject({ available: true, budget: "ok" });
    w.close();
  });

  it("the action that crosses the budget runs; the next one is refused", async () => {
    const w = aiWorld({ env: { AI_MONTHLY_BUDGET_USD: "0.0001" } }); // 100 µ$
    await withBread(w);
    seed(w, 1, SPENT, { costMicros: 99 });
    w.ai.script.push(bread());
    expect((await w.call("POST", USES, RAHUL, { text: "a slice of bread" })).status).toBe(200);
    expect((await w.call("POST", USES, RAHUL, { text: "a slice of bread" })).status).toBe(503);
    expect(w.ai.sent).toHaveLength(1);
    w.close();
  });

  it("a budget that cannot be read keeps AI off — never open — and is logged", async () => {
    const w = aiWorld();
    await withBread(w);
    // The month's sum fails; the day's count (which does not read cost_micros) still works.
    w.h.db.exec("DROP INDEX kitchen_ai_usage_created_idx");
    w.h.db.exec("ALTER TABLE kitchen_ai_usage DROP COLUMN cost_micros");
    const warned: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args.join(" "));
    try {
      const res = await w.call("POST", USES, RAHUL, { text: "a slice of bread" });
      expect(res.status).toBe(503);
      expect(res.body.error.details).toMatchObject({ reason: KITCHEN_AI_ERROR_REASONS.BUDGET });
      expect(w.ai.sent).toHaveLength(0);
      const status = await w.call<AiStatus>("GET", me("ai"), RAHUL);
      expect(status.body.data).toMatchObject({ available: false, budget: "reached" });
    } finally {
      console.warn = original;
    }
    expect(warned.join("\n")).toMatch(/ai budget unreadable/);
    w.close();
  });
});
