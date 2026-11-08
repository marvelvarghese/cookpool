// Shared set-up for the CM-3 suites (posts, feeds, Yum, comments, reports,
// Activity): CM-2's community world (./community-helpers.ts — Meera and Anu
// share Flat 4B, Dev shares the Lunch club with Meera, Kabir and Sam are in
// no group with anyone), plus dishes cooked through the real dish write and
// posted through the real post write.

import type {
  CommunityPost,
  CookDishResponse,
  DishResponse,
  KitchenItemResponse,
  PostResponse,
  RecipeResponse,
} from "@saas/contracts/kitchen";
import { me, recipe, type CommunityWorld } from "./community-helpers.js";

export * from "./community-helpers.js";

export const START = Date.UTC(2026, 11, 1, 12, 0, 0);

/** A guided Chicken curry: 1 kg of chicken (main) scales it; two cook steps and a prep step. */
export const guidedCurry = {
  name: "Chicken curry",
  servesHalf: 8,
  lines: [
    { foodKey: "chicken", name: "Chicken", quantity: "1", unit: "kg", isMain: true },
    { foodKey: "onion", name: "Onions", quantity: 2, unit: "onion" },
  ],
  steps: [
    { text: "Marinate the chicken", phase: "prep" },
    { text: "Brown the onions", lines: [1], heat: 2, minSeconds: 600, maxSeconds: 900, timeRule: "linear" },
    { text: "Simmer the curry", heat: 1, minSeconds: 900, maxSeconds: 1200, handsOff: true },
  ],
};

/** Write a recipe as `as` from `body`; throws unless it is 201. */
export async function writeRecipe(w: CommunityWorld, as: string, body: Record<string, unknown>): Promise<RecipeResponse["recipe"]> {
  return recipe(w, as, String(body.name), body);
}

/** Make `recipeId` public: a listed link recipe. */
export async function publish(w: CommunityWorld, as: string, recipeId: string): Promise<void> {
  w.tick();
  const res = await w.call<RecipeResponse>("PATCH", me(`recipes/${recipeId}`), as, { listed: true });
  if (res.status !== 200) throw new Error(`publish: ${res.status} ${JSON.stringify(res.body.error)}`);
}

/** Copy a recipe as `as`; the copy. */
export async function copy(w: CommunityWorld, as: string, recipeId: string): Promise<RecipeResponse["recipe"]> {
  w.tick();
  const res = await w.call<RecipeResponse>("POST", me("recipes/copies"), as, { recipeId });
  if (res.status !== 201) throw new Error(`copy: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.recipe;
}

export interface CookOptions {
  name?: string;
  recipeId?: string;
  factorMilli?: number;
  /** Seconds per step key. */
  log?: Record<string, number>;
  /** Share it in this group (assigned, finalized with these shares) instead of Just me. */
  group?: { publicId: string; shares: Array<{ subjectId: string; portionsHalf: number }>; finalize?: boolean };
  portionsHalf?: number;
}

/** `as` cooks a dish from their own pantry; its `dsh_` id. Group dishes are assigned and (by default) finalized. */
export async function cook(w: CommunityWorld, as: string, opts: CookOptions = {}): Promise<string> {
  w.tick();
  const item = await w.call<KitchenItemResponse>("POST", me("items"), as, {
    name: "Onions", category: "veg", quantity: "1", unit: "kg", priceMinor: 6000,
  });
  if (item.status !== 201) throw new Error(`item: ${item.status}`);
  w.tick();
  const portionsHalf = opts.portionsHalf ?? 8;
  const res = await w.call<CookDishResponse>("POST", me("dishes"), as, {
    name: opts.name ?? "Chicken curry",
    portionsHalf,
    extrasMinor: 2500,
    splitMode: "assign",
    ...(opts.group ? { orgId: opts.group.publicId } : {}),
    ...(opts.recipeId ? { recipeId: opts.recipeId } : {}),
    ...(opts.factorMilli ? { recipeFactorMilli: opts.factorMilli } : {}),
    ingredients: [{ itemId: item.body.data.item.id, quantity: "100", unit: "g" }],
    ...(opts.log
      ? {
          stepLog: Object.entries(opts.log).map(([key, seconds]) => ({
            key,
            startedAt: new Date(START).toISOString(),
            doneAt: new Date(START + seconds * 1000).toISOString(),
          })),
        }
      : {}),
  });
  if (res.status !== 201) throw new Error(`cook: ${res.status} ${JSON.stringify(res.body.error)}`);
  const dish = res.body.data.dish;
  if (opts.group) {
    const path = `/v1/organizations/${opts.group.publicId}/kitchen/dishes/${dish.id}`;
    w.tick();
    const shared = await w.call<DishResponse>("PUT", `${path}/shares`, as, { shares: opts.group.shares });
    if (shared.status !== 200) throw new Error(`shares: ${shared.status} ${JSON.stringify(shared.body.error)}`);
    if (opts.group.finalize !== false) {
      w.tick();
      const done = await w.call<DishResponse>("POST", `${path}/finalize`, as, {});
      if (done.status !== 200) throw new Error(`finalize: ${done.status} ${JSON.stringify(done.body.error)}`);
    }
  }
  return dish.id;
}

/** Post a dish; the response. */
export async function share(w: CommunityWorld, as: string, body: Record<string, unknown>) {
  w.tick();
  return w.call<PostResponse>("POST", me("posts"), as, body);
}

/** Post a dish; throws unless it is 201; the post. */
export async function posted(w: CommunityWorld, as: string, dishId: string, audience = "followers", extra: Record<string, unknown> = {}): Promise<CommunityPost> {
  const res = await share(w, as, { dishId, audience, ...extra });
  if (res.status !== 201) throw new Error(`post: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.post;
}

/** Cook a Just me dish and post it at once. */
export async function cookAndPost(w: CommunityWorld, as: string, audience = "followers", opts: CookOptions & { extra?: Record<string, unknown> } = {}): Promise<CommunityPost> {
  const dishId = await cook(w, as, opts);
  return posted(w, as, dishId, audience, opts.extra ?? {});
}

/** The post as `as` reads it: the status and, when 200, the post. */
export async function readPost(w: CommunityWorld, as: string, postId: string) {
  const res = await w.call<PostResponse>("GET", `/v1/kitchen/posts/${postId}`, as);
  return { status: res.status, post: res.body.data?.post };
}

/** The ids of a feed page, newest (or highest ranked) first. */
export async function feedIds(w: CommunityWorld, as: string, tab: "following" | "discover", cursor?: string) {
  const res = await w.call<{ posts: CommunityPost[]; nextCursor: string | null }>(
    "GET",
    `/v1/kitchen/me/feed?tab=${tab}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    as,
  );
  if (res.status !== 200) throw new Error(`feed: ${res.status} ${JSON.stringify(res.body.error)}`);
  return { ids: res.body.data.posts.map((p) => p.id), posts: res.body.data.posts, nextCursor: res.body.data.nextCursor };
}

/** The stored UUID of a public `<prefix>_<hex>` id. */
export function uuidOf(publicId: string): string {
  return publicId.replace(/^[a-z]+_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

export const post = (w: CommunityWorld, as: string, path: string, body: unknown = {}) => {
  w.tick();
  return w.call<Record<string, unknown>>("POST", path, as, body);
};
export const del = (w: CommunityWorld, as: string, path: string) => {
  w.tick();
  return w.call<Record<string, unknown>>("DELETE", path, as);
};
