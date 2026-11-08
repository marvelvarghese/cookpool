// The SDK's stock check (Cookpool PN-4): the design's paths for a group item
// and a personal one, the body as given, the idempotency key passed through,
// and the check's refusals decoded with their reasons.

import { describe, expect, it, vi } from "vitest";

import { Cookpool, KITCHEN_CHECK_ERROR_REASONS, STOCK_CHECK_GONE, STOCK_MOVE_VIAS } from "../index.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";

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
const moved = {
  item: { id: ITEM, qtyLeftMilli: 750_000 },
  move: { id: "mov_1", itemId: ITEM, kind: "use", qtyMilli: 250_000, quantity: 250, unit: "ml", costMinor: 1500, via: "check" },
  txn: null,
};

describe("KitchenClient — the stock check (Cookpool PN-4)", () => {
  it("checks a group item at its path, with the body as given and the idempotency key", async () => {
    const f = capture(ok(moved, 201));
    const body = { left: { quantity: "750", unit: "ml" }, gone: "split" } as const;
    expect(await client(f.fetch).kitchen.checkGroupItem(ORG, ITEM, body, { idempotencyKey: "ikey_chk_1" })).toEqual(moved);
    expect(f.calls[0]!.url).toBe(`https://api.test/v1/organizations/${ORG}/kitchen/items/${ITEM}/check`);
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual(body);
    expect(new Headers(f.calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ikey_chk_1");
  });

  it("checks a personal item at its path, its id encoded", async () => {
    const f = capture(ok(moved, 201));
    await client(f.fetch).kitchen.checkPersonalItem(ITEM, { left: { quantity: 0 }, gone: "waste" });
    expect(f.calls[0]!.url).toBe(`https://api.test/v1/kitchen/me/items/${ITEM}/check`);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ left: { quantity: 0 }, gone: "waste" });
    const odd = capture(ok(moved, 201));
    await client(odd.fetch).kitchen.checkPersonalItem("itm_a/b", { left: { quantity: "1" } });
    expect(odd.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/items/itm_a%2Fb/check");
  });

  it("surfaces the refusals with their reasons", async () => {
    const unchanged = await client(capture(failed("validation_failed", 422, { reason: "unchanged", qtyLeftMilli: 750_000 })).fetch)
      .kitchen.checkGroupItem(ORG, ITEM, { left: { quantity: "0.75" } })
      .catch((e: unknown) => e);
    expect(unchanged).toBeInstanceOf(ValidationError);
    expect((unchanged as ValidationError).details).toMatchObject({ reason: KITCHEN_CHECK_ERROR_REASONS.UNCHANGED });

    const over = await client(capture(failed("validation_failed", 422, { reason: "more_than_bought", qtyBoughtMilli: 1_000_000 })).fetch)
      .kitchen.checkPersonalItem(ITEM, { left: { quantity: "2" } })
      .catch((e: unknown) => e);
    expect((over as ValidationError).details).toMatchObject({ reason: KITCHEN_CHECK_ERROR_REASONS.MORE_THAN_BOUGHT });

    const stale = client(capture(failed("conflict", 409, { reason: "stale" })).fetch).kitchen.checkGroupItem(ORG, ITEM, {
      left: { quantity: "0.5" },
      gone: "me",
    });
    await expect(stale).rejects.toBeInstanceOf(ConflictError);
    await expect(
      client(capture(failed("not_found", 404)).fetch).kitchen.checkGroupItem(ORG, ITEM, { left: { quantity: "0.5" }, gone: "me" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("re-exports the answers, the vias and the reasons", () => {
    expect(STOCK_CHECK_GONE).toEqual(["me", "split", "waste"]);
    expect(STOCK_MOVE_VIAS).toEqual(["check", "ask"]);
    expect(KITCHEN_CHECK_ERROR_REASONS).toEqual({ UNCHANGED: "unchanged", MORE_THAN_BOUGHT: "more_than_bought" });
  });
});
