// SE2 (SE-3): settling up, "not received", simplify debts and reminders,
// through spliteco-worker's real router on SQLite beside the real
// membership-worker, kitchen-worker and policy engine.

import type {
  SplitecoFriendResponse,
  SplitecoGroupResponse,
  SplitecoProfileResponse,
  SplitecoReminderResponse,
  SplitecoSettlePlanResponse,
  SplitecoSettlementResponse,
} from "@saas/contracts/spliteco";
import { SPLITECO_EMAILS, isUpiVpa } from "@saas/contracts/spliteco";
import type { Txn } from "@saas/kitchen-engine/ledger";
import { settlePlan } from "@saas/kitchen-engine/ledger";
import { allocatePayment, pairwisePlan, planFor, plannedBetween } from "@saas/kitchen-engine/settle";
import { ANU, DEV, ME, MEERA, OUTSIDER, add, envelope, equal, key, world } from "./helpers.js";
import type { Group, Harness } from "./harness.js";

const post = (h: Harness, path: string, body: unknown, as = ME, extra: Record<string, string> = {}) =>
  h.call("POST", path, { as, body, headers: { "idempotency-key": key(), ...extra } });
const group = async (h: Harness, g: Group, as = ME) =>
  (await envelope<SplitecoGroupResponse>(await h.call("GET", `/v1/spliteco/groups/${g.publicId}`, { as }))).data;
const balanceOf = (g: SplitecoGroupResponse, id: string) => g.balances.find((b) => b.subjectId === id)?.balanceMinor ?? 0;
const settle = (h: Harness, g: Group, body: Record<string, unknown>, as: string) => post(h, `/v1/spliteco/groups/${g.publicId}/settlements`, body, as);
const types = (h: Harness) =>
  (h.db.prepare("SELECT type FROM events_event_log WHERE source = 'spliteco-worker' ORDER BY rowid").all() as { type: string }[]).map((r) => r.type);

const t = (id: string, splits: [string, number, number][]): Txn => ({
  id,
  kind: "expense",
  title: id,
  totalMinor: splits.reduce((s, [, p]) => s + p, 0),
  splits: splits.map(([subjectId, paidMinor, owedMinor]) => ({ subjectId, paidMinor, owedMinor })),
});

describe("the settle maths (kitchen-engine/settle)", () => {
  // A owes B 100 and B owes C 100: simplified, A pays C once; pair by pair, two payments.
  const chain = [t("x", [["B", 100, 0], ["A", 0, 100]]), t("y", [["C", 100, 0], ["B", 0, 100]])];

  it("simplified is the fewest payments; switched off, each pair settles its own net", () => {
    expect(planFor(chain, true)).toEqual([{ fromId: "A", toId: "C", amountMinor: 100 }]);
    expect(planFor(chain, true)).toEqual(settlePlan(chain).payments);
    expect(pairwisePlan(chain)).toEqual([
      { fromId: "A", toId: "B", amountMinor: 100 },
      { fromId: "B", toId: "C", amountMinor: 100 },
    ]);
    // Opposite debts between two people cancel even pair by pair.
    const back = [...chain, t("z", [["A", 30, 0], ["B", 0, 30]])];
    expect(plannedBetween(pairwisePlan(back), "A", "B")).toBe(70);
  });

  it("fills Kitchen first, then Other", () => {
    expect(allocatePayment({ owed: { kitchen: 860, other: 4000 }, amountMinor: 1000 })).toEqual({ ok: true, allocation: { kitchen: 860, other: 140 } });
    expect(allocatePayment({ owed: { kitchen: 860, other: 4000 }, amountMinor: 500 })).toEqual({ ok: true, allocation: { kitchen: 500, other: 0 } });
    expect(allocatePayment({ owed: { kitchen: 0, other: 4000 }, amountMinor: 4000 })).toEqual({ ok: true, allocation: { kitchen: 0, other: 4000 } });
    // A balance the payer is owed in counts as nothing owed there.
    expect(allocatePayment({ owed: { kitchen: -200, other: 300 }, amountMinor: 300 })).toEqual({ ok: true, allocation: { kitchen: 0, other: 300 } });
  });

  it("takes the payer's own split, each part within its balance", () => {
    expect(allocatePayment({ owed: { kitchen: 860, other: 4000 }, amountMinor: 1000, split: { other: 1000 } })).toEqual({ ok: true, allocation: { kitchen: 0, other: 1000 } });
    expect(allocatePayment({ owed: { kitchen: 860, other: 4000 }, amountMinor: 1000, split: { kitchen: 900, other: 100 } })).toMatchObject({ ok: false, reason: "over_owed" });
    expect(allocatePayment({ owed: { kitchen: 860, other: 4000 }, amountMinor: 1000, split: { kitchen: 500, other: 400 } })).toMatchObject({ ok: false, reason: "split_mismatch" });
  });

  it("refuses more than is owed, and a payment when nothing is", () => {
    expect(allocatePayment({ owed: { kitchen: 860, other: 4000 }, amountMinor: 4861 })).toMatchObject({ ok: false, reason: "over_owed", owed: { kitchen: 860, other: 4000 } });
    expect(allocatePayment({ owed: { kitchen: 0, other: 0 }, amountMinor: 1 })).toMatchObject({ ok: false, reason: "nothing_owed" });
  });
});

describe("POST /v1/spliteco/groups/{org}/settlements", () => {
  it("records a cash payment in one tap: balances move, the audit lands, the person paid hears of it", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(1200_00, ME, [ME, ANU, DEV, MEERA])); // each owes me 300
    const res = await settle(h, goa, { toSubjectId: ME, amountMinor: 300_00, method: "cash" }, ANU);
    expect(res.status).toBe(201);
    const { payment } = (await envelope<SplitecoSettlementResponse>(res)).data;
    expect(payment).toMatchObject({ fromSubjectId: ANU, toSubjectId: ME, amountMinor: 300_00, method: "cash", state: "recorded" });
    expect(payment.parts).toEqual([{ txnId: payment.id, bucket: "other", amountMinor: 300_00 }]);

    const g = await group(h, goa);
    expect(balanceOf(g, ANU)).toBe(0);
    expect(balanceOf(g, ME)).toBe(600_00);
    expect(g.expenses[0]).toMatchObject({ kind: "settlement", paymentMethod: "cash", locked: true });
    expect(types(h)).toContain("spliteco.settlement.recorded");

    const mail = h.sent.find((s) => s.body.templateKey === SPLITECO_EMAILS.PAID_YOU)!;
    expect(mail.internalActor).toBe("spliteco-worker");
    expect(mail.body.recipient).toMatchObject({ channel: "email", address: "you@spliteco.test", subjectId: ME });
    expect(mail.body.templateData).toMatchObject({ payerName: "Anu", amount: "₹300.00", method: "Cash", groupName: "Goa Trip" });
    expect(mail.body.templateData!.personUrl).toBe(`https://spliteco.test/friend?id=${ANU}`);
    expect(mail.body.idempotencyKey).toBe(`spliteco.paid_you:${payment.id}:${ME}`);
  });

  it("a retry with the same key posts once", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(400_00, ME, [ME, ANU]));
    const k = key();
    const first = await h.call("POST", `/v1/spliteco/groups/${goa.publicId}/settlements`, { as: ANU, body: { toSubjectId: ME, amountMinor: 100_00, method: "upi" }, headers: { "idempotency-key": k } });
    const again = await h.call("POST", `/v1/spliteco/groups/${goa.publicId}/settlements`, { as: ANU, body: { toSubjectId: ME, amountMinor: 100_00, method: "upi" }, headers: { "idempotency-key": k } });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect((await envelope<SplitecoSettlementResponse>(again)).data.payment.id).toBe((await envelope<SplitecoSettlementResponse>(first)).data.payment.id);
    expect(balanceOf(await group(h, goa), ANU)).toBe(-100_00);
  });

  it("refuses more than is owed, nothing owed, yourself and someone outside the group", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(600_00, ME, [ME, ANU, DEV]));
    const over = await settle(h, goa, { toSubjectId: ME, amountMinor: 200_01, method: "cash" }, ANU);
    expect(over.status).toBe(422);
    expect((await envelope(over)).error.details).toMatchObject({ reason: "over_settled", owedMinor: 200_00 });
    const wrongWay = await settle(h, goa, { toSubjectId: ANU, amountMinor: 100, method: "cash" }, ME);
    expect(wrongWay.status).toBe(409);
    expect((await envelope(wrongWay)).error.details.reason).toBe("nothing_owed");
    const self = await settle(h, goa, { toSubjectId: ANU, amountMinor: 100, method: "cash" }, ANU);
    expect((await envelope(self)).error.details.reason).toBe("same_person");
    const outside = await settle(h, goa, { toSubjectId: OUTSIDER, amountMinor: 100, method: "cash" }, ANU);
    expect((await envelope(outside)).error.details.reason).toBe("not_in_group");
    const method = await settle(h, goa, { toSubjectId: ME, amountMinor: 100, method: "cheque" }, ANU);
    expect(method.status).toBe(422);
    // Nothing was written.
    expect(balanceOf(await group(h, goa), ANU)).toBe(-200_00);
  });

  it("a kitchen group: a Spliteco payment settles Kitchen first, then Other, and the payer can split it", async () => {
    const { h, flat } = world();
    // Kitchen: Anu owes me 300 (Cookpool's own expense). Other: Anu owes me 1000 (Wi-Fi added in Spliteco).
    const posted = await h.kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/expenses`, {
      as: ME,
      body: { title: "Groceries", totalMinor: 600_00, mode: "equal", payers: [{ subjectId: ME, amountMinor: 600_00 }], participants: [{ subjectId: ME }, { subjectId: ANU }] },
      headers: { "idempotency-key": key() },
    });
    expect(posted.status).toBe(201);
    await add(h, flat, equal(2000_00, ME, [ME, ANU], { title: "Wi-Fi", category: "bills" }));
    const plan = (await envelope<SplitecoSettlePlanResponse>(await h.call("GET", `/v1/spliteco/groups/${flat.publicId}/settle-plan`, { as: ANU }))).data;
    expect(plan.mine).toEqual([{ toSubjectId: ME, owed: { kitchen: 300_00, other: 1000_00 } }]);

    const res = await settle(h, flat, { toSubjectId: ME, amountMinor: 500_00, method: "bank", note: "IMPS 4123" }, ANU);
    const { payment } = (await envelope<SplitecoSettlementResponse>(res)).data;
    expect(payment.parts.map((p) => [p.bucket, p.amountMinor])).toEqual([
      ["kitchen", 300_00],
      ["other", 200_00],
    ]);
    let g = await group(h, flat, ANU);
    expect(g.group.myBuckets).toEqual({ kitchen: 0, other: -800_00 });
    // The Kitchen balance is what Cookpool shows: square.
    const kitchenRows = h.db.prepare("SELECT bucket, total_minor, method, note FROM kitchen_txns WHERE kind = 'settlement' ORDER BY rowid").all();
    expect(kitchenRows).toEqual([
      { bucket: "kitchen", total_minor: 300_00, method: "bank", note: "IMPS 4123" },
      { bucket: "other", total_minor: 200_00, method: "bank", note: "IMPS 4123" },
    ]);

    // Split by hand: all of it to Other.
    const own = await settle(h, flat, { toSubjectId: ME, amountMinor: 300_00, method: "cash", split: { other: 300_00 } }, ANU);
    expect((await envelope<SplitecoSettlementResponse>(own)).data.payment.parts).toEqual([expect.objectContaining({ bucket: "other", amountMinor: 300_00 })]);
    g = await group(h, flat, ANU);
    expect(g.group.myBuckets).toEqual({ kitchen: 0, other: -500_00 });
    // More than a balance holds, or parts that don't add up, are refused.
    const tooMuchKitchen = await settle(h, flat, { toSubjectId: ME, amountMinor: 100_00, method: "cash", split: { kitchen: 100_00 } }, ANU);
    expect((await envelope(tooMuchKitchen)).error.details.reason).toBe("over_settled");
    const mismatch = await settle(h, flat, { toSubjectId: ME, amountMinor: 100_00, method: "cash", split: { other: 50_00 } }, ANU);
    expect((await envelope(mismatch)).error.details.reason).toBe("split_mismatch");
  });

  it("is never taken from an assistant, nor from a viewer", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(400_00, ME, [ME, ANU]));
    const viaAssistant = await post(h, `/v1/spliteco/groups/${goa.publicId}/settlements`, { toSubjectId: ME, amountMinor: 100_00, method: "cash" }, ANU, {
      "x-actor-delegation-id": "dlg_1",
    });
    expect(viaAssistant.status).toBe(403);
    expect((await envelope(viaAssistant)).error.details.reason).toBe("not_from_an_assistant");
    h.grant(ANU, goa, "viewer");
    const viewer = await settle(h, goa, { toSubjectId: ME, amountMinor: 100_00, method: "cash" }, ANU);
    expect(viewer.status).toBe(404);
  });
});

describe("POST /v1/spliteco/settlements/{txn}/not-received", () => {
  it("only the person paid can say it; it reverses every part of the payment", async () => {
    const { h, flat } = world();
    await h.kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/expenses`, {
      as: ME,
      body: { title: "Groceries", totalMinor: 600_00, mode: "equal", payers: [{ subjectId: ME, amountMinor: 600_00 }], participants: [{ subjectId: ME }, { subjectId: ANU }] },
      headers: { "idempotency-key": key() },
    });
    await add(h, flat, equal(2000_00, ME, [ME, ANU]));
    const { payment } = (await envelope<SplitecoSettlementResponse>(await settle(h, flat, { toSubjectId: ME, amountMinor: 500_00, method: "upi" }, ANU))).data;
    const second = payment.parts[1]!.txnId;

    const byPayer = await post(h, `/v1/spliteco/settlements/${payment.id}/not-received`, {}, ANU);
    expect(byPayer.status).toBe(403);
    expect((await envelope(byPayer)).error.details.reason).toBe("not_the_payee");
    const byOther = await post(h, `/v1/spliteco/settlements/${payment.id}/not-received`, {}, DEV);
    expect(byOther.status).toBe(403);
    const byOutsider = await post(h, `/v1/spliteco/settlements/${payment.id}/not-received`, {}, OUTSIDER);
    expect(byOutsider.status).toBe(404);

    // Either part's id works; both parts are reversed.
    const res = await post(h, `/v1/spliteco/settlements/${second}/not-received`, {}, ME);
    expect(res.status).toBe(201);
    expect((await envelope<SplitecoSettlementResponse>(res)).data.payment).toMatchObject({ id: payment.id, state: "not_received" });
    const g = await group(h, flat, ANU);
    expect(g.group.myBuckets).toEqual({ kitchen: -300_00, other: -1000_00 });
    expect(g.expenses.some((e) => e.kind === "settlement")).toBe(false);
    expect(types(h)).toEqual(expect.arrayContaining(["spliteco.settlement.recorded", "spliteco.settlement.not_received"]));

    const again = await post(h, `/v1/spliteco/settlements/${payment.id}/not-received`, {}, ME);
    expect(again.status).toBe(409);
    expect((await envelope(again)).error.details.reason).toBe("already_reversed");
  });

  it("refuses anything that is not a payment", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(400_00, ME, [ME, ANU]));
    const res = await post(h, `/v1/spliteco/settlements/${e.id}/not-received`, {}, ME);
    expect(res.status).toBe(409);
    expect((await envelope(res)).error.details.reason).toBe("not_a_settlement");
  });
});

describe("simplify debts, per group", () => {
  async function chain() {
    const w = world();
    // Anu owes Dev 100; Dev owes me 100. Simplified: Anu pays me.
    await add(w.h, w.goa, equal(100_00, DEV, [ANU]));
    await add(w.h, w.goa, equal(100_00, ME, [DEV]));
    return w;
  }

  it("is on by default; switched off, the plan is pair by pair, and payments follow the plan", async () => {
    const { h, goa } = await chain();
    let g = await group(h, goa, ANU);
    expect(g.settings).toEqual({ simplifyDebts: true });
    expect(g.plan).toEqual([{ fromSubjectId: ANU, toSubjectId: ME, amountMinor: 100_00 }]);
    // Under the simplified plan Anu pays me, not Dev.
    expect((await envelope(await settle(h, goa, { toSubjectId: DEV, amountMinor: 100_00, method: "cash" }, ANU))).error.details.reason).toBe("nothing_owed");

    const off = await h.call("PUT", `/v1/spliteco/groups/${goa.publicId}/settings`, { as: ME, body: { simplifyDebts: false } });
    expect(off.status).toBe(200);
    g = await group(h, goa, ANU);
    expect(g.settings).toEqual({ simplifyDebts: false });
    expect(g.plan).toEqual([
      { fromSubjectId: ANU, toSubjectId: DEV, amountMinor: 100_00 },
      { fromSubjectId: DEV, toSubjectId: ME, amountMinor: 100_00 },
    ]);
    const plan = (await envelope<SplitecoSettlePlanResponse>(await h.call("GET", `/v1/spliteco/groups/${goa.publicId}/settle-plan`, { as: ANU }))).data;
    expect(plan).toMatchObject({ simplifyDebts: false, buckets: [{ bucket: "other", pairs: 2 }] });
    expect(plan.mine).toEqual([{ toSubjectId: DEV, owed: { kitchen: 0, other: 100_00 } }]);
    expect((await settle(h, goa, { toSubjectId: DEV, amountMinor: 100_00, method: "cash" }, ANU)).status).toBe(201);
  });

  it("a viewer cannot switch it", async () => {
    const { h, goa } = world();
    h.grant(MEERA, goa, "viewer");
    const res = await h.call("PUT", `/v1/spliteco/groups/${goa.publicId}/settings`, { as: MEERA, body: { simplifyDebts: false } });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/spliteco/reminders", () => {
  it("sends at most once per person per 24 hours, by email (and push) through notifications-worker", async () => {
    let at = new Date("2026-11-12T09:00:00.000Z");
    const { h, goa } = world({ deps: { now: () => at } });
    await add(h, goa, equal(1240_00, ME, [ME, ANU]));
    const res = await post(h, "/v1/spliteco/reminders", { to: ANU }, ME);
    expect(res.status).toBe(201);
    const body = (await envelope<SplitecoReminderResponse>(res)).data;
    expect(body).toMatchObject({ delivered: true, reminder: { groupId: goa.publicId, toSubjectId: ANU, amountMinor: 620_00, sentAt: at.toISOString(), nextAllowedAt: "2026-11-13T09:00:00.000Z" } });
    const mail = h.sent.find((s) => s.body.templateKey === SPLITECO_EMAILS.REMINDER)!;
    expect(mail.body.recipient).toMatchObject({ address: "anu@spliteco.test", subjectId: ANU });
    expect(mail.body.templateData).toMatchObject({ fromName: "You", amount: "₹620.00", groupName: "Goa Trip" });
    expect(mail.body.templateData!.payUrl).toBe(`https://spliteco.test/settle?group=${goa.publicId}&to=${ME}`);
    expect(types(h)).toContain("spliteco.reminder.sent");

    at = new Date("2026-11-13T08:59:00.000Z");
    const soon = await post(h, "/v1/spliteco/reminders", { to: ANU, groupId: goa.publicId }, ME);
    expect(soon.status).toBe(409);
    expect((await envelope(soon)).error.details).toMatchObject({ reason: "reminded_recently", lastSentAt: "2026-11-12T09:00:00.000Z", nextAllowedAt: "2026-11-13T09:00:00.000Z" });
    expect(h.sent.filter((s) => s.body.templateKey === SPLITECO_EMAILS.REMINDER)).toHaveLength(1);

    // "Last reminded" shows on the friend and group screens.
    const friend = (await envelope<SplitecoFriendResponse>(await h.call("GET", `/v1/spliteco/me/friends/${ANU}`, { as: ME }))).data;
    expect(friend.lastRemindedAt).toBe("2026-11-12T09:00:00.000Z");
    expect((await group(h, goa)).reminded).toEqual([{ subjectId: ANU, sentAt: "2026-11-12T09:00:00.000Z" }]);

    at = new Date("2026-11-13T09:00:01.000Z");
    expect((await post(h, "/v1/spliteco/reminders", { to: ANU }, ME)).status).toBe(201);
    expect(h.sent.filter((s) => s.body.templateKey === SPLITECO_EMAILS.REMINDER)).toHaveLength(2);
  });

  it("refuses someone who owes you nothing, and someone you share no group with", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(400_00, ME, [ME, ANU]));
    const nothing = await post(h, "/v1/spliteco/reminders", { to: ANU }, DEV);
    expect(nothing.status).toBe(409);
    expect((await envelope(nothing)).error.details.reason).toBe("nothing_owed");
    // Anu owes me; I owe Anu nothing, so Anu can't remind me.
    expect((await post(h, "/v1/spliteco/reminders", { to: ME }, ANU)).status).toBe(409);
    expect((await post(h, "/v1/spliteco/reminders", { to: OUTSIDER }, ME)).status).toBe(404);
    expect((await post(h, "/v1/spliteco/reminders", { to: ME }, ME)).status).toBe(404);
    expect(h.sent.filter((s) => s.body.templateKey === SPLITECO_EMAILS.REMINDER)).toHaveLength(0);
  });
});

describe("your UPI ID", () => {
  it("is validated, and only people who share a group see it", async () => {
    const { h, goa } = world();
    expect((await envelope<SplitecoProfileResponse>(await h.call("GET", "/v1/spliteco/me/profile", { as: DEV }))).data.profile).toEqual({ upiVpa: null, defaultCurrency: "INR" });
    for (const bad of ["devk", "devk@", "@okaxis", "dev k@okaxis", "devk@ok-axis", "a@b", "javascript:alert(1)@x"]) {
      const res = await h.call("PUT", "/v1/spliteco/me/profile", { as: DEV, body: { upiVpa: bad } });
      expect([bad, res.status]).toEqual([bad, 422]);
    }
    const ok = await h.call("PUT", "/v1/spliteco/me/profile", { as: DEV, body: { upiVpa: "devk@okaxis" } });
    expect((await envelope<SplitecoProfileResponse>(ok)).data.profile.upiVpa).toBe("devk@okaxis");
    expect(isUpiVpa("98100.12345@ybl")).toBe(true);

    expect((await group(h, goa, ANU)).upi).toEqual([{ subjectId: DEV, upiVpa: "devk@okaxis" }]);
    const friend = (await envelope<SplitecoFriendResponse>(await h.call("GET", `/v1/spliteco/me/friends/${DEV}`, { as: ANU }))).data;
    expect(friend.upiVpa).toBe("devk@okaxis");
    // Someone outside every group of Dev's reads nothing.
    expect((await h.call("GET", `/v1/spliteco/me/friends/${DEV}`, { as: OUTSIDER })).status).toBe(404);
    expect((await h.call("GET", `/v1/spliteco/groups/${goa.publicId}`, { as: OUTSIDER })).status).toBe(404);

    // Removing it.
    await h.call("PUT", "/v1/spliteco/me/profile", { as: DEV, body: { upiVpa: null } });
    expect((await group(h, goa, ANU)).upi).toEqual([]);
  });

  it("is set only by the person, never through an assistant", async () => {
    const { h } = world();
    const res = await h.call("PUT", "/v1/spliteco/me/profile", { as: DEV, body: { upiVpa: "devk@okaxis" }, headers: { "x-actor-delegation-id": "dlg_1" } });
    expect(res.status).toBe(403);
  });
});
