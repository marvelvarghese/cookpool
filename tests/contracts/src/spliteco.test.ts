import {
  SPLITECO_ACTIONS,
  SPLITECO_BUCKETS,
  SPLITECO_CREATE_KINDS,
  SPLITECO_ERROR_REASONS,
  SPLITECO_GROUP_KINDS,
  SPLITECO_PCT_SCALE,
  SPLITECO_PORTION_SCALE,
  SPLITECO_RESTORE_DAYS,
  SPLITECO_SPLIT_METHODS,
  isSplitecoMonth,
  splitecoRestorableUntil,
} from "@saas/contracts/spliteco";

describe("spliteco contracts (cookpool-spliteco SE1)", () => {
  it("pins the six splits, the kinds, the buckets and the actions", () => {
    expect(SPLITECO_SPLIT_METHODS).toEqual(["equal", "exact", "pct", "shares", "adjust", "items"]);
    expect(SPLITECO_GROUP_KINDS).toEqual(["kitchen", "trip", "home", "couple", "other", "direct"]);
    expect(SPLITECO_CREATE_KINDS).not.toContain("direct");
    expect(SPLITECO_BUCKETS).toEqual(["kitchen", "other"]);
    expect(SPLITECO_ACTIONS).toEqual(["spliteco.ledger.read", "spliteco.expense.write"]);
    expect([SPLITECO_PORTION_SCALE, SPLITECO_PCT_SCALE, SPLITECO_RESTORE_DAYS]).toEqual([1000, 10000, 30]);
  });

  it("names the design's refusals", () => {
    expect(SPLITECO_ERROR_REASONS.OWNED_BY_COOKPOOL).toBe("owned_by_cookpool");
    expect(SPLITECO_ERROR_REASONS.NOT_MEMBERS).toBe("not_members");
  });

  it("reads months and the restore deadline", () => {
    expect(isSplitecoMonth("2026-11")).toBe(true);
    expect(isSplitecoMonth("2026-13")).toBe(false);
    expect(splitecoRestorableUntil("2026-11-01T10:00:00.000Z")).toBe("2026-12-01T10:00:00.000Z");
  });
});
