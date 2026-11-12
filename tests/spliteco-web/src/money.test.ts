import { balanceTone, formatMoney, formatShort, moneyInput, parseMoney, splitMoney } from "@/lib/money";

describe("money", () => {
  it("formats paise with Indian grouping and a true minus", () => {
    expect(formatMoney(287_000)).toBe("₹2,870.00");
    expect(formatMoney(1_234_567_89)).toBe("₹12,34,567.89");
    expect(formatMoney(-86_000)).toBe("−₹860.00");
    expect(formatMoney(49_000, "INR", { sign: true })).toBe("+₹490.00");
    expect(formatMoney(150_000, "USD")).toBe("$1,500.00");
    expect(formatMoney(5, "JPY")).toBe("JPY 0.05");
  });

  it("drops .00 in the short form only", () => {
    expect(formatShort(360_000)).toBe("₹3,600");
    expect(formatShort(130_717)).toBe("₹1,307.17");
    expect(splitMoney(-292_050)).toEqual({ whole: "₹2,920", fraction: ".50" });
  });

  it("parses what people type", () => {
    expect(parseMoney("18,000")).toBe(1_800_000);
    expect(parseMoney("₹ 1,234.5")).toBe(123_450);
    expect(parseMoney(".5")).toBe(50);
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("-200")).toBeNull();
    expect(parseMoney("-200", { signed: true })).toBe(-20_000);
    expect(parseMoney("+1,200", { signed: true })).toBe(120_000);
    expect(parseMoney("−50", { signed: true })).toBe(-5000);
  });

  it("round-trips through the input text", () => {
    for (const v of [1, 99, 100, 123_450, 1_800_000]) expect(parseMoney(moneyInput(v))).toBe(v);
    expect(moneyInput(0)).toBe("");
    expect(moneyInput(-20_000)).toBe("-200");
  });

  it("names the tone of a balance", () => {
    expect([balanceTone(1), balanceTone(-1), balanceTone(0)]).toEqual(["get", "owe", "even"]);
  });
});
