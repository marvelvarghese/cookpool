// SE4 (SE-5): the live split — open from an itemized draft, claim items, see
// who is here, and lock it into ONE itemized expense — through
// spliteco-worker's real router on SQLite beside the real membership-worker
// and policy engine.

import type { SplitecoExpenseResponse, SplitecoGroupResponse, SplitecoLiveOpenRequest, SplitecoLiveResponse } from "@saas/contracts/spliteco";
import { SPLITECO_ERROR_REASONS, formatLiveCode, liveDraftTotal, normalizeLiveCode } from "@saas/contracts/spliteco";
import { buildSplitecoSplits } from "@saas/kitchen-engine/splits";
import { ANU, DEV, ME, MEERA, OUTSIDER, envelope, key, world } from "./helpers.js";
import type { Group, Harness } from "./harness.js";

// A asymmetric bill, so the paisa land somewhere checkable:
//   Prawn curry ₹10.00 (me) · Kingfisher ×4 ₹20.00 (Anu 1, Dev 3) · Naan ₹9.99 (all three) · GST ₹1.01
//   items: me 13.33, Anu 8.33, Dev 18.33 → GST by items 34 / 21 / 46 paise.
const DRAFT: SplitecoLiveOpenRequest = {
  title: "Beach shack dinner",
  category: "food",
  payers: [{ subjectId: ME, amountMinor: 4100 }],
  items: [
    { name: "Prawn curry", totalMinor: 1000 },
    { name: "Kingfisher", qty: 4, unitMinor: 500, totalMinor: 2000 },
    { name: "Garlic naan", totalMinor: 999 },
  ],
  adjustments: [{ kind: "tax", label: "GST", amountMinor: 101 }],
};

const open = (h: Harness, g: Group, body: unknown = DRAFT, as = ME) =>
  h.call("POST", `/v1/spliteco/groups/${g.publicId}/live`, { as, body, headers: { "idempotency-key": key() } });
const read = (h: Harness, code: string, as = ME) => h.call("GET", `/v1/spliteco/live/${code}`, { as });
const claim = (h: Harness, code: string, body: Record<string, unknown>, as = ME) =>
  h.call("POST", `/v1/spliteco/live/${code}/claims`, { as, body, headers: { "idempotency-key": key() } });
const lock = (h: Harness, code: string, as = ME) => h.call("POST", `/v1/spliteco/live/${code}/lock`, { as, body: {}, headers: { "idempotency-key": key() } });
const session = async (res: Response) => (await envelope<SplitecoLiveResponse>(res)).data.session;
const reason = async (res: Response) => (await envelope<unknown>(res)).error.details.reason;
const types = (h: Harness) =>
  (h.db.prepare("SELECT type FROM events_event_log WHERE source = 'spliteco-worker' ORDER BY rowid").all() as { type: string }[]).map((r) => r.type);
const txnCount = (h: Harness) => (h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_txns").get() as { n: number }).n;

async function opened(h: Harness, g: Group, body: unknown = DRAFT) {
  const res = await open(h, g, body);
  expect(res.status).toBe(201);
  return session(res);
}

/** Everyone claims as on the bill above. */
async function claimAll(h: Harness, code: string) {
  expect((await claim(h, code, { itemPosition: 0 }, ME)).status).toBe(200);
  expect((await claim(h, code, { itemPosition: 1 }, ANU)).status).toBe(200);
  expect((await claim(h, code, { itemPosition: 1, mode: "portion", value: 3000 }, DEV)).status).toBe(200);
  for (const who of [ME, ANU, DEV]) expect((await claim(h, code, { itemPosition: 2 }, who)).status).toBe(200);
}

describe("the live code", () => {
  it("reads as typed and shows in two halves", () => {
    expect(normalizeLiveCode(" ktch-2345")).toBe("KTCH2345");
    expect(normalizeLiveCode("KTCH2340")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeLiveCode("KTCH234")).toBeNull();
    expect(formatLiveCode("KTCH2345")).toBe("KTCH-2345");
    expect(liveDraftTotal({ items: [{ name: "a", totalMinor: 1000 }], adjustments: [{ kind: "discount", label: "d", amountMinor: 100 }, { kind: "service", label: "s", amountMinor: 50 }] })).toBe(950);
  });
});

describe("POST /v1/spliteco/groups/{org}/live", () => {
  it("opens a session with a short code, its audit event, and the shares already set carried over as claims", async () => {
    const { h, goa } = world();
    const s = await opened(h, goa, { ...DRAFT, claims: [{ itemPosition: 0, subjectId: ME, mode: "portion", value: 1000 }] });
    expect(normalizeLiveCode(s.code)).toBe(s.code);
    expect(s).toMatchObject({ state: "open", createdBy: ME, groupId: goa.publicId, groupName: "Goa Trip", currency: "INR", totalMinor: 4100, itemsMinor: 3999, claimedMinor: 1000, expenseId: null });
    expect(s.id).toMatch(/^lvs_[0-9a-f]{32}$/);
    expect(new Date(s.expiresAt).getTime() - new Date(s.createdAt).getTime()).toBe(24 * 3600 * 1000);
    expect(s.claims.map((c) => [c.itemPosition, c.subjectId, c.mode, c.value])).toEqual([[0, ME, "portion", 1000]]);
    expect(s.members.map((m) => m.name)).toEqual(expect.arrayContaining(["You", "Anu", "Dev", "Meera"]));
    expect(types(h)).toEqual(["spliteco.live.opened"]);
    // Nothing is money yet.
    expect(txnCount(h)).toBe(0);
  });

  it("is for members who can add expenses; a group you're not in is the opaque 404", async () => {
    const { h, goa } = world();
    expect((await open(h, goa, DRAFT, OUTSIDER)).status).toBe(404);
    h.grant(MEERA, goa, "viewer");
    expect((await open(h, goa, DRAFT, MEERA)).status).toBe(404);
  });

  it("refuses a draft that does not add up, or names someone outside the group", async () => {
    const { h, goa } = world();
    const short = await open(h, goa, { ...DRAFT, payers: [{ subjectId: ME, amountMinor: 4000 }] });
    expect(short.status).toBe(422);
    expect(await reason(short)).toBe(SPLITECO_ERROR_REASONS.DOES_NOT_ADD_UP);
    const outsider = await open(h, goa, { ...DRAFT, claims: [{ itemPosition: 0, subjectId: OUTSIDER, mode: "portion", value: 1000 }] });
    expect(await reason(outsider)).toBe(SPLITECO_ERROR_REASONS.NOT_IN_GROUP);
    expect((await open(h, goa, { ...DRAFT, items: [] })).status).toBe(422);
    expect((await open(h, goa, { ...DRAFT, claims: [{ itemPosition: 9, subjectId: ME, mode: "portion", value: 1000 }] })).status).toBe(422);
  });
});

describe("GET /v1/spliteco/live/{code}", () => {
  it("joins only members: a code for a group you're not in reads as unknown", async () => {
    const { h, goa, flat } = world();
    const s = await opened(h, goa);
    expect((await read(h, s.code, ANU)).status).toBe(200);
    expect((await read(h, formatLiveCode(s.code).toLowerCase(), ANU)).status).toBe(200);
    const outside = await read(h, s.code, OUTSIDER);
    const unknown = await read(h, "ZZZZZZZZ", ANU);
    expect([outside.status, unknown.status, (await read(h, "nope", ANU)).status]).toEqual([404, 404, 404]);
    expect(await outside.json()).toMatchObject({ error: { code: "not_found", message: "Not found" } });
    // Leaving the group closes the door.
    h.revoke(ANU, goa);
    expect((await read(h, s.code, ANU)).status).toBe(404);
    void flat;
  });

  it("shows who is here by their last poll, within 10 seconds", async () => {
    let clock = new Date("2026-11-12T20:00:00.000Z");
    const { h, goa } = world({ deps: { now: () => clock } });
    const s = await opened(h, goa);
    await read(h, s.code, ME);
    clock = new Date(clock.getTime() + 4000);
    const both = await session(await read(h, s.code, ANU));
    expect(both.here.map((x) => x.subjectId)).toEqual([ANU, ME]);
    clock = new Date(clock.getTime() + 7000); // me: 11 s ago, Anu: 7 s ago
    const later = await session(await read(h, s.code, DEV));
    expect(later.here.map((x) => x.subjectId)).toEqual([DEV, ANU]);
  });
});

describe("POST /v1/spliteco/live/{code}/claims", () => {
  it("lets each person claim and unclaim their own items, and everyone sees it on the next read", async () => {
    const { h, goa } = world();
    const s = await opened(h, goa);
    const mine = await session(await claim(h, s.code, { itemPosition: 1 }, ANU));
    expect(mine.claims).toEqual([expect.objectContaining({ itemPosition: 1, subjectId: ANU, mode: "portion", value: 1000 })]);
    expect(mine.claimedMinor).toBe(2000);
    expect((await session(await read(h, s.code, DEV))).claims.map((c) => c.subjectId)).toEqual([ANU]);
    // Changing it replaces it; clearing takes it off.
    await claim(h, s.code, { itemPosition: 1, mode: "portion", value: 2000 }, ANU);
    expect((await session(await read(h, s.code))).claims.map((c) => c.value)).toEqual([2000]);
    const cleared = await session(await claim(h, s.code, { itemPosition: 1, clear: true }, ANU));
    expect(cleared.claims).toEqual([]);
    expect(cleared.claimedMinor).toBe(0);
  });

  it("claims only for yourself; the opener may set anyone's", async () => {
    const { h, goa } = world();
    const s = await opened(h, goa);
    const forDev = await claim(h, s.code, { itemPosition: 0, subjectId: DEV }, ANU);
    expect(forDev.status).toBe(403);
    expect(await reason(forDev)).toBe(SPLITECO_ERROR_REASONS.OWN_CLAIMS_ONLY);
    expect((await claim(h, s.code, { itemPosition: 0, subjectId: ANU, clear: true }, DEV)).status).toBe(403);
    const byOpener = await claim(h, s.code, { itemPosition: 0, subjectId: DEV }, ME);
    expect(byOpener.status).toBe(200);
    expect((await session(byOpener)).claims.map((c) => c.subjectId)).toEqual([DEV]);
    // Even the opener names only members.
    expect(await reason(await claim(h, s.code, { itemPosition: 0, subjectId: OUTSIDER }, ME))).toBe(SPLITECO_ERROR_REASONS.NOT_IN_GROUP);
    expect(await reason(await claim(h, s.code, { itemPosition: 7 }, ANU))).toBe(SPLITECO_ERROR_REASONS.NO_SUCH_ITEM);
    expect((await claim(h, s.code, { itemPosition: 0, mode: "half" }, ANU)).status).toBe(422);
    expect((await claim(h, s.code, { itemPosition: 0 }, OUTSIDER)).status).toBe(404);
  });
});

describe("POST /v1/spliteco/live/{code}/lock", () => {
  it("is the opener's, and refused until every item is claimed", async () => {
    const { h, goa } = world();
    const s = await opened(h, goa);
    await claim(h, s.code, { itemPosition: 0 }, ME);
    const notYet = await lock(h, s.code);
    expect(notYet.status).toBe(409);
    expect((await envelope<unknown>(notYet)).error.details).toMatchObject({ reason: SPLITECO_ERROR_REASONS.NOT_ALL_CLAIMED, unclaimed: [1, 2] });
    await claimAll(h, s.code);
    const byAnu = await lock(h, s.code, ANU);
    expect(byAnu.status).toBe(403);
    expect(await reason(byAnu)).toBe(SPLITECO_ERROR_REASONS.NOT_THE_OPENER);
    expect(txnCount(h)).toBe(0);
  });

  it("posts ONE itemized expense, right to the paisa, with its audit events, then freezes the claims", async () => {
    const { h, goa } = world();
    const s = await opened(h, goa);
    await claimAll(h, s.code);
    const res = await lock(h, s.code);
    expect(res.status).toBe(200);
    const locked = await session(res);
    expect(locked.state).toBe("locked");
    expect(locked.expenseId).toMatch(/^txn_[0-9a-f]{32}$/);
    expect(txnCount(h)).toBe(1);
    expect(types(h)).toEqual(["spliteco.live.opened", "spliteco.expense.added", "spliteco.live.locked"]);

    const detail = (await envelope<SplitecoExpenseResponse>(await h.call("GET", `/v1/spliteco/expenses/${locked.expenseId}`, { as: ANU }))).data;
    expect(detail.expense).toMatchObject({ title: "Beach shack dinner", totalMinor: 4100, method: "items", category: "food", app: "spliteco", createdBy: ME });
    const owed = Object.fromEntries(detail.expense.splits.map((x) => [x.subjectId, x.owedMinor]));
    // Items 1333 / 833 / 1833, GST 101 by items: 34 / 21 / 46.
    expect(owed).toEqual({ [ME]: 1367, [ANU]: 854, [DEV]: 1879 });
    expect(detail.expense.splits.find((x) => x.subjectId === ME)?.paidMinor).toBe(4100);
    // The engine agrees, from the same draft and claims.
    const engine = buildSplitecoSplits(4100, DRAFT.payers, {
      method: "items",
      items: [
        { totalMinor: 1000, shares: [{ subjectId: ME, mode: "portion", value: 1000 }] },
        { totalMinor: 2000, shares: [{ subjectId: ANU, mode: "portion", value: 1000 }, { subjectId: DEV, mode: "portion", value: 3000 }] },
        { totalMinor: 999, shares: [ME, ANU, DEV].map((subjectId) => ({ subjectId, mode: "portion" as const, value: 1000 })) },
      ],
      adjustments: [{ kind: "tax", amountMinor: 101 }],
    });
    expect(engine.ok && Object.fromEntries(engine.splits.map((x) => [x.subjectId, x.owedMinor]))).toEqual(owed);
    expect(detail.expense.items.map((i) => [i.name, i.totalMinor, i.qty])).toEqual([["Prawn curry", 1000, 1], ["Kingfisher", 2000, 4], ["Garlic naan", 999, 1]]);
    expect(detail.expense.adjustments).toEqual([expect.objectContaining({ kind: "tax", label: "GST", amountMinor: 101 })]);

    // The balances moved, as for any expense.
    const g = (await envelope<SplitecoGroupResponse>(await h.call("GET", `/v1/spliteco/groups/${goa.publicId}`, { as: ME }))).data;
    expect(g.balances.find((b) => b.subjectId === ME)?.balanceMinor).toBe(4100 - 1367);

    // Locked: claims are frozen; locking again answers the same expense.
    const late = await claim(h, s.code, { itemPosition: 0, clear: true }, ME);
    expect(late.status).toBe(409);
    expect((await envelope<unknown>(late)).error.details).toMatchObject({ reason: SPLITECO_ERROR_REASONS.LIVE_LOCKED, expenseId: locked.expenseId });
    const again = await session(await lock(h, s.code));
    expect(again.expenseId).toBe(locked.expenseId);
    expect(txnCount(h)).toBe(1);
  });

  it("refuses a claim that leaves money on an item (exact over the price)", async () => {
    const { h, goa } = world();
    const s = await opened(h, goa);
    await claimAll(h, s.code);
    await claim(h, s.code, { itemPosition: 0, mode: "exact", value: 1500 }, ME);
    const res = await lock(h, s.code);
    expect(res.status).toBe(422);
    expect(await reason(res)).toBe(SPLITECO_ERROR_REASONS.DOES_NOT_ADD_UP);
    expect(txnCount(h)).toBe(0);
  });

  it("refuses to post for someone who left the group since they claimed", async () => {
    const { h, goa } = world();
    const s = await opened(h, goa);
    await claimAll(h, s.code);
    h.revoke(DEV, goa);
    expect(await reason(await lock(h, s.code))).toBe(SPLITECO_ERROR_REASONS.NOT_IN_GROUP);
    expect(txnCount(h)).toBe(0);
  });
});

describe("expiry", () => {
  it("takes claims and a lock for 24 hours, then reads as expired", async () => {
    let clock = new Date("2026-11-12T20:00:00.000Z");
    const { h, goa } = world({ deps: { now: () => clock } });
    const s = await opened(h, goa);
    await claimAll(h, s.code);
    clock = new Date(clock.getTime() + 24 * 3600 * 1000);
    expect((await session(await read(h, s.code, ANU))).state).toBe("expired");
    expect(await reason(await claim(h, s.code, { itemPosition: 0, clear: true }, ME))).toBe(SPLITECO_ERROR_REASONS.LIVE_EXPIRED);
    expect(await reason(await lock(h, s.code))).toBe(SPLITECO_ERROR_REASONS.LIVE_EXPIRED);
    expect(txnCount(h)).toBe(0);
  });
});
