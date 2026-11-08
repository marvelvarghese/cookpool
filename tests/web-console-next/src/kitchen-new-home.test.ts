import type { InboxDish, InboxItem, InboxResponse, KitchenDish, KitchenDishShare } from "@saas/contracts/kitchen";
import { NEW_HOME_SECTIONS, TODAY_HOME_SECTIONS, homeSections, newHomeTodoOrder } from "@web-console-next/components/kitchen/new-home";
import { homeTodos } from "@web-console-next/components/kitchen/inbox";
import {
  FEED_DAYS,
  HOME_DISH_DAYS,
  PROFILE_DISH_DAYS,
  coversDays,
  feedCards,
  youHadText,
} from "@web-console-next/components/kitchen/cooks";
import { ANU, DEV, FLAT, LUNCH, ME, MEERA, NAMES } from "./kitchen-pantry-fixtures";

// cookpool-recipes RC-2 (design §1.3, §1.4): `/home` picks its Home when it
// renders. Today's (prod) keeps its money card; the new frame's has To do,
// Cook now and From your groups, and no money card at all.

describe("Home's sections in each frame", () => {
  it("are today's with newFrame() false: greeting, install, money, usuals, To do, Recent", () => {
    expect(homeSections(false)).toBe(TODAY_HOME_SECTIONS);
    expect([...homeSections(false)]).toEqual(["greeting", "install", "money", "quick-use", "todo", "recent"]);
  });

  it("are Hi, What did you use?, To do, Cook now, From your groups in the new frame", () => {
    expect(homeSections(true)).toBe(NEW_HOME_SECTIONS);
    expect(homeSections(true).filter((s) => s !== "install")).toEqual(["greeting", "quick-use", "todo", "cook-now", "from-groups"]);
  });

  it("has no money card in the new frame (money lives in Money), and no Recent", () => {
    expect(homeSections(true)).not.toContain("money");
    expect(homeSections(true)).not.toContain("recent");
    expect(homeSections(false)).toContain("money");
  });
});

const AT = "2026-11-08T10:00:00.000Z";
// In the viewer's calendar, as the app's `dayText` reads it: noon on 8 Nov.
const NOW = new Date(2026, 10, 8, 12, 0);

function inboxDish(id: string, patch: Partial<InboxDish> = {}): InboxDish {
  return {
    id,
    name: `Dish ${id}`,
    cook: MEERA,
    cookName: "Meera",
    orgId: FLAT.orgId,
    groupName: FLAT.name,
    groupSlug: FLAT.slug,
    state: "open",
    splitMode: "claims",
    portionsHalf: 8,
    claimedHalf: 2,
    unclaimedHalf: 6,
    totalMinor: 24000,
    perPortionMinor: 3000,
    currency: "INR",
    cookedAt: AT,
    ...patch,
  };
}

const soon = (id: string, days: number): InboxItem =>
  ({
    kind: "use_soon",
    item: {
      id,
      ref: `me:${id}`,
      name: `Item ${id}`,
      unit: "g",
      qtyLeftMilli: 500_000,
      expiresOn: "2026-11-08",
      daysToUseBy: days,
      pantry: { kind: "personal", name: "My pantry" },
    },
    usual: null,
  }) as unknown as InboxItem;

const pay = (to: string, amountMinor: number): InboxItem =>
  ({
    kind: "payment_due",
    orgId: FLAT.orgId,
    groupSlug: FLAT.slug,
    groupName: FLAT.name,
    toSubjectId: to,
    toName: NAMES.get(to) ?? null,
    amountMinor,
    currency: "INR",
    canRecord: true,
  }) as InboxItem;

describe("the new frame's To do", () => {
  // The server's order: past its date, dishes to claim, dishes to finalize, use soon, payments, flags.
  const items: InboxItem[] = [
    soon("itm_expired", -1),
    { kind: "claim_dish", dish: inboxDish("dsh_a") },
    { kind: "claim_dish", dish: inboxDish("dsh_b") },
    { kind: "finalize_dish", dish: inboxDish("dsh_mine", { cook: ME, cookName: null }) },
    soon("itm_soon", 2),
    pay(DEV, 4575),
    pay(ANU, 1200),
  ];
  const res: InboxResponse = { items, counts: { total: items.length } as InboxResponse["counts"] };

  it("puts dishes first, then Pay X, then use soon or past its date, each kept in the server's order", () => {
    const keys = newHomeTodoOrder(res).items.map((i) => (i.kind === "claim_dish" || i.kind === "finalize_dish" ? i.dish.id : i.kind === "use_soon" ? i.item.id : `pay:${i.kind === "payment_due" ? i.toSubjectId : ""}`));
    expect(keys).toEqual(["dsh_a", "dsh_b", "dsh_mine", `pay:${DEV}`, `pay:${ANU}`, "itm_expired", "itm_soon"]);
  });

  it("leaves the inbox itself alone, and keeps every item", () => {
    const ordered = newHomeTodoOrder(res);
    expect(ordered).not.toBe(res);
    expect(res.items[0]!.kind).toBe("use_soon");
    expect(ordered.items).toHaveLength(items.length);
    expect(ordered.counts).toBe(res.counts);
  });

  it("shows an open dish as a to-do with the claim chips, and a payment as Pay X", () => {
    const rows = homeTodos(newHomeTodoOrder(res), { meId: ME, names: NAMES, now: NOW }, { all: true }).rows;
    expect(rows[0]).toMatchObject({ kind: "claim_dish", title: "Dish dsh_a", action: { kind: "claim", dishId: "dsh_a" } });
    expect(rows.find((r) => r.kind === "payment_due")).toMatchObject({ title: "Pay Dev", sub: "₹45.75" });
  });
});

function share(subjectId: string, portionsHalf: number | null, exactMinor: number | null = null): KitchenDishShare {
  return { id: `dsr_${subjectId.slice(-4)}`, subjectId, portionsHalf, exactMinor, source: "self", createdAt: AT, updatedAt: AT };
}

function dish(id: string, patch: Partial<KitchenDish> = {}): KitchenDish {
  return {
    id,
    cook: MEERA,
    orgId: FLAT.orgId,
    name: "Egg fried rice",
    portionsHalf: 8,
    portions: 4,
    extrasMinor: 0,
    ingredientsMinor: 12480,
    totalMinor: 12480,
    currency: "INR",
    splitMode: "claims",
    state: "finalized",
    txnId: "txn_1",
    leftoverItemId: null,
    cookedAt: new Date(2026, 10, 7, 19, 0).toISOString(),
    finalizedAt: new Date(2026, 10, 7, 21, 0).toISOString(),
    canceledAt: null,
    createdAt: AT,
    updatedAt: AT,
    ingredients: [],
    fromMineMinor: 0,
    owes: [],
    shares: [share(MEERA, 3), share(ME, 3), share(ANU, 2)],
    myClaimHalf: 3,
    claimedHalf: 8,
    unclaimedHalf: 0,
    unclaimedMinor: 0,
    amounts: [],
    netting: [],
    ...patch,
  };
}

describe("From your groups", () => {
  const groupNames = new Map([
    [FLAT.orgId, FLAT.name],
    [LUNCH.orgId, LUNCH.name],
  ]);
  const ctx = { meId: ME, names: NAMES, groupNames, now: NOW };

  it("shows a finished dish with the cook, the group and when, and three numbers", () => {
    const [card] = feedCards([dish("dsh_1")], ctx);
    expect(card).toEqual({
      dishId: "dsh_1",
      href: "/dishes/dsh_1",
      cookId: MEERA,
      cookText: "Meera cooked",
      groupName: "Flat 4B",
      orgId: FLAT.orgId,
      when: "Yesterday",
      name: "Egg fried rice",
      portions: "4",
      each: "₹31.20",
      youHad: "1½",
    });
  });

  it("shows finished cooks only: an open dish is a To do, a canceled one is gone", () => {
    const cards = feedCards([dish("dsh_open", { state: "open", finalizedAt: null }), dish("dsh_draft", { state: "draft", finalizedAt: null }), dish("dsh_x", { state: "canceled" }), dish("dsh_done")], ctx);
    expect(cards.map((c) => c.dishId)).toEqual(["dsh_done"]);
  });

  it("covers the last 7 days of finishing, in any of your groups, newest finished first", () => {
    const cards = feedCards(
      [
        dish("dsh_old", { finalizedAt: "2026-10-31T11:00:00.000Z" }),
        dish("dsh_lunch", { orgId: LUNCH.orgId, finalizedAt: new Date(2026, 10, 8, 9, 0).toISOString() }),
        dish("dsh_cooked_early", { cookedAt: "2026-10-25T19:00:00.000Z", finalizedAt: "2026-11-02T13:00:00.000Z" }),
        dish("dsh_flat"),
      ],
      ctx,
    );
    expect(cards.map((c) => [c.dishId, c.groupName])).toEqual([
      ["dsh_lunch", "Lunch club"],
      ["dsh_flat", "Flat 4B"],
      ["dsh_cooked_early", "Flat 4B"],
    ]);
    expect(FEED_DAYS).toBe(7);
  });

  it("leaves out a dish just for its cook and one in a group you are not in", () => {
    const cards = feedCards([dish("dsh_solo", { orgId: null }), dish("dsh_other", { orgId: "org_00000000000000000000000000000999" })], ctx);
    expect(cards).toEqual([]);
  });

  it("says You cooked for your own dish, and 0 when you had none", () => {
    const [card] = feedCards([dish("dsh_mine", { cook: ME, shares: [share(ANU, 4), share(DEV, 4)] })], ctx);
    expect(card).toMatchObject({ cookText: "You cooked", youHad: "0" });
  });

  it("says what you had as an amount when yours was exact, and ≈ each when it does not divide", () => {
    expect(youHadText(dish("d", { shares: [share(ME, null, 4000)] }), ME)).toBe("₹40.00");
    const [card] = feedCards([dish("dsh_odd", { totalMinor: 10000, portionsHalf: 6 })], ctx);
    expect(card!.each).toBe("≈ ₹33.33");
  });

  it("shows each dish once, at most ten", () => {
    const many = Array.from({ length: 14 }, (_, i) => dish(`dsh_${String(i).padStart(2, "0")}`));
    expect(feedCards([...many, many[0]!], ctx)).toHaveLength(10);
  });
});

describe("reading the dishes far enough back", () => {
  const read = [dish("a", { cookedAt: "2026-11-07T10:00:00.000Z" }), dish("b", { cookedAt: "2026-10-20T10:00:00.000Z" })];

  it("stops once the oldest read is older than the days needed, or there is no more", () => {
    expect(coversDays(read, true, HOME_DISH_DAYS, NOW)).toBe(true);
    expect(coversDays(read, true, PROFILE_DISH_DAYS, NOW)).toBe(false);
    expect(coversDays(read, false, PROFILE_DISH_DAYS, NOW)).toBe(true);
    expect(coversDays([], true, 7, NOW)).toBe(false);
  });

  it("reads two weeks for Home and the chart's 8 weeks for a page", () => {
    expect(HOME_DISH_DAYS).toBe(14);
    expect(PROFILE_DISH_DAYS).toBe(56);
  });
});
