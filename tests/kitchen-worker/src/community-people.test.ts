// Finding people and public recipes (Cookpool CM-2, cookpool-community
// design §1): people search (public by handle prefix or name, private by
// exact handle only, ≤ 20, nobody with a block, nobody without a profile);
// suggestions from groups, saved recipes and popularity, each with a why;
// `listed` on the recipe PATCH (it mints a link, turning the link off
// unlists, Cookpool's own can't be listed) and Explore's source=public; and
// that NO read in this task carries an email or an identity display name.

import type {
  ExploreRecipesResponse,
  PeopleSearchResponse,
  PeopleSuggestionsResponse,
  RecipeResponse,
} from "@saas/contracts/kitchen";
import {
  ANU,
  DAY,
  DEV,
  IDENTITY,
  KABIR,
  MEERA,
  SAM,
  communityWorld,
  follow,
  list,
  makeProfile,
  me,
  recipe,
  type CommunityWorld,
} from "./community-helpers.js";

let w: CommunityWorld;
beforeEach(() => {
  w = communityWorld();
});
afterEach(() => w.h.close());

const search = async (as: string, q: string) => {
  const res = await w.call<PeopleSearchResponse>("GET", `/v1/kitchen/people/search?q=${encodeURIComponent(q)}`, as);
  return res.status === 200 ? res.body.data.people.map((p) => p.handle) : res.status;
};
const explorePublic = async (as: string, q = "") =>
  (await w.call<ExploreRecipesResponse>("GET", `/v1/kitchen/recipes?source=public${q ? `&q=${q}` : ""}`, as)).body.data.recipes;

describe("people search", () => {
  beforeEach(async () => {
    await makeProfile(w, MEERA, "meeracooks", "Meera K");
    await makeProfile(w, KABIR, "kabir", "Kabir S");
    await makeProfile(w, ANU, "anu_private", "Anu Meera R", { privacy: "private" });
    await makeProfile(w, DEV, "meera_fan", "Dev P");
  });

  it("matches public profiles by handle prefix or name, exact handle first", async () => {
    expect(await search(KABIR, "meera")).toEqual(["meera_fan", "meeracooks"]);
    expect(await search(KABIR, "MeeraCooks")).toEqual(["meeracooks"]);
    expect(await search(KABIR, "dev p")).toEqual(["meera_fan"]);
    expect(await search(KABIR, "s")).toEqual([]); // "Kabir S" is the caller: never in their own results
    expect(await search(MEERA, "S")).toEqual(["kabir"]);
  });

  it("finds a private profile by its exact handle only, and an @ matches handles only", async () => {
    expect(await search(KABIR, "anu")).toEqual([]);
    expect(await search(KABIR, "Anu Meera")).toEqual([]);
    expect(await search(KABIR, "@anu_private")).toEqual(["anu_private"]);
    expect(await search(KABIR, "@kabir")).toEqual([]);
    expect(await search(MEERA, "@dev")).toEqual([]);
  });

  it("never finds someone without a profile, and anyone may search", async () => {
    expect(await search(SAM, "meera")).toEqual(["meera_fan", "meeracooks"]);
    expect(await search(KABIR, "sam")).toEqual([]);
  });

  it("leaves out anyone with a block either way", async () => {
    w.tick();
    await w.call("POST", me(`blocks/${KABIR}`), MEERA);
    expect(await search(KABIR, "meera")).toEqual(["meera_fan"]);
    expect(await search(MEERA, "kabir")).toEqual([]);
  });

  it("answers at most 20, and refuses an empty or long q", async () => {
    const at = w.now().toISOString();
    for (let i = 0; i < 25; i += 1) {
      w.h.db.prepare("INSERT INTO kitchen_profiles VALUES (?, ?, ?, NULL, 'public', ?, ?, ?)").run(`usr_c${i}`, `cook${String(i).padStart(2, "0")}`, `Cook ${i}`, at, at, at);
    }
    expect(await search(KABIR, "cook")).toHaveLength(20);
    expect(await search(KABIR, "")).toBe(422);
    expect(await search(KABIR, "@")).toBe(422);
    expect(await search(KABIR, "x".repeat(41))).toBe(422);
  });

  it("carries the caller's follow of each person", async () => {
    await follow(w, KABIR, "meeracooks");
    const res = await w.call<PeopleSearchResponse>("GET", "/v1/kitchen/people/search?q=meera", KABIR);
    expect(res.body.data.people.map((p) => [p.handle, p.following])).toEqual([["meera_fan", "none"], ["meeracooks", "accepted"]]);
  });
});

describe("suggestions", () => {
  it("come from groups, saved recipes and popularity, with a why, nobody twice, nobody followed or blocked", async () => {
    // Meera shares Flat 4B with Anu and the Lunch club with Dev.
    await makeProfile(w, MEERA, "meeracooks", "Meera K");
    await makeProfile(w, ANU, "anu", "Anu R", { privacy: "private" });
    await makeProfile(w, DEV, "dev", "Dev P");
    await makeProfile(w, KABIR, "kabir", "Kabir S");
    await makeProfile(w, SAM, "sam", "Sam T");
    // Meera saved a copy of Kabir's public Rajma.
    const rajma = await recipe(w, KABIR, "Rajma");
    await list(w, KABIR, rajma.id);
    w.tick();
    expect((await w.call("POST", me("recipes/copies"), MEERA, { recipeId: rajma.id })).status).toBe(201);
    // Sam is popular: two new followers.
    await follow(w, KABIR, "sam");
    await follow(w, DEV, "sam");

    const res = await w.call<PeopleSuggestionsResponse>("GET", me("people/suggestions"), MEERA);
    expect(res.status).toBe(200);
    const pick = (list: PeopleSuggestionsResponse["fromGroups"]) => list.map((p) => [p.handle, p.why, p.following]);
    expect(pick(res.body.data.fromGroups)).toEqual([["anu", "In Flat 4B", "none"], ["dev", "In Lunch club", "none"]]);
    expect(pick(res.body.data.fromRecipes)).toEqual([["kabir", "You saved their Rajma", "none"]]);
    expect(pick(res.body.data.popular)).toEqual([["sam", "2 new followers", "none"]]);

    // Following Dev, blocking Kabir by Kabir's choice, and Sam's follows ageing out of the 14 days.
    await follow(w, MEERA, "dev");
    w.tick();
    await w.call("POST", me(`blocks/${MEERA}`), KABIR);
    w.tick(15 * DAY);
    const later = (await w.call<PeopleSuggestionsResponse>("GET", me("people/suggestions"), MEERA)).body.data;
    expect(pick(later.fromGroups)).toEqual([["anu", "In Flat 4B", "none"]]);
    expect(later.fromRecipes).toEqual([]);
    expect(later.popular).toEqual([]);
  });

  it("leaves out co-members without a profile", async () => {
    await makeProfile(w, MEERA, "meeracooks", "Meera K");
    expect((await w.call<PeopleSuggestionsResponse>("GET", me("people/suggestions"), MEERA)).body.data).toEqual({
      fromGroups: [],
      fromRecipes: [],
      popular: [],
    });
  });
});

describe("public recipes", () => {
  beforeEach(async () => {
    await makeProfile(w, MEERA, "meeracooks", "Meera K");
    await makeProfile(w, KABIR, "kabir", "Kabir S");
  });

  it("listing mints a link, turning the link off unlists, and unlisting keeps the link", async () => {
    const curry = await recipe(w, MEERA, "Chicken curry");
    expect(curry).toMatchObject({ visibility: "groups", listed: false, linkCode: null });
    const listed = await list(w, MEERA, curry.id);
    expect(listed.status).toBe(200);
    expect(listed.body.data.recipe).toMatchObject({ visibility: "link", listed: true });
    const code = listed.body.data.recipe.linkCode;
    expect(code).toMatch(/^[1-9A-HJ-NP-Za-km-z]{10}$/);

    const unlisted = await list(w, MEERA, curry.id, false);
    expect(unlisted.body.data.recipe).toMatchObject({ visibility: "link", listed: false, linkCode: code });
    await list(w, MEERA, curry.id);
    w.tick();
    const off = await w.call<RecipeResponse>("DELETE", me(`recipes/${curry.id}/link`), MEERA);
    expect(off.body.data.recipe).toMatchObject({ visibility: "groups", listed: false, linkCode: null });
    await list(w, MEERA, curry.id);
    w.tick();
    const toGroups = await w.call<RecipeResponse>("PATCH", me(`recipes/${curry.id}`), MEERA, { visibility: "groups" });
    expect(toGroups.body.data.recipe).toMatchObject({ visibility: "groups", listed: false });

    // listed beside another visibility, or not a boolean, is a field error.
    w.tick();
    expect((await w.call("PATCH", me(`recipes/${curry.id}`), MEERA, { visibility: "only_me", listed: true })).status).toBe(422);
    expect((await w.call("PATCH", me(`recipes/${curry.id}`), MEERA, { listed: "yes" })).status).toBe(422);
  });

  it("refuses to list Cookpool's own recipe or someone else's (the opaque 404)", async () => {
    const id = (w.h.db.prepare("SELECT id FROM kitchen_recipes WHERE is_system = 1 LIMIT 1").get() as { id: string }).id;
    expect((await list(w, MEERA, `rcp_${id.replace(/-/g, "")}`)).status).toBe(404);
    const curry = await recipe(w, KABIR, "Kabir's curry");
    expect((await list(w, MEERA, curry.id)).status).toBe(404);
    expect(w.h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_recipes WHERE listed = 1").get()).toEqual({ n: 0 });
  });

  it("are on the owner's profile and in Explore's Public, named by the profile, without blocked owners", async () => {
    const curry = await recipe(w, MEERA, "Chicken curry");
    await list(w, MEERA, curry.id);
    await recipe(w, MEERA, "Not listed", { visibility: "link" });
    await makeProfile(w, ANU, "anu", "Anu R", { privacy: "private" });
    const anuDal = await recipe(w, ANU, "Anu's dal");
    await list(w, ANU, anuDal.id);
    // Sam lists one with no profile: nobody's public face, so not in Public.
    const samRecipe = await recipe(w, SAM, "Sam's soup");
    expect((await list(w, SAM, samRecipe.id)).status).toBe(200);

    const seen = await explorePublic(KABIR);
    expect(seen.map((r) => [r.name, r.ownerName, r.listed])).toEqual([["Chicken curry", "Meera K", true]]);
    expect(await explorePublic(MEERA)).toEqual([]); // not your own
    expect((await explorePublic(KABIR, "zzz")).length).toBe(0);

    const onProfile = await w.call<{ recipes: Array<{ name: string; ownerName: string | null }> }>("GET", "/v1/kitchen/profiles/meeracooks/recipes", KABIR);
    expect(onProfile.body.data.recipes.map((r) => [r.name, r.ownerName])).toEqual([["Chicken curry", "Meera K"]]);

    // A stranger may open and copy a public recipe by its id; the copy names the owner by their profile.
    const read = await w.call<RecipeResponse>("GET", `/v1/kitchen/recipes/${curry.id}`, KABIR);
    expect(read.status).toBe(200);
    expect(read.body.data.recipe).toMatchObject({ ownerName: "Meera K", linkCode: null, mine: false });
    w.tick();
    const copy = await w.call<RecipeResponse>("POST", me("recipes/copies"), KABIR, { recipeId: curry.id });
    expect(copy.body.data.recipe.source).toMatchObject({ ownerId: MEERA, ownerName: "Meera K" });
    // Anu's is private: only her accepted followers open it.
    expect((await w.call("GET", `/v1/kitchen/recipes/${anuDal.id}`, KABIR)).status).toBe(404);

    w.tick();
    await w.call("POST", me(`blocks/${KABIR}`), MEERA);
    expect(await explorePublic(KABIR)).toEqual([]);
    expect((await w.call("GET", `/v1/kitchen/recipes/${curry.id}`, KABIR)).status).toBe(404);

    // Going private takes it out of Public.
    w.tick();
    await w.call("DELETE", me(`blocks/${KABIR}`), MEERA);
    await makeProfile(w, MEERA, "meeracooks", "Meera K", { privacy: "private" });
    expect(await explorePublic(KABIR)).toEqual([]);
  });

  it("count on the profile: listed, live, link recipes only", async () => {
    const a = await recipe(w, MEERA, "A");
    const b = await recipe(w, MEERA, "B");
    await list(w, MEERA, a.id);
    await list(w, MEERA, b.id);
    w.tick();
    await w.call("DELETE", me(`recipes/${b.id}`), MEERA);
    const res = await w.call<{ counts: { recipes: number } }>("GET", "/v1/kitchen/profiles/meeracooks", KABIR);
    expect(res.body.data.counts.recipes).toBe(1);
  });
});

describe("no read in CM-2 carries an email or an identity display name", () => {
  it("not on any profile, list, search, suggestion, block list or public recipe read", async () => {
    await makeProfile(w, MEERA, "meeracooks", "Meera K", { about: "Rajma on Sundays" });
    await makeProfile(w, KABIR, "kabir", "Kabir S");
    await makeProfile(w, ANU, "anu", "Anu R", { privacy: "private" });
    await makeProfile(w, DEV, "dev", "Dev P");
    await follow(w, KABIR, "meeracooks");
    await follow(w, DEV, "meeracooks");
    await follow(w, MEERA, "anu");
    await follow(w, KABIR, "dev");
    const curry = await recipe(w, MEERA, "Chicken curry");
    await list(w, MEERA, curry.id);
    // Dev copies Meera's (a copy saves its source's name) and lists his copy.
    w.tick();
    const copy = await w.call<RecipeResponse>("POST", me("recipes/copies"), DEV, { recipeId: curry.id });
    await list(w, DEV, copy.body.data.recipe.id);
    w.tick();
    await w.call("POST", me(`blocks/${SAM}`), MEERA);

    const reads: Array<[string, string]> = [
      [KABIR, me("profile")],
      [KABIR, "/v1/kitchen/handles/meeracooks"],
      [KABIR, "/v1/kitchen/profiles/meeracooks"],
      [KABIR, "/v1/kitchen/profiles/dev"],
      [KABIR, "/v1/kitchen/profiles/meeracooks/recipes"],
      [KABIR, "/v1/kitchen/profiles/dev/recipes"],
      [KABIR, "/v1/kitchen/profiles/meeracooks/followers"],
      [KABIR, "/v1/kitchen/profiles/meeracooks/following"],
      [ANU, me("follow-requests")],
      [MEERA, me("blocks")],
      [KABIR, "/v1/kitchen/people/search?q=e"],
      [SAM, "/v1/kitchen/people/search?q=meera"],
      [ANU, me("people/suggestions")],
      [MEERA, me("people/suggestions")],
      [KABIR, "/v1/kitchen/recipes?source=public"],
      [SAM, "/v1/kitchen/recipes?source=public"],
      [KABIR, `/v1/kitchen/recipes/${curry.id}`],
      [SAM, `/v1/kitchen/recipes/${copy.body.data.recipe.id}`],
    ];
    const identityBefore = w.h.identityCalls;
    const secrets = Object.values(IDENTITY).flatMap((who) => [who.displayName, who.email, who.email.split("@")[0]!]);
    for (const [as, path] of reads) {
      const res = await w.h.call("GET", path, { as });
      const text = await res.text();
      expect([path, res.status]).toEqual([path, 200]);
      for (const secret of secrets) expect([path, text.includes(secret)]).toEqual([path, false]);
      expect([path, /@example\.com/.test(text)]).toEqual([path, false]);
    }
    // None of these reads asked identity for anything.
    expect(w.h.identityCalls).toBe(identityBefore);
  });
});
