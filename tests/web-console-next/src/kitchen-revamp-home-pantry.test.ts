import { homeMoney } from "@web-console-next/components/kitchen/home";
import {
  SEE_ALL_AFTER,
  balancePill,
  cookNowTag,
  firstThree,
  groupsCookedMeta,
  homeShowsResume,
  resumeMeta,
} from "@web-console-next/components/kitchen/new-home-look";
import { USE_SOON_TILES, sectionRows, useSoonTiles } from "@web-console-next/components/kitchen/pantry-look";
import { PERSONAL_REF } from "./kitchen-pantry-fixtures";

// cookpool-revamp RV-3 (the canvas's HomeRevamp, RvPantry, RvItem): the
// revamped Home, Pantry and Item say less — a signed balance pill, one line
// under each row, three rows then See all, and a Use soon strip of three.

describe("three, then See all", () => {
  it("shows three and offers See all N, or every row and Show less", () => {
    const rows = [1, 2, 3, 4, 5];
    expect(SEE_ALL_AFTER).toBe(3);
    expect(firstThree(rows, false)).toEqual({ rows: [1, 2, 3], more: true, label: "See all 5" });
    expect(firstThree(rows, true)).toEqual({ rows, more: true, label: "Show less" });
  });

  it("offers nothing with three or fewer", () => {
    expect(firstThree([1, 2, 3], false)).toEqual({ rows: [1, 2, 3], more: false, label: "See all 3" });
  });

  it("keeps a section whole while searching, or when the opened row is further down", () => {
    const rows = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(sectionRows(rows, { all: false, searching: false, openId: null }).rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(sectionRows(rows, { all: false, searching: true, openId: null })).toMatchObject({ more: false });
    expect(sectionRows(rows, { all: false, searching: true, openId: null }).rows).toHaveLength(4);
    expect(sectionRows(rows, { all: false, searching: false, openId: "d" }).rows).toHaveLength(4);
    expect(sectionRows(rows, { all: false, searching: false, openId: "b" }).rows).toHaveLength(3);
  });
});

describe("the balance pill", () => {
  const groups = [{ currency: "INR" }] as Parameters<typeof homeMoney>[0]["groups"];
  const total = (netMinor: number) => ({ currency: "INR", netMinor, owedToYouMinor: Math.max(netMinor, 0), youOweMinor: Math.max(-netMinor, 0) });

  it("is +₹ for money back and − for money you owe, named in full", () => {
    expect(balancePill(homeMoney({ groups, totals: [total(6250)] }))).toEqual({
      text: "+₹62.50",
      label: "You get back ₹62.50",
      tone: "owed",
    });
    expect(balancePill(homeMoney({ groups, totals: [total(-2500)] }))).toMatchObject({ text: "−₹25.00", tone: "owe" });
  });

  it("is gone while settled up, in no group, or before it is read", () => {
    expect(balancePill(homeMoney({ groups, totals: [total(0)] }))).toBeNull();
    expect(balancePill(homeMoney({ groups: [], totals: [] }))).toBeNull();
    expect(balancePill(null)).toBeNull();
  });
});

describe("the resume strip", () => {
  it("drops the bar's Cooking · from its second line", () => {
    expect(resumeMeta("Cooking · 12 min · 3 of 7 in")).toBe("12 min · 3 of 7 in");
  });

  it("is Home's, so the floating bar stays off /home only", () => {
    expect(homeShowsResume("/home")).toBe(true);
    expect(homeShowsResume("/home/")).toBe(true);
    expect(homeShowsResume("/pantry")).toBe(false);
    expect(homeShowsResume(null)).toBe(false);
  });
});

describe("Cook now's tag and Your groups cooked", () => {
  const match = (missing: number, missingNames: string[]) => ({ match: { missing, missingNames, lines: 4 } }) as unknown as Parameters<typeof cookNowTag>[0];

  it("says Have all, Need yogurt, or Need 2", () => {
    expect(cookNowTag(match(0, []))).toEqual({ text: "Have all", tone: "have" });
    expect(cookNowTag(match(1, ["Yogurt"]))).toEqual({ text: "Need yogurt", tone: "need" });
    expect(cookNowTag(match(2, ["Yogurt", "Ginger"]))).toEqual({ text: "Need 2", tone: "need" });
  });

  it("puts one line under a dish: who cooked and what you had", () => {
    const card = { groupName: "Flat 4B", when: "3 h ago", each: "₹31.20", youHad: "1½" };
    expect(groupsCookedMeta(card, "Anu")).toBe("Anu · you had 1½ · ₹31.20 each");
    expect(groupsCookedMeta({ ...card, youHad: "₹40.00" }, "Anu")).toBe("Anu · you had ₹40.00");
    expect(groupsCookedMeta({ ...card, youHad: "0" }, "You")).toBe("You · Flat 4B · 3 h ago");
  });
});

describe("the Pantry's Use soon strip", () => {
  const row = (id: string, name: string, days: number | null, status: { soon: boolean; expired: boolean }, canUse = true) => ({
    id,
    href: `/pantry/me:${id}`,
    item: { name, daysToUseBy: days, expiresOn: null, pantry: PERSONAL_REF },
    status: { ...status, low: false },
    canUse,
  });
  const rows = [
    row("itm_a", "Milk", 2, { soon: true, expired: false }),
    row("itm_b", "Greek yogurt", -1, { soon: false, expired: true }),
    row("itm_c", "Paneer", 1, { soon: true, expired: false }),
    row("itm_d", "Tomatoes", 0, { soon: true, expired: false }),
    row("itm_e", "Rice", null, { soon: false, expired: false }),
    row("itm_f", "Curd", 0, { soon: true, expired: false }, false),
  ];

  it("holds three: past its date first, then the soonest, each with one fact", () => {
    const tiles = useSoonTiles(rows, { show: { kind: "all" } });
    expect(USE_SOON_TILES).toBe(3);
    expect(tiles.map((t) => [t.name, t.fact, t.tone])).toEqual([
      ["Greek yogurt", "Expired", "expired"],
      ["Tomatoes", "Today", "soon"],
      ["Paneer", "Tomorrow", "soon"],
    ]);
    expect(tiles[0]!.href).toBe("/pantry/me:itm_b");
  });

  it("shows only on All with no search, and never what you can't use", () => {
    expect(useSoonTiles(rows, { show: { kind: "soon" } })).toEqual([]);
    expect(useSoonTiles(rows, { show: { kind: "all" }, query: "milk" })).toEqual([]);
    expect(useSoonTiles(rows, { show: { kind: "all" } }).map((t) => t.name)).not.toContain("Curd");
  });
});
