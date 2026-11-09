// The SDK's AI methods (Cookpool AI-2): the design's paths and methods, the
// sentence sent as given, and the AI refusals decoded — no key on the
// server, today's limit, a failed read.

import { describe, expect, it, vi } from "vitest";

import { AI_DAILY_ACTIONS, AI_RECEIPT_MAX_BYTES, AI_RECEIPT_NOT_FOOD, AI_RECIPE_PHOTO_MAX_BYTES, AI_USES_TEXT_MAX, Cookpool, KITCHEN_AI_ERROR_REASONS } from "../index.js";
import { InternalError, RateLimitError, ValidationError } from "../errors.js";

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ok = <T>(data: T, status = 200) => json({ data, meta: { requestId: "req_test", cursor: null } }, status);
const failed = (code: string, status: number, details: Record<string, unknown> = {}) =>
  json({ error: { code, message: `synthetic ${code}`, details, requestId: "req_err" } }, status);

const client = (f: typeof fetch) => new Cookpool({ baseUrl: "https://api.test", fetch: f });

const status = {
  available: true,
  features: { sayIt: true, receipt: false, import: false, voice: false, swaps: false },
  today: { actions: 3, actionsLimit: 50, voiceSeconds: 0, voiceSecondsLimit: 1800 },
};

const proposals = {
  lines: [
    {
      itemRef: { kind: "group", orgId: "org_1", itemId: "itm_1" },
      name: "Milk",
      pantry: { kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B" },
      quantity: 2,
      measure: "glass",
      consumers: ["usr_rahul", "usr_anu"],
      label: "2 glasses",
      flags: [],
    },
  ],
  unsure: ["Ravi"],
};

describe("KitchenClient — Cookpool AI (AI-2)", () => {
  it("reads the AI status", async () => {
    const f = capture(ok(status));
    expect(await client(f.fetch).kitchen.ai()).toEqual(status);
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/ai");
    expect(f.calls[0]!.init.method).toBe("GET");
  });

  it("sends a sentence as given and returns the proposals", async () => {
    const f = capture(ok(proposals));
    const text = "Anu and I had 2 glasses of milk";
    expect(await client(f.fetch).kitchen.aiUses(text)).toEqual(proposals);
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/ai/uses");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ text });
  });

  it("decodes no key on the server, and a failed read, as internal errors with their reason", async () => {
    for (const [httpStatus, reason] of [
      [503, KITCHEN_AI_ERROR_REASONS.AI_UNAVAILABLE],
      [502, KITCHEN_AI_ERROR_REASONS.AI_FAILED],
      // AI-13: this month's budget is spent.
      [503, KITCHEN_AI_ERROR_REASONS.BUDGET],
    ] as const) {
      const f = capture(failed("internal_error", httpStatus, { reason }));
      const err = await client(f.fetch).kitchen.aiUses("milk").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InternalError);
      expect((err as InternalError).details.reason).toBe(reason);
    }
  });

  it("decodes today's limit as a rate limit with its reason", async () => {
    const f = capture(failed("rate_limited", 429, { reason: "ai_daily_limit", limit: 50, used: 50, resetsAt: "2026-11-10T00:00:00.000Z" }));
    const err = await client(f.fetch).kitchen.aiUses("milk").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).details).toMatchObject({ reason: KITCHEN_AI_ERROR_REASONS.AI_DAILY_LIMIT, limit: AI_DAILY_ACTIONS });
    expect(AI_USES_TEXT_MAX).toBe(300);
  });
});

describe("KitchenClient — receipts (AI-3)", () => {
  const receipt = {
    store: "DMart",
    total: 23600,
    currency: "INR",
    sumMinor: 23600,
    totalMatches: true,
    lines: [
      {
        text: "MLK PNR 200G",
        name: "Paneer",
        foodId: "paneer",
        quantity: 200,
        unit: "g",
        priceMinor: 9000,
        pantry: { kind: "personal", name: "My pantry" },
        confidence: "sure",
      },
      { text: "SURF EXCEL 1KG", priceMinor: 14600, confidence: "check", reason: AI_RECEIPT_NOT_FOOD },
    ],
  };

  it("sends the photo as given and returns the lines", async () => {
    const f = capture(ok(receipt));
    expect(await client(f.fetch).kitchen.aiReceipt("/9j/4AAQSkZJRg==")).toEqual(receipt);
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/ai/receipt");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ image: "/9j/4AAQSkZJRg==" });
    expect(AI_RECEIPT_MAX_BYTES).toBe(1_572_864);
  });

  it("decodes a bad photo as a validation error on image", async () => {
    const f = capture(failed("validation_failed", 422, { fields: { image: ["Must be at most 1.5 MB"] } }));
    const err = await client(f.fetch).kitchen.aiReceipt("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
  });
});

describe("KitchenClient — recipe from a photo (AI-4)", () => {
  const result = {
    draft: {
      name: "Jeera rice",
      servesHalf: 4,
      minutes: null,
      kind: "rice",
      lines: [{ foodKey: "rice", name: "Rice", quantity: 1, unit: "cup", toTaste: false, isMain: true }],
      steps: [],
      tools: [],
    },
    checks: [{ path: "servesHalf", message: "Serves isn't on the page: check it" }],
  };

  it("sends the photo as given and returns the draft and its checks", async () => {
    const f = capture(ok(result));
    expect(await client(f.fetch).kitchen.aiRecipePhoto("/9j/4AAQSkZJRg==")).toEqual(result);
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/ai/recipe-photo");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ image: "/9j/4AAQSkZJRg==" });
    expect(AI_RECIPE_PHOTO_MAX_BYTES).toBe(AI_RECEIPT_MAX_BYTES);
  });

  it("decodes a bad photo, and a read with nothing usable", async () => {
    const bad = capture(failed("validation_failed", 422, { fields: { image: ["Must be a JPEG or WebP photo, in base64"] } }));
    expect(await client(bad.fetch).kitchen.aiRecipePhoto("x").catch((e: unknown) => e)).toBeInstanceOf(ValidationError);
    const empty = capture(failed("internal_error", 502, { reason: KITCHEN_AI_ERROR_REASONS.AI_FAILED }));
    const err = await client(empty.fetch).kitchen.aiRecipePhoto("x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalError);
    expect((err as InternalError).details.reason).toBe("ai_failed");
  });
});
