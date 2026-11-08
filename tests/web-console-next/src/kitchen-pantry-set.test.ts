import type { ReachableItem } from "@saas/contracts/kitchen";
import {
  LADDER_MULTIPLES,
  MAX_DRAFTS,
  canStep,
  draftOf,
  draftStep,
  itemLadder,
  lastLine,
  parseDrafts,
  putDraft,
  setConsumers,
  setCostLine,
  setReason,
  stepFrom,
  stepOf,
  withStep,
} from "@web-console-next/components/kitchen/pantry-set";
import { ANU, DEV, FLAT, ME, MEERA, NAMES, ONION, PERSONAL_REF, makeItem, makeMove, makeUsual as usual, morningUsual as morning } from "./kitchen-pantry-fixtures";

// cookpool-pantry PN-5 (design §1.1, §2.2): the set row — the ladder its
// − and + step through, where it starts (the suggestion and its reason),
// "Changed from …" once moved, Last, the cost for the faces, and the draft
// the device keeps until Use.

const milk = (left = "1", o: Parameters<typeof makeItem>[0] = {}) => makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "1", left, priceMinor: 6800, ...o });
const words = (item: ReachableItem, u = usual(item)) => itemLadder(item, u).steps.map((s) => s.words);

describe("the ladder", () => {
  it("is the tiles in order of amount, whole multiples of the suggestion, then The rest", () => {
    const item = milk();
    // The Use tiles: your usual and ½ glass (a slot is kept for "Count in …"), then The rest.
    expect(words(item)).toEqual(["½ glass", "1 glass", "2 glasses", "3 glasses", "1 L"]);
    const last = itemLadder(item, usual(item)).steps.at(-1)!;
    expect(last).toMatchObject({ key: "rest", rest: true, qtyMilli: 1_000_000 });
  });

  it("steps in the item's own measure when the usual was given in it", () => {
    const item = { ...makeItem({ name: "Onions", unit: "kg", bought: "1", left: "0.9" }), measures: [ONION] };
    const u = usual(item, { lastQtyMilli: 300_000, lastLabel: "2 onions", lastUnit: "g" });
    const ladder = itemLadder(item, u);
    expect(ladder.suggestion).toMatchObject({ reason: "usual", why: "Your usual" });
    expect(ladder.suggestion!.step).toMatchObject({ words: "2 onions", amount: { kind: "measure", quantity: 2 } });
    const onionSteps = ladder.steps.filter((s) => s.amount.kind === "measure").map((s) => s.words);
    // One more onion at a time above the usual (3 onions is 450 g, 6 would be all 900 g: The rest).
    expect(onionSteps).toEqual(["1 onion", "2 onions", "3 onions", "4 onions", "5 onions"]);
    expect(stepFrom(ladder.steps, ladder.suggestion!.step.key, 1)!.words).toBe("3 onions");
    expect(ladder.steps.at(-1)!.words).toBe("900 g");
  });

  it("adds at most LADDER_MULTIPLES multiples, all under what is left", () => {
    const item = makeItem({ name: "Atta", category: "grains", unit: "kg", bought: "5" });
    const ladder = itemLadder(item, usual(item, { lastQtyMilli: 100_000, lastUnit: "g" }));
    const body = ladder.steps.filter((s) => !s.rest).map((s) => s.words);
    // ×2 … ×7 of 100 g; 500 g is the tile's own "½ kg".
    expect(body).toEqual(["100 g", "200 g", "250 g", "300 g", "400 g", "½ kg", "600 g", "700 g"]);
    expect(LADDER_MULTIPLES).toBe(6);
    expect(body).not.toContain("800 g");
  });

  it("is empty with nothing left", () => {
    expect(itemLadder(milk("0"), null)).toEqual({ tiles: [], steps: [], suggestion: null });
  });

  it("takes an amount from the sheet's Other in its place, before The rest", () => {
    const steps = itemLadder(milk(), null).steps;
    const extra = { key: "u:300000", amount: { kind: "unit" as const, qtyMilli: 300_000 }, qtyMilli: 300_000, words: "300 ml", rest: false };
    const out = withStep(steps, extra).map((s) => s.words);
    expect(out.indexOf("300 ml")).toBe(out.indexOf("1 glass") + 1);
    expect(out.at(-1)).toBe("1 L");
    expect(withStep(steps, { ...extra, key: "u:250000", qtyMilli: 250_000 })).toHaveLength(steps.length);
  });
});

describe("the suggestion it starts at (design §2.2)", () => {
  it("is the bucket's usual, with the bucket's people", () => {
    const item = milk();
    const ladder = itemLadder(item, usual(item, { lastQtyMilli: 500_000, now: morning(250_000, 3, [ME, ANU]) }));
    expect(ladder.suggestion).toMatchObject({ reason: "usual_now", why: "Morning usual", consumerIds: [ME, ANU] });
    expect(ladder.suggestion!.step.words).toBe("1 glass");
  });

  it("is the rest when little is left, saying how many pieces", () => {
    const item = milk("0.3");
    expect(itemLadder(item, usual(item)).suggestion).toMatchObject({ reason: "rest", why: "The rest" });
    expect(itemLadder(item, usual(item)).suggestion!.step).toMatchObject({ rest: true, words: "300 ml" });
    const bananas = makeItem({ name: "Bananas", category: "fruit", unit: "pcs", bought: "6", left: "2" });
    expect(itemLadder(bananas, usual(bananas, { lastQtyMilli: 2_000, lastUnit: "pcs" })).suggestion).toMatchObject({ reason: "rest", why: "The rest · only 2 left" });
  });

  it("is the first step to use soon without a usual, and the first step with no reason otherwise", () => {
    expect(itemLadder(milk("1", { daysToUseBy: 1 }), null).suggestion).toMatchObject({ reason: "use_soon", why: "Use soon", consumerIds: null });
    const plain = itemLadder(milk(), null).suggestion!;
    expect(plain).toMatchObject({ reason: "first", why: null });
    expect(plain.step.words).toBe("1 glass");
  });

  it("is never more than what is left", () => {
    for (const left of ["0.01", "0.2", "0.4", "0.9"]) {
      const item = milk(left);
      const s = itemLadder(item, usual(item, { lastQtyMilli: 500_000 })).suggestion!;
      expect(s.step.qtyMilli).toBeLessThanOrEqual(item.qtyLeftMilli);
    }
  });
});

describe("− [amount] +", () => {
  const item = milk();
  const ladder = itemLadder(item, usual(item, { now: morning(250_000, 3) }));
  const start = ladder.suggestion!.step;

  it("steps up and down the ladder and stops at either end", () => {
    expect(stepFrom(ladder.steps, start.key, 1)!.words).toBe("2 glasses");
    expect(stepFrom(ladder.steps, start.key, -1)!.words).toBe("½ glass");
    expect(canStep(ladder.steps, "rest", 1)).toBe(false);
    expect(stepFrom(ladder.steps, "rest", 1)!.key).toBe("rest");
    expect(canStep(ladder.steps, ladder.steps[0]!.key, -1)).toBe(false);
    expect(canStep(ladder.steps, start.key, -1)).toBe(true);
    expect(stepOf(ladder.steps, "nope")).toBeNull();
  });

  it("says the reason at the suggestion and 'Changed from …' once moved", () => {
    expect(setReason(start, ladder.suggestion)).toBe("Morning usual");
    expect(setReason(stepFrom(ladder.steps, start.key, 1)!, ladder.suggestion)).toBe("Changed from 1 glass");
    expect(setReason(start, null)).toBeNull();
  });
});

describe("Last, the faces and the cost", () => {
  const now = new Date(2026, 10, 8, 12, 0);
  const at = new Date(2026, 10, 8, 8, 10).toISOString();
  const item = milk();

  it("reads the item's latest use still in effect, with who had it", () => {
    const moves = [
      makeMove({ kind: "use", qtyMilli: 500_000, unit: "ml", at: new Date(2026, 10, 8, 9, 0).toISOString(), undone: true }),
      makeMove({ kind: "use", qtyMilli: 250_000, unit: "ml", at, consumers: [ANU, ME] }),
      makeMove({ kind: "waste", qtyMilli: 100_000, at: new Date(2026, 10, 7, 9, 0).toISOString() }),
    ];
    expect(lastLine({ moves, usual: null, item, meId: ME, names: NAMES, now })).toBe("Last: 1 glass · today, 8:10 am · you and Anu");
    // A stock check's use (PN-4) isn't a time someone had it.
    const check = makeMove({ kind: "use", qtyMilli: 100_000, unit: "ml", at: new Date(2026, 10, 8, 11, 0).toISOString(), consumers: [ME, ANU, DEV], via: "check" });
    expect(lastLine({ moves: [check, ...moves], usual: null, item, meId: ME, names: NAMES, now })).toBe("Last: 1 glass · today, 8:10 am · you and Anu");
  });

  it("falls back to the food's last use (an earlier pack), and names nobody in your own pantry", () => {
    const u = usual(item, { lastLabel: null, lastQtyMilli: 250_000, lastUsedAt: new Date(2026, 10, 7, 7, 40).toISOString(), consumers: [DEV] });
    expect(lastLine({ moves: [], usual: u, item, meId: ME, names: NAMES, now })).toBe("Last: 1 glass · yesterday, 7:40 am · Dev");
    const own = milk("1", { pantry: PERSONAL_REF });
    expect(lastLine({ moves: [makeMove({ kind: "use", qtyMilli: 250_000, unit: "ml", at, consumers: null })], usual: null, item: own, meId: ME, now })).toBe(
      "Last: 1 glass · today, 8:10 am",
    );
    expect(lastLine({ moves: [], usual: null, item, meId: ME, now })).toBeNull();
  });

  it("starts with the draft's people, else the suggestion's, else you — only members still in the group", () => {
    const ladder = itemLadder(item, usual(item, { consumers: [ME, ANU, DEV] }));
    expect(setConsumers({ item, draft: null, suggestion: ladder.suggestion, roster: null, meId: ME })).toEqual([ME, ANU, DEV]);
    expect(setConsumers({ item, draft: null, suggestion: ladder.suggestion, roster: [ME, ANU], meId: ME })).toEqual([ME, ANU]);
    expect(setConsumers({ item, draft: [DEV], suggestion: ladder.suggestion, roster: null, meId: ME })).toEqual([DEV]);
    expect(setConsumers({ item, draft: null, suggestion: null, roster: null, meId: ME })).toEqual([ME]);
    expect(setConsumers({ item: milk("1", { pantry: PERSONAL_REF }), draft: null, suggestion: ladder.suggestion, roster: null, meId: ME })).toEqual([]);
  });

  it("costs the amount by the engine, with what each pays", () => {
    expect(setCostLine(item, 250_000, [ME])).toBe("₹17.00");
    expect(setCostLine(item, 250_000, [ME, ANU])).toBe("₹17.00 · ₹8.50 each");
    expect(setCostLine(item, 250_000, [ME, ANU, DEV])).toBe("₹17.00 · ≈ ₹5.67 each");
    // The buyer didn't have any: still two shares, not three.
    const meeras = milk("1", { paidBy: MEERA });
    expect(setCostLine(meeras, 250_000, [ME, ANU])).toBe("₹17.00 · ₹8.50 each");
    expect(setCostLine(milk("1", { pantry: PERSONAL_REF }), 250_000, [ME, ANU])).toBe("₹17.00");
  });
});

describe("the draft kept on the device until Use", () => {
  const item = milk();
  const ladder = itemLadder(item, usual(item));
  const two = stepFrom(ladder.steps, ladder.suggestion!.step.key, 1)!;
  const at = new Date("2026-11-08T08:00:00.000Z");

  it("comes back as the same step, and as its amount when the ladder no longer has it", () => {
    const d = draftOf(two, [ME, ANU], at);
    expect(d).toEqual({ key: two.key, qtyMilli: 500_000, words: "2 glasses", measure: null, consumers: [ME, ANU], at: at.toISOString() });
    expect(draftStep(ladder.steps, d, item)).toBe(two);
    const other = { ...d, key: "u:300000", qtyMilli: 300_000, words: "300 ml" };
    expect(draftStep(ladder.steps, other, item)).toMatchObject({ key: "u:300000", words: "300 ml" });
    expect(draftStep(itemLadder(milk("0.2"), null).steps, other, milk("0.2"))).toBeNull();
    expect(draftStep(ladder.steps, null, item)).toBeNull();
  });

  it("keeps a measure's count, taking what it takes now", () => {
    const onions = { ...makeItem({ name: "Onions", unit: "kg", bought: "1" }), measures: [ONION] };
    const d = { key: "m:onion:3", qtyMilli: 450_000, words: "3 onions", measure: { one: "onion", quantity: 3 }, consumers: null, at: at.toISOString() };
    expect(draftStep([], d, onions)).toMatchObject({ words: "3 onions", qtyMilli: 450_000, amount: { kind: "measure" } });
  });

  it("reads only well-formed drafts, and keeps the newest MAX_DRAFTS", () => {
    const d = draftOf(two, null, at);
    expect(parseDrafts(JSON.stringify({ itm_1: d, itm_2: { key: 1 }, bad: d }))).toEqual({ itm_1: d });
    expect(parseDrafts("not json")).toEqual({});
    expect(parseDrafts(null)).toEqual({});
    let all = {};
    for (let i = 0; i < MAX_DRAFTS + 3; i++) all = putDraft(all, `itm_${i}`, draftOf(two, null, new Date(at.getTime() + i * 1000)));
    expect(Object.keys(all)).toHaveLength(MAX_DRAFTS);
    expect(Object.keys(all)).not.toContain("itm_0");
    expect(Object.keys(putDraft(all, `itm_${MAX_DRAFTS + 2}`, null))).toHaveLength(MAX_DRAFTS - 1);
  });
});

// FLAT is the fixtures' default group: every item above is in it unless personal.
void FLAT;
