import type { InboxResponse, KitchenDish, KitchenDishIngredient, MyGroupBalance, SplitReminderInboxItem } from "@saas/contracts/kitchen";
import { applyPatches, type CacheLike } from "@web-console-next/lib/optimistic";
import { qk } from "@web-console-next/lib/query-keys";
import { JUST_ME, shareOptions } from "@web-console-next/components/kitchen/dish-maker";
import { addItemLine, blankSession, finishPlan, postSub, setName, tickLine, type CookSession } from "@web-console-next/components/kitchen/cook-session";
import { afterFinishHref, offersShare } from "@web-console-next/components/kitchen/community-share";
import { nextText } from "@web-console-next/components/kitchen/cook-guided";
import { homeTodos } from "@web-console-next/components/kitchen/inbox";
import {
  NO_SEED,
  cookedActions,
  cookedDoneLabel,
  cookedHref,
  cookedSeedOf,
  cookedView,
  dishNextActions,
  finishLabel,
  finishSub,
  groupItemsNote,
  parseCookedSeed,
  reminderDismissPatches,
  reminderRestorePatches,
  reminderSplitHref,
  reminderSub,
  reminderTitle,
  servingsOf,
  servingsText,
  showsCooked,
  splitButton,
  splitEaters,
  splitHref,
  splitLeftText,
  splitParam,
  splitPlan,
  splitRefusalText,
  splitReminders,
  splitToast,
  startingServingsHalf,
  stepServings,
  suggestSplitGroup,
  withReminder,
  withoutReminder,
  withoutJustMeFinalize,
} from "@web-console-next/components/kitchen/cooked";
import type { CookGuide } from "@web-console-next/components/kitchen/cook-guide-draft";
import { FLAT, LUNCH, ME, MEERA, NAMES, PERSONAL_REF, TRIP, makeItem } from "./kitchen-pantry-fixtures";

// cookpool-community CM-9 (design §2a, the canvas's CookDone): cooking ends at
// Cooked! with the dish as the cook's own; Post to Community and Split with a
// group are separate actions there and on the dish page; Home reminds once.

const NOW = new Date("2026-11-09T12:00:00.000Z");
const DSH = "dsh_00000000000000000000000000000c09";
const ANU = "usr_0000000000000000000000000000b0b0";

function ing(o: Partial<KitchenDishIngredient> & { name: string }): KitchenDishIngredient {
  return { itemId: `itm_${o.name}`, orgId: null, paidBy: ME, qtyMilli: 1000, quantity: 1, unit: "kg", costMinor: 1000, useTxnId: null, ...o };
}

function dish(over: Partial<KitchenDish> = {}): KitchenDish {
  return {
    id: DSH,
    cook: ME,
    orgId: null,
    name: "Chicken curry",
    portionsHalf: 8,
    portions: 4,
    totalMinor: 21_200,
    currency: "INR",
    state: "draft",
    shares: [],
    recipeId: "rcp_curry",
    recipeFactorMilli: 450,
    ingredients: [
      ing({ name: "Chicken", costMinor: 12_600 }),
      ing({ name: "Onions", orgId: FLAT.orgId, paidBy: MEERA, costMinor: 3_200, useTxnId: "txn_1" }),
      ing({ name: "Oil", orgId: FLAT.orgId, paidBy: MEERA, costMinor: 1_400, useTxnId: "txn_2" }),
      ing({ name: "Rice", orgId: LUNCH.orgId, paidBy: ME, costMinor: 4_000 }),
    ],
    ...over,
  } as KitchenDish;
}

const group = (g: { orgId: string; slug: string; name: string }, o: Partial<MyGroupBalance> = {}): MyGroupBalance => ({
  ...g,
  currency: "INR",
  balanceMinor: 0,
  role: "builder",
  memberCount: 4,
  ...o,
});
const GROUPS = [group(FLAT), group(LUNCH), group(TRIP)];
const GROUP_NAMES = new Map(GROUPS.map((g) => [g.orgId, g.name] as const));

// ── Cooked! ───────────────────────────────────────────────────────

describe("Cooked!", () => {
  it("names the size and time, and shows steps, servings and cost · yours", () => {
    const v = cookedView(dish(), { main: { qtyMilli: 450_000, unit: "g" }, seed: { minutes: 48, steps: { done: 9, total: 9 } }, groupNames: GROUP_NAMES });
    expect(v.subtitle).toBe("Chicken curry · 450 g · 48 min");
    expect(v.tiles).toEqual([
      { value: "9/9", label: "steps" },
      { value: "4", label: "servings" },
      { value: "₹212", label: "cost · yours" },
    ]);
    // No size, no time, no steps: the name and two tiles.
    const bare = cookedView(dish({ portionsHalf: 2, recipeId: null }), { main: null, seed: NO_SEED, groupNames: GROUP_NAMES });
    expect(bare.subtitle).toBe("Chicken curry");
    expect(bare.tiles).toEqual([
      { value: "1", label: "serving" },
      { value: "₹212", label: "cost · yours" },
    ]);
    // Once split, the cost isn't only yours.
    expect(cookedView(dish({ orgId: FLAT.orgId }), { main: null, seed: NO_SEED, groupNames: GROUP_NAMES }).tiles.at(-1)).toEqual({ value: "₹212", label: "cost" });
  });

  it("says which group items were charged to you, only when there are some and only before a split", () => {
    expect(groupItemsNote(dish(), GROUP_NAMES)).toBe("Saved as your dish. Onions and oil from Flat 4B's pantry are charged to you.");
    // Your own purchase in a group's pantry isn't charged to you.
    expect(groupItemsNote(dish({ ingredients: [ing({ name: "Rice", orgId: LUNCH.orgId, paidBy: ME })] }), GROUP_NAMES)).toBeNull();
    expect(groupItemsNote(dish({ ingredients: [ing({ name: "Chicken" })] }), GROUP_NAMES)).toBeNull();
    expect(groupItemsNote(dish({ orgId: FLAT.orgId }), GROUP_NAMES)).toBeNull();
    const two = dish({
      ingredients: [
        ing({ name: "Onions", orgId: FLAT.orgId, paidBy: MEERA }),
        ing({ name: "Rice", orgId: LUNCH.orgId, paidBy: MEERA }),
      ],
    });
    expect(groupItemsNote(two, GROUP_NAMES)).toBe("Saved as your dish. Onions from Flat 4B's pantry and rice from Lunch club's pantry are charged to you.");
    const many = dish({ ingredients: ["Onions", "Oil", "Ginger", "Garlic", "MTR masala"].map((name) => ing({ name, orgId: FLAT.orgId, paidBy: MEERA })) });
    expect(groupItemsNote(many, GROUP_NAMES)).toBe("Saved as your dish. Onions, oil and 3 more from Flat 4B's pantry are charged to you.");
    const one = dish({ ingredients: [ing({ name: "Onions", orgId: FLAT.orgId, paidBy: MEERA })] });
    expect(groupItemsNote(one, GROUP_NAMES)).toBe("Saved as your dish. Onions from Flat 4B's pantry is charged to you.");
  });

  it("offers Post and Split, each with its done state, and Done (RV-16: no longer Not now · done)", () => {
    const none = cookedActions({ postId: null, orgId: null, groupName: null });
    expect(none.map((a) => [a.id, a.title, a.done, a.doneText])).toEqual([
      ["post", "Post to Community", false, null],
      ["split", "Split with a group", false, null],
    ]);
    expect(cookedDoneLabel(none)).toBe("Done");
    const posted = cookedActions({ postId: "pst_1", orgId: null, groupName: null });
    expect(posted.map((a) => a.doneText)).toEqual(["Posted ✓", null]);
    expect(cookedDoneLabel(posted)).toBe("Done");
    const split = cookedActions({ postId: null, orgId: FLAT.orgId, groupName: "Flat 4B" });
    expect(split.map((a) => a.doneText)).toEqual([null, "Flat 4B ✓"]);
    expect(cookedDoneLabel(split)).toBe("Done");
    expect(cookedActions({ postId: "pst_1", orgId: FLAT.orgId, groupName: "Flat 4B" }).every((a) => a.done)).toBe(true);
  });

  it("is the dish page at ?cooked=1, for the cook's own dish that isn't canceled, in the new frame", () => {
    expect(cookedHref(DSH)).toBe(`/dishes/${DSH}?cooked=1`);
    expect(showsCooked(true, true, dish(), ME)).toBe(true);
    expect(showsCooked(true, true, dish({ orgId: FLAT.orgId, state: "open" }), ME)).toBe(true);
    expect(showsCooked(true, false, dish(), ME)).toBe(false);
    expect(showsCooked(true, true, dish(), ANU)).toBe(false);
    expect(showsCooked(true, true, dish({ state: "canceled" }), ME)).toBe(false);
    expect(showsCooked(false, true, dish(), ME)).toBe(false);
  });

  it("reads the time and steps the session left: guided steps, else the clock and the ticked steps", () => {
    const guide = {
      mode: "guided",
      steps: [
        { key: "p1", phase: "prep" },
        { key: "c1", phase: "cook" },
        { key: "c2", phase: "cook" },
        { key: "c3", phase: "cook" },
      ],
      times: {
        c1: { startedAt: "2026-11-09T11:00:00.000Z", doneAt: "2026-11-09T11:20:00.000Z" },
        c2: { startedAt: "2026-11-09T11:20:00.000Z", doneAt: "2026-11-09T11:48:00.000Z" },
      },
    } as unknown as CookGuide;
    expect(cookedSeedOf({ startedAt: "2026-11-09T10:00:00.000Z", steps: [], guide }, NOW)).toEqual({ minutes: 48, steps: { done: 2, total: 3 } });
    const ticked = [{ done: true }, { done: true }, { done: false }];
    expect(cookedSeedOf({ startedAt: "2026-11-09T11:25:00.000Z", steps: ticked }, NOW)).toEqual({ minutes: 35, steps: { done: 2, total: 3 } });
    // A draft left open overnight has no cooking time.
    expect(cookedSeedOf({ startedAt: "2026-11-08T08:00:00.000Z", steps: [] }, NOW)).toEqual({ minutes: null, steps: null });
    expect(parseCookedSeed(JSON.stringify({ minutes: 48, steps: { done: 9, total: 9 } }))).toEqual({ minutes: 48, steps: { done: 9, total: 9 } });
    expect(parseCookedSeed("nope")).toEqual(NO_SEED);
    expect(parseCookedSeed(JSON.stringify({ minutes: -1, steps: { done: 1, total: 0 } }))).toEqual(NO_SEED);
  });
});

// ── The dish page ─────────────────────────────────────────────────

describe("the dish page's Post and Split", () => {
  const offered = (d: KitchenDish, postId: string | null) => dishNextActions(true, d, ME, postId);

  it("offers both on a fresh dish of yours", () => {
    expect(offered(dish(), null)).toEqual({ post: "offer", split: true });
    expect(offersShare(true, dish(), ME)).toBe(true);
  });

  it("Post first, then Split: See your post, and Split still offered", () => {
    expect(offered(dish(), "pst_1")).toEqual({ post: "posted", split: true });
    expect(offered(dish({ orgId: FLAT.orgId, state: "open" }), "pst_1")).toEqual({ post: "posted", split: false });
  });

  it("Split first, then Post: a group dish posts without being finalized", () => {
    const split = dish({ orgId: FLAT.orgId, state: "open" });
    expect(offered(split, null)).toEqual({ post: "offer", split: false });
    expect(offersShare(true, split, ME)).toBe(true);
    expect(offered(dish({ orgId: FLAT.orgId, state: "finalized" }), null)).toEqual({ post: "offer", split: false });
  });

  it("offers nothing on someone else's dish, a canceled one, or in today's frame", () => {
    expect(offered(dish({ cook: ANU }), null)).toEqual({ post: null, split: false });
    expect(offered(dish({ state: "canceled" }), null)).toEqual({ post: null, split: false });
    expect(dishNextActions(false, dish(), ME, null)).toEqual({ post: null, split: false });
    expect(dishNextActions(true, dish(), null, null)).toEqual({ post: null, split: false });
  });
});

// ── Split with a group ────────────────────────────────────────────

describe("Split with a group", () => {
  it("starts on the group whose pantry it took most from, by cost", () => {
    expect(suggestSplitGroup(dish(), GROUPS)).toBe(FLAT.orgId);
    // Lunch club's rice outweighs Flat 4B's onions and oil.
    const rice = dish({ ingredients: [...dish().ingredients.slice(0, 3), ing({ name: "Rice", orgId: LUNCH.orgId, paidBy: MEERA, costMinor: 9_000 })] });
    expect(suggestSplitGroup(rice, GROUPS)).toBe(LUNCH.orgId);
    // Same cost: more items, then by name.
    const tie = dish({
      ingredients: [
        ing({ name: "A", orgId: TRIP.orgId, costMinor: 1_000 }),
        ing({ name: "B", orgId: LUNCH.orgId, costMinor: 500 }),
        ing({ name: "C", orgId: LUNCH.orgId, costMinor: 500 }),
      ],
    });
    expect(suggestSplitGroup(tie, GROUPS)).toBe(LUNCH.orgId);
    const flat = dish({ ingredients: [ing({ name: "A", orgId: TRIP.orgId }), ing({ name: "B", orgId: FLAT.orgId })] });
    expect(suggestSplitGroup(flat, GROUPS)).toBe(FLAT.orgId);
  });

  it("else the group asked for, else the one opened last; never a viewer's or another currency's", () => {
    const own = dish({ ingredients: [ing({ name: "Chicken" })] });
    expect(suggestSplitGroup(own, GROUPS, { hint: TRIP.orgId })).toBe(TRIP.orgId);
    expect(suggestSplitGroup(own, GROUPS, { recentSlugs: [LUNCH.slug] })).toBe(LUNCH.orgId);
    expect(suggestSplitGroup(own, [group(FLAT, { role: "viewer" }), group(LUNCH, { currency: "USD" })], { hint: FLAT.orgId })).toBeNull();
    expect(suggestSplitGroup(dish(), [group(FLAT, { role: "viewer" }), group(LUNCH)])).toBe(LUNCH.orgId);
  });

  it("shares the dish as cooked: its servings and total stay, you start at one, the rest is left to claim", () => {
    const roster = [MEERA, ME, ANU];
    const start = { [ME]: 2 };
    const v = splitEaters({ dish: dish(), roster, meId: ME, halves: { ...start, [MEERA]: 2 }, names: NAMES });
    expect(v.rows.map((r) => [r.subjectId, r.portions, r.amountMinor])).toEqual([
      [ME, "1", 5_300],
      [MEERA, "1", 5_300],
      [ANU, "0", 0],
    ]);
    expect(v.unclaimedHalf).toBe(4);
    expect(splitLeftText(v, "Flat 4B")).toBe("2 left · Flat 4B can claim");
    const full = splitEaters({ dish: dish(), roster, meId: ME, halves: { [ME]: 4, [MEERA]: 4 } });
    expect(full.rows.every((r) => !r.canMore)).toBe(true);
    expect(splitLeftText(full, "Flat 4B")).toBeNull();
  });

  it("sends splitDish (claims), then who ate", () => {
    expect(splitPlan(FLAT.orgId, { halves: { [ME]: 2, [MEERA]: 3, [ANU]: 0 }, roster: [MEERA, ME, ANU], meId: ME })).toEqual({
      split: { orgId: FLAT.orgId, splitMode: "claims" },
      shares: { shares: [{ subjectId: ME, portionsHalf: 2 }, { subjectId: MEERA, portionsHalf: 3 }] },
    });
    expect(splitPlan(FLAT.orgId, { halves: {}, roster: [ME], meId: ME }).shares).toBeNull();
  });

  it("says it on the button, in the toast, and when refused", () => {
    expect(splitButton("Flat 4B", dish())).toEqual({ title: "Split with Flat 4B", sub: "₹212.00 · 4 servings" });
    expect(splitToast("Chicken curry", "Flat 4B", 2)).toEqual({ title: "Chicken curry split with Flat 4B", description: "2 ate · nothing moves until you finalize" });
    expect(splitToast("Chicken curry", "Flat 4B", 1).description).toBe("Open for claims · nothing moves until you finalize");
    expect(splitRefusalText({ reason: "already_split", message: "x" }, "Flat 4B")).toBe("It's split already");
    expect(splitRefusalText({ reason: "dish_not_open", message: "x" }, "Flat 4B")).toBe("It was canceled");
    expect(splitRefusalText({ reason: "currency_mismatch", message: "x", details: { currency: "USD" } }, "Flat 4B")).toBe("Flat 4B counts in USD");
    expect(splitRefusalText({ code: "not_found", message: "x" }, "Flat 4B")).toBe("You can't cook in Flat 4B");
    expect(splitRefusalText({ message: "Nope" }, null)).toBe("Nope");
  });

  it("opens from the page, Cooked! or Home at ?split=, suggesting a group when given", () => {
    expect(splitHref(DSH)).toBe(`/dishes/${DSH}?split=1`);
    expect(splitHref(DSH, FLAT.orgId)).toBe(`/dishes/${DSH}?split=${FLAT.orgId}`);
    expect(splitHref(DSH, "javascript:x")).toBe(`/dishes/${DSH}?split=1`);
    expect(splitParam("1")).toEqual({ open: true, orgId: null });
    expect(splitParam(FLAT.orgId)).toEqual({ open: true, orgId: FLAT.orgId });
    expect(splitParam(null)).toEqual({ open: false, orgId: null });
  });

  it("picks among groups only: no Just me (today's pickers keep it)", () => {
    expect(shareOptions(GROUPS, { groupsOnly: true }).options.map((o) => o.kind)).toEqual(["group", "group", "group"]);
    expect(shareOptions(GROUPS).options[0]!.key).toBe(JUST_ME);
    expect(shareOptions(GROUPS, { groupsOnly: true, query: "just me" }).options).toEqual([]);
  });
});

// ── Home's reminder ───────────────────────────────────────────────

function reminder(id: string, cookedAt: string, o: Partial<SplitReminderInboxItem["dish"]> = {}): SplitReminderInboxItem {
  return {
    kind: "split_reminder",
    dish: { id, name: "Chicken curry", portionsHalf: 8, totalMinor: 21_200, currency: "INR", cookedAt, state: "draft", groupItems: 2, ...o },
    suggest: { orgId: FLAT.orgId, groupName: "Flat 4B", groupSlug: FLAT.slug, why: "used_items" },
  };
}

function finalizeItem(id: string, orgId: string | null) {
  return { kind: "finalize_dish", dish: { id, orgId, name: "x" } } as unknown as InboxResponse["items"][number];
}

function cache(entries: Record<string, unknown>): CacheLike & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(entries));
  return {
    data,
    entries: (prefix) => [...data].filter(([k]) => JSON.parse(k).slice(0, prefix.length).every((v: unknown, i: number) => v === prefix[i])).map(([k, v]) => [JSON.parse(k), v] as const),
    get: (key) => data.get(JSON.stringify(key)),
    set: (key, value) => void data.set(JSON.stringify(key), value),
  };
}

describe("Home's split reminder", () => {
  const r1 = reminder(DSH, "2026-11-09T10:00:00.000Z");
  const r2 = reminder("dsh_00000000000000000000000000000c08", "2026-11-08T10:00:00.000Z", { name: "Dal", portionsHalf: 3, totalMinor: 9_000 });

  it("asks to split it with the suggested group, with its servings and cost; Split opens Split on that group", () => {
    expect(reminderTitle(r1)).toBe("Split Chicken curry with Flat 4B?");
    expect(reminderSub(r1)).toBe("4 servings · ₹212");
    expect(reminderSub(r2)).toBe("1½ servings · ₹90");
    expect(reminderSplitHref(r1)).toBe(`/dishes/${DSH}?split=${FLAT.orgId}`);
    expect(splitReminders({ splitReminders: [r1, r2] })).toEqual([r1, r2]);
    expect(splitReminders({} as InboxResponse)).toEqual([]);
    expect(splitReminders(null)).toEqual([]);
  });

  it("Dismiss takes it off at once; Undo puts it back in order", () => {
    const inbox = { items: [], splitReminders: [r1, r2] } as unknown as InboxResponse;
    const c = cache({ [JSON.stringify(qk.kitchenInbox())]: inbox });
    applyPatches(c, reminderDismissPatches(DSH));
    expect((c.get(qk.kitchenInbox()) as InboxResponse).splitReminders).toEqual([r2]);
    applyPatches(c, reminderRestorePatches(r1));
    expect((c.get(qk.kitchenInbox()) as InboxResponse).splitReminders).toEqual([r1, r2]);
    expect(withoutReminder(inbox, "dsh_none")).toBe(inbox);
    expect(withReminder({ splitReminders: [r1] }, r2).splitReminders).toEqual([r1, r2]);
  });

  it("drops every just-me Finalize from the new frame's To do (it posts nothing), and nothing else; today's frame keeps it", () => {
    const res = {
      items: [finalizeItem(DSH, null), finalizeItem("dsh_other", null), finalizeItem("dsh_group", FLAT.orgId)],
      splitReminders: [r1],
    } as unknown as InboxResponse;
    expect(withoutJustMeFinalize(res).items.map((i) => (i as { dish: { id: string } }).dish.id)).toEqual(["dsh_group"]);
    // Dismissed or never reminded, it stays gone.
    const dismissed = { items: [finalizeItem(DSH, null)], splitReminders: [] } as unknown as InboxResponse;
    expect(withoutJustMeFinalize(dismissed).items).toEqual([]);
    const groupOnly = { items: [finalizeItem("dsh_group", FLAT.orgId)], splitReminders: [] } as unknown as InboxResponse;
    expect(withoutJustMeFinalize(groupOnly)).toBe(groupOnly);
    // Today's Home reads the inbox as it comes: "Just for you" is still a to-do there.
    const today = homeTodos(dismissed, { meId: ME, names: null, now: NOW });
    expect(today.rows.map((r) => [r.kind, r.sub])).toEqual([["finalize_dish", "Just for you"]]);
  });
});

// ── Finish: the dish is yours ─────────────────────────────────────

describe("Finish in the new frame", () => {
  const CHICKEN = makeItem({ name: "Chicken", pantry: PERSONAL_REF, unit: "kg", bought: "1", priceMinor: 28_000, paidBy: ME });
  const session = (): CookSession => {
    const s = addItemLine(setName(blankSession(NOW), "Chicken curry"), CHICKEN);
    return tickLine(s, s.lines[0]!.key);
  };
  const choices = { unticked: "all" as const, halves: {}, roster: null, meId: ME, save: false };

  it("writes the dish as yours — no group, no shares — at the servings you say", () => {
    const planned = finishPlan(session(), { ...choices, postTo: JUST_ME, portionsHalf: 8 }, { groups: GROUPS });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.request).toMatchObject({ name: "Chicken curry", orgId: null, portionsHalf: 8, splitMode: "assign" });
    expect(planned.plan.shares).toBeNull();
    // Clamped to ½ … 100 portions.
    const big = finishPlan(session(), { ...choices, postTo: JUST_ME, portionsHalf: 999 }, { groups: GROUPS });
    expect(big.ok && big.plan.request.portionsHalf).toBe(200);
  });

  it("starts at the recipe's servings at the size cooked, steps by half, and says the cost is yours", () => {
    expect(startingServingsHalf({ servesHalf: 8, factorMilli: 1000 })).toBe(8);
    expect(startingServingsHalf({ servesHalf: 8, factorMilli: 450 })).toBe(4);
    expect(startingServingsHalf({ servesHalf: null, factorMilli: null })).toBe(2);
    expect(stepServings(1, -1)).toBe(1);
    expect(stepServings(8, 1)).toBe(9);
    expect(stepServings(200, 1)).toBe(200);
    expect(finishSub(21_200, "INR", 8)).toBe("₹212.00 · 4 servings · yours");
    expect(finishSub(0, "INR", 2)).toBe("Nothing costed · 1 serving · yours");
    expect(servingsText(3)).toBe("1½ servings");
    expect(servingsOf(3)).toBe(2);
    expect(servingsOf(0)).toBe(1);
  });

  it("lands on Cooked!; the guided last step says Finish next", () => {
    expect(afterFinishHref(dish(), true)).toBe(cookedHref(DSH));
    expect(nextText({ steps: [{ key: "c1", phase: "cook", text: "Simmer" }] } as unknown as CookGuide, { key: "c1", phase: "cook" } as never)).toBe("Finish");
  });
});

// ── Today's frame ─────────────────────────────────────────────────

describe("with newFrame false", () => {
  const CHICKEN = makeItem({ name: "Chicken", pantry: PERSONAL_REF, unit: "kg", bought: "1", priceMinor: 28_000, paidBy: ME });
  const s0 = addItemLine(setName(blankSession(NOW), "Chicken curry"), CHICKEN);
  const s = tickLine(s0, s0.lines[0]!.key);

  it("Finish still lands on the dish page, and the page offers no Post, Split or Cooked!", () => {
    expect(afterFinishHref(dish(), false)).toBe(`/dishes/${DSH}`);
    expect(offersShare(false, dish(), ME)).toBe(false);
    expect(dishNextActions(false, dish(), ME, null)).toEqual({ post: null, split: false });
    expect(showsCooked(false, true, dish(), ME)).toBe(false);
  });

  it("the old Who ate flow is intact: posted to a group with each eater's share, or one portion just for you", () => {
    const toGroup = finishPlan(s, { unticked: "all", postTo: FLAT.orgId, halves: { [ME]: 2, [MEERA]: 3 }, roster: [MEERA, ME], meId: ME, save: false }, { groups: GROUPS });
    expect(toGroup.ok && toGroup.plan.request).toMatchObject({ orgId: FLAT.orgId, portionsHalf: 5, splitMode: "claims" });
    expect(toGroup.ok && toGroup.plan.shares).toEqual({ shares: [{ subjectId: ME, portionsHalf: 2 }, { subjectId: MEERA, portionsHalf: 3 }] });
    const justMe = finishPlan(s, { unticked: "all", postTo: JUST_ME, halves: {}, roster: null, meId: ME, save: false }, { groups: GROUPS });
    expect(justMe.ok && justMe.plan.request).toMatchObject({ orgId: null, portionsHalf: 2, splitMode: "assign" });
  });
});

// ── Finish without amounts (cookpool-revamp RV-7, design §5) ─────

describe("a dish with no amounts", () => {
  const empty = () => dish({ totalMinor: 0, ingredients: [], recipeId: null });

  it("finishes from either sheet — the new frame's (RC-6 and guided Done) and Who ate? — as a dish of no ingredients", () => {
    const s = setName(blankSession(NOW), "Maggi");
    const own = finishPlan(s, { unticked: "all", postTo: JUST_ME, halves: {}, roster: null, meId: ME, save: false, portionsHalf: 4 }, { groups: GROUPS });
    expect(own.ok && own.plan.request).toEqual({ name: "Maggi", orgId: null, portionsHalf: 4, splitMode: "assign" });
    // Nothing ticked, Leave them out: still a dish, still nothing in it.
    const item = makeItem({ name: "Noodles", pantry: PERSONAL_REF, unit: "g", bought: "280", priceMinor: 5600, paidBy: ME });
    const left = finishPlan(addItemLine(s, item), { unticked: "out", postTo: JUST_ME, halves: {}, roster: null, meId: ME, save: false }, { groups: GROUPS });
    expect(left.ok && left.plan.request).toEqual({ name: "Maggi", orgId: null, portionsHalf: 2, splitMode: "assign" });
  });

  it("says ₹0 · nothing taken from the pantry under Finish and Post, and the costs otherwise", () => {
    expect(finishSub(0, "INR", 4, 0)).toBe("₹0 · nothing taken from the pantry");
    expect(finishSub(21_200, "INR", 8, 3)).toBe("₹212.00 · 4 servings · yours");
    // RV-25 (RvCookFinish): the button is one line.
    expect(finishLabel(18_600, "INR", 3)).toBe("Finish · ₹186");
    expect(finishLabel(0, "INR", 0)).toBe("Finish · ₹0");
    expect(finishLabel(0, "INR", 2)).toBe("Finish");
    expect(finishSub(0, "INR", 2, 1)).toBe("Nothing costed · 1 serving · yours");
    const totals = { totalMinor: 0, portionsHalf: 2, perPortionMinor: 0, perPortionExact: true, currency: "INR" };
    expect(postSub(totals, 0)).toBe("₹0 · nothing taken from the pantry");
    expect(postSub(totals, 1)).toBe("₹0.00 · nothing costed");
    expect(postSub(totals)).toBe("₹0.00 · nothing costed");
  });

  it("shows Cooked! at ₹0 with nothing taken, and still offers Post to Community and Split with a group", () => {
    const v = cookedView(empty(), { main: null, seed: NO_SEED, groupNames: GROUP_NAMES });
    expect(v.tiles.at(-1)).toEqual({ value: "₹0", label: "cost · yours" });
    expect(v.note).toBe("₹0 · nothing taken from the pantry");
    expect(cookedActions({ postId: null, orgId: null, groupName: null }).map((a) => [a.id, a.done])).toEqual([["post", false], ["split", false]]);
    expect(dishNextActions(true, empty(), ME, null)).toEqual({ post: "offer", split: true });
    expect(splitButton("Flat 4B", empty())).toEqual({ title: "Split with Flat 4B", sub: "₹0.00 · 4 servings" });
    // Split's Who ate shares out ₹0: everyone at nothing, no division by the total.
    const eaters = splitEaters({ dish: empty(), roster: [ME, MEERA], meId: ME, halves: { [ME]: 2, [MEERA]: 2 } });
    expect(eaters.over).toBe(false);
    // The group to suggest, with no ingredients to go by: the one opened last.
    expect(suggestSplitGroup(empty(), GROUPS, { recentSlugs: [LUNCH.slug] })).toBe(LUNCH.orgId);
  });
});
