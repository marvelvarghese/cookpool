// The SDK's restocking methods (Cookpool PN-3): the design's paths and
// methods, the lines sent as `{ lines }`, the idempotency key passed
// through, and the kitchen's errors decoded — a pantry out of reach,
// someone else's purchase.

import { describe, expect, it, vi } from "vitest";

import { Cookpool, PURCHASE_MAX_LINES, RESTOCK_REASONS, type PurchaseLine } from "../index.js";
import { NotFoundError, ValidationError } from "../errors.js";

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

const purchaseId = "pur_00000000000040008000000000000001";
const lines: PurchaseLine[] = [
  { pantry: "personal", name: "Bread", category: "Grains", quantity: "1", unit: "pcs", priceMinor: 4500 },
  { pantry: "org_00000000000040008000000000000002", name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 6800, fromItemId: "itm_1" },
];

describe("KitchenClient — restocking (Cookpool PN-3)", () => {
  it("reads what to buy again", async () => {
    const data = { finished: [], runningLow: [], usual: [] };
    const f = capture(ok(data));
    expect(await client(f.fetch).kitchen.restock()).toEqual(data);
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/restock");
    expect(f.calls[0]!.init.method).toBe("GET");
    expect(RESTOCK_REASONS).toEqual(["finished", "running_low", "usual"]);
  });

  it("buys a run as { lines }, passing the idempotency key through", async () => {
    const f = capture(ok({ purchaseId, items: [] }, 201));
    expect(await client(f.fetch).kitchen.buy(lines, { idempotencyKey: "ikey_run_1" })).toEqual({ purchaseId, items: [] });
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/purchases");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ lines });
    expect(new Headers(f.calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ikey_run_1");
    expect(PURCHASE_MAX_LINES).toBe(30);
  });

  it("undoes a purchase by its id, encoded into the path", async () => {
    const f = capture(ok({ purchaseId, removed: [], kept: [] }));
    expect(await client(f.fetch).kitchen.undoPurchase(purchaseId)).toEqual({ purchaseId, removed: [], kept: [] });
    expect(f.calls[0]!.url).toBe(`https://api.test/v1/kitchen/me/purchases/${purchaseId}`);
    expect(f.calls[0]!.init.method).toBe("DELETE");
    const odd = capture(ok({ purchaseId, removed: [], kept: [] }));
    await client(odd.fetch).kitchen.undoPurchase("pur_a/b");
    expect(odd.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/purchases/pur_a%2Fb");
  });

  it("surfaces a pantry out of reach as ValidationError naming the line, and someone else's purchase as NotFoundError", async () => {
    const refused = capture(failed("validation_failed", 422, { fields: { "lines[1].pantry": ["Must be a pantry you can add to"] } }));
    const err = await client(refused.fetch).kitchen.buy(lines).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toMatchObject({ fields: { "lines[1].pantry": ["Must be a pantry you can add to"] } });
    await expect(client(capture(failed("not_found", 404)).fetch).kitchen.undoPurchase(purchaseId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
