import type { SplitecoActivityEntry } from "@saas/contracts/spliteco";
import { activityLine, guessCategory, timeAgo } from "@/lib/activity-text";

const base: SplitecoActivityEntry = {
  txnId: "txn_1",
  expenseId: "txn_1",
  action: "added",
  at: "2026-11-12T10:00:00.000Z",
  actorId: "usr_anu",
  groupId: "org_1",
  groupName: "Goa Trip",
  title: "Beach shack dinner",
  totalMinor: 441_600,
  currency: "INR",
  previousTotalMinor: null,
  otherGroupId: null,
  otherGroupName: null,
  myEffectMinor: -130_717,
  viaDelegation: null,
  viaAssistant: null,
};

describe("activity text", () => {
  it.each([
    [{ action: "added" }, "added “Beach shack dinner” in Goa Trip"],
    [{ action: "edited", previousTotalMinor: 200_000, totalMinor: 240_000 }, "changed “Beach shack dinner” from ₹2,000 to ₹2,400"],
    [{ action: "edited", previousTotalMinor: 441_600 }, "edited “Beach shack dinner” in Goa Trip"],
    [{ action: "deleted" }, "deleted “Beach shack dinner” from Goa Trip"],
    [{ action: "restored" }, "restored “Beach shack dinner” in Goa Trip"],
    [{ action: "moved_in", otherGroupName: "Office lunch" }, "moved “Beach shack dinner” into Goa Trip from Office lunch"],
    [{ action: "moved_out", otherGroupName: "Office lunch" }, "moved “Beach shack dinner” out of Goa Trip into Office lunch"],
    [{ action: "reversed" }, "reversed “Beach shack dinner” in Goa Trip"],
    [{ action: "settled" }, "recorded a payment in Goa Trip"],
  ] as const)("%o", (over, text) => {
    expect(activityLine({ ...base, ...over } as SplitecoActivityEntry, "Anu").text).toBe(text);
  });

  it("puts Cookpool first for its postings", () => {
    const line = activityLine({ ...base, action: "cookpool", title: "Paneer tikka" }, "Zoya");
    expect(line.actor).toBe("Cookpool");
    expect(line.text).toBe("posted “Paneer tikka” in Goa Trip for Zoya");
  });

  it("says what it did to you", () => {
    expect(activityLine(base, "Anu")).toMatchObject({ effect: "You owe ₹1,307.17", tone: "owe" });
    expect(activityLine({ ...base, myEffectMinor: 32_000 }, "Anu")).toMatchObject({ effect: "You get back ₹320.00", tone: "get" });
    expect(activityLine({ ...base, myEffectMinor: 0 }, "Anu")).toMatchObject({ effect: "No change for you", tone: "muted" });
  });

  it("says how long ago", () => {
    const now = new Date("2026-11-12T12:00:00.000Z");
    expect(timeAgo("2026-11-12T11:48:00.000Z", now)).toBe("12 min ago");
    expect(timeAgo("2026-11-12T07:00:00.000Z", now)).toBe("5 h ago");
    expect(timeAgo("2026-11-11T07:00:00.000Z", now)).toBe("yesterday");
    expect(timeAgo("2026-11-12T11:59:30.000Z", now)).toBe("just now");
  });

  it("guesses a category from the title", () => {
    expect(guessCategory("Villa, 3 nights")).toBe("stay");
    expect(guessCategory("Airport cab")).toBe("transport");
    expect(guessCategory("Beach shack dinner")).toBe("food");
    expect(guessCategory("Rent for November")).toBe("bills");
    expect(guessCategory("Movie night")).toBe("entertainment");
    expect(guessCategory("Mystery")).toBeNull();
  });
});
