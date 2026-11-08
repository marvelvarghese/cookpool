import type { KitchenDish } from "@saas/contracts/kitchen";
import {
  COOK_WEEKS,
  cookCount,
  cookCountText,
  cooksAWeek,
  cooksAWeekText,
  cooksText,
  recentCooks,
  sharedGroupsLine,
  weekLabel,
  yourGroupsLine,
} from "@web-console-next/components/kitchen/cooks";
import { personBalance } from "@web-console-next/components/kitchen/money-page";
import { ANU, FLAT, LUNCH, ME, TRIP } from "./kitchen-pantry-fixtures";

// cookpool-recipes RC-2 (design §1.4, the canvas's `Profile`): your page —
// Cooks, Groups, Cooks a week over 8 weeks, your recent cooks — and a
// person's — "In Flat 4B with you", what is between you two, their cooks in
// the groups you share.

const NOW = new Date(2026, 10, 8, 12, 0); // Sunday 8 Nov, noon, in the viewer's calendar
const daysAgo = (n: number, hour = 19) => new Date(2026, 10, 8 - n, hour, 0).toISOString();

function dish(id: string, patch: Partial<KitchenDish> = {}): KitchenDish {
  return {
    id,
    cook: ME,
    orgId: FLAT.orgId,
    name: `Dish ${id}`,
    portionsHalf: 8,
    portions: 4,
    extrasMinor: 0,
    ingredientsMinor: 10000,
    totalMinor: 10000,
    currency: "INR",
    splitMode: "claims",
    state: "finalized",
    txnId: null,
    leftoverItemId: null,
    cookedAt: daysAgo(1),
    finalizedAt: daysAgo(1, 21),
    canceledAt: null,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ingredients: [],
    fromMineMinor: 0,
    owes: [],
    shares: [],
    myClaimHalf: 0,
    claimedHalf: 0,
    unclaimedHalf: 8,
    unclaimedMinor: 0,
    amounts: [],
    netting: [],
    ...patch,
  };
}

const DISHES: KitchenDish[] = [
  dish("today", { cookedAt: daysAgo(0, 9), state: "open", finalizedAt: null }),
  dish("d1"),
  dish("d6", { cookedAt: daysAgo(6), orgId: null }),
  dish("d7", { cookedAt: daysAgo(7) }),
  dish("anu", { cook: ANU, cookedAt: daysAgo(2) }),
  dish("canceled", { cookedAt: daysAgo(3), state: "canceled" }),
  dish("d20", { cookedAt: daysAgo(20), orgId: LUNCH.orgId }),
  dish("d55", { cookedAt: daysAgo(55) }),
  dish("d56", { cookedAt: daysAgo(56) }),
];

describe("your Cooks", () => {
  it("counts the dishes you cooked, not anyone else's and not canceled ones", () => {
    expect(cookCount(DISHES, ME)).toBe(7);
    expect(cookCount(DISHES, ANU)).toBe(1);
    expect(cookCount(DISHES, null)).toBe(0);
  });

  it("says + when the read stopped before your first dish", () => {
    expect(cookCountText(7, true)).toBe("7");
    expect(cookCountText(400, false)).toBe("400+");
  });
});

describe("Cooks a week", () => {
  it("counts your cooks in each of the last 8 weeks, oldest first, this week last", () => {
    const counts = cooksAWeek(DISHES, ME, NOW);
    expect(counts).toHaveLength(COOK_WEEKS);
    // This week (0–6 days ago): today, d1, d6. Last week (7–13): d7. 20 days: 2 weeks ago. 55 days: 7 weeks ago. 56: out.
    expect(counts).toEqual([1, 0, 0, 0, 0, 1, 1, 3]);
  });

  it("is all zeros with nothing cooked, and says it in numbers", () => {
    expect(cooksAWeek([], ME, NOW)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(cooksAWeekText([1, 0, 0, 0, 0, 1, 1, 3])).toBe("3 this week · 6 in 8 weeks");
  });

  it("names each week for its tooltip", () => {
    expect([0, 1, 3].map(weekLabel)).toEqual(["this week", "last week", "3 weeks ago"]);
    expect([cooksText(1), cooksText(0), cooksText(4)]).toEqual(["1 cook", "0 cooks", "4 cooks"]);
  });

  it("counts a dish once, even when it is read twice", () => {
    expect(cooksAWeek([dish("x"), dish("x")], ME, NOW)[7]).toBe(1);
  });
});

describe("recent cooks", () => {
  const groupNames = new Map([
    [FLAT.orgId, FLAT.name],
    [LUNCH.orgId, LUNCH.name],
  ]);

  it("lists yours, newest first, at most five, each opening its dish", () => {
    const rows = recentCooks(DISHES, ME, { groupNames, now: NOW });
    expect(rows.map((r) => [r.dishId, r.where, r.when])).toEqual([
      ["today", "Flat 4B", "today"],
      ["d1", "Flat 4B", "yesterday"],
      ["d6", "Just for you", "2 Nov"],
      ["d7", "Flat 4B", "1 Nov"],
      ["d20", "Lunch club", "19 Oct"],
    ]);
    expect(rows[0]).toMatchObject({ href: "/dishes/today", portions: "4 portions" });
  });

  it("shows only a person's cooks in the groups you share on their page", () => {
    const theirs = [
      dish("flat", { cook: ANU }),
      dish("trip", { cook: ANU, orgId: TRIP.orgId }),
      dish("solo", { cook: ANU, orgId: null }),
      dish("mine"),
    ];
    const rows = recentCooks(theirs, ANU, { groupNames, now: NOW, inGroups: new Set([FLAT.orgId]) });
    expect(rows.map((r) => r.dishId)).toEqual(["flat"]);
  });

  it("is empty for no one", () => {
    expect(recentCooks(DISHES, null, { groupNames, now: NOW })).toEqual([]);
  });
});

describe("the lines under a name", () => {
  it("say which groups you share with a person", () => {
    expect(sharedGroupsLine([FLAT])).toBe("In Flat 4B with you");
    expect(sharedGroupsLine([FLAT, LUNCH])).toBe("In Flat 4B and Lunch club with you");
    expect(sharedGroupsLine([FLAT, LUNCH, TRIP])).toBe("In Flat 4B and 2 more with you");
    expect(sharedGroupsLine([])).toBeNull();
  });

  it("list your groups under yours", () => {
    expect(yourGroupsLine([FLAT])).toBe("Flat 4B");
    expect(yourGroupsLine([FLAT, LUNCH, TRIP])).toBe("Flat 4B · Lunch club +1");
    expect(yourGroupsLine([])).toBeNull();
  });
});

describe("a person's balance strip", () => {
  it("says it in your words, one line per currency with money open", () => {
    expect(personBalance({ totals: [{ currency: "INR", netMinor: 4000 }] }).map((l) => l.text)).toEqual(["You get back ₹40.00"]);
    expect(
      personBalance({
        totals: [
          { currency: "INR", netMinor: 0 },
          { currency: "USD", netMinor: -1200 },
        ],
      }).map((l) => l.text),
    ).toEqual(["You owe $12.00"]);
  });

  it("is Settled up when nothing is open", () => {
    expect(personBalance({ totals: [{ currency: "INR", netMinor: 0 }] }).map((l) => l.text)).toEqual(["Settled up"]);
    expect(personBalance({ totals: [] }).map((l) => [l.currency, l.text])).toEqual([["INR", "Settled up"]]);
  });
});
