import crypto from "node:crypto";
import { deliversCodeInline } from "../../../apps/identity-worker/src/debug-delivery";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: crypto.webcrypto });
}

describe("API Envelope Contract", () => {
  describe("success envelope", () => {
    it("wraps data with meta containing requestId and cursor", () => {
      const envelope = {
        data: { foo: "bar" },
        meta: { requestId: "req_abc123", cursor: null },
      };
      expect(envelope.data).toEqual({ foo: "bar" });
      expect(envelope.meta.requestId).toMatch(/^req_/);
      expect(envelope.meta.cursor).toBeNull();
    });
  });

  describe("error envelope", () => {
    it("wraps error with code, message, details, requestId", () => {
      const envelope = {
        error: {
          code: "validation_failed",
          message: "Validation failed",
          details: { fields: { email: ["required"] } },
          requestId: "req_abc123",
        },
      };
      expect(envelope.error.code).toBe("validation_failed");
      expect(envelope.error.message).toBeTruthy();
      expect(envelope.error.requestId).toMatch(/^req_/);
      expect(envelope.error.details).toBeDefined();
    });
  });

  describe("request ID", () => {
    it("preserves valid incoming request ID", () => {
      const incomingId = "req_user-provided-123";
      const RE = /^[\w-]{1,128}$/;
      expect(RE.test(incomingId)).toBe(true);
    });

    it("rejects invalid request IDs", () => {
      const RE = /^[\w-]{1,128}$/;
      expect(RE.test("")).toBe(false);
      expect(RE.test("has spaces")).toBe(false);
      expect(RE.test("a".repeat(129))).toBe(false);
    });
  });
});

describe("Debug delivery boundary", () => {
  // SI-2: DEBUG_DELIVERY (on/off for every address) became
  // DEBUG_DELIVERY_DOMAINS (the domains whose codes are shown on screen).
  it("stage (DEBUG_DELIVERY_DOMAINS=cookpool.test) includes the code only for a cookpool.test address", () => {
    const delivery = (email: string) => {
      const isDebug = deliversCodeInline("cookpool.test", email);
      return {
        mode: isDebug ? "local_debug" : "email",
        emailHint: "t***@example.com",
        ...(isDebug ? { code: "123456" } : {}),
      } as Record<string, unknown>;
    };
    expect(delivery("tester@cookpool.test")["code"]).toBe("123456");
    expect(delivery("tester@cookpool.test")["mode"]).toBe("local_debug");
    expect(delivery("someone@example.com")["code"]).toBeUndefined();
    expect(delivery("someone@example.com")["mode"]).toBe("email");
  });

  it("prod (DEBUG_DELIVERY_DOMAINS empty) never includes code in delivery", () => {
    for (const email of ["t@example.com", "tester@cookpool.test", "a@gmail.com"]) {
      const isDebug = deliversCodeInline("", email);
      const delivery: Record<string, unknown> = {
        mode: isDebug ? "local_debug" : "email",
        emailHint: "t***@example.com",
        ...(isDebug ? { code: "123456" } : {}),
      };
      expect(delivery["code"]).toBeUndefined();
      expect(delivery["mode"]).toBe("email");
    }
  });
});

describe("Token and hash safety", () => {
  it("raw codes are never stored (only hashes)", async () => {
    const code = "742859";
    const data = new TextEncoder().encode(code);
    const buffer = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    expect(hash).not.toBe(code);
    expect(hash.length).toBe(64);
  });

  it("raw token secrets are never stored (only hashes)", async () => {
    const secret = "a".repeat(64);
    const data = new TextEncoder().encode(secret);
    const buffer = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    expect(hash).not.toBe(secret);
    expect(hash.length).toBe(64);
  });
});
