// Home's inbox (CP-19): GET /v1/kitchen/me/inbox — dishes to claim or
// finalize, items to use soon, payments the caller owes and open flags on
// their entries, most urgent first — and the service-internal balance route
// membership-worker asks before anyone leaves a group
// (GET /v1/internal/kitchen/organizations/{org}/subjects/{usr}/balance).
// Through the router, against real SQLite (every migration applied), the real
// policy grants, membership's answers and identity's names.

import type {
  ClaimDishInboxItem,
  DishResponse,
  FlagInboxItem,
  InboxItem,
  InboxResponse,
  KitchenDish,
  KitchenItem,
  KitchenItemResponse,
  KitchenTxn,
  PaymentDueInboxItem,
  SubjectBalanceResponse,
  UseSoonInboxItem,
} from "@saas/contracts/kitchen";
import { INBOX_USE_SOON_MAX, KITCHEN_INTERNAL_ACTOR_HEADER } from "@saas/contracts/kitchen";
import type { OrganizationRole } from "@saas/contracts/policy";
import { authorize } from "@saas/policy-engine";
import { FINALIZE_ROLES, SETTLE_ROLES, perPortionMinor } from "@kitchen-worker/inbox";
import { route } from "@kitchen-worker/router";
import { fetchKitchenBalance } from "@membership-worker/kitchen-client";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-02T12:00:00.000Z");
const TODAY = "2026-11-02";
const day = (offset: number) => new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);

const RAHUL = "usr_rahul"; // builder in Flat 4B, viewer in the Lunch club
const ANU = "usr_anu"; // owner of Flat 4B
const DEV = "usr_dev"; // builder in Flat 4B
const VIEWER = "usr_viewer"; // viewer in Flat 4B
const KIRAN = "usr_kiran"; // owner of the Lunch club
const OUTSIDER = "usr_outsider"; // another flat entirely
const LONER = "usr_loner"; // in no group at all

let h: Harness;
let tick: number;
let flat: Group;
let lunch: Group;
let elsewhere: Group;

beforeEach(() => {
  tick = 0;
  // Each write a second after the last, so "oldest first" is well defined.
  h = createHarness({ deps: { now: () => new Date(NOW.getTime() + (tick += 1) * 1000) } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  elsewhere = newGroup("Another flat");
  h.grant(RAHUL, flat, "builder");
  h.grant(ANU, flat, "owner");
  h.grant(DEV, flat, "builder");
  h.grant(VIEWER, flat, "viewer");
  h.grant(KIRAN, lunch, "owner");
  h.grant(RAHUL, lunch, "viewer");
  h.grant(OUTSIDER, elsewhere, "owner");
  h.profile(RAHUL, { displayName: "Rahul", email: "rahul@example.com" });
  h.profile(ANU, { displayName: "Anu", email: "anu@example.com" });
  h.profile(DEV, { displayName: null, email: "dev.patel@example.com" });
  h.profile(KIRAN, { displayName: "Kiran", email: "kiran@example.com" });
});

afterEach(() => h.close());

async function call<T>(method: string, url: string, as: string | null, body?: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

const me = (rest: string) => `/v1/kitchen/me/${rest}`;
const groupPath = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

async function inbox(as: string): Promise<InboxResponse> {
  const res = await call<InboxResponse>("GET", me("inbox"), as);
  expect(res.status).toBe(200);
  return res.body.data;
}

const ofKind = <K extends InboxItem["kind"]>(data: InboxResponse, kind: K) =>
  data.items.filter((i): i is Extract<InboxItem, { kind: K }> => i.kind === kind);

/** A dish of `priceMinor` worth of rice, cooked by `cook`; shared with `g` (claims or assigned) or just for them. */
async function cook(
  as: string,
  g: Group | null,
  opts: { splitMode?: "claims" | "assign"; portionsHalf?: number; priceMinor?: number; name?: string } = {},
): Promise<KitchenDish> {
  const res = await call<DishResponse>("POST", me("dishes"), as, {
    name: opts.name ?? "Egg fried rice",
    orgId: g?.publicId ?? null,
    portionsHalf: opts.portionsHalf ?? 8,
    splitMode: opts.splitMode ?? (g ? "claims" : "assign"),
    newItems: [{ name: "Rice", quantity: "1", unit: "kg", priceMinor: opts.priceMinor ?? 2000 }],
  });
  expect(res.status).toBe(201);
  return res.body.data.dish;
}

async function myItem(as: string, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", me("items"), as, { category: "Dairy", quantity: "1", unit: "L", priceMinor: 6000, ...body });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

async function groupItem(as: string, g: Group, body: Record<string, unknown>): Promise<KitchenItem> {
  const res = await call<KitchenItemResponse>("POST", groupPath(g, "items"), as, { category: "Veg", quantity: "1", unit: "kg", priceMinor: 4000, ...body });
  expect(res.status).toBe(201);
  return res.body.data.item;
}

/** `payer` paid `amount` for `owers`, split equally between them. */
async function paidFor(g: Group, payer: string, amount: number, owers: string[], title = "Groceries"): Promise<KitchenTxn> {
  const res = await call<{ txn: KitchenTxn }>("POST", groupPath(g, "expenses"), payer, {
    title,
    totalMinor: amount,
    payers: [{ subjectId: payer, amountMinor: amount }],
    mode: "equal",
    participants: owers.map((subjectId) => ({ subjectId })),
  });
  expect(res.status).toBe(201);
  return res.body.data.txn;
}

async function flag(g: Group, txn: KitchenTxn, as: string, reason = "I wasn't there"): Promise<void> {
  expect((await call("POST", groupPath(g, `txns/${txn.id}/flags`), as, { reason })).status).toBe(201);
}

// ── The route ──────────────────────────────────────────────

describe("GET /v1/kitchen/me/inbox", () => {
  it("is empty, with every count at zero, for someone with nothing to do", async () => {
    expect(await inbox(LONER)).toEqual({
      items: [],
      counts: { total: 0, claim_dish: 0, finalize_dish: 0, use_soon: 0, payment_due: 0, flag: 0 },
    });
    expect(await inbox(RAHUL)).toEqual({
      items: [],
      counts: { total: 0, claim_dish: 0, finalize_dish: 0, use_soon: 0, payment_due: 0, flag: 0 },
    });
  });

  it("needs an actor, and only GET", async () => {
    expect((await call("GET", me("inbox"), null)).status).toBe(401);
    expect((await call("POST", me("inbox"), RAHUL, {})).status).toBe(405);
  });

  it("is a 503 when membership cannot say which groups the caller is in", async () => {
    h.failGroups = true;
    const res = await call("GET", me("inbox"), RAHUL);
    expect(res.status).toBe(503);
  });

  it("still answers when identity cannot be read, without names", async () => {
    await cook(ANU, flat);
    h.failIdentity = true;
    const [claim] = ofKind(await inbox(RAHUL), "claim_dish");
    expect(claim!.dish.cookName).toBeNull();
  });

  it("reports its phases in Server-Timing", async () => {
    const res = await h.call("GET", me("inbox"), { as: RAHUL });
    const timing = res.headers.get("server-timing") ?? "";
    for (const phase of ["groups", "dishes", "items", "ledger", "flags", "total"]) expect(timing).toContain(phase);
  });
});

// ── claim_dish ─────────────────────────────────────────────

describe("claim_dish", () => {
  it("offers a dish open for claims to the group's members who can claim, with what the card needs", async () => {
    const dish = await cook(ANU, flat, { priceMinor: 2000, portionsHalf: 8 });
    const data = await inbox(RAHUL);
    expect(ofKind(data, "claim_dish")).toEqual<ClaimDishInboxItem[]>([
      {
        kind: "claim_dish",
        dish: {
          id: dish.id,
          orgId: flat.publicId,
          groupName: "Flat 4B",
          groupSlug: flat.slug,
          name: "Egg fried rice",
          cook: ANU,
          cookName: "Anu",
          state: "open",
          splitMode: "claims",
          portionsHalf: 8,
          claimedHalf: 0,
          unclaimedHalf: 8,
          perPortionMinor: 500,
          totalMinor: 2000,
          currency: "INR",
          cookedAt: dish.cookedAt,
        },
      },
    ]);
    expect(data.counts.claim_dish).toBe(1);
    expect(ofKind(await inbox(DEV), "claim_dish")).toHaveLength(1);
  });

  it("is not offered to its cook, nor to a viewer, nor outside the group", async () => {
    await cook(ANU, flat);
    expect(ofKind(await inbox(ANU), "claim_dish")).toEqual([]);
    expect(ofKind(await inbox(VIEWER), "claim_dish")).toEqual([]);
    expect(ofKind(await inbox(KIRAN), "claim_dish")).toEqual([]);
    expect(ofKind(await inbox(OUTSIDER), "claim_dish")).toEqual([]);
  });

  it("is not offered in a group where the caller only views, or one they are not in", async () => {
    await cook(KIRAN, lunch);
    await cook(OUTSIDER, elsewhere);
    expect(ofKind(await inbox(RAHUL), "claim_dish")).toEqual([]);
  });

  it("goes once the caller has claimed, and when nothing is left to claim", async () => {
    const dish = await cook(ANU, flat, { portionsHalf: 4 });
    expect((await call("PUT", groupPath(flat, `dishes/${dish.id}/claims/me`), RAHUL, { portionsHalf: 2 })).status).toBe(200);
    expect(ofKind(await inbox(RAHUL), "claim_dish")).toEqual([]);
    const [forDev] = ofKind(await inbox(DEV), "claim_dish");
    expect(forDev!.dish).toMatchObject({ claimedHalf: 2, unclaimedHalf: 2 });

    // Anu takes the rest: nothing left for Dev to claim.
    expect((await call("PUT", groupPath(flat, `dishes/${dish.id}/claims/me`), ANU, { portionsHalf: 2 })).status).toBe(200);
    expect(ofKind(await inbox(DEV), "claim_dish")).toEqual([]);
  });

  it("goes when the dish is finalized or canceled", async () => {
    const finalized = await cook(ANU, flat, { name: "Dal" });
    const canceled = await cook(ANU, flat, { name: "Soup" });
    expect(ofKind(await inbox(RAHUL), "claim_dish").map((i) => i.dish.id).sort()).toEqual([finalized.id, canceled.id].sort());
    expect((await call("POST", me(`dishes/${finalized.id}/finalize`), ANU)).status).toBe(200);
    expect((await call("POST", me(`dishes/${canceled.id}/cancel`), ANU)).status).toBe(200);
    expect(ofKind(await inbox(RAHUL), "claim_dish")).toEqual([]);
  });

  it("goes when the caller leaves the group", async () => {
    await cook(ANU, flat);
    h.revoke(RAHUL, flat);
    expect(ofKind(await inbox(RAHUL), "claim_dish")).toEqual([]);
  });

  it("prices a portion with the engine's split of the total", () => {
    expect(perPortionMinor(21100, 8)).toBe(5275); // design.md §3: ₹211.00 for 4 portions
    expect(perPortionMinor(1000, 3)).toBe(667); // 1½ portions: two thirds of the total, largest remainder
    expect(perPortionMinor(1000, 2)).toBe(1000);
    expect(perPortionMinor(300, 1)).toBe(600); // half a portion: a whole one would cost twice as much
    expect(perPortionMinor(0, 4)).toBe(0);
  });
});

// ── finalize_dish ──────────────────────────────────────────

describe("finalize_dish", () => {
  it("asks the cook to finalize their open and draft dishes, and one just for them", async () => {
    const open = await cook(RAHUL, flat, { name: "Biryani" });
    const assigned = await cook(RAHUL, flat, { splitMode: "assign", name: "Pulao" });
    const solo = await cook(RAHUL, null, { name: "Maggi" });
    const items = ofKind(await inbox(RAHUL), "finalize_dish");
    expect(items.map((i) => [i.dish.id, i.dish.state, i.dish.orgId])).toEqual([
      [open.id, "open", flat.publicId],
      [assigned.id, "draft", flat.publicId],
      [solo.id, "draft", null],
    ]);
    expect(items[0]!.dish).toMatchObject({ cook: RAHUL, cookName: "Rahul", groupName: "Flat 4B", splitMode: "claims" });
    expect(items[2]!.dish).toMatchObject({ groupName: null, groupSlug: null, splitMode: "assign" });
    // Nobody else is asked to finalize them.
    expect(ofKind(await inbox(ANU), "finalize_dish")).toEqual([]);
  });

  it("says how much has been claimed", async () => {
    const dish = await cook(RAHUL, flat, { portionsHalf: 6, priceMinor: 3000 });
    await call("PUT", groupPath(flat, `dishes/${dish.id}/claims/me`), ANU, { portionsHalf: 3 });
    const [item] = ofKind(await inbox(RAHUL), "finalize_dish");
    expect(item!.dish).toMatchObject({ portionsHalf: 6, claimedHalf: 3, unclaimedHalf: 3, totalMinor: 3000, perPortionMinor: 1000 });
  });

  it("goes once finalized or canceled", async () => {
    const a = await cook(RAHUL, flat, { name: "A" });
    const b = await cook(RAHUL, null, { name: "B" });
    const c = await cook(RAHUL, flat, { splitMode: "assign", name: "C" });
    expect((await call("POST", me(`dishes/${a.id}/finalize`), RAHUL)).status).toBe(200);
    expect((await call("POST", me(`dishes/${b.id}/finalize`), RAHUL)).status).toBe(200);
    expect((await call("POST", me(`dishes/${c.id}/cancel`), RAHUL)).status).toBe(200);
    expect(ofKind(await inbox(RAHUL), "finalize_dish")).toEqual([]);
  });

  it("is not offered once the cook can no longer finalize there: made a viewer, or gone from the group", async () => {
    await cook(RAHUL, flat);
    h.grant(RAHUL, flat, "viewer");
    expect(ofKind(await inbox(RAHUL), "finalize_dish")).toEqual([]);
    h.revoke(RAHUL, flat);
    expect(ofKind(await inbox(RAHUL), "finalize_dish")).toEqual([]);
  });

  it("finalizes only the roles the policy engine grants kitchen.dish.finalize", () => {
    for (const role of ["owner", "admin", "builder", "viewer", "billing_admin"] as OrganizationRole[]) {
      const decision = authorize({
        subject: { type: "user", id: "usr_x" },
        action: "kitchen.dish.finalize",
        resource: { kind: "organization", orgId: "org" },
        context: { memberships: [{ kind: "role_assignment", role, scope: { kind: "organization", orgId: "org" } }] },
      });
      expect([role, FINALIZE_ROLES.has(role)]).toEqual([role, decision.allow]);
    }
  });
});

// ── use_soon ───────────────────────────────────────────────

describe("use_soon", () => {
  it("lists items the caller may use within two days of their use-by date, with what the card needs", async () => {
    const milk = await myItem(RAHUL, { name: "Milk", expiresOn: day(1) });
    const tomatoes = await groupItem(ANU, flat, { name: "Tomatoes", expiresOn: day(0) });
    const items = ofKind(await inbox(RAHUL), "use_soon");
    expect(items).toEqual<UseSoonInboxItem[]>([
      {
        kind: "use_soon",
        item: {
          id: tomatoes.id,
          ref: `org:${flat.publicId}:${tomatoes.id}`,
          name: "Tomatoes",
          pantry: { kind: "group", orgId: flat.publicId, slug: flat.slug, name: "Flat 4B" },
          orgId: flat.publicId,
          qtyLeftMilli: 1_000_000,
          quantity: 1,
          unit: "kg",
          expiresOn: TODAY,
          daysToUseBy: 0,
          canUse: true,
        },
        usual: null,
      },
      {
        kind: "use_soon",
        item: {
          id: milk.id,
          ref: `me:${milk.id}`,
          name: "Milk",
          pantry: { kind: "personal", name: "My pantry" },
          orgId: null,
          qtyLeftMilli: 1_000_000,
          quantity: 1,
          unit: "L",
          expiresOn: day(1),
          daysToUseBy: 1,
          canUse: true,
        },
        usual: null,
      },
    ]);
  });

  it("covers two days back to two days ahead, and nothing without a date", async () => {
    for (const offset of [-3, -2, -1, 0, 1, 2, 3]) await myItem(RAHUL, { name: `Day ${offset}`, expiresOn: day(offset) });
    await myItem(RAHUL, { name: "Rice", expiresOn: null });
    const items = ofKind(await inbox(RAHUL), "use_soon");
    expect(items.map((i) => i.item.name)).toEqual(["Day -2", "Day -1", "Day 0", "Day 1", "Day 2"]);
    expect(items.map((i) => i.item.daysToUseBy)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("leaves out items the caller may not use: a group they only view, a group they are not in, someone else's pantry", async () => {
    await groupItem(KIRAN, lunch, { name: "Paneer", expiresOn: day(0) });
    await groupItem(OUTSIDER, elsewhere, { name: "Curd", expiresOn: day(0) });
    await myItem(ANU, { name: "Anu's milk", expiresOn: day(0) });
    expect(ofKind(await inbox(RAHUL), "use_soon")).toEqual([]);
    // A viewer of Flat 4B is not offered its items either.
    await groupItem(ANU, flat, { name: "Spinach", expiresOn: day(0) });
    expect(ofKind(await inbox(VIEWER), "use_soon")).toEqual([]);
    expect(ofKind(await inbox(RAHUL), "use_soon").map((i) => i.item.name)).toEqual(["Spinach"]);
  });

  it("drops an item once it is used up, and keeps one with something left", async () => {
    const milk = await myItem(RAHUL, { name: "Milk", expiresOn: day(1) });
    const curd = await myItem(RAHUL, { name: "Curd", expiresOn: day(1) });
    expect((await call("POST", me(`items/${milk.id}/uses`), RAHUL, { quantity: "1", unit: "L" })).status).toBe(201);
    expect((await call("POST", me(`items/${curd.id}/uses`), RAHUL, { quantity: "250", unit: "ml" })).status).toBe(201);
    const items = ofKind(await inbox(RAHUL), "use_soon");
    expect(items.map((i) => i.item.name)).toEqual(["Curd"]);
    expect(items[0]!.item).toMatchObject({ qtyLeftMilli: 750_000, quantity: 0.75, unit: "L" });
  });

  it("carries the caller's usual amount, as they last logged it", async () => {
    const curd = await myItem(RAHUL, { name: "Curd", expiresOn: day(2) });
    await call("POST", me(`items/${curd.id}/uses`), RAHUL, { quantity: "200", unit: "ml" });
    const tomatoes = await groupItem(ANU, flat, { name: "Tomatoes", expiresOn: day(2) });
    await call("POST", groupPath(flat, `items/${tomatoes.id}/uses`), RAHUL, { quantity: "250", unit: "g" });
    const items = ofKind(await inbox(RAHUL), "use_soon");
    expect(Object.fromEntries(items.map((i) => [i.item.name, i.usual]))).toEqual({
      Curd: { quantity: 200, unit: "ml", qtyMilli: 200_000 },
      Tomatoes: { quantity: 250, unit: "g", qtyMilli: 250_000 },
    });
    // Anu used none of them: no usual for her.
    expect(ofKind(await inbox(ANU), "use_soon").map((i) => i.usual)).toEqual([null]);
  });

  it(`lists at most ${INBOX_USE_SOON_MAX}, soonest first`, async () => {
    for (let i = 0; i < INBOX_USE_SOON_MAX + 3; i++) {
      await myItem(RAHUL, { name: `Item ${String(i).padStart(2, "0")}`, expiresOn: day(2 - (i % 5)) });
    }
    const items = ofKind(await inbox(RAHUL), "use_soon");
    expect(items).toHaveLength(INBOX_USE_SOON_MAX);
    const dates = items.map((i) => i.item.expiresOn);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[0]).toBe(day(-2));
  });
});

// ── payment_due ────────────────────────────────────────────

describe("payment_due", () => {
  it("lists what the caller owes in each group's settle plan", async () => {
    await paidFor(flat, ANU, 3000, [RAHUL, ANU, DEV]);
    expect(ofKind(await inbox(RAHUL), "payment_due")).toEqual<PaymentDueInboxItem[]>([
      {
        kind: "payment_due",
        orgId: flat.publicId,
        groupName: "Flat 4B",
        groupSlug: flat.slug,
        toSubjectId: ANU,
        toName: "Anu",
        amountMinor: 1000,
        currency: "INR",
        canRecord: true,
      },
    ]);
    // Anu is owed, not owing.
    expect(ofKind(await inbox(ANU), "payment_due")).toEqual([]);
  });

  it("goes once the payment is recorded", async () => {
    await paidFor(flat, ANU, 3000, [RAHUL, ANU, DEV]);
    const paid = await call("POST", groupPath(flat, "settlements"), RAHUL, { fromSubjectId: RAHUL, toSubjectId: ANU, amountMinor: 1000 });
    expect(paid.status).toBe(201);
    expect(ofKind(await inbox(RAHUL), "payment_due")).toEqual([]);
  });

  it("tells a viewer they owe, but that they cannot record it", async () => {
    await paidFor(flat, ANU, 2000, [ANU, VIEWER]);
    const [due] = ofKind(await inbox(VIEWER), "payment_due");
    expect(due).toMatchObject({ toSubjectId: ANU, amountMinor: 1000, canRecord: false });
  });

  it("is never from a group the caller is not in", async () => {
    await paidFor(lunch, KIRAN, 2000, [KIRAN, RAHUL]);
    // Rahul views the Lunch club and owes Kiran there; he is not in the other flat at all.
    expect(ofKind(await inbox(RAHUL), "payment_due").map((p) => p.orgId)).toEqual([lunch.publicId]);
    h.revoke(RAHUL, lunch);
    expect(ofKind(await inbox(RAHUL), "payment_due")).toEqual([]);
  });

  it("records only with the roles the policy engine grants kitchen.settlement.create", () => {
    for (const role of ["owner", "admin", "builder", "viewer", "billing_admin"] as OrganizationRole[]) {
      const decision = authorize({
        subject: { type: "user", id: "usr_x" },
        action: "kitchen.settlement.create",
        resource: { kind: "organization", orgId: "org" },
        context: { memberships: [{ kind: "role_assignment", role, scope: { kind: "organization", orgId: "org" } }] },
      });
      expect([role, SETTLE_ROLES.has(role)]).toEqual([role, decision.allow]);
    }
  });
});

// ── flag ───────────────────────────────────────────────────

describe("flag", () => {
  it("tells whoever logged a transaction that someone flagged it", async () => {
    const txn = await paidFor(flat, RAHUL, 3000, [RAHUL, ANU, DEV], "Vegetables");
    await flag(flat, txn, DEV, "I wasn't there");
    const [item] = ofKind(await inbox(RAHUL), "flag");
    expect(item).toEqual<FlagInboxItem>({
      kind: "flag",
      flagId: expect.stringMatching(/^flg_[0-9a-f]{32}$/) as unknown as string,
      txnId: txn.id,
      orgId: flat.publicId,
      groupName: "Flat 4B",
      groupSlug: flat.slug,
      title: "Vegetables",
      txnKind: "expense",
      totalMinor: 3000,
      currency: "INR",
      dishId: null,
      flaggedBy: DEV,
      flaggedByName: "dev.patel",
      reason: "I wasn't there",
      flaggedAt: expect.any(String) as unknown as string,
    });
    // The flagger, and anyone else, has nothing to do about it.
    expect(ofKind(await inbox(DEV), "flag")).toEqual([]);
    expect(ofKind(await inbox(ANU), "flag")).toEqual([]);
  });

  it("leaves out a flag the caller raised on their own entry", async () => {
    const txn = await paidFor(flat, RAHUL, 2000, [RAHUL, ANU]);
    await flag(flat, txn, RAHUL, "Wrong amount");
    expect(ofKind(await inbox(RAHUL), "flag")).toEqual([]);
  });

  it("goes once the transaction is reversed", async () => {
    const txn = await paidFor(flat, RAHUL, 3000, [RAHUL, ANU, DEV]);
    await flag(flat, txn, ANU);
    await flag(flat, txn, DEV);
    expect(ofKind(await inbox(RAHUL), "flag").map((f) => f.flaggedBy)).toEqual([ANU, DEV]);
    expect((await call("POST", groupPath(flat, `txns/${txn.id}/reverse`), RAHUL)).status).toBe(201);
    expect(ofKind(await inbox(RAHUL), "flag")).toEqual([]);
  });

  it("names the dish a flagged dish charge came from", async () => {
    const dish = await cook(RAHUL, flat, { priceMinor: 2000, portionsHalf: 4 });
    await call("PUT", groupPath(flat, `dishes/${dish.id}/claims/me`), ANU, { portionsHalf: 2 });
    const finalized = await call<DishResponse>("POST", me(`dishes/${dish.id}/finalize`), RAHUL);
    const txnId = finalized.body.data.dish.txnId!;
    expect((await call("POST", groupPath(flat, `txns/${txnId}/flags`), ANU, { reason: "I had less" })).status).toBe(201);
    const [item] = ofKind(await inbox(RAHUL), "flag");
    expect(item).toMatchObject({ txnId, txnKind: "dish", dishId: dish.id, flaggedBy: ANU });
  });

  it("is never from a group the caller has left", async () => {
    const txn = await paidFor(flat, RAHUL, 3000, [RAHUL, ANU, DEV]);
    await flag(flat, txn, ANU);
    h.revoke(RAHUL, flat);
    expect(ofKind(await inbox(RAHUL), "flag")).toEqual([]);
  });
});

// ── Order, counts and reads ────────────────────────────────

describe("the whole inbox", () => {
  /** One of everything for Rahul: two dishes he could claim, one of his own, three items, a debt and a flag. */
  async function everything(): Promise<void> {
    await myItem(RAHUL, { name: "Bread", expiresOn: day(2) });
    const expense = await paidFor(flat, RAHUL, 900, [RAHUL, ANU, DEV], "Milk run");
    await flag(flat, expense, DEV);
    await paidFor(flat, ANU, 6000, [RAHUL, ANU, DEV], "Gas");
    await cook(ANU, flat, { name: "Older dish" });
    await cook(DEV, flat, { name: "Newer dish" });
    await cook(RAHUL, null, { name: "My lunch" });
    await myItem(RAHUL, { name: "Curd", expiresOn: day(-1) });
    await groupItem(ANU, flat, { name: "Spinach", expiresOn: day(0) });
  }

  it("puts the most urgent first: food going off now, dishes to claim, your dishes, food going off soon, debts, flags", async () => {
    await everything();
    const data = await inbox(RAHUL);
    const label = (i: InboxItem): string => {
      switch (i.kind) {
        case "use_soon":
          return `use_soon:${i.item.name}`;
        case "claim_dish":
        case "finalize_dish":
          return `${i.kind}:${i.dish.name}`;
        case "payment_due":
          return `payment_due:${i.toSubjectId}`;
        case "flag":
          return `flag:${i.title}`;
      }
    };
    expect(data.items.map(label)).toEqual([
      "use_soon:Curd", // expired yesterday
      "use_soon:Spinach", // use by today
      "claim_dish:Older dish", // oldest first
      "claim_dish:Newer dish",
      "finalize_dish:My lunch",
      "use_soon:Bread", // in two days
      `payment_due:${ANU}`,
      "flag:Milk run",
    ]);
    expect(data.counts).toEqual({ total: 8, claim_dish: 2, finalize_dish: 1, use_soon: 3, payment_due: 1, flag: 1 });
  });

  it("puts larger debts first", async () => {
    await paidFor(flat, ANU, 900, [RAHUL, ANU, DEV]);
    await paidFor(lunch, KIRAN, 5000, [RAHUL, KIRAN]);
    const due = ofKind(await inbox(RAHUL), "payment_due");
    expect(due.map((p) => [p.groupName, p.amountMinor])).toEqual([["Lunch club", 2500], ["Flat 4B", 300]]);
  });

  it("reads a bounded number of times however much there is: one membership hop, ten D1 reads and one per group, one names lookup", async () => {
    // Count every statement the worker prepares on D1.
    const real = h.env.PLATFORM_DB!;
    let statements = 0;
    (h.env as { PLATFORM_DB?: D1Database }).PLATFORM_DB = {
      prepare(query: string) {
        statements += 1;
        return real.prepare(query);
      },
      batch: (s: D1PreparedStatement[]) => real.batch(s),
    } as unknown as D1Database;
    const measure = async (): Promise<{ statements: number; groups: number; rosters: number; identity: number }> => {
      const before = { statements, groups: h.groupsCalls, rosters: h.rosterCalls, identity: h.identityCalls };
      await inbox(RAHUL);
      return {
        statements: statements - before.statements,
        groups: h.groupsCalls - before.groups,
        rosters: h.rosterCalls - before.rosters,
        identity: h.identityCalls - before.identity,
      };
    };

    await everything();
    const few = await measure();
    // Rahul is in two groups (Flat 4B, the Lunch club): 10 + 2.
    expect(few).toEqual({ statements: 12, groups: 1, rosters: 0, identity: 1 });

    // Much more of everything, in the same two groups: the same reads.
    for (let i = 0; i < 6; i++) {
      await myItem(RAHUL, { name: `Extra ${i}`, expiresOn: day(i % 3) });
      await cook(ANU, flat, { name: `Dish ${i}` });
      await cook(RAHUL, null, { name: `Snack ${i}` });
      const txn = await paidFor(flat, RAHUL, 300 + i * 30, [RAHUL, ANU, DEV], `Expense ${i}`);
      await flag(flat, txn, ANU);
    }
    expect(await measure()).toEqual(few);

    // A third group adds its one ledger read.
    const third = newGroup("Third");
    h.grant(RAHUL, third, "builder");
    expect((await measure()).statements).toBe(13);
  });
});

// ── The internal balance route ─────────────────────────────

describe("GET /v1/internal/kitchen/organizations/{org}/subjects/{usr}/balance", () => {
  const balancePath = (g: Group | string, subject: string) =>
    `/v1/internal/kitchen/organizations/${typeof g === "string" ? g : g.publicId}/subjects/${encodeURIComponent(subject)}/balance`;

  /** As membership-worker calls it: no actor, naming itself. */
  async function internal(path: string, method = "GET", headers: Record<string, string> = { [KITCHEN_INTERNAL_ACTOR_HEADER]: "membership-worker" }) {
    const res = await h.call(method, path, { as: null, headers });
    return { status: res.status, body: await envelope<SubjectBalanceResponse>(res) };
  }

  it("answers a person's balance in the group and its currency", async () => {
    await paidFor(flat, ANU, 3000, [RAHUL, ANU, DEV]);
    expect((await internal(balancePath(flat, RAHUL))).body.data).toEqual({ balanceMinor: -1000, currency: "INR" });
    expect((await internal(balancePath(flat, ANU))).body.data).toEqual({ balanceMinor: 2000, currency: "INR" });
    // Nobody with no money in it, a group with no ledger: zero.
    expect((await internal(balancePath(flat, VIEWER))).body.data).toEqual({ balanceMinor: 0, currency: "INR" });
    expect((await internal(balancePath(lunch, RAHUL))).body.data).toEqual({ balanceMinor: 0, currency: "INR" });
    // The group's UUID works as well as its org_ id.
    expect((await internal(balancePath(flat.id, ANU))).body.data.balanceMinor).toBe(2000);
  });

  it("is zero once the person has settled up", async () => {
    await paidFor(flat, ANU, 3000, [RAHUL, ANU, DEV]);
    await call("POST", groupPath(flat, "settlements"), RAHUL, { fromSubjectId: RAHUL, toSubjectId: ANU, amountMinor: 1000 });
    expect((await internal(balancePath(flat, RAHUL))).body.data.balanceMinor).toBe(0);
  });

  it("is a plain unknown route to anyone who does not name an internal caller — as api-edge would send it", async () => {
    const path = balancePath(flat, RAHUL);
    for (const headers of [{}, { [KITCHEN_INTERNAL_ACTOR_HEADER]: "api-edge" }, { [KITCHEN_INTERNAL_ACTOR_HEADER]: "" }]) {
      const res = await internal(path, "GET", headers);
      expect(res.status).toBe(404);
      expect(res.body.error).toMatchObject({ code: "not_found", message: `Route not found: ${path}` });
    }
    // Signed in, with the actor headers the edge forwards: still nothing there.
    const asMember = await h.call("GET", path, { as: RAHUL });
    expect(asMember.status).toBe(404);
    // Another method does not give the route away either.
    expect((await internal(path, "POST", {})).status).toBe(404);
    // What api-edge would forward for an encoded-slash path under /v1/kitchen/ is matched literally: no route.
    const encoded = `/v1/kitchen/me%2F..%2F..%2Finternal%2Fkitchen%2Forganizations%2F${flat.publicId}%2Fsubjects%2F${RAHUL}%2Fbalance`;
    expect((await h.call("GET", encoded, { as: RAHUL })).status).toBe(404);
  });

  it("405s another method from an internal caller, and 404s a malformed group or person", async () => {
    expect((await internal(balancePath(flat, RAHUL), "POST")).status).toBe(405);
    expect((await internal(balancePath("org_nope", RAHUL))).status).toBe(404);
    expect((await internal(balancePath(flat, "not a person!"))).status).toBe(404);
    expect((await internal(`/v1/internal/kitchen/organizations/${flat.publicId}/subjects/%E0%A4%A/balance`)).status).toBe(404);
  });

  it("is a 503 when the database is missing", async () => {
    h.close();
    h = createHarness({ env: { PLATFORM_DB: undefined } });
    expect((await internal(balancePath(flat, RAHUL))).status).toBe(503);
  });
});

// ── membership-worker's side of it ─────────────────────────

describe("membership-worker's balance client, against kitchen-worker's own router", () => {
  /** KITCHEN_WORKER as membership-worker holds it: a service binding straight into kitchen-worker's router. */
  function binding(): Fetcher {
    return {
      fetch: (input: string, init?: RequestInit) => route(new Request(input, init), h.env),
    } as unknown as Fetcher;
  }

  it("reads what leaving checks: the balance, signed, in the group's currency", async () => {
    await paidFor(flat, ANU, 3000, [RAHUL, ANU, DEV]);
    expect(await fetchKitchenBalance(binding(), flat.id, RAHUL, "req_leave")).toEqual({ ok: true, balanceMinor: -1000, currency: "INR" });
    expect(await fetchKitchenBalance(binding(), flat.id, ANU, "req_leave")).toEqual({ ok: true, balanceMinor: 2000, currency: "INR" });
    expect(await fetchKitchenBalance(binding(), flat.id, VIEWER, "req_leave")).toEqual({ ok: true, balanceMinor: 0, currency: "INR" });
  });

  it("cannot tell when kitchen-worker cannot answer", async () => {
    h.close();
    h = createHarness({ env: { PLATFORM_DB: undefined } });
    expect(await fetchKitchenBalance(binding(), flat.id, RAHUL, "req_leave")).toEqual({ ok: false });
    expect(await fetchKitchenBalance(undefined, flat.id, RAHUL, "req_leave")).toEqual({ ok: false });
  });
});
