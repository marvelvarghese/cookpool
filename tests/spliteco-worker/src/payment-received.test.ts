// POST /v1/spliteco/me/payments-received (MY-16, Got it): someone paid the
// caller. Recorded as their payment to the caller, one per group, Kitchen first.

import type { SplitecoBalancesResponse, SplitecoReceivedPaymentResponse, SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { ANU, DEV, ME, MEERA, OUTSIDER, add, envelope, equal, key, world } from "./helpers.js";
import type { Harness } from "./harness.js";

const PATH = "/v1/spliteco/me/payments-received";
const got = (h: Harness, body: Record<string, unknown>, as = ME, idem = key(), extra: Record<string, string> = {}) =>
  h.call("POST", PATH, { as, body, headers: { "idempotency-key": idem, ...extra } });
const balances = async (h: Harness, as = ME) =>
  (await envelope<SplitecoBalancesResponse>(await h.call("GET", "/v1/spliteco/me/balances", { as }))).data;
const owes = async (h: Harness, who: string, as = ME) => (await balances(h, as)).people.find((p) => p.subjectId === who)!;

describe("POST /v1/spliteco/me/payments-received", () => {
  it("records one payment in a group and clears the balance straight away", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(200_00, ME, [ME, ANU])); // Anu owes me 100
    const res = await got(h, { fromSubjectId: ANU, amountMinor: 100_00 });
    expect(res.status).toBe(201);
    const data = (await envelope<SplitecoReceivedPaymentResponse>(res)).data;
    expect(data).toMatchObject({ fromSubjectId: ANU, amountMinor: 100_00, currency: "INR" });
    expect(data.payments).toHaveLength(1);
    expect(data.payments[0]).toMatchObject({ groupId: goa.publicId, fromSubjectId: ANU, toSubjectId: ME, amountMinor: 100_00, method: "cash", state: "recorded", recordedBy: ME });
    const anu = await owes(h, ANU);
    expect(anu).toMatchObject({ settled: true, balances: [], plans: [] });
    // The same ledger effect as Anu paying me herself: the group's balances square.
    const g = (await envelope<SplitecoGroupResponse>(await h.call("GET", `/v1/spliteco/groups/${goa.publicId}`, { as: ANU }))).data;
    expect(g.balances.find((b) => b.subjectId === ANU)?.balanceMinor ?? 0).toBe(0);
    expect(h.db.prepare("SELECT kind, method, created_by FROM kitchen_txns WHERE kind = 'settlement'").all()).toEqual([{ kind: "settlement", method: "cash", created_by: ME }]);
  });

  it("splits across groups, Kitchen first, one record per group", async () => {
    const { h, flat, goa } = world();
    await add(h, flat, equal(100_00, ME, [ME, ANU])); // Anu owes me 50 in Flat 4B
    await add(h, goa, equal(300_00, ME, [ME, ANU])); // Anu owes me 150 in Goa
    const first = await got(h, { fromSubjectId: ANU, amountMinor: 80_00, method: "upi", note: "UTR 41" });
    const { payments } = (await envelope<SplitecoReceivedPaymentResponse>(first)).data;
    expect(payments.map((p) => [p.groupId, p.amountMinor, p.method, p.note])).toEqual([
      [flat.publicId, 50_00, "upi", "UTR 41"],
      [goa.publicId, 30_00, "upi", "UTR 41"],
    ]);
    const anu = await owes(h, ANU);
    expect(anu.balances).toEqual([{ currency: "INR", amountMinor: 120_00 }]);
    expect(anu.groups.map((g) => [g.groupName, g.amountMinor])).toEqual([["Flat 4B", 0], ["Goa Trip", 120_00]]);
    // Paying the rest clears everything.
    expect((await got(h, { fromSubjectId: ANU, amountMinor: 120_00 })).status).toBe(201);
    expect((await owes(h, ANU)).settled).toBe(true);
  });

  it("fills a Kitchen group's Kitchen balance before its Other balance, and bucket kitchen stays on Kitchen", async () => {
    const { h, flat } = world();
    await h.kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/expenses`, {
      as: ME,
      body: { title: "Groceries", totalMinor: 600_00, mode: "equal", payers: [{ subjectId: ME, amountMinor: 600_00 }], participants: [{ subjectId: ME }, { subjectId: ANU }] },
      headers: { "idempotency-key": key() },
    }); // Anu owes me 300 on Kitchen
    await add(h, flat, equal(2000_00, ME, [ME, ANU])); // and 1000 on Other
    const only = await got(h, { fromSubjectId: ANU, amountMinor: 100_00, bucket: "kitchen" });
    expect((await envelope<SplitecoReceivedPaymentResponse>(only)).data.payments[0]!.parts.map((p) => [p.bucket, p.amountMinor])).toEqual([["kitchen", 100_00]]);
    const over = await got(h, { fromSubjectId: ANU, amountMinor: 250_00, bucket: "kitchen" });
    expect(over.status).toBe(422);
    expect((await envelope(over)).error.details.reason).toBe("over_settled");
    const all = await got(h, { fromSubjectId: ANU, amountMinor: 700_00 });
    expect((await envelope<SplitecoReceivedPaymentResponse>(all)).data.payments[0]!.parts.map((p) => [p.bucket, p.amountMinor])).toEqual([["kitchen", 200_00], ["other", 500_00]]);
    expect((await owes(h, ANU)).groups[0]!.buckets).toEqual({ kitchen: 0, other: 500_00 });
  });

  it("refuses someone who is not in a group with the caller, the caller themself, and a viewer", async () => {
    const { h, flat, goa } = world();
    await add(h, goa, equal(200_00, ME, [ME, MEERA]));
    const stranger = await got(h, { fromSubjectId: OUTSIDER, amountMinor: 10_00 });
    expect(stranger.status).toBe(422);
    expect((await envelope(stranger)).error.details.reason).toBe("not_in_group");
    // Meera is in Goa only: Flat 4B cannot be paid for her.
    expect((await got(h, { fromSubjectId: MEERA, amountMinor: 100_00 })).status).toBe(201);
    const self = await got(h, { fromSubjectId: ME, amountMinor: 10_00 });
    expect((await envelope(self)).error.details.reason).toBe("same_person");
    // A non-member of the caller's groups cannot record into someone else's.
    expect((await got(h, { fromSubjectId: ANU, amountMinor: 10_00 }, OUTSIDER)).status).toBe(422);
    await add(h, flat, equal(200_00, ME, [ME, DEV]));
    h.grant(ME, flat, "viewer");
    // Dev owes me 100 in Flat 4B, but a viewer records nothing there: only Goa Trip counts, where he owes nothing.
    const viewer = await got(h, { fromSubjectId: DEV, amountMinor: 10_00 });
    expect(viewer.status).toBe(409);
    expect((await owes(h, DEV)).balances).toEqual([{ currency: "INR", amountMinor: 100_00 }]);
  });

  it("refuses more than they owe, and nothing owed, and writes nothing", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(200_00, ME, [ME, ANU]));
    const before = h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_txns").get();
    const over = await got(h, { fromSubjectId: ANU, amountMinor: 100_01 });
    expect(over.status).toBe(422);
    const e = (await envelope(over)).error;
    expect(e.details).toMatchObject({ reason: "over_settled", owedMinor: 100_00 });
    // Nothing owed the other way: I owe nobody, so Dev (who owes nothing) has nothing to pay.
    const none = await got(h, { fromSubjectId: DEV, amountMinor: 10_00 });
    expect(none.status).toBe(409);
    expect((await envelope(none)).error.details.reason).toBe("nothing_owed");
    // What I owe them is not theirs to pay me.
    const owedByMe = await got(h, { fromSubjectId: ME, amountMinor: 10_00 }, ANU);
    expect(owedByMe.status).toBe(409);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_txns").get()).toEqual(before);
    expect((await got(h, { fromSubjectId: ANU, amountMinor: 0 })).status).toBe(422);
  });

  it("asks which currency when they owe in two, and keeps currencies apart", async () => {
    const { h, flat, goa } = world();
    await add(h, flat, equal(200_00, ME, [ME, ANU])); // 100 INR
    h.db.prepare("INSERT INTO kitchen_group_settings (org_id, currency) VALUES (?, 'USD') ON CONFLICT (org_id) DO UPDATE SET currency = 'USD'").run(goa.id);
    await add(h, goa, equal(60_00, ME, [ME, ANU], { currency: "USD" })); // 30 USD
    const ask = await got(h, { fromSubjectId: ANU, amountMinor: 10_00 });
    expect(ask.status).toBe(422);
    const usd = await got(h, { fromSubjectId: ANU, amountMinor: 30_00, currency: "USD" });
    expect((await envelope<SplitecoReceivedPaymentResponse>(usd)).data).toMatchObject({ currency: "USD", payments: [expect.objectContaining({ groupId: goa.publicId })] });
    expect((await owes(h, ANU)).balances).toEqual([{ currency: "INR", amountMinor: 100_00 }]);
    const tooMuch = await got(h, { fromSubjectId: ANU, amountMinor: 100_01, currency: "INR" });
    expect(tooMuch.status).toBe(422);
  });

  it("replays an idempotent retry without writing twice, and refuses a reused key for something else", async () => {
    const { h, flat, goa } = world();
    await add(h, flat, equal(100_00, ME, [ME, ANU]));
    await add(h, goa, equal(300_00, ME, [ME, ANU]));
    const k = key();
    const first = await got(h, { fromSubjectId: ANU, amountMinor: 80_00 }, ME, k);
    expect(first.status).toBe(201);
    const a = (await envelope<SplitecoReceivedPaymentResponse>(first)).data;
    const rows = () => (h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_txns WHERE kind = 'settlement'").get() as { n: number }).n;
    expect(rows()).toBe(2);
    const again = await got(h, { fromSubjectId: ANU, amountMinor: 80_00 }, ME, k);
    expect(again.status).toBe(200);
    expect((await envelope<SplitecoReceivedPaymentResponse>(again)).data).toEqual(a);
    expect(rows()).toBe(2);
    expect((await owes(h, ANU)).balances).toEqual([{ currency: "INR", amountMinor: 120_00 }]);
    // Another person under the same key is a different request.
    const other = await got(h, { fromSubjectId: DEV, amountMinor: 80_00 }, ME, k);
    expect(other.status).toBe(409);
    expect((await envelope(other)).error.details.reason).toBe("idempotency_key_reused");
  });

  it("is never taken from an assistant", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(200_00, ME, [ME, ANU]));
    const res = await got(h, { fromSubjectId: ANU, amountMinor: 10_00 }, ME, key(), { "x-actor-delegation-id": "dlg_1" });
    expect(res.status).toBe(403);
    expect((await envelope(res)).error.details.reason).toBe("not_from_an_assistant");
    expect((await got(h, { fromSubjectId: ANU, amountMinor: 10_00 }, null as never)).status).toBe(401);
  });

  it("the person paid can still mark it not received, which puts the balance back", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(200_00, ME, [ME, ANU]));
    const { payments } = (await envelope<SplitecoReceivedPaymentResponse>(await got(h, { fromSubjectId: ANU, amountMinor: 100_00 }))).data;
    const back = await h.call("POST", `/v1/spliteco/settlements/${payments[0]!.id}/not-received`, { as: ME, headers: { "idempotency-key": key() } });
    expect(back.status).toBe(201);
    expect((await owes(h, ANU)).balances).toEqual([{ currency: "INR", amountMinor: 100_00 }]);
  });
});
