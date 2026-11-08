// Learning from cooks (Cookpool GC-7, cookpool-guided design §5, risks GC-C)
// through the router over real SQLite: cooks post dishes with a step log
// (GC-2's write, unchanged), and the recipe read gives each guided step
// `learned` — the 25th–75th percentiles of the times normalised by its rule,
// at the size `?f=` asks for — once its key has 5 times from 3 cooks. A
// canceled dish's times, skipped steps, abandoned ones and times of no size
// count for nothing; a copy (of a copy) pools with its root; and nothing in a
// read says who cooked.

import type { CookDishResponse, KitchenRecipe, LearnedStepRange, MyRecipesResponse, RecipeResponse } from "@saas/contracts/kitchen";
import { ANU, DEV, OLU, RAHUL, VIK, addItem, me, world, writeRecipe, type World } from "./recipes-helpers.js";

let w: World;

beforeEach(() => {
  w = world();
});

afterEach(() => w.h.close());

/** A guided Kadai paneer: lines 0 paneer, 1 onions; steps brown (linear), simmer (partly), pressure (whistles), serve (text). */
const paneer = {
  name: "Kadai paneer",
  servesHalf: 8,
  minutes: 45,
  kind: "dal_curry",
  lines: [
    { foodKey: "paneer", name: "Paneer", quantity: "400", unit: "g", isMain: true },
    { foodKey: "onion", name: "Onions, sliced", quantity: 2, unit: "onion" },
  ],
  steps: [
    { text: "Brown the onions", lines: [1], heat: 2, minSeconds: 600, maxSeconds: 900, timeRule: "linear", sense: "look", checkpoint: "deep golden" },
    { text: "Simmer the gravy", heat: 1, minSeconds: 480, maxSeconds: 720, handsOff: true, timeRule: "partly" },
    { text: "Pressure-cook the peas", heat: 3, whistles: 3, handsOff: true },
    "Fold in the paneer and serve",
  ],
};

/** The step keys by name. */
const keysOf = (r: Pick<KitchenRecipe, "guidedSteps">) => {
  const [brown, simmer, pressure, serve] = r.guidedSteps!.map((s) => s.key);
  return { brown: brown!, simmer: simmer!, pressure: pressure!, serve: serve! };
};

const read = async (id: string, as: string, query = "") => {
  const res = await w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${id}${query}`, as);
  if (res.status !== 200) throw new Error(`read: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.recipe;
};
/** Each step's `learned` in order (undefined where none). */
const learnedOf = (r: KitchenRecipe) => r.guidedSteps!.map((s) => s.learned);
const range = (lowSeconds: number, highSeconds: number, cooks: number, samples: number): LearnedStepRange => ({ lowSeconds, highSeconds, cooks, samples });

const START = Date.UTC(2026, 10, 8, 12, 0, 0);

/**
 * `as` cooks recipe `recipeId` from their own pantry at `factorMilli` (null:
 * the dish says no size), each step in `log` taking that many seconds; the
 * dish's `dsh_` id.
 */
async function cookIt(as: string, recipeId: string, factorMilli: number | null, log: Record<string, number>): Promise<string> {
  const onions = await addItem(w, as, null, { name: "Onions", category: "veg", quantity: "1", unit: "kg", priceMinor: 6000 });
  w.tick();
  const res = await w.call<CookDishResponse>("POST", me("dishes"), as, {
    name: "Kadai paneer",
    portionsHalf: 4,
    splitMode: "assign",
    recipeId,
    ...(factorMilli !== null ? { recipeFactorMilli: factorMilli } : {}),
    ingredients: [{ itemId: onions.id, quantity: "100", unit: "g" }],
    stepLog: Object.entries(log).map(([key, seconds]) => ({
      key,
      startedAt: new Date(START).toISOString(),
      doneAt: new Date(START + seconds * 1_000).toISOString(),
    })),
  });
  if (res.status !== 201) throw new Error(`cook: ${res.status} ${JSON.stringify(res.body.error)}`);
  return res.body.data.dish.id;
}

async function cancel(as: string, dishId: string): Promise<void> {
  w.tick();
  const res = await w.call("POST", me(`dishes/${dishId}/cancel`), as);
  expect(res.status).toBe(200);
}

describe("a step learns from 5 times by 3 cooks (GC-7, design §5)", () => {
  it("has no learned range under 5 times or under 3 cooks — the fifth time and the third cook bring it", async () => {
    const r = await writeRecipe(w, ANU, paneer);
    const k = keysOf(r);
    await cookIt(ANU, r.id, 1_000, { [k.brown]: 600, [k.simmer]: 480 });
    await cookIt(RAHUL, r.id, 1_000, { [k.brown]: 660, [k.simmer]: 540 });
    await cookIt(DEV, r.id, 1_000, { [k.brown]: 720 });
    await cookIt(ANU, r.id, 1_000, { [k.brown]: 780, [k.simmer]: 600 });
    await cookIt(RAHUL, r.id, 1_000, { [k.simmer]: 660 });
    await cookIt(ANU, r.id, 1_000, { [k.simmer]: 720 });
    // Browning: 4 times from 3 cooks. Simmering: 5 times from 2 cooks. Neither.
    let seen = await read(r.id, VIK);
    expect(learnedOf(seen)).toEqual([undefined, undefined, undefined, undefined]);
    for (const step of seen.guidedSteps!) expect(step).not.toHaveProperty("learned");

    // Dev's second cook is browning's fifth time and simmering's third cook.
    await cookIt(DEV, r.id, 1_000, { [k.brown]: 840, [k.simmer]: 710 });
    seen = await read(r.id, VIK);
    // Simmering's six: 8, 9, 10, 11, 11.8 and 12 min — the 25th is 9.25 min, the 75th 11.6.
    expect(learnedOf(seen)).toEqual([range(660, 780, 3, 5), range(540, 720, 3, 6), undefined, undefined]);
  });

  it("gives the 25th–75th percentiles normalised by the step's rule, at the recipe as written and at f = 450", async () => {
    const r = await writeRecipe(w, ANU, paneer);
    const k = keysOf(r);
    // Five cooks of three people at five sizes. Browning (× f) is 10, 11, 12,
    // 13 and 14 min as written; simmering (× √f) about 8, 9, 10, 11 and 12; the
    // pressure cooker (fixed) 15 to 19 min, whatever the size.
    await cookIt(ANU, r.id, 1_000, { [k.brown]: 600, [k.simmer]: 480, [k.pressure]: 900 });
    await cookIt(RAHUL, r.id, 2_000, { [k.brown]: 1_320, [k.simmer]: 764, [k.pressure]: 960 });
    await cookIt(DEV, r.id, 500, { [k.brown]: 360, [k.simmer]: 424, [k.pressure]: 1_020 });
    await cookIt(ANU, r.id, 1_000, { [k.brown]: 780, [k.simmer]: 660, [k.pressure]: 1_080 });
    await cookIt(RAHUL, r.id, 1_500, { [k.brown]: 1_260, [k.simmer]: 882, [k.pressure]: 1_140 });

    const asWritten = await read(r.id, VIK);
    expect(learnedOf(asWritten)).toEqual([range(660, 780, 3, 5), range(540, 660, 3, 5), range(960, 1_080, 3, 5), undefined]);
    expect(learnedOf(await read(r.id, VIK, "?f=1000"))).toEqual(learnedOf(asWritten));
    expect(learnedOf(await read(r.id, VIK, "?f="))).toEqual(learnedOf(asWritten));

    // At 450 g of the 1 kg: browning × 0.45 (4.95–5.85 min), simmering × 0.67 (6.04–7.38 min), the cooker the same.
    const smaller = await read(r.id, VIK, "?f=450");
    expect(learnedOf(smaller)).toEqual([range(300, 360, 3, 5), range(360, 420, 3, 5), range(960, 1_080, 3, 5), undefined]);
    // Twice the size: browning doubles; simmering grows by √2.
    expect(learnedOf(await read(r.id, VIK, "?f=2000"))).toEqual([range(1_320, 1_560, 3, 5), range(780, 960, 3, 5), range(960, 1_080, 3, 5), undefined]);
    // The size changes only `learned`: the author's words and times are as written.
    const { guidedSteps: a, ...restA } = asWritten;
    const { guidedSteps: b, ...restB } = smaller;
    expect(restB).toEqual(restA);
    expect(b!.map(({ learned: _l, ...s }) => s)).toEqual(a!.map(({ learned: _l, ...s }) => s));
  });

  it("leaves out a canceled dish's times, skipped steps, abandoned ones and times of no size — and a dish canceled later", async () => {
    const r = await writeRecipe(w, ANU, paneer);
    const k = keysOf(r);
    await cookIt(ANU, r.id, 1_000, { [k.brown]: 600 });
    await cookIt(RAHUL, r.id, 1_000, { [k.brown]: 660 });
    const devs = await cookIt(DEV, r.id, 1_000, { [k.brown]: 720 });
    await cookIt(ANU, r.id, 1_000, { [k.brown]: 780 });
    await cookIt(RAHUL, r.id, 1_000, { [k.brown]: 840 });
    const before = learnedOf(await read(r.id, VIK))[0];
    expect(before).toEqual(range(660, 780, 3, 5));

    // Each of these would move the range — none counts.
    const vik = await cookIt(VIK, r.id, 1_000, { [k.brown]: 120 });
    await cancel(VIK, vik); // canceled
    await cookIt(VIK, r.id, 1_000, { [k.brown]: 5 }); // ticked in 5 s: skipped
    await cookIt(VIK, r.id, 1_000, { [k.brown]: 3_601 }); // over 4 × 15 min: the app left open
    await cookIt(VIK, r.id, 2_000, { [k.brown]: 7_201 }); // over 4 × 30 min at twice the size
    await cookIt(VIK, r.id, null, { [k.brown]: 300 }); // the dish said no size
    const times = w.h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_dish_step_times WHERE step_key = ?").get(k.brown) as { n: number };
    expect(times.n).toBe(10); // kept raw, all of them
    expect(learnedOf(await read(r.id, ANU))[0]).toEqual(before);

    // At twice the size, 4 × 30 min is still a time.
    await cookIt(VIK, r.id, 2_000, { [k.brown]: 7_200 });
    expect(learnedOf(await read(r.id, ANU))[0]).toEqual(range(660, 840, 4, 6));

    // Dev cancels his dish: his only time goes, and with it a cook.
    await cancel(DEV, devs);
    expect(learnedOf(await read(r.id, ANU))[0]).toEqual(range(660, 840, 3, 5));
  });
});

describe("one pool per recipe root (GC-7, design §5)", () => {
  it("pools a copy, and a copy of a copy, with the recipe they came from — the same keys, the same range — even once it is deleted", async () => {
    const original = await writeRecipe(w, ANU, paneer);
    w.tick();
    const rahuls = (await w.call<RecipeResponse>("POST", me("recipes/copies"), RAHUL, { recipeId: original.id })).body.data.recipe;
    w.tick();
    await w.call<RecipeResponse>("PATCH", me(`recipes/${rahuls.id}`), RAHUL, { visibility: "groups" });
    w.tick();
    const copied = await w.call<RecipeResponse>("POST", me("recipes/copies"), DEV, { recipeId: rahuls.id });
    expect(copied.status).toBe(201);
    const devs = copied.body.data.recipe;
    const k = keysOf(original);
    expect(keysOf(devs)).toEqual(k);

    await cookIt(ANU, original.id, 1_000, { [k.brown]: 600, [k.simmer]: 600 });
    await cookIt(RAHUL, rahuls.id, 1_000, { [k.brown]: 660, [k.simmer]: 660 });
    await cookIt(RAHUL, rahuls.id, 1_000, { [k.brown]: 780, [k.simmer]: 780 });
    await cookIt(DEV, devs.id, 1_000, { [k.brown]: 720, [k.simmer]: 720 });
    await cookIt(DEV, devs.id, 2_000, { [k.brown]: 1_680, [k.simmer]: 1_188 }); // 14 min as written, each by its rule
    const pooled = [range(660, 780, 3, 5), range(660, 780, 3, 5), undefined, undefined];
    expect(learnedOf(await read(original.id, VIK))).toEqual(pooled);
    expect(learnedOf(await read(rahuls.id, VIK))).toEqual(pooled);
    expect(learnedOf(await read(devs.id, DEV))).toEqual(pooled);
    // A copy saved now starts with what the pool knows (the copy's own answer carries it).
    w.tick();
    const vik = await w.call<RecipeResponse>("POST", me("recipes/copies"), VIK, { recipeId: original.id });
    expect(learnedOf(vik.body.data.recipe)).toEqual(pooled);

    // The original deleted: its copies still pool under it.
    w.tick();
    expect((await w.call("DELETE", me(`recipes/${original.id}`), ANU)).status).toBe(200);
    expect(learnedOf(await read(devs.id, DEV))).toEqual(pooled);

    // A step Dev rewrites is a new step — a new key, nothing learned yet — and the steps he keeps keep the pool.
    w.tick();
    const edited = await w.call<RecipeResponse>("PATCH", me(`recipes/${devs.id}`), DEV, {
      steps: ["Brown the onions slowly", "Simmer the gravy", "Pressure-cook the peas", "Fold in the paneer and serve"],
    });
    expect(edited.status).toBe(200);
    const after = keysOf(edited.body.data.recipe);
    expect(after.brown).not.toBe(k.brown);
    expect([after.simmer, after.pressure, after.serve]).toEqual([k.simmer, k.pressure, k.serve]);
    expect(learnedOf(edited.body.data.recipe)).toEqual([undefined, range(660, 780, 3, 5), undefined, undefined]);
  });

  it("pools a recipe of your own only with its copies: another with the same steps learns nothing from it", async () => {
    const mine = await writeRecipe(w, ANU, paneer);
    const theirs = await writeRecipe(w, RAHUL, paneer); // the same words, its own keys and root
    const k = keysOf(mine);
    expect(keysOf(theirs).brown).not.toBe(k.brown);
    for (const [cook, seconds] of [[ANU, 600], [RAHUL, 660], [DEV, 720], [ANU, 780], [RAHUL, 840]] as const) {
      await cookIt(cook, mine.id, 1_000, { [k.brown]: seconds });
    }
    expect(learnedOf(await read(mine.id, RAHUL))[0]).toEqual(range(660, 780, 3, 5));
    expect(learnedOf(await read(theirs.id, ANU))).toEqual([undefined, undefined, undefined, undefined]);
    // A key from another recipe in a step log is not one of this recipe's steps: nothing is kept for it.
    await cookIt(DEV, theirs.id, 1_000, { [k.brown]: 700 });
    const counted = w.h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_dish_step_times WHERE step_key = ?").get(k.brown) as { n: number };
    expect(counted.n).toBe(5);
  });
});

describe("the learned read (GC-7, design §5, §7)", () => {
  async function learnedRecipe(): Promise<KitchenRecipe> {
    const r = await writeRecipe(w, ANU, paneer);
    const k = keysOf(r);
    for (const [cook, seconds] of [[RAHUL, 600], [DEV, 660], [VIK, 720], [RAHUL, 780], [DEV, 840]] as const) {
      await cookIt(cook, r.id, 1_000, { [k.brown]: seconds, [k.simmer]: seconds });
    }
    return r;
  }

  it("says how many times and how many people, and nothing about who", async () => {
    const r = await learnedRecipe();
    const res = await w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${r.id}?f=450`, ANU);
    expect(res.status).toBe(200);
    const [brown, simmer] = res.body.data.recipe.guidedSteps!;
    for (const step of [brown!, simmer!]) {
      expect(Object.keys(step.learned!).sort()).toEqual(["cooks", "highSeconds", "lowSeconds", "samples"]);
      expect([step.learned!.cooks, step.learned!.samples]).toEqual([3, 5]);
    }
    // Rahul, Dev and Vik cooked it; Anu reads it. No id or name of theirs is anywhere in the read.
    const raw = JSON.stringify(res.body);
    for (const who of [RAHUL, DEV, VIK, "Rahul", "Dev", "Vik"]) expect(raw).not.toMatch(new RegExp(`\\b${who}\\b`));
    expect(res.body.data.lastCook).toBeNull();
  });

  it("is on every full answer — the link read at ?f=, the writes at the recipe as written — and on no summary", async () => {
    const r = await learnedRecipe();
    const atOne = [range(660, 780, 3, 5), range(660, 780, 3, 5), undefined, undefined];
    w.tick();
    const linked = await w.call<RecipeResponse>("POST", me(`recipes/${r.id}/link`), ANU);
    expect(learnedOf(linked.body.data.recipe)).toEqual(atOne);
    const code = linked.body.data.recipe.linkCode!;
    const byLink = await w.call<RecipeResponse>("GET", `/v1/kitchen/recipe-links/${code}?f=450`, OLU);
    expect(byLink.status).toBe(200);
    expect(learnedOf(byLink.body.data.recipe)).toEqual([range(300, 360, 3, 5), range(420, 540, 3, 5), undefined, undefined]);
    expect(learnedOf((await w.call<RecipeResponse>("GET", `/v1/kitchen/recipe-links/${code}`, OLU)).body.data.recipe)).toEqual(atOne);
    w.tick();
    const renamed = await w.call<RecipeResponse>("PATCH", me(`recipes/${r.id}`), ANU, { name: "Kadai paneer, dhaba style" });
    expect(learnedOf(renamed.body.data.recipe)).toEqual(atOne);
    const mine = await w.call<MyRecipesResponse>("GET", me("recipes"), ANU);
    expect(JSON.stringify(mine.body.data)).not.toMatch(/learned/);
  });

  it("refuses an ?f= that is not the factor in thousandths, 10 to 20 000 (422 f), on both reads", async () => {
    const r = await learnedRecipe();
    w.tick();
    const code = (await w.call<RecipeResponse>("POST", me(`recipes/${r.id}/link`), ANU)).body.data.recipe.linkCode!;
    for (const f of ["abc", "0", "9", "20001", "1.5", "-450", "1e3", "450g", " 450"]) {
      for (const url of [`/v1/kitchen/recipes/${r.id}?f=${encodeURIComponent(f)}`, `/v1/kitchen/recipe-links/${code}?f=${encodeURIComponent(f)}`]) {
        const res = await w.call("GET", url, RAHUL);
        expect([f, url.includes("recipe-links"), res.status]).toEqual([f, url.includes("recipe-links"), 422]);
        expect(Object.keys((res.body.error.details.fields ?? {}) as object)).toEqual(["f"]);
      }
    }
    for (const f of ["10", "20000", "450"]) expect((await w.call("GET", `/v1/kitchen/recipes/${r.id}?f=${f}`, RAHUL)).status).toBe(200);
    // A recipe the caller may not see is still the opaque 404 with a good f.
    expect((await w.call("GET", `/v1/kitchen/recipes/${r.id}?f=450`, OLU)).status).toBe(404);
  });
});
