import {
  COOK_NOW_LIMIT,
  DEFAULT_COPY_VISIBILITY,
  EXPLORE_SOURCES,
  KITCHEN_ERROR_REASONS,
  RECIPE_KINDS,
  RECIPE_LINK_CODE_RE,
  RECIPE_MAX_FACTOR_MILLI,
  RECIPE_MIN_FACTOR_MILLI,
  SYSTEM_RECIPE_OWNER_NAME,
  isRecipeUnit,
  scalePortions,
  type CookNowEntry,
  type CookNowResponse,
  type ExploreRecipesResponse,
  type MyRecipesResponse,
  type PersonRecipesResponse,
  type RecipeKind,
  type RecipeMatchResponse,
  type RecipeResponse,
} from "@saas/contracts/kitchen";
import { asUuid, type Uuid } from "@saas/db/ids";
import type {
  KitchenDishIngredientRecord,
  KitchenFoodRecord,
  KitchenRecipeTemplateRecord,
  KitchenRepository,
  KitchenResult,
  NewKitchenRecipe,
} from "@saas/db/kitchen";
import type { RequestContext } from "../context.js";
import { withKitchenRepo } from "../db.js";
import { unknownFoods } from "../foods.js";
import { conflict, notFound, readJsonObject, successResponse, unavailable, validationError } from "../http.js";
import { canUseIn } from "../groups-client.js";
import { parsePublicId, toPublicId } from "../ids.js";
import { MAX_QUERY } from "../pantry.js";
import {
  EXPLORE_LIMIT,
  MAX_RECIPES_LIST,
  MAX_RECIPES_READ,
  MAX_UNLINKED,
  callerGroups,
  canEdit,
  canSee,
  checkStepLines,
  checkStepTimes,
  coMembers,
  keptStep,
  learnedSteps,
  foodsOf,
  canMake,
  forPortionsHalf,
  matchRecipe,
  mintLinkCode,
  orgIdOf,
  ownerNames,
  parseFromDish,
  parseNewRecipe,
  parseRecipeEdit,
  parseStepTimes,
  lineFoods,
  readStock,
  resolveSteps,
  seenInPublic,
  sharesGroup,
  summarize,
  matchLine,
  toKitchenRecipe,
  toLastCook,
  toRecipeSummary,
  type ParsedLine,
} from "../recipes.js";
import { Fields, oneOf } from "../validate.js";
import { profileNames, publicSource, toPublicRecipeSummary } from "../community.js";
import { foodNameKey } from "@saas/contracts/kitchen";

// Recipes (RC-4, cookpool-recipes design §3, §5, §7):
//
//   GET    /v1/kitchen/me/recipes                   yours and your copies, last cooked first
//   POST   /v1/kitchen/me/recipes                   write one; `fromDishId` saves a dish as one
//   POST   /v1/kitchen/me/recipes/copies            save your own copy ({ recipeId } or { linkCode })
//   PATCH  /v1/kitchen/me/recipes/{rcp}             its owner
//   DELETE /v1/kitchen/me/recipes/{rcp}             its owner: soft, copies stay
//   GET    /v1/kitchen/me/recipes/{rcp}/match?f=&code=   who may see it: what your pantries hold
//   POST   /v1/kitchen/me/recipes/{rcp}/link        its owner: mint or rotate the link
//   DELETE /v1/kitchen/me/recipes/{rcp}/link        its owner: turn it off
//   GET    /v1/kitchen/recipes/{rcp}?code=&f=       who may see it, with your last cook of it
//   GET    /v1/kitchen/recipes?source=&q=&kind=     Explore: Cookpool's, your groups', or public (CM-2)
//   GET    /v1/kitchen/recipe-links/{code}?f=       anyone signed in with the code
//   GET    /v1/kitchen/people/{usr}/recipes         someone you share a group with
//   GET    /v1/kitchen/me/cook-now                  only what your kitchen can make, best first (RV-20)
//   PATCH  /v1/kitchen/me/recipes/{rcp}/step-times  its owner: "Use today's times" (GC-2)
//
// Guided steps (GC-2): every write and read carries the step fields, the
// tools and long prep; copies keep their steps' keys, and an edit keeps the
// key of each step it keeps (`resolveSteps`).
//
// Learned ranges (GC-7): every `{ recipe, lastCook }` answer carries each
// guided step's `learned` once cooks have taught it — at `?f=` on the two
// reads (the match's bounds, default 1000), at the recipe as written on the
// writes — from one extra storage read beside the last cook (`learnedSteps`).
//
// A recipe moves no money and writes no audit event: an audit log is a
// group's, and a recipe belongs to a person. Everything the caller may not
// see — and everything that does not exist — is the opaque 404.

/** A public subject id as the edge forwards it (`usr_…`). */
const SUBJECT_ID_RE = /^[A-Za-z0-9][\w-]{0,127}$/;

/** A taken link code is drawn again: this many times at most (58^10 codes make a clash all but impossible). */
const LINK_ATTEMPTS = 3;

/**
 * `{ recipe, lastCook }` as the caller reads it, its steps' learned ranges at
 * `factorMilli` (GC-7). `inPublic` (CM-2): the caller sees it only because it
 * is public, so its owner and source are named by their profiles, never by
 * identity.
 */
async function recipeResponse(
  ctx: RequestContext,
  repo: KitchenRepository,
  record: KitchenRecipeTemplateRecord,
  status = 200,
  factorMilli = 1000,
  inPublic = false,
): Promise<Response> {
  const [names, last, learned] = await Promise.all([
    inPublic ? profileNames(ctx, repo, [record]) : ownerNames(ctx, [record]),
    ctx.timings.measure("db", () => repo.lastCook(ctx.actor.subjectId, record.id as Uuid)),
    learnedSteps(ctx, repo, record, factorMilli),
  ]);
  if (!names || !last.ok || !learned) return unavailable(ctx.requestId);
  const recipe = toKitchenRecipe(record, ctx.actor.subjectId, names, learned);
  return successResponse<RecipeResponse>(
    { recipe: inPublic ? publicSource(recipe, record, names) : recipe, lastCook: last.value ? toLastCook(last.value) : null },
    ctx.requestId,
    status,
  );
}

/** A recipe the caller may see, by its `rcp_…` id (and link code), and whether only as a public one (CM-2); or the Response to return. */
export async function visibleRecipe(
  ctx: RequestContext,
  repo: KitchenRepository,
  param: string,
  code: string | null,
): Promise<{ recipe: KitchenRecipeTemplateRecord; inPublic: boolean } | Response> {
  const recipeId = parsePublicId("rcp", param);
  if (!recipeId) return notFound(ctx.requestId);
  const found = await ctx.timings.measure("db", () => repo.getRecipe(recipeId, ctx.actor.subjectId));
  if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
  const allowed = await canSee(ctx, found.value, code);
  if (allowed === null) return unavailable(ctx.requestId);
  if (allowed) return { recipe: found.value, inPublic: false };
  const inPublic = await seenInPublic(ctx, repo, found.value);
  if (inPublic === null) return unavailable(ctx.requestId);
  return inPublic ? { recipe: found.value, inPublic: true } : notFound(ctx.requestId);
}

/** A recipe the caller may change (theirs, live, not Cookpool's): the record, or the Response to return. */
async function ownRecipe(ctx: RequestContext, repo: KitchenRepository, param: string): Promise<KitchenRecipeTemplateRecord | Response> {
  const recipeId = parsePublicId("rcp", param);
  if (!recipeId) return notFound(ctx.requestId);
  const found = await ctx.timings.measure("db", () => repo.getRecipe(recipeId, ctx.actor.subjectId));
  if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
  // Someone else's — even one they can see — is not theirs to change: the opaque 404.
  return canEdit(ctx, found.value) ? found.value : notFound(ctx.requestId);
}

/** `?code=` when it is a well-formed link code; anything else is no code. */
function codeParam(url: URL): string | null {
  const code = url.searchParams.get("code");
  return code !== null && RECIPE_LINK_CODE_RE.test(code) ? code : null;
}

/** Write a recipe; a taken link code is drawn again. */
async function writeRecipe(
  ctx: RequestContext,
  repo: KitchenRepository,
  input: Omit<NewKitchenRecipe, "linkCode">,
): Promise<KitchenResult<KitchenRecipeTemplateRecord>> {
  for (let attempt = 1; ; attempt += 1) {
    const linkCode = input.visibility === "link" ? mintLinkCode() : null;
    const written = await ctx.timings.measure("db", () => repo.createRecipe({ ...input, linkCode }));
    if (written.ok || written.error.kind !== "conflict" || attempt >= LINK_ATTEMPTS) return written;
  }
}

/** A refused recipe write as a response: a food that left the list is the caller's 422; anything else a 503. */
function writeFailed(ctx: RequestContext, result: Exclude<KitchenResult<unknown>, { ok: true }>): Response {
  if (result.error.kind === "not_found") return notFound(ctx.requestId);
  if (result.error.kind === "invalid") {
    if (result.error.reason === "duplicate_step_key") return validationError(ctx.requestId, { steps: ["Each step's key once"] });
    return validationError(ctx.requestId, { lines: [result.error.reason === "unknown_food" ? "Every food must be on the food list" : "A line is out of range"] });
  }
  return unavailable(ctx.requestId);
}

/** Every food the lines name must be on the list: the field errors (empty when they all are), or a 503. */
async function checkFoods(ctx: RequestContext, repo: KitchenRepository, lines: readonly ParsedLine[]): Promise<Response | null> {
  const known = await unknownFoods(ctx, repo, lineFoods(lines));
  if (!known) return unavailable(ctx.requestId);
  return Object.keys(known.errors).length > 0 ? validationError(ctx.requestId, known.errors) : null;
}

// ── Yours ──────────────────────────────────────────────────

export async function handleMyRecipes(ctx: RequestContext): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const me = ctx.actor.subjectId;
    const found = await ctx.timings.measure("db", () =>
      repo.listRecipes({ viewer: me, ownerId: me, q: null, kind: null, limit: MAX_RECIPES_LIST }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    // Last cooked first; never-cooked ones after, newest first (the read's order).
    const recipes = [...found.value].sort((a, b) => (b.lastCookedAt?.getTime() ?? -1) - (a.lastCookedAt?.getTime() ?? -1));
    const names = await ownerNames(ctx, recipes);
    return successResponse<MyRecipesResponse>({ recipes: recipes.map((r) => toRecipeSummary(r, me, names)) }, ctx.requestId);
  });
}

/** One ingredient's weight in grams, for "the heaviest is the main line": mass as is, volume as water, pieces by the food's weight. */
function gramsOf(ingredient: KitchenDishIngredientRecord, food: KitchenFoodRecord | undefined): number {
  switch (ingredient.unit) {
    case "g":
    case "kg":
    case "ml":
    case "L":
    case "tsp":
    case "tbsp":
    case "cup":
      return ingredient.qtyMilli / 1000;
    case "pcs":
    case "dozen":
      return food?.eachG ? (ingredient.qtyMilli / 1000) * food.eachG : 0;
    default:
      return 0;
  }
}

/** POST /v1/kitchen/me/recipes with `fromDishId`. */
async function saveDishAsRecipe(ctx: RequestContext, repo: KitchenRepository, body: Record<string, unknown>): Promise<Response> {
  const parsed = parseFromDish(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const dishId = parsePublicId("dsh", parsed.value.dishId);
  if (!dishId) return notFound(ctx.requestId);
  const groups = await callerGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const found = await ctx.timings.measure("db", () =>
    repo.getDish(dishId, { cook: ctx.actor.subjectId, orgIds: groups.map((g) => g.orgId) }),
  );
  if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
  const dish = found.value;
  if (dish.state === "canceled") {
    return conflict(ctx.requestId, "This dish was canceled: there is nothing to save", KITCHEN_ERROR_REASONS.DISH_NOT_OPEN, { state: dish.state });
  }

  const itemFoods = await ctx.timings.measure("db", () => repo.itemFoods(dish.ingredients.map((i) => i.itemId)));
  if (!itemFoods.ok) return unavailable(ctx.requestId);
  const keys = [...new Set([...itemFoods.value.values()].filter((k): k is string => k !== null))];
  const foods = await ctx.timings.measure("db", () => repo.getFoods(keys));
  if (!foods.ok) return unavailable(ctx.requestId);
  const foodByKey = new Map(foods.value.map((f) => [f.key, f]));

  // Every ingredient a line at the amount used, in the dish's order; the heaviest is the main one.
  let heaviest = 0;
  dish.ingredients.forEach((ingredient, i) => {
    const food = foodByKey.get(itemFoods.value.get(ingredient.itemId) ?? "");
    if (gramsOf(ingredient, food) > gramsOf(dish.ingredients[heaviest]!, foodByKey.get(itemFoods.value.get(dish.ingredients[heaviest]!.itemId) ?? ""))) heaviest = i;
  });
  const lines = dish.ingredients.map((ingredient, i) => ({
    foodKey: itemFoods.value.get(ingredient.itemId) ?? null,
    name: ingredient.name,
    qtyMilli: ingredient.qtyMilli,
    // The engine's units are the app's, but for a dozen (pieces) and a pack (a count word).
    unit: isRecipeUnit(ingredient.unit) ? ingredient.unit : ingredient.unit === "dozen" ? "pcs" : ingredient.unit,
    toTaste: false,
    isMain: i === heaviest,
  }));
  // A step's lines point at the dish's ingredients, which become the lines in order.
  const stepFields = new Fields();
  checkStepLines(stepFields, parsed.value.steps, lines.length);
  if (!stepFields.ok) return validationError(ctx.requestId, stepFields.errors);
  const written = await writeRecipe(ctx, repo, {
    id: asUuid(crypto.randomUUID()),
    ownerId: ctx.actor.subjectId,
    name: parsed.value.name ?? dish.name,
    servesHalf: dish.portionsHalf,
    minutes: parsed.value.minutes,
    kind: parsed.value.kind,
    visibility: parsed.value.visibility,
    source: null,
    lines,
    steps: resolveSteps(parsed.value.steps, null, lines.length),
    tools: parsed.value.tools,
    now: ctx.now(),
  });
  if (!written.ok) return writeFailed(ctx, written);
  return recipeResponse(ctx, repo, written.value, 201);
}

export async function handleCreateRecipe(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  return withKitchenRepo(ctx, async (repo) => {
    if (body.fromDishId !== undefined) return saveDishAsRecipe(ctx, repo, body);
    const parsed = parseNewRecipe(body);
    if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
    const recipe = parsed.value;
    const refused = await checkFoods(ctx, repo, recipe.lines);
    if (refused) return refused;
    const written = await writeRecipe(ctx, repo, {
      id: asUuid(crypto.randomUUID()),
      ownerId: ctx.actor.subjectId,
      name: recipe.name,
      servesHalf: recipe.servesHalf,
      minutes: recipe.minutes,
      kind: recipe.kind,
      visibility: recipe.visibility,
      source: null,
      lines: recipe.lines,
      steps: resolveSteps(recipe.steps, null, recipe.lines.length),
      tools: recipe.tools,
      now: ctx.now(),
    });
    if (!written.ok) return writeFailed(ctx, written);
    return recipeResponse(ctx, repo, written.value, 201);
  });
}

export async function handleUpdateRecipe(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseRecipeEdit(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  const edit = parsed.value;
  return withKitchenRepo(ctx, async (repo) => {
    const recipe = await ownRecipe(ctx, repo, params[0]!);
    if (recipe instanceof Response) return recipe;
    if (edit.lines) {
      const refused = await checkFoods(ctx, repo, edit.lines);
      if (refused) return refused;
    }
    // A step's lines are the recipe's lines after this edit: the new ones when it sends them.
    const lineCount = edit.lines ? edit.lines.length : recipe.lines.length;
    let steps = edit.steps ? resolveSteps(edit.steps, recipe.guidedSteps, lineCount) : undefined;
    if (edit.steps) {
      const stepFields = new Fields();
      checkStepLines(stepFields, edit.steps, lineCount);
      if (!stepFields.ok) return validationError(ctx.requestId, stepFields.errors);
    } else if (edit.lines && recipe.guidedSteps.some((s) => s.lineRefs.some((ref) => ref >= lineCount))) {
      // Fewer lines and the same steps: each keeps its key, without the lines that are gone.
      steps = recipe.guidedSteps.map((s) => keptStep(s, lineCount));
    }
    for (let attempt = 1; ; attempt += 1) {
      const updated = await ctx.timings.measure("db", () =>
        repo.updateRecipe({
          recipeId: recipe.id as Uuid,
          ownerId: ctx.actor.subjectId,
          changes: {
            ...(edit.name !== undefined ? { name: edit.name } : {}),
            ...(edit.servesHalf !== undefined ? { servesHalf: edit.servesHalf } : {}),
            ...(edit.minutes !== undefined ? { minutes: edit.minutes } : {}),
            ...(edit.kind !== undefined ? { kind: edit.kind } : {}),
            ...(edit.visibility !== undefined ? { visibility: edit.visibility, newLinkCode: mintLinkCode() } : {}),
            // Listed (CM-2): true mints a link when it has none.
            ...(edit.listed !== undefined ? { listed: edit.listed, newLinkCode: mintLinkCode() } : {}),
            ...(edit.tools !== undefined ? { tools: edit.tools } : {}),
          },
          ...(edit.lines ? { lines: edit.lines } : {}),
          ...(steps ? { steps } : {}),
          now: ctx.now(),
        }),
      );
      if (updated.ok) return recipeResponse(ctx, repo, updated.value);
      if (updated.error.kind === "conflict" && attempt < LINK_ATTEMPTS) continue;
      return writeFailed(ctx, updated);
    }
  });
}

/**
 * PATCH /v1/kitchen/me/recipes/{rcp}/step-times — "Use today's times" (GC-2,
 * cookpool-guided design §3.6, §5): its owner sets some steps' ranges, by
 * key. Only those steps change; the pool of cooks' times does not.
 */
export async function handleUpdateStepTimes(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const parsed = parseStepTimes(body);
  if (!parsed.ok) return validationError(ctx.requestId, parsed.fields);
  return withKitchenRepo(ctx, async (repo) => {
    const recipe = await ownRecipe(ctx, repo, params[0]!);
    if (recipe instanceof Response) return recipe;
    const refused = checkStepTimes(parsed.value, recipe);
    if (refused) return validationError(ctx.requestId, refused);
    const updated = await ctx.timings.measure("db", () =>
      repo.setRecipeStepTimes({ recipeId: recipe.id as Uuid, ownerId: ctx.actor.subjectId, steps: parsed.value, now: ctx.now() }),
    );
    if (!updated.ok) return writeFailed(ctx, updated);
    return recipeResponse(ctx, repo, updated.value);
  });
}

export async function handleDeleteRecipe(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const recipe = await ownRecipe(ctx, repo, params[0]!);
    if (recipe instanceof Response) return recipe;
    const deleted = await ctx.timings.measure("db", () => repo.deleteRecipe(recipe.id as Uuid, ctx.actor.subjectId, ctx.now()));
    if (!deleted.ok) return deleted.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    return recipeResponse(ctx, repo, deleted.value);
  });
}

// ── Links (design §5.1) ────────────────────────────────────

export async function handleCreateRecipeLink(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const recipe = await ownRecipe(ctx, repo, params[0]!);
    if (recipe instanceof Response) return recipe;
    // A new code every time: rotating ends the old one at once.
    for (let attempt = 1; ; attempt += 1) {
      const linked = await ctx.timings.measure("db", () =>
        repo.setRecipeLink(recipe.id as Uuid, ctx.actor.subjectId, mintLinkCode(), ctx.now()),
      );
      if (linked.ok) return recipeResponse(ctx, repo, linked.value);
      if (linked.error.kind === "conflict" && attempt < LINK_ATTEMPTS) continue;
      return writeFailed(ctx, linked);
    }
  });
}

export async function handleDeleteRecipeLink(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  return withKitchenRepo(ctx, async (repo) => {
    const recipe = await ownRecipe(ctx, repo, params[0]!);
    if (recipe instanceof Response) return recipe;
    const unlinked = await ctx.timings.measure("db", () => repo.setRecipeLink(recipe.id as Uuid, ctx.actor.subjectId, null, ctx.now()));
    if (!unlinked.ok) return writeFailed(ctx, unlinked);
    return recipeResponse(ctx, repo, unlinked.value);
  });
}

export async function handleRecipeByLink(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const code = params[0] ?? "";
  if (!RECIPE_LINK_CODE_RE.test(code)) return notFound(ctx.requestId);
  const fields = new Fields();
  const factorMilli = factorParam(fields, new URL(request.url));
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () => repo.getRecipeByLinkCode(code, ctx.actor.subjectId));
    if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
    return recipeResponse(ctx, repo, found.value, 200, factorMilli);
  });
}

// ── Reading one, and what you have ─────────────────────────

/** GET /v1/kitchen/recipes/{rcp}?code=&f= — `f` is the size its steps' learned ranges are at (GC-7). */
export async function handleGetRecipe(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const url = new URL(request.url);
  const fields = new Fields();
  const factorMilli = factorParam(fields, url);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  const code = codeParam(url);
  return withKitchenRepo(ctx, async (repo) => {
    const visible = await visibleRecipe(ctx, repo, params[0]!, code);
    if (visible instanceof Response) return visible;
    return recipeResponse(ctx, repo, visible.recipe, 200, factorMilli, visible.inPublic);
  });
}

/** `?f=`: the factor in thousandths, RECIPE_MIN_FACTOR_MILLI–RECIPE_MAX_FACTOR_MILLI (default 1000); the match's, and the recipe read's (GC-7). */
function factorParam(fields: Fields, url: URL): number {
  const raw = url.searchParams.get("f");
  if (raw === null || raw === "") return 1000;
  const n = Number(raw);
  if (/^\d+$/.test(raw) && n >= RECIPE_MIN_FACTOR_MILLI && n <= RECIPE_MAX_FACTOR_MILLI) return n;
  fields.add("f", `Must be the factor in thousandths, a whole number from ${RECIPE_MIN_FACTOR_MILLI} to ${RECIPE_MAX_FACTOR_MILLI} (450 is × 0.45)`);
  return 1000;
}

export async function handleRecipeMatch(ctx: RequestContext, request: Request, params: readonly string[]): Promise<Response> {
  const url = new URL(request.url);
  const fields = new Fields();
  const factorMilli = factorParam(fields, url);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);
  const code = codeParam(url);
  const groups = await callerGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const visible = await visibleRecipe(ctx, repo, params[0]!, code);
    if (visible instanceof Response) return visible;
    const recipe = visible.recipe;
    const stock = await readStock(ctx, repo, groups, foodsOf([recipe]));
    if (!stock) return unavailable(ctx.requestId);
    const scope = { ownerSubjectId: ctx.actor.subjectId, orgIds: groups.filter(canUseIn).map((g) => g.orgId) };
    const unlinked = await ctx.timings.measure("db", () => repo.listUnlinkedItems(scope, MAX_UNLINKED));
    if (!unlinked.ok) return unavailable(ctx.requestId);
    const { lines, summary } = matchRecipe(recipe, factorMilli, stock);
    return successResponse<RecipeMatchResponse>(
      {
        recipeId: params[0]!,
        factorMilli,
        portions: scalePortions(recipe.servesHalf, factorMilli),
        lines,
        summary,
        unlinked: unlinked.value.map((item) => ({
          itemId: toPublicId("itm", item.id),
          orgId: orgIdOf(item.orgId),
          name: item.name,
          nameKey: foodNameKey(item.name),
        })),
      },
      ctx.requestId,
    );
  });
}

// ── Copies (design §5.2) ───────────────────────────────────

export async function handleCopyRecipe(ctx: RequestContext, request: Request): Promise<Response> {
  const body = await readJsonObject(request);
  if (!body) return validationError(ctx.requestId, { body: ["Must be a JSON object"] });
  const byId = body.recipeId !== undefined && body.recipeId !== null;
  const byCode = body.linkCode !== undefined && body.linkCode !== null;
  if (byId === byCode) return validationError(ctx.requestId, { body: ["Send recipeId or linkCode: one of them"] });
  if (byId && (typeof body.recipeId !== "string" || !parsePublicId("rcp", body.recipeId))) {
    return validationError(ctx.requestId, { recipeId: ["Must be a recipe's rcp_ id"] });
  }
  if (byCode && (typeof body.linkCode !== "string" || !RECIPE_LINK_CODE_RE.test(body.linkCode))) {
    return validationError(ctx.requestId, { linkCode: ["Must be a recipe link's 10-character code"] });
  }

  return withKitchenRepo(ctx, async (repo) => {
    let source: KitchenRecipeTemplateRecord;
    let inPublic = false;
    if (byId) {
      const visible = await visibleRecipe(ctx, repo, body.recipeId as string, null);
      if (visible instanceof Response) return visible;
      source = visible.recipe;
      inPublic = visible.inPublic;
    } else {
      const found = await ctx.timings.measure("db", () => repo.getRecipeByLinkCode(body.linkCode as string, ctx.actor.subjectId));
      if (!found.ok) return found.error.kind === "not_found" ? notFound(ctx.requestId) : unavailable(ctx.requestId);
      source = found.value;
    }
    // A public recipe's owner is named by their profile (CM-2), never by identity.
    const names = inPublic ? await profileNames(ctx, repo, [source]) : await ownerNames(ctx, [source]);
    if (!names) return unavailable(ctx.requestId);
    const ownerName = source.isSystem ? SYSTEM_RECIPE_OWNER_NAME : (names.get(source.ownerId) ?? null);
    // A copy of someone's public recipe tells them (CM-3): `saved_yours` in the copy's own batch.
    const me = ctx.actor.subjectId;
    const savedYours =
      !source.isSystem && source.ownerId !== me && source.visibility === "link" && source.listed
        ? { id: crypto.randomUUID(), userId: source.ownerId, kind: "saved_yours" as const, actorId: me, recipeId: source.id, now: ctx.now() }
        : null;
    // A copy is its own: owned by the saver, Only me, the same lines, steps (their keys too) and tools, and where it came from.
    const written = await writeRecipe(ctx, repo, {
      id: asUuid(crypto.randomUUID()),
      ownerId: ctx.actor.subjectId,
      name: source.name,
      servesHalf: source.servesHalf,
      minutes: source.minutes,
      kind: source.kind,
      visibility: DEFAULT_COPY_VISIBILITY,
      source: { recipeId: source.id, ownerId: source.ownerId, ownerName },
      lines: source.lines.map(({ position: _position, ...line }) => line),
      steps: source.guidedSteps.map((step) => keptStep(step)),
      tools: source.tools,
      now: ctx.now(),
      savedYours,
    });
    if (!written.ok) return writeFailed(ctx, written);
    return recipeResponse(ctx, repo, written.value, 201);
  });
}

// ── A person's, Explore, Cook now ──────────────────────────

export async function handlePersonRecipes(ctx: RequestContext, _request: Request, params: readonly string[]): Promise<Response> {
  let otherId: string;
  try {
    otherId = decodeURIComponent(params[0] ?? "");
  } catch {
    return notFound(ctx.requestId);
  }
  if (!SUBJECT_ID_RE.test(otherId) || otherId === ctx.actor.subjectId) return notFound(ctx.requestId);
  const shared = await sharesGroup(ctx, otherId);
  if (shared === null) return unavailable(ctx.requestId);
  if (!shared) return notFound(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const found = await ctx.timings.measure("db", () =>
      repo.listRecipes({ viewer: ctx.actor.subjectId, sharedBy: [otherId], q: null, kind: null, limit: MAX_RECIPES_LIST }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    const names = await ctx.timings.measure("identity", () => ctx.people.names([otherId]));
    return successResponse<PersonRecipesResponse>(
      {
        subjectId: otherId,
        displayName: names.get(otherId) ?? null,
        recipes: found.value.map((r) => toRecipeSummary(r, ctx.actor.subjectId, names)),
      },
      ctx.requestId,
    );
  });
}

export async function handleExploreRecipes(ctx: RequestContext, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fields = new Fields();
  const rawSource = url.searchParams.get("source");
  const source = rawSource === null || rawSource === "" ? "cookpool" : (oneOf(fields, "source", rawSource, EXPLORE_SOURCES) ?? "cookpool");
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length > MAX_QUERY) fields.add("q", `Must be at most ${MAX_QUERY} characters`);
  const rawKind = url.searchParams.get("kind");
  const kind: RecipeKind | null = rawKind === null || rawKind === "" ? null : (oneOf(fields, "kind", rawKind, RECIPE_KINDS) ?? null);
  if (!fields.ok) return validationError(ctx.requestId, fields.errors);

  const groups = await callerGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  let sharedBy: string[] = [];
  if (source === "groups") {
    const members = await coMembers(ctx, groups);
    if (!members) return unavailable(ctx.requestId);
    sharedBy = members;
    if (sharedBy.length === 0) return successResponse<ExploreRecipesResponse>({ recipes: [] }, ctx.requestId);
  }

  return withKitchenRepo(ctx, async (repo) => {
    const me = ctx.actor.subjectId;
    const found = await ctx.timings.measure("db", () =>
      repo.listRecipes(
        source === "cookpool"
          ? { viewer: me, system: true, q: q || null, kind, limit: EXPLORE_LIMIT }
          : source === "public"
            ? // Public (CM-2): listed recipes of public profiles, not the caller's, nobody with a block (in storage).
              { viewer: me, publicListed: true, q: q || null, kind, limit: EXPLORE_LIMIT }
            : { viewer: me, sharedBy, q: q || null, kind, limit: EXPLORE_LIMIT },
      ),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    const stock = await readStock(ctx, repo, groups, foodsOf(found.value));
    if (!stock) return unavailable(ctx.requestId);
    // Strangers' recipes are named by their profiles, never by identity.
    const names = source === "public" ? await profileNames(ctx, repo, found.value) : await ownerNames(ctx, found.value);
    if (!names) return unavailable(ctx.requestId);
    const summaryOf = source === "public" ? toPublicRecipeSummary : toRecipeSummary;
    return successResponse<ExploreRecipesResponse>(
      {
        recipes: found.value.map((r) => ({
          ...summaryOf(r, me, names),
          match: summarize(r, r.lines.map((line) => matchLine(line, 1000, stock))),
        })),
      },
      ctx.requestId,
    );
  });
}

export async function handleCookNow(ctx: RequestContext): Promise<Response> {
  const groups = await callerGroups(ctx);
  if (!groups) return unavailable(ctx.requestId);
  const members = await coMembers(ctx, groups);
  if (!members) return unavailable(ctx.requestId);
  return withKitchenRepo(ctx, async (repo) => {
    const me = ctx.actor.subjectId;
    // Every live recipe the caller can see: theirs and their copies, Cookpool's (590's 13, RV-20), their groups'.
    const found = await ctx.timings.measure("db", () =>
      repo.listRecipes({ viewer: me, ownerId: me, system: true, sharedBy: members, q: null, kind: null, limit: MAX_RECIPES_READ }),
    );
    if (!found.ok) return unavailable(ctx.requestId);
    const stock = await readStock(ctx, repo, groups, foodsOf(found.value));
    if (!stock) return unavailable(ctx.requestId);
    // Only what the kitchen can make (RV-20): nothing missing, enough for at least half a portion.
    const ranked = found.value
      .map((recipe) => ({ recipe, summary: matchRecipe(recipe, 1000, stock).summary }))
      .filter(({ recipe, summary }) => canMake(recipe, summary))
      .sort((a, b) => {
        if (a.summary.missing !== b.summary.missing) return a.summary.missing - b.summary.missing;
        const fa = a.summary.maxFactorMilli ?? -1;
        const fb = b.summary.maxFactorMilli ?? -1;
        if (fa !== fb) return fb - fa;
        const ca = a.recipe.lastCookedAt?.getTime() ?? -1;
        const cb = b.recipe.lastCookedAt?.getTime() ?? -1;
        if (ca !== cb) return cb - ca;
        return a.recipe.name.localeCompare(b.recipe.name) || (a.recipe.id < b.recipe.id ? -1 : 1);
      })
      .slice(0, COOK_NOW_LIMIT);
    const names = await ownerNames(ctx, ranked.map((r) => r.recipe));
    return successResponse<CookNowResponse>(
      {
        recipes: ranked.map(({ recipe, summary }): CookNowEntry => ({
          recipe: toRecipeSummary(recipe, me, names),
          match: summary,
          forPortionsHalf: forPortionsHalf(recipe, summary),
        })),
      },
      ctx.requestId,
    );
  });
}
