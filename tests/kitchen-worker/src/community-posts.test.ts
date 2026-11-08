// Posting a cook (Cookpool CM-3, cookpool-community design §2): only the
// dish's cook posts it — since CM-8 any dish of theirs but a canceled one,
// before or after a split, open or finalized — and one live post per dish; without a profile only Just me; the stats are
// computed in the server from the dish and its step log and carry ONLY the
// chosen ones — and no post read ever carries a price, a group or who ate.
// A recipe is linked only when it is public (or the cook's own copy of a
// public one). PATCH changes the caption, audience and stats; DELETE is soft
// with a ten-minute restore.

import type { CommunityPost, PostResponse } from "@saas/contracts/kitchen";
import {
  ANU,
  DEV,
  IDENTITY,
  KABIR,
  MEERA,
  SAM,
  communityWorld,
  cook,
  copy,
  del,
  follow,
  guidedCurry,
  makeProfile,
  me,
  post,
  posted,
  publish,
  readPost,
  share,
  writeRecipe,
  type CommunityWorld,
  type CookOptions,
} from "./posts-helpers.js";

let w: CommunityWorld;
beforeEach(async () => {
  w = communityWorld();
  await makeProfile(w, MEERA, "meeracooks", "Meera K");
  await makeProfile(w, ANU, "anu", "Anu R");
  await makeProfile(w, KABIR, "kabir", "Kabir S");
});
afterEach(() => w.h.close());

const ALL = { size: true, time: true, ate: true, steps: true };
const rows = () => w.h.db.prepare("SELECT author_id, audience, stats, recipe_id, deleted_at FROM kitchen_posts ORDER BY created_at").all() as Array<Record<string, unknown>>;

/** Meera's guided curry, cooked at 2× with both cook steps logged; the recipe and the dish. */
async function guidedDish(as = MEERA, extra: Pick<CookOptions, "group"> = {}) {
  const r = await writeRecipe(w, as, guidedCurry);
  const [, brown, simmer] = r.guidedSteps!.map((s) => s.key);
  const dishId = await cook(w, as, { recipeId: r.id, factorMilli: 2000, log: { [brown!]: 720, [simmer!]: 1080 }, ...extra });
  return { r, dishId };
}

describe("who posts a dish, and when", () => {
  it("posts a Just me dish of your own (201), once: a second post of it is 409 already_posted with the first's id", async () => {
    const dishId = await cook(w, MEERA);
    const first = await share(w, MEERA, { dishId, audience: "followers", caption: "  Sunday lunch  " });
    expect(first.status).toBe(201);
    expect(first.body.data.post).toMatchObject({
      id: expect.stringMatching(/^pst_[0-9a-f]{32}$/),
      author: { userId: MEERA, handle: "meeracooks", name: "Meera K" },
      title: "Chicken curry",
      caption: "Sunday lunch",
      audience: "followers",
      show: { size: false, time: false, ate: false, steps: false },
      stats: {},
      recipe: null,
      yums: { count: 0, mine: false, names: [] },
      comments: { count: 0 },
      mine: true,
      editedAt: null,
    });
    const again = await share(w, MEERA, { dishId, audience: "public" });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ reason: "already_posted", postId: first.body.data.post.id });
    expect(rows()).toHaveLength(1);
  });

  it("is only for the dish's cook: anyone else's dish, and a dish nobody has, are the opaque 404", async () => {
    const dishId = await cook(w, MEERA);
    expect((await share(w, ANU, { dishId, audience: "me" })).status).toBe(404);
    expect((await share(w, MEERA, { dishId: "dsh_00000000000000000000000000000000", audience: "me" })).status).toBe(404);
    expect(rows()).toEqual([]);
  });

  it("posts a group dish before it is finalized as well as after (CM-8), and never takes a canceled dish (409 not_postable)", async () => {
    const shares = [{ subjectId: MEERA, portionsHalf: 4 }, { subjectId: ANU, portionsHalf: 4 }];
    // CM-8 on purpose: posting and splitting are separate actions, so a group dish still open for Who ate posts too.
    const draft = await cook(w, MEERA, { group: { publicId: w.flat.publicId, shares, finalize: false } });
    expect((await share(w, MEERA, { dishId: draft, audience: "followers" })).status).toBe(201);
    const done = await cook(w, MEERA, { group: { publicId: w.flat.publicId, shares } });
    expect((await share(w, MEERA, { dishId: done, audience: "followers" })).status).toBe(201);

    const canceled = await cook(w, MEERA);
    expect((await post(w, MEERA, me(`dishes/${canceled}/cancel`))).status).toBe(200);
    expect((await share(w, MEERA, { dishId: canceled, audience: "me" })).body.error.details).toEqual({ reason: "not_postable" });
  });

  it("without a profile, posts only as Just me (403 no_profile otherwise)", async () => {
    const dishId = await cook(w, SAM);
    for (const audience of ["followers", "public"]) {
      const res = await share(w, SAM, { dishId, audience });
      expect(res.status).toBe(403);
      expect(res.body.error.details).toEqual({ reason: "no_profile" });
    }
    const mine = await share(w, SAM, { dishId, audience: "me" });
    expect(mine.status).toBe(201);
    expect(mine.body.data.post.author).toBeNull();
    // And it can't be widened later without one.
    expect((await w.call("PATCH", me(`posts/${mine.body.data.post.id}`), SAM, { audience: "public" })).status).toBe(403);
  });

  it("refuses a body it can't read: 422 with the fields", async () => {
    const dishId = await cook(w, MEERA);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ audience: "followers" }, "dishId"],
      [{ dishId: "rcp_1", audience: "followers" }, "dishId"],
      [{ dishId }, "audience"],
      [{ dishId, audience: "everyone" }, "audience"],
      [{ dishId, audience: "me", caption: "x".repeat(501) }, "caption"],
      [{ dishId, audience: "me", caption: 3 }, "caption"],
      [{ dishId, audience: "me", show: { price: true } }, "show.price"],
      [{ dishId, audience: "me", show: { size: "yes" } }, "show.size"],
      [{ dishId, audience: "me", show: [] }, "show"],
    ];
    for (const [body, field] of cases) {
      const res = await share(w, MEERA, body);
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.error.details.fields as object)).toContain(field);
    }
    expect(rows()).toEqual([]);
  });
});

describe("the stats: computed in the server, only the chosen ones", () => {
  it("computes size against the recipe, time from the step log, how many ate, and steps done of the cook steps", async () => {
    const { dishId } = await guidedDish(MEERA, {
      group: { publicId: w.flat.publicId, shares: [{ subjectId: MEERA, portionsHalf: 4 }, { subjectId: ANU, portionsHalf: 4 }] },
    });
    const p = await posted(w, MEERA, dishId, "followers", { show: ALL });
    expect(p.show).toEqual({ size: true, time: true, ate: true, steps: true });
    expect(p.stats).toEqual({
      // 2 × 1 kg of chicken (thousandths of a gram, as recipe lines count); the dish's 4 portions.
      size: { factorMilli: 2000, main: { name: "Chicken", qtyMilli: 2_000_000, unit: "kg" }, portionsHalf: 8 },
      // 12 + 18 minutes.
      minutes: 30,
      // How many it served (CM-8): the dish's 4 portions, not its 2 shares.
      ate: 4,
      // Prep is never logged: 2 of the 2 cook steps.
      steps: { done: 2, total: 2 },
    });
  });

  it("stores only what was chosen, and leaves out a chosen stat it can't compute", async () => {
    const { dishId } = await guidedDish();
    const p = await posted(w, MEERA, dishId, "followers", { show: { time: true, ate: true } });
    // A Just me dish of 4 portions served 4 (CM-8: servings, not shares).
    expect(p.stats).toEqual({ minutes: 30, ate: 4 });
    expect(JSON.parse(rows()[0]!.stats as string)).toEqual({ minutes: 30, ate: 4 });

    // No recipe and no step log: time and steps can't be computed, so they aren't there.
    const plain = await posted(w, MEERA, await cook(w, MEERA, { name: "Toast" }), "me", { show: ALL });
    expect(plain.stats).toEqual({ size: { factorMilli: null, main: null, portionsHalf: 8 }, ate: 4 });
    expect(plain.show).toEqual({ size: true, time: false, ate: true, steps: false });
  });

  it("never carries money, a group or who ate — in the post, the feed, a profile's posts or the stored row", async () => {
    const { dishId } = await guidedDish(MEERA, {
      group: { publicId: w.flat.publicId, shares: [{ subjectId: MEERA, portionsHalf: 4 }, { subjectId: ANU, portionsHalf: 4 }] },
    });
    const p = await posted(w, MEERA, dishId, "public", { show: ALL, caption: "Made it for the flat" });
    await follow(w, KABIR, "meeracooks");
    const reads = [
      JSON.stringify((await readPost(w, KABIR, p.id)).post),
      JSON.stringify((await w.call("GET", me("feed?tab=following"), KABIR)).body),
      JSON.stringify((await w.call("GET", "/v1/kitchen/profiles/meeracooks/posts", KABIR)).body),
      JSON.stringify((await w.call("GET", me("feed?tab=discover"), DEV)).body),
      String(rows()[0]!.stats),
    ];
    const group = w.flat.publicId;
    const groupHex = group.replace(/^org_/, "");
    for (const [i, text] of reads.entries()) {
      if (i < 4) expect(text).toContain("Chicken curry");
      for (const leak of [
        "Minor", "minor", "price", "cost", "currency", "INR", "₹", "2500", "6000",
        group, groupHex, "orgId", "org_", "shares", "subjectId", ANU, "dsh_",
        IDENTITY[MEERA]!.email, IDENTITY[MEERA]!.displayName, IDENTITY[ANU]!.displayName,
      ]) {
        expect(text).not.toContain(leak);
      }
    }
  });

  it("the table itself refuses any stat but the four", () => {
    expect(() =>
      w.h.db
        .prepare("INSERT INTO kitchen_posts (id, author_id, title, audience, stats, created_at) VALUES ('x', 'usr_a', 't', 'me', ?, '2026-01-01T00:00:00.000Z')")
        .run(JSON.stringify({ minutes: 3, totalMinor: 400 })),
    ).toThrow(/CHECK/);
  });
});

describe("which recipe a post links", () => {
  it("links a public recipe; a private one shows the name with no link", async () => {
    const r = await writeRecipe(w, MEERA, guidedCurry);
    const hidden = await posted(w, MEERA, await cook(w, MEERA, { recipeId: r.id }), "me");
    expect(hidden.recipe).toBeNull();
    expect(rows()[0]!.recipe_id).toBeNull();
    await publish(w, MEERA, r.id);
    const linked = await posted(w, MEERA, await cook(w, MEERA, { recipeId: r.id }), "me");
    expect(linked.recipe).toEqual({ id: r.id, name: "Chicken curry", linkCode: expect.stringMatching(/^.{10}$/) });
  });

  it("links the public recipe the cook's own copy came from, and stops linking once it is no longer public", async () => {
    const r = await writeRecipe(w, MEERA, guidedCurry);
    await publish(w, MEERA, r.id);
    const mine = await copy(w, ANU, r.id);
    const p = await posted(w, ANU, await cook(w, ANU, { recipeId: mine.id }), "followers");
    expect(p.recipe).toMatchObject({ id: r.id, name: "Chicken curry" });
    w.tick();
    expect((await w.call("PATCH", me(`recipes/${r.id}`), MEERA, { listed: false })).status).toBe(200);
    expect((await readPost(w, ANU, p.id)).post!.recipe).toBeNull();
  });
});

describe("stepCompare: the reader's own usual time", () => {
  it("is the median of the reader's earlier cooks of the recipe at the same size — on the post read only", async () => {
    const r = await writeRecipe(w, MEERA, guidedCurry);
    await publish(w, MEERA, r.id);
    const [, brown, simmer] = r.guidedSteps!.map((s) => s.key);
    const p = await posted(w, MEERA, await cook(w, MEERA, { recipeId: r.id, factorMilli: 2000, log: { [brown!]: 720, [simmer!]: 1080 } }), "public");
    // No cooks of his own yet: no compare.
    expect((await readPost(w, KABIR, p.id)).post).not.toHaveProperty("stepCompare");
    await cook(w, KABIR, { recipeId: r.id, factorMilli: 2000, log: { [brown!]: 900, [simmer!]: 900 } });
    await cook(w, KABIR, { recipeId: r.id, factorMilli: 2000, log: { [brown!]: 1200, [simmer!]: 1200 } });
    // A cook at another size doesn't count.
    await cook(w, KABIR, { recipeId: r.id, factorMilli: 1000, log: { [brown!]: 60, [simmer!]: 60 } });
    expect((await readPost(w, KABIR, p.id)).post!.stepCompare).toEqual({ usualMinutes: 35, cooks: 2 });
    const feed = await w.call<{ posts: CommunityPost[] }>("GET", me("feed?tab=discover"), KABIR);
    expect(feed.body.data.posts[0]).not.toHaveProperty("stepCompare");
  });
});

describe("changing and deleting a post", () => {
  it("PATCH changes the caption, the audience and the stats shown — only the author's own", async () => {
    const { dishId } = await guidedDish();
    const p = await posted(w, MEERA, dishId, "followers", { caption: "First go", show: { time: true } });
    w.tick();
    const res = await w.call<PostResponse>("PATCH", me(`posts/${p.id}`), MEERA, { caption: "", audience: "public", show: { time: false, steps: true } });
    expect(res.status).toBe(200);
    expect(res.body.data.post).toMatchObject({ caption: null, audience: "public", stats: { steps: { done: 2, total: 2 } }, editedAt: w.now().toISOString() });
    expect(res.body.data.post.stats).not.toHaveProperty("minutes");
    expect((await w.call("PATCH", me(`posts/${p.id}`), ANU, { caption: "mine now" })).status).toBe(404);
    expect((await w.call("PATCH", me(`posts/${p.id}`), MEERA, { audience: "all" })).status).toBe(422);
  });

  it("DELETE is soft: gone for everyone, restorable for ten minutes, and the dish can be posted again", async () => {
    await follow(w, KABIR, "meeracooks");
    const dishId = await cook(w, MEERA);
    const p = await posted(w, MEERA, dishId, "followers");
    const gone = await del(w, MEERA, me(`posts/${p.id}`));
    expect(gone.body.data).toEqual({ deleted: true, restoreUntil: new Date(w.now().getTime() + 10 * 60_000).toISOString() });
    expect((await readPost(w, KABIR, p.id)).status).toBe(404);
    expect((await readPost(w, MEERA, p.id)).status).toBe(404);
    expect((await del(w, MEERA, me(`posts/${p.id}`))).status).toBe(404);

    w.tick(5 * 60_000);
    const back = await post(w, MEERA, me(`posts/${p.id}/restore`));
    expect(back.status).toBe(200);
    expect((back.body.data.post as CommunityPost).id).toBe(p.id);
    expect((await readPost(w, KABIR, p.id)).status).toBe(200);

    // Deleted again and left past the ten minutes: it stays gone, and the dish is free.
    await del(w, MEERA, me(`posts/${p.id}`));
    w.tick(11 * 60_000);
    expect((await post(w, MEERA, me(`posts/${p.id}/restore`))).body.error.details).toEqual({ reason: "not_restorable" });
    const again = await posted(w, MEERA, dishId, "public");
    expect(again.id).not.toBe(p.id);
  });

  it("can't restore over a new post of the same dish, nor anyone else's post", async () => {
    const dishId = await cook(w, MEERA);
    const p = await posted(w, MEERA, dishId, "followers");
    await del(w, MEERA, me(`posts/${p.id}`));
    expect((await post(w, ANU, me(`posts/${p.id}/restore`))).status).toBe(404);
    await posted(w, MEERA, dishId, "followers");
    expect((await post(w, MEERA, me(`posts/${p.id}/restore`))).body.error.details).toEqual({ reason: "already_posted" });
  });
});
