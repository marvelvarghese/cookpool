import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  KitchenDish,
  KitchenRecipe,
  KitchenRecipeLine,
  MyGroupBalance,
  Recipe,
  RecipeLastCook,
  RecipeMatchResponse,
} from "@saas/contracts/kitchen";
import { frameRedirect } from "@web-console-next/lib/features";
import { STATIC_PAGES } from "@web-console-next/lib/static-pages.mjs";
import { backParent } from "@web-console-next/components/kitchen/back";
import { clearDeviceRecords } from "@web-console-next/lib/sign-out";
import { cookSessions, createCookSessionStore, sessionKey, type SessionStorageLike } from "@web-console-next/lib/cook-session-store";
import { JUST_ME } from "@web-console-next/components/kitchen/dish-maker";
import { SessionBarCard, SessionRow } from "@web-console-next/components/kitchen/cook-session-ui";
import {
  FINISH_OFFLINE_TEXT,
  addBoughtLine,
  addItemLine,
  amountText,
  blankSession,
  defaultPostTo,
  discardPrompt,
  elapsedText,
  factorParam,
  fillFromBefore,
  finishButtonText,
  finishEaters,
  finishPlan,
  includedLines,
  isEmptySession,
  lineTakes,
  openChoice,
  opensKeyboard,
  parseSession,
  postToOf,
  progressText,
  recipeParam,
  refreshTakes,
  runFinish,
  saveSwitch,
  scaleChip,
  sessionBarShows,
  sessionBarView,
  sessionFromRecipe,
  sessionHref,
  sessionLineView,
  setLineAmount,
  setName,
  setPostTo,
  startingEaters,
  stepAmount,
  stepEater,
  stepLine,
  stepsTitle,
  tickLine,
  todaysRecipeLines,
  toggleStep,
  untickedText,
  type CookSession,
  type FinishDeps,
  type FinishPlan,
} from "@web-console-next/components/kitchen/cook-session";
import { FLAT, LUNCH, ME, MEERA, NAMES, PERSONAL_REF, groupRef, makeItem } from "./kitchen-pantry-fixtures";

// cookpool-recipes RC-6 (design §4): cooking is a session — a draft kept on
// the device, from a recipe or blank, with last time, ticks and amounts, a
// bar on every tab, and Finish asking who ate before posting the dish through
// the existing writes.

const NOW = new Date("2026-11-08T12:00:00.000Z");
const RECIPE_ID = "rcp_00000000000000000000000000000c01";
const OTHER_RECIPE = "rcp_00000000000000000000000000000d02";

// The pantries: chicken in yours; onions (Meera paid) and oil (you paid) in Flat 4B.
const CHICKEN = makeItem({ name: "Chicken", pantry: PERSONAL_REF, unit: "kg", bought: "1", priceMinor: 28_000, paidBy: ME });
const ONIONS = makeItem({ name: "Onions", pantry: groupRef(FLAT), unit: "kg", bought: "2", priceMinor: 8_000, paidBy: MEERA });
const OIL = makeItem({ name: "Cooking oil", pantry: groupRef(FLAT), unit: "L", bought: "1", priceMinor: 18_500, paidBy: ME });
const RICE = makeItem({ name: "Rice", pantry: groupRef(LUNCH), unit: "kg", bought: "5", priceMinor: 40_000, paidBy: MEERA });

function line(position: number, o: Partial<KitchenRecipeLine> & { name: string }): KitchenRecipeLine {
  return {
    position,
    foodKey: o.foodKey ?? o.name.toLowerCase(),
    name: o.name,
    qtyMilli: o.qtyMilli ?? null,
    quantity: o.quantity ?? null,
    unit: o.unit ?? null,
    dimension: o.dimension ?? null,
    toTaste: o.toTaste ?? false,
    isMain: o.isMain ?? false,
  };
}

// Chicken curry serves 4: 1 kg chicken (main), 4 onions, 200 g yogurt, 1 tsp garam masala, salt to taste, 2 tbsp oil.
const RECIPE: KitchenRecipe = {
  id: RECIPE_ID,
  ownerId: ME,
  ownerName: "Rahul",
  name: "Chicken curry",
  servesHalf: 8,
  serves: 4,
  minutes: 45,
  kind: "dal_curry",
  visibility: "groups",
  isSystem: false,
  mine: true,
  source: null,
  savedBy: 0,
  lineCount: 6,
  main: { position: 0, foodKey: "chicken", name: "Chicken", qtyMilli: 1_000_000, quantity: 1000, unit: "g" },
  lastCookedAt: "2026-11-01T19:00:00.000Z",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  lines: [
    line(0, { name: "Chicken", qtyMilli: 1_000_000, quantity: 1000, unit: "g", dimension: "mass", isMain: true }),
    line(1, { name: "Onions", foodKey: "onion", qtyMilli: 4_000, quantity: 4, unit: "onion", dimension: "count" }),
    line(2, { name: "Yogurt", qtyMilli: 200_000, quantity: 200, unit: "g", dimension: "mass" }),
    line(3, { name: "Garam masala", foodKey: "garam_masala", qtyMilli: 5_000, quantity: 1, unit: "tsp", dimension: "volume" }),
    line(4, { name: "Salt", toTaste: true }),
    line(5, { name: "Cooking oil", foodKey: "oil", qtyMilli: 30_000, quantity: 2, unit: "tbsp", dimension: "volume" }),
  ],
  steps: ["Brown the onions", "Add the chicken", "Stir in the yogurt", "Add the masala", "Simmer 20 minutes"],
  linkCode: null,
};

const LAST_COOK: RecipeLastCook = {
  dishId: "dsh_00000000000000000000000000000001",
  cookedAt: "2026-11-01T19:00:00.000Z",
  recipeFactorMilli: 500,
  portionsHalf: 4,
  lines: [
    { recipeLine: 0, itemId: CHICKEN.id, name: "Chicken", qtyMilli: 500_000, quantity: 500, unit: "g", label: null },
    { recipeLine: 1, itemId: ONIONS.id, name: "Onions", qtyMilli: 300_000, quantity: 2, unit: "kg", label: "2 onions" },
  ],
};

const matchItem = (item: typeof CHICKEN, takeMilli: number) => ({
  itemId: item.id,
  ref: item.pantry.kind === "group" ? `org:${item.pantry.orgId}:${item.id}` : `me:${item.id}`,
  orgId: item.pantry.kind === "group" ? item.pantry.orgId : null,
  pantry: item.pantry,
  name: item.name,
  qtyLeftMilli: item.qtyLeftMilli,
  takeMilli,
  unit: item.displayUnit,
  expiresOn: null,
});

// The match at ×0.45: chicken 450 g, 2 onions (300 g of Flat 4B's), no yogurt, garam masala on Always have, 1 tbsp oil.
const MATCH: RecipeMatchResponse = {
  recipeId: RECIPE_ID,
  factorMilli: 450,
  portions: { portionsHalf: 4, about: true, label: "about 2" },
  lines: [
    { position: 0, status: "have", needMilli: 450_000, needQuantity: 450, unit: "g", availableMilli: 1_000_000, items: [matchItem(CHICKEN, 450_000)] },
    { position: 1, status: "have", needMilli: 2_000, needQuantity: 2, unit: "onion", availableMilli: 13_333, items: [matchItem(ONIONS, 300_000)] },
    { position: 2, status: "missing", needMilli: 90_000, needQuantity: 90, unit: "g", availableMilli: 0, items: [] },
    { position: 3, status: "always", needMilli: 2_500, needQuantity: 0.5, unit: "tsp", availableMilli: 0, items: [] },
    { position: 4, status: "always", needMilli: null, needQuantity: null, unit: null, availableMilli: 0, items: [] },
    { position: 5, status: "have", needMilli: 15_000, needQuantity: 1, unit: "tbsp", availableMilli: 1_000_000, items: [matchItem(OIL, 15_000)] },
  ],
  summary: { lines: 6, have: 3, short: 0, missing: 1, always: 2, missingNames: ["Yogurt"], maxFactorMilli: null },
  unlinked: [],
};

const ITEMS = new Map([CHICKEN, ONIONS, OIL, RICE].map((i) => [i.id, i] as const));

/** The session from the recipe, its items read. */
function curry(): CookSession {
  return refreshTakes(sessionFromRecipe(RECIPE, LAST_COOK, MATCH, NOW), ITEMS);
}

const group = (g: { orgId: string; slug: string; name: string }, memberCount = 3): MyGroupBalance => ({
  ...g,
  currency: "INR",
  balanceMinor: 0,
  role: "builder",
  memberCount,
});
const GROUPS: MyGroupBalance[] = [group(FLAT, 4), group(LUNCH, 6)];
const ROSTER = [MEERA, ME, "usr_0000000000000000000000000000c1c1"];

/** localStorage, as a map: with `length` and `key`, as the browser's has. */
function memoryStorage(): SessionStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

describe("the draft store (design §4.1)", () => {
  it("keeps one draft per account under <prefix>.session.<account>", () => {
    const storage = memoryStorage();
    const store = createCookSessionStore({ storage: () => storage, prefix: () => "cookpool.next" });
    const s = curry();
    store.write(ME, s);
    expect(sessionKey("cookpool.next", ME)).toBe(`cookpool.next.session.${ME}`);
    expect([...storage.map.keys()]).toEqual([`cookpool.next.session.${ME}`]);
    expect(store.read(ME)).toEqual(s);
    expect(store.read(MEERA)).toBeNull();
  });

  it("survives a reload: a fresh store reading the same localStorage resumes it", () => {
    const storage = memoryStorage();
    const before = createCookSessionStore({ storage: () => storage, prefix: () => "cookpool.next" });
    const ticked = tickLine(curry(), "r:0");
    before.write(ME, ticked);
    const after = createCookSessionStore({ storage: () => storage, prefix: () => "cookpool.next" });
    const back = after.read(ME);
    expect(back).toEqual(ticked);
    expect(progressText(back!)).toBe("1 of 6 in");
    expect(openChoice(back, null)).toBe("resume");
  });

  it("gives the same snapshot until the stored text changes, and tells subscribers", () => {
    const storage = memoryStorage();
    const store = createCookSessionStore({ storage: () => storage, prefix: () => "p" });
    const calls: number[] = [];
    const off = store.subscribe(() => calls.push(1));
    store.write(ME, curry());
    expect(store.read(ME)).toBe(store.read(ME));
    store.update(ME, (s) => tickLine(s, "r:1"));
    expect(store.read(ME)!.lines[1]!.ticked).toBe(true);
    store.update(ME, (s) => s);
    off();
    store.clear(ME);
    expect(calls).toHaveLength(2);
    expect(store.read(ME)).toBeNull();
  });

  it("drops a draft from another version, or anything else in the key", () => {
    expect(parseSession(JSON.stringify({ ...curry(), v: 0 }))).toBeNull();
    expect(parseSession("{not json")).toBeNull();
    expect(parseSession(JSON.stringify({ v: 1, name: "x" }))).toBeNull();
    expect(parseSession(JSON.stringify(curry()))).toEqual(curry());
  });

  it("is one session at a time: the same recipe resumes, another asks, an empty blank one gives way", () => {
    const s = curry();
    expect(openChoice(null, { recipeId: RECIPE_ID })).toBe("start");
    expect(openChoice(null, null)).toBe("start");
    expect(openChoice(s, { recipeId: RECIPE_ID })).toBe("resume");
    expect(openChoice(s, null)).toBe("resume");
    expect(openChoice(s, { recipeId: OTHER_RECIPE })).toBe("ask");
    const blank = blankSession(NOW);
    expect(isEmptySession(blank)).toBe(true);
    expect(openChoice(blank, { recipeId: RECIPE_ID })).toBe("start");
    expect(openChoice(setName(blank, "Dal"), { recipeId: RECIPE_ID })).toBe("ask");
  });

  it("asks once, in words: Finish or discard Chicken curry? — Resume, or Discard and start", () => {
    expect(discardPrompt(curry())).toMatchObject({ title: "Finish or discard Chicken curry?", resume: "Resume", discard: "Discard and start" });
    expect(discardPrompt(blankSession(NOW)).title).toBe("Finish or discard this dish?");
  });

  describe("signing out", () => {
    const g = globalThis as unknown as { window?: unknown };
    const hadWindow = "window" in g;
    let local: ReturnType<typeof memoryStorage>;
    beforeEach(() => {
      local = memoryStorage();
      g.window = {
        localStorage: local,
        sessionStorage: memoryStorage(),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      };
    });
    afterAll(() => {
      if (!hadWindow) delete g.window;
    });

    it("forgets every account's session with the other device records, keeping the token and target", () => {
      cookSessions.write(ME, curry());
      cookSessions.write(MEERA, setName(blankSession(NOW), "Poha"));
      local.setItem("cookpool.next.token", "tok");
      local.setItem("cookpool.next.target", "stage");
      expect(cookSessions.read(ME)).not.toBeNull();
      clearDeviceRecords();
      expect(cookSessions.read(ME)).toBeNull();
      expect(cookSessions.read(MEERA)).toBeNull();
      expect([...local.map.keys()].sort()).toEqual(["cookpool.next.target", "cookpool.next.token"]);
    });
  });
});

describe("a session from a recipe (design §4.2)", () => {
  it("has one line per recipe line, each amount by scaleLine at the factor", () => {
    const s = curry();
    expect(s).toMatchObject({ recipeId: RECIPE_ID, factorMilli: 450, name: "Chicken curry", servesHalf: 8, mine: true, startedAt: NOW.toISOString() });
    expect(s.lines.map((l) => l.key)).toEqual(["r:0", "r:1", "r:2", "r:3", "r:4", "r:5"]);
    expect(s.lines.map((l) => l.recipeLine)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s.lines.map((l) => (l.qtyMilli === null ? "To taste" : amountText(l.qtyMilli, l.unit!)))).toEqual([
      "450 g",
      "2 onions",
      "90 g",
      "½ tsp",
      "To taste",
      "1 tbsp",
    ]);
    expect(s.steps.map((x) => x.done)).toEqual([false, false, false, false, false]);
  });

  it("takes the match's items, one take per item", () => {
    const s = curry();
    expect(s.lines.map((l) => l.takes.map((t) => [t.itemId, t.matchMilli]))).toEqual([
      [[CHICKEN.id, 450_000]],
      [[ONIONS.id, 300_000]],
      [],
      [],
      [],
      [[OIL.id, 15_000]],
    ]);
    // A line the match fills from two items takes from both, the first first.
    const two: RecipeMatchResponse = {
      ...MATCH,
      lines: MATCH.lines.map((l) => (l.position === 1 ? { ...l, items: [matchItem(ONIONS, 200_000), matchItem(RICE, 100_000)] } : l)),
    };
    const t = sessionFromRecipe(RECIPE, null, two, NOW).lines[1]!;
    expect(t.takes.map((x) => x.itemId)).toEqual([ONIONS.id, RICE.id]);
  });

  it("says where each comes from and what went in last time", () => {
    const views = curry().lines.map((l) => sessionLineView(l, { meId: ME, names: NAMES }));
    expect(views.map((v) => v.sub)).toEqual([
      "Your kitchen · last time 500 g",
      "Flat 4B · Meera paid · last time 2 onions",
      "Not in your kitchen · left out",
      "Always have",
      "Always have",
      "Flat 4B · you paid",
    ]);
    expect(sessionFromRecipe(RECIPE, null, MATCH, NOW).lines.every((l) => l.lastTime === null)).toBe(true);
  });

  it("keeps a missing line, struck through and left out: it ticks (RV-16), but nothing of it posts", () => {
    const s = curry();
    const yogurt = sessionLineView(s.lines[2]!, { meId: ME });
    expect(yogurt).toMatchObject({ missing: true, tickable: true, canEdit: false, amount: "90 g" });
    const ticked = tickLine(s, "r:2");
    expect(ticked.lines[2]!.ticked).toBe(true);
    expect(includedLines(s, "all").map((l) => l.key)).toEqual(["r:0", "r:1", "r:3", "r:4", "r:5"]);
    expect(includedLines(ticked, "out").map((l) => l.key)).toEqual([]);
    expect(progressText(s)).toBe("0 of 6 in");
    expect(progressText(ticked)).toBe("1 of 6 in");
  });

  it("ticks to-taste lines without an amount", () => {
    const salt = sessionLineView(curry().lines[4]!, { meId: ME });
    expect(salt).toMatchObject({ amount: "To taste", canEdit: false, tickable: true, costNote: "not counted" });
    expect(tickLine(curry(), "r:4").lines[4]!.ticked).toBe(true);
  });

  it("heads the screen with the scale chip, opening the recipe, and the steps", () => {
    const s = curry();
    expect(scaleChip(s)).toEqual({ label: "For about 2 · ×0.45", href: `/recipes/${RECIPE_ID}?f=450` });
    expect(scaleChip(blankSession(NOW))).toBeNull();
    expect(stepsTitle(s)).toBe("Steps · 0 of 5");
    expect(stepsTitle(toggleStep(toggleStep(s, 0), 3))).toBe("Steps · 2 of 5");
    expect(elapsedText(NOW.toISOString(), new Date(NOW.getTime() + 12 * 60_000 + 4_000))).toBe("12:04");
    expect(elapsedText(NOW.toISOString(), new Date(NOW.getTime() + 3_724_000))).toBe("1:02:04");
  });

  it("reads the items fresh: less left cuts the take, an item gone leaves it out", () => {
    const s = curry();
    expect(refreshTakes(s, ITEMS)).toBe(s);
    const fewer = refreshTakes(s, new Map([[ONIONS.id, { ...ONIONS, version: 2, qtyLeftMilli: 100_000, worthMinor: 400 }]]));
    expect(lineTakes(fewer.lines[1]!).map((t) => t.milli)).toEqual([100_000]);
    expect(sessionLineView(fewer.lines[1]!, { meId: ME, names: NAMES }).sub).toBe("Flat 4B · Meera paid · short · last time 2 onions");
    const gone = refreshTakes(s, new Map([[OIL.id, null]]));
    expect(sessionLineView(gone.lines[5]!, { meId: ME }).sub).toBe("None left now");
    expect(finishPlan(gone, { unticked: "all", postTo: FLAT.orgId, halves: {}, roster: ROSTER, meId: ME, save: false }, { groups: GROUPS }))
      .toMatchObject({ ok: true, plan: { request: { ingredients: [{ itemId: CHICKEN.id }, { itemId: ONIONS.id }] } } });
  });
});

describe("a blank session, with from before (design §4.5)", () => {
  const FRIED_RICE: Recipe = {
    name: "Egg fried rice",
    times: 3,
    lastCookedAt: "2026-11-02T13:00:00.000Z",
    portionsHalf: 4,
    extrasMinor: 0,
    totalMinor: 15_600,
    currency: "INR",
    orgId: LUNCH.orgId,
    ingredients: [
      {
        name: "Rice",
        qtyMilli: 300_000,
        quantity: 300,
        unit: "g",
        dimension: "mass",
        pantry: { kind: "group", orgId: LUNCH.orgId, name: LUNCH.name },
        match: { itemId: RICE.id, ref: `org:${LUNCH.orgId}:${RICE.id}`, pantry: groupRef(LUNCH), qtyLeftMilli: RICE.qtyLeftMilli, canUse: true },
      },
      { name: "Eggs", qtyMilli: 3_000, quantity: 3, unit: "pcs", dimension: "count", pantry: null, match: null },
    ],
  };

  it("starts with no name and no lines: nothing for the bar yet", () => {
    const s = blankSession(NOW);
    expect(s).toMatchObject({ recipeId: null, factorMilli: null, name: "", lines: [], steps: [], postTo: null });
    expect(isEmptySession(s)).toBe(true);
    expect(isEmptySession(setName(s, "Dal"))).toBe(false);
  });

  it("fills a dish cooked before: its name, its lines at last time's amounts, and who it was for", () => {
    const s = refreshTakes(fillFromBefore(blankSession(NOW), FRIED_RICE, { groups: GROUPS }), ITEMS);
    expect(s.name).toBe("Egg fried rice");
    expect(s.postTo).toBe(LUNCH.orgId);
    expect(s.lines.map((l) => [l.key, l.name, amountText(l.qtyMilli!, l.unit!), l.missing])).toEqual([
      ["p:0", "Rice", "300 g", false],
      ["p:1", "Eggs", "3 pcs", true],
    ]);
    expect(sessionLineView(s.lines[0]!, { meId: ME, names: NAMES }).sub).toBe("Lunch club · Meera paid · last time 300 g");
  });

  it("replaces what a previous pick put in, keeping what was added by hand", () => {
    const added = addItemLine(fillFromBefore(blankSession(NOW), FRIED_RICE, { groups: GROUPS }), CHICKEN);
    const again = fillFromBefore(added, { ...FRIED_RICE, ingredients: FRIED_RICE.ingredients.slice(0, 1) }, { groups: GROUPS });
    expect(again.lines.map((l) => l.key)).toEqual(["p:0", `i:${CHICKEN.id}`]);
  });
});

describe("ticks", () => {
  it("tick a line in, and out again, counting what is in", () => {
    const s = tickLine(curry(), "r:0");
    expect(s.lines[0]!.ticked).toBe(true);
    expect(sessionLineView(s.lines[0]!, { meId: ME })).toMatchObject({ ticked: true, checkLabel: "Untick Chicken" });
    expect(progressText(tickLine(s, "r:1"))).toBe("2 of 6 in");
    expect(tickLine(s, "r:0").lines[0]!.ticked).toBe(false);
  });
});

describe("the amount stepper", () => {
  it("steps by the unit: 50 g (10 below 100), ½ for pieces, count words and spoons", () => {
    expect([stepAmount(450_000, "g", 1), stepAmount(450_000, "g", -1)]).toEqual([500_000, 400_000]);
    expect([stepAmount(90_000, "g", 1), stepAmount(90_000, "g", -1)]).toEqual([100_000, 80_000]);
    expect([stepAmount(100_000, "g", 1), stepAmount(100_000, "g", -1)]).toEqual([150_000, 90_000]);
    expect([stepAmount(2_000, "onion", 1), stepAmount(2_000, "onion", -1)]).toEqual([2_500, 1_500]);
    expect([stepAmount(2_500, "tsp", 1), stepAmount(2_500, "tsp", -1)]).toEqual([5_000, null]);
    expect([stepAmount(15_000, "tbsp", 1), stepAmount(1_000, "pcs", -1)]).toEqual([22_500, 500]);
  });

  it("moves what the line takes in proportion, and shows what that is and costs", () => {
    const s = curry();
    expect(sessionLineView(s.lines[0]!, { meId: ME }).costNote).toBe("₹126");
    expect(sessionLineView(s.lines[1]!, { meId: ME }).costNote).toBe("≈ 300 g · ₹12");
    expect(sessionLineView(s.lines[5]!, { meId: ME }).costNote).toMatch(/^≈ 15 ml · ₹2\.7\d$/);
    const more = stepLine(s, "r:1", 1);
    expect(amountText(more.lines[1]!.qtyMilli!, "onion")).toBe("2½ onions");
    expect(lineTakes(more.lines[1]!).map((t) => t.milli)).toEqual([375_000]);
    expect(sessionLineView(more.lines[1]!, { meId: ME })).toMatchObject({ amount: "2½ onions", costNote: "≈ 375 g · ₹15", lessLabel: "Less onions" });
    expect(stepLine(stepLine(more, "r:1", -1), "r:1", -1).lines[1]!.qtyMilli).toBe(1_500);
  });

  it("never takes more than an item has left: the line says so", () => {
    const big = setLineAmount(curry(), "r:0", 1_100_000);
    expect(lineTakes(big.lines[0]!).map((t) => t.milli)).toEqual([1_000_000]);
    expect(sessionLineView(big.lines[0]!, { meId: ME })).toMatchObject({ short: true, costNote: "₹280 · all there is" });
  });

  it("can't step a line below one step, nor a to-taste or missing line at all", () => {
    const s = curry();
    expect(stepLine(s, "r:3", -1)).toBe(s);
    expect(stepLine(s, "r:4", 1)).toBe(s);
    expect(sessionLineView(s.lines[3]!, { meId: ME })).toMatchObject({ canEdit: true, canLess: false, canMore: true, costNote: "not counted" });
  });
});

describe("Add an item", () => {
  it("adds a line with the item, at its starting amount, once", () => {
    const s = addItemLine(curry(), RICE);
    const rice = s.lines[6]!;
    expect(rice).toMatchObject({ key: `i:${RICE.id}`, name: "Rice", recipeLine: null, unit: "g", qtyMilli: 400_000, missing: false });
    expect(rice.takes.map((t) => [t.itemId, t.orgId, t.pantryName])).toEqual([[RICE.id, LUNCH.orgId, "Lunch club"]]);
    expect(addItemLine(s, RICE)).toBe(s);
    expect(sessionLineView(rice, { meId: ME, names: NAMES }).sub).toBe("Lunch club · Meera paid");
  });

  it("adds something just bought, which posts as a new item", () => {
    const s = addBoughtLine(blankSession(NOW), {
      kind: "new",
      key: "new:1",
      name: "Coriander",
      quantity: "100",
      unit: "g",
      dimension: "mass",
      qtyMilli: 100_000,
      priceMinor: 1_000,
      useMilli: 100_000,
    });
    expect(s.lines[0]).toMatchObject({ key: "b:1", name: "Coriander", unit: "g", qtyMilli: 100_000 });
    expect(sessionLineView(s.lines[0]!, { meId: ME })).toMatchObject({ sub: "Just bought", costNote: "₹10" });
    const half = stepLine(s, "b:1", -1);
    const planned = finishPlan(setName(half, "Chutney"), { unticked: "all", postTo: JUST_ME, halves: {}, roster: null, meId: ME, save: false }, { groups: GROUPS });
    expect(planned).toMatchObject({
      ok: true,
      plan: { request: { newItems: [{ name: "Coriander", category: "other", quantity: "100", unit: "g", priceMinor: 1_000, useQuantity: "90", useUnit: "g" }] } },
    });
  });
});

describe("the Finish sheet", () => {
  it("asks about the lines not ticked: Took them all (the default) or Leave them out", () => {
    const s = tickLine(curry(), "r:0");
    expect(untickedText(s)).toBe("4 not ticked");
    expect(untickedText(["r:0", "r:1", "r:3", "r:4", "r:5"].reduce(tickLine, curry()))).toBeNull();
    expect(includedLines(s, "all").map((l) => l.key)).toEqual(["r:0", "r:1", "r:3", "r:4", "r:5"]);
    expect(includedLines(s, "out").map((l) => l.key)).toEqual(["r:0"]);
  });

  it("starts who ate with you at 1 and everyone else at 0, in ½ steps", () => {
    const start = startingEaters(ME);
    expect(start).toEqual({ [ME]: 2 });
    expect(stepEater(start, MEERA, -1)).toEqual({ [ME]: 2 });
    const two = stepEater(stepEater(start, MEERA, 1), MEERA, 1);
    expect(two).toEqual({ [ME]: 2, [MEERA]: 2 });
    const view = finishEaters({ roster: ROSTER, meId: ME, halves: two, totalMinor: 10_000, names: NAMES });
    expect(view.portionsHalf).toBe(4);
    expect(view.rows.map((r) => [r.label, r.portions, r.amountMinor])).toEqual([
      ["You", "1", 5_000],
      ["Meera", "1", 5_000],
      ["Kiran", "0", 0],
    ]);
    const odd = finishEaters({ roster: ROSTER, meId: ME, halves: { [ME]: 2, [MEERA]: 1 }, totalMinor: 9_999, names: NAMES });
    expect(odd.rows.reduce((a, r) => a + r.amountMinor, 0)).toBe(9_999);
    expect(odd.rows[1]).toMatchObject({ portions: "½", lessLabel: "Half a portion less for Meera" });
  });

  it("posts to the group most of the ingredients came from, else the one opened last, else just you", () => {
    expect(defaultPostTo(curry(), GROUPS)).toBe(FLAT.orgId);
    const mine = refreshTakes(addItemLine(blankSession(NOW), CHICKEN), ITEMS);
    expect(defaultPostTo(mine, GROUPS, [LUNCH.slug])).toBe(LUNCH.orgId);
    expect(defaultPostTo(mine, [])).toBe(JUST_ME);
    // A group you only view is never where it posts.
    expect(defaultPostTo(curry(), [{ ...group(FLAT), role: "viewer" }])).toBe(JUST_ME);
    expect(postToOf(setPostTo(curry(), JUST_ME), GROUPS)).toBe(JUST_ME);
    expect(postToOf(setPostTo(curry(), LUNCH.orgId), GROUPS)).toBe(LUNCH.orgId);
    expect(postToOf(setPostTo(curry(), "org_00000000000000000000000000000999"), GROUPS)).toBe(FLAT.orgId);
  });

  it("puts the cost so far and where it posts under Finish", () => {
    expect(finishButtonText(curry(), "Flat 4B")).toBe("Nothing in yet · post to Flat 4B");
    expect(finishButtonText(tickLine(curry(), "r:0"), "Flat 4B")).toBe("₹126.00 so far · post to Flat 4B");
    expect(finishButtonText(tickLine(curry(), "r:0"), null)).toBe("₹126.00 so far · just for you");
  });

  it("offers Save today's amounts only on your own recipe once an amount differs; Save as a recipe when blank", () => {
    const s = curry();
    expect(saveSwitch(s)).toBeNull();
    const changed = stepLine(s, "r:1", 1);
    expect(saveSwitch(changed)).toEqual({ kind: "amounts", label: "Save today's amounts to my recipe" });
    expect(saveSwitch({ ...changed, mine: false })).toBeNull();
    expect(saveSwitch(blankSession(NOW))).toEqual({ kind: "recipe", label: "Save as a recipe" });
  });

  it("brings today's changed amounts back to the recipe's own size, every other line as written", () => {
    const changed = stepLine(curry(), "r:1", 1);
    expect(todaysRecipeLines(changed)).toEqual([
      { foodKey: "chicken", name: "Chicken", quantity: 1000, unit: "g", toTaste: false, isMain: true },
      { foodKey: "onion", name: "Onions", quantity: 5.5, unit: "onion", toTaste: false, isMain: false },
      { foodKey: "yogurt", name: "Yogurt", quantity: 200, unit: "g", toTaste: false, isMain: false },
      { foodKey: "garam_masala", name: "Garam masala", quantity: 1, unit: "tsp", toTaste: false, isMain: false },
      { foodKey: "salt", name: "Salt", quantity: null, unit: null, toTaste: true, isMain: false },
      { foodKey: "oil", name: "Cooking oil", quantity: 2, unit: "tbsp", toTaste: false, isMain: false },
    ]);
  });
});

/** A dish as the cook write answers it (the fields Finish reads). */
function dishOf(request: { name: string; orgId?: string | null }, id = "dsh_00000000000000000000000000000f01"): KitchenDish {
  return {
    id,
    cook: ME,
    orgId: request.orgId ?? null,
    name: request.name,
    portionsHalf: 4,
    portions: 2,
    extrasMinor: 0,
    ingredientsMinor: 14_078,
    totalMinor: 14_078,
    currency: "INR",
    splitMode: "claims",
    state: "open",
    txnId: null,
    leftoverItemId: null,
    cookedAt: NOW.toISOString(),
    finalizedAt: null,
    canceledAt: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ingredients: [],
    fromMineMinor: 0,
    owes: [],
    shares: [],
    myClaimHalf: 0,
    claimedHalf: 0,
    unclaimedHalf: 4,
    unclaimedMinor: 0,
    amounts: [],
    netting: [],
  };
}

/** The client, recording each write in order. */
function fakeDeps(o: { offline?: boolean; cook?: FinishDeps["cookDish"]; shares?: FinishDeps["setShares"] } = {}) {
  const calls: { what: string; args: unknown[] }[] = [];
  const deps: FinishDeps = {
    offline: () => o.offline ?? false,
    cookDish: async (request) => {
      calls.push({ what: "cook", args: [request] });
      return o.cook ? o.cook(request) : { ok: true, data: { dish: dishOf(request) } };
    },
    setShares: async (orgId, dishId, body) => {
      calls.push({ what: "shares", args: [orgId, dishId, body] });
      return o.shares ? o.shares(orgId, dishId, body) : { ok: true, data: { dish: dishOf({ name: "x", orgId }, dishId) } };
    },
    updateRecipe: async (recipeId, body) => {
      calls.push({ what: "updateRecipe", args: [recipeId, body] });
      return { ok: true, data: {} };
    },
    createRecipe: async (body) => {
      calls.push({ what: "createRecipe", args: [body] });
      return { ok: true, data: {} };
    },
  };
  return { deps, calls };
}

function plan(s: CookSession, o: Partial<Parameters<typeof finishPlan>[1]> = {}): FinishPlan {
  const r = finishPlan(s, { unticked: "all", postTo: FLAT.orgId, halves: { [ME]: 2, [MEERA]: 2 }, roster: ROSTER, meId: ME, save: false, ...o }, { groups: GROUPS });
  if (!r.ok) throw new Error(r.problem.message);
  return r.plan;
}

describe("Finish posts (design §4.3)", () => {
  it("cooks the dish with recipeId, recipeFactorMilli and each ingredient's recipeLine, in claims mode", () => {
    expect(plan(curry()).request).toEqual({
      name: "Chicken curry",
      orgId: FLAT.orgId,
      portionsHalf: 4,
      splitMode: "claims",
      ingredients: [
        { itemId: CHICKEN.id, quantity: "450", unit: "g", recipeLine: 0 },
        { itemId: ONIONS.id, quantity: "300", unit: "g", recipeLine: 1 },
        { itemId: OIL.id, quantity: "15", unit: "ml", recipeLine: 5 },
      ],
      recipeId: RECIPE_ID,
      recipeFactorMilli: 450,
    });
  });

  it("leaves the unticked out when asked, and names an item once when two lines take from it", () => {
    const s = tickLine(curry(), "r:0");
    expect(plan(s, { unticked: "out" }).request.ingredients).toEqual([{ itemId: CHICKEN.id, quantity: "450", unit: "g", recipeLine: 0 }]);
    const twice = addItemLine(curry(), ONIONS);
    expect(plan(twice).request.ingredients).toEqual([
      { itemId: CHICKEN.id, quantity: "450", unit: "g", recipeLine: 0 },
      // 300 g for the recipe's line, 200 g added by hand: one ingredient, for the first line.
      { itemId: ONIONS.id, quantity: "500", unit: "g", recipeLine: 1 },
      { itemId: OIL.id, quantity: "15", unit: "ml", recipeLine: 5 },
    ]);
  });

  it("sets who ate through the shares route, right after cooking: you first, then the group's order", async () => {
    const p = plan(curry());
    expect(p.shares).toEqual({ shares: [{ subjectId: ME, portionsHalf: 2 }, { subjectId: MEERA, portionsHalf: 2 }] });
    const { deps, calls } = fakeDeps();
    const out = await runFinish(p, deps);
    expect(out.ok).toBe(true);
    expect(calls.map((c) => c.what)).toEqual(["cook", "shares"]);
    expect(calls[1]!.args).toEqual([FLAT.orgId, "dsh_00000000000000000000000000000f01", p.shares]);
  });

  it("just for you: no group, no who ate, one portion, and assign (the server takes claims only in a group)", async () => {
    const p = plan(curry(), { postTo: JUST_ME, roster: null });
    expect(p.request).toMatchObject({ orgId: null, portionsHalf: 2, splitMode: "assign", recipeId: RECIPE_ID });
    expect(p.shares).toBeNull();
    const { deps, calls } = fakeDeps();
    await runFinish(p, deps);
    expect(calls.map((c) => c.what)).toEqual(["cook"]);
  });

  it("at least ½ portion when nobody is down as eating", () => {
    const p = plan(curry(), { halves: {} });
    expect(p.request.portionsHalf).toBe(1);
    expect(p.shares).toBeNull();
  });

  it("saves today's amounts to your recipe after the dish, when the switch is on", async () => {
    const changed = stepLine(curry(), "r:1", 1);
    const { deps, calls } = fakeDeps();
    await runFinish(plan(changed, { save: true }), deps);
    expect(calls.map((c) => c.what)).toEqual(["cook", "shares", "updateRecipe"]);
    expect(calls[2]!.args).toEqual([RECIPE_ID, { lines: todaysRecipeLines(changed) }]);
    // Off, or with nothing changed, it writes no recipe.
    expect(plan(changed).recipe).toBeNull();
    expect(plan(curry(), { save: true }).recipe).toBeNull();
  });

  it("saves a blank session as a recipe from the dish it posted", async () => {
    const s = refreshTakes(addItemLine(setName(blankSession(NOW), "Poha"), RICE), ITEMS);
    const p = plan(s, { postTo: LUNCH.orgId, save: true });
    expect(p.request).toEqual({
      name: "Poha",
      orgId: LUNCH.orgId,
      portionsHalf: 4,
      splitMode: "claims",
      ingredients: [{ itemId: RICE.id, quantity: "400", unit: "g" }],
    });
    const { deps, calls } = fakeDeps();
    await runFinish(p, deps);
    expect(calls.map((c) => c.what)).toEqual(["cook", "shares", "createRecipe"]);
    expect(calls[2]!.args).toEqual([{ fromDishId: "dsh_00000000000000000000000000000f01" }]);
  });

  it("won't post without a name", () => {
    const blank = blankSession(NOW);
    expect(finishPlan(blank, { unticked: "all", postTo: JUST_ME, halves: {}, roster: null, meId: ME, save: false }, { groups: GROUPS })).toMatchObject({
      ok: false,
      problem: { field: "name" },
    });
  });

  it("posts a dish with no amounts as one with no ingredients (cookpool-revamp RV-7)", () => {
    const own = { unticked: "out", postTo: JUST_ME, halves: {}, roster: null, meId: ME, save: false } as const;
    // Nothing ticked and Leave them out: the recipe's dish, with nothing in it.
    const left = finishPlan(curry(), own, { groups: GROUPS });
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    expect(left.plan.request).toEqual({
      name: "Chicken curry",
      orgId: null,
      portionsHalf: 2,
      splitMode: "assign",
      recipeId: RECIPE_ID,
      recipeFactorMilli: 450,
    });
    expect(left.plan.request).not.toHaveProperty("ingredients");
    expect(left.plan.request).not.toHaveProperty("newItems");
    expect(left.plan.dishLines).toEqual([]);
    expect(left.plan.totals.totalMinor).toBe(0);

    // A named blank session with no lines at all, shared with a group: Who ate still counts.
    const blank = finishPlan(setName(blankSession(NOW), "Maggi"), { ...own, unticked: "all", postTo: FLAT.orgId, halves: { [ME]: 2, [MEERA]: 2 }, roster: ROSTER }, { groups: GROUPS });
    expect(blank.ok && blank.plan.request).toEqual({ name: "Maggi", orgId: FLAT.orgId, portionsHalf: 4, splitMode: "claims" });
    expect(blank.ok && blank.plan.shares).toEqual({ shares: [{ subjectId: ME, portionsHalf: 2 }, { subjectId: MEERA, portionsHalf: 2 }] });

    // Lines without an amount (salt, to taste) are in the dish but never charged.
    const salt = tickLine(curry(), "r:4");
    const saltOnly = finishPlan(salt, own, { groups: GROUPS });
    expect(saltOnly.ok && saltOnly.plan.request).not.toHaveProperty("ingredients");
  });

  it("still refuses too many items, whatever the amounts", () => {
    let s = setName(blankSession(NOW), "Feast");
    for (let i = 0; i < 31; i++) {
      s = addItemLine(s, makeItem({ name: `Spice ${i}`, pantry: PERSONAL_REF, unit: "g", bought: "100", priceMinor: 1000, paidBy: ME }));
    }
    expect(finishPlan(s, { unticked: "all", postTo: JUST_ME, halves: {}, roster: null, meId: ME, save: false }, { groups: GROUPS })).toMatchObject({
      ok: false,
      problem: { field: "lines" },
    });
  });

  it("on a refusal, says why and points at the line; nothing else is written", async () => {
    const { deps, calls } = fakeDeps({
      cook: async () => ({
        ok: false,
        status: 409,
        error: { code: "conflict", reason: "insufficient_stock", message: "Not enough", details: { itemId: ONIONS.id, qtyLeftMilli: 100_000 } },
      }),
    });
    const out = await runFinish(plan(curry()), deps);
    expect(out).toEqual({
      ok: false,
      kind: "refused",
      message: "Only 100 g of Onions left now — someone used some meanwhile. Check the amount and cook again.",
      lineKey: "r:1",
      answered: true,
    });
    expect(calls.map((c) => c.what)).toEqual(["cook"]);
  });

  it("leaves the dish cooked when the shares can't be set, and says so", async () => {
    const { deps } = fakeDeps({
      shares: async () => ({ ok: false, status: 422, error: { code: "validation_failed", reason: "not_in_group", message: "x" } }),
    });
    const out = await runFinish(plan(curry()), deps);
    expect(out).toMatchObject({ ok: true, sharesError: "Someone you named has left the group. Set who ate on the dish page." });
  });

  it("offline, says You're offline, sends nothing, and the session stays", async () => {
    const storage = memoryStorage();
    const store = createCookSessionStore({ storage: () => storage, prefix: () => "cookpool.next" });
    store.write(ME, curry());
    const { deps, calls } = fakeDeps({ offline: true });
    const out = await runFinish(plan(curry()), deps);
    expect(out).toEqual({ ok: false, kind: "offline", message: FINISH_OFFLINE_TEXT });
    expect(FINISH_OFFLINE_TEXT.startsWith("You're offline")).toBe(true);
    expect(calls).toEqual([]);
    expect(store.read(ME)).toEqual(curry());
    // The API client's own refusal while the page thought it was online reads the same.
    const late = fakeDeps({ cook: async () => ({ ok: false, status: 0, error: { code: "network_error", reason: "offline", message: "x" } }) });
    expect(await runFinish(plan(curry()), late.deps)).toEqual({ ok: false, kind: "offline", message: FINISH_OFFLINE_TEXT });
  });
});

describe("the bar on every tab (design §4.4)", () => {
  const s = tickLine(curry(), "r:0");
  const later = new Date(NOW.getTime() + 12 * 60_000 + 30_000);

  it("says what is cooking, for how long and how far, with Resume to the session", () => {
    expect(sessionBarView(s, later)).toEqual({ name: "Chicken curry", meta: "Cooking · 12 min · 1 of 6 in", href: "/cook/session" });
    expect(sessionBarView(s, new Date(NOW.getTime() + 65 * 60_000))?.meta).toBe("Cooking · 1 h 5 min · 1 of 6 in");
    expect(sessionBarView(null, later)).toBeNull();
    expect(sessionBarView(blankSession(NOW), later)).toBeNull();
  });

  it("shows on every tab while a session is open, and not on the session itself", () => {
    for (const path of ["/home", "/pantry", "/cook", "/money", "/you", "/you/settings", "/groups/flat-4b-k3x9", "/people"]) {
      expect([path, sessionBarShows(path, s)]).toEqual([path, true]);
    }
    expect(sessionBarShows("/cook/session", s)).toBe(false);
    expect(sessionBarShows("/cook/session/", s)).toBe(false);
  });

  it("stays off the forms whose own main button sits there, and off when nothing is cooking", () => {
    for (const path of ["/use", "/pantry/new", "/pantry/me:itm_1", "/dishes/dsh_1", "/groups/flat-4b-k3x9/expense", "/recipes/rcp_1", "/recipes/new", "/recipes/rcp_1/edit"]) {
      expect([path, sessionBarShows(path, s)]).toEqual([path, false]);
    }
    expect(sessionBarShows("/home", null)).toBe(false);
    expect(sessionBarShows("/home", blankSession(NOW))).toBe(false);
  });

  it("is dark, with the pot in the cook colour and a white Resume", () => {
    const html = renderToStaticMarkup(React.createElement(SessionBarCard, { view: sessionBarView(s, later)!, placement: "phone" }));
    expect(html).toContain("Chicken curry");
    expect(html).toContain("Cooking · 12 min · 1 of 6 in");
    expect(html).toContain('href="/cook/session"');
    expect(html).toContain(">Resume<");
    // RV-4: the cook strip's tokens (ink in light, the tint in dark), the pot in the cook colour.
    expect(html).toContain("background-color:hsl(var(--cp-cook-bg))");
    expect(html).toContain("bg-cp-cook text-cp-on-cook");
    expect(html).toContain("data-toast-above");
    const side = renderToStaticMarkup(React.createElement(SessionBarCard, { view: sessionBarView(s, later)!, placement: "sidebar" }));
    expect(side).not.toContain("fixed");
    expect(side).toContain(">Resume<");
  });

  it("hides while a field has the phone's keyboard up", () => {
    expect(opensKeyboard({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(opensKeyboard({ tagName: "input", type: "search" })).toBe(true);
    expect(opensKeyboard({ tagName: "TEXTAREA" })).toBe(true);
    expect(opensKeyboard({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(opensKeyboard({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(opensKeyboard({ tagName: "BUTTON" })).toBe(false);
    expect(opensKeyboard(null)).toBe(false);
  });
});

describe("a row, as drawn", () => {
  const s = tickLine(curry(), "r:0");
  const row = (key: string, open = false) => {
    const view = sessionLineView(s.lines.find((l) => l.key === key)!, { meId: ME, names: NAMES });
    return renderToStaticMarkup(
      React.createElement(SessionRow, { view, open, flagged: false, last: false, onTick: () => undefined, onToggle: () => undefined, onStep: () => undefined }),
    );
  };

  it("tints a ticked row and fills its 44 px tick", () => {
    const html = row("r:0");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("bg-cp-accent-tint");
    expect(html).toContain("h-11 w-11");
    expect(html).toContain('aria-label="Untick Chicken"');
  });

  it("strikes a missing line through, with a tick it keeps (RV-16)", () => {
    const html = row("r:2");
    expect(html).toContain("line-through");
    expect(html).not.toContain("border-dashed");
    expect(html).toContain('aria-label="Tick Yogurt"');
    expect(html).not.toMatch(/aria-pressed="false"[^>]*disabled=""/);
    expect(html).toContain("Not in your kitchen · left out");
  });

  it("opens − and + under the amount, with what it takes and costs", () => {
    const shut = row("r:1");
    expect(shut).toContain('aria-expanded="false"');
    expect(shut).not.toContain("Less onions");
    const open = row("r:1", true);
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('aria-label="Less onions"');
    expect(open).toContain('aria-label="More onions"');
    expect(open).toContain("≈ 300 g · ₹12");
  });
});

describe("the session's address, and prod", () => {
  it("is /cook/session, blank or from a recipe at a factor (RC-5's Start cooking)", () => {
    expect(sessionHref()).toBe("/cook/session");
    expect(sessionHref({ recipeId: RECIPE_ID, factorMilli: 450 })).toBe(`/cook/session?recipe=${RECIPE_ID}&f=450`);
    expect(recipeParam(RECIPE_ID)).toBe(RECIPE_ID);
    expect(recipeParam("itm_1")).toBeNull();
    expect([factorParam("450"), factorParam(null), factorParam("0"), factorParam("abc"), factorParam("25000")]).toEqual([450, 1000, 1000, 1000, 1000]);
  });

  it("is a page of its own, in the Cook tab, minimizing to Cook", () => {
    expect(STATIC_PAGES).toContain("/cook/session");
    expect(backParent("/cook/session", {}, { newFrame: true })).toBe("/cook");
  });

  it("sends a prod visitor Home; shows in the new frame", () => {
    expect(frameRedirect("/cook/session", false)).toBe("/home");
    expect(frameRedirect("/cook/session", true)).toBeNull();
  });
});
