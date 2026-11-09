// The kitchen.read tools (design §2): the person's pantries, what is running
// low, what they can cook, recipes and the shopping list. Each is one or a
// few GETs under /v1/kitchen, as the person, and changes nothing.

import { z } from "zod";
import {
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_MIN_FACTOR_MILLI,
  USE_SOON_DAYS,
  lineQuantity,
  scaleLine,
  scalePortions,
  type CookNowResponse,
  type ExploreRecipesResponse,
  type MyRecipesResponse,
  type ReachableItemsPage,
  type RecipeResponse,
  type RecipeSummary,
  type RestockResponse,
} from "@saas/contracts/kitchen";
import { listNames, money, num, pantryName, plural, qty } from "../format.js";
import { defineTool, edge, isEdgeError } from "./types.js";

const ORG_ID_RE = /^org_[0-9a-f]{32}$/;
const RECIPE_ID_RE = /^rcp_[A-Za-z0-9]{1,64}$/;

// ── pantry_list ────────────────────────────────────────────

export const pantryList = defineTool({
  name: "pantry_list",
  scope: "kitchen.read",
  title: "List pantry items",
  description:
    "Lists what is in the person's Cookpool pantries (their own and their groups'), soonest use-by first, with how much is left. " +
    "Filter by pantry, by items to use soon, or by name.",
  readOnly: true,
  inputSchema: {
    pantry: z
      .union([z.literal("all"), z.literal("personal"), z.string().regex(ORG_ID_RE)])
      .optional()
      .describe('"all" (default), "personal", or a group\'s id (org_…) from an earlier result'),
    soon: z.boolean().optional().describe(`Only items to use within ${USE_SOON_DAYS} days`),
    query: z.string().max(100).optional().describe("Name contains this"),
    limit: z.number().int().min(1).max(100).optional().describe("At most this many (default 50)"),
  },
  async run(args, ctx) {
    const res = await edge<ReachableItemsPage>(ctx, {
      method: "GET",
      path: "/v1/kitchen/me/items",
      query: { pantry: args.pantry ?? "all", filter: args.soon ? "soon" : undefined, q: args.query, limit: args.limit ?? 50 },
    });
    if (!res.ok) return res;
    const items = res.data.items.map((item) => ({
      id: item.id,
      name: item.name,
      pantry: pantryName(item.pantry),
      ...(item.pantry.kind === "group" ? { groupId: item.pantry.orgId } : {}),
      left: qty(item.qtyLeft, item.displayUnit),
      useBy: item.expiresOn,
      daysToUseBy: item.daysToUseBy,
      canUse: item.canUse,
    }));
    const pantries = new Set(items.map((i) => i.pantry)).size;
    const soon = res.data.items.filter((i) => i.daysToUseBy !== null && i.daysToUseBy >= 0 && i.daysToUseBy <= USE_SOON_DAYS).length;
    const summary =
      items.length === 0
        ? "Nothing matches in the pantry."
        : `${plural(items.length, "item")} in ${plural(pantries, "pantry", "pantries")}` +
          (soon > 0 ? `, ${soon} to use within ${USE_SOON_DAYS} days` : "") +
          (res.data.nextCursor ? " (more not shown)." : ".");
    return { summary, data: { items, more: res.data.nextCursor !== null } };
  },
});

// ── pantry_running_low and shopping_list (GET /me/restock) ─

type RestockLine = RestockResponse[keyof RestockResponse][number];

function lastBought(line: RestockLine): string {
  const amount = qty(lineQuantity(line.last.quantityMilli, line.last.unit), line.last.unit);
  return `${amount} for ${money(line.last.priceMinor, line.last.currency)}`;
}

export const pantryRunningLow = defineTool({
  name: "pantry_running_low",
  scope: "kitchen.read",
  title: "What is running low",
  description: "Lists items in the person's pantries that are nearly finished (under a fifth left), with how much is left.",
  readOnly: true,
  inputSchema: {},
  async run(_args, ctx) {
    const res = await edge<RestockResponse>(ctx, { method: "GET", path: "/v1/kitchen/me/restock" });
    if (!res.ok) return res;
    const items = res.data.runningLow.map((line) => ({
      name: line.name,
      pantry: pantryName(line.pantry),
      itemId: line.why.itemId,
      leftPercent: line.why.boughtQtyMilli > 0 ? Math.round((line.why.leftQtyMilli / line.why.boughtQtyMilli) * 100) : 0,
    }));
    const summary =
      items.length === 0
        ? "Nothing is running low."
        : `${plural(items.length, "item")} running low: ${listNames(items.map((i) => i.name))}.`;
    return { summary, data: { items } };
  },
});

export const shoppingList = defineTool({
  name: "shopping_list",
  scope: "kitchen.read",
  title: "Shopping list",
  description:
    "What the person may want to buy: items finished this week, items running low, and things they usually buy that are due, " +
    "each with what they paid last time. Read only: it buys nothing.",
  readOnly: true,
  inputSchema: {},
  async run(_args, ctx) {
    const res = await edge<RestockResponse>(ctx, { method: "GET", path: "/v1/kitchen/me/restock" });
    if (!res.ok) return res;
    const base = (line: RestockLine) => ({
      name: line.name,
      pantry: pantryName(line.pantry),
      lastTime: lastBought(line),
      canAdd: line.canAdd,
    });
    const finished = res.data.finished.map((line) => ({ ...base(line), how: line.why.how === "wasted" ? "wasted" : "used up" }));
    const runningLow = res.data.runningLow.map((line) => ({
      ...base(line),
      leftPercent: line.why.boughtQtyMilli > 0 ? Math.round((line.why.leftQtyMilli / line.why.boughtQtyMilli) * 100) : 0,
    }));
    const usual = res.data.usual.map((line) => ({ ...base(line), everyDays: line.why.everyDays, lastBoughtOn: line.why.lastBoughtAt }));
    const total = finished.length + runningLow.length + usual.length;
    const summary =
      total === 0
        ? "Nothing to buy right now."
        : `Finished: ${finished.length} · running low: ${runningLow.length} · usually buy: ${usual.length}.`;
    return { summary, data: { finished, runningLow, usual } };
  },
});

// ── what_can_i_cook ────────────────────────────────────────

function servesOf(r: RecipeSummary): number {
  return r.servesHalf / 2;
}

export const whatCanICook = defineTool({
  name: "what_can_i_cook",
  scope: "kitchen.read",
  title: "What can I cook",
  description:
    "Recipes the person can see, ranked by how much of each is already in their pantries: fewest missing ingredients first.",
  readOnly: true,
  inputSchema: {},
  async run(_args, ctx) {
    const res = await edge<CookNowResponse>(ctx, { method: "GET", path: "/v1/kitchen/me/cook-now" });
    if (!res.ok) return res;
    const recipes = res.data.recipes.map((entry) => ({
      id: entry.recipe.id,
      name: entry.recipe.name,
      serves: servesOf(entry.recipe),
      minutes: entry.recipe.minutes,
      have: `${entry.match.have + entry.match.always}/${entry.match.lines}`,
      missing: entry.match.missingNames,
      missingCount: entry.match.missing,
      shortCount: entry.match.short,
      canServe: entry.forPortionsHalf === null ? null : entry.forPortionsHalf / 2,
    }));
    const ready = recipes.filter((r) => r.missingCount === 0 && r.shortCount === 0);
    const summary =
      recipes.length === 0
        ? "No recipes to suggest yet."
        : ready.length > 0
          ? `${plural(ready.length, "recipe")} ready with what's at home: ${listNames(ready.map((r) => r.name), 3)}.`
          : `${plural(recipes.length, "recipe")}, each missing something; closest: ${recipes[0]!.name}.`;
    return { summary, data: { recipes } };
  },
});

// ── recipe_get ─────────────────────────────────────────────

export const recipeGet = defineTool({
  name: "recipe_get",
  scope: "kitchen.read",
  title: "Get a recipe",
  description:
    "One recipe in full: ingredients with amounts and its steps. Give serves (or factor) to scale the amounts; to-taste lines never scale.",
  readOnly: true,
  inputSchema: {
    recipeId: z.string().regex(RECIPE_ID_RE).describe("The recipe's id (rcp_…) from an earlier result"),
    serves: z.number().min(0.5).max(100).optional().describe("Scale to this many portions"),
    factor: z.number().min(0.01).max(20).optional().describe("Or scale by this multiple (1.5 = one and a half times)"),
  },
  async run(args, ctx) {
    const clamp = (milli: number) => Math.min(RECIPE_MAX_FACTOR_MILLI, Math.max(RECIPE_MIN_FACTOR_MILLI, Math.round(milli)));
    const asked = args.factor !== undefined ? clamp(args.factor * 1000) : null;
    // `f` is the size the recipe's learned step times are at (GC-7); amounts scale here, as the app scales them.
    const res = await edge<RecipeResponse>(ctx, {
      method: "GET",
      path: `/v1/kitchen/recipes/${encodeURIComponent(args.recipeId)}`,
      query: { f: asked ?? undefined },
    });
    if (!res.ok) return res;
    const recipe = res.data.recipe;
    const factorMilli =
      asked ?? (args.serves !== undefined && recipe.servesHalf > 0 ? clamp(((args.serves * 2) / recipe.servesHalf) * 1000) : 1000);
    const lines = recipe.lines.map((line) => {
      if (line.toTaste || line.qtyMilli === null || line.unit === null) return { name: line.name, amount: "to taste" };
      const scaled = scaleLine(line.qtyMilli, line.unit, factorMilli);
      return { name: line.name, amount: qty(lineQuantity(scaled ?? line.qtyMilli, line.unit), line.unit) };
    });
    const portions = scalePortions(recipe.servesHalf, factorMilli);
    const data = {
      id: recipe.id,
      name: recipe.name,
      by: recipe.isSystem ? "Cookpool" : recipe.mine ? "you" : recipe.ownerName,
      serves: portions.label,
      factor: Number(num(factorMilli / 1000)),
      minutes: recipe.minutes,
      lines,
      steps: recipe.steps,
      tools: recipe.tools ?? [],
    };
    const summary = `${recipe.name}: serves ${portions.label}, ${plural(lines.length, "ingredient")}, ${plural(recipe.steps.length, "step")}.`;
    return { summary, data };
  },
});

// ── recipe_search ──────────────────────────────────────────

type SearchRow = { id: string; name: string; by: string | null; serves: number; minutes: number | null; kind: string | null; have?: string };

function row(r: RecipeSummary, by: string | null): SearchRow {
  return { id: r.id, name: r.name, by, serves: servesOf(r), minutes: r.minutes, kind: r.kind };
}

export const recipeSearch = defineTool({
  name: "recipe_search",
  scope: "kitchen.read",
  title: "Search recipes",
  description:
    "Finds recipes by name among the person's own and saved recipes, Cookpool's, and their groups'. Leave the query out to list them.",
  readOnly: true,
  inputSchema: {
    query: z.string().max(100).optional().describe("Name contains this"),
  },
  async run(args, ctx) {
    const q = (args.query ?? "").trim();
    const [mine, cookpool, groups] = await Promise.all([
      edge<MyRecipesResponse>(ctx, { method: "GET", path: "/v1/kitchen/me/recipes" }),
      edge<ExploreRecipesResponse>(ctx, { method: "GET", path: "/v1/kitchen/recipes", query: { source: "cookpool", q } }),
      edge<ExploreRecipesResponse>(ctx, { method: "GET", path: "/v1/kitchen/recipes", query: { source: "groups", q } }),
    ]);
    const failed = [mine, cookpool, groups].find((r) => !r.ok);
    // Answer what came back; fail only when nothing did, or when access itself is gone.
    if (failed && isEdgeError(failed) && (failed.status === 401 || failed.status === 403 || (!mine.ok && !cookpool.ok && !groups.ok))) {
      return failed;
    }
    const needle = q.toLowerCase();
    const seen = new Set<string>();
    const rows: SearchRow[] = [];
    const add = (r: SearchRow) => {
      if (seen.has(r.id) || rows.length >= 25) return;
      seen.add(r.id);
      rows.push(r);
    };
    if (mine.ok) for (const r of mine.data.recipes) if (r.name.toLowerCase().includes(needle)) add(row(r, "you"));
    for (const res of [cookpool, groups]) {
      if (!res.ok) continue;
      for (const r of res.data.recipes) {
        const have = r.match.missing === 0 && r.match.short === 0 ? "everything" : r.match.missingNames.length > 0 ? `missing ${listNames(r.match.missingNames, 3)}` : "some";
        add({ ...row(r, r.isSystem ? "Cookpool" : r.ownerName), have });
      }
    }
    const summary = rows.length === 0 ? (q ? `No recipes match "${q}".` : "No recipes yet.") : `${plural(rows.length, "recipe")}${q ? ` matching "${q}"` : ""}.`;
    return { summary, data: { recipes: rows } };
  },
});

export const KITCHEN_TOOLS = [pantryList, pantryRunningLow, whatCanICook, recipeGet, recipeSearch, shoppingList];
