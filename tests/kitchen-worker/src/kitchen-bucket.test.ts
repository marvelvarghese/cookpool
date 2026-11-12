// Cookpool's money is the Kitchen balance (cookpool-spliteco SE3, design
// §0.11): every ledger read kitchen-worker makes counts only rows with
// `bucket = 'kitchen'` — balances, the settle plan, people and their "why",
// the inbox's payments due, activity and the transaction reads — while a row
// added to the same group in Spliteco (`bucket = 'other'`) stays Spliteco's.
// A payment recorded here pays Kitchen only and never more than it; the leave
// check's internal read answers both balances; and the uses, dishes and waste
// Cookpool posts carry item rows. Through the router, over real SQLite.

import { KITCHEN_INTERNAL_ACTOR_HEADER, type ActivityPage, type BalancesResponse, type InboxResponse, type KitchenTxn, type MyBalancesResponse, type PersonViewResponse, type SettlePlan, type SubjectBalanceResponse } from "@saas/contracts/kitchen";
import { randomUUID } from "node:crypto";
import { createHarness, envelope, newGroup, seedDebt, type Envelope, type Group, type Harness } from "./harness.js";

const NOW = new Date("2026-11-12T09:00:00.000Z");
const RAHUL = "usr_rahul";
const ANU = "usr_anu";
const DEV = "usr_dev";

let h: Harness;
let flat: Group;

beforeEach(() => {
  h = createHarness({ deps: { now: () => NOW } });
  flat = newGroup("Flat 4B");
  h.grant(RAHUL, flat, "owner");
  h.grant(ANU, flat, "builder");
  h.grant(DEV, flat, "builder");
});

afterEach(() => h.close());

async function call<T>(method: string, path: string, as: string | null, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, path, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}
const org = (rest: string) => `/v1/organizations/${flat.publicId}/kitchen/${rest}`;

/**
 * A row as spliteco-worker writes one into a kitchen group (app spliteco,
 * bucket other): `payer` paid `amount`, `debtor` owes all of it. Returns its
 * public id.
 */
function spliteco(payer: string, debtor: string, amountMinor: number, bucket: "kitchen" | "other" = "other", kind = "expense"): string {
  const id = randomUUID();
  h.db.prepare(
    `INSERT INTO kitchen_group_settings (org_id, currency, created_at, updated_at) VALUES (?, 'INR', ?, ?) ON CONFLICT (org_id) DO NOTHING`,
  ).run(flat.id, NOW.toISOString(), NOW.toISOString());
  h.db.prepare(
    `INSERT INTO kitchen_txns (id, org_id, kind, title, total_minor, currency, occurred_at, created_by, idem_key, created_at, app, bucket)
     VALUES (?, ?, ?, 'Rent', ?, 'INR', ?, ?, ?, ?, 'spliteco', ?)`,
  ).run(id, flat.id, kind, amountMinor, NOW.toISOString(), payer, `k-${id}`, NOW.toISOString(), bucket);
  h.db.prepare(`INSERT INTO kitchen_txn_splits (txn_id, subject_id, position, paid_minor, owed_minor) VALUES (?, ?, 0, ?, 0)`).run(id, payer, amountMinor);
  h.db.prepare(`INSERT INTO kitchen_txn_splits (txn_id, subject_id, position, paid_minor, owed_minor) VALUES (?, ?, 1, 0, ?)`).run(id, debtor, amountMinor);
  return `txn_${id.replace(/-/g, "")}`;
}

describe("every kitchen-worker read counts the Kitchen balance only", () => {
  beforeEach(async () => {
    // Kitchen: Dev owes Anu ₹100. Other (added in Spliteco): Dev owes Rahul ₹4,000 rent.
    await seedDebt(h, flat, DEV, ANU, 10000);
    spliteco(RAHUL, DEV, 400000);
  });

  it("balances and the settle plan", async () => {
    const balances = await call<BalancesResponse>("GET", org("balances"), RAHUL);
    expect(Object.fromEntries(balances.body.data.balances.map((b) => [b.subjectId, b.balanceMinor]))).toEqual({ [ANU]: 10000, [RAHUL]: 0, [DEV]: -10000 });
    const plan = await call<SettlePlan>("GET", org("settle-plan"), RAHUL);
    expect(plan.body.data.payments).toEqual([{ fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 10000 }]);
  });

  it("people across groups, and a person's why", async () => {
    const mine = await call<MyBalancesResponse>("GET", "/v1/kitchen/me/balances", DEV);
    expect(mine.body.data.groups.map((g) => g.balanceMinor)).toEqual([-10000]);
    expect(mine.body.data.totals).toEqual([expect.objectContaining({ currency: "INR", netMinor: -10000 })]);
    expect(mine.body.data.people.map((p) => p.subjectId).sort()).toEqual([ANU, RAHUL].sort());
    // Rahul and Dev have only Other money between them: nothing in Cookpool.
    const rahul = await call<PersonViewResponse>("GET", `/v1/kitchen/me/people/${RAHUL}`, DEV);
    expect(rahul.body.data.totals.every((t) => t.netMinor === 0)).toBe(true);
    const anu = await call<PersonViewResponse>("GET", `/v1/kitchen/me/people/${ANU}`, DEV);
    expect(anu.body.data.totals).toEqual([expect.objectContaining({ currency: "INR", netMinor: -10000 })]);
  });

  it("the inbox's payments due", async () => {
    const inbox = await call<InboxResponse>("GET", "/v1/kitchen/me/inbox", DEV);
    const due = inbox.body.data.items.filter((i) => i.kind === "payment_due");
    expect(due).toEqual([expect.objectContaining({ toSubjectId: ANU, amountMinor: 10000 })]);
  });

  it("activity, and the transaction reads behind reverse and flag", async () => {
    const page = await call<ActivityPage>("GET", org("activity"), RAHUL);
    expect(page.body.data.items.map((t) => t.title)).toEqual(["Groceries"]);
    const other = spliteco(RAHUL, DEV, 5000);
    expect((await call("POST", org(`txns/${other}/reverse`), RAHUL, {})).status).toBe(404);
    expect((await call("POST", org(`txns/${other}/flags`), DEV, { reason: "Not mine" })).status).toBe(404);
  });

  it("refuses to reverse a payment Spliteco recorded (409 owned_by_spliteco): it is undone there", async () => {
    const paid = spliteco(DEV, ANU, 10000, "kitchen", "settlement");
    const res = await call("POST", org(`txns/${paid}/reverse`), DEV, {});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "conflict", details: { reason: "owned_by_spliteco" } });
  });

  it("a payment Spliteco recorded on the Kitchen balance shows here", async () => {
    spliteco(DEV, ANU, 4000, "kitchen", "settlement");
    const balances = await call<BalancesResponse>("GET", org("balances"), RAHUL);
    expect(balances.body.data.balances.find((b) => b.subjectId === DEV)?.balanceMinor).toBe(-6000);
  });

  it("the leave check's internal read answers both balances", async () => {
    const path = (who: string) => `/v1/internal/kitchen/organizations/${flat.publicId}/subjects/${who}/balance`;
    const read = async (who: string) =>
      (await call<SubjectBalanceResponse>("GET", path(who), null, undefined, { [KITCHEN_INTERNAL_ACTOR_HEADER]: "membership-worker" })).body.data;
    expect(await read(DEV)).toEqual({ balanceMinor: -10000, otherMinor: -400000, currency: "INR" });
    expect(await read(RAHUL)).toEqual({ balanceMinor: 0, otherMinor: 400000, currency: "INR" });
    expect(await read(ANU)).toEqual({ balanceMinor: 10000, otherMinor: 0, currency: "INR" });
  });
});

describe("a payment recorded in Cookpool pays Kitchen only, never more than it", () => {
  const pay = (as: string, body: Record<string, unknown>, headers?: Record<string, string>) =>
    call<{ txn: KitchenTxn }>("POST", org("settlements"), as, { method: "cash", ...body }, headers);

  beforeEach(async () => {
    await seedDebt(h, flat, DEV, ANU, 10000);
    // Dev also owes Anu ₹500 in Other: a Cookpool payment can't reach it.
    spliteco(ANU, DEV, 50000);
  });

  it("is written on the Kitchen balance", async () => {
    const res = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 10000 });
    expect(res.status).toBe(201);
    expect(h.db.prepare("SELECT bucket, app FROM kitchen_txns WHERE kind = 'settlement'").all()).toEqual([{ bucket: "kitchen", app: "cookpool" }]);
  });

  it("is 422 over_settled for more than the Kitchen balance, with the cap", async () => {
    const res = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 10001 });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual({ reason: "over_settled", capMinor: 10000, currency: "INR" });
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_txns WHERE kind = 'settlement'").get()).toEqual({ n: 0 });
  });

  it("can't flip either person: nothing between two people who are both owed, or paying the wrong way", async () => {
    expect((await pay(ANU, { fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 1 })).body.error.details).toMatchObject({ reason: "over_settled", capMinor: 0 });
    expect((await pay(RAHUL, { fromSubjectId: RAHUL, toSubjectId: ANU, amountMinor: 1 })).status).toBe(422);
  });

  it("a retry of a payment that landed answers it again, not as over the balance", async () => {
    const headers = { "idempotency-key": "pay-1" };
    const first = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 10000 }, headers);
    const again = await pay(DEV, { fromSubjectId: DEV, toSubjectId: ANU, amountMinor: 10000 }, headers);
    expect(again.status).toBe(201);
    expect(again.body.data.txn.id).toBe(first.body.data.txn.id);
  });
});

describe("uses, dishes and waste carry item rows", () => {
  const items = () => h.db.prepare("SELECT name, qty, unit_minor, total_minor FROM ledger_txn_items ORDER BY txn_id, position").all();
  const shares = () => h.db.prepare("SELECT subject_id, mode, value FROM ledger_txn_item_shares ORDER BY subject_id").all();

  async function milk(): Promise<{ id: string }> {
    const res = await call<{ item: { id: string } }>("POST", org("items"), ANU, { name: "Milk", category: "Dairy", quantity: "1", unit: "L", priceMinor: 6000 });
    expect(res.status).toBe(201);
    return res.body.data.item;
  }

  it("a use: one item, each consumer's exact share, adding up to its cost", async () => {
    const item = await milk();
    const used = await call<{ txn: KitchenTxn | null }>("POST", org(`items/${item.id}/uses`), RAHUL, { quantity: "500", unit: "ml", consumers: [RAHUL, DEV] });
    expect(used.status).toBe(201);
    const txn = used.body.data.txn!;
    expect(items()).toEqual([{ name: txn.title, qty: 1, unit_minor: null, total_minor: txn.totalMinor }]);
    const owed = txn.splits.filter((s) => s.owedMinor > 0).map((s) => ({ subject_id: s.subjectId, mode: "exact", value: s.owedMinor }));
    expect(shares()).toEqual(owed.sort((a, b) => (a.subject_id < b.subject_id ? -1 : 1)));
    // Its reversal writes no items of its own.
    expect((await call("POST", org(`txns/${txn.id}/reverse`), RAHUL, {})).status).toBe(201);
    expect(items()).toHaveLength(1);
  });

  it("waste: one item, split as the group's rule says", async () => {
    const item = await milk();
    const wasted = await call<{ txn: KitchenTxn | null }>("POST", org(`items/${item.id}/waste`), ANU, {});
    expect(wasted.status).toBe(201);
    expect(items()).toEqual([expect.objectContaining({ total_minor: wasted.body.data.txn!.totalMinor })]);
  });

  it("an expense (a bill) gets none: its people are its splits", async () => {
    await seedDebt(h, flat, DEV, ANU, 10000);
    expect(items()).toEqual([]);
  });
});
