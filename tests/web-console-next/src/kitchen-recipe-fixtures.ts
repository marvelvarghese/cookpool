import type {
  CookNowEntry,
  KitchenRecipe,
  KitchenRecipeLine,
  RecipeLineMatch,
  RecipeMatchItem,
  RecipeMatchResponse,
  RecipeMatchSummary,
  RecipeSummary,
} from "@saas/contracts/kitchen";
import { recipeUnitOf, scaleLine, scalePortions } from "@saas/contracts/kitchen";
import { ANU, FLAT, ME } from "./kitchen-pantry-fixtures";

// Recipes for the RC-5 screens' tests: the canvas's Chicken curry (serves 4,
// 1 kg chicken the main item), its match, and Cook now entries.

export const AT = "2026-11-08T10:00:00.000Z";

/** A line as the server reads it back, from its amount in its unit. */
export function line(position: number, name: string, quantity: number | null, unit: string | null, patch: Partial<KitchenRecipeLine> = {}): KitchenRecipeLine {
  const toTaste = quantity === null;
  const qtyMilli = toTaste || unit === null ? null : Math.round(quantity * recipeUnitOf(unit).factor * 1000);
  return {
    position,
    foodKey: name.toLowerCase().split(/[ ,-]/)[0] ?? null,
    name,
    qtyMilli,
    quantity: toTaste ? null : quantity,
    unit: toTaste ? null : unit,
    dimension: toTaste || unit === null ? null : recipeUnitOf(unit).dimension,
    toTaste,
    isMain: false,
    ...patch,
  };
}

export function summary(patch: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: "rcp_curry",
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
    lineCount: 8,
    main: { position: 0, foodKey: "chicken", name: "Chicken", qtyMilli: 1_000_000, quantity: 1000, unit: "g" },
    lastCookedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

export const CURRY_LINES: KitchenRecipeLine[] = [
  line(0, "Chicken", 1000, "g", { isMain: true }),
  line(1, "Onions", 3, "onion"),
  line(2, "Tomatoes", 2, "tomato"),
  line(3, "Yogurt", 200, "g"),
  line(4, "Ginger-garlic paste", 2, "tbsp"),
  line(5, "Cooking oil", 3, "tbsp"),
  line(6, "Garam masala", 1, "tsp"),
  line(7, "Salt", null, null),
];

export function recipe(patch: Partial<KitchenRecipe> = {}): KitchenRecipe {
  return {
    ...summary(),
    lines: CURRY_LINES,
    steps: ["Brown the onions in the oil, about 8 min.", "Add the paste and tomatoes; cook till soft.", "Stir in the yogurt; simmer 20 min."],
    linkCode: null,
    ...patch,
  };
}

const personal = { kind: "personal" as const, name: "Your pantry" };
const flat = { kind: "group" as const, orgId: FLAT.orgId, slug: FLAT.slug, name: FLAT.name };

export function matchItem(pantry: "me" | "flat", qtyLeftMilli: number, patch: Partial<RecipeMatchItem> = {}): RecipeMatchItem {
  return {
    itemId: "itm_1",
    ref: pantry === "me" ? "me:itm_1" : `org:${FLAT.orgId}:itm_1`,
    orgId: pantry === "me" ? null : FLAT.orgId,
    pantry: pantry === "me" ? personal : flat,
    name: "Item",
    qtyLeftMilli,
    takeMilli: qtyLeftMilli,
    unit: "g",
    expiresOn: null,
    ...patch,
  };
}

/** One line's match at a factor, its need from `scaleLine` as the server's is. */
export function lineMatch(l: KitchenRecipeLine, f: number, status: RecipeLineMatch["status"], availableMilli: number, items: RecipeMatchItem[] = []): RecipeLineMatch {
  const needMilli = scaleLine(l.qtyMilli, l.unit, f);
  return {
    position: l.position,
    status,
    needMilli,
    needQuantity: needMilli === null || l.unit === null ? null : needMilli / recipeUnitOf(l.unit).factor / 1000,
    unit: l.unit,
    availableMilli,
    items,
  };
}

/**
 * What Rahul's pantries hold for the curry: 450 g of chicken (his own), 4
 * onions and 5 tomatoes (Flat 4B), no yogurt, 150 ml of paste (his), 400 ml
 * of oil (Flat 4B); garam masala and salt are Always have.
 */
export function curryMatch(f: number, patch: Partial<RecipeMatchSummary> = {}): RecipeMatchResponse {
  const [chicken, onions, tomatoes, yogurt, paste, oil, masala, salt] = CURRY_LINES as [
    KitchenRecipeLine, KitchenRecipeLine, KitchenRecipeLine, KitchenRecipeLine, KitchenRecipeLine, KitchenRecipeLine, KitchenRecipeLine, KitchenRecipeLine,
  ];
  const need = (l: KitchenRecipeLine) => scaleLine(l.qtyMilli, l.unit, f) ?? 0;
  const status = (l: KitchenRecipeLine, have: number): RecipeLineMatch["status"] => (have >= need(l) ? "have" : have > 0 ? "short" : "missing");
  const lines = [
    lineMatch(chicken, f, status(chicken, 450_000), 450_000, [matchItem("me", 450_000)]),
    lineMatch(onions, f, status(onions, 4000), 4000, [matchItem("flat", 600_000)]),
    lineMatch(tomatoes, f, status(tomatoes, 5000), 5000, [matchItem("flat", 500_000)]),
    lineMatch(yogurt, f, "missing", 0),
    lineMatch(paste, f, status(paste, 150_000), 150_000, [matchItem("me", 150_000)]),
    lineMatch(oil, f, status(oil, 400_000), 400_000, [matchItem("flat", 400_000), matchItem("me", 100_000)]),
    lineMatch(masala, f, "always", 0),
    lineMatch(salt, f, "always", 0),
  ];
  const count = (s: RecipeLineMatch["status"]) => lines.filter((l) => l.status === s).length;
  return {
    recipeId: "rcp_curry",
    factorMilli: f,
    portions: scalePortions(8, f),
    lines,
    summary: {
      lines: lines.length,
      have: count("have"),
      short: count("short"),
      missing: count("missing"),
      always: count("always"),
      missingNames: lines.filter((l) => l.status === "missing").map((l) => CURRY_LINES[l.position]!.name),
      maxFactorMilli: null,
      ...patch,
    },
    unlinked: [],
  };
}

/** A Cook now entry. */
export function cookNow(id: string, name: string, missing: number, opts: { lines?: number; forPortionsHalf?: number | null; servesHalf?: number; missingNames?: string[]; maxFactorMilli?: number | null } = {}): CookNowEntry {
  const lines = opts.lines ?? 5;
  return {
    recipe: summary({ id, name, servesHalf: opts.servesHalf ?? 8, serves: (opts.servesHalf ?? 8) / 2, lineCount: lines }),
    match: {
      lines,
      have: lines - missing,
      short: 0,
      missing,
      always: 0,
      missingNames: opts.missingNames ?? [],
      maxFactorMilli: missing > 0 ? null : (opts.maxFactorMilli ?? 1000),
    },
    forPortionsHalf: missing > 0 ? null : (opts.forPortionsHalf ?? 6),
  };
}

export { ANU, FLAT, ME };
