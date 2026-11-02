import {
  AUTH_ERROR_REASONS,
  ERROR_CODES,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODES_PER_WINDOW,
  LOGIN_CODE_WINDOW_SECONDS,
  type LoginCompleteRefusedDetails,
  type LoginCompleteWrongCodeDetails,
  type LoginStartRateLimitedDetails,
} from "@saas/contracts";

describe("contracts: limits on sign-in codes (Cookpool SI-2)", () => {
  it("a code allows 5 tries; an address gets 5 codes per 15 minutes", () => {
    expect(LOGIN_CODE_MAX_ATTEMPTS).toBe(5);
    expect(LOGIN_CODES_PER_WINDOW).toBe(5);
    expect(LOGIN_CODE_WINDOW_SECONDS).toBe(900);
  });

  it("carries each refusal as a reason on an existing, pinned error code", () => {
    expect(AUTH_ERROR_REASONS).toEqual({
      TOO_MANY_ATTEMPTS: "too_many_attempts",
      CODE_EXPIRED: "code_expired",
      CODE_USED: "code_used",
      TOO_MANY_CODES: "too_many_codes",
    });
    const codes: string[] = Object.values(ERROR_CODES);
    expect(codes).toContain("precondition_failed");
    expect(codes).toContain("rate_limited");
    expect(codes).toContain("not_found");
    for (const reason of Object.values(AUTH_ERROR_REASONS)) expect(codes).not.toContain(reason);
  });

  it("types the details each refusal carries", () => {
    const wrong: LoginCompleteWrongCodeDetails = { attemptsLeft: 4 };
    const spent: LoginCompleteRefusedDetails = { reason: AUTH_ERROR_REASONS.TOO_MANY_ATTEMPTS, attemptsLeft: 0 };
    const expired: LoginCompleteRefusedDetails = { reason: AUTH_ERROR_REASONS.CODE_EXPIRED };
    const limited: LoginStartRateLimitedDetails = { reason: AUTH_ERROR_REASONS.TOO_MANY_CODES, retryAfterSeconds: 600 };
    expect([wrong, spent, expired, limited]).toEqual([
      { attemptsLeft: 4 },
      { reason: "too_many_attempts", attemptsLeft: 0 },
      { reason: "code_expired" },
      { reason: "too_many_codes", retryAfterSeconds: 600 },
    ]);
  });
});
