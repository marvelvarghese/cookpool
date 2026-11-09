// The SDK's voice and stove methods (Cookpool AI-5): the clip sent as bytes
// with its length in the query, the three step calls' paths and bodies, and
// their refusals decoded.

import { describe, expect, it, vi } from "vitest";

import { AI_STOVE_DONENESS_CHECK, AI_TRANSCRIBE_MAX_SECONDS, Cookpool, KITCHEN_AI_ERROR_REASONS } from "../index.js";
import { InternalError, NotFoundError, RateLimitError, ValidationError } from "../errors.js";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function capture(response: Response): { fetch: typeof fetch; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fn: typeof fetch = vi.fn(async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response.clone();
  });
  return { fetch: fn, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = <T>(data: T) => json({ data, meta: { requestId: "req_test", cursor: null } });
const failed = (code: string, status: number, details: Record<string, unknown> = {}) =>
  json({ error: { code, message: `synthetic ${code}`, details, requestId: "req_err" } }, status);
const client = (f: typeof fetch) => new Cookpool({ baseUrl: "https://api.test", fetch: f });
const headerOf = (call: CapturedCall, name: string) => new Headers(call.init.headers as HeadersInit).get(name);

describe("kitchen.aiTranscribe (AI-5)", () => {
  it("sends the clip's bytes as they are, its type as the Content-Type and its length as ?seconds=", async () => {
    const f = capture(ok({ text: "next" }));
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    expect(await client(f.fetch).kitchen.aiTranscribe(bytes, { seconds: 3.5, contentType: "audio/webm;codecs=opus" })).toEqual({ text: "next" });
    const call = f.calls[0]!;
    expect(call.url).toBe("https://api.test/v1/kitchen/me/ai/transcribe?seconds=3.5");
    expect(call.init.method).toBe("POST");
    expect(call.init.body).toBe(bytes);
    expect(headerOf(call, "content-type")).toBe("audio/webm;codecs=opus");
    expect(AI_TRANSCRIBE_MAX_SECONDS).toBe(15);
  });

  it("takes a Blob's own type when none is given", async () => {
    const f = capture(ok({ text: "" }));
    await client(f.fetch).kitchen.aiTranscribe(new Blob([new Uint8Array([1, 2])], { type: "audio/mp4" }), { seconds: 2 });
    expect(headerOf(f.calls[0]!, "content-type")).toBe("audio/mp4");
  });

  it("decodes no binding and the voice limit", async () => {
    const none = capture(failed("internal_error", 503, { reason: KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE }));
    const err = await client(none.fetch).kitchen.aiTranscribe(new Uint8Array(4), { seconds: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalError);
    expect((err as InternalError).details.reason).toBe("ai_unavailable");
    const limited = capture(failed("rate_limited", 429, { reason: "voice_daily_limit", limit: 1800, used: 1800 }));
    const over = await client(limited.fetch).kitchen.aiTranscribe(new Uint8Array(4), { seconds: 1 }).catch((e: unknown) => e);
    expect(over).toBeInstanceOf(RateLimitError);
    expect((over as RateLimitError).details).toMatchObject({ reason: "voice_daily_limit", limit: 1800 });
  });
});

describe("kitchen.aiAskStep, aiCheckStep, aiRescue (AI-5)", () => {
  it.each([
    ["aiAskStep", "ask-step", { recipeId: "rcp_1", factor: 1500, stepKey: "k1", question: "How long?" }, { answer: "Ten minutes." }],
    ["aiCheckStep", "check-step", { recipeId: "rcp_1", stepKey: "k1", image: "/9j/4AAQ" }, { verdict: "looks_right", say: "Go on." }],
    ["aiRescue", "rescue", { recipeId: "rcp_1", stepKey: "k1", problem: "burning" }, { title: "Save it", steps: ["Flame off."], say: "Flame off." }],
  ] as const)("%s posts its body as given to /me/ai/%s", async (method, path, body, data) => {
    const f = capture(ok(data));
    const kitchen = client(f.fetch).kitchen as unknown as Record<string, (b: unknown) => Promise<unknown>>;
    expect(await kitchen[method]!.call(client(f.fetch).kitchen, body)).toEqual(data);
    expect(f.calls[0]!.url).toBe(`https://api.test/v1/kitchen/me/ai/${path}`);
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual(body);
    expect(headerOf(f.calls[0]!, "content-type")).toBe("application/json");
  });

  it("decodes a recipe out of reach, a step it lacks and a failed read", async () => {
    const ref = { recipeId: "rcp_1", stepKey: "k1", question: "Ok?" };
    const hidden = capture(failed("not_found", 404));
    expect(await client(hidden.fetch).kitchen.aiAskStep(ref).catch((e: unknown) => e)).toBeInstanceOf(NotFoundError);
    const step = capture(failed("validation_failed", 422, { fields: { stepKey: ["Not a step of this recipe"] } }));
    expect(await client(step.fetch).kitchen.aiAskStep(ref).catch((e: unknown) => e)).toBeInstanceOf(ValidationError);
    const bad = capture(failed("internal_error", 502, { reason: "ai_failed" }));
    const err = await client(bad.fetch).kitchen.aiRescue({ recipeId: "rcp_1", stepKey: "k1", problem: "split" }).catch((e: unknown) => e);
    expect((err as InternalError).details.reason).toBe("ai_failed");
    expect(AI_STOVE_DONENESS_CHECK).toContain("74 °C");
  });
});
