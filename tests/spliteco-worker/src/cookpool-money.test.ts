/* eslint-disable @typescript-eslint/no-explicit-any -- loose reads of JSON envelopes in tests */
// SE3 (SE-4): Cookpool's money runs on Spliteco. Cookpool's Money tab adds
// bills and settles up through spliteco-worker with `bucket: "kitchen"`; it
// reads a kitchen group as `?bucket=kitchen`, which never carries Other; a
// payment made in either app shows in both; a Spliteco payment fills Kitchen
// first; groups made in Spliteco never reach Cookpool's lists; and leaving a
// kitchen is refused while either balance is open. Through spliteco-worker's
// real router, beside the real kitchen-worker and membership-worker, over one
// SQLite database.

import type { BalancesResponse, MyBalancesResponse } from "@saas/contracts/kitchen";
import type { SplitecoExpenseRequest, SplitecoGroupResponse, SplitecoGroupsResponse, SplitecoSettlePlanResponse, SplitecoSettlementResponse, SplitecoWriteResponse } from "@saas/contracts/spliteco";
import { ANU, DEV, ME, add, envelope, equal, key, world } from "./helpers.js";
import type { Group, Harness } from "./harness.js";

const post = (h: Harness, path: string, body: unknown, as = ME, k = key()) => h.call("POST", path, { as, body, headers: { "idempotency-key": k } });
const read = async <T>(h: Harness, path: string, as = ME) => envelope<T>(await h.call("GET", path, { as }));

/** A kitchen group as Cookpool's Money tab reads it. */
const kitchenGroup = async (h: Harness, g: Group, as = ME) => read<SplitecoGroupResponse>(h, `/v1/spliteco/groups/${g.publicId}?bucket=kitchen`, as);
/** kitchen-worker's balances for the group: what the rest of Cookpool shows. */
const cookpool = async (h: Harness, g: Group, as = ME) =>
  Object.fromEntries(
    (await envelope<BalancesResponse>(await h.kitchen("GET", `/v1/organizations/${g.publicId}/kitchen/balances`, { as }))).data.balances.map((b) => [b.subjectId, b.balanceMinor]),
  );
/** A bill added in Cookpool's Money tab. */
const bill = (h: Harness, g: Group, body: SplitecoExpenseRequest, as = ME) => post(h, `/v1/spliteco/groups/${g.publicId}/expenses`, { ...body, bucket: "kitchen" }, as);
const pay = (h: Harness, g: Group, body: Record<string, unknown>, as = ME) => post(h, `/v1/spliteco/groups/${g.publicId}/settlements`, body, as);
const rows = (h: Harness, sql: string) => h.db.prepare(sql).all();

/** The flat with Kitchen: I owe Anu ₹100. Other (added in Spliteco): I owe Anu ₹4,000 rent. */
async function flatWithBoth() {
  const w = world();
  const k = await bill(w.h, w.flat, equal(20000, ANU, [ME, ANU]), ANU);
  expect(k.status).toBe(201);
  await add(w.h, w.flat, equal(800000, ANU, [ME, ANU], { title: "Rent", category: "bills" }), ANU);
  return w;
}

describe("a bill added in Cookpool's Money tab", () => {
  it("is Cookpool's row on the Kitchen balance, and kitchen-worker counts it", async () => {
    const { h, flat } = world();
    const res = await bill(h, flat, equal(30000, ME, [ME, ANU, DEV], { title: "Gas cylinder", category: null }));
    expect(res.status).toBe(201);
    const expense = (await envelope<SplitecoWriteResponse>(res)).data.expense;
    expect(expense).toMatchObject({ app: "cookpool", bucket: "kitchen", locked: true });
    expect(await cookpool(h, flat)).toEqual({ [ME]: 20000, [ANU]: -10000, [DEV]: -10000 });
    // Cookpool's row: Spliteco reads it but doesn't change it.
    const edit = await h.call("DELETE", `/v1/spliteco/expenses/${expense.id}`, { as: ME, headers: { "idempotency-key": key() } });
    expect(edit.status).toBe(409);
    expect((await envelope(edit)).error.details.reason).toBe("owned_by_cookpool");
    // The people on it are told, as for any bill spliteco-worker writes.
    expect(h.sent.filter((s) => s.body.templateKey === "spliteco.expense_for_you").map((s) => s.body.recipient.subjectId).sort()).toEqual([ANU, DEV].sort());
  });

  it("is refused in a group made in Spliteco, and from an assistant", async () => {
    const { h, goa } = world();
    const res = await bill(h, goa, equal(1000, ME, [ME, ANU]));
    expect(res.status).toBe(422);
    expect((await envelope(res)).error.details.fields).toHaveProperty(["bucket"]);
    expect((await post(h, `/v1/spliteco/groups/${goa.publicId}/expenses`, { ...equal(1000, ME, [ME, ANU]), bucket: "nope" })).status).toBe(422);
  });
});

describe("Cookpool's view of a kitchen group (?bucket=kitchen)", () => {
  it("carries the Kitchen balance only: no Other rows, balances, plan or bucket", async () => {
    const { h, flat } = await flatWithBoth();
    const g = (await kitchenGroup(h, flat)).data;
    expect(g.balances.find((b) => b.subjectId === ME)?.balanceMinor).toBe(-10000);
    expect(g.plan).toEqual([{ fromSubjectId: ME, toSubjectId: ANU, amountMinor: 10000 }]);
    expect(g.buckets!.map((b) => b.bucket)).toEqual(["kitchen"]);
    expect(g.expenses.map((e) => e.bucket)).toEqual(["kitchen"]);
    expect(g.group.myBalanceMinor).toBe(-10000);
    expect(g.group.myBuckets).toEqual({ kitchen: -10000, other: 0 });
    expect(JSON.stringify(g)).not.toContain("Rent");
    // The same Kitchen number kitchen-worker gives the rest of Cookpool.
    expect((await cookpool(h, flat))[ME]).toBe(-10000);
    // Spliteco's own read has both, labelled.
    const full = (await read<SplitecoGroupResponse>(h, `/v1/spliteco/groups/${flat.publicId}`)).data;
    expect(full.group.myBuckets).toEqual({ kitchen: -10000, other: -400000 });
  });

  it("the settle plan too", async () => {
    const { h, flat } = await flatWithBoth();
    const plan = (await read<SplitecoSettlePlanResponse>(h, `/v1/spliteco/groups/${flat.publicId}/settle-plan?bucket=kitchen`)).data;
    expect(plan.buckets.map((b) => b.bucket)).toEqual(["kitchen"]);
    expect(plan.mine).toEqual([{ toSubjectId: ANU, owed: { kitchen: 10000, other: 0 } }]);
  });

  it("a group made in Spliteco is not found there", async () => {
    const { h, goa } = world();
    expect((await kitchenGroup(h, goa)).error?.code).toBe("not_found");
    expect((await h.call("GET", `/v1/spliteco/groups/${goa.publicId}/settle-plan?bucket=kitchen`, { as: ME })).status).toBe(404);
  });
});

describe("a payment made in Cookpool's Money tab", () => {
  it("pays Kitchen only, as Cookpool's row, and shows in both apps", async () => {
    const { h, flat } = await flatWithBoth();
    const res = await pay(h, flat, { toSubjectId: ANU, amountMinor: 10000, method: "cash", bucket: "kitchen" });
    expect(res.status).toBe(201);
    const payment = (await envelope<SplitecoSettlementResponse>(res)).data.payment;
    expect(payment.parts).toEqual([{ txnId: payment.id, bucket: "kitchen", amountMinor: 10000 }]);
    expect(rows(h, "SELECT app, bucket FROM kitchen_txns WHERE kind = 'settlement'")).toEqual([{ app: "cookpool", bucket: "kitchen" }]);
    // Cookpool: settled. Spliteco: Kitchen settled, Other untouched.
    expect((await cookpool(h, flat))[ME]).toBe(0);
    const full = (await read<SplitecoGroupResponse>(h, `/v1/spliteco/groups/${flat.publicId}`)).data;
    expect(full.group.myBuckets).toEqual({ kitchen: 0, other: -400000 });
    expect(full.expenses.some((e) => e.kind === "settlement" && e.bucket === "kitchen")).toBe(true);
  });

  it("never pays more than Kitchen, even with Other owed to the same person (422 over_settled)", async () => {
    const { h, flat } = await flatWithBoth();
    const res = await pay(h, flat, { toSubjectId: ANU, amountMinor: 10001, method: "upi", bucket: "kitchen" });
    expect(res.status).toBe(422);
    expect((await envelope(res)).error.details).toMatchObject({ reason: "over_settled", owed: { kitchen: 10000, other: 0 }, owedMinor: 10000 });
    expect(rows(h, "SELECT id FROM kitchen_txns WHERE kind = 'settlement'")).toEqual([]);
  });

  it("is 409 nothing_owed with no Kitchen debt, and refuses a split or a Spliteco group", async () => {
    const { h, flat, goa } = world();
    await add(h, flat, equal(10000, ANU, [ME, ANU]), ANU); // Other only
    const none = await pay(h, flat, { toSubjectId: ANU, amountMinor: 100, method: "cash", bucket: "kitchen" });
    expect(none.status).toBe(409);
    expect((await envelope(none)).error.details.reason).toBe("nothing_owed");
    expect((await pay(h, flat, { toSubjectId: ANU, amountMinor: 100, method: "cash", bucket: "kitchen", split: { kitchen: 100 } })).status).toBe(422);
    expect((await pay(h, goa, { toSubjectId: ANU, amountMinor: 100, method: "cash", bucket: "kitchen" })).status).toBe(422);
  });
});

describe("a payment made in Spliteco", () => {
  it("settles Kitchen first, and Cookpool sees the Kitchen part", async () => {
    const { h, flat } = await flatWithBoth();
    const res = await pay(h, flat, { toSubjectId: ANU, amountMinor: 50000, method: "upi" });
    expect(res.status).toBe(201);
    const payment = (await envelope<SplitecoSettlementResponse>(res)).data.payment;
    expect(payment.parts.map((p) => [p.bucket, p.amountMinor])).toEqual([
      ["kitchen", 10000],
      ["other", 40000],
    ]);
    expect((await cookpool(h, flat))[ME]).toBe(0);
    expect((await kitchenGroup(h, flat)).data.expenses.filter((e) => e.kind === "settlement").map((e) => e.totalMinor)).toEqual([10000]);
  });

  it("a payment recorded through kitchen-worker shows in Spliteco", async () => {
    const { h, flat } = await flatWithBoth();
    const res = await h.kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/settlements`, {
      as: ME,
      body: { fromSubjectId: ME, toSubjectId: ANU, amountMinor: 4000, method: "cash" },
      headers: { "idempotency-key": key() },
    });
    expect(res.status).toBe(201);
    const full = (await read<SplitecoGroupResponse>(h, `/v1/spliteco/groups/${flat.publicId}`)).data;
    expect(full.group.myBuckets).toEqual({ kitchen: -6000, other: -400000 });
  });
});

describe("groups made in Spliteco never reach Cookpool; Cookpool's kitchens are in Spliteco", () => {
  it("Cookpool's group list and kitchen-worker's reads leave them out", async () => {
    const { h, flat, goa } = world();
    await add(h, goa, equal(9000, ME, [ME, ANU, DEV]));
    const list = (await envelope<any>(await h.membership("GET", "/v1/organizations", { as: ME }))).data.organizations.map((o: { id: string }) => o.id);
    expect(list).toEqual([flat.publicId]);
    const mine = (await envelope<MyBalancesResponse>(await h.kitchen("GET", "/v1/kitchen/me/balances", { as: ME }))).data;
    expect(mine.groups.map((g) => g.orgId)).toEqual([flat.publicId]);
    // Spliteco lists both, the kitchen without anyone syncing it.
    const groups = (await read<SplitecoGroupsResponse>(h, "/v1/spliteco/me/groups")).data.groups;
    expect(groups.map((g) => [g.id, g.madeIn]).sort()).toEqual([
      [flat.publicId, "cookpool"],
      [goa.publicId, "spliteco"],
    ].sort());
  });

  it("a new Cookpool kitchen appears in Spliteco by itself", async () => {
    const { h } = world();
    const made = await h.membership("POST", "/v1/organizations", { as: ME, body: { name: "Sunday cook club", slug: `sunday-${Date.now()}` } });
    expect(made.status).toBe(201);
    const id = (await envelope<any>(made)).data.organization.id as string;
    const groups = (await read<SplitecoGroupsResponse>(h, "/v1/spliteco/me/groups")).data.groups;
    expect(groups.find((g) => g.id === id)).toMatchObject({ madeIn: "cookpool", kind: "kitchen" });
  });
});

describe("leaving a kitchen while either balance is open is refused", () => {
  const leave = (h: Harness, g: Group, as: string) => h.membership("POST", `/v1/organizations/${g.publicId}/leave`, { as, headers: { "idempotency-key": key() } });

  it("Other only (added in Spliteco, which Cookpool doesn't show) is still refused", async () => {
    const { h, flat } = world();
    await add(h, flat, equal(10000, ANU, [DEV, ANU]), ANU);
    expect((await cookpool(h, flat))[DEV]).toBe(0);
    const res = await leave(h, flat, DEV);
    expect(res.status).toBe(409);
    expect((await envelope(res)).error.details).toEqual({ reason: "balance_not_settled", balanceMinor: 0, otherMinor: -5000, currency: "INR" });
  });

  it("Kitchen only is refused; both settled, the leave goes through", async () => {
    const { h, flat } = world();
    await bill(h, flat, equal(10000, ANU, [DEV, ANU]), ANU);
    expect((await leave(h, flat, DEV)).status).toBe(409);
    expect((await pay(h, flat, { toSubjectId: ANU, amountMinor: 5000, method: "cash", bucket: "kitchen" }, DEV)).status).toBe(201);
    expect((await leave(h, flat, DEV)).status).toBe(200);
  });
});
