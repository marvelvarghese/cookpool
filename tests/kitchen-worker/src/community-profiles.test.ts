// Profiles and handles (Cookpool CM-2, cookpool-community design §1): your
// profile and every handle rule — shape, reserved words (and anything
// starting `cookpool`), uniqueness case-insensitively, once per 30 days with
// nextChangeAt — handle availability, and someone's profile: counts,
// relationship, followedBy, canSee, the 403 `private` lists, and the opaque
// 404 across a block either way.

import type {
  HandleAvailabilityResponse,
  MyProfileResponse,
  PeoplePage,
  PersonProfileResponse,
  ProfileRecipesResponse,
} from "@saas/contracts/kitchen";
import { ANU, DAY, DEV, KABIR, MEERA, SAM, communityWorld, follow, list, makeProfile, me, recipe, type CommunityWorld } from "./community-helpers.js";

let w: CommunityWorld;
beforeEach(() => {
  w = communityWorld();
});
afterEach(() => w.h.close());

const put = (as: string, body: unknown) => {
  w.tick();
  return w.call<MyProfileResponse>("PUT", me("profile"), as, body);
};
const profileOf = (as: string, handle: string) => w.call<PersonProfileResponse>("GET", `/v1/kitchen/profiles/${handle}`, as);

describe("your profile", () => {
  it("reads null until made, is made with 201 (public by default) and edited with 200", async () => {
    expect((await w.call<MyProfileResponse>("GET", me("profile"), MEERA)).body.data).toEqual({ profile: null });

    const made = await put(MEERA, { handle: "@MeeraCooks", name: "Meera K", about: "Rajma on Sundays" });
    expect(made.status).toBe(201);
    expect(made.body.data.profile).toMatchObject({
      userId: MEERA,
      handle: "meeracooks",
      name: "Meera K",
      about: "Rajma on Sundays",
      privacy: "public",
      // The first change is free: nothing to wait for yet.
      handleChangedAt: null,
      nextHandleChangeAt: null,
    });

    const edited = await put(MEERA, { handle: "meeracooks", name: "Meera", privacy: "private" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.profile).toMatchObject({ handle: "meeracooks", name: "Meera", about: null, privacy: "private" });
    // Privacy left out keeps it.
    expect((await put(MEERA, { handle: "meeracooks", name: "Meera" })).body.data.profile?.privacy).toBe("private");
    expect((await w.call<MyProfileResponse>("GET", me("profile"), MEERA)).body.data.profile?.name).toBe("Meera");
  });

  it.each([
    ["ab", "too short"],
    ["a".repeat(21), "too long"],
    ["meera-cooks", "a hyphen"],
    ["meera cooks", "a space"],
    [".meera", "a leading dot"],
    ["meera.", "a trailing dot"],
    ["meera..cooks", "two dots in a row"],
    ["mééra", "a letter outside a–z"],
  ])("refuses %j (%s) as handle_shape", async (handle) => {
    const res = await put(MEERA, { handle, name: "Meera" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "validation_failed", details: { reason: "handle_shape" } });
    expect(w.h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_profiles").get()).toEqual({ n: 0 });
  });

  it.each(["meera_cooks", "meera.cooks", "m33ra", "abc", "a".repeat(20)])("takes %j", async (handle) => {
    expect((await put(MEERA, { handle, name: "Meera" })).status).toBe(201);
  });

  it.each(["cookpool", "admin", "support", "help", "about", "settings", "me", "you", "explore", "search", "api", "www", "cookpool_team", "CookpoolHQ"])(
    "refuses the reserved %j as handle_reserved",
    async (handle) => {
      const res = await put(MEERA, { handle, name: "Meera" });
      expect(res.status).toBe(422);
      expect(res.body.error.details.reason).toBe("handle_reserved");
    },
  );

  it("refuses a missing handle or name, a long name or about, and an unknown privacy as field errors", async () => {
    for (const body of [{ name: "Meera" }, { handle: "meera" }, { handle: "meera", name: "M".repeat(41) }, { handle: "meera", name: "Meera", about: "a".repeat(161) }, { handle: "meera", name: "Meera", privacy: "friends" }]) {
      const res = await put(MEERA, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
    }
  });

  it("keeps handles unique case-insensitively: 409 handle_taken", async () => {
    await makeProfile(w, MEERA, "meeracooks", "Meera K");
    const res = await put(KABIR, { handle: "MeeraCooks", name: "Kabir" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "conflict", details: { reason: "handle_taken" } });
    // An edit to a taken handle is refused the same way, and changes nothing.
    await makeProfile(w, KABIR, "kabir", "Kabir");
    w.tick(31 * DAY);
    expect((await put(KABIR, { handle: "meeracooks", name: "Kabir S" })).body.error.details.reason).toBe("handle_taken");
    expect((await w.call<MyProfileResponse>("GET", me("profile"), KABIR)).body.data.profile).toMatchObject({ handle: "kabir", name: "Kabir" });
  });

  it("lets a new profile fix its handle at once; the change after that is handle_too_soon", async () => {
    await makeProfile(w, MEERA, "meeracoks", "Meera K");
    const fixed = await put(MEERA, { handle: "meeracooks", name: "Meera K" });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.profile).toMatchObject({
      handle: "meeracooks",
      handleChangedAt: w.now().toISOString(),
      nextHandleChangeAt: new Date(w.now().getTime() + 30 * DAY).toISOString(),
    });
    const again = await put(MEERA, { handle: "meera", name: "Meera K" });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ reason: "handle_too_soon", nextChangeAt: fixed.body.data.profile!.nextHandleChangeAt });
  });

  it("changes a handle once per 30 days after that: 409 handle_too_soon with nextChangeAt, other fields edit freely", async () => {
    await makeProfile(w, MEERA, "meeracoks", "Meera K");
    const first = await makeProfile(w, MEERA, "meeracooks", "Meera K");
    w.tick(10 * DAY);
    const soon = await put(MEERA, { handle: "meera", name: "Meera K" });
    expect(soon.status).toBe(409);
    expect(soon.body.error.details).toEqual({ reason: "handle_too_soon", nextChangeAt: first!.nextHandleChangeAt });
    expect((await put(MEERA, { handle: "meeracooks", name: "Meera Kapoor" })).status).toBe(200);

    w.tick(21 * DAY);
    const changed = await put(MEERA, { handle: "meera", name: "Meera Kapoor" });
    expect(changed.status).toBe(200);
    expect(changed.body.data.profile).toMatchObject({ handle: "meera", nextHandleChangeAt: new Date(w.now().getTime() + 30 * DAY).toISOString() });
    // The old handle isn't held.
    expect((await put(KABIR, { handle: "meeracooks", name: "Kabir" })).status).toBe(201);
  });
});

describe("handle availability", () => {
  it("says whether a handle is free, and why not", async () => {
    await makeProfile(w, MEERA, "meeracooks", "Meera K");
    const check = async (as: string, handle: string) => (await w.call<HandleAvailabilityResponse>("GET", `/v1/kitchen/handles/${encodeURIComponent(handle)}`, as)).body.data;
    expect(await check(KABIR, "kabir")).toEqual({ handle: "kabir", available: true });
    expect(await check(KABIR, "MeeraCooks")).toEqual({ handle: "meeracooks", available: false, reason: "handle_taken" });
    expect(await check(MEERA, "meeracooks")).toEqual({ handle: "meeracooks", available: true });
    expect(await check(KABIR, "cookpoolfan")).toEqual({ handle: "cookpoolfan", available: false, reason: "handle_reserved" });
    expect(await check(KABIR, "a..b")).toEqual({ handle: "a..b", available: false, reason: "handle_shape" });
  });
});

describe("someone's profile", () => {
  beforeEach(async () => {
    await makeProfile(w, MEERA, "meeracooks", "Meera K", { about: "Rajma on Sundays" });
    await makeProfile(w, KABIR, "kabir", "Kabir S");
    await makeProfile(w, ANU, "anu", "Anu R");
  });

  it("reads the profile, counts, relationship, followedBy and canSee", async () => {
    // Kabir follows Anu; Anu follows Meera; Meera follows Kabir.
    await follow(w, KABIR, "anu");
    await follow(w, ANU, "meeracooks");
    await follow(w, MEERA, "kabir");
    const curry = await recipe(w, MEERA, "Chicken curry");
    await list(w, MEERA, curry.id);
    await recipe(w, MEERA, "Only mine");

    const res = await profileOf(KABIR, "MeeraCooks");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      profile: { userId: MEERA, handle: "meeracooks", name: "Meera K", about: "Rajma on Sundays", privacy: "public" },
      counts: { posts: 0, recipes: 1, followers: 1, following: 1 },
      relationship: { following: "none", followsYou: true, blocked: false, muted: false, isYou: false },
      followedBy: [{ handle: "anu", name: "Anu R" }],
      canSee: true,
    });
    expect((await profileOf(MEERA, "meeracooks")).body.data.relationship).toMatchObject({ isYou: true, following: "none" });
  });

  it("is the opaque 404 for a handle nobody has, a malformed one, and a block either way", async () => {
    expect((await profileOf(KABIR, "nobody")).status).toBe(404);
    expect((await profileOf(KABIR, "a..b")).status).toBe(404);
    w.tick();
    expect((await w.call("POST", me(`blocks/${KABIR}`), MEERA)).status).toBe(201);
    for (const [as, handle] of [[KABIR, "meeracooks"], [MEERA, "kabir"]] as const) {
      for (const rest of ["", "/recipes", "/followers", "/following"]) {
        const res = await w.call("GET", `/v1/kitchen/profiles/${handle}${rest}`, as);
        expect(res.status).toBe(404);
        expect(res.body.error).toMatchObject({ code: "not_found", message: "Not found", details: {} });
      }
    }
  });

  it("can be read by someone with no profile of their own", async () => {
    const res = await profileOf(SAM, "meeracooks");
    expect(res.status).toBe(200);
    expect(res.body.data.canSee).toBe(true);
  });

  it("shows a private profile's name, counts and follow button but not its lists until a follow is accepted", async () => {
    await makeProfile(w, MEERA, "meeracooks", "Meera K", { privacy: "private" });
    const curry = await recipe(w, MEERA, "Chicken curry");
    await list(w, MEERA, curry.id);

    const locked = await profileOf(KABIR, "meeracooks");
    expect(locked.body.data).toMatchObject({ canSee: false, counts: { recipes: 1 }, relationship: { following: "none" }, profile: { name: "Meera K" } });
    for (const rest of ["recipes", "followers", "following"]) {
      const res = await w.call(`GET`, `/v1/kitchen/profiles/meeracooks/${rest}`, KABIR);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: "forbidden", details: { reason: "private" } });
    }
    expect(await follow(w, KABIR, "meeracooks")).toMatchObject({ status: 201, state: "requested" });
    expect((await profileOf(KABIR, "meeracooks")).body.data).toMatchObject({ canSee: false, relationship: { following: "requested" } });
    w.tick();
    await w.call("POST", me(`follow-requests/${KABIR}/accept`), MEERA);
    expect((await profileOf(KABIR, "meeracooks")).body.data).toMatchObject({ canSee: true, relationship: { following: "accepted" } });
    const recipes = await w.call<ProfileRecipesResponse>("GET", "/v1/kitchen/profiles/meeracooks/recipes", KABIR);
    expect(recipes.status).toBe(200);
    expect(recipes.body.data.recipes.map((r) => r.name)).toEqual(["Chicken curry"]);
    // The owner always sees their own.
    expect((await w.call("GET", "/v1/kitchen/profiles/meeracooks/followers", MEERA)).status).toBe(200);
  });

  it("lists followers and following newest first with cursors, each with the caller's follow", async () => {
    // Everyone follows Meera; Meera follows Kabir and Dev.
    await makeProfile(w, DEV, "dev", "Dev P");
    await makeProfile(w, SAM, "sam", "Sam T");
    for (const [as] of [[KABIR], [ANU], [DEV], [SAM]]) await follow(w, as!, "meeracooks");
    await follow(w, MEERA, "kabir");
    await follow(w, KABIR, "dev");

    const first = await w.call<PeoplePage>("GET", "/v1/kitchen/profiles/meeracooks/followers", KABIR);
    expect(first.body.data.people.map((p) => [p.handle, p.following])).toEqual([["sam", "none"], ["dev", "accepted"], ["anu", "none"], ["kabir", "none"]]);
    expect(first.body.data.nextCursor).toBeNull();

    // Thirty-one followers page at thirty.
    for (let i = 0; i < 31; i += 1) {
      const id = `usr_f${i}`;
      w.h.db.prepare("INSERT INTO kitchen_profiles VALUES (?, ?, ?, NULL, 'public', ?, ?, ?)").run(id, `fan${i}`, `Fan ${i}`, w.now().toISOString(), w.now().toISOString(), w.now().toISOString());
      w.tick();
      w.h.db.prepare("INSERT INTO kitchen_follows VALUES (?, ?, 'accepted', ?, ?)").run(id, KABIR, w.now().toISOString(), w.now().toISOString());
    }
    const page1 = await w.call<PeoplePage>("GET", "/v1/kitchen/profiles/kabir/followers", ANU);
    expect(page1.body.data.people).toHaveLength(30);
    expect(page1.body.data.people[0]!.handle).toBe("fan30");
    expect(page1.body.meta.cursor).toBe(page1.body.data.nextCursor);
    const page2 = await w.call<PeoplePage>("GET", `/v1/kitchen/profiles/kabir/followers?cursor=${page1.body.data.nextCursor}`, ANU);
    expect(page2.body.data.people.map((p) => p.handle)).toEqual(["fan0", "meeracooks"]);
    expect(page2.body.data.nextCursor).toBeNull();
    expect((await w.call("GET", "/v1/kitchen/profiles/kabir/followers?cursor=nope", ANU)).status).toBe(422);

    const following = await w.call<PeoplePage>("GET", "/v1/kitchen/profiles/meeracooks/following", ANU);
    expect(following.body.data.people.map((p) => p.handle)).toEqual(["kabir"]);
  });

  it("leaves people with a block with the viewer out of the lists", async () => {
    await follow(w, KABIR, "meeracooks");
    await follow(w, ANU, "meeracooks");
    w.tick();
    await w.call("POST", me(`blocks/${KABIR}`), ANU);
    const seen = await w.call<PeoplePage>("GET", "/v1/kitchen/profiles/meeracooks/followers", ANU);
    expect(seen.body.data.people.map((p) => p.handle)).toEqual(["anu"]);
    const byKabir = await w.call<PeoplePage>("GET", "/v1/kitchen/profiles/meeracooks/followers", KABIR);
    expect(byKabir.body.data.people.map((p) => p.handle)).toEqual(["kabir"]);
  });
});
