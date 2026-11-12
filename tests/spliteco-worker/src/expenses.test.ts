/* eslint-disable @typescript-eslint/no-explicit-any -- loose reads of JSON envelopes in tests */
// spliteco-worker's expense writes and reads against a real SQLite engine,
// beside the real membership-worker and kitchen-worker (SE-2 doneWhen 2–4).

import type {
  SplitecoActivityResponse,
  SplitecoExpenseResponse,
  SplitecoGroupResponse,
  SplitecoWriteResponse,
} from "@saas/contracts/spliteco";
import type { BalancesResponse } from "@saas/contracts/kitchen";
import { ANU, DEV, ME, MEERA, OUTSIDER, add, envelope, equal, key, world } from "./helpers.js";
import type { Harness, Group } from "./harness.js";

const post = (h: Harness, path: string, body: unknown, as = ME, k = key()) =>
  h.call("POST", path, { as, body, headers: { "idempotency-key": k } });
const group = async (h: Harness, g: Group, as = ME) =>
  (await envelope<SplitecoGroupResponse>(await h.call("GET", `/v1/spliteco/groups/${g.publicId}`, { as }))).data;
const balanceOf = (g: SplitecoGroupResponse, id: string) => g.balances.find((b) => b.subjectId === id)?.balanceMinor ?? 0;

describe("the six splits", () => {
  it("equal, exact, pct, shares and adjust save and split to the paisa", async () => {
    const { h, goa } = world();
    const cases = [
      { method: "equal", participants: [ME, ANU, DEV] },
      { method: "exact", participants: [{ subjectId: ME, amountMinor: 3000 }, { subjectId: ANU, amountMinor: 4000 }, { subjectId: DEV, amountMinor: 3001 }] },
      { method: "pct", participants: [{ subjectId: ME, basisPoints: 3333 }, { subjectId: ANU, basisPoints: 3333 }, { subjectId: DEV, basisPoints: 3334 }] },
      { method: "shares", participants: [{ subjectId: ME, shares: 1 }, { subjectId: ANU, shares: 1 }, { subjectId: MEERA, shares: 2 }] },
      { method: "adjust", participants: [{ subjectId: ME, adjustMinor: 0 }, { subjectId: ANU, adjustMinor: 1200 }, { subjectId: DEV, adjustMinor: -200 }] },
    ] as const;
    for (const split of cases) {
      const e = await add(h, goa, { title: `Split ${split.method}`, totalMinor: 10001, payers: [{ subjectId: ANU, amountMinor: 10001 }], split: split as never });
      expect(e.method).toBe(split.method);
      expect(e.splits.reduce((s, x) => s + x.owedMinor, 0)).toBe(10001);
      expect(e.splits.reduce((s, x) => s + x.paidMinor, 0)).toBe(10001);
    }
    const shares = (await group(h, goa)).expenses.find((x) => x.method === "shares")!;
    expect(shares.splits.find((s) => s.subjectId === MEERA)!.owedMinor).toBe(5001);
    const adjust = (await group(h, goa)).expenses.find((x) => x.method === "adjust")!;
    // 10 001 − 1 000 adjusted = 9 001 equally (3 001, 3 000, 3 000), then +1 200 and −200.
    expect(adjust.splits.find((s) => s.subjectId === ANU)!.owedMinor).toBe(3000 + 1200);
    expect(adjust.splits.find((s) => s.subjectId === DEV)!.owedMinor).toBe(3000 - 200);
  });

  it("itemized with portions, % and exact per person plus tax, service and a discount", async () => {
    const { h, goa } = world();
    const body = {
      title: "Beach shack dinner",
      totalMinor: 84000 + 4200 + 8400 - 1000,
      category: "food",
      payers: [{ subjectId: ANU, amountMinor: 95600 }],
      split: {
        method: "items",
        items: [
          { name: "Fish thali", qty: 2, unitMinor: 42000 / 2, totalMinor: 42000, shares: [{ subjectId: ME, mode: "portion", value: 1000 }, { subjectId: DEV, mode: "portion", value: 1000 }] },
          { name: "Kingfisher", qty: 6, unitMinor: 3000, totalMinor: 18000, shares: [{ subjectId: ME, mode: "portion", value: 2000 }, { subjectId: ANU, mode: "pct", value: 2500 }, { subjectId: MEERA, mode: "portion", value: 333 }] },
          { name: "Bebinca", qty: 1, totalMinor: 24000, shares: [{ subjectId: MEERA, mode: "exact", value: 10000 }, { subjectId: ANU, mode: "portion", value: 500 }, { subjectId: DEV, mode: "portion", value: 500 }] },
        ],
        adjustments: [
          { kind: "tax", label: "GST 5%", amountMinor: 4200 },
          { kind: "service", label: "Service 10%", amountMinor: 8400 },
          { kind: "discount", label: "Happy hour", amountMinor: 1000 },
        ],
      },
    };
    const e = await add(h, goa, body as never);
    expect(e.method).toBe("items");
    expect(e.splits.reduce((s, x) => s + x.owedMinor, 0)).toBe(95600);
    const detail = (await envelope<SplitecoExpenseResponse>(await h.call("GET", `/v1/spliteco/expenses/${e.id}`, { as: ME }))).data;
    expect(detail.expense.items).toHaveLength(3);
    expect(detail.expense.adjustments.map((a) => a.kind)).toEqual(["tax", "service", "discount"]);
    const bebinca = detail.expense.items[2]!;
    expect(bebinca.shares.find((s) => s.subjectId === MEERA)!.amountMinor).toBe(10000);
    expect(bebinca.shares.reduce((s, x) => s + x.amountMinor, 0)).toBe(24000);
    const lines = detail.expense.breakdown;
    expect(lines.reduce((s, b) => s + b.itemsMinor, 0)).toBe(84000);
    expect(lines.reduce((s, b) => s + b.adjustmentsMinor, 0)).toBe(11600);
    for (const b of lines) expect(b.owedMinor).toBe(e.splits.find((s) => s.subjectId === b.subjectId)?.owedMinor ?? 0);
    expect(detail.expense.input?.split.method).toBe("items");
  });

  it("refuses a split that does not add up, with the engine's problems", async () => {
    const { h, goa } = world();
    const path = `/v1/spliteco/groups/${goa.publicId}/expenses`;
    const exact = await post(h, path, { title: "x", totalMinor: 1000, payers: [{ subjectId: ME, amountMinor: 1000 }], split: { method: "exact", participants: [{ subjectId: ME, amountMinor: 900 }] } });
    expect(exact.status).toBe(422);
    expect((await envelope(exact)).error.details).toMatchObject({ reason: "does_not_add_up", problems: [{ kind: "total_mismatch" }] });
    const item = await post(h, path, {
      title: "x",
      totalMinor: 1000,
      payers: [{ subjectId: ME, amountMinor: 1000 }],
      split: { method: "items", items: [{ name: "a", totalMinor: 1000, shares: [{ subjectId: ME, mode: "exact", value: 400 }] }], adjustments: [] },
    });
    expect((await envelope(item)).error.details).toMatchObject({ reason: "does_not_add_up", problems: [{ kind: "item_unassigned", item: 0, amountMinor: 600 }] });
    const payers = await post(h, path, { ...equal(1000, ME, [ME, ANU]), payers: [{ subjectId: ME, amountMinor: 999 }] });
    expect((await envelope(payers)).error.details).toMatchObject({ reason: "does_not_add_up", problems: [{ kind: "payers_mismatch" }] });
    const outsider = await post(h, path, equal(1000, ME, [ME, OUTSIDER]));
    expect(outsider.status).toBe(422);
    expect((await envelope(outsider)).error.details).toMatchObject({ reason: "not_in_group", subjectIds: [OUTSIDER] });
  });

  it("several payers", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, { ...equal(2960_00, ME, [ME, ANU, DEV, MEERA]), payers: [{ subjectId: ME, amountMinor: 2220_00 }, { subjectId: ANU, amountMinor: 740_00 }] });
    expect(e.payers).toEqual([{ subjectId: ME, paidMinor: 2220_00 }, { subjectId: ANU, paidMinor: 740_00 }]);
    const g = await group(h, goa);
    expect(balanceOf(g, ME)).toBe(2220_00 - 740_00);
    expect(balanceOf(g, ANU)).toBe(0);
  });
});

describe("balances match Cookpool's to the paisa", () => {
  it("the Kitchen balance is kitchen-worker's; Other is what Spliteco added; the total is the whole ledger", async () => {
    const { h, flat, goa: trip } = world();
    const kitchenBody = { title: "Groceries", totalMinor: 1001, mode: "equal", payers: [{ subjectId: ANU, amountMinor: 1001 }], participants: [{ subjectId: ME }, { subjectId: ANU }, { subjectId: DEV }] };
    const posted = await h.kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/expenses`, { as: ANU, body: kitchenBody, headers: { "idempotency-key": key() } });
    expect(posted.status).toBe(201);
    const kitchen = async () =>
      (await envelope<BalancesResponse>(await h.kitchen("GET", `/v1/organizations/${flat.publicId}/kitchen/balances`, { as: ME }))).data.balances;

    let g = await group(h, flat);
    const kitchenBucket = () => g.buckets!.find((b) => b.bucket === "kitchen")!;
    expect(kitchenBucket().balances).toEqual(await kitchen());
    expect(g.balances).toEqual(await kitchen());
    expect(g.group.myBuckets).toEqual({ kitchen: -334, other: 0 });

    // Rent added in Spliteco counts toward Other only.
    await add(h, flat, equal(30000, ME, [ME, ANU, DEV], { title: "Wi-Fi", category: "bills" }));
    const before = kitchenBucket().balances;
    g = await group(h, flat);
    expect(kitchenBucket().balances).toEqual(before);
    expect(g.group.myBuckets).toEqual({ kitchen: -334, other: 20000 });
    expect(g.group.myBalanceMinor).toBe(-334 + 20000);
    // kitchen-worker (unchanged in SE1) still sums the whole ledger: the total matches it.
    expect(g.balances).toEqual(await kitchen());
    // A Spliteco-made group has one balance.
    expect((await group(h, trip)).buckets).toBeNull();
  });

  it("Home and the friend view add up the same pairwise lines across groups", async () => {
    const { h, flat, goa } = world();
    await add(h, goa, equal(9000, ME, [ME, ANU, DEV]));
    await add(h, flat, equal(600, ANU, [ME, ANU, DEV]));
    const home = (await envelope<any>(await h.call("GET", "/v1/spliteco/me/home", { as: ME }))).data;
    // Anu: +3 000 in Goa, −200 in the flat (she paid there); Dev: +3 000 in Goa.
    expect(home.totals).toEqual([{ currency: "INR", owedToYouMinor: 5800, youOweMinor: 0, netMinor: 5800 }]);
    const anu = home.people.find((p: any) => p.subjectId === ANU);
    expect(anu.balances).toEqual([{ currency: "INR", amountMinor: 3000 - 200 }]);
    const friend = (await envelope<any>(await h.call("GET", `/v1/spliteco/me/friends/${ANU}`, { as: ME }))).data;
    expect(friend.balances).toEqual([{ currency: "INR", amountMinor: 2800 }]);
    expect(friend.byGroup.map((b: any) => b.amountMinor).sort()).toEqual([-200, 3000]);
    expect(friend.expenses).toHaveLength(2);
  });
});

describe("edit, delete, restore and move", () => {
  it("an edit reverses the old version, posts the new one and shows in Activity", async () => {
    const { h, goa } = world();
    const first = await add(h, goa, equal(3000, ME, [ME, ANU, DEV], { title: "Airport cab" }));
    const res = await h.call("PUT", `/v1/spliteco/expenses/${first.id}`, { as: ANU, body: equal(3600, ME, [ME, ANU, DEV], { title: "Airport cab" }), headers: { "idempotency-key": key() } });
    expect(res.status).toBe(200);
    const edited = (await envelope<SplitecoWriteResponse>(res)).data.expense;
    expect(edited.id).not.toBe(first.id);
    const g = await group(h, goa);
    expect(g.expenses.map((e) => e.id)).toEqual([edited.id]);
    expect(balanceOf(g, ME)).toBe(2400);
    // The old version is not current any more.
    const again = await h.call("PUT", `/v1/spliteco/expenses/${first.id}`, { as: ME, body: equal(1, ME, [ME]), headers: { "idempotency-key": key() } });
    expect(again.status).toBe(409);
    expect((await envelope(again)).error.details).toMatchObject({ reason: "not_current", currentId: edited.id });
    const old = (await envelope<SplitecoExpenseResponse>(await h.call("GET", `/v1/spliteco/expenses/${first.id}`, { as: ME }))).data;
    expect(old.expense).toMatchObject({ state: "replaced", currentId: edited.id });
    const now = (await envelope<SplitecoExpenseResponse>(await h.call("GET", `/v1/spliteco/expenses/${edited.id}`, { as: ME }))).data;
    expect(now.history.map((s) => s.action)).toEqual(["added", "edited"]);
    const activity = (await envelope<SplitecoActivityResponse>(await h.call("GET", `/v1/spliteco/groups/${goa.publicId}/activity`, { as: ME }))).data;
    expect(activity.entries.map((e) => e.action)).toEqual(["edited", "added"]);
    expect(activity.entries[0]).toMatchObject({ previousTotalMinor: 3000, totalMinor: 3600, actorId: ANU });
  });

  it("a delete is a reversal, restorable for 30 days, and both show in Activity", async () => {
    let clock = new Date("2026-11-01T10:00:00.000Z");
    const { h, goa } = world({ deps: { now: () => clock } });
    const e = await add(h, goa, equal(3000, ME, [ME, ANU, DEV]));
    const del = await h.call("DELETE", `/v1/spliteco/expenses/${e.id}`, { as: ME, headers: { "idempotency-key": key() } });
    expect(del.status).toBe(200);
    expect(balanceOf(await group(h, goa), ME)).toBe(0);
    const detail = (await envelope<SplitecoExpenseResponse>(await h.call("GET", `/v1/spliteco/expenses/${e.id}`, { as: ME }))).data;
    expect(detail.expense).toMatchObject({ state: "deleted", restorableUntil: "2026-12-01T10:00:00.000Z" });

    clock = new Date("2026-11-20T10:00:00.000Z");
    const restored = await post(h, `/v1/spliteco/expenses/${e.id}/restore`, undefined);
    expect(restored.status).toBe(201);
    expect(balanceOf(await group(h, goa), ME)).toBe(2000);
    const actions = (await envelope<SplitecoActivityResponse>(await h.call("GET", "/v1/spliteco/me/activity", { as: ME }))).data.entries.map((x) => x.action);
    expect(actions).toEqual(["restored", "deleted", "added"]);
    // Restoring twice is refused.
    const twice = await post(h, `/v1/spliteco/expenses/${e.id}/restore`, undefined);
    expect((await envelope(twice)).error.details.reason).toBe("not_current");
  });

  it("refuses a restore after 30 days", async () => {
    let clock = new Date("2026-11-01T10:00:00.000Z");
    const { h, goa } = world({ deps: { now: () => clock } });
    const e = await add(h, goa, equal(3000, ME, [ME, ANU]));
    await h.call("DELETE", `/v1/spliteco/expenses/${e.id}`, { as: ME, headers: { "idempotency-key": key() } });
    clock = new Date("2026-12-02T10:00:00.000Z");
    const late = await post(h, `/v1/spliteco/expenses/${e.id}/restore`, undefined);
    expect(late.status).toBe(409);
    expect((await envelope(late)).error.details.reason).toBe("restore_expired");
  });

  it("moves only into a group where everyone on it is a member, and changes both groups' balances", async () => {
    const { h, flat, goa } = world();
    const movie = await add(h, goa, equal(64000, ME, [ME, MEERA], { title: "Movie night" }));
    const refused = await post(h, `/v1/spliteco/expenses/${movie.id}/move`, { toGroupId: flat.publicId });
    expect(refused.status).toBe(409);
    expect((await envelope(refused)).error.details).toMatchObject({ reason: "not_members", subjectIds: [MEERA] });

    const pair = await add(h, goa, equal(1000, ME, [ME, ANU], { title: "Chai" }));
    const moved = await post(h, `/v1/spliteco/expenses/${pair.id}/move`, { toGroupId: flat.publicId });
    expect(moved.status).toBe(201);
    const inFlat = (await envelope<SplitecoWriteResponse>(moved)).data.expense;
    expect(inFlat).toMatchObject({ groupId: flat.publicId, bucket: "other", title: "Chai" });
    expect(balanceOf(await group(h, flat), ANU)).toBe(-500);
    expect(balanceOf(await group(h, goa), ANU)).toBe(0);
    const activity = (await envelope<SplitecoActivityResponse>(await h.call("GET", "/v1/spliteco/me/activity", { as: ME }))).data.entries;
    expect(activity[0]).toMatchObject({ action: "moved_in", groupId: flat.publicId, otherGroupId: goa.publicId, otherGroupName: "Goa Trip" });
    const goaOnly = (await envelope<SplitecoActivityResponse>(await h.call("GET", `/v1/spliteco/groups/${goa.publicId}/activity`, { as: ME }))).data.entries;
    expect(goaOnly[0]).toMatchObject({ action: "moved_out", otherGroupId: flat.publicId });
    const same = await post(h, `/v1/spliteco/expenses/${inFlat.id}/move`, { toGroupId: flat.publicId });
    expect((await envelope(same)).error.details.reason).toBe("same_group");
  });

  it("Cookpool's rows are read-only here", async () => {
    const { h, flat } = world();
    const res = await h.kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/expenses`, {
      as: ANU,
      body: { title: "Rice", totalMinor: 900, mode: "equal", payers: [{ subjectId: ANU, amountMinor: 900 }], participants: [{ subjectId: ME }, { subjectId: ANU }] },
      headers: { "idempotency-key": key() },
    });
    const txnId = (await envelope<any>(res)).data.txn.id as string;
    const g = await group(h, flat);
    expect(g.expenses[0]).toMatchObject({ id: txnId, app: "cookpool", bucket: "kitchen", locked: true });
    for (const [method, path, body] of [
      ["PUT", `/v1/spliteco/expenses/${txnId}`, equal(900, ANU, [ME, ANU])],
      ["DELETE", `/v1/spliteco/expenses/${txnId}`, undefined],
      ["POST", `/v1/spliteco/expenses/${txnId}/move`, { toGroupId: g.group.id }],
    ] as const) {
      const r = await h.call(method, path, { as: ME, body, headers: { "idempotency-key": key() } });
      expect(r.status).toBe(409);
      expect((await envelope(r)).error.details.reason).toBe("owned_by_cookpool");
    }
    const activity = (await envelope<SplitecoActivityResponse>(await h.call("GET", "/v1/spliteco/me/activity", { as: ME }))).data.entries;
    expect(activity[0]).toMatchObject({ action: "cookpool", txnId });
  });

  it("writes each change's audit event in its own batch", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(3000, ME, [ME, ANU]));
    const edited = (await envelope<SplitecoWriteResponse>(
      await h.call("PUT", `/v1/spliteco/expenses/${e.id}`, { as: ME, body: equal(4000, ME, [ME, ANU]), headers: { "idempotency-key": key() } }),
    )).data.expense;
    await h.call("DELETE", `/v1/spliteco/expenses/${edited.id}`, { as: ME, headers: { "idempotency-key": key() } });
    await post(h, `/v1/spliteco/expenses/${edited.id}/restore`, undefined);
    const types = (h.db.prepare("SELECT type FROM events_event_log WHERE source = 'spliteco-worker' ORDER BY rowid").all() as { type: string }[]).map((r) => r.type);
    expect(types).toEqual(["spliteco.expense.added", "spliteco.expense.edited", "spliteco.expense.deleted", "spliteco.expense.restored"]);
  });

  it("a retry with the same key posts once", async () => {
    const { h, goa } = world();
    const k = key();
    const path = `/v1/spliteco/groups/${goa.publicId}/expenses`;
    const a = await post(h, path, equal(3000, ME, [ME, ANU]), ME, k);
    const b = await post(h, path, equal(3000, ME, [ME, ANU]), ME, k);
    expect((await envelope<SplitecoWriteResponse>(a)).data.expense.id).toBe((await envelope<SplitecoWriteResponse>(b)).data.expense.id);
    expect((await group(h, goa)).expenses).toHaveLength(1);
  });

  it("two edits of the same version: the second is refused", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(3000, ME, [ME, ANU]));
    // Another edit lands between this request's read and its write.
    h.beforeNextBatch((db) => {
      db.exec(`INSERT INTO kitchen_txns (id, org_id, kind, title, total_minor, currency, occurred_at, created_by, reverses, idem_key, app, bucket)
               SELECT '00000000-0000-4000-8000-0000000000aa', org_id, 'reversal', title, total_minor, currency, occurred_at, created_by, id, 'race', 'spliteco', 'other'
               FROM kitchen_txns WHERE kind = 'expense'`);
      db.exec(`INSERT INTO kitchen_txn_splits (txn_id, subject_id, position, paid_minor, owed_minor)
               SELECT '00000000-0000-4000-8000-0000000000aa', subject_id, position, owed_minor, paid_minor FROM kitchen_txn_splits`);
    });
    const r = await h.call("PUT", `/v1/spliteco/expenses/${e.id}`, { as: ME, body: equal(4000, ME, [ME, ANU]), headers: { "idempotency-key": key() } });
    expect(r.status).toBe(409);
    expect((await envelope(r)).error.details.reason).toBe("not_current");
  });
});

describe("who may", () => {
  it("answers an outsider with the opaque 404 and lets a viewer read but not write", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(3000, ME, [ME, ANU]));
    expect((await h.call("GET", `/v1/spliteco/groups/${goa.publicId}`, { as: OUTSIDER })).status).toBe(404);
    expect((await h.call("GET", `/v1/spliteco/expenses/${e.id}`, { as: OUTSIDER })).status).toBe(404);
    h.grant(MEERA, goa, "viewer");
    expect((await h.call("GET", `/v1/spliteco/groups/${goa.publicId}`, { as: MEERA })).status).toBe(200);
    expect((await post(h, `/v1/spliteco/groups/${goa.publicId}/expenses`, equal(100, MEERA, [MEERA]), MEERA)).status).toBe(404);
    expect((await h.call("GET", "/v1/spliteco/me/home", { as: null })).status).toBe(401);
  });
});

describe("comments", () => {
  it("adds a comment that shows on every version", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(3000, ME, [ME, DEV]));
    const c = await post(h, `/v1/spliteco/expenses/${e.id}/comments`, { body: "Two of those beers were Meera's" }, DEV);
    expect(c.status).toBe(201);
    const edited = (await envelope<SplitecoWriteResponse>(
      await h.call("PUT", `/v1/spliteco/expenses/${e.id}`, { as: ME, body: equal(3200, ME, [ME, DEV]), headers: { "idempotency-key": key() } }),
    )).data.expense;
    const detail = (await envelope<SplitecoExpenseResponse>(await h.call("GET", `/v1/spliteco/expenses/${edited.id}`, { as: ME }))).data;
    expect(detail.comments.map((x) => x.body)).toEqual(["Two of those beers were Meera's"]);
    expect(detail.people.find((p) => p.subjectId === DEV)?.name).toBe("Dev");
    expect((await post(h, `/v1/spliteco/expenses/${e.id}/comments`, { body: "" })).status).toBe(422);
  });
});
