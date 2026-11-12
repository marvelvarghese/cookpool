import {
  ERROR_CODES,
  PASSKEY_CHALLENGE_TTL_SECONDS,
  PASSKEY_DEVICE_NAME_MAX,
  PASSKEY_ERROR_REASONS,
  PASSKEY_ID_PREFIX,
  PASSKEY_ID_RE,
  PASSKEY_MAX_PER_USER,
  type LoginCompleteResponse,
  type Passkey,
  type PasskeyLoginVerifyResponse,
} from "@saas/contracts";
import * as direct from "@saas/contracts/passkeys";

describe("contracts: passkeys (cookpool-passkeys PK-2)", () => {
  it("pins the limits: 10 passkeys, 5-minute challenges, 60-character names", () => {
    expect(PASSKEY_MAX_PER_USER).toBe(10);
    expect(PASSKEY_CHALLENGE_TTL_SECONDS).toBe(300);
    expect(PASSKEY_DEVICE_NAME_MAX).toBe(60);
    expect(direct.PASSKEY_MAX_PER_USER).toBe(PASSKEY_MAX_PER_USER);
  });

  it("pins the id shape: pky_ plus 16 hex characters", () => {
    expect(PASSKEY_ID_PREFIX).toBe("pky_");
    expect(PASSKEY_ID_RE.test("pky_0123456789abcdef")).toBe(true);
    for (const bad of ["pky_0123456789ABCDEF", "pky_0123", "dlg_0123456789abcdef", "pky_0123456789abcdef0"]) {
      expect(PASSKEY_ID_RE.test(bad)).toBe(false);
    }
  });

  it("rides on the pinned error codes with these reasons, adding none", () => {
    expect(PASSKEY_ERROR_REASONS).toEqual({
      PASSKEYS_OFF: "passkeys_off",
      TOO_MANY_PASSKEYS: "too_many_passkeys",
      PASSKEY_FAILED: "passkey_failed",
      SESSION_REQUIRED: "session_required",
    });
    const codes = Object.values(ERROR_CODES) as string[];
    for (const reason of Object.values(PASSKEY_ERROR_REASONS)) expect(codes).not.toContain(reason);
    expect(codes).toHaveLength(10);
  });

  it("answers a passkey sign-in with the login/complete session body", () => {
    const body: LoginCompleteResponse = {
      token: "sps_ses_x.y",
      tokenType: "bearer",
      expiresAt: "2026-12-12T00:00:00.000Z",
      user: { id: "usr_1", email: "anu@cookpool.test", displayName: null },
    };
    const same: PasskeyLoginVerifyResponse = body;
    expect(same).toBe(body);
  });

  it("shows a passkey without its key or credential id", () => {
    const p: Passkey = { id: "pky_0123456789abcdef", deviceName: "iPhone", createdAt: "x", lastUsedAt: null, backedUp: true };
    expect(Object.keys(p).sort()).toEqual(["backedUp", "createdAt", "deviceName", "id", "lastUsedAt"]);
  });
});
