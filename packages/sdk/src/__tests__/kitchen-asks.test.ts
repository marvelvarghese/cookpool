// The SDK's ask before use (Cookpool PN-8): the design's paths for asking,
// the four answers and the cross-group read, the bodies as given, the
// idempotency key passed through, the refusals decoded with their reasons,
// updateGroupItem carrying the setting, and the re-exports.

import { describe, expect, it, vi } from "vitest";

import { ASK_LAPSE_HOURS, Cookpool, KITCHEN_ASK_ERROR_REASONS, KITCHEN_ASK_PUSH_KIND, askPushUrl } from "../index.js";
import { ConflictError, ForbiddenError } from "../errors.js";
import type { AskToUseRequest } from "@saas/contracts/kitchen";

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

const ORG = "org_00000000000040008000000000000001";
const ITEM = "itm_00000000000040008000000000000002";
const ASK = "ask_00000000000040008000000000000003";
const ask = { id: ASK, state: "pending", amount: "1 pinch" };

describe("KitchenClient — ask before use (Cookpool PN-8)", () => {
  it("asks at the item's path, with the body as given and the idempotency key", async () => {
    const f = capture(ok({ ask }, 201));
    const body: AskToUseRequest = { quantity: 1, measure: "pinch", consumers: ["usr_dev", "usr_anu"], source: "cook" };
    expect(await client(f.fetch).kitchen.askToUse(ORG, ITEM, body, { idempotencyKey: "ikey_ask_1" })).toEqual({ ask });
    expect(f.calls[0]!.url).toBe(`https://api.test/v1/organizations/${ORG}/kitchen/items/${ITEM}/asks`);
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual(body);
    expect(new Headers(f.calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ikey_ask_1");
  });

  it("approves with its options, and declines, reopens and cancels at the ask's paths", async () => {
    const approved = { ask: { ...ask, state: "approved" }, item: { id: ITEM }, move: { id: "mov_1", via: "ask" }, txn: null };
    const f = capture(ok(approved, 201));
    expect(await client(f.fetch).kitchen.approveAsk(ORG, ASK, { alwaysAllow: true, takeWhatsLeft: true })).toEqual(approved);
    expect(f.calls[0]!.url).toBe(`https://api.test/v1/organizations/${ORG}/kitchen/asks/${ASK}/approve`);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ alwaysAllow: true, takeWhatsLeft: true });
    const bare = capture(ok(approved, 201));
    await client(bare.fetch).kitchen.approveAsk(ORG, ASK);
    expect(JSON.parse(String(bare.calls[0]!.init.body))).toEqual({});

    for (const verb of ["decline", "reopen", "cancel"] as const) {
      const g = capture(ok({ ask }));
      const kitchen = client(g.fetch).kitchen;
      const call = verb === "decline" ? kitchen.declineAsk(ORG, ASK) : verb === "reopen" ? kitchen.reopenAsk(ORG, ASK) : kitchen.cancelAsk(ORG, ASK);
      expect(await call).toEqual({ ask });
      expect(g.calls[0]!.url).toBe(`https://api.test/v1/organizations/${ORG}/kitchen/asks/${ASK}/${verb}`);
      expect(g.calls[0]!.init.method).toBe("POST");
    }
    const odd = capture(ok({ ask }));
    await client(odd.fetch).kitchen.cancelAsk(ORG, "ask_a/b");
    expect(odd.calls[0]!.url).toBe(`https://api.test/v1/organizations/${ORG}/kitchen/asks/ask_a%2Fb/cancel`);
  });

  it("reads the caller's asks across groups", async () => {
    const f = capture(ok({ toAnswer: [ask], mine: [] }));
    expect(await client(f.fetch).kitchen.asks()).toEqual({ toAnswer: [ask], mine: [] });
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/asks");
    expect(f.calls[0]!.init.method).toBe("GET");
  });

  it("sends the setting with updateGroupItem", async () => {
    const f = capture(ok({ item: { id: ITEM, askFirst: true } }));
    await client(f.fetch).kitchen.updateGroupItem(ORG, ITEM, { askFirst: true, allowed: ["usr_anu"] });
    expect(f.calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ askFirst: true, allowed: ["usr_anu"] });
  });

  it("surfaces the refusals with their reasons", async () => {
    const mustAsk = await client(capture(failed("forbidden", 403, { reason: "ask_first", answerer: "usr_meera", itemId: ITEM })).fetch)
      .kitchen.useGroupItem(ORG, ITEM, { quantity: 1, measure: "pinch" })
      .catch((e: unknown) => e);
    expect(mustAsk).toBeInstanceOf(ForbiddenError);
    expect((mustAsk as ForbiddenError).details).toMatchObject({ reason: KITCHEN_ASK_ERROR_REASONS.ASK_FIRST, answerer: "usr_meera" });

    for (const reason of [KITCHEN_ASK_ERROR_REASONS.NO_NEED, KITCHEN_ASK_ERROR_REASONS.LAPSED, KITCHEN_ASK_ERROR_REASONS.NOT_PENDING]) {
      const refused = await client(capture(failed("conflict", 409, { reason })).fetch)
        .kitchen.approveAsk(ORG, ASK)
        .catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(ConflictError);
      expect((refused as ConflictError).details).toMatchObject({ reason });
    }
  });

  it("re-exports the ask names", () => {
    expect(ASK_LAPSE_HOURS).toBe(24);
    expect(KITCHEN_ASK_PUSH_KIND).toBe("kitchen.ask");
    expect(askPushUrl(ASK)).toBe(`/home?ask=${ASK}`);
    expect(KITCHEN_ASK_ERROR_REASONS).toEqual({ ASK_FIRST: "ask_first", NO_NEED: "no_need", LAPSED: "lapsed", NOT_PENDING: "not_pending" });
  });
});
