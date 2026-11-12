import type { MyGroupBalance } from "@saas/contracts/kitchen";
import { costOfUse, formatMinor } from "@saas/kitchen-engine/money";
import { buildDish, buildIngredientTake, pairLines } from "@saas/kitchen-engine/ledger";
import {
  JUST_ME,
  MAX_DISH_INGREDIENTS,
  addPantryLine,
  cookHref,
  cookRefusal,
  cookRequest,
  cookedText,
  costLine,
  ctaLabel,
  currencyProblem,
  defaultShare,
  dishCurrency,
  dishHref,
  dishProblem,
  dishStep,
  dishTotals,
  eaterView,
  groupTakes,
  lineCost,
  lineView,
  pantriesText,
  pantryLine,
  pantryResult,
  pantryResults,
  perPortionText,
  portionsText,
  previewNewItem,
  refreshLines,
  SPLIT_MODES,
  shareChoice,
  shareOptions,
  sharesRequest,
  sharesRefusal,
  startAmount,
  startingHalves,
  stepDishAmount,
  withLeft,
  type DishForm,
  type DishLine,
  type NewLine,
} from "@web-console-next/components/kitchen/dish-maker";
import { ANU, DEV, FLAT, KIRAN, LUNCH, ME, MEERA, NAMES, PERSONAL_REF, TRIP, groupRef, makeItem } from "./kitchen-pantry-fixtures";

// design.md §3's worked example: Rahul (ME) cooks paneer butter masala with
// rotis for Flat 4B, from his own paneer, butter and cream, Anu's tomatoes and
// Dev's onions from Flat 4B, and Kiran's chapati flour from the Lunch club.
const paneer = makeItem({ name: "Paneer", pantry: PERSONAL_REF, unit: "g", bought: "200", left: "200", priceMinor: 9500, paidBy: ME });
const butter = makeItem({ name: "Butter", pantry: PERSONAL_REF, unit: "g", bought: "500", left: "450", priceMinor: 28000, paidBy: ME });
const cream = makeItem({ name: "Fresh cream", pantry: PERSONAL_REF, unit: "ml", bought: "200", left: "100", priceMinor: 6000, paidBy: ME });
const tomatoes = makeItem({ name: "Tomatoes", pantry: groupRef(FLAT), unit: "kg", bought: "1", left: "0.4", priceMinor: 4000, worthMinor: 1600, paidBy: ANU });
const onions = makeItem({ name: "Onions", pantry: groupRef(FLAT), unit: "kg", bought: "2", left: "1.6", priceMinor: 7000, paidBy: DEV });
const flour = makeItem({ name: "Chapati flour", pantry: groupRef(LUNCH), unit: "kg", bought: "5", left: "2.5", priceMinor: 24000, paidBy: KIRAN });

const worked = (): DishLine[] => [
  pantryLine(paneer, 200_000),
  pantryLine(butter, 50_000),
  pantryLine(cream, 100_000),
  pantryLine(tomatoes, 300_000),
  pantryLine(onions, 200_000),
  pantryLine(flour, 500_000),
];

const totalsOf = (lines: readonly DishLine[], extrasMinor = 1500, portionsHalf = 8) =>
  dishTotals({ lines, extrasMinor, portionsHalf, meId: ME, currency: "INR" });

function group(g: { orgId: string; slug: string; name: string }, patch: Partial<MyGroupBalance> = {}): MyGroupBalance {
  return { ...g, currency: "INR", balanceMinor: 0, role: "builder", memberCount: 4, ...patch };
}
const GROUPS: MyGroupBalance[] = [
  group(FLAT, { role: "owner", memberCount: 5 }),
  group(LUNCH, { memberCount: 2 }),
  group(TRIP, { currency: "USD", memberCount: 3 }),
  group({ orgId: "org_00000000000000000000000000000e0e", slug: "office-x1", name: "Office team" }, { role: "viewer", memberCount: 8 }),
];

const newCoriander = (patch: Partial<NewLine> = {}): NewLine => ({
  kind: "new",
  key: "new:1",
  name: "Coriander",
  quantity: "100",
  unit: "g",
  dimension: "mass",
  qtyMilli: 100_000,
  priceMinor: 2000,
  useMilli: 100_000,
  ...patch,
});

describe("what each line costs: the engine's costOfUse", () => {
  it("prices the worked example's ingredients to the paisa", () => {
    expect(worked().map(lineCost)).toEqual([9500, 2800, 3000, 1200, 700, 2400]);
  });

  it("is costOfUse with what the item has cost so far (price − worth) as the cost taken", () => {
    const line = pantryLine(tomatoes, 300_000);
    expect(lineCost(line)).toBe(
      costOfUse({ priceMinor: 4000, qtyBoughtMilli: 1_000_000, qtyLeftMilli: 400_000, costTakenMinor: 4000 - 1600 }, 300_000),
    );
  });

  it("charges the last of an item what is left of its price", () => {
    // 1 kg for ₹40.01, 333 g left worth ₹13.34: the rest costs exactly that, not ₹13.32.
    const odd = makeItem({ unit: "g", bought: "1000", left: "333", priceMinor: 4001, worthMinor: 1334 });
    expect(lineCost(pantryLine(odd, 333_000))).toBe(1334);
  });

  it("prices what was just bought as a fresh item: all of it costs its price, part of it in proportion", () => {
    expect(lineCost(newCoriander())).toBe(2000);
    expect(lineCost(newCoriander({ useMilli: 30_000 }))).toBe(600);
  });
});

describe("the cost card", () => {
  it("adds up to design §3: ₹211.00 for 4 portions, ₹52.75 a portion", () => {
    const t = totalsOf(worked());
    expect(t.ingredientsMinor).toBe(19600);
    expect(t.totalMinor).toBe(21100);
    expect(t.perPortionMinor).toBe(5275);
    expect(t.perPortionExact).toBe(true);
    expect(perPortionText(t)).toBe("₹52.75");
  });

  it("splits it into what came from your own pantry, the extras, and what you owe each buyer", () => {
    const t = totalsOf(worked());
    expect(t.fromMineMinor).toBe(15300);
    expect(t.mineIsPantry).toBe(true);
    expect(t.extrasMinor).toBe(1500);
    expect(t.owes).toEqual([
      { orgId: FLAT.orgId, groupName: "Flat 4B", buyerId: ANU, amountMinor: 1200 },
      { orgId: FLAT.orgId, groupName: "Flat 4B", buyerId: DEV, amountMinor: 700 },
      { orgId: LUNCH.orgId, groupName: "Lunch club", buyerId: KIRAN, amountMinor: 2400 },
    ]);
    expect(t.fromMineMinor + t.owes.reduce((a, o) => a + o.amountMinor, 0)).toBe(t.ingredientsMinor);
  });

  it("says 'about' when a portion is not a whole number of paise", () => {
    const t = totalsOf([pantryLine(paneer, 200_000)], 500, 6);
    expect(t.totalMinor).toBe(10000);
    expect(perPortionText(t)).toBe("about ₹33.33");
  });
});

describe("what you take on, by group and buyer (buildIngredientTake + pairLines)", () => {
  it("is what each group's ingredient take leaves you owing, read pairwise", () => {
    const takes = groupTakes(worked(), ME);
    expect(takes.map((t) => [t.groupName, t.totalMinor])).toEqual([
      ["Flat 4B", 1900],
      ["Lunch club", 2400],
    ]);
    const flat = buildIngredientTake({ cookId: ME, lines: [{ buyerId: ANU, costMinor: 1200 }, { buyerId: DEV, costMinor: 700 }] });
    const pairs = pairLines([{ id: "t", kind: "use", title: "Flat 4B", totalMinor: flat.totalMinor, splits: flat.splits }]);
    expect(takes[0]!.owes.map((o) => [o.buyerId, o.amountMinor])).toEqual(pairs.map((p) => [p.creditorId, p.amountMinor]));
  });

  it("owes nobody for a group item you bought yourself, and merges one buyer's items in a group", () => {
    const dal = makeItem({ name: "Toor dal", pantry: groupRef(FLAT), unit: "kg", bought: "1", left: "0.65", priceMinor: 16500, paidBy: ME });
    const rice = makeItem({ name: "Basmati rice", pantry: groupRef(FLAT), unit: "kg", bought: "5", left: "3.2", priceMinor: 62000, paidBy: ANU });
    const lines = [pantryLine(dal, 100_000), pantryLine(tomatoes, 100_000), pantryLine(rice, 200_000)];
    const t = totalsOf(lines);
    expect(t.owes).toEqual([{ orgId: FLAT.orgId, groupName: "Flat 4B", buyerId: ANU, amountMinor: 400 + 2480 }]);
    expect(t.fromMineMinor).toBe(1650);
    expect(t.mineIsPantry).toBe(false);
  });

  it("keeps the same buyer apart in two groups", () => {
    const anuLunch = makeItem({ name: "Rice", pantry: groupRef(LUNCH), unit: "kg", bought: "1", priceMinor: 8000, paidBy: ANU });
    const t = totalsOf([pantryLine(tomatoes, 100_000), pantryLine(anuLunch, 500_000)]);
    expect(t.owes.map((o) => [o.groupName, o.buyerId, o.amountMinor])).toEqual([
      ["Flat 4B", ANU, 400],
      ["Lunch club", ANU, 4000],
    ]);
  });
});

describe("the cost, one line on the main button (SM-15)", () => {
  it("says the total, the portions and a portion's price — the dark five-line card is gone", () => {
    expect(costLine(totalsOf(worked()))).toBe("₹211.00 · 4 portions · ₹52.75 each");
    expect(costLine(totalsOf(worked(), 1500, 2))).toBe("₹211.00 · 1 portion · ₹211.00 each");
    expect(costLine(totalsOf(worked(), 1500, 1))).toBe("₹211.00 · ½ portion · ₹422.00 each");
  });

  it("says ≈ when a portion is not a whole number of paise, and nothing while the dish costs nothing", () => {
    expect(costLine(totalsOf([pantryLine(paneer, 200_000)], 500, 6))).toBe("₹100.00 · 3 portions · ≈ ₹33.33 each");
    expect(costLine(totalsOf([], 0))).toBeNull();
  });

  it("each line still says whom you owe for it, so the button needs no list of buyers", () => {
    const views = worked().map((l) => lineView(l, { meId: ME, names: NAMES, currency: "INR" }));
    expect(views.filter((v) => !v.mine).map((v) => v.owe)).toEqual(["you owe Anu", "you owe Dev", "you owe Kiran"]);
  });
});

describe("cooking it: the request", () => {
  const form = (patch: Partial<DishForm> = {}): DishForm => ({
    name: "  Paneer butter   masala ",
    lines: worked(),
    extrasMinor: 1500,
    portionsHalf: 8,
    share: FLAT.orgId,
    mode: "claims",
    ...patch,
  });

  it("sends each pantry ingredient in its base unit, for the group to claim", () => {
    expect(cookRequest(form())).toEqual({
      name: "Paneer butter masala",
      orgId: FLAT.orgId,
      portionsHalf: 8,
      extrasMinor: 1500,
      splitMode: "claims",
      ingredients: [
        { itemId: paneer.id, quantity: "200", unit: "g" },
        { itemId: butter.id, quantity: "50", unit: "g" },
        { itemId: cream.id, quantity: "100", unit: "ml" },
        { itemId: tomatoes.id, quantity: "300", unit: "g" },
        { itemId: onions.id, quantity: "200", unit: "g" },
        { itemId: flour.id, quantity: "500", unit: "g" },
      ],
    });
  });

  it("adds what was just bought as newItems — all of it by default, a useQuantity when less goes in", () => {
    const body = cookRequest(form({ lines: [newCoriander(), newCoriander({ key: "new:2", name: "Lemons", unit: "pcs", dimension: "count", quantity: "6", qtyMilli: 6000, priceMinor: 6000, useMilli: 2000 })] }));
    expect(body.ingredients).toBeUndefined();
    expect(body.newItems).toEqual([
      { name: "Coriander", category: "other", quantity: "100", unit: "g", priceMinor: 2000 },
      { name: "Lemons", category: "other", quantity: "6", unit: "pcs", priceMinor: 6000, useQuantity: "2", useUnit: "pcs" },
    ]);
  });

  it("is assigned and in no group when it is just for you", () => {
    const body = cookRequest(form({ share: JUST_ME, mode: "claims" }));
    expect(body.orgId).toBeNull();
    expect(body.splitMode).toBe("assign");
  });

  it("posts who ate what right after cooking: you first, then the group's order, nobody at zero", () => {
    const roster = [ANU, ME, DEV, MEERA, KIRAN];
    expect(sharesRequest({ [MEERA]: 1, [ANU]: 2, [ME]: 3, [DEV]: 2, [KIRAN]: 0 }, roster, ME)).toEqual({
      shares: [
        { subjectId: ME, portionsHalf: 3 },
        { subjectId: ANU, portionsHalf: 2 },
        { subjectId: DEV, portionsHalf: 2 },
        { subjectId: MEERA, portionsHalf: 1 },
      ],
    });
    expect(sharesRequest({}, roster, ME)).toEqual({ shares: [] });
  });
});

describe("who ate what (buildDish, the cook's share first)", () => {
  const roster = [ME, ANU, DEV, MEERA];

  it("reproduces design §3's split to the paisa: the odd paisa is the cook's", () => {
    const view = eaterView({ roster, meId: ME, halves: { [ME]: 3, [ANU]: 2, [DEV]: 2, [MEERA]: 1 }, totalMinor: 21100, portionsHalf: 8, names: NAMES });
    expect(view.rows.map((r) => [r.label, r.portions, r.amountMinor])).toEqual([
      ["You", "1½", 7913],
      ["Anu", "1", 5275],
      ["Dev", "1", 5275],
      ["Meera", "½", 2637],
    ]);
    const engine = buildDish({
      cookId: ME,
      totalMinor: 21100,
      portionsHalf: 8,
      shares: [{ subjectId: ME, portionsHalf: 3 }, { subjectId: ANU, portionsHalf: 2 }, { subjectId: DEV, portionsHalf: 2 }, { subjectId: MEERA, portionsHalf: 1 }],
    });
    expect(view.rows.map((r) => r.amountMinor)).toEqual(roster.map((id) => engine.owedBy.get(id)));
    expect(view.unclaimedHalf).toBe(0);
    expect(view.rows.every((r) => !r.canMore)).toBe(true);
  });

  it("lets the portions nobody is down for fall to you, shown apart with what they are worth", () => {
    const view = eaterView({ roster, meId: ME, halves: { [ME]: 2, [ANU]: 2 }, totalMinor: 21100, portionsHalf: 8, names: NAMES });
    expect(view.unclaimedHalf).toBe(4);
    expect(view.unclaimedMinor).toBe(10550);
    expect(view.rows.find((r) => r.subjectId === ME)!.amountMinor).toBe(5275);
    expect(view.rows.find((r) => r.subjectId === ANU)!.amountMinor).toBe(5275);
    expect(view.rows.find((r) => r.subjectId === DEV)).toMatchObject({ amountMinor: 0, canLess: false, canMore: true });
    const nobodyButAnu = eaterView({ roster, meId: ME, halves: { [ANU]: 2 }, totalMinor: 21100, portionsHalf: 8 });
    expect(nobodyButAnu.rows[0]).toMatchObject({ subjectId: ME, amountMinor: 0 });
    expect(nobodyButAnu.unclaimedMinor).toBe(15825);
  });

  it("flags more portions given out than cooked", () => {
    const view = eaterView({ roster, meId: ME, halves: { [ME]: 4, [ANU]: 4, [DEV]: 2 }, totalMinor: 21100, portionsHalf: 8 });
    expect(view.over).toBe(true);
    const f: DishForm = { name: "Dal", lines: worked(), extrasMinor: 0, portionsHalf: 8, share: FLAT.orgId, mode: "assign" };
    expect(dishProblem({ form: f, currency: "INR", eaters: view })).toMatchObject({
      field: "portions",
      message: "You've given out 5 portions of 4. Take some back, or cook more.",
    });
  });

  it("starts with you down for one portion, and writes half portions as ½", () => {
    expect(startingHalves(ME, 8)).toEqual({ [ME]: 2 });
    expect(startingHalves(ME, 1)).toEqual({ [ME]: 1 });
    expect([0, 1, 2, 3, 8].map(portionsText)).toEqual(["0", "½", "1", "1½", "4"]);
  });

  it("offers claims or assign, in two words each (SM-15, the audit's Top 15 item 13)", () => {
    expect(SPLIT_MODES.map((m) => [m.id, m.label])).toEqual([
      ["claims", "Everyone claims"],
      ["assign", "I'll assign"],
    ]);
  });
});

describe("the lines: steps, amounts and what they say", () => {
  it("steps in sizes that fit what was bought", () => {
    expect(dishStep("mass", 200_000)).toEqual({ unit: "g", stepMilli: 10_000 });
    expect(dishStep("mass", 1_000_000)).toEqual({ unit: "g", stepMilli: 25_000 });
    expect(dishStep("mass", 2_000_000)).toEqual({ unit: "g", stepMilli: 50_000 });
    expect(dishStep("mass", 5_000_000)).toEqual({ unit: "g", stepMilli: 100_000 });
    expect(dishStep("volume", 1_000_000)).toEqual({ unit: "ml", stepMilli: 25_000 });
    expect(dishStep("count", 12_000)).toEqual({ unit: "pcs", stepMilli: 1_000 });
    expect(dishStep("pack", 4_000)).toEqual({ unit: "pack", stepMilli: 1_000 });
  });

  it("starts at four steps of a weight, one of a count — never more than is left", () => {
    expect(startAmount("mass", 1_000_000, 400_000)).toBe(100_000);
    expect(startAmount("mass", 200_000, 30_000)).toBe(30_000);
    expect(startAmount("count", 12_000, 7_000)).toBe(1_000);
  });

  it("steps onto the grid, stops at what is left, and steps from the smallest amount to zero (out of the dish)", () => {
    const step = { unit: "g" as const, stepMilli: 25_000 };
    expect(stepDishAmount(130_000, 1, step, 400_000)).toBe(150_000);
    expect(stepDishAmount(130_000, -1, step, 400_000)).toBe(125_000);
    expect(stepDishAmount(390_000, 1, step, 400_000)).toBe(400_000);
    expect(stepDishAmount(25_000, -1, step, 400_000)).toBe(0);
    expect(stepDishAmount(10_000, -1, step, 10_000)).toBe(0);
  });

  it("says where each line is from, what it costs and whether you owe its buyer", () => {
    const [p, , , t] = worked().map((l) => lineView(l, { meId: ME, names: NAMES, currency: "INR" }));
    expect(p).toMatchObject({ name: "Paneer", chip: { label: "Your kitchen", tone: "mine" }, owe: "yours", oweColumn: "—", amount: "200 g", leftNote: "uses it all", lessLabel: "Less paneer" });
    expect(t).toMatchObject({ chip: { label: "Flat 4B · Anu paid", tone: "group" }, owe: "you owe Anu", oweColumn: "Anu ₹12.00", amount: "300 g", leftNote: "100 g left" });
    const n = lineView(newCoriander({ useMilli: 30_000 }), { meId: ME, currency: "INR" });
    expect(n).toMatchObject({ chip: { label: "Just bought", tone: "mine" }, owe: "yours", leftNote: "70 g stays in your kitchen", href: null });
    const smallest = lineView(pantryLine(onions, 50_000), { meId: ME, names: NAMES, currency: "INR" });
    expect(smallest.lessLabel).toBe("Take out onions");
  });

  it("counts the pantries a dish comes from (yours, and what you just bought, as one)", () => {
    expect(pantriesText(worked())).toBe("from 3 pantries");
    expect(pantriesText([pantryLine(paneer), newCoriander()])).toBe("from your kitchen");
    expect(pantriesText([])).toBeNull();
  });

  it("adds an item once", () => {
    const once = addPantryLine([], tomatoes);
    expect(addPantryLine(once, tomatoes)).toHaveLength(1);
    expect(once[0]).toMatchObject({ kind: "pantry", key: tomatoes.id, qtyMilli: 100_000 });
  });

  it("keeps lines fresh: an item someone used meanwhile cuts its amount to what is left", () => {
    const lines = [pantryLine(tomatoes, 300_000), pantryLine(onions, 200_000)];
    expect(refreshLines(lines, new Map([[tomatoes.id, tomatoes]]))).toBe(lines);
    const less = { ...tomatoes, version: 2, qtyLeftMilli: 200_000, worthMinor: 800 };
    const next = refreshLines(lines, new Map([[tomatoes.id, less]]));
    expect(next[0]).toMatchObject({ qtyMilli: 200_000, item: { qtyLeftMilli: 200_000 } });
    expect(lineCost(next[0]!)).toBe(800);
    const cut = withLeft(lines, onions.id, 100_000)[1]!;
    expect(cut).toMatchObject({ qtyMilli: 100_000, item: onions });
    expect(lineCost(cut)).toBe(350);
  });
});

describe("taking from any pantry", () => {
  it("says where each item is, who paid and what is left", () => {
    const ctx = { lines: [pantryLine(tomatoes)], currency: "INR", meId: ME, names: NAMES };
    expect(pantryResult(tomatoes, ctx)).toMatchObject({ meta: "Flat 4B · Anu paid · 400 g left", added: true, disabledReason: null });
    expect(pantryResult(butter, ctx)).toMatchObject({ meta: "Your kitchen · 450 g left", added: false });
    const mine = makeItem({ name: "Oil", pantry: groupRef(FLAT), unit: "L", bought: "1", left: "0.4", priceMinor: 18500, paidBy: ME });
    expect(pantryResult(mine, ctx).meta).toBe("Flat 4B · you paid · 400 ml left");
  });

  it("shows another currency's items without letting them in, and leaves out what can't be used", () => {
    const coffee = makeItem({ name: "Coffee", pantry: groupRef(TRIP), unit: "g", bought: "250", priceMinor: 1200, paidBy: DEV, currency: "USD" });
    const viewed = makeItem({ name: "Pickle", pantry: groupRef(LUNCH), canUse: false });
    const gone = makeItem({ name: "Milk", left: "0" });
    const results = pantryResults([coffee, viewed, gone, tomatoes], { lines: [], currency: "INR", meId: ME, names: NAMES });
    expect(results.map((r) => [r.name, r.disabledReason])).toEqual([
      ["Coffee", "Counts in USD"],
      ["Tomatoes", null],
    ]);
    expect(pantryResults([coffee], { lines: [], currency: null, meId: ME })[0]!.disabledReason).toBeNull();
  });

  it("checks what was just bought, and makes it a line with all of it in the dish", () => {
    const empty = previewNewItem({ name: " ", quantity: "", unit: "g", price: "" }, "new:1", "INR");
    expect(empty.errors).toEqual({ name: "Say what you bought", quantity: "Enter how much you got", price: "Enter what you paid" });
    expect(empty.line).toBeNull();
    const ok = previewNewItem({ name: " Paneer ", quantity: ".5", unit: "kg", price: "190" }, "new:3", "INR");
    expect(ok.perUnit).toBe("₹380.00 per kg · ₹38.00 per 100 g");
    expect(ok.line).toEqual({ kind: "new", key: "new:3", name: "Paneer", quantity: "0.5", unit: "kg", dimension: "mass", qtyMilli: 500_000, priceMinor: 19000, useMilli: 500_000 });
  });
});

describe("who to share it with", () => {
  it("offers Just me, then the groups you cook in, recent first — never a group you only view", () => {
    const list = shareOptions(GROUPS, { recentSlugs: [LUNCH.slug], currency: "INR" });
    expect(list.options.map((o) => [o.name, o.meta, o.disabledReason])).toEqual([
      ["Just me", "Don't split it", null],
      ["Lunch club", "2 people", null],
      ["Flat 4B", "5 people", null],
      ["Goa trip", "3 people · counts in USD", "Counts in USD"],
    ]);
    expect(list.heading).toBeNull();
  });

  it("shows five groups until a search, which finds the rest", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      group({ orgId: `org_${String(i).padStart(32, "0")}`, slug: `g-${i}`, name: `Group ${i + 1}` }),
    );
    const list = shareOptions(many);
    expect(list.options).toHaveLength(6);
    expect(list.more).toBe(3);
    expect(list.heading).toBe("Recent · search to see all 8");
    expect(shareOptions(many, { query: "group 8" }).options.map((o) => o.name)).toEqual(["Group 8"]);
    expect(shareOptions(many, { query: "just" }).options.map((o) => o.name)).toEqual(["Just me"]);
  });

  it("starts with the item's group, else the group opened last that counts in the dish's currency, else just you", () => {
    expect(defaultShare(GROUPS, { linkedOrgId: LUNCH.orgId, recentSlugs: [FLAT.slug] })).toBe(LUNCH.orgId);
    expect(defaultShare(GROUPS, { recentSlugs: [TRIP.slug, FLAT.slug] })).toBe(TRIP.orgId);
    expect(defaultShare(GROUPS, { recentSlugs: [TRIP.slug, FLAT.slug], currency: "INR" })).toBe(FLAT.orgId);
    expect(defaultShare(GROUPS, { linkedOrgId: "org_00000000000000000000000000000e0e" })).not.toBe("org_00000000000000000000000000000e0e");
    expect(defaultShare([GROUPS[3]!], {})).toBe(JUST_ME);
    expect(shareChoice(FLAT.orgId, GROUPS)).toMatchObject({ name: "Flat 4B", meta: "5 people" });
    expect(shareChoice(JUST_ME, GROUPS)).toMatchObject({ name: "Just me", meta: "Don't split it" });
  });

  it("cooks in the shared group's currency, else the first ingredient's", () => {
    expect(dishCurrency(worked(), "USD")).toBe("USD");
    expect(dishCurrency(worked(), null)).toBe("INR");
    expect(dishCurrency([newCoriander()], null)).toBe("INR");
    expect(currencyProblem(worked(), "USD")).toBe("Paneer counts in INR, and this dish is in USD. Take it out to cook.");
    expect(currencyProblem(worked(), "INR")).toBeNull();
  });
});

describe("the button, and what it says when it can't cook yet", () => {
  const base: DishForm = { name: "Dal", lines: worked(), extrasMinor: 0, portionsHalf: 4, share: FLAT.orgId, mode: "claims" };

  it("names what is missing first", () => {
    expect(dishProblem({ form: { ...base, lines: [] }, currency: "INR", eaters: null })?.label).toBe("Add an ingredient");
    expect(dishProblem({ form: { ...base, name: "  " }, currency: "INR", eaters: null })?.label).toBe("Name the dish");
    const tooMany = Array.from({ length: MAX_DISH_INGREDIENTS + 1 }, (_, i) => newCoriander({ key: `new:${i}` }));
    expect(dishProblem({ form: { ...base, lines: tooMany }, currency: "INR", eaters: null })?.label).toBe("At most 30 ingredients");
    const usedUp = [pantryLine({ ...tomatoes, qtyLeftMilli: 0 }, 0)];
    expect(dishProblem({ form: { ...base, lines: usedUp }, currency: "INR", eaters: null })?.label).toBe("None of Tomatoes left");
    expect(dishProblem({ form: base, currency: "INR", eaters: null })).toBeNull();
  });

  it("says where the dish goes", () => {
    expect(ctaLabel({ share: FLAT.orgId, groupName: "Flat 4B", mode: "claims", problem: null })).toBe("Cook & post to Flat 4B");
    expect(ctaLabel({ share: FLAT.orgId, groupName: "Flat 4B", mode: "assign", problem: null })).toBe("Cook & post the split");
    expect(ctaLabel({ share: JUST_ME, groupName: null, mode: "claims", problem: null })).toBe("Cook it");
  });

  it("toasts what was cooked, and links the dish page and Cook with it", () => {
    // One line (SM-15): no "posted to Flat 4B to claim." under it.
    expect(cookedText({ name: "Dal", share: FLAT.orgId, groupName: "Flat 4B", mode: "claims", totalMinor: 21100, currency: "INR" })).toEqual({
      title: "Cooked Dal · ₹211.00 · Flat 4B",
    });
    expect(cookedText({ name: "Dal", share: JUST_ME, groupName: null, mode: "assign", totalMinor: 900, currency: "INR" })).toEqual({ title: "Cooked Dal · ₹9.00" });
    expect(dishHref("dsh_abc")).toBe("/dishes/dsh_abc");
    expect(cookHref({ kind: "group", orgId: FLAT.orgId, itemId: tomatoes.id })).toBe(`/cook?item=org:${FLAT.orgId}:${tomatoes.id}`);
    expect(cookHref(null)).toBe("/cook");
  });
});

describe("refusals, in words", () => {
  const lines = worked();

  it("not that much left: says how much is, and which item", () => {
    const r = cookRefusal({ code: "conflict", reason: "insufficient_stock", message: "x", details: { itemId: tomatoes.id, qtyLeftMilli: 200_000 } }, lines);
    expect(r.message).toBe("Only 200 g of Tomatoes left now — someone used some meanwhile. Check the amount and cook again.");
    expect(r.short).toEqual({ itemId: tomatoes.id, qtyLeftMilli: 200_000 });
    expect(cookRefusal({ code: "conflict", reason: "insufficient_stock", message: "x", details: { itemId: tomatoes.id, qtyLeftMilli: 0 } }, lines).message).toBe(
      "None of Tomatoes left now — someone used the last of it. Take it out and cook again.",
    );
  });

  it("another currency, a change under the write, an item or group no longer yours", () => {
    expect(
      cookRefusal({ code: "validation_failed", reason: "currency_mismatch", message: "x", details: { currency: "INR", itemIds: [flour.id] } }, lines).message,
    ).toBe("Chapati flour counts in another currency. Everything in this dish has to be in INR.");
    expect(cookRefusal({ code: "conflict", reason: "stale", message: "x" }, lines).message).toBe(
      "Something changed while you were cooking. Check the amounts and cook again.",
    );
    expect(cookRefusal({ code: "not_found", message: "Not found" }, lines).message).toMatch(/isn't one you can use any more/);
    expect(cookRefusal({ code: "validation_failed", message: "Name: too long" }, lines).message).toBe("Name: too long");
  });

  it("the split, after cooking", () => {
    expect(sharesRefusal({ reason: "not_in_group", message: "x" })).toBe("Someone you named has left the group. Set who ate on the dish page.");
  });

  it("money in the tests is the engine's formatter", () => {
    expect(formatMinor(5275)).toBe("₹52.75");
  });
});
