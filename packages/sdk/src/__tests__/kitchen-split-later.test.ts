// The SDK's cooked-then-split-later routes (Cookpool CM-8): splitting your
// own dish with a group, dismissing Home's split reminder and its Undo —
// every path and method, the bodies as given, the Idempotency-Key passed,
// odd ids encoded, the refusals decoded with their reasons, the inbox's
// `splitReminders` read as sent, and the re-exports.

import { describe, expect, it, vi } from "vitest";

import { Cookpool, KITCHEN_DISH_SPLIT_EVENT, KITCHEN_SPLIT_ERROR_REASONS, SPLIT_REMINDER_DAYS, type SplitReminderInboxItem } from "../index.js";
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

const client = (f: typeof fetch) => new Cookpool({ baseUrl: "https://api.test", fetch: f }).kitchen;
const BASE = "https://api.test/v1/kitchen";

describe("KitchenClient — cooked, then split later (Cookpool CM-8)", () => {
  it("splits a dish, and dismisses and restores its reminder", async () => {
    const f = capture(ok({ dish: { id: "dsh_1" } }));
    const k = client(f.fetch);
    await k.splitDish("dsh_1", { orgId: "org_1" }, { idempotencyKey: "split-1" });
    await k.splitDish("dsh 2", { orgId: "org_1", splitMode: "assign" });
    await k.dismissSplitReminder("dsh_1");
    await k.restoreSplitReminder("dsh_1");
    expect(f.calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", `${BASE}/me/dishes/dsh_1/split`],
      ["POST", `${BASE}/me/dishes/dsh%202/split`],
      ["POST", `${BASE}/me/dishes/dsh_1/split-reminder/dismiss`],
      ["POST", `${BASE}/me/dishes/dsh_1/split-reminder/restore`],
    ]);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ orgId: "org_1" });
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ orgId: "org_1", splitMode: "assign" });
    expect(new Headers(f.calls[0]!.init.headers).get("idempotency-key")).toBe("split-1");
  });

  it("reads the inbox's split reminders as sent", async () => {
    const reminder: SplitReminderInboxItem = {
      kind: "split_reminder",
      dish: { id: "dsh_1", name: "Dal", portionsHalf: 4, totalMinor: 4000, currency: "INR", cookedAt: "2026-11-02T12:00:00.000Z", state: "draft", groupItems: 1 },
      suggest: { orgId: "org_1", groupName: "Flat 4B", groupSlug: "flat-4b", why: "used_items" },
    };
    const f = capture(ok({ items: [], counts: { total: 0 }, asks: [], splitReminders: [reminder] }));
    expect((await client(f.fetch).inbox()).splitReminders).toEqual([reminder]);
  });

  it("decodes the refusals with their reasons", async () => {
    const cases: Array<[Response, unknown, string]> = [
      [failed("conflict", 409, { reason: "already_split", orgId: "org_1" }), ConflictError, "already_split"],
      [failed("conflict", 409, { reason: "dish_not_open", state: "canceled" }), ConflictError, "dish_not_open"],
      [failed("validation_failed", 422, { reason: "currency_mismatch", currency: "USD" }), ValidationError, "currency_mismatch"],
      [failed("not_found", 404), NotFoundError, ""],
    ];
    for (const [response, type, reason] of cases) {
      const err = await client(capture(response).fetch).splitDish("dsh_1", { orgId: "org_1" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(type as new () => Error);
      if (reason) expect((err as { details: Record<string, unknown> }).details.reason).toBe(reason);
    }
  });

  it("re-exports the reasons, the event and the reminder's rules", () => {
    expect(KITCHEN_SPLIT_ERROR_REASONS.ALREADY_SPLIT).toBe("already_split");
    expect(KITCHEN_DISH_SPLIT_EVENT).toBe("kitchen.dish.split");
    expect(SPLIT_REMINDER_DAYS).toBe(7);
  });
});
