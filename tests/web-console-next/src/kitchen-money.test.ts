import {
  MAX_MINOR,
  currencyPrefix,
  formatMinor,
  formatPercentHundredths,
  formatSignedMinor,
  minorToInput,
  moneyInputMessage,
  parseMinor,
  parseMoney,
  parsePercentHundredths,
} from "@web-console-next/components/kitchen/money";
import {
  memberInitials,
  memberLabel,
  memberLabelInline,
  memberTag,
  sortMembers,
} from "@web-console-next/components/kitchen/members";
import { formatMinor as engineFormatMinor } from "@saas/kitchen-engine/money";

describe("parseMoney: a typed rupee amount → minor units, by its digits (CP-8)", () => {
  it("reads whole rupees and up to two decimals exactly", () => {
    expect(parseMinor("250")).toBe(25_000);
    expect(parseMinor("249.5")).toBe(24_950);
    expect(parseMinor("249.50")).toBe(24_950);
    expect(parseMinor("0.01")).toBe(1);
    expect(parseMinor(".5")).toBe(50);
    expect(parseMinor("12.")).toBe(1_200);
    expect(parseMinor("0")).toBe(0);
    expect(parseMinor("007.10")).toBe(710);
  });

  it("never goes through a float: 0.1 + 0.2-style amounts stay exact", () => {
    expect(parseMinor("0.29")).toBe(29);
    expect(parseMinor("1.15")).toBe(115);
    expect(parseMinor("4.35")).toBe(435);
    expect(parseMinor("1234567.89")).toBe(123_456_789);
  });

  it("ignores thousands separators (Indian or Western), spaces and a leading ₹", () => {
    expect(parseMinor("1,200.00")).toBe(120_000);
    expect(parseMinor("1,00,000")).toBe(10_000_000);
    expect(parseMinor(" ₹ 80 ")).toBe(8_000);
  });

  it("refuses what isn't an amount, with a reason", () => {
    expect(parseMoney("")).toEqual({ ok: false, reason: "empty" });
    expect(parseMoney("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseMoney("abc")).toEqual({ ok: false, reason: "invalid" });
    expect(parseMoney("-5")).toEqual({ ok: false, reason: "invalid" });
    expect(parseMoney("1e3")).toEqual({ ok: false, reason: "invalid" });
    expect(parseMoney("1.2.3")).toEqual({ ok: false, reason: "invalid" });
    expect(parseMoney(".")).toEqual({ ok: false, reason: "invalid" });
    expect(parseMoney("1.234")).toEqual({ ok: false, reason: "too_precise" });
    expect(parseMoney("9999999999999")).toEqual({ ok: false, reason: "too_large" });
    expect(parseMoney("1000000000.01")).toEqual({ ok: false, reason: "too_large" });
    expect(parseMoney("1000000000")).toEqual({ ok: true, minor: MAX_MINOR });
  });

  it("says what is wrong in words", () => {
    expect(moneyInputMessage(parseMoney(""))).toBe("Enter the amount");
    expect(moneyInputMessage(parseMoney("x"))).toBe("Enter an amount like 250 or 249.50");
    expect(moneyInputMessage(parseMoney("1.234"))).toBe("Use at most two decimal places");
    expect(moneyInputMessage(parseMoney("9999999999999"))).toBe("That amount is too large");
    expect(moneyInputMessage(parseMoney("1"))).toBeNull();
  });

  it("round-trips through minorToInput", () => {
    for (const minor of [0, 1, 99, 100, 24_950, 123_456_789]) {
      expect(parseMinor(minorToInput(minor))).toBe(minor);
    }
    expect(minorToInput(24_950)).toBe("249.50");
  });
});

describe("percentages in hundredths", () => {
  it("parses 0–100 with at most two decimals", () => {
    expect(parsePercentHundredths("33.33")).toBe(3333);
    expect(parsePercentHundredths("100")).toBe(10_000);
    expect(parsePercentHundredths("12.5%")).toBe(1250);
    expect(parsePercentHundredths("0")).toBe(0);
    expect(parsePercentHundredths("100.01")).toBeNull();
    expect(parsePercentHundredths("33.333")).toBeNull();
    expect(parsePercentHundredths("-1")).toBeNull();
    expect(parsePercentHundredths("")).toBeNull();
    expect(parsePercentHundredths("1000")).toBeNull();
  });

  it("formats them back", () => {
    expect(formatPercentHundredths(10_000)).toBe("100%");
    expect(formatPercentHundredths(9_000)).toBe("90%");
    expect(formatPercentHundredths(3_333)).toBe("33.33%");
    expect(formatPercentHundredths(1_250)).toBe("12.5%");
  });
});

describe("one money formatter: the engine's formatMinor", () => {
  it("is re-exported, not copied", () => {
    expect(formatMinor).toBe(engineFormatMinor);
    expect(formatMinor(4075)).toBe("₹40.75");
    expect(formatMinor(120_000_000)).toBe("₹1,200,000.00");
  });

  it("signs amounts for balances: + gets back, − owes, neither for zero", () => {
    expect(formatSignedMinor(4075)).toBe("+₹40.75");
    expect(formatSignedMinor(-2400)).toBe("−₹24.00");
    expect(formatSignedMinor(0)).toBe("₹0.00");
    expect(formatSignedMinor(500, "USD")).toBe("+$5.00");
  });

  it("gives the amount inputs their prefix", () => {
    expect(currencyPrefix("INR")).toBe("₹");
    expect(currencyPrefix("GBP")).toBe("£");
    expect(currencyPrefix("AED")).toBe("AED");
  });
});

describe("memberLabel: the one place people are named (CP-9 swaps in names)", () => {
  const me = "usr_0f1e2d3c4b5a69788796a5b4c3d2e1f0";
  const dev = "usr_9a8b7c6d5e4f3021120f4e5d6c7b3f9a";

  it("is You for yourself and Member · <last four> for anyone else", () => {
    expect(memberLabel(me, me)).toBe("You");
    expect(memberTag(dev)).toBe("3f9a");
    expect(memberLabel(dev, me)).toBe("Member · 3f9a");
    expect(memberLabel(me, null)).toBe("Member · e1f0");
  });

  it("reads naturally inside a sentence and on an avatar", () => {
    expect(memberLabelInline(me, me)).toBe("you");
    expect(memberLabelInline(dev, me)).toBe("Member · 3f9a");
    expect(memberInitials(me, me)).toBe("You");
    expect(memberInitials(dev, me)).toBe("3F");
  });

  it("sorts you first, then by label, without duplicates", () => {
    const a = "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaa0002";
    const b = "usr_bbbbbbbbbbbbbbbbbbbbbbbbbbbb0001";
    expect(sortMembers([a, me, b, a], me)).toEqual([me, b, a]);
  });
});
