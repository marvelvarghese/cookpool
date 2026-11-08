// Cookpool AI in the contract (cookpool-ai AI-2, design §1, §2): the limits,
// the features the status read names, the refusal reasons — riding on pinned
// codes, never shadowing another reason — and the shapes of the routes.

import {
  AI_DAILY_ACTIONS,
  AI_DAILY_VOICE_SECONDS,
  AI_FEATURE_KEYS,
  AI_USES_TEXT_MAX,
  AI_USE_FLAGS,
  ERROR_CODES,
  KITCHEN_AI_ERROR_REASONS,
  KITCHEN_ASK_ERROR_REASONS,
  KITCHEN_CHECK_ERROR_REASONS,
  KITCHEN_COMMUNITY_ERROR_REASONS,
  KITCHEN_ERROR_REASONS,
  KITCHEN_POSTS_ERROR_REASONS,
  KITCHEN_TIMER_ERROR_REASONS,
  type AiStatus,
  type AiUseProposal,
  type AiUsesRequest,
  type AiUsesResponse,
  AI_RECEIPT_IMAGE_TYPES,
  AI_RECEIPT_MAX_BYTES,
  AI_RECEIPT_MAX_LINES,
  AI_RECEIPT_NOT_FOOD,
  type AiReceiptRequest,
  type AiReceiptResponse,
} from "@saas/contracts";
import * as ai from "@saas/contracts/kitchen-ai";

describe("contracts: Cookpool AI (AI-2)", () => {
  it("limits each person to 50 actions and 30 voice minutes a UTC day, and a sentence to 300 characters", () => {
    expect([AI_DAILY_ACTIONS, AI_DAILY_VOICE_SECONDS, AI_USES_TEXT_MAX]).toEqual([50, 1800, 300]);
  });

  it("names the five features and the two flags a proposal can carry", () => {
    expect(AI_FEATURE_KEYS).toEqual(["sayIt", "receipt", "import", "voice", "swaps"]);
    expect(AI_USE_FLAGS).toEqual(["the_rest", "people_removed"]);
  });

  it("rides on the pinned codes with reasons of its own, never another's", () => {
    expect(KITCHEN_AI_ERROR_REASONS).toEqual({
      AI_UNAVAILABLE: "ai_unavailable",
      AI_FAILED: "ai_failed",
      AI_DAILY_LIMIT: "ai_daily_limit",
      VOICE_DAILY_LIMIT: "voice_daily_limit",
    });
    const others: readonly string[] = [
      ...Object.values(KITCHEN_ERROR_REASONS),
      ...Object.values(KITCHEN_CHECK_ERROR_REASONS),
      ...Object.values(KITCHEN_ASK_ERROR_REASONS),
      ...Object.values(KITCHEN_TIMER_ERROR_REASONS),
      ...Object.values(KITCHEN_COMMUNITY_ERROR_REASONS),
      ...Object.values(KITCHEN_POSTS_ERROR_REASONS),
    ];
    for (const reason of Object.values(KITCHEN_AI_ERROR_REASONS)) expect(others).not.toContain(reason);
    // The codes they ride on are pinned ones.
    expect(Object.values(ERROR_CODES)).toEqual(expect.arrayContaining(["internal_error", "rate_limited"]));
  });

  it("is exported from @saas/contracts/kitchen-ai too", () => {
    expect(ai.KITCHEN_AI_ERROR_REASONS).toBe(KITCHEN_AI_ERROR_REASONS);
    expect(ai.AI_DAILY_ACTIONS).toBe(AI_DAILY_ACTIONS);
  });

  it("shapes the status read and say what you used", () => {
    const status: AiStatus = {
      available: false,
      features: { sayIt: false, receipt: false, import: false, voice: false, swaps: false },
      today: { actions: 0, actionsLimit: AI_DAILY_ACTIONS, voiceSeconds: 0, voiceSecondsLimit: AI_DAILY_VOICE_SECONDS },
    };
    expect(Object.keys(status.features)).toEqual([...AI_FEATURE_KEYS]);

    const request: AiUsesRequest = { text: "Anu and I had 2 glasses of milk and half the bread" };
    expect(request.text.length).toBeLessThanOrEqual(AI_USES_TEXT_MAX);
    const line: AiUseProposal = {
      itemRef: { kind: "group", orgId: "org_1", itemId: "itm_1" },
      name: "Milk",
      pantry: { kind: "group", orgId: "org_1", slug: "flat-4b", name: "Flat 4B" },
      quantity: 2,
      measure: "glass",
      consumers: ["usr_rahul", "usr_anu"],
      label: "2 glasses",
      flags: [],
    };
    const rest: AiUseProposal = {
      itemRef: { kind: "personal", itemId: "itm_2" },
      name: "Milk",
      pantry: { kind: "personal", name: "Mine" },
      quantity: 1000,
      unit: "ml",
      consumers: ["usr_rahul"],
      label: "1000 ml",
      flags: ["the_rest"],
    };
    const response: AiUsesResponse = { lines: [line, rest], unsure: ["Ravi"] };
    expect(response.lines).toHaveLength(2);
  });
});

describe("contracts: receipts (AI-3)", () => {
  it("takes a JPEG or WebP of at most 1.5 MB, and up to 60 lines", () => {
    expect(AI_RECEIPT_MAX_BYTES).toBe(1.5 * 1024 * 1024);
    expect(AI_RECEIPT_IMAGE_TYPES).toEqual(["image/jpeg", "image/webp"]);
    expect(AI_RECEIPT_MAX_LINES).toBe(60);
    expect(AI_RECEIPT_NOT_FOOD).toBe("not_food");
    expect(ai.AI_RECEIPT_MAX_BYTES).toBe(AI_RECEIPT_MAX_BYTES);
  });

  it("shapes the request and the response (design §3, plus currency, sumMinor and totalMatches)", () => {
    const request: AiReceiptRequest = { image: "/9j/4AAQ" };
    const response: AiReceiptResponse = {
      store: "DMart",
      total: 23600,
      currency: "INR",
      sumMinor: 9000,
      totalMatches: true,
      lines: [
        {
          text: "MLK PNR 200G",
          name: "Paneer",
          foodId: "paneer",
          quantity: 200,
          unit: "g",
          priceMinor: 9000,
          pantry: { kind: "personal", name: "Mine" },
          fromItemId: "itm_1",
          confidence: "sure",
        },
        { text: "SURF EXCEL 1KG", priceMinor: 14600, confidence: "check", reason: AI_RECEIPT_NOT_FOOD },
      ],
    };
    expect(request.image).toBeTruthy();
    expect(response.lines.map((l) => l.confidence)).toEqual(["sure", "check"]);
  });
});
