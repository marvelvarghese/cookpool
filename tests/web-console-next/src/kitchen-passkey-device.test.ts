import { resetAppConfigForTests } from "@web-console-next/lib/app-config";
import {
  deviceHasPasskey,
  dismissOffer,
  markDeviceHasPasskey,
  markOfferDue,
  offerDismissedAt,
  passkeysRunOnThisPage,
  shouldOfferPasskey,
  takeOfferDue,
} from "@web-console-next/lib/passkey-device";
import { OFFER_SNOOZE_MS } from "@web-console-next/components/kitchen/passkeys";

// cookpool-passkeys PK-4: what this device remembers about passkeys, and the
// offer weighed once per sign-in, on a fake window.

describe("passkeys on this device", () => {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const storage = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  const hadWindow = "window" in g;
  const page = (hostname: string, webauthn = true) => {
    g.window = {
      location: { host: hostname, hostname },
      localStorage: storage(local),
      sessionStorage: storage(session),
      ...(webauthn ? { PublicKeyCredential: function PublicKeyCredential() {} } : {}),
    };
    resetAppConfigForTests();
  };

  beforeEach(() => {
    local.clear();
    session.clear();
    page("stage.cookpool.store");
  });

  afterAll(() => {
    if (!hadWindow) delete g.window;
    resetAppConfigForTests();
  });

  it("runs on the RP ID's host with WebAuthn, and nowhere else", () => {
    expect(passkeysRunOnThisPage()).toBe(true);
    page("stage.cookpool.store", false);
    expect(passkeysRunOnThisPage()).toBe(false);
    page("cookpool-web-console-next-stage.cookpool.workers.dev");
    expect(passkeysRunOnThisPage()).toBe(false);
    page("cookpool-stage.localhost:47732");
    expect(passkeysRunOnThisPage()).toBe(false);
  });

  it("remembers that it holds a passkey, and when Not now was chosen", () => {
    expect(deviceHasPasskey()).toBe(false);
    markDeviceHasPasskey();
    expect(deviceHasPasskey()).toBe(true);
    expect(offerDismissedAt()).toBeNull();
    dismissOffer(1234);
    expect(offerDismissedAt()).toBe(1234);
    expect([...local.keys()].sort()).toEqual(["cookpool.next.passkey-here", "cookpool.next.passkey-offer-dismissed"]);
  });

  it("weighs the offer once per sign-in, in this tab", () => {
    expect(takeOfferDue()).toBe(false);
    markOfferDue();
    expect([...session.keys()]).toEqual(["cookpool.next.passkey-offer-due"]);
    expect(takeOfferDue()).toBe(true);
    expect(takeOfferDue()).toBe(false);
  });

  it("is not offered without a sign-in, on a device with a passkey, or within 30 days of Not now", async () => {
    const now = 10 * OFFER_SNOOZE_MS;
    expect(await shouldOfferPasskey(now)).toBe(false);
    markOfferDue();
    markDeviceHasPasskey();
    expect(await shouldOfferPasskey(now)).toBe(false);
    expect(takeOfferDue()).toBe(false);
    local.clear();
    dismissOffer(now - 1000);
    markOfferDue();
    expect(await shouldOfferPasskey(now)).toBe(false);
    page("cookpool-web-console-next-stage.cookpool.workers.dev");
    local.clear();
    markOfferDue();
    expect(await shouldOfferPasskey(now)).toBe(false);
  });

  it("is offered after a sign-in when the device has a platform authenticator, and asks the browser only then", async () => {
    const gt = globalThis as unknown as { PublicKeyCredential?: unknown };
    let asked = 0;
    let available = true;
    const pkc = Object.assign(function PublicKeyCredential() {}, {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => {
        asked += 1;
        return available;
      },
    });
    gt.PublicKeyCredential = pkc;
    g.window!.PublicKeyCredential = pkc;
    try {
      const now = 10 * OFFER_SNOOZE_MS;
      expect(await shouldOfferPasskey(now)).toBe(false);
      expect(asked).toBe(0);
      markOfferDue();
      expect(await shouldOfferPasskey(now)).toBe(true);
      expect(asked).toBe(1);
      // Snoozed exactly 30 days ago: offered again.
      dismissOffer(now - OFFER_SNOOZE_MS);
      markOfferDue();
      expect(await shouldOfferPasskey(now)).toBe(true);
      available = false;
      markOfferDue();
      expect(await shouldOfferPasskey(now)).toBe(false);
    } finally {
      delete gt.PublicKeyCredential;
    }
  });
});
