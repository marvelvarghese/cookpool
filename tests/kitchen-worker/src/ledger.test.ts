// The group ledger (CP-7): expenses in four split modes, payments, reversal,
// flags, activity, balances and the fewest-payments plan — through the router,
// against real SQLite (every migration applied) and the real policy grants.

import type {
  ActivityPage,
  BalancesResponse,
  KitchenFlag,
  KitchenSettings,
  KitchenTxn,
  SettlePlan,
} from "@saas/contracts/kitchen";
import { asUuid } from "@saas/db/ids";
import { createSqlExecutor } from "@saas/db/d1";
import { createKitchenRepository } from "@saas/db/kitchen";
import { balances, buildExpense, type ExpenseInput, type Txn } from "@saas/kitchen-engine/ledger";
import { createHarness, d1Over, envelope, newGroup, type Envelope, type Group, type Harness } from "./harness.js";

const BASE = Date.parse("2026-11-02T08:00:00.000Z");

const OWNER = "usr_rahul";
const ADMIN = "usr_admin";
const ANU = "usr_anu";
const DEV = "usr_dev";
const MEERA = "usr_meera";
const VIEWER = "usr_viewer";
const OUTSIDER = "usr_outsider";

let h: Harness;
let group: Group;
let tick: number;

beforeEach(() => {
  tick = 0;
  // A clock that moves a second every time it is read, so activity order is real.
  h = createHarness({ deps: { now: () => new Date(BASE + (tick += 1) * 1000) } });
  group = newGroup();
  h.grant(OWNER, group, "owner");
  h.grant(ADMIN, group, "admin");
  h.grant(ANU, group, "builder");
  h.grant(DEV, group, "builder");
  h.grant(MEERA, group, "builder");
  h.grant(VIEWER, group, "viewer");
});

afterEach(() => h.close());

const path = (g: Group, rest: string) => `/v1/organizations/${g.publicId}/kitchen/${rest}`;

async function call<T>(
  method: string,
  url: string,
  as: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Envelope<T> }> {
  const res = await h.call(method, url, { as, ...(body !== undefined ? { body } : {}), ...(headers ? { headers } : {}) });
  return { status: res.status, body: await envelope<T>(res) };
}

const postExpense = (as: string, body: unknown, headers?: Record<string, string>, g = group) =>
  call<{ txn: KitchenTxn }>("POST", path(g, "expenses"), as, body, headers);
const postSettlement = (as: string, body: unknown, headers?: Record<string, string>, g = group) =>
  call<{ txn: KitchenTxn }>("POST", path(g, "settlements"), as, body, headers);
const reverse = (as: string, txnId: string, headers?: Record<string, string>, body?: unknown) =>
  call<{ txn: KitchenTxn }>("POST", path(group, `txns/${txnId}/reverse`), as, body, headers);
const flag = (as: string, txnId: string, body: unknown, headers?: Record<string, string>) =>
  call<{ flag: KitchenFlag }>("POST", path(group, `txns/${txnId}/flags`), as, body, headers);
const getBalances = (as = OWNER, g = group) => call<BalancesResponse>("GET", path(g, "balances"), as);
const getPlan = (as = OWNER, g = group) => call<SettlePlan>("GET", path(g, "settle-plan"), as);
const getActivity = (as = OWNER, query = "", g = group) => call<ActivityPage>("GET", `${path(g, "activity")}${query}`, as);

/** Balances as a plain map, without the zeros. */
async function balanceMap(g = group): Promise<Record<string, number>> {
  const { body } = await getBalances(OWNER, g);
  return Object.fromEntries(body.data.balances.filter((b) => b.balanceMinor !== 0).map((b) => [b.subjectId, b.balanceMinor]));
}

function engineBalances(...inputs: ExpenseInput[]): Record<string, number> {
  const txns: Txn[] = inputs.map((input, i) => ({ id: `t${i}`, kind: "expense", title: "x", totalMinor: input.totalMinor, splits: buildExpense(input) }));
  return Object.fromEntries([...balances(txns)].filter(([, v]) => v !== 0));
}

function count(table: string): number {
  return (h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function events(type?: string): Array<Record<string, unknown>> {
  const rows = h.db.prepare("SELECT * FROM events_event_log ORDER BY occurred_at").all() as Array<Record<string, unknown>>;
  return type ? rows.filter((r) => r.type === type) : rows;
}

const dinner = {
  title: "Dinner",
  totalMinor: 1000,
  payers: [{ subjectId: OWNER, amountMinor: 1000 }],
  mode: "equal",
  participants: [{ subjectId: OWNER }, { subjectId: ANU }, { subjectId: DEV }],
};

describe("POST …/kitchen/expenses", () => {
  it("posts an equal split, the odd paisa going to the first listed", async () => {
    const { status, body } = await postExpense(ANU, dinner);
    expect(status).toBe(201);
    const txn = body.data.txn;
    expect(txn).toMatchObject({
      orgId: group.publicId,
      kind: "expense",
      title: "Dinner",
      totalMinor: 1000,
      currency: "INR",
      createdBy: ANU,
      reverses: null,
      reversed: false,
      reversedBy: null,
      method: null,
      note: null,
      sourceKind: null,
      sourceId: null,
    });
    expect(txn.id).toMatch(/^txn_[0-9a-f]{32}$/);
    expect(txn.splits).toEqual([
      { subjectId: OWNER, paidMinor: 1000, owedMinor: 334 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 333 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 333 },
    ]);
    expect(await balanceMap()).toEqual({ [OWNER]: 666, [ANU]: -333, [DEV]: -333 });
  });

  const cases: Array<[string, ExpenseInput & { title: string }]> = [
    ["equal", { ...dinner, mode: "equal" } as ExpenseInput & { title: string }],
    [
      "exact",
      {
        title: "Groceries",
        totalMinor: 1000,
        payers: [{ subjectId: OWNER, amountMinor: 1000 }],
        mode: "exact",
        participants: [{ subjectId: ANU, value: 600 }, { subjectId: DEV, value: 400 }],
      },
    ],
    [
      "percent",
      {
        title: "Gas",
        totalMinor: 1001,
        payers: [{ subjectId: DEV, amountMinor: 1001 }],
        mode: "percent",
        participants: [
          { subjectId: ANU, value: 33.33 },
          { subjectId: DEV, value: 33.33 },
          { subjectId: MEERA, value: 33.34 },
        ],
      },
    ],
    [
      "shares",
      {
        title: "Rent share",
        totalMinor: 1000,
        payers: [{ subjectId: OWNER, amountMinor: 600 }, { subjectId: ANU, amountMinor: 400 }],
        mode: "shares",
        participants: [{ subjectId: ANU, value: 2 }, { subjectId: DEV, value: 1 }, { subjectId: MEERA, value: 1.5 }],
      },
    ],
  ];

  it.each(cases)("posts a %s split whose balances match the engine's", async (_mode, input) => {
    const { status, body } = await postExpense(OWNER, input);
    expect(status).toBe(201);
    expect(body.data.txn.splits).toEqual(buildExpense(input));
    expect(await balanceMap()).toEqual(engineBalances(input));
  });

  it("adds up every mode together, as the engine does", async () => {
    for (const [, input] of cases) expect((await postExpense(OWNER, input)).status).toBe(201);
    expect(await balanceMap()).toEqual(engineBalances(...cases.map(([, input]) => input)));
    const { body } = await getBalances();
    expect(body.data.balances.reduce((a, b) => a + b.balanceMinor, 0)).toBe(0);
  });

  it("writes the transaction, its splits in listed order, and kitchen.expense.added together", async () => {
    const { body } = await postExpense(OWNER, { ...dinner, note: "Thali night" }, { "idempotency-key": "ikey-dinner" });
    const id = body.data.txn.id;
    expect(count("kitchen_txns")).toBe(1);
    const splits = h.db.prepare("SELECT subject_id, position FROM kitchen_txn_splits ORDER BY position").all();
    expect(splits.map((s) => ({ ...s }))).toEqual([
      { subject_id: OWNER, position: 0 },
      { subject_id: ANU, position: 1 },
      { subject_id: DEV, position: 2 },
    ]);
    const [event] = events("kitchen.expense.added");
    expect(event).toMatchObject({
      source: "kitchen-worker",
      actor_id: OWNER,
      org_id: group.id,
      subject_kind: "kitchen_txn",
      subject_id: id.replace(/^txn_/, "").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"),
      idempotency_key: "ikey-dinner",
      request_id: "req_test",
    });
    expect(JSON.parse(event!.payload as string)).toMatchObject({ txnId: id, totalMinor: 1000, currency: "INR", mode: "equal" });
    const audit = h.db.prepare("SELECT category, event_id FROM events_audit_entries").all();
    expect(audit.map((a) => ({ ...a }))).toEqual([{ category: "kitchen", event_id: event!.id }]);
    expect(body.data.txn.note).toBe("Thali night");
  });

  it("asks policy for kitchen.expense.create and fetches the roster once", async () => {
    await postExpense(OWNER, dinner);
    expect(h.decisions.map((d) => d.request.action)).toEqual(["kitchen.expense.create"]);
    expect(h.rosterCalls).toBe(1);
  });

  it("keeps occurredAt when given", async () => {
    const { body } = await postExpense(OWNER, { ...dinner, occurredAt: "2026-10-30T19:30:00+05:30" });
    expect(body.data.txn.occurredAt).toBe("2026-10-30T14:00:00.000Z");
  });

  it.each([
    [{ ...dinner, payers: [{ subjectId: OWNER, amountMinor: 900 }] }, "payers"],
    [{ ...dinner, mode: "exact", participants: [{ subjectId: ANU, value: 600 }, { subjectId: DEV, value: 300 }] }, "participants"],
    [{ ...dinner, mode: "percent", participants: [{ subjectId: ANU, value: 50 }, { subjectId: DEV, value: 40 }] }, "participants"],
    [{ ...dinner, mode: "shares", participants: [{ subjectId: ANU, value: 0 }] }, "participants"],
  ])("is 422 when the amounts do not add up (%#), writing nothing", async (body, field) => {
    const { status, body: res } = await postExpense(OWNER, body);
    expect(status).toBe(422);
    expect(res.error.code).toBe("validation_failed");
    expect(Object.keys(res.error.details.fields as object)).toEqual([field]);
    expect(count("kitchen_txns")).toBe(0);
  });

  it.each([
    [{ ...dinner, title: "  " }, "title"],
    [{ ...dinner, totalMinor: 0 }, "totalMinor"],
    [{ ...dinner, totalMinor: 10.5 }, "totalMinor"],
    [{ ...dinner, mode: "halves" }, "mode"],
    [{ ...dinner, currency: "inr" }, "currency"],
    [{ ...dinner, payers: [] }, "payers"],
    [{ ...dinner, payers: [{ subjectId: OWNER, amountMinor: 500 }, { subjectId: OWNER, amountMinor: 500 }] }, "payers"],
    [{ ...dinner, participants: [{ subjectId: ANU }, { subjectId: ANU }] }, "participants"],
    [{ ...dinner, mode: "exact", participants: [{ subjectId: ANU }] }, "participants[0].value"],
    [{ ...dinner, mode: "percent", participants: [{ subjectId: ANU, value: 100.001 }] }, "participants[0].value"],
    [{ ...dinner, participants: [{ subjectId: "not an id" }] }, "participants[0].subjectId"],
    [{ ...dinner, occurredAt: "yesterday" }, "occurredAt"],
  ])("is 422 for a malformed body (%#)", async (body, field) => {
    const { status, body: res } = await postExpense(OWNER, body);
    expect(status).toBe(422);
    expect(res.error.details.fields).toHaveProperty([field]);
    expect(count("kitchen_txns")).toBe(0);
  });

  it("is 422 for a body that is not a JSON object", async () => {
    const res = await h.call("POST", path(group, "expenses"), { as: OWNER, rawBody: "[1]" });
    expect(res.status).toBe(422);
  });

  it("is 422 not_in_group when someone named is not in the group, naming them", async () => {
    const { status, body } = await postExpense(OWNER, {
      ...dinner,
      participants: [{ subjectId: ANU }, { subjectId: OUTSIDER }, { subjectId: "usr_stranger" }],
    });
    expect(status).toBe(422);
    expect(body.error.details).toEqual({ reason: "not_in_group", subjectIds: [OUTSIDER, "usr_stranger"] });
    expect(count("kitchen_txns")).toBe(0);
    expect(events()).toHaveLength(0);
  });

  it("is 422 not_in_group for a payer who has left the group", async () => {
    h.revoke(DEV, group);
    const { status, body } = await postExpense(OWNER, { ...dinner, payers: [{ subjectId: DEV, amountMinor: 1000 }] });
    expect(status).toBe(422);
    expect(body.error.details.reason).toBe("not_in_group");
  });

  it("is 422 currency_mismatch for another currency, and accepts the group's own", async () => {
    const usd = await postExpense(OWNER, { ...dinner, currency: "USD" });
    expect(usd.status).toBe(422);
    expect(usd.body.error.details).toEqual({ reason: "currency_mismatch", currency: "INR" });
    expect((await postExpense(OWNER, { ...dinner, currency: "INR" })).status).toBe(201);
  });

  it("posts in the currency the group saved", async () => {
    await call("PATCH", path(group, "settings"), OWNER, { currency: "EUR" });
    const { body } = await postExpense(OWNER, dinner);
    expect(body.data.txn.currency).toBe("EUR");
    expect((await getBalances()).body.data.currency).toBe("EUR");
  });

  it("fixes the group's currency with its first transaction", async () => {
    await postExpense(OWNER, dinner);
    const settings = await call<KitchenSettings>("GET", path(group, "settings"), OWNER);
    expect(settings.body.data.currency).toBe("INR");
    expect(settings.body.data.updatedAt).not.toBeNull();
    const change = await call("PATCH", path(group, "settings"), OWNER, { currency: "USD" });
    expect(change.status).toBe(409);
    expect(change.body.error.details.reason).toBe("currency_locked");
  });

  it("does not post twice for a repeated Idempotency-Key", async () => {
    const headers = { "idempotency-key": "ikey-once" };
    const first = await postExpense(OWNER, dinner, headers);
    const again = await postExpense(OWNER, dinner, headers);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.data.txn).toEqual(first.body.data.txn);
    expect(count("kitchen_txns")).toBe(1);
    expect(count("kitchen_txn_splits")).toBe(3);
    expect(events("kitchen.expense.added")).toHaveLength(1);
    expect(await balanceMap()).toEqual({ [OWNER]: 666, [ANU]: -333, [DEV]: -333 });
  });

  it("posts each request once when no key is sent", async () => {
    await postExpense(OWNER, dinner);
    await postExpense(OWNER, dinner);
    expect(count("kitchen_txns")).toBe(2);
    const keys = h.db.prepare("SELECT idem_key FROM kitchen_txns").all() as Array<{ idem_key: string }>;
    expect(new Set(keys.map((k) => k.idem_key)).size).toBe(2);
  });

  it("is 409 idempotency_key_reused for a key that posted something else", async () => {
    const headers = { "idempotency-key": "ikey-shared" };
    await postExpense(OWNER, dinner, headers);
    const settle = await postSettlement(ANU, { fromSubjectId: ANU, toSubjectId: OWNER, amountMinor: 333 }, headers);
    expect(settle.status).toBe(409);
    expect(settle.body.error.details.reason).toBe("idempotency_key_reused");
    const someoneElse = await postExpense(ANU, dinner, headers);
    expect(someoneElse.status).toBe(409);
    expect(count("kitchen_txns")).toBe(1);
  });

  it("keeps idempotency keys per group", async () => {
    const other = newGroup();
    h.grant(OWNER, other, "owner");
    h.grant(ANU, other, "builder");
    h.grant(DEV, other, "builder");
    const headers = { "idempotency-key": "ikey-two-groups" };
    expect((await postExpense(OWNER, dinner, headers)).status).toBe(201);
    expect((await postExpense(OWNER, dinner, headers, other)).status).toBe(201);
    expect(count("kitchen_txns")).toBe(2);
  });

  it("is 400 for a malformed Idempotency-Key", async () => {
    const { status, body } = await postExpense(OWNER, dinner, { "idempotency-key": "  " });
    expect(status).toBe(400);
    expect(body.error.details.reason).toBe("empty");
  });

  it.each([VIEWER, OUTSIDER])("is the opaque 404 for %s, writing nothing", async (as) => {
    const { status, body } = await postExpense(as, dinner);
    expect(status).toBe(404);
    expect(body.error).toMatchObject({ code: "not_found", message: "Not found" });
    expect(count("kitchen_txns")).toBe(0);
  });

  it("is a 503 when the roster cannot be read, writing nothing", async () => {
    const membership = h.env.MEMBERSHIP_WORKER!;
    h.env.MEMBERSHIP_WORKER = {
      fetch: (input: string, init?: RequestInit) =>
        String(input).includes("/v1/internal/membership/organizations/")
          ? Promise.resolve(Response.json({ error: { code: "internal_error" } }, { status: 500 }))
          : membership.fetch(input, init),
      connect() {
        throw new Error("not implemented");
      },
    } as unknown as Fetcher;
    expect((await postExpense(OWNER, dinner)).status).toBe(503);
    expect(count("kitchen_txns")).toBe(0);
  });
});

describe("POST …/kitchen/settlements", () => {
  const payment = { fromSubjectId: ANU, toSubjectId: OWNER, amountMinor: 333, method: "upi" };

  it("records a payment: the payer's balance goes up, the payee's down", async () => {
    await postExpense(OWNER, dinner);
    const { status, body } = await postSettlement(ANU, { ...payment, note: "GPay" });
    expect(status).toBe(201);
    expect(body.data.txn).toMatchObject({
      kind: "settlement",
      title: "Payment",
      totalMinor: 333,
      currency: "INR",
      method: "upi",
      note: "GPay",
      createdBy: ANU,
      splits: [
        { subjectId: ANU, paidMinor: 333, owedMinor: 0 },
        { subjectId: OWNER, paidMinor: 0, owedMinor: 333 },
      ],
    });
    expect(await balanceMap()).toEqual({ [OWNER]: 333, [DEV]: -333 });
    expect(events("kitchen.settlement.recorded")).toHaveLength(1);
  });

  it.each([OWNER, ANU, ADMIN])("lets %s record it (one of the two, or an admin or owner)", async (as) => {
    expect((await postSettlement(as, payment)).status).toBe(201);
  });

  it("is 403 not_a_party for a member who is neither of the two", async () => {
    const { status, body } = await postSettlement(DEV, payment);
    expect(status).toBe(403);
    expect(body.error).toMatchObject({ code: "forbidden", details: { reason: "not_a_party" } });
    expect(count("kitchen_txns")).toBe(0);
  });

  it("is 422 for a payment to yourself, or of nothing", async () => {
    expect((await postSettlement(ANU, { ...payment, toSubjectId: ANU })).body.error.details.fields).toHaveProperty(["toSubjectId"]);
    expect((await postSettlement(ANU, { ...payment, amountMinor: 0 })).status).toBe(422);
    expect((await postSettlement(ANU, { ...payment, method: "cheque" })).body.error.details.fields).toHaveProperty(["method"]);
  });

  it("is 422 not_in_group when either person is not in the group", async () => {
    const { status, body } = await postSettlement(ANU, { ...payment, toSubjectId: OUTSIDER });
    expect(status).toBe(422);
    expect(body.error.details).toEqual({ reason: "not_in_group", subjectIds: [OUTSIDER] });
  });

  it.each([VIEWER, OUTSIDER])("is the opaque 404 for %s", async (as) => {
    expect((await postSettlement(as, { ...payment, fromSubjectId: as })).status).toBe(404);
  });

  it("does not record a payment twice for a repeated key", async () => {
    const headers = { "idempotency-key": "pay-once" };
    const first = await postSettlement(ANU, payment, headers);
    const again = await postSettlement(ANU, payment, headers);
    expect(again.body.data.txn.id).toBe(first.body.data.txn.id);
    expect(count("kitchen_txns")).toBe(1);
  });
});

describe("GET …/kitchen/settle-plan", () => {
  async function busyEvening() {
    await postExpense(OWNER, dinner);
    await postExpense(ANU, {
      title: "Groceries",
      totalMinor: 2450,
      payers: [{ subjectId: ANU, amountMinor: 2000 }, { subjectId: MEERA, amountMinor: 450 }],
      mode: "shares",
      participants: [{ subjectId: OWNER, value: 1 }, { subjectId: DEV, value: 2 }, { subjectId: MEERA, value: 1 }, { subjectId: ANU, value: 1 }],
    });
    await postExpense(DEV, {
      title: "Movie",
      totalMinor: 1200,
      payers: [{ subjectId: DEV, amountMinor: 1200 }],
      mode: "exact",
      participants: [{ subjectId: OWNER, value: 400 }, { subjectId: MEERA, value: 800 }],
    });
  }

  it("returns the fewest payments and the working", async () => {
    await busyEvening();
    const { status, body } = await getPlan(VIEWER);
    expect(status).toBe(200);
    expect(body.data.currency).toBe("INR");
    const people = Object.keys(await balanceMap()).length;
    expect(body.data.payments.length).toBeLessThanOrEqual(people - 1);
    expect(body.data.working.payments).toBe(body.data.payments.length);
    expect(body.data.working.debts).toBeGreaterThanOrEqual(body.data.working.pairs);
    for (const p of body.data.payments) expect(p.amountMinor).toBeGreaterThan(0);
  });

  it("brings every balance to zero once its payments are recorded", async () => {
    await busyEvening();
    const { body } = await getPlan();
    for (const p of body.data.payments) {
      const recorded = await postSettlement(p.fromSubjectId, {
        fromSubjectId: p.fromSubjectId,
        toSubjectId: p.toSubjectId,
        amountMinor: p.amountMinor,
      });
      expect(recorded.status).toBe(201);
    }
    const after = await getBalances();
    expect(after.body.data.balances.every((b) => b.balanceMinor === 0)).toBe(true);
    const plan = await getPlan();
    expect(plan.body.data.payments).toEqual([]);
    expect(plan.body.data.working.payments).toBe(0);
  });

  it("is an empty plan for a group with no transactions", async () => {
    const { body } = await getPlan();
    expect(body.data).toEqual({ currency: "INR", payments: [], working: { debts: 0, pairs: 0, payments: 0 } });
  });

  it("is the opaque 404 outside the group", async () => {
    expect((await getPlan(OUTSIDER)).status).toBe(404);
  });
});

describe("POST …/kitchen/txns/{txn}/reverse", () => {
  it("posts the reversal, restoring every balance exactly", async () => {
    await postExpense(OWNER, cases()[0]!);
    const before = await balanceMap();
    const { body: posted } = await postExpense(ANU, cases()[1]!);
    expect(await balanceMap()).not.toEqual(before);

    const { status, body } = await reverse(ANU, posted.data.txn.id, undefined, { note: "Wrong bill" });
    expect(status).toBe(201);
    expect(body.data.txn).toMatchObject({
      kind: "reversal",
      title: "Reversal: Gas",
      reverses: posted.data.txn.id,
      totalMinor: posted.data.txn.totalMinor,
      currency: "INR",
      createdBy: ANU,
      note: "Wrong bill",
    });
    expect(body.data.txn.splits).toEqual(
      posted.data.txn.splits.map((s) => ({ subjectId: s.subjectId, paidMinor: s.owedMinor, owedMinor: s.paidMinor })),
    );
    expect(await balanceMap()).toEqual(before);
    expect(events("kitchen.txn.reversed")).toHaveLength(1);
  });

  it("marks the original reversed in the activity", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    const { body: reversal } = await reverse(OWNER, posted.data.txn.id);
    const { body } = await getActivity();
    const original = body.data.items.find((t) => t.id === posted.data.txn.id)!;
    expect(original).toMatchObject({ reversed: true, reversedBy: reversal.data.txn.id });
    expect(body.data.items[0]).toMatchObject({ id: reversal.data.txn.id, kind: "reversal", reversed: false });
  });

  it("refuses a second reversal with 409 already_reversed", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    const first = await reverse(OWNER, posted.data.txn.id);
    const second = await reverse(ADMIN, posted.data.txn.id);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({
      code: "conflict",
      details: { reason: "already_reversed", reversedBy: first.body.data.txn.id },
    });
    expect(count("kitchen_txns")).toBe(2);
    expect(await balanceMap()).toEqual({});
  });

  it("answers a repeated key with the same reversal", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    const headers = { "idempotency-key": "undo-1" };
    const first = await reverse(OWNER, posted.data.txn.id, headers);
    const again = await reverse(OWNER, posted.data.txn.id, headers);
    expect(again.status).toBe(201);
    expect(again.body.data.txn.id).toBe(first.body.data.txn.id);
    expect(events("kitchen.txn.reversed")).toHaveLength(1);
  });

  it("can undo a reversal, which puts the original's effect back", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    const { body: reversal } = await reverse(OWNER, posted.data.txn.id);
    expect((await reverse(OWNER, reversal.data.txn.id)).status).toBe(201);
    expect(await balanceMap()).toEqual({ [OWNER]: 666, [ANU]: -333, [DEV]: -333 });
  });

  it.each([ADMIN, OWNER])("lets %s reverse someone else's transaction (kitchen.txn.reverse_any)", async (as) => {
    const { body: posted } = await postExpense(ANU, dinner);
    expect((await reverse(as, posted.data.txn.id)).status).toBe(201);
  });

  it.each([DEV, VIEWER])("is 403 not_creator for %s, who did not log it", async (as) => {
    const { body: posted } = await postExpense(ANU, dinner);
    const { status, body } = await reverse(as, posted.data.txn.id);
    expect(status).toBe(403);
    expect(body.error.details).toEqual({ reason: "not_creator" });
    expect(count("kitchen_txns")).toBe(1);
  });

  it("is the opaque 404 for an outsider, an unknown id, a malformed id and another group's transaction", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    expect((await reverse(OUTSIDER, posted.data.txn.id)).status).toBe(404);
    expect((await reverse(OWNER, `txn_${"0".repeat(32)}`)).status).toBe(404);
    expect((await reverse(OWNER, "txn_nope")).status).toBe(404);

    const other = newGroup();
    h.grant(OWNER, other, "owner");
    const elsewhere = await call("POST", path(other, `txns/${posted.data.txn.id}/reverse`), OWNER);
    expect(elsewhere.status).toBe(404);
  });

  function cases(): Array<Record<string, unknown>> {
    return [
      dinner,
      {
        title: "Gas",
        totalMinor: 1001,
        payers: [{ subjectId: ANU, amountMinor: 501 }, { subjectId: DEV, amountMinor: 500 }],
        mode: "percent",
        participants: [{ subjectId: OWNER, value: 33.33 }, { subjectId: DEV, value: 33.33 }, { subjectId: MEERA, value: 33.34 }],
      },
    ];
  }
});

describe("POST …/kitchen/txns/{txn}/flags", () => {
  it("lets someone the transaction names flag it", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    const { status, body } = await flag(ANU, posted.data.txn.id, { reason: "  I wasn't there  " });
    expect(status).toBe(201);
    expect(body.data.flag).toMatchObject({
      txnId: posted.data.txn.id,
      orgId: group.publicId,
      subjectId: ANU,
      reason: "I wasn't there",
      state: "open",
    });
    expect(body.data.flag.id).toMatch(/^flg_[0-9a-f]{32}$/);
    expect(events("kitchen.txn.flagged")).toHaveLength(1);

    const repo = createKitchenRepository(createSqlExecutor(d1Over(h.db)));
    const txnUuid = asUuid(posted.data.txn.id.slice(4).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"));
    const flags = await repo.listFlags(group.id, txnUuid);
    expect(flags.ok && flags.value.map((f) => f.reason)).toEqual(["I wasn't there"]);
  });

  it("is 403 not_a_party for a member it does not name", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    const { status, body } = await flag(MEERA, posted.data.txn.id, { reason: "Looks off" });
    expect(status).toBe(403);
    expect(body.error.details).toEqual({ reason: "not_a_party" });
    expect(count("kitchen_flags")).toBe(0);
  });

  it.each([VIEWER, OUTSIDER])("is the opaque 404 for %s", async (as) => {
    const { body: posted } = await postExpense(OWNER, dinner);
    expect((await flag(as, posted.data.txn.id, { reason: "x" })).status).toBe(404);
  });

  it("is 422 without a reason, and 404 for an unknown transaction", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    expect((await flag(ANU, posted.data.txn.id, { reason: "" })).status).toBe(422);
    expect((await flag(ANU, `txn_${"a".repeat(32)}`, { reason: "x" })).status).toBe(404);
  });

  it("does not flag twice for a repeated key", async () => {
    const { body: posted } = await postExpense(OWNER, dinner);
    const headers = { "idempotency-key": "flag-1" };
    const first = await flag(ANU, posted.data.txn.id, { reason: "Hmm" }, headers);
    const again = await flag(ANU, posted.data.txn.id, { reason: "Hmm" }, headers);
    expect(again.status).toBe(201);
    expect(again.body.data.flag.id).toBe(first.body.data.flag.id);
    expect(count("kitchen_flags")).toBe(1);
  });
});

describe("GET …/kitchen/activity", () => {
  it("lists the ledger newest first with splits, and pages through it with the cursor", async () => {
    const ids: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const { body } = await postExpense(OWNER, { ...dinner, title: `Meal ${i}` });
      ids.push(body.data.txn.id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : "?limit=2";
      const { status, body } = await getActivity(VIEWER, query);
      expect(status).toBe(200);
      expect(body.meta.cursor).toBe(body.data.nextCursor);
      for (const item of body.data.items) expect(item.splits).toHaveLength(3);
      seen.push(...body.data.items.map((t) => t.id));
      cursor = body.data.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
  });

  it("keeps groups apart", async () => {
    const other = newGroup();
    h.grant(OWNER, other, "owner");
    h.grant(ANU, other, "builder");
    h.grant(DEV, other, "builder");
    await postExpense(OWNER, dinner, undefined, other);
    const { body } = await getActivity();
    expect(body.data).toEqual({ items: [], nextCursor: null });
    expect((await getActivity(OWNER, "", other)).body.data.items).toHaveLength(1);
  });

  it.each([
    ["?limit=0", "limit"],
    ["?limit=101", "limit"],
    ["?limit=ten", "limit"],
    ["?cursor=garbage", "cursor"],
  ])("is 422 for %s", async (query, field) => {
    const { status, body } = await getActivity(OWNER, query);
    expect(status).toBe(422);
    expect(body.error.details.fields).toHaveProperty([field]);
  });

  it("asks policy for kitchen.ledger.read, and is the opaque 404 outside the group", async () => {
    await getActivity(VIEWER);
    expect(h.decisions.map((d) => d.request.action)).toEqual(["kitchen.ledger.read"]);
    expect((await getActivity(OUTSIDER)).status).toBe(404);
  });
});

describe("GET …/kitchen/balances", () => {
  it("lists every member, zero included, largest first", async () => {
    await postExpense(OWNER, dinner);
    const { status, body } = await getBalances(VIEWER);
    expect(status).toBe(200);
    expect(body.data).toEqual({
      currency: "INR",
      balances: [
        { subjectId: OWNER, balanceMinor: 666 },
        { subjectId: ADMIN, balanceMinor: 0 },
        { subjectId: MEERA, balanceMinor: 0 },
        { subjectId: VIEWER, balanceMinor: 0 },
        { subjectId: ANU, balanceMinor: -333 },
        { subjectId: DEV, balanceMinor: -333 },
      ],
    });
  });

  it("keeps someone who left with money owed, and drops them once settled", async () => {
    await postExpense(OWNER, dinner);
    h.revoke(DEV, group);
    expect((await getBalances()).body.data.balances).toContainEqual({ subjectId: DEV, balanceMinor: -333 });
    // A payment from someone who left cannot be recorded (they are not in the
    // group); an admin reverses the expense instead.
    const { body } = await getActivity();
    await reverse(OWNER, body.data.items[0]!.id);
    expect((await getBalances()).body.data.balances.map((b) => b.subjectId)).not.toContain(DEV);
  });

  it("fetches the roster once per request", async () => {
    await getBalances();
    expect(h.rosterCalls).toBe(1);
  });

  it("is the opaque 404 outside the group", async () => {
    expect((await getBalances(OUTSIDER)).status).toBe(404);
  });
});

describe("routing the ledger", () => {
  it.each([
    ["GET", "expenses"],
    ["GET", "settlements"],
    ["POST", "activity"],
    ["POST", "balances"],
    ["DELETE", "settle-plan"],
    ["GET", "txns/txn_x/reverse"],
    ["GET", "txns/txn_x/flags"],
  ])("405s %s %s before anything else", async (method, rest) => {
    const res = await h.call(method, path(group, rest), { as: null });
    expect(res.status).toBe(405);
    expect(h.decisions).toHaveLength(0);
  });

  it("401s a ledger route without an actor", async () => {
    expect((await h.call("GET", path(group, "balances"), { as: null })).status).toBe(401);
  });
});
