import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CookNowEntry, RecipeSummary } from "@saas/contracts/kitchen";
import { resetAppConfigForTests } from "@web-console-next/lib/app-config";
import { frameRedirect, newFrame } from "@web-console-next/lib/features";
import { applyPatches, rollbackPatches, type CacheKey, type CacheLike } from "@web-console-next/lib/optimistic";
import { qk } from "@web-console-next/lib/query-keys";
import { backParent } from "@web-console-next/components/kitchen/back";
import {
  HOME_COOK_NOW,
  cookNowCounts,
  cookNowFilterLabel,
  cookNowRows,
  HUB_FIRST,
  cookNowHubRows,
  cookNowStartFactor,
  cookPageShows,
  defaultCookNowFilter,
  homeCookNowCards,
  ingredientNames,
  ingredientsTeaser,
  myRecipeCards,
  profileHref,
  profileListFrom,
  profileRecipeRows,
  recipeAddedPatches,
  recipeRemovedPatches,
  recipeStats,
  RECIPE_TILE_COLORS,
  recipeTile,
  savedCopyOf,
  savedHubRows,
  hubMatches,
  showsCookNow,
  sortMyRecipes,
} from "@web-console-next/components/kitchen/cook-hub";
import { CookHubView, CookNowStrip, HubList, YourRecipes } from "@web-console-next/components/kitchen/cook-hub-views";
import { ANU, cookNow, recipe, summary } from "./kitchen-recipe-fixtures";

// cookpool-recipes RC-5 (design §1.2, §1.4, §5.4, §8; the canvas's
// `CookTab`, `NewHome`, `Profile`): `/cook` is the Cook hub in the new frame
// and today's cook screen in prod; Cook now, My recipes, Home's strip and
// You's recipes.

const g = globalThis as unknown as { window?: { location: { host: string } } };

function onHost<T>(host: string, run: () => T): T {
  const had = g.window;
  g.window = { location: { host } };
  resetAppConfigForTests();
  try {
    return run();
  } finally {
    if (had === undefined) delete g.window;
    else g.window = had;
    resetAppConfigForTests();
  }
}

const PROD = "cookpool.store";
const STAGE = "stage.cookpool.store";
// In the viewer's calendar, as the app's `dayText` reads it: noon on 8 Nov.
const NOW = new Date(2026, 10, 8, 12, 0);
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

const ENTRIES: CookNowEntry[] = [
  cookNow("rcp_efr", "Egg fried rice", 0, { lines: 5, forPortionsHalf: 6, servesHalf: 6 }),
  cookNow("rcp_jeera", "Jeera rice", 0, { lines: 4, forPortionsHalf: 8, servesHalf: 8 }),
  cookNow("rcp_chai", "Masala chai", 0, { lines: 4, forPortionsHalf: 12, servesHalf: 6, maxFactorMilli: 20_000 }),
  cookNow("rcp_curry", "Chicken curry", 1, { missingNames: ["Yogurt"], servesHalf: 4 }),
  cookNow("rcp_poha", "Poha", 1, { missingNames: ["Poha"], servesHalf: 6 }),
  cookNow("rcp_biryani", "Biryani", 3, { missingNames: ["Basmati", "Saffron", "Mint"] }),
];

describe("/cook in each frame", () => {
  it("is the Cook hub in the new frame, today's dish maker in prod", () => {
    expect(cookPageShows(true, null)).toBe("hub");
    expect(cookPageShows(false, null)).toBe("dish-maker");
    expect(onHost(STAGE, () => cookPageShows(newFrame(), null))).toBe("hub");
    expect(onHost(PROD, () => cookPageShows(newFrame(), null))).toBe("dish-maker");
  });

  it("keeps Cook with it (`?item=`) on the dish maker in both frames", () => {
    expect(cookPageShows(true, "me:itm_1")).toBe("dish-maker");
    expect(cookPageShows(false, "me:itm_1")).toBe("dish-maker");
  });

  // RV-4 (the canvas's `RvCook`): the one main button is New dish (a blank
  // session), then Find a recipe, Cook now and Saved recipes.
  it("draws Cook, New dish (a blank session), Find a recipe, Cook now and Saved recipes", () => {
    const saved = savedHubRows([summary()], ENTRIES, NOW);
    const out = html(React.createElement(CookHubView, { cookNow: ENTRIES, saved, recipesLoading: false, recipesFailed: false }));
    expect(out).toContain(">Cook</h1>");
    expect(out).toMatch(/href="\/cook\/session"[^>]*>.*New dish/);
    expect(out).toContain('placeholder="Find a recipe"');
    expect(out).toContain("Cook now");
    expect(out).toContain("Saved recipes");
    expect(out).toContain('href="/recipes/new"');
    expect(out.indexOf("New dish")).toBeLessThan(out.indexOf("Find a recipe"));
    expect(out.indexOf("Cook now")).toBeLessThan(out.indexOf("Saved recipes"));
    expect(out).not.toContain("font-extrabold");
    expect(out).not.toMatch(/class="[^"]*#[0-9A-Fa-f]{6}/);
  });

  it("hides Cook now when there is nothing to make (or nothing read yet)", () => {
    for (const cookNowData of [[], null, [cookNow("rcp_x", "X", 2)]]) {
      const out = html(React.createElement(CookHubView, { cookNow: cookNowData, saved: [], recipesLoading: false, recipesFailed: false }));
      expect(out).not.toContain("Cook now");
      expect(out).toContain("No recipes yet");
    }
  });
});

describe("the Cook tab's lists (RV-4)", () => {
  it("Cook now: what you have everything for, Have all, at the size the stock allows", () => {
    const rows = cookNowHubRows(ENTRIES);
    expect(rows.map((r) => [r.name, r.tag, r.tone, r.href])).toEqual([
      ["Egg fried rice", "Have all", "have", "/recipes/rcp_efr"],
      ["Jeera rice", "Have all", "have", "/recipes/rcp_jeera"],
      ["Masala chai", "Have all", "have", "/recipes/rcp_chai?f=2000"],
    ]);
  });

  it("Saved recipes: the rest, last cooked first, each with one tag", () => {
    const rows = savedHubRows(
      [
        summary({ id: "rcp_efr", name: "Egg fried rice" }),
        summary({ id: "rcp_curry", name: "Chicken curry" }),
        summary({ id: "rcp_copy", name: "Paneer bhurji", source: { recipeId: "rcp_0", ownerId: ANU, ownerName: "Anu Thomas" } }),
        summary({ id: "rcp_alo", name: "Aloo paratha", lastCookedAt: "2026-11-08T08:00:00.000Z" }),
        summary({ id: "rcp_poha", name: "Poha", servesHalf: 6 }),
      ],
      ENTRIES,
      NOW,
    );
    expect(rows.map((r) => [r.name, r.tag, r.tone])).toEqual([
      ["Aloo paratha", "Cooked today", "plain"],
      ["Paneer bhurji", "From Anu", "plain"],
      ["Chicken curry", "Need yogurt", "need"],
      ["Poha", "Need poha", "need"],
    ]);
    expect(savedHubRows([summary({ id: "rcp_new", servesHalf: 6 })], null, NOW)[0]!.tag).toBe("Serves 3");
  });

  it("shows three, then See all N; all of them while searching", () => {
    const rows = cookNowHubRows([...ENTRIES, cookNow("rcp_dal", "Dal tadka", 0)]);
    const out = html(React.createElement(HubList, { id: "h", title: "Cook now", rows }));
    expect(rows).toHaveLength(HUB_FIRST + 1);
    expect(out).toContain("· 4");
    expect(out.match(/<li /g)).toHaveLength(HUB_FIRST);
    expect(out).toMatch(/aria-expanded="false"[^>]*>See all 4</);
    const searching = html(React.createElement(HubList, { id: "h", title: "Cook now", rows, searching: true }));
    expect(searching.match(/<li /g)).toHaveLength(4);
    expect(searching).not.toContain("See all");
  });

  it("finds a recipe by any part of its name, in any case", () => {
    expect(hubMatches({ name: "Egg fried rice" }, " FRIED ")).toBe(true);
    expect(hubMatches({ name: "Egg fried rice" }, "")).toBe(true);
    expect(hubMatches({ name: "Egg fried rice" }, "dal")).toBe(false);
    const out = html(React.createElement(CookHubView, { cookNow: ENTRIES, saved: [], recipesLoading: false, recipesFailed: false, initialQuery: "zzz" }));
    expect(out).toContain("Nothing matches");
    expect(out).not.toContain("Cook now");
  });
});

describe("Cook now's filter", () => {
  it("counts what you can make (nothing missing) and what misses one", () => {
    expect(cookNowCounts(ENTRIES)).toEqual({ can: 3, one: 2 });
    expect(cookNowFilterLabel("can", cookNowCounts(ENTRIES))).toBe("Can make 3");
    expect(cookNowFilterLabel("one", cookNowCounts(ENTRIES))).toBe("Missing 1 · 2");
  });

  it("lists Can make: Have all 5 · for 3, each Start at the factor the row says", () => {
    const rows = cookNowRows(ENTRIES, "can");
    expect(rows.map((r) => [r.name, r.meta, r.tone])).toEqual([
      ["Egg fried rice", "Have all 5 · for 3", "have"],
      ["Jeera rice", "Have all 4 · for 4", "have"],
      ["Masala chai", "Have all 4 · for 6", "have"],
    ]);
    expect(rows[0]!.startHref).toBe("/cook/session?recipe=rcp_efr&f=1000");
    // Chai: the stock allows × 20, Cook now caps it at serves × 2 — and Start starts there.
    expect(rows[2]!.startHref).toBe("/cook/session?recipe=rcp_chai&f=2000");
    expect(rows[0]!.href).toBe("/recipes/rcp_efr");
  });

  it("lists Missing 1: Missing yogurt · for 2, starting as written", () => {
    const rows = cookNowRows(ENTRIES, "one");
    expect(rows.map((r) => [r.name, r.meta, r.tone])).toEqual([
      ["Chicken curry", "Missing yogurt · for 2", "muted"],
      ["Poha", "Missing poha · for 3", "muted"],
    ]);
    expect(rows[0]!.startHref).toBe("/cook/session?recipe=rcp_curry&f=1000");
  });

  it("leaves out what misses two or more, and starts on Can make when there is any", () => {
    expect([...cookNowRows(ENTRIES, "can"), ...cookNowRows(ENTRIES, "one")].map((r) => r.id)).not.toContain("rcp_biryani");
    expect(defaultCookNowFilter(ENTRIES)).toBe("can");
    expect(defaultCookNowFilter(ENTRIES.slice(3))).toBe("one");
    expect(showsCookNow(ENTRIES.slice(5))).toBe(false);
    expect(showsCookNow(ENTRIES.slice(3))).toBe(true);
  });

  it("starts a stock-limited recipe at the portions the row says (for 1½ of 4: × 0.375)", () => {
    expect(cookNowStartFactor(cookNow("rcp_a", "A", 0, { forPortionsHalf: 3, servesHalf: 8 }))).toBe(375);
    expect(cookNowStartFactor(cookNow("rcp_b", "B", 1))).toBe(1000);
  });

  it("gives each recipe one tile, its initial on its colour, the same every time", () => {
    const tile = recipeTile({ id: "rcp_curry", name: "chicken curry" });
    expect(tile.initial).toBe("C");
    expect(recipeTile({ id: "rcp_curry", name: "Other" }).bg).toBe(tile.bg);
    // RV-25 (RvCook): the board's seven tint pairs, as tokens, never raw hex.
    expect(RECIPE_TILE_COLORS).toHaveLength(7);
    for (const c of RECIPE_TILE_COLORS) {
      expect(c.bg).toMatch(/^hsl\(var\(--cp-/);
      expect(c.fg).toMatch(/^hsl\(var\(--cp-/);
    }
  });
});

describe("Home's Cook now strip", () => {
  it("holds the first three: Have all · for 3 in green, or Missing 1 · yogurt muted", () => {
    const cards = homeCookNowCards([ENTRIES[3]!, ENTRIES[0]!, ENTRIES[1]!, ENTRIES[2]!]);
    expect(cards).toHaveLength(HOME_COOK_NOW);
    expect(cards.map((c) => [c.name, c.text, c.tone, c.href])).toEqual([
      ["Chicken curry", "Missing 1 · yogurt", "muted", "/recipes/rcp_curry"],
      ["Egg fried rice", "Have all · for 3", "have", "/recipes/rcp_efr"],
      ["Jeera rice", "Have all · for 4", "have", "/recipes/rcp_jeera"],
    ]);
    expect(homeCookNowCards([ENTRIES[5]!])[0]!.text).toBe("Missing 3 · basmati");
  });

  it("shows nothing when Cook now is empty", () => {
    expect(homeCookNowCards([])).toEqual([]);
    expect(html(React.createElement(CookNowStrip, { cards: [] }))).toBe("");
  });

  it("draws 160 px cards scrolling sideways, each opening its recipe, and See all to /cook", () => {
    const out = html(React.createElement(CookNowStrip, { cards: homeCookNowCards(ENTRIES) }));
    expect(out).toContain("Cook now");
    expect(out).toContain('href="/cook"');
    expect(out).toContain("See all");
    expect(out).toContain("overflow-x-auto");
    expect(out.match(/class="w-40 shrink-0"/g)).toHaveLength(3);
    expect(out).toContain('href="/recipes/rcp_efr"');
  });
});

describe("My recipes", () => {
  const cooked = (id: string, at: string | null, createdAt = "2026-10-01T00:00:00.000Z") => summary({ id, name: id, lastCookedAt: at, createdAt });

  it("are last cooked first, never cooked last (newest first among them)", () => {
    const list = [
      cooked("a", null, "2026-10-01T00:00:00.000Z"),
      cooked("b", "2026-11-05T19:00:00.000Z"),
      cooked("c", "2026-11-08T09:00:00.000Z"),
      cooked("d", null, "2026-10-20T00:00:00.000Z"),
    ];
    expect(sortMyRecipes(list).map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("each card: its name, its ingredients on one line, Serves 4 · from Anu · Cooked today, and Start cooking", () => {
    const copy = summary({ source: { recipeId: "rcp_0", ownerId: ANU, ownerName: "Anu Thomas" }, lastCookedAt: "2026-11-08T08:00:00.000Z" });
    const [card] = myRecipeCards([copy], new Map([[copy.id, recipe()]]), NOW);
    expect(card).toEqual({
      id: "rcp_curry",
      name: "Chicken curry",
      href: "/recipes/rcp_curry",
      items: "Chicken, onions, tomatoes, yogurt, ginger-garlic paste, cooking oil, garam masala, salt",
      meta: ["Serves 4", "from Anu", "Cooked today"],
      startHref: "/cook/session?recipe=rcp_curry&f=1000",
    });
  });

  it("says Saved by N for your own, and nothing it can't say", () => {
    expect(myRecipeCards([summary({ savedBy: 4, servesHalf: 6 })], new Map(), NOW)[0]!.meta).toEqual(["Serves 3", "Saved by 4"]);
    expect(myRecipeCards([summary({ servesHalf: 5 })], new Map(), NOW)[0]!.meta).toEqual(["Serves 2½"]);
  });

  it("shows the main item and a count until the recipe is read in full", () => {
    expect(ingredientsTeaser(summary())).toBe("Chicken + 7 more");
    expect(ingredientsTeaser(summary({ lineCount: 1 }))).toBe("Chicken");
    expect(ingredientNames(recipe())).toMatch(/^Chicken, onions/);
  });

  it("knows your copy of a recipe (Saved)", () => {
    const mine = [summary({ id: "rcp_copy", source: { recipeId: "rcp_anu", ownerId: ANU, ownerName: "Anu" } })];
    expect(savedCopyOf("rcp_anu", mine)).toBe("rcp_copy");
    expect(savedCopyOf("rcp_other", mine)).toBeNull();
    expect(savedCopyOf("rcp_anu", null)).toBeNull();
  });
});

describe("You's recipes", () => {
  const mine: RecipeSummary[] = [
    summary({ id: "rcp_efr", name: "Egg fried rice", savedBy: 4, lastCookedAt: "2026-11-07T10:00:00.000Z" }),
    summary({ id: "rcp_chai", name: "Masala chai", visibility: "link", savedBy: 2 }),
    summary({ id: "rcp_chk", name: "Chicken curry", visibility: "only_me", source: { recipeId: "rcp_anu", ownerId: ANU, ownerName: "Anu" } }),
    summary({ id: "rcp_dal", name: "Dal", visibility: "groups" }),
  ];

  it("count your recipes and the copies people saved of them", () => {
    expect(recipeStats(mine)).toEqual({ recipes: 4, savedBy: 6 });
    expect(recipeStats([])).toEqual({ recipes: 0, savedBy: 0 });
  });

  it("say who can see each: Only me · My groups · Anyone with the link", () => {
    expect(profileRecipeRows(mine).map((r) => [r.name, r.meta])).toEqual([
      ["Egg fried rice", "My groups · saved by 4"],
      ["Masala chai", "Anyone with the link · saved by 2"],
      ["Chicken curry", "Only me · from Anu"],
      ["Dal", "My groups"],
    ]);
  });

  it("switch Recipes | Cooks in the address, Recipes first", () => {
    expect(profileListFrom(null)).toBe("recipes");
    expect(profileListFrom("cooks")).toBe("cooks");
    expect(profileListFrom("nope")).toBe("recipes");
    expect(profileHref("cooks")).toBe("/you?list=cooks");
    expect(profileHref("recipes")).toBe("/you");
  });

  it("draw a row per recipe, opening it, or New recipe when there is none", () => {
    const out = html(React.createElement(YourRecipes, { rows: profileRecipeRows(mine), loading: false, failed: false }));
    expect(out).toContain('href="/recipes/rcp_chk"');
    expect(out).toContain("Only me · from Anu");
    const empty = html(React.createElement(YourRecipes, { rows: [], loading: false, failed: false }));
    expect(empty).toContain("No recipes yet");
    expect(empty).toContain('href="/recipes/new"');
  });
});

// ── A delete shows at once, and Undo puts it back (SM-5) ────────────

function cache(entries: [CacheKey, unknown][]): CacheLike & { data: Map<string, unknown> } {
  const data = new Map(entries.map(([k, v]) => [JSON.stringify(k), v] as const));
  const keys = new Map(entries.map(([k]) => [JSON.stringify(k), k] as const));
  return {
    data,
    entries: (prefix) => [...keys.values()].filter((k) => prefix.every((p, i) => JSON.stringify(k[i]) === JSON.stringify(p))).map((k) => [k, data.get(JSON.stringify(k))] as const),
    get: (key) => data.get(JSON.stringify(key)),
    set: (key, value) => {
      keys.set(JSON.stringify(key), key);
      data.set(JSON.stringify(key), value);
    },
  };
}

describe("deleting a recipe, with Undo", () => {
  it("takes it off My recipes and Cook now at once, and Undo puts both back exactly", () => {
    const recipes = [summary({ id: "rcp_a" }), summary({ id: "rcp_curry" })];
    const c = cache([
      [qk.kitchenMyRecipes(), recipes],
      [qk.kitchenCookNow(), ENTRIES],
    ]);
    const patched = applyPatches(c, recipeRemovedPatches("rcp_curry"));
    expect((c.get(qk.kitchenMyRecipes()) as RecipeSummary[]).map((r) => r.id)).toEqual(["rcp_a"]);
    expect((c.get(qk.kitchenCookNow()) as CookNowEntry[]).map((e) => e.recipe.id)).not.toContain("rcp_curry");
    expect(rollbackPatches(c, patched)).toEqual([]);
    expect(c.get(qk.kitchenMyRecipes())).toBe(recipes);
    expect(c.get(qk.kitchenCookNow())).toBe(ENTRIES);
  });

  it("leaves a list without it alone, and puts a new copy at the top once", () => {
    const recipes = [summary({ id: "rcp_a" })];
    const c = cache([[qk.kitchenMyRecipes(), recipes]]);
    expect(applyPatches(c, recipeRemovedPatches("rcp_x"))).toEqual([]);
    applyPatches(c, recipeAddedPatches(summary({ id: "rcp_new" })));
    applyPatches(c, recipeAddedPatches(summary({ id: "rcp_new" })));
    expect((c.get(qk.kitchenMyRecipes()) as RecipeSummary[]).map((r) => r.id)).toEqual(["rcp_new", "rcp_a"]);
  });

  it("keeps Cook now and a recipe's match under the pantry reads, so a stock write refreshes them", () => {
    const pantry = qk.kitchenPantry();
    for (const key of [qk.kitchenCookNow(), qk.kitchenRecipeMatch("rcp_1", 450), qk.kitchenRecipeMatches("rcp_1")]) {
      expect(key.slice(0, pantry.length)).toEqual([...pantry]);
    }
    expect(qk.kitchenRecipeMatch("rcp_1", 450).slice(0, 3)).toEqual([...qk.kitchenRecipeMatches("rcp_1")]);
    const book = qk.kitchenRecipeBook();
    for (const key of [qk.kitchenMyRecipes(), qk.kitchenRecipe("rcp_1")]) expect(key.slice(0, book.length)).toEqual([...book]);
    // Not the dishes-cooked-before search (SM-9), which keeps its own key.
    expect(qk.kitchenRecipe("rcp_1")).not.toEqual(qk.kitchenRecipes("rcp_1"));
  });
});

describe("the recipe pages exist only in the new frame", () => {
  // cookpool-guided GC-6 adds the plan.
  const PAGES = ["/recipes/new", "/recipes/:recipeId", "/recipes/:recipeId/edit", "/recipes/:recipeId/plan"];

  it("send a prod visitor Home", () => {
    for (const page of PAGES) expect(frameRedirect(page, false)).toBe("/home");
    expect(onHost(PROD, () => frameRedirect("/recipes/:recipeId", newFrame()))).toBe("/home");
  });

  it("stay put in the new frame, and /cook stays in both", () => {
    for (const page of PAGES) expect(frameRedirect(page, true)).toBeNull();
    expect(onHost(STAGE, () => frameRedirect("/recipes/:recipeId", newFrame()))).toBeNull();
    expect(frameRedirect("/cook", false)).toBeNull();
    expect(frameRedirect("/cook", true)).toBeNull();
  });

  it("go back to Cook, and editing goes back to the recipe", () => {
    expect(backParent("/recipes/rcp_1", {}, { newFrame: true })).toBe("/cook");
    expect(backParent("/recipes/new", {}, { newFrame: true })).toBe("/cook");
    expect(backParent("/recipes/rcp_1/edit", {}, { newFrame: true })).toBe("/recipes/rcp_1");
    expect(backParent("/recipes/rcp_1/plan", {}, { newFrame: true })).toBe("/recipes/rcp_1");
    // Cook is a tab in the new frame: no Back.
    expect(backParent("/cook", {}, { newFrame: true })).toBeNull();
  });
});
