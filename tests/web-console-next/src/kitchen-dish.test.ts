// The dish page's view-model (Cookpool CP-17): the cost card, who had some,
// the claims summary and its over/under states, the leftovers, the netting
// sections, and the words for claims — against design.md §3's worked example,
// whose numbers the engine's preview must reproduce exactly.

import type { KitchenDish, KitchenDishIngredient, KitchenDishShare } from "@saas/contracts/kitchen";
import { formatMinor } from "@saas/kitchen-engine/money";
import {
  CLAIM_CHOICES,
  claimChoiceLabel,
  claimCount,
  claimOwedMinor,
  claimRefusal,
  claimText,
  claimableHalf,
  claimedToast,
  dishHref,
  dishRow,
  dishStateChip,
  dishSubtitle,
  dishWhen,
  finalizedToast,
  halfText,
  ingredientLines,
  ingredientsSummary,
  leftoverNote,
  moneyFlow,
  parseDishRef,
  perPortion,
  perPortionText,
  portionsText,
  previewSplit,
  sameShares,
  shareRequests,
  sharesOf,
  splitFor,
  splitOfDish,
  splitRefusal,
  whoHadSome,
  withHalf,
} from "@web-console-next/components/kitchen/dish";
import { ANU, DEV, FLAT, KIRAN, LUNCH, ME, MEERA } from "./kitchen-pantry-fixtures";

const VEENA = "usr_0000000000000000000000000000e3e3";
const NAMES = new Map<string, string>([
  [ME, "Rahul"],
  [ANU, "Anu"],
  [DEV, "Dev"],
  [MEERA, "Meera"],
  [KIRAN, "Kiran"],
  [VEENA, "Veena"],
]);
const MY_GROUPS = new Map([
  [FLAT.orgId, FLAT.name],
  [LUNCH.orgId, LUNCH.name],
]);
const DISH_ID = "dsh_000000000000000000000000000000d1";
const AT = "2026-11-02T14:40:00.000Z";

function ingredient(
  n: number,
  name: string,
  orgId: string | null,
  paidBy: string,
  qtyMilli: number,
  unit: string,
  quantity: number,
  costMinor: number,
): KitchenDishIngredient {
  return {
    itemId: `itm_${String(n).padStart(32, "0")}`,
    name,
    orgId,
    paidBy,
    qtyMilli,
    quantity,
    unit,
    costMinor,
    useTxnId: orgId && paidBy !== ME ? `txn_take_${orgId.slice(-4)}` : null,
  };
}

function share(subjectId: string, portionsHalf: number, source: "self" | "cook" = "self"): KitchenDishShare {
  return { id: `dsr_${subjectId.slice(-4)}`, subjectId, portionsHalf, exactMinor: null, source, createdAt: AT, updatedAt: AT };
}

/**
 * design.md §3: Rahul's paneer butter masala with rotis, shared with Flat 4B.
 * His own paneer, butter and cream; Anu's tomatoes and Dev's onions from
 * Flat 4B; Kiran's chapati flour from the Lunch club; ₹15.00 of extras.
 * ₹211.00 for 4 portions. Claims: Rahul 1½, Anu 1, Dev 1, Meera ½. The
 * amounts and netting are the design's numbers, as the API answers them.
 */
function paneer(patch: Partial<KitchenDish> = {}): KitchenDish {
  return {
    id: DISH_ID,
    cook: ME,
    orgId: FLAT.orgId,
    name: "Paneer butter masala with rotis",
    portionsHalf: 8,
    portions: 4,
    extrasMinor: 1500,
    ingredientsMinor: 19600,
    totalMinor: 21100,
    currency: "INR",
    splitMode: "claims",
    state: "open",
    txnId: null,
    leftoverItemId: null,
    cookedAt: AT,
    finalizedAt: null,
    canceledAt: null,
    createdAt: AT,
    updatedAt: AT,
    ingredients: [
      ingredient(1, "Paneer", null, ME, 200_000, "g", 200, 9500),
      ingredient(2, "Butter", null, ME, 50_000, "g", 50, 2800),
      ingredient(3, "Fresh cream", null, ME, 100_000, "ml", 100, 3000),
      ingredient(4, "Tomatoes", FLAT.orgId, ANU, 300_000, "g", 300, 1200),
      ingredient(5, "Onions", FLAT.orgId, DEV, 200_000, "g", 200, 700),
      ingredient(6, "Chapati flour", LUNCH.orgId, KIRAN, 500_000, "kg", 0.5, 2400),
    ],
    fromMineMinor: 15300,
    owes: [
      { orgId: FLAT.orgId, buyerId: ANU, amountMinor: 1200 },
      { orgId: FLAT.orgId, buyerId: DEV, amountMinor: 700 },
      { orgId: LUNCH.orgId, buyerId: KIRAN, amountMinor: 2400 },
    ],
    shares: [share(ME, 3), share(ANU, 2), share(DEV, 2), share(MEERA, 1)],
    myClaimHalf: 3,
    claimedHalf: 8,
    unclaimedHalf: 0,
    unclaimedMinor: 0,
    amounts: [
      { subjectId: ME, portionsHalf: 3, exactMinor: null, owedMinor: 7913 },
      { subjectId: ANU, portionsHalf: 2, exactMinor: null, owedMinor: 5275 },
      { subjectId: DEV, portionsHalf: 2, exactMinor: null, owedMinor: 5275 },
      { subjectId: MEERA, portionsHalf: 1, exactMinor: null, owedMinor: 2637 },
    ],
    netting: [
      { subjectId: ANU, owesCookMinor: 5275, cookOwesMinor: 1200, netMinor: 4075 },
      { subjectId: DEV, owesCookMinor: 5275, cookOwesMinor: 700, netMinor: 4575 },
      { subjectId: MEERA, owesCookMinor: 2637, cookOwesMinor: 0, netMinor: 2637 },
    ],
    ...patch,
  };
}

/** A dish whose split fields are the engine's over its shares (the server reads them the same way). */
function withApiSplit(dish: KitchenDish, viewer: string = ME): KitchenDish {
  const split = previewSplit(dish, sharesOf(dish));
  return {
    ...dish,
    claimedHalf: split.claimedHalf,
    unclaimedHalf: split.unclaimedHalf,
    unclaimedMinor: split.unclaimedMinor,
    amounts: split.amounts,
    netting: split.netting,
    myClaimHalf: dish.shares.find((s) => s.subjectId === viewer)?.portionsHalf ?? 0,
  };
}

/** The canvas's Home card: Meera's egg fried rice in Flat 4B, ₹156.00 for 5 portions (₹31.20 each), Anu has claimed 1. */
function eggRice(viewer: string = ME, patch: Partial<KitchenDish> = {}): KitchenDish {
  return withApiSplit(
    paneer({
      id: "dsh_000000000000000000000000000000e2",
      cook: MEERA,
      name: "Egg fried rice",
      portionsHalf: 10,
      portions: 5,
      extrasMinor: 0,
      ingredientsMinor: 15600,
      totalMinor: 15600,
      ingredients: [ingredient(7, "Rice", null, MEERA, 500_000, "g", 500, 15600)],
      fromMineMinor: 15600,
      owes: [],
      shares: [share(ANU, 2)],
      ...patch,
    }),
    viewer,
  );
}

const people = (meId: string | null = ME) => ({ meId, names: NAMES, groupNames: MY_GROUPS });

describe("the address", () => {
  it("is the plain dsh_ id the dish-posted email links to", () => {
    expect(parseDishRef(DISH_ID)).toBe(DISH_ID);
    expect(parseDishRef(encodeURIComponent(DISH_ID))).toBe(DISH_ID);
    expect(dishHref(DISH_ID)).toBe(`/dishes/${DISH_ID}`);
    expect(parseDishRef(dishHref(DISH_ID).split("/").pop())).toBe(DISH_ID);
  });

  it("names no dish for anything else", () => {
    for (const bad of [null, undefined, "", "itm_000000000000000000000000000000d1", "dsh_", "dsh_a/b", "%E0%A4%A"]) {
      expect(parseDishRef(bad)).toBeNull();
    }
  });
});

describe("portions", () => {
  it("are counted in halves and read as ½, 1, 1½", () => {
    expect([0, 1, 2, 3, 4, 7].map(halfText)).toEqual(["0", "½", "1", "1½", "2", "3½"]);
    expect([1, 2, 3, 8].map(portionsText)).toEqual(["½ portion", "1 portion", "1½ portions", "4 portions"]);
  });

  it("offers None · ½ · 1 · 1½ · 2 to claim", () => {
    expect(CLAIM_CHOICES.map(claimChoiceLabel)).toEqual(["None", "½", "1", "1½", "2"]);
  });

  it("costs the total over the portions each, marked ≈ when it does not divide evenly", () => {
    expect(perPortion(paneer())).toEqual({ minor: 5275, exact: true });
    expect(perPortionText(paneer())).toBe("₹52.75");
    expect(perPortionText(eggRice())).toBe("₹31.20");
    const thirds = paneer({ totalMinor: 10000, portionsHalf: 6 });
    expect(perPortion(thirds)).toEqual({ minor: 3333, exact: false });
    expect(perPortionText(thirds)).toBe("≈ ₹33.33");
    expect(perPortionText(paneer({ totalMinor: 1000, portionsHalf: 1 }))).toBe("₹20.00");
  });
});

describe("the header and the cost card", () => {
  const now = new Date(2026, 10, 2, 21, 0);
  const at = (d: Date) => d.toISOString();

  it("says who cooked it, who it is shared with, and when", () => {
    const dish = paneer({ cookedAt: at(new Date(2026, 10, 2, 20, 10)) });
    expect(dishSubtitle(dish, { ...people(), now })).toBe("You cooked · shared with Flat 4B · today, 8:10 pm");
    expect(dishSubtitle(dish, { ...people(ANU), now })).toBe("Rahul cooked · shared with Flat 4B · today, 8:10 pm");
    expect(dishSubtitle(paneer({ orgId: null, cookedAt: dish.cookedAt }), { ...people(), now })).toBe("You cooked · just for you · today, 8:10 pm");
  });

  it("reads when in the viewer's calendar", () => {
    expect(dishWhen(at(new Date(2026, 10, 1, 13, 5)), now)).toBe("yesterday, 1:05 pm");
    expect(dishWhen(at(new Date(2026, 9, 28, 19, 30)), now)).toBe("28 Oct, 7:30 pm");
    expect(dishWhen(at(new Date(2025, 9, 28, 19, 30)), now)).toBe("28 Oct 2025, 7:30 pm");
    expect(dishWhen("not a date", now)).toBe("");
  });

  it("chips the state: Open for claims, Not split yet, Finalized, Canceled", () => {
    expect(dishStateChip(paneer())).toEqual({ label: "Open for claims", tone: "open" });
    expect(dishStateChip(paneer({ state: "draft", splitMode: "assign" }))).toEqual({ label: "Not split yet", tone: "open" });
    expect(dishStateChip(paneer({ state: "draft", orgId: null }))).toEqual({ label: "Not finalized", tone: "open" });
    expect(dishStateChip(paneer({ state: "finalized" }))).toEqual({ label: "Finalized", tone: "ready" });
    expect(dishStateChip(paneer({ state: "canceled" }))).toEqual({ label: "Canceled", tone: "muted" });
  });

  it("sums the ingredients by pantry and the extras", () => {
    expect(ingredientsSummary(paneer())).toBe("6 ingredients from 3 pantries + ₹15.00 extras");
    expect(ingredientsSummary(eggRice())).toBe("1 ingredient from 1 pantry");
  });

  it("lists each ingredient with its pantry and buyer, in a friendly unit", () => {
    expect(ingredientLines(paneer(), people()).map((l) => `${l.name} ${l.qty} · ${l.where} ${formatMinor(l.amountMinor)}`)).toEqual([
      "Paneer 200 g · your pantry ₹95.00",
      "Butter 50 g · your pantry ₹28.00",
      "Fresh cream 100 ml · your pantry ₹30.00",
      "Tomatoes 300 g · Flat 4B, Anu paid ₹12.00",
      "Onions 200 g · Flat 4B, Dev paid ₹7.00",
      "Chapati flour 500 g · Lunch club, Kiran paid ₹24.00",
    ]);
  });

  it("names the cook's pantry, your own purchases and groups you are not in, for a member", () => {
    const lines = ingredientLines(paneer(), { meId: ANU, names: NAMES, groupNames: new Map([[FLAT.orgId, FLAT.name]]) });
    expect(lines.map((l) => l.where)).toEqual([
      "Rahul's pantry",
      "Rahul's pantry",
      "Rahul's pantry",
      "Flat 4B, you paid",
      "Flat 4B, Dev paid",
      "another group, Kiran paid",
    ]);
  });

  it("never shows a raw id: someone without a name is 'Member · tag'", () => {
    const lines = ingredientLines(paneer(), { meId: ANU, names: new Map(), groupNames: null });
    expect(lines[0]!.where).toBe("Member · 00aa's pantry");
    expect(lines.map((l) => l.where).join(" ")).not.toMatch(/usr_|org_/);
  });
});

describe("the split: the engine's preview reproduces the API", () => {
  it("is design §3's worked example to the paisa (the odd paisa is Rahul's)", () => {
    const dish = paneer();
    const split = previewSplit(dish, sharesOf(dish));
    expect(split.amounts).toEqual(dish.amounts);
    expect(split.netting).toEqual(dish.netting);
    expect(split).toMatchObject({ claimedHalf: 8, unclaimedHalf: 0, unclaimedMinor: 0, over: false });
    expect(split.amounts.reduce((s, a) => s + a.owedMinor, 0)).toBe(21100);
  });

  it("uses the API's numbers while the shares on screen are the dish's own", () => {
    const dish = paneer({ amounts: [{ subjectId: ME, portionsHalf: 3, exactMinor: null, owedMinor: 1 }] });
    expect(splitFor(dish, sharesOf(dish)).amounts).toEqual(dish.amounts);
    expect(splitFor(dish, withHalf(sharesOf(dish), DEV, 1)).amounts).not.toEqual(dish.amounts);
    expect(splitOfDish(dish).over).toBe(false);
  });

  it("gives the unclaimed portions to the cook, and prices them as the leftovers", () => {
    // Rahul 1, Anu 1: 2 portions nobody had.
    const dish = paneer({ shares: [share(ME, 2), share(ANU, 2)] });
    const split = previewSplit(dish, sharesOf(dish));
    expect(split.amounts.map((a) => [a.subjectId, a.owedMinor])).toEqual([
      [ME, 15825],
      [ANU, 5275],
    ]);
    expect(split).toMatchObject({ claimedHalf: 4, unclaimedHalf: 4, unclaimedMinor: 10550 });
    // Anu still nets her tomatoes; Dev ate nothing but is owed for his onions.
    expect(split.netting).toEqual([
      { subjectId: ANU, owesCookMinor: 5275, cookOwesMinor: 1200, netMinor: 4075 },
      { subjectId: DEV, owesCookMinor: 0, cookOwesMinor: 700, netMinor: -700 },
    ]);
  });

  it("puts an unclaiming cook's share after the eaters, as the server does", () => {
    const rice = eggRice();
    expect(rice.amounts.map((a) => [a.subjectId, a.owedMinor])).toEqual([
      [MEERA, 12480],
      [ANU, 3120],
    ]);
    expect(rice.unclaimedMinor).toBe(12480);
  });

  it("flags more portions set than were cooked, and splits nothing", () => {
    const dish = paneer();
    const over = previewSplit(dish, withHalf(sharesOf(dish), VEENA, 2));
    expect(over).toMatchObject({ over: true, claimedHalf: 10, amounts: [], netting: [] });
  });

  it("edits shares in place, adds a new one at the end, and drops one set to none", () => {
    const shares = sharesOf(paneer());
    expect(withHalf(shares, DEV, 4).map((s) => [s.subjectId, s.portionsHalf])).toEqual([
      [ME, 3],
      [ANU, 2],
      [DEV, 4],
      [MEERA, 1],
    ]);
    expect(withHalf(shares, VEENA, 1).map((s) => s.subjectId)).toEqual([ME, ANU, DEV, MEERA, VEENA]);
    expect(withHalf(shares, ANU, 0).map((s) => s.subjectId)).toEqual([ME, DEV, MEERA]);
    expect(withHalf(shares, VEENA, 0)).toEqual(shares);
  });

  it("sends everyone with a share, and compares shares whatever their order", () => {
    const shares = [...sharesOf(paneer()), { subjectId: VEENA, portionsHalf: 0, exactMinor: null }, { subjectId: KIRAN, portionsHalf: null, exactMinor: 500 }];
    expect(shareRequests(shares)).toEqual([
      { subjectId: ME, portionsHalf: 3 },
      { subjectId: ANU, portionsHalf: 2 },
      { subjectId: DEV, portionsHalf: 2 },
      { subjectId: MEERA, portionsHalf: 1 },
      { subjectId: KIRAN, exactMinor: 500 },
    ]);
    expect(sameShares(sharesOf(paneer()), [...sharesOf(paneer())].reverse())).toBe(true);
    expect(sameShares(sharesOf(paneer()), withHalf(sharesOf(paneer()), DEV, 3))).toBe(false);
    expect(sameShares(sharesOf(paneer()), [...sharesOf(paneer()), { subjectId: VEENA, portionsHalf: 0, exactMinor: null }])).toBe(true);
  });
});

describe("who had some", () => {
  it("lists the cook first, then the claims, then whoever has not claimed", () => {
    const dish = paneer();
    const rows = whoHadSome({ dish, shares: sharesOf(dish), split: splitOfDish(dish), others: [ME, ANU, DEV, VEENA, MEERA], ...people() });
    expect(rows.map((r) => [r.label, halfText(r.half), r.note])).toEqual([
      ["You", "1½", "You claimed this · ₹79.13 (your share)"],
      ["Anu", "1", "Claimed it · ₹52.75"],
      ["Dev", "1", "Claimed it · ₹52.75"],
      ["Meera", "½", "Claimed it · ₹26.37"],
      ["Veena", "0", "Hasn't claimed"],
    ]);
    expect(rows[0]).toMatchObject({ isMe: true, isCook: true });
  });

  it("says who set a share the cook assigned", () => {
    const dish = paneer({ shares: [share(ME, 3, "cook"), share(ANU, 2), share(DEV, 2, "cook"), share(MEERA, 1)] });
    const mine = whoHadSome({ dish, shares: sharesOf(dish), split: splitOfDish(dish), ...people() });
    expect(mine.map((r) => r.note.split(" · ")[0])).toEqual(["You set this", "Claimed it", "You set this", "Claimed it"]);
    const anus = whoHadSome({ dish, shares: sharesOf(dish), split: splitOfDish(dish), ...people(ANU) });
    expect(anus.map((r) => r.note)).toEqual([
      "Rahul set this · ₹79.13",
      "You claimed this · ₹52.75 (your share)",
      "Rahul set this · ₹52.75",
      "Claimed it · ₹26.37",
    ]);
  });

  it("shows the cook's own part without the leftovers", () => {
    const dish = withApiSplit(paneer({ shares: [share(ME, 2), share(ANU, 2)] }));
    const rows = whoHadSome({ dish, shares: sharesOf(dish), split: splitOfDish(dish), ...people() });
    expect(rows[0]).toMatchObject({ half: 2, amountMinor: 5275, note: "You claimed this · ₹52.75 (your share)" });
  });

  it("marks the cook's unsaved changes while editing", () => {
    const dish = paneer({ state: "draft", splitMode: "assign" });
    const shares = withHalf(withHalf(sharesOf(dish), DEV, 1), MEERA, 2);
    const rows = whoHadSome({ dish, shares, split: previewSplit(dish, shares), others: [VEENA], editing: true, ...people() });
    expect(rows.map((r) => r.note)).toEqual([
      "You claimed this · ₹79.13 (your share)",
      "Claimed it · ₹52.75",
      "Not saved yet · ₹26.37",
      "Not saved yet · ₹52.75",
      "Not set",
    ]);
  });

  it("lists only who had some once it is finalized", () => {
    const dish = paneer({ state: "finalized" });
    const rows = whoHadSome({ dish, shares: sharesOf(dish), split: splitOfDish(dish), others: [VEENA], ...people() });
    expect(rows.map((r) => r.label)).toEqual(["You", "Anu", "Dev", "Meera"]);
    // Correcting it can count in someone who had none.
    const correcting = whoHadSome({ dish, shares: sharesOf(dish), split: splitOfDish(dish), others: [VEENA], editing: true, ...people() });
    expect(correcting.map((r) => [r.label, r.note])).toContainEqual(["Veena", "Had none"]);
    const noCookShare = withApiSplit(paneer({ state: "finalized", shares: [share(ANU, 2)] }));
    expect(whoHadSome({ dish: noCookShare, shares: sharesOf(noCookShare), split: splitOfDish(noCookShare), ...people() })[0]!.note).toBe("Had none");
    // A canceled dish owes nothing: who had claimed shows, without amounts.
    const canceled = paneer({ state: "canceled", amounts: [], netting: [] });
    expect(whoHadSome({ dish: canceled, shares: sharesOf(canceled), split: splitOfDish(canceled), ...people() }).map((r) => r.note)).toEqual([
      "You claimed this",
      "Claimed it",
      "Claimed it",
      "Claimed it",
    ]);
  });
});

describe("the claims summary: exact, under, over", () => {
  it("is green when every portion is had", () => {
    const dish = paneer();
    expect(claimCount(dish, splitOfDish(dish))).toEqual({ text: "4 of 4 claimed", tone: "exact" });
  });

  it("counts what is claimed so far when under", () => {
    const rice = eggRice();
    expect(claimCount(rice, splitOfDish(rice))).toEqual({ text: "1 of 5 claimed", tone: "under" });
    const assigned = paneer({ splitMode: "assign", state: "draft" });
    const split = previewSplit(assigned, withHalf(sharesOf(assigned), MEERA, 0));
    expect(claimCount(assigned, split)).toEqual({ text: "3½ of 4 set", tone: "under" });
  });

  it("is a red alert when more are set than were cooked", () => {
    const dish = paneer();
    const split = previewSplit(dish, withHalf(sharesOf(dish), VEENA, 2));
    expect(claimCount(dish, split)).toEqual({ text: "5 of 4 claimed", tone: "over" });
    expect(leftoverNote({ dish, split, ...people() })).toBeNull();
    // Nothing is split while it is over; the cook's own debt in another group still shows.
    const flow = moneyFlow({ dish, split, ...people() });
    expect(flow.eaten).toEqual([]);
    expect(flow.eatenEmpty).toBe("More portions are set than were cooked, so it can't be split yet.");
    expect(flow.netted.map((l) => l.text)).toEqual(["You → Kiran · Lunch club"]);
  });
});

describe("leftovers", () => {
  const under = () => withApiSplit(paneer({ shares: [share(ME, 2), share(ANU, 2)] }));

  it("tells the cook what stays with them, and at what price", () => {
    const dish = under();
    expect(leftoverNote({ dish, split: splitOfDish(dish), ...people() })).toBe(
      "2 portions unclaimed. When you finalize, they stay with you as Leftovers in your pantry: ₹105.50, at ₹52.75 a portion.",
    );
    const finalized = { ...dish, state: "finalized" as const };
    expect(leftoverNote({ dish: finalized, split: splitOfDish(finalized), ...people() })).toBe(
      "2 portions nobody had are Leftovers in your pantry: ₹105.50, at ₹52.75 a portion.",
    );
    const half = withApiSplit(paneer({ shares: [share(ME, 3), share(ANU, 2), share(DEV, 2)] }));
    expect(leftoverNote({ dish: half, split: splitOfDish(half), ...people() })).toBe(
      "½ portion unclaimed. When you finalize, it stays with you as Leftovers in your pantry: ₹26.37, at ₹52.75 a portion.",
    );
  });

  it("tells a member they stay with the cook", () => {
    const dish = under();
    expect(leftoverNote({ dish, split: splitOfDish(dish), ...people(ANU) })).toBe(
      "2 portions unclaimed so far. Whatever nobody claims stays with Rahul as leftovers.",
    );
    const finalized = { ...dish, state: "finalized" as const };
    expect(leftoverNote({ dish: finalized, split: splitOfDish(finalized), ...people(ANU) })).toBe("Rahul kept 2 portions as leftovers.");
  });

  it("are none when everything was had, for a dish just for its cook, or once canceled", () => {
    const dish = paneer();
    expect(leftoverNote({ dish, split: splitOfDish(dish), ...people() })).toBeNull();
    const mine = withApiSplit(paneer({ orgId: null, shares: [], splitMode: "assign", state: "draft" }));
    expect(mine.unclaimedHalf).toBe(8);
    expect(leftoverNote({ dish: mine, split: splitOfDish(mine), ...people() })).toBeNull();
    const canceled = { ...under(), state: "canceled" as const };
    expect(leftoverNote({ dish: canceled, split: splitOfDish(canceled), ...people() })).toBeNull();
  });
});

describe("claim labels", () => {
  it("says what a member's portion costs them: 'You had 1 · you'll owe Meera ₹31.20'", () => {
    const rice = eggRice();
    expect(claimText({ dish: rice, meId: ME, names: NAMES, half: 2 })).toBe("You had 1 · you'll owe Meera ₹31.20");
    expect(claimText({ dish: rice, meId: ME, names: NAMES, half: 3 })).toBe("You had 1½ · you'll owe Meera ₹46.80");
    expect(claimText({ dish: rice, meId: ME, names: NAMES, half: 0 })).toBe("You didn't have any");
    expect(claimedToast({ dish: rice, meId: ME, names: NAMES, half: 2 })).toEqual({
      title: "Claimed 1 portion of Egg fried rice",
      description: "You had 1 · you'll owe Meera ₹31.20.",
    });
    expect(claimedToast({ dish: rice, meId: ME, names: NAMES, half: 0 })).toEqual({ title: "Took back your claim on Egg fried rice" });
  });

  it("previews with the engine, and reads the API once it is your claim", () => {
    const claimed = eggRice(ME, { shares: [share(ANU, 2), share(ME, 2)] });
    expect(claimed.myClaimHalf).toBe(2);
    expect(claimOwedMinor(claimed, ME, 2)).toBe(3120);
    const tampered = { ...claimed, amounts: claimed.amounts.map((a) => (a.subjectId === ME ? { ...a, owedMinor: 3121 } : a)) };
    expect(claimOwedMinor(tampered, ME, 2)).toBe(3121);
    expect(claimText({ dish: { ...claimed, state: "finalized" }, meId: ME, names: NAMES, half: 2 })).toBe("You had 1 · you owe Meera ₹31.20");
  });

  it("gives the cook their own share, without the leftovers", () => {
    expect(claimText({ dish: paneer(), meId: ME, names: NAMES, half: 3 })).toBe("You had 1½ · your share is ₹79.13");
    const under = withApiSplit(paneer({ shares: [share(ME, 2), share(ANU, 2)] }));
    expect(claimText({ dish: under, meId: ME, names: NAMES, half: 2 })).toBe("You had 1 · your share is ₹52.75");
  });

  it("caps a claim at what nobody has plus your own", () => {
    expect(claimableHalf(eggRice())).toBe(8);
    expect(claimableHalf(paneer())).toBe(3);
    expect(claimableHalf(eggRice(ANU))).toBe(10);
  });

  it("explains a refused claim", () => {
    const ctx = { dish: eggRice(), meId: ME, names: NAMES };
    const refusal = (reason: string | undefined, details: Record<string, unknown> = {}, code = "conflict") => claimRefusal({ code, message: "server says no", reason, details }, ctx);
    expect(refusal("claims_exceed_portions", { availableHalf: 1 })).toBe("Only ½ portion is left for you now.");
    expect(refusal("claims_exceed_portions", { availableHalf: 3 })).toBe("Only 1½ portions are left for you now.");
    expect(refusal("claims_exceed_portions", { availableHalf: 0 })).toBe("Every portion is claimed now. Ask Meera if there's more.");
    expect(refusal("dish_not_open", { state: "finalized" })).toBe("Meera already finalized it.");
    expect(refusal("dish_not_open", { state: "canceled" })).toBe("This dish was canceled.");
    expect(refusal("dish_not_open", { state: "draft" })).toBe("Meera is setting everyone's share for this one.");
    expect(refusal(undefined, {}, "not_found")).toBe("You only view this group, so you can't claim. Ask Meera to count you in.");
    expect(refusal(undefined)).toBe("server says no");
  });

  it("explains a refused assignment, finalize or correction", () => {
    const ctx = { dish: paneer(), ...people() };
    const refusal = (reason: string, details: Record<string, unknown> = {}) => splitRefusal({ code: "conflict", message: "server says no", reason, details }, ctx);
    expect(refusal("not_in_group", { subjectIds: [DEV] })).toBe("Dev isn't in the group any more. Take them off and try again.");
    expect(refusal("not_in_group", { subjectIds: [DEV, VEENA] })).toBe("Dev and Veena aren't in the group any more. Take them off and try again.");
    expect(refusal("dish_not_open", { state: "finalized" })).toBe("It's already finalized. Correct it instead.");
    expect(refusal("claims_exceed_portions")).toBe("More portions are set than were cooked (4). Lower someone's share.");
    expect(refusal("not_creator")).toBe("Only whoever cooked it, or an owner or admin of the group, can do that.");
    expect(refusal("stale")).toMatch(/changed while you saved/);
  });
});

describe("how the dish moves money", () => {
  const lines = (list: { text: string; amountMinor: number; tone: string }[]) => list.map((l) => `${l.text} ${formatMinor(l.amountMinor)} ${l.tone}`);

  it("shows the cook what they are owed, what they owe, and the netting in each group", () => {
    const dish = paneer({ state: "finalized" });
    const flow = moneyFlow({ dish, split: splitOfDish(dish), ...people() });
    expect(flow.eatenTitle).toBe("They owe you for what they ate");
    expect(lines(flow.eaten)).toEqual(["Anu ₹52.75 owed", "Dev ₹52.75 owed", "Meera ₹26.37 owed"]);
    expect(flow.tookTitle).toBe("You owe for items you took (posted when you cooked)");
    expect(lines(flow.took)).toEqual([
      "Anu · Tomatoes · Flat 4B ₹12.00 owe",
      "Dev · Onions · Flat 4B ₹7.00 owe",
      "Kiran · Chapati flour · Lunch club ₹24.00 owe",
    ]);
    // design §3: netted inside Flat 4B, Anu owes Rahul ₹40.75, Dev ₹45.75, Meera ₹26.37; Rahul owes Kiran ₹24.00 in the Lunch club.
    expect(lines(flow.netted)).toEqual([
      "Anu → you · Flat 4B ₹40.75 owed",
      "Dev → you · Flat 4B ₹45.75 owed",
      "Meera → you · Flat 4B ₹26.37 owed",
      "You → Kiran · Lunch club ₹24.00 owe",
    ]);
    expect(flow.posted).toBe(true);
    expect(flow.eatenEmpty).toBeNull();
    expect(flow.tookEmpty).toBeNull();
  });

  it("shows a member the same money from where they stand", () => {
    const dish = paneer();
    const flow = moneyFlow({ dish, split: splitOfDish(dish), meId: ANU, names: NAMES, groupNames: new Map([[FLAT.orgId, FLAT.name]]) });
    expect(flow.eatenTitle).toBe("They owe Rahul for what they ate");
    expect(lines(flow.eaten)).toEqual(["You ₹52.75 owe", "Dev ₹52.75 neutral", "Meera ₹26.37 neutral"]);
    expect(flow.tookTitle).toBe("Rahul owes for items they took (posted when they cooked)");
    expect(lines(flow.took)[0]).toBe("You · Tomatoes · Flat 4B ₹12.00 owed");
    expect(lines(flow.netted)).toEqual([
      "You → Rahul · Flat 4B ₹40.75 owe",
      "Dev → Rahul · Flat 4B ₹45.75 neutral",
      "Meera → Rahul · Flat 4B ₹26.37 neutral",
      "Rahul → Kiran · another group ₹24.00 neutral",
    ]);
    expect(flow.posted).toBe(false);
  });

  it("nets the cook's debt to someone who ate nothing, and says when two are even", () => {
    const dish = withApiSplit(paneer({ shares: [share(ME, 2), share(ANU, 2)] }));
    expect(lines(moneyFlow({ dish, split: splitOfDish(dish), ...people() }).netted).slice(0, 2)).toEqual([
      "Anu → you · Flat 4B ₹40.75 owed",
      "You → Dev · Flat 4B ₹7.00 owe",
    ]);
    const even = { ...dish, netting: [{ subjectId: ANU, owesCookMinor: 1200, cookOwesMinor: 1200, netMinor: 0 }] };
    expect(lines(moneyFlow({ dish: even, split: splitOfDish(even), ...people() }).netted)[0]).toBe("Anu and you are even · Flat 4B ₹0.00 neutral");
  });

  it("explains a dish just for its cook, and one made only from their own things", () => {
    const mine = withApiSplit(paneer({ orgId: null, shares: [], splitMode: "assign", state: "draft" }));
    const flow = moneyFlow({ dish: mine, split: splitOfDish(mine), ...people() });
    expect(flow.eaten).toEqual([]);
    expect(flow.eatenEmpty).toBe("Just for you: nobody owes you for it.");
    expect(lines(flow.netted)).toEqual([
      "You → Anu · Flat 4B ₹12.00 owe",
      "You → Dev · Flat 4B ₹7.00 owe",
      "You → Kiran · Lunch club ₹24.00 owe",
    ]);
    const rice = eggRice();
    const riceFlow = moneyFlow({ dish: rice, split: splitOfDish(rice), ...people() });
    expect(riceFlow.took).toEqual([]);
    expect(riceFlow.tookEmpty).toBe("Every ingredient was Meera's already, so there's nobody to pay back.");
    expect(lines(riceFlow.netted)).toEqual(["Anu → Meera · Flat 4B ₹31.20 neutral"]);
    const nobody = withApiSplit(paneer({ shares: [] }));
    expect(moneyFlow({ dish: nobody, split: splitOfDish(nobody), ...people() }).eatenEmpty).toBe("Nobody else has had some yet.");
  });

  it("follows the cook's edit before it is saved (the engine's preview)", () => {
    const dish = paneer({ state: "draft", splitMode: "assign" });
    const shares = withHalf(sharesOf(dish), MEERA, 0);
    const flow = moneyFlow({ dish, split: previewSplit(dish, shares), ...people() });
    expect(lines(flow.eaten)).toEqual(["Anu ₹52.75 owed", "Dev ₹52.75 owed"]);
    expect(lines(flow.netted).slice(0, 2)).toEqual(["Anu → you · Flat 4B ₹40.75 owed", "Dev → you · Flat 4B ₹45.75 owed"]);
  });
});

describe("finalizing", () => {
  it("says who owes the cook now (the canvas's ₹131.87)", () => {
    const dish = paneer({ state: "finalized", txnId: "txn_dish" });
    expect(finalizedToast({ dish, ...people(), groupName: FLAT.name })).toEqual({
      title: "Posted to Flat 4B",
      description: "Anu, Dev and Meera owe you ₹131.87.",
    });
  });

  it("mentions the leftovers, and a dish just for its cook", () => {
    const dish = { ...withApiSplit(paneer({ shares: [share(ME, 2), share(ANU, 2)] })), state: "finalized" as const, leftoverItemId: "itm_left" };
    expect(finalizedToast({ dish, ...people(), groupName: FLAT.name }).description).toBe(
      "Anu owes you ₹52.75. 2 portions went to your pantry as Leftovers.",
    );
    const mine = paneer({ orgId: null, shares: [], state: "finalized" });
    expect(finalizedToast({ dish: mine, ...people(), groupName: null })).toEqual({
      title: "Finalized Paneer butter masala with rotis",
      description: "It was just for you, so nothing was split.",
    });
  });
});

describe("a group's Dishes tab", () => {
  const now = new Date(2026, 10, 2, 21, 0);

  it("asks the cook to finalize, a member to claim", () => {
    expect(dishRow(paneer(), { ...people(), now })).toMatchObject({
      href: `/dishes/${DISH_ID}`,
      name: "Paneer butter masala with rotis",
      sub: "You cooked · 4 of 4 claimed · ₹211.00",
      chip: { label: "Finalize", tone: "ready" },
    });
    expect(dishRow(eggRice(), { ...people(), now })).toMatchObject({
      sub: "Meera cooked · 1 of 5 claimed · ₹156.00",
      chip: { label: "Claim", tone: "open" },
    });
    expect(dishRow(eggRice(ANU), { ...people(ANU), now }).chip).toEqual({ label: "Open", tone: "open" });
    expect(dishRow(paneer({ state: "draft", splitMode: "assign" }), { ...people(ANU), now })).toMatchObject({
      sub: "Rahul cooked · being split · ₹211.00",
      chip: { label: "Being split", tone: "open" },
    });
  });

  it("says what you had of a finalized dish, and strikes a canceled one", () => {
    const curry = paneer({
      cook: DEV,
      name: "Chicken curry",
      totalMinor: 27400,
      state: "finalized",
      cookedAt: new Date(2026, 9, 28, 20, 0).toISOString(),
      myClaimHalf: 2,
    });
    expect(dishRow(curry, { ...people(), now })).toMatchObject({ sub: "Dev cooked · 28 Oct · you had 1 · ₹274.00", chip: { label: "Split", tone: "done" } });
    const gone = paneer({ state: "canceled", canceledAt: new Date(2026, 10, 2, 20, 30).toISOString() });
    expect(dishRow(gone, { ...people(), now })).toMatchObject({ sub: "You cooked · canceled today · ₹211.00", chip: { label: "Canceled", tone: "muted" } });
  });
});
