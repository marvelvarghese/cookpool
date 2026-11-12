// Spliteco SE4 (SE-5) in the contract: the live split's refusals, its polling
// and presence windows, the join code's alphabet and shape, and a draft's total.

import {
  SPLITECO_ERROR_REASONS,
  SPLITECO_LIVE_CODE_ALPHABET as JOIN_ALPHABET_COPY,
  SPLITECO_LIVE_CODE_LENGTH,
  SPLITECO_LIVE_HOURS,
  SPLITECO_LIVE_POLL_MS,
  SPLITECO_LIVE_PRESENCE_SECONDS,
  formatLiveCode,
  liveDraftTotal,
  normalizeLiveCode,
} from "@saas/contracts/spliteco";

describe("spliteco live split (SE4)", () => {
  it("names the refusals the live routes answer with", () => {
    expect(SPLITECO_ERROR_REASONS).toMatchObject({
      NOT_THE_OPENER: "not_the_opener",
      OWN_CLAIMS_ONLY: "own_claims_only",
      NOT_ALL_CLAIMED: "not_all_claimed",
      LIVE_LOCKED: "live_locked",
      LIVE_EXPIRED: "live_expired",
      NO_SUCH_ITEM: "no_such_item",
    });
    expect(new Set(Object.values(SPLITECO_ERROR_REASONS)).size).toBe(Object.values(SPLITECO_ERROR_REASONS).length);
  });

  it("polls every 2 s, so a claim shows within 3 s; here means seen in the last 10 s; open 24 h", () => {
    expect(SPLITECO_LIVE_POLL_MS).toBe(2000);
    expect(SPLITECO_LIVE_POLL_MS).toBeLessThan(3000);
    expect(SPLITECO_LIVE_PRESENCE_SECONDS).toBe(10);
    expect(SPLITECO_LIVE_HOURS).toBe(24);
  });

  it("uses membership's join-code alphabet: 8 characters, no look-alikes", () => {
    expect(JOIN_ALPHABET_COPY).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    expect(SPLITECO_LIVE_CODE_LENGTH).toBe(8);
    for (const c of "01ILO") expect(JOIN_ALPHABET_COPY).not.toContain(c);
    expect(normalizeLiveCode("ktch 2345")).toBe("KTCH2345");
    expect(normalizeLiveCode("KTCH-2345")).toBe("KTCH2345");
    expect(normalizeLiveCode("KTCH-234O")).toBeNull();
    expect(formatLiveCode("KTCH2345")).toBe("KTCH-2345");
  });

  it("totals a draft as the itemized expense will: items, plus tax and service, less discount", () => {
    expect(
      liveDraftTotal({
        items: [{ name: "a", totalMinor: 68000 }, { name: "b", totalMinor: 108000 }],
        adjustments: [
          { kind: "tax", label: "GST", amountMinor: 8800 },
          { kind: "service", label: "Service", amountMinor: 17600 },
          { kind: "discount", label: "Happy hour", amountMinor: 10000 },
        ],
      }),
    ).toBe(192400);
  });
});
