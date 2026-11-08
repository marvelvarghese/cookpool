// The SDK's timer methods (Cookpool GC-3): the design's paths and methods,
// the body as given, the idempotency key passed through, and the kitchen's
// errors decoded — a timer over the limit, someone else's timer.

import { describe, expect, it, vi } from "vitest";

import { Cookpool, KITCHEN_TIMERS_MAX_ACTIVE, isKitchenTimerUrl } from "../index.js";
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

const timer = {
  id: "tmr_00000000000040008000000000000001",
  label: "Simmer · step 7",
  body: null,
  url: "/cook/session",
  endsAt: "2026-11-08T12:10:00.000Z",
  createdAt: "2026-11-08T12:00:00.000Z",
  sentAt: null,
  canceledAt: null,
};

describe("KitchenClient — timers (Cookpool GC-3)", () => {
  it("lists the caller's active timers", async () => {
    const f = capture(ok({ timers: [timer] }));
    expect(await client(f.fetch).kitchen.timers()).toEqual({ timers: [timer] });
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/timers");
    expect(f.calls[0]!.init.method).toBe("GET");
  });

  it("sets a timer with the body as given, and passes the idempotency key through", async () => {
    const f = capture(ok({ timer }, 201));
    const body = { label: "Simmer · step 7", body: "The oil shows at the edges", url: "/cook/session", endsAt: timer.endsAt };
    expect(await client(f.fetch).kitchen.createTimer(body, { idempotencyKey: "ikey_tmr_1" })).toEqual({ timer });
    expect(f.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/timers");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual(body);
    expect(new Headers(f.calls[0]!.init.headers as HeadersInit).get("idempotency-key")).toBe("ikey_tmr_1");
  });

  it("cancels a timer by its id, encoded into the path", async () => {
    const f = capture(ok({ timer: { ...timer, canceledAt: "2026-11-08T12:05:00.000Z" } }));
    await client(f.fetch).kitchen.cancelTimer(timer.id);
    expect(f.calls[0]!.url).toBe(`https://api.test/v1/kitchen/me/timers/${timer.id}`);
    expect(f.calls[0]!.init.method).toBe("DELETE");
    const odd = capture(ok({ timer }));
    await client(odd.fetch).kitchen.cancelTimer("tmr_a/b");
    expect(odd.calls[0]!.url).toBe("https://api.test/v1/kitchen/me/timers/tmr_a%2Fb");
  });

  it("surfaces a timer over the limit as ValidationError with its reason, and someone else's as NotFoundError", async () => {
    const tooMany = capture(failed("validation_failed", 422, { reason: "too_many_timers", max: KITCHEN_TIMERS_MAX_ACTIVE }));
    const err = await client(tooMany.fetch)
      .kitchen.createTimer({ label: "One more", endsAt: timer.endsAt })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details).toMatchObject({ reason: "too_many_timers", max: 10 });
    await expect(client(capture(failed("not_found", 404)).fetch).kitchen.cancelTimer(timer.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("re-exports the timer bounds and the app-path check", () => {
    expect(KITCHEN_TIMERS_MAX_ACTIVE).toBe(10);
    expect(isKitchenTimerUrl("/cook/session")).toBe(true);
    expect(isKitchenTimerUrl("//evil.example")).toBe(false);
  });
});
