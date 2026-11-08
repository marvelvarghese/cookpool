import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MAX_ALWAYS_HAVE,
  RECIPE_KINDS,
  type AlwaysHaveResponse,
  type ExploreRecipe,
  type FoodMatch,
  type KitchenFood,
  type RecipeMatchSummary,
  type SetFoodAnswerRequest,
  type SetFoodAnswerResponse,
} from "@saas/contracts/kitchen";
import type { ApiResult } from "@web-console-next/lib/api";
import { resetAppConfigForTests } from "@web-console-next/lib/app-config";
import { frameRedirect, newFrame } from "@web-console-next/lib/features";
import { applyPatches, type CacheKey, type CacheLike } from "@web-console-next/lib/optimistic";
import { qk } from "@web-console-next/lib/query-keys";
import { loginPathFor, postLoginDestination } from "@web-console-next/lib/safe-next";
import { STATIC_PAGES, redirectRules, staticPageFor } from "@web-console-next/lib/static-pages.mjs";
import { API_READS, apiRead } from "@web-console-next/service-worker/routes.mjs";
import { backParent } from "@web-console-next/components/kitchen/back";
import { activeNewFrameTab } from "@web-console-next/components/kitchen/nav";
import { BAR_HIDDEN_PAGES } from "@web-console-next/components/kitchen/cook-session";
import { recipeStats } from "@web-console-next/components/kitchen/cook-hub";
import { CookHubView, FeedRecipeRowView, PersonRecipesView, SaveCopyChip } from "@web-console-next/components/kitchen/cook-hub-views";
import {
  EXPLORE_EMPTY_TEXT,
  EXPLORE_HREF,
  EXPLORE_KINDS,
  EXPLORE_SEARCH_MS,
  exploreHref,
  exploreMatchText,
  exploreQuery,
  exploreRows,
  exploreSourceFrom,
  exploreSubtitle,
  feedRecipeFor,
  feedRecipeIds,
  feedRecipeText,
  personHref,
  personListFrom,
  personRecipeRows,
} from "@web-console-next/components/kitchen/explore";
import { BookmarkButton, ExploreButton, ExploreView } from "@web-console-next/components/kitchen/explore-views";
import {
  ALWAYS_HAVE_LINE,
  ALWAYS_HAVE_REFRESHES,
  ALWAYS_HAVE_TITLE,
  FOOD_ANSWER_REFRESHES,
  alwaysHaveKeys,
  alwaysHavePatches,
  alwaysHaveToast,
  answerFood,
  applyAlwaysHave,
  askScore,
  canAddFood,
  foodAnswerBodies,
  foodAsks,
  inverseChange,
  withFood,
  withoutFood,
} from "@web-console-next/components/kitchen/always-have";
import { AlwaysHaveCardView, FoodAskCard, FoodAskListView, FoodResults } from "@web-console-next/components/kitchen/always-have-views";
import { ANU, FLAT, line, recipe, summary } from "./kitchen-recipe-fixtures";

// cookpool-recipes RC-8 (design §2, §3.4, §5.2–§5.3; the canvas's `Explore`,
// `Profile`, `NewHome`): Explore, a person's recipes, Always have at the
// bottom of Pantry, the food ask, the feed's recipe links, and where the new
// pages sit (prod is sent Home).

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => undefined;

function summaryOf(patch: Partial<RecipeMatchSummary> = {}): RecipeMatchSummary {
  return { lines: 6, have: 6, short: 0, missing: 0, always: 0, missingNames: [], maxFactorMilli: 1000, ...patch };
}

function explore(id: string, name: string, match: Partial<RecipeMatchSummary> = {}, patch: Partial<ExploreRecipe> = {}): ExploreRecipe {
  return { ...summary({ id, name, mine: false, servesHalf: 8, serves: 4, minutes: 30, ...patch }), match: summaryOf(match) };
}

function food(key: string, name: string): KitchenFood {
  return { key, name, dimension: "mass", eachG: null, category: "spices", gPerMl: null };
}

function mapCache(entries: [CacheKey, unknown][]): CacheLike {
  const map = new Map(entries.map(([k, v]) => [JSON.stringify(k), v] as const));
  return {
    entries: (prefix) =>
      [...map.entries()].map(([k, v]) => [JSON.parse(k) as CacheKey, v] as const).filter(([k]) => prefix.every((p, i) => JSON.stringify(k[i]) === JSON.stringify(p))),
    get: (key) => map.get(JSON.stringify(key)),
    set: (key, data) => void map.set(JSON.stringify(key), data),
  };
}

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

// ── Explore ────────────────────────────────────────────────────────

describe("Explore: Cookpool | Your groups", () => {
  it("keeps the switch in the address: Cookpool's own is the bare page", () => {
    expect(EXPLORE_HREF).toBe("/explore");
    expect(exploreHref("cookpool")).toBe("/explore");
    expect(exploreHref("groups")).toBe("/explore?source=groups");
    expect(exploreSourceFrom("groups")).toBe("groups");
    expect(exploreSourceFrom(null)).toBe("cookpool");
    expect(exploreSourceFrom("strangers")).toBe("cookpool");
  });

  it("reads the source asked for", () => {
    expect(exploreQuery("cookpool", "", "all")).toEqual({ source: "cookpool" });
    expect(exploreQuery("groups", "", "all")).toEqual({ source: "groups" });
  });

  it("says whose they are: By Cookpool · 42 recipes, or Shared in your groups", () => {
    expect(exploreSubtitle("cookpool", 42, [])).toBe("By Cookpool · 42 recipes");
    expect(exploreSubtitle("cookpool", 1, [])).toBe("By Cookpool · 1 recipe");
    expect(exploreSubtitle("cookpool", null, [])).toBe("By Cookpool");
    expect(exploreSubtitle("groups", null, ["Flat 4B", "Lunch club"])).toBe("Shared in Flat 4B and Lunch club");
    expect(exploreSubtitle("groups", null, [])).toBe("Shared in your groups");
  });

  it("draws the switch with the one shown pressed", () => {
    const out = html(React.createElement(ExploreView, { ...VIEW, source: "groups" }));
    expect(out).toMatch(/aria-pressed="false"[^>]*>Cookpool</);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Your groups</);
  });
});

const VIEW = {
  source: "cookpool" as const,
  subtitle: "By Cookpool · 42 recipes",
  query: "",
  kind: "all" as const,
  onlyCanMake: false,
  rows: [] as ReturnType<typeof exploreRows>,
  loading: false,
  failed: false,
  onSource: noop,
  onQuery: noop,
  onKind: noop,
  onOnlyCanMake: noop,
};

describe("Explore: search and kinds", () => {
  it("searches by the trimmed words, and nothing for an empty field", () => {
    expect(exploreQuery("cookpool", "  poha ", "all")).toEqual({ source: "cookpool", q: "poha" });
    expect(exploreQuery("cookpool", "   ", "all")).toEqual({ source: "cookpool" });
    expect(EXPLORE_SEARCH_MS).toBeGreaterThanOrEqual(200);
    expect(EXPLORE_SEARCH_MS).toBeLessThanOrEqual(400);
  });

  it("has a chip per kind, RC-4's kinds by their words, All first", () => {
    expect(EXPLORE_KINDS.map((k) => k.label)).toEqual(["All", "Breakfast", "Dal & curry", "Rice", "Roti", "Snacks", "Sweet", "Drinks"]);
    for (const k of EXPLORE_KINDS.slice(1)) expect(RECIPE_KINDS).toContain(k.id);
    expect(EXPLORE_KINDS.map((k) => k.id)).toEqual(["all", "breakfast", "dal_curry", "rice", "roti", "snack", "sweet", "drink"]);
  });

  it("reads a kind with the search, and no kind for All", () => {
    expect(exploreQuery("groups", "dal", "dal_curry")).toEqual({ source: "groups", q: "dal", kind: "dal_curry" });
    expect(exploreQuery("cookpool", "", "drink")).toEqual({ source: "cookpool", kind: "drink" });
    expect(exploreQuery("cookpool", "", "all")).not.toHaveProperty("kind");
  });

  it("draws the search, the kind chips (the one chosen pressed and dark) and the switch", () => {
    const out = html(React.createElement(ExploreView, { ...VIEW, query: "dal", kind: "rice" }));
    expect(out).toContain('type="search"');
    expect(out).toContain('value="dal"');
    expect(out).toContain("Search recipes");
    expect(out.match(/aria-pressed="true"[^>]*>Rice</g)).toHaveLength(1);
    expect(out).toMatch(/aria-pressed="true" class="[^"]*bg-foreground[^"]*">Rice</);
    expect(out).toMatch(/aria-pressed="false"[^>]*>Snacks</);
  });
});

describe("Explore: rows, fewest missing first", () => {
  const LIST = [
    explore("rcp_pulao", "Veg pulao", { missing: 2, have: 4, missingNames: ["Peas", "Carrots"] }),
    explore("rcp_chicken", "Chicken curry", { missing: 1, have: 5, missingNames: ["Yogurt"] }),
    explore("rcp_jeera", "Jeera rice"),
    explore("rcp_kheer", "Rice kheer", { short: 1, have: 5 }),
    explore("rcp_dal", "Dal tadka"),
  ];

  it("sort by fewest missing, then fewest short, else in the server's order (newest first)", () => {
    expect(exploreRows(LIST, { source: "cookpool", onlyCanMake: false }).map((r) => r.name)).toEqual([
      "Jeera rice",
      "Dal tadka",
      "Rice kheer",
      "Chicken curry",
      "Veg pulao",
    ]);
  });

  it("say what you have: ✓ You have everything in green, Missing yogurt, coriander in amber", () => {
    expect(exploreMatchText(summaryOf())).toEqual({ text: "✓ You have everything", tone: "have" });
    expect(exploreMatchText(summaryOf({ missing: 2, missingNames: ["Yogurt", "Coriander"] }))).toEqual({ text: "Missing yogurt, coriander", tone: "short" });
    expect(exploreMatchText(summaryOf({ missing: 4, missingNames: ["Yogurt", "Coriander", "Mint"] })).text).toBe("Missing yogurt, coriander, mint +1");
    expect(exploreMatchText(summaryOf({ short: 1 }))).toEqual({ text: "Short of 1", tone: "short" });
  });

  it("Only what I can make keeps the rows with nothing missing", () => {
    expect(exploreRows(LIST, { source: "cookpool", onlyCanMake: true }).map((r) => r.name)).toEqual(["Jeera rice", "Dal tadka", "Rice kheer"]);
  });

  it("each: its tile, Serves 4 · 30 min — by Anu in Your groups — and its page", () => {
    const [cookpool] = exploreRows([explore("rcp_dal", "Dal tadka", {}, { isSystem: true, ownerName: "Cookpool" })], { source: "cookpool", onlyCanMake: false });
    expect(cookpool).toMatchObject({ name: "Dal tadka", meta: "Serves 4 · 30 min", href: "/recipes/rcp_dal", match: "✓ You have everything", tone: "have" });
    expect(cookpool!.tile.initial).toBe("D");
    const [anu] = exploreRows([explore("rcp_pb", "Paneer bhurji", { missing: 1, missingNames: ["Paneer"] }, { ownerId: ANU, ownerName: "Anu Thomas", servesHalf: 4, minutes: 20 })], {
      source: "groups",
      onlyCanMake: false,
    });
    expect(anu).toMatchObject({ meta: "by Anu · Serves 2 · 20 min", match: "Missing paneer", tone: "short" });
  });

  it("draw a 48 px tile, the words, the match in its colour and the bookmark; or Nothing here yet", () => {
    const rows = exploreRows(LIST, { source: "cookpool", onlyCanMake: false });
    const out = html(React.createElement(ExploreView, { ...VIEW, rows, renderSave: (r) => React.createElement(BookmarkButton, { name: r.name, savedId: null, saving: false, onSave: noop }) }));
    expect(out.match(/h-12 w-12/g)).toHaveLength(5);
    expect(out).toContain("✓ You have everything");
    expect(out).toMatch(/text-\[#8A5A00\]">Missing yogurt</);
    expect(out).toMatch(/text-\[#165C3A\]">✓ You have everything</);
    expect(out.match(/aria-label="Save /g)).toHaveLength(5);
    expect(html(React.createElement(ExploreView, { ...VIEW, rows: [] }))).toContain(EXPLORE_EMPTY_TEXT);
    expect(EXPLORE_EMPTY_TEXT).toBe("Nothing here yet");
  });

  it("Only what I can make is a switch on a card, green when on", () => {
    const off = html(React.createElement(ExploreView, VIEW));
    expect(off).toMatch(/role="switch" aria-checked="false"/);
    const on = html(React.createElement(ExploreView, { ...VIEW, onlyCanMake: true }));
    expect(on).toMatch(/role="switch" aria-checked="true" class="[^"]*bg-cp-herb-tint/);
    expect(on).toContain("Only what I can make");
  });

  it("the bookmark saves a copy (44 px), and once saved is filled and opens your copy", () => {
    const save = html(React.createElement(BookmarkButton, { name: "Dal tadka", savedId: null, saving: false, onSave: noop }));
    expect(save).toContain('aria-label="Save Dal tadka"');
    expect(save).toContain("h-11 w-11");
    expect(save).not.toContain("fill-current");
    const saved = html(React.createElement(BookmarkButton, { name: "Dal tadka", savedId: "rcp_mine", saving: false, onSave: noop }));
    expect(saved).toContain('href="/recipes/rcp_mine"');
    expect(saved).toContain("fill-current");
    expect(html(React.createElement(BookmarkButton, { name: "Dal tadka", savedId: null, saving: true, onSave: noop }))).toContain("fill-current");
  });

  it("sits beside New recipe in the Cook hub", () => {
    const out = html(React.createElement(CookHubView, { cookNow: null, cards: [], recipesLoading: false, recipesFailed: false, extraAction: React.createElement(ExploreButton) }));
    expect(out).toContain('href="/explore"');
    expect(out.indexOf("New recipe")).toBeLessThan(out.indexOf(">Explore"));
    // Without it the hub draws as RC-5 left it.
    expect(html(React.createElement(CookHubView, { cookNow: null, cards: [], recipesLoading: false, recipesFailed: false }))).not.toContain("Explore");
  });
});

// ── A person's recipes ─────────────────────────────────────────────

describe("a person's page: Recipes | Cooks", () => {
  const THEIRS = [
    summary({ id: "rcp_curry", name: "Chicken curry", ownerId: ANU, ownerName: "Anu", mine: false, servesHalf: 8, minutes: 45, savedBy: 3 }),
    summary({ id: "rcp_pb", name: "Paneer bhurji", ownerId: ANU, ownerName: "Anu", mine: false, servesHalf: 4, minutes: 20, savedBy: 1 }),
    summary({ id: "rcp_upma", name: "Rava upma", ownerId: ANU, ownerName: "Anu", mine: false, servesHalf: 6, minutes: null, savedBy: 0 }),
  ];

  it("keeps the list in the address, Recipes first", () => {
    expect(personListFrom(null)).toBe("recipes");
    expect(personListFrom("cooks")).toBe("cooks");
    expect(personHref(ANU, "recipes")).toBe(`/people/${ANU}`);
    expect(personHref(ANU, "cooks")).toBe(`/people/${ANU}?list=cooks`);
  });

  it("lists their recipes you may see: name, Serves 4 · 45 min", () => {
    expect(personRecipeRows(THEIRS)).toEqual([
      { id: "rcp_curry", name: "Chicken curry", href: "/recipes/rcp_curry", meta: "Serves 4 · 45 min" },
      { id: "rcp_pb", name: "Paneer bhurji", href: "/recipes/rcp_pb", meta: "Serves 2 · 20 min" },
      { id: "rcp_upma", name: "Rava upma", href: "/recipes/rcp_upma", meta: "Serves 3" },
    ]);
  });

  it("counts Recipes and Saved by from what the read gives", () => {
    expect(recipeStats(THEIRS)).toEqual({ recipes: 3, savedBy: 4 });
  });

  it("gives each row Save — Saved, opening your copy, once you have one", () => {
    const rows = personRecipeRows(THEIRS);
    const saved = new Map([["rcp_curry", "rcp_mine"]]);
    const out = html(
      React.createElement(PersonRecipesView, {
        rows,
        loading: false,
        failed: false,
        renderSave: (r) => React.createElement(SaveCopyChip, { name: r.name, savedId: saved.get(r.id) ?? null, saving: false, onSave: noop }),
      }),
    );
    expect(out).toContain("Chicken curry");
    expect(out).toContain("Serves 2 · 20 min");
    expect(out.match(/>Save<span/g)).toHaveLength(2);
    expect(out).toContain('href="/recipes/rcp_mine"');
    expect(out).toMatch(/border-\[#B9DCC8\] bg-cp-herb-tint[^>]*>Saved/);
    expect(out).toContain("min-h-11");
  });

  it("says when there is nothing of theirs to see", () => {
    expect(html(React.createElement(PersonRecipesView, { rows: [], loading: false, failed: false }))).toContain("No recipes they share yet");
  });
});

// ── Always have ────────────────────────────────────────────────────

describe("Always have, at the bottom of Pantry", () => {
  const SALT = food("salt", "Salt");
  const WATER = food("water", "Water");
  const TURMERIC = food("turmeric", "Turmeric");
  const LIST: AlwaysHaveResponse = { foods: [SALT, WATER], isDefault: true };

  it("adds a food in name order, once, and is your own list from then on", () => {
    const next = withFood(LIST, { ...TURMERIC, matchedName: "haldi" } as FoodMatch);
    expect(next.foods.map((f) => f.key)).toEqual(["salt", "turmeric", "water"]);
    expect(next.isDefault).toBe(false);
    expect(next.foods[1]).not.toHaveProperty("matchedName");
    expect(withFood(next, TURMERIC)).toBe(next);
  });

  it("removes a food, and leaves a list without it alone", () => {
    expect(withoutFood(LIST, "salt")).toEqual({ foods: [WATER], isDefault: false });
    expect(withoutFood(LIST, "turmeric")).toBe(LIST);
    // An emptied list stays empty (the server keeps it, RC-4).
    expect(withoutFood(withoutFood(LIST, "salt"), "water")).toEqual({ foods: [], isDefault: false });
  });

  it("each write PUTs the whole list", () => {
    expect(alwaysHaveKeys(applyAlwaysHave(LIST, { kind: "add", food: TURMERIC }))).toEqual(["salt", "turmeric", "water"]);
    expect(alwaysHaveKeys(applyAlwaysHave(LIST, { kind: "remove", food: SALT }))).toEqual(["water"]);
  });

  it("shows at once — two quick edits both — and Undo does the other way round", () => {
    const cache = mapCache([[qk.kitchenAlwaysHave(), LIST]]);
    const add = { kind: "add" as const, food: TURMERIC };
    const remove = { kind: "remove" as const, food: SALT };
    applyPatches(cache, alwaysHavePatches(add));
    applyPatches(cache, alwaysHavePatches(remove));
    expect(alwaysHaveKeys(cache.get(qk.kitchenAlwaysHave()) as AlwaysHaveResponse)).toEqual(["turmeric", "water"]);
    // Undo the add only: the remove stays.
    expect(inverseChange(add)).toEqual({ kind: "remove", food: TURMERIC });
    applyPatches(cache, alwaysHavePatches(inverseChange(add)));
    expect(alwaysHaveKeys(cache.get(qk.kitchenAlwaysHave()) as AlwaysHaveResponse)).toEqual(["water"]);
    applyPatches(cache, alwaysHavePatches(inverseChange(remove)));
    expect(alwaysHaveKeys(cache.get(qk.kitchenAlwaysHave()) as AlwaysHaveResponse)).toEqual(["salt", "water"]);
  });

  it("refreshes Cook now, every match and Explore — all under the pantry's reads", () => {
    expect(ALWAYS_HAVE_REFRESHES).toEqual([qk.kitchenAllRecipeMatches(), qk.kitchenCookNow(), qk.kitchenExploreAll()]);
    for (const key of ALWAYS_HAVE_REFRESHES) expect(key[0]).toBe(qk.kitchenPantry()[0]);
    expect(qk.kitchenRecipeMatch("rcp_1", 450).slice(0, 2)).toEqual([...qk.kitchenAllRecipeMatches()]);
    expect(qk.kitchenExplore("groups", "dal", "rice").slice(0, 2)).toEqual([...qk.kitchenExploreAll()]);
  });

  it("says what each edit did", () => {
    expect(alwaysHaveToast({ kind: "add", food: TURMERIC })).toBe("Added turmeric");
    expect(alwaysHaveToast({ kind: "remove", food: SALT })).toBe("Removed salt");
  });

  it("draws Always have · Count as there in Cook now, a chip per food with ✕, and + Add", () => {
    const out = html(React.createElement(AlwaysHaveCardView, { foods: LIST.foods, loading: false, failed: false, canAdd: true, onRemove: noop, onAdd: noop }));
    expect(ALWAYS_HAVE_TITLE).toBe("Always have");
    expect(ALWAYS_HAVE_LINE).toBe("Count as there in Cook now");
    expect(out).toContain(">Always have<");
    expect(out).toContain(">Count as there in Cook now<");
    expect(out).toContain('aria-label="Remove Salt"');
    expect(out).toContain('aria-label="Remove Water"');
    expect(out.match(/h-11 w-11/g)).toHaveLength(2);
    expect(out).toContain("Add</button>");
  });

  it("stops offering + Add when the list is full", () => {
    const full = { foods: Array.from({ length: MAX_ALWAYS_HAVE }, (_, i) => food(`f${i}`, `F${i}`)), isDefault: false };
    expect(canAddFood(full)).toBe(false);
    expect(withFood(full, TURMERIC)).toBe(full);
    expect(canAddFood(LIST)).toBe(true);
    expect(html(React.createElement(AlwaysHaveCardView, { foods: [], loading: false, failed: false, canAdd: false, onRemove: noop, onAdd: noop }))).not.toContain("Add</button>");
  });

  it("the food search marks what is on the list already", () => {
    const foods: FoodMatch[] = [
      { ...TURMERIC, matchedName: "haldi" },
      { ...SALT, matchedName: "Salt" },
    ];
    const out = html(React.createElement(FoodResults, { foods, have: new Set(["salt"]), onPick: noop }));
    expect(out).toContain("haldi");
    expect(out).toMatch(/disabled=""[^>]*>.*Salt.*Added/);
  });
});

// ── The food ask ───────────────────────────────────────────────────

describe("the food ask: Use Kanda onion for Onions?", () => {
  const LINES = [line(0, "Chicken", 1000, "g", { isMain: true }), line(1, "Onions", 3, "onion", { foodKey: "onion" }), line(2, "Ginger-garlic paste", 2, "tbsp", { foodKey: "ginger_garlic_paste" }), line(3, "Toor dal", 1, "cup", { foodKey: "toor_dal" })];
  const statuses = (missing: number[]) => LINES.map((l) => ({ position: l.position, status: missing.includes(l.position) ? ("missing" as const) : ("have" as const) }));
  const unlinked = (name: string, orgId: string | null = null) => ({ itemId: `itm_${name}`, orgId, name, nameKey: name.toLowerCase() });

  it("asks about an unlinked item that looks like a missing line's food", () => {
    const asks = foodAsks({ lines: LINES }, { lines: statuses([1]), unlinked: [unlinked("Kanda onion"), unlinked("Milk")] });
    expect(asks).toEqual([{ itemName: "Kanda onion", nameKey: "kanda onion", foodKey: "onion", question: "Use Kanda onion for Onions?", orgIds: [null] }]);
  });

  it("asks nothing for a line you have, or with nothing unlinked", () => {
    expect(foodAsks({ lines: LINES }, { lines: statuses([]), unlinked: [unlinked("Kanda onion")] })).toEqual([]);
    expect(foodAsks({ lines: LINES }, { lines: statuses([1]), unlinked: [] })).toEqual([]);
    expect(foodAsks({ lines: LINES }, null)).toEqual([]);
  });

  it("doesn't pair on a general word (Tomato paste is not ginger-garlic paste)", () => {
    expect(askScore("Tomato paste", LINES[2]!)).toBe(0);
    expect(askScore("Ginger", LINES[2]!)).toBe(1);
    expect(askScore("Organic toor dal", LINES[3]!)).toBeGreaterThan(askScore("Moong dal", LINES[3]!));
    expect(foodAsks({ lines: LINES }, { lines: statuses([2]), unlinked: [unlinked("Tomato paste")] })).toEqual([]);
  });

  it("asks once per name, for every pantry holding it, in the recipe's line order", () => {
    const asks = foodAsks({ lines: LINES }, { lines: statuses([1, 3]), unlinked: [unlinked("Tur dal", FLAT.orgId), unlinked("Kanda onion"), unlinked("Kanda Onion", FLAT.orgId)] });
    expect(asks.map((a) => [a.question, a.orgIds])).toEqual([
      ["Use Kanda onion for Onions?", [null, FLAT.orgId]],
      ["Use Tur dal for Toor dal?", [FLAT.orgId]],
    ]);
  });

  it("never asks a name again once it is answered", () => {
    const match = { lines: statuses([1]), unlinked: [unlinked("Kanda onion")] };
    expect(foodAsks({ lines: LINES }, match, new Set(["kanda onion"]))).toEqual([]);
  });

  it("Yes sends the food, No sends none (foodKey null) — one PUT per pantry, each with its owner", () => {
    const ask = { nameKey: "kanda onion", foodKey: "onion", orgIds: [null, FLAT.orgId] };
    expect(foodAnswerBodies(ask, true)).toEqual([
      { nameKey: "kanda onion", foodKey: "onion" },
      { nameKey: "kanda onion", foodKey: "onion", orgId: FLAT.orgId },
    ]);
    expect(foodAnswerBodies(ask, false)).toEqual([
      { nameKey: "kanda onion", foodKey: null },
      { nameKey: "kanda onion", foodKey: null, orgId: FLAT.orgId },
    ]);
  });

  it("sends them, and says when one was refused", async () => {
    const sent: SetFoodAnswerRequest[] = [];
    const okAnswer = (body: SetFoodAnswerRequest): Promise<ApiResult<SetFoodAnswerResponse>> => {
      sent.push(body);
      return Promise.resolve({ ok: true, data: { answer: { nameKey: body.nameKey, foodKey: body.foodKey, orgId: body.orgId ?? null }, linkedItems: 1 }, meta: { requestId: "r", cursor: null } });
    };
    await expect(answerFood({ nameKey: "kanda onion", foodKey: "onion", orgIds: [null] }, false, okAnswer)).resolves.toBeNull();
    expect(sent).toEqual([{ nameKey: "kanda onion", foodKey: null }]);
    const refuse = (): Promise<ApiResult<SetFoodAnswerResponse>> => Promise.resolve({ ok: false, status: 404, error: { code: "not_found", message: "Not found" } });
    await expect(answerFood({ nameKey: "kanda onion", foodKey: "onion", orgIds: [FLAT.orgId] }, true, refuse)).resolves.toMatchObject({ code: "not_found" });
  });

  it("then reads every match, Cook now and Explore again", () => {
    expect(FOOD_ANSWER_REFRESHES).toEqual(ALWAYS_HAVE_REFRESHES);
  });

  it("draws one small card per name with Yes and No", () => {
    const one = html(React.createElement(FoodAskCard, { ask: { question: "Use Kanda onion for Onions?" }, busy: false, onAnswer: noop }));
    expect(one).toContain("Use Kanda onion for Onions?");
    expect(one).toContain(">Yes<");
    expect(one).toContain(">No<");
    expect(one.match(/min-h-11/g)).toHaveLength(2);
    const asks = foodAsks({ lines: LINES }, { lines: statuses([1, 3]), unlinked: [unlinked("Kanda onion"), unlinked("Tur dal")] });
    expect(html(React.createElement(FoodAskListView, { asks, busy: new Set<string>(), onAnswer: noop })).match(/role="group"/g)).toHaveLength(2);
    expect(html(React.createElement(FoodAskListView, { asks: [], busy: new Set<string>(), onAnswer: noop }))).toBe("");
  });
});

// ── From your groups: the recipe link ──────────────────────────────

describe("a feed card's recipe", () => {
  it("is the recipe its dish was cooked from, for the cards shown", () => {
    const dishes = [
      { id: "dsh_1", recipeId: "rcp_pb" },
      { id: "dsh_2", recipeId: null },
      { id: "dsh_3" },
      { id: "dsh_4", recipeId: "rcp_dal" },
    ];
    expect([...feedRecipeIds(dishes, ["dsh_1", "dsh_2", "dsh_3"])]).toEqual([["dsh_1", "rcp_pb"]]);
  });

  it("shows only once its read succeeds: one you may not see (404) is left out", () => {
    const recipeOf = new Map([
      ["dsh_1", "rcp_pb"],
      ["dsh_2", "rcp_hidden"],
    ]);
    const loaded = new Map([["rcp_pb", recipe({ id: "rcp_pb" })]]);
    expect(feedRecipeFor("dsh_1", recipeOf, loaded)?.id).toBe("rcp_pb");
    expect(feedRecipeFor("dsh_2", recipeOf, loaded)).toBeNull();
    expect(feedRecipeFor("dsh_3", recipeOf, loaded)).toBeNull();
  });

  it("says whose it is: Anu's recipe, Cookpool's recipe, Your recipe", () => {
    expect(feedRecipeText({ isSystem: false, mine: false, ownerName: "Anu Thomas" }, "Anu")).toBe("Anu's recipe");
    expect(feedRecipeText({ isSystem: true, mine: false, ownerName: "Cookpool" }, "Dev")).toBe("Cookpool's recipe");
    expect(feedRecipeText({ isSystem: false, mine: true, ownerName: "Rahul" }, "You")).toBe("Your recipe");
    expect(feedRecipeText({ isSystem: false, mine: false, ownerName: null }, "Meera")).toBe("Meera's recipe");
  });

  it("links to the recipe, with Save beside it", () => {
    const out = html(
      React.createElement(FeedRecipeRowView, {
        text: "Anu's recipe",
        href: "/recipes/rcp_pb",
        save: React.createElement(SaveCopyChip, { name: "Paneer bhurji", savedId: null, saving: false, onSave: noop, icon: true }),
      }),
    );
    expect(out).toContain('href="/recipes/rcp_pb"');
    expect(out).toContain("Anu&#x27;s recipe");
    expect(out).toContain(">Save<span");
    expect(out).toContain("lucide-bookmark");
  });
});

// ── Where the new pages are ────────────────────────────────────────

describe("Explore and /r/<code> exist only in the new frame", () => {
  it("send a prod visitor Home", () => {
    expect(frameRedirect("/explore", false)).toBe("/home");
    expect(frameRedirect("/r/:code", false)).toBe("/home");
    expect(onHost("cookpool.store", () => frameRedirect("/explore", newFrame()))).toBe("/home");
    expect(onHost("cookpool.store", () => frameRedirect("/r/:code", newFrame()))).toBe("/home");
  });

  it("stay put on stage", () => {
    expect(onHost("stage.cookpool.store", () => frameRedirect("/explore", newFrame()))).toBeNull();
    expect(onHost("stage.cookpool.store", () => frameRedirect("/r/:code", newFrame()))).toBeNull();
  });

  it("are pages served as files; every link code is one file", () => {
    expect(STATIC_PAGES).toContain("/explore");
    expect(STATIC_PAGES).toContain("/r/:code");
    expect(staticPageFor("/r/7kq2mxAb3Z")).toBe("/r/:code");
    expect(staticPageFor("/explore")).toBe("/explore");
    expect(redirectRules()).toContain("/r/:code /r/_ 200");
  });

  it("are Cook's, and go back to Cook", () => {
    expect(activeNewFrameTab("/explore")).toBe("cook");
    expect(activeNewFrameTab("/r/7kq2mxAb3Z")).toBe("cook");
    expect(backParent("/explore", {}, { newFrame: true })).toBe("/cook");
    expect(backParent("/r/7kq2mxAb3Z", {}, { newFrame: true })).toBe("/cook");
  });

  it("keeps the session bar off the link page (its Save sits there), not off Explore", () => {
    const hidden = (path: string) => BAR_HIDDEN_PAGES.some((re) => re.test(path));
    expect(hidden("/r/7kq2mxAb3Z")).toBe(true);
    expect(hidden("/explore")).toBe(false);
  });

  it("signed out, a link goes to sign-in and comes back to itself", () => {
    expect(loginPathFor("/r/7kq2mxAb3Z")).toBe("/login?next=%2Fr%2F7kq2mxAb3Z");
    expect(postLoginDestination("/r/7kq2mxAb3Z")).toBe("/r/7kq2mxAb3Z");
  });
});

describe("the new reads, offline", () => {
  it("keep Explore, a person's recipes and Always have", () => {
    expect(API_READS).toEqual(expect.arrayContaining(["/v1/kitchen/recipes", "/v1/kitchen/people/:subjectId/recipes", "/v1/kitchen/me/always-have"]));
    expect(apiRead("/api/v1/kitchen/recipes")).toBe("/v1/kitchen/recipes");
    expect(apiRead("/api/v1/kitchen/people/usr_1/recipes")).toBe("/v1/kitchen/people/:subjectId/recipes");
    expect(apiRead("/api/v1/kitchen/me/always-have")).toBe("/v1/kitchen/me/always-have");
  });

  it("sit where a write refreshes them: Explore under the pantry, a person's recipes and a link under the recipe book", () => {
    expect(qk.kitchenExplore("cookpool", "", "all")[0]).toBe("kitchenPantry");
    expect(qk.kitchenPersonRecipes(ANU).slice(0, 1)).toEqual([...qk.kitchenRecipeBook()]);
    expect(qk.kitchenRecipeLink("7kq2mxAb3Z").slice(0, 1)).toEqual([...qk.kitchenRecipeBook()]);
    expect(qk.kitchenAlwaysHave()).toEqual(["kitchenAlwaysHave"]);
  });
});
