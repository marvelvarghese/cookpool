// design.md §3's worked example, to the paisa. Rahul cooks paneer butter
// masala and shares it with Flat 4B; some ingredients are Anu's and Dev's from
// Flat 4B and Kiran's from the Lunch club. The `use` and `dish` transactions
// arrive with the pantry and dish routes (CP-10…CP-16); here they are built by
// the engine and posted straight through the repository, then read back
// through the ledger routes.

import type { ActivityPage, BalancesResponse, SettlePlan } from "@saas/contracts/kitchen";
import { createSqlExecutor } from "@saas/db/d1";
import { asUuid, type Uuid } from "@saas/db/ids";
import { createKitchenRepository, type KitchenRepository, type NewKitchenTxn } from "@saas/db/kitchen";
import { buildDish, buildIngredientTake, type Split } from "@kitchen-worker/engine/ledger";
import { createHarness, d1Over, envelope, newGroup, type Group, type Harness } from "./harness.js";

const RAHUL = "usr_rahul";
const ANU = "usr_anu";
const DEV = "usr_dev";
const MEERA = "usr_meera";
const KIRAN = "usr_kiran";
const NOW = new Date("2026-11-02T13:00:00.000Z");

let h: Harness;
let repo: KitchenRepository;
let flat4b: Group;
let lunchClub: Group;
let posted = 0;

beforeEach(() => {
  h = createHarness({ deps: { now: () => NOW } });
  repo = createKitchenRepository(createSqlExecutor(d1Over(h.db)));
  flat4b = newGroup();
  lunchClub = newGroup();
  h.grant(RAHUL, flat4b, "owner");
  for (const who of [ANU, DEV, MEERA]) h.grant(who, flat4b, "builder");
  h.grant(KIRAN, lunchClub, "owner");
  h.grant(RAHUL, lunchClub, "builder");
});

afterEach(() => h.close());

async function post(orgId: Uuid, txn: Pick<NewKitchenTxn, "kind" | "title" | "totalMinor">, splits: Split[], at: string) {
  posted += 1;
  const result = await repo.postTxn({
    txn: {
      ...txn,
      id: asUuid(crypto.randomUUID()),
      orgId,
      currency: "INR",
      occurredAt: new Date(at),
      createdBy: RAHUL,
      idemKey: `worked-example-${posted}`,
      now: NOW,
    },
    splits,
  });
  expect(result.ok).toBe(true);
}

async function read<T>(group: Group, rest: string, as = RAHUL): Promise<T> {
  const res = await h.call("GET", `/v1/organizations/${group.publicId}/kitchen/${rest}`, { as });
  expect(res.status).toBe(200);
  return (await envelope<T>(res)).data;
}

async function cook() {
  // At cook time: one `use` per source group, charging the cook each buyer's cost.
  const flatTake = buildIngredientTake({
    cookId: RAHUL,
    lines: [
      { buyerId: ANU, costMinor: 1200 }, // tomatoes
      { buyerId: DEV, costMinor: 700 }, // onions
    ],
  });
  await post(flat4b.id, { kind: "use", title: "Tomatoes and onions for paneer butter masala", totalMinor: flatTake.totalMinor }, flatTake.splits, "2026-11-02T12:00:00.000Z");
  const clubTake = buildIngredientTake({ cookId: RAHUL, lines: [{ buyerId: KIRAN, costMinor: 2400 }] }); // chapati flour
  await post(lunchClub.id, { kind: "use", title: "Chapati flour for rotis", totalMinor: clubTake.totalMinor }, clubTake.splits, "2026-11-02T12:00:00.000Z");

  // At finalize: the dish, ₹211.00 for 4 portions, claims You 1½, Anu 1, Dev 1, Meera ½.
  const totalMinor = 9500 + 2800 + 3000 + 1200 + 700 + 2400 + 1500;
  expect(totalMinor).toBe(21100);
  const dish = buildDish({
    cookId: RAHUL,
    totalMinor,
    portionsHalf: 8,
    shares: [
      { subjectId: RAHUL, portionsHalf: 3 },
      { subjectId: ANU, portionsHalf: 2 },
      { subjectId: DEV, portionsHalf: 2 },
      { subjectId: MEERA, portionsHalf: 1 },
    ],
  });
  expect(Object.fromEntries(dish.owedBy)).toEqual({ [RAHUL]: 7913, [ANU]: 5275, [DEV]: 5275, [MEERA]: 2637 });
  await post(flat4b.id, { kind: "dish", title: "Paneer butter masala with rotis", totalMinor }, dish.splits, "2026-11-02T12:30:00.000Z");
}

describe("the worked example (design.md §3)", () => {
  it("nets Flat 4B to Anu ₹40.75, Dev ₹45.75 and Meera ₹26.37 owing Rahul", async () => {
    await cook();
    const { currency, balances } = await read<BalancesResponse>(flat4b, "balances", MEERA);
    expect(currency).toBe("INR");
    expect(balances).toEqual([
      { subjectId: RAHUL, balanceMinor: 11287 },
      { subjectId: MEERA, balanceMinor: -2637 },
      { subjectId: ANU, balanceMinor: -4075 },
      { subjectId: DEV, balanceMinor: -4575 },
    ]);
  });

  it("leaves Rahul owing Kiran ₹24.00 in the Lunch club", async () => {
    await cook();
    expect((await read<BalancesResponse>(lunchClub, "balances", KIRAN)).balances).toEqual([
      { subjectId: KIRAN, balanceMinor: 2400 },
      { subjectId: RAHUL, balanceMinor: -2400 },
    ]);
    expect((await read<SettlePlan>(lunchClub, "settle-plan")).payments).toEqual([
      { fromSubjectId: RAHUL, toSubjectId: KIRAN, amountMinor: 2400 },
    ]);
  });

  it("plans three payments to Rahul from five debts over three pairs", async () => {
    await cook();
    const plan = await read<SettlePlan>(flat4b, "settle-plan");
    expect(plan).toEqual({
      currency: "INR",
      payments: [
        { fromSubjectId: DEV, toSubjectId: RAHUL, amountMinor: 4575 },
        { fromSubjectId: ANU, toSubjectId: RAHUL, amountMinor: 4075 },
        { fromSubjectId: MEERA, toSubjectId: RAHUL, amountMinor: 2637 },
      ],
      working: { debts: 5, pairs: 3, payments: 3 },
    });
  });

  it("shows the dish and the use in Flat 4B's activity, newest first", async () => {
    await cook();
    const { items } = await read<ActivityPage>(flat4b, "activity", ANU);
    expect(items.map((t) => [t.kind, t.totalMinor])).toEqual([
      ["dish", 21100],
      ["use", 1900],
    ]);
    expect(items[0]!.splits).toEqual([
      { subjectId: RAHUL, paidMinor: 21100, owedMinor: 7913 },
      { subjectId: ANU, paidMinor: 0, owedMinor: 5275 },
      { subjectId: DEV, paidMinor: 0, owedMinor: 5275 },
      { subjectId: MEERA, paidMinor: 0, owedMinor: 2637 },
    ]);
  });

  it("settles to zero once the plan's payments are recorded", async () => {
    await cook();
    for (const group of [flat4b, lunchClub]) {
      for (const p of (await read<SettlePlan>(group, "settle-plan")).payments) {
        const res = await h.call("POST", `/v1/organizations/${group.publicId}/kitchen/settlements`, {
          as: p.fromSubjectId,
          body: { fromSubjectId: p.fromSubjectId, toSubjectId: p.toSubjectId, amountMinor: p.amountMinor, method: "upi" },
        });
        expect(res.status).toBe(201);
      }
      const { balances } = await read<BalancesResponse>(group, "balances");
      expect(balances.every((b) => b.balanceMinor === 0)).toBe(true);
    }
  });
});
