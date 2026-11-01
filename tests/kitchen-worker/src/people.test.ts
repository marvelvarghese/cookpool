// People across groups (CP-9): GET /v1/kitchen/me/balances, the "why" view
// GET /v1/kitchen/me/people/{usr}, and a group's members by name
// (GET /v1/organizations/{org}/kitchen/members) — through the router, against
// real SQLite and the real policy grants, with names from identity's lookup.

import type {
  GroupMembersResponse,
  KitchenTxn,
  MyBalancesResponse,
  PersonViewResponse,
  SettlePlan,
} from "@saas/contracts/kitchen";
import { personView, settlePlan, type Txn } from "@saas/kitchen-engine/ledger";
import { shortcutStep } from "@kitchen-worker/people";
import { createHarness, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const BASE = Date.parse("2026-11-02T08:00:00.000Z");

const ME = "usr_rahul";
const ANU = "usr_anu";
const DEV = "usr_dev";
const MEERA = "usr_meera";
const KIRAN = "usr_kiran";
const VIEWER = "usr_viewer";
const OUTSIDER = "usr_outsider";

let h: Harness;
let flat: Group;
let lunch: Group;
let tick: number;

beforeEach(() => {
  tick = 0;
  h = createHarness({ deps: { now: () => new Date(BASE + (tick += 1) * 1000) } });
  flat = newGroup("Flat 4B");
  lunch = newGroup("Lunch club");
  for (const [who, role] of [[ME, "owner"], [ANU, "builder"], [DEV, "builder"], [MEERA, "builder"], [VIEWER, "viewer"]] as const) {
    h.grant(who, flat, role);
  }
  h.grant(ME, lunch, "builder");
  h.grant(KIRAN, lunch, "owner");
  h.grant(ANU, lunch, "builder");
  h.profile(ME, { displayName: "Rahul Varghese", email: "rahul@example.com" });
  h.profile(ANU, { displayName: "Anu", email: "anu.k@example.com" });
  h.profile(DEV, { displayName: null, email: "dev.patel@example.com" });
  h.profile(KIRAN, { displayName: "  Kiran  ", email: "kiran@example.com" });
});

afterEach(() => h.close());

const path = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

async function call<T>(method: string, url: string, as: string | null, body?: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

/** `payer` paid `amount` for `owers`, split equally between them. */
async function paidFor(g: Group, payer: string, amount: number, owers: string[], title = "Shopping"): Promise<KitchenTxn> {
  const { status, body } = await call<{ txn: KitchenTxn }>("POST", path(g, "expenses"), payer, {
    title,
    totalMinor: amount,
    payers: [{ subjectId: payer, amountMinor: amount }],
    mode: "equal",
    participants: owers.map((subjectId) => ({ subjectId })),
  });
  expect(status).toBe(201);
  return body.data.txn;
}

const myBalances = (as = ME) => call<MyBalancesResponse>("GET", "/v1/kitchen/me/balances", as);
const person = (id: string, as = ME) => call<PersonViewResponse>("GET", `/v1/kitchen/me/people/${encodeURIComponent(id)}`, as);
const members = (g: Group, as = ME) => call<GroupMembersResponse>("GET", path(g, "members"), as);
const plan = (g: Group) => call<SettlePlan>("GET", path(g, "settle-plan"), ME);

describe("GET /v1/kitchen/me/balances", () => {
  it("lists your groups by name with your balance, role and member count", async () => {
    await paidFor(flat, ME, 3000, [ME, ANU, DEV]);
    await paidFor(lunch, KIRAN, 1200, [ME, KIRAN, ANU]);
    const { status, body } = await myBalances();
    expect(status).toBe(200);
    expect(body.data.groups).toEqual([
      { orgId: flat.publicId, slug: flat.slug, name: "Flat 4B", currency: "INR", balanceMinor: 2000, role: "owner", memberCount: 5 },
      { orgId: lunch.publicId, slug: lunch.slug, name: "Lunch club", currency: "INR", balanceMinor: -400, role: "builder", memberCount: 3 },
    ]);
  });

  it("gives each person what each group's settle plan has between you, adding up to your balance there", async () => {
    await paidFor(flat, ME, 3000, [ME, ANU, DEV]);
    await paidFor(flat, ANU, 900, [DEV, MEERA, ANU]);
    await paidFor(lunch, KIRAN, 1200, [ME, KIRAN, ANU]);
    const { body } = await myBalances();
    const data = body.data;

    for (const g of [flat, lunch]) {
      const settle = (await plan(g)).body.data;
      const mine = data.groups.find((x) => x.orgId === g.publicId)!;
      let sum = 0;
      for (const p of data.people) {
        const net = p.groups.find((x) => x.orgId === g.publicId)?.netMinor;
        if (net === undefined) continue;
        const expected = settle.payments.reduce(
          (a, pay) => a + (pay.fromSubjectId === p.subjectId && pay.toSubjectId === ME ? pay.amountMinor : 0)
            - (pay.fromSubjectId === ME && pay.toSubjectId === p.subjectId ? pay.amountMinor : 0),
          0,
        );
        expect(net).toBe(expected);
        sum += net;
      }
      expect(sum).toBe(mine.balanceMinor);
    }
  });

  it("lists everyone you share a group with once, every shared group under them, largest amount first", async () => {
    await paidFor(flat, ME, 3000, [ME, ANU, DEV]);
    await paidFor(lunch, KIRAN, 1200, [ME, KIRAN, ANU]);
    const { body } = await myBalances();
    const people = body.data.people;
    expect(people.map((p) => p.subjectId)).toEqual([ANU, DEV, KIRAN, MEERA, VIEWER]);
    expect(people.find((p) => p.subjectId === ANU)!.groups).toEqual([
      { orgId: flat.publicId, slug: flat.slug, name: "Flat 4B", currency: "INR", netMinor: 1000 },
      { orgId: lunch.publicId, slug: lunch.slug, name: "Lunch club", currency: "INR", netMinor: 0 },
    ]);
    expect(people.find((p) => p.subjectId === KIRAN)!.groups).toEqual([
      { orgId: lunch.publicId, slug: lunch.slug, name: "Lunch club", currency: "INR", netMinor: -400 },
    ]);
    // Settled people are listed too, at zero.
    expect(people.find((p) => p.subjectId === MEERA)!.groups[0]!.netMinor).toBe(0);
  });

  it("names people from identity: their name, else their email up to the @, else nothing", async () => {
    const { body } = await myBalances();
    const names = Object.fromEntries(body.data.people.map((p) => [p.subjectId, p.displayName]));
    expect(names).toEqual({ [ANU]: "Anu", [DEV]: "dev.patel", [KIRAN]: "Kiran", [MEERA]: null, [VIEWER]: null });
    expect(h.identityCalls).toBe(1);
  });

  it("still answers when identity cannot be read, without names", async () => {
    h.failIdentity = true;
    const { status, body } = await myBalances();
    expect(status).toBe(200);
    expect(body.data.people.every((p) => p.displayName === null)).toBe(true);
  });

  it("keeps currencies apart: totals per currency, never added across", async () => {
    const trip = newGroup("Goa trip");
    h.grant(ME, trip, "owner");
    h.grant(DEV, trip, "builder");
    expect((await call("PATCH", path(trip, "settings"), ME, { currency: "USD" })).status).toBe(200);
    await paidFor(trip, DEV, 5000, [ME, DEV]);
    await paidFor(flat, ME, 3000, [ME, ANU, DEV]);
    await paidFor(lunch, KIRAN, 1200, [ME, KIRAN, ANU]);

    const { body } = await myBalances();
    expect(body.data.totals).toEqual([
      { currency: "INR", owedToYouMinor: 2000, youOweMinor: 400, netMinor: 1600 },
      { currency: "USD", owedToYouMinor: 0, youOweMinor: 2500, netMinor: -2500 },
    ]);
    const dev = body.data.people.find((p) => p.subjectId === DEV)!;
    expect(dev.groups.map((g) => [g.name, g.currency, g.netMinor])).toEqual([
      ["Flat 4B", "INR", 1000],
      ["Goa trip", "USD", -2500],
    ]);
    // Dev's largest amount (US$25.00) puts him first, whatever the currency.
    expect(body.data.people[0]!.subjectId).toBe(DEV);
  });

  it("keeps someone who left with money still open, under the group it is in", async () => {
    await paidFor(flat, ME, 3000, [ME, ANU, DEV]);
    h.revoke(DEV, flat);
    const { body } = await myBalances();
    expect(body.data.groups[0]!.memberCount).toBe(4);
    expect(body.data.people.find((p) => p.subjectId === DEV)!.groups).toEqual([
      { orgId: flat.publicId, slug: flat.slug, name: "Flat 4B", currency: "INR", netMinor: 1000 },
    ]);
  });

  it("shows a viewer their role, and is empty for someone in no group", async () => {
    const viewer = await myBalances(VIEWER);
    expect(viewer.body.data.groups.map((g) => g.role)).toEqual(["viewer"]);
    const nobody = await myBalances(OUTSIDER);
    expect(nobody.status).toBe(200);
    expect(nobody.body.data).toEqual({ groups: [], people: [], totals: [] });
  });

  it("reads each group's roster once, and is a 503 when membership cannot be read", async () => {
    await myBalances();
    expect(h.rosterCalls).toBe(2);
    expect(h.groupsCalls).toBe(1);
    h.failGroups = true;
    expect((await myBalances()).status).toBe(503);
  });

  it("needs an actor and answers GET only", async () => {
    expect((await call("GET", "/v1/kitchen/me/balances", null)).status).toBe(401);
    expect((await call("POST", "/v1/kitchen/me/balances", ME, {})).status).toBe(405);
  });
});

describe("GET /v1/kitchen/me/people/{usr}", () => {
  /** Dev owes Anu ₹90.00, and Anu owes you ₹90.00: the plan has Dev pay you. */
  async function chain() {
    await paidFor(flat, ANU, 9000, [DEV], "Dev's groceries");
    await paidFor(flat, ME, 9000, [ANU], "Anu's gas bill");
  }

  it("shows the group shortcut for a three-person chain, from either end", async () => {
    await chain();
    const dev = (await person(DEV)).body.data;
    expect(dev.displayName).toBe("dev.patel");
    const flatForDev = dev.groups.find((g) => g.orgId === flat.publicId)!;
    expect(flatForDev).toMatchObject({ lines: [], pairwiseMinor: 0, planMinor: 9000, shortcutMinor: 9000 });
    expect(flatForDev.shortcutVia).toEqual({
      fromSubjectId: DEV, viaSubjectId: ANU, toSubjectId: ME, amountMinor: 9000, thirdDisplayName: "Anu",
    });

    const anu = (await person(ANU)).body.data;
    const flatForAnu = anu.groups.find((g) => g.orgId === flat.publicId)!;
    expect(flatForAnu).toMatchObject({ pairwiseMinor: 9000, planMinor: 0, shortcutMinor: -9000 });
    expect(flatForAnu.lines.map((l) => [l.title, l.signedMinor])).toEqual([["Anu's gas bill", 9000]]);
    // Anu pays you nothing because Dev pays you directly.
    expect(flatForAnu.shortcutVia).toEqual({
      fromSubjectId: DEV, viaSubjectId: ANU, toSubjectId: ME, amountMinor: 9000, thirdDisplayName: "dev.patel",
    });
  });

  it("explains every amount between you two, newest first, signed from your side", async () => {
    const dinner = await paidFor(flat, ME, 3000, [ME, ANU, DEV], "Dinner");
    await paidFor(flat, ANU, 1200, [ME, ANU], "Milk");
    const reversed = await call<{ txn: KitchenTxn }>("POST", path(flat, `txns/${dinner.id}/reverse`), ME, {});
    expect(reversed.status).toBe(201);

    const view = (await person(ANU)).body.data.groups.find((g) => g.orgId === flat.publicId)!;
    expect(view.lines.map((l) => ({ kind: l.kind, title: l.title, signedMinor: l.signedMinor, reversed: l.reversed }))).toEqual([
      { kind: "reversal", title: reversed.body.data.txn.title, signedMinor: -1000, reversed: false },
      { kind: "expense", title: "Milk", signedMinor: -600, reversed: false },
      { kind: "expense", title: "Dinner", signedMinor: 1000, reversed: true },
    ]);
    expect(view.lines[0]!.reverses).toBe(dinner.id);
    expect(view.lines[2]!.txnId).toBe(dinner.id);
    expect(view.pairwiseMinor).toBe(-600);
    expect(view.planMinor).toBe(view.pairwiseMinor + view.shortcutMinor);
    expect(view.role).toBe("owner");
  });

  it("covers every group you share, with totals per currency", async () => {
    await paidFor(flat, ME, 3000, [ME, ANU, DEV]);
    await paidFor(lunch, ANU, 1200, [ME, KIRAN, ANU]);
    const { status, body } = await person(ANU);
    expect(status).toBe(200);
    expect(body.data.subjectId).toBe(ANU);
    expect(body.data.displayName).toBe("Anu");
    expect(body.data.groups.map((g) => [g.name, g.planMinor, g.role])).toEqual([
      ["Flat 4B", 1000, "owner"],
      ["Lunch club", -400, "builder"],
    ]);
    expect(body.data.totals).toEqual([{ currency: "INR", netMinor: 600 }]);
  });

  it("includes a group the person left while money is still open between you", async () => {
    await paidFor(flat, ME, 3000, [ME, ANU, DEV]);
    h.revoke(DEV, flat);
    const { status, body } = await person(DEV);
    expect(status).toBe(200);
    expect(body.data.groups.map((g) => [g.name, g.planMinor])).toEqual([["Flat 4B", 1000]]);
  });

  it("is a 404 for someone you share no group with, for yourself, and for an id that cannot be anyone", async () => {
    expect((await person(OUTSIDER)).status).toBe(404);
    expect((await person(KIRAN, DEV)).status).toBe(404);
    expect((await person(ME)).status).toBe(404);
    expect((await person("usr_a/b")).status).toBe(404);
    expect((await person(ANU, OUTSIDER)).status).toBe(404);
  });

  it("is someone you share a group with even before any money moves", async () => {
    const { status, body } = await person(MEERA);
    expect(status).toBe(200);
    expect(body.data.groups).toEqual([
      expect.objectContaining({ orgId: flat.publicId, lines: [], pairwiseMinor: 0, planMinor: 0, shortcutMinor: 0, shortcutVia: null }),
    ]);
  });
});

describe("the group shortcut, step by step", () => {
  /** `payer` paid `amount` for `ower` alone. */
  const owes = (id: string, ower: string, payer: string, amount: number): Txn => ({
    id, kind: "expense", title: id, totalMinor: amount,
    splits: [{ subjectId: payer, paidMinor: amount, owedMinor: 0 }, { subjectId: ower, paidMinor: 0, owedMinor: amount }],
  });
  const step = (txns: Txn[], other: string) =>
    shortcutStep(txns, settlePlan(txns).payments, ME, other, personView(txns, ME, other).shortcutMinor);

  it("has you pay across when you owe someone who owes them", () => {
    // You owe Anu ₹50.00 and Anu owes Dev ₹50.00: you pay Dev.
    const txns = [owes("t1", ME, ANU, 5000), owes("t2", ANU, DEV, 5000)];
    expect(personView(txns, ME, DEV).shortcutMinor).toBe(-5000);
    expect(step(txns, DEV)).toEqual({ fromSubjectId: ME, viaSubjectId: ANU, toSubjectId: DEV, amountMinor: 5000, thirdId: ANU });
    // Seen from Anu, the same step is why you pay Anu nothing.
    expect(step(txns, ANU)).toEqual({ fromSubjectId: ME, viaSubjectId: ANU, toSubjectId: DEV, amountMinor: 5000, thirdId: DEV });
  });

  it("is nothing when the plan is what you two owe each other", () => {
    const txns = [owes("t1", ANU, ME, 5000)];
    expect(personView(txns, ME, ANU).shortcutMinor).toBe(0);
    expect(step(txns, ANU)).toBeNull();
  });
});

describe("GET …/kitchen/members", () => {
  it("lists every member by name and role, with the mem_ id an owner changes roles with — for viewers too", async () => {
    const { status, body } = await members(flat, VIEWER);
    expect(status).toBe(200);
    expect(body.data.members).toEqual(
      expect.arrayContaining([
        { subjectId: ME, displayName: "Rahul Varghese", role: "owner", memberId: `mem_${ME}`, joinedAt: "2026-11-01T00:00:00.000Z" },
        { subjectId: DEV, displayName: "dev.patel", role: "builder", memberId: `mem_${DEV}`, joinedAt: "2026-11-01T00:00:00.000Z" },
        { subjectId: VIEWER, displayName: null, role: "viewer", memberId: `mem_${VIEWER}`, joinedAt: "2026-11-01T00:00:00.000Z" },
      ]),
    );
    expect(body.data.members).toHaveLength(5);
    expect(h.decisions.at(-1)!.request.action).toBe("kitchen.pantry.read");
  });

  it("is the opaque 404 outside the group", async () => {
    expect((await members(flat, KIRAN)).status).toBe(404);
  });
});
