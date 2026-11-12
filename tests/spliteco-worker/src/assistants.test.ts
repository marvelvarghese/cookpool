// An assistant in Spliteco (cookpool-spliteco SE-6, design §0.9, risk SE-F),
// against the real router over a real SQLite engine:
//   - the worker's own check, after api-edge's, route by route;
//   - draft → save for an add, an edit and a move (nothing saves without a
//     draft; an expired or someone else's draft is refused; saving twice
//     saves once), with every split the API takes;
//   - every row an assistant writes carries its delegation and its name, and
//     Activity says "via Claude".

import type {
  SplitecoActivityResponse,
  SplitecoDraftResponse,
  SplitecoExpenseRequest,
  SplitecoSearchResponse,
  SplitecoWriteResponse,
} from "@saas/contracts/spliteco";
import { DELEGATED_ROUTES } from "@spliteco-worker/delegated";
import { ANU, DEV, ME, MEERA, OUTSIDER, add, envelope, equal, key, world } from "./helpers.js";
import type { CallOptions, Group, Harness } from "./harness.js";

const DLG = "dlg_0123456789abcdef0123456789abcdef";
const OTHER_DLG = "dlg_fedcba9876543210fedcba9876543210";
const HEX = "0123456789abcdef0123456789abcdef";
const BOTH = ["money.read", "money.write"];

/** A call through an assistant: the headers api-edge sets for a delegated actor. */
function via(scopes: string[] = BOTH, opts: Partial<CallOptions> = {}, dlg = DLG, client = "Claude"): CallOptions {
  return {
    as: ME,
    ...opts,
    headers: {
      "x-actor-delegation-id": dlg,
      "x-actor-scopes": scopes.join(","),
      "x-actor-delegation-client": encodeURIComponent(client),
      ...(opts.headers ?? {}),
    },
  };
}

async function draft(h: Harness, body: unknown, opts: CallOptions = via()) {
  const res = await h.call("POST", "/v1/spliteco/drafts", { ...opts, body });
  return { res, env: await envelope<SplitecoDraftResponse>(res) };
}

async function save(h: Harness, token: string, opts: CallOptions = via()) {
  const res = await h.call("POST", `/v1/spliteco/drafts/${token}/save`, { ...opts, headers: { ...(opts.headers ?? {}), "idempotency-key": key() } });
  return { res, env: await envelope<SplitecoWriteResponse>(res) };
}

const txnCount = (h: Harness) => (h.db.prepare("SELECT COUNT(*) AS n FROM kitchen_txns").get() as { n: number }).n;

async function activity(h: Harness, g: Group) {
  return (await envelope<SplitecoActivityResponse>(await h.call("GET", `/v1/spliteco/groups/${g.publicId}/activity`, { as: ME }))).data;
}

describe("the worker's own check on a delegated caller (after api-edge's)", () => {
  const O = `org_${HEX}`;
  const T = `txn_${HEX}`;
  const NEVER: [string, string, string][] = [
    ["POST", `/v1/spliteco/groups/${O}/settlements`, "not_from_an_assistant"],
    ["POST", `/v1/spliteco/settlements/${T}/not-received`, "not_from_an_assistant"],
    ["GET", `/v1/spliteco/groups/${O}/settle-plan`, "not_from_an_assistant"],
    ["GET", "/v1/spliteco/me/profile", "not_from_an_assistant"],
    ["PUT", "/v1/spliteco/me/profile", "not_from_an_assistant"],
    ["POST", `/v1/spliteco/groups/${O}/expenses`, "draft_required"],
    ["PUT", `/v1/spliteco/expenses/${T}`, "draft_required"],
    ["POST", `/v1/spliteco/expenses/${T}/move`, "draft_required"],
    ["POST", "/v1/spliteco/groups", "scope"],
    ["PUT", `/v1/spliteco/groups/${O}/settings`, "scope"],
    ["POST", `/v1/spliteco/groups/${O}/live`, "scope"],
    ["GET", "/v1/spliteco/live/KTCH2345", "scope"],
    ["POST", "/v1/spliteco/live/KTCH2345/claims", "scope"],
    ["POST", "/v1/spliteco/live/KTCH2345/lock", "scope"],
    ["POST", `/v1/spliteco/me/friends/usr_${HEX}/direct`, "scope"],
    ["GET", `/v1/spliteco/groups/${O}/export.csv`, "scope"],
  ];

  it.each(NEVER)("refuses %s %s to an assistant with every scope (%s), and writes nothing", async (method, path, reason) => {
    const { h } = world();
    const res = await h.call(method, path, via(BOTH, { ...(method === "GET" ? {} : { body: {} }), headers: { "idempotency-key": key() } }));
    expect(res.status).toBe(403);
    expect((await envelope(res)).error).toMatchObject({ code: "forbidden", details: { reason } });
    expect(txnCount(h)).toBe(0);
  });

  it("lists exactly the reads and the payment-free writes, each with its scope", () => {
    expect(DELEGATED_ROUTES).toEqual({
      "spliteco.me.home.get": "money.read",
      "spliteco.me.groups.get": "money.read",
      "spliteco.me.activity.get": "money.read",
      "spliteco.me.search.get": "money.read",
      "spliteco.me.friend.get": "money.read",
      "spliteco.group.get": "money.read",
      "spliteco.group.activity.get": "money.read",
      "spliteco.expense.get": "money.read",
      "spliteco.insights.get": "money.read",
      "spliteco.drafts.post": "money.write",
      "spliteco.draft.save.post": "money.write",
      "spliteco.expense.delete": "money.write",
      "spliteco.expense.restore.post": "money.write",
      "spliteco.expense.comments.post": "money.write",
      "spliteco.reminders.post": "money.write",
    });
  });

  it("holds each route to its scope: Look only reads but can't draft; no scopes reach nothing", async () => {
    const { h, goa } = world();
    expect((await h.call("GET", "/v1/spliteco/me/home", via(["money.read"]))).status).toBe(200);
    expect((await h.call("GET", `/v1/spliteco/groups/${goa.publicId}`, via(["money.read"]))).status).toBe(200);
    const refused = await draft(h, { action: "add", groupId: goa.publicId, expense: equal(1000, ME, [ME, ANU]) }, via(["money.read"]));
    expect(refused.res.status).toBe(403);
    expect(refused.env.error.details.reason).toBe("scope");
    expect((await h.call("GET", "/v1/spliteco/me/home", via(["kitchen.read"]))).status).toBe(403);
    expect((await h.call("GET", "/v1/spliteco/me/home", via([]))).status).toBe(403);
    // money.write alone does not read.
    expect((await h.call("GET", "/v1/spliteco/me/home", via(["money.write"]))).status).toBe(403);
  });

  it("leaves a person's own session as it was: straight-away writes still work", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(900, ME, [ME, ANU, DEV]));
    expect(e.viaDelegation).toBeNull();
    expect(e.viaAssistant).toBeNull();
  });
});

describe("draft, then save", () => {
  it("drafts an add with the split worked out and saves nothing; save posts it via Claude, once", async () => {
    const { h, goa } = world();
    const body = { action: "add", groupId: goa.publicId, expense: equal(320000, ANU, [ME, ANU, DEV, MEERA], { title: "Sunset cruise", category: "entertainment" }) };
    const { res, env } = await draft(h, body);
    expect(res.status).toBe(201);
    const d = env.data.draft;
    expect(d).toMatchObject({ action: "add", groupId: goa.publicId, groupName: "Goa Trip", expenseId: null, title: "Sunset cruise", totalMinor: 320000, currency: "INR", method: "equal", before: null });
    expect(d.token).toMatch(/^drf_[0-9a-f]{32}$/);
    // As the ledger will hold them: the payer first.
    expect(d.shares.map((s) => [s.name, s.owedMinor, s.paidMinor])).toEqual([
      ["Anu", 80000, 320000],
      ["You", 80000, 0],
      ["Dev", 80000, 0],
      ["Meera", 80000, 0],
    ]);
    expect(new Date(d.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(txnCount(h)).toBe(0);

    const saved = await save(h, d.token);
    expect(saved.res.status).toBe(201);
    const e = saved.env.data.expense;
    expect(e).toMatchObject({ title: "Sunset cruise", totalMinor: 320000, viaDelegation: DLG, viaAssistant: "Claude" });
    expect(txnCount(h)).toBe(1);

    // Saving again answers the same expense and posts nothing more.
    const again = await save(h, d.token);
    expect(again.res.ok).toBe(true);
    expect(again.env.data.expense.id).toBe(e.id);
    expect(txnCount(h)).toBe(1);

    const a = await activity(h, goa);
    expect(a.entries[0]).toMatchObject({ action: "added", title: "Sunset cruise", viaDelegation: DLG, viaAssistant: "Claude", actorId: ME });
    const row = h.db.prepare("SELECT via_delegation, via_client, created_by FROM kitchen_txns").get();
    expect(row).toEqual({ via_delegation: DLG, via_client: "Claude", created_by: ME });
  });

  it("drafts every split the API takes, with several payers", async () => {
    const { h, goa } = world();
    const splits: SplitecoExpenseRequest["split"][] = [
      { method: "exact", participants: [{ subjectId: ME, amountMinor: 3000 }, { subjectId: ANU, amountMinor: 7001 }] },
      { method: "pct", participants: [{ subjectId: ME, basisPoints: 2500 }, { subjectId: DEV, basisPoints: 7500 }] },
      { method: "shares", participants: [{ subjectId: ME, shares: 1 }, { subjectId: MEERA, shares: 3 }] },
      { method: "adjust", participants: [{ subjectId: ME, adjustMinor: 1000 }, { subjectId: ANU, adjustMinor: 0 }] },
      {
        method: "items",
        items: [
          { name: "Thali", totalMinor: 6000, shares: [{ subjectId: ME, mode: "portion", value: 1000 }, { subjectId: ANU, mode: "portion", value: 1000 }] },
          { name: "Lassi", totalMinor: 3501, shares: [{ subjectId: DEV, mode: "exact", value: 3501 }] },
        ],
        adjustments: [{ kind: "tax", label: "GST", amountMinor: 500 }],
      },
    ];
    for (const split of splits) {
      const payers = [
        { subjectId: ANU, amountMinor: 6001 },
        { subjectId: DEV, amountMinor: 4000 },
      ];
      const { res, env } = await draft(h, { action: "add", groupId: goa.publicId, expense: { title: `By ${split.method}`, totalMinor: 10001, payers, split } });
      expect([split.method, res.status]).toEqual([split.method, 201]);
      const d = env.data.draft;
      expect(d.shares.reduce((n, s) => n + s.owedMinor, 0)).toBe(10001);
      expect(d.shares.reduce((n, s) => n + s.paidMinor, 0)).toBe(10001);
      expect(d.itemCount).toBe(split.method === "items" ? 2 : 0);
      expect((await save(h, d.token)).res.status).toBe(201);
    }
    expect(txnCount(h)).toBe(splits.length);
  });

  it("refuses a draft that would not save: not adding up, someone outside the group, another currency", async () => {
    const { h, goa } = world();
    const short = await draft(h, { action: "add", groupId: goa.publicId, expense: { ...equal(1000, ME, [ME, ANU]), payers: [{ subjectId: ME, amountMinor: 900 }] } });
    expect(short.res.status).toBe(422);
    const outsider = await draft(h, { action: "add", groupId: goa.publicId, expense: equal(1000, ME, [ME, OUTSIDER]) });
    expect(outsider.env.error.details.reason).toBe("not_in_group");
    const usd = await draft(h, { action: "add", groupId: goa.publicId, expense: equal(1000, ME, [ME, ANU], { currency: "USD" }) });
    expect(usd.env.error.details.reason).toBe("currency_mismatch");
    const bad = await draft(h, { action: "pay", groupId: goa.publicId });
    expect(bad.res.status).toBe(422);
    expect(txnCount(h)).toBe(0);
  });

  it("refuses an expired draft, and anyone else's: another person, another assistant, the person's own session", async () => {
    let now = Date.parse("2026-11-12T10:00:00.000Z");
    const { h, goa } = world({ deps: { now: () => new Date(now) } });
    const d = (await draft(h, { action: "add", groupId: goa.publicId, expense: equal(1000, ME, [ME, ANU]) })).env.data.draft;

    expect((await save(h, d.token, via(BOTH, { as: ANU }))).res.status).toBe(404);
    expect((await save(h, d.token, via(BOTH, {}, OTHER_DLG))).res.status).toBe(404);
    expect((await h.call("POST", `/v1/spliteco/drafts/${d.token}/save`, { as: ME })).status).toBe(404);
    expect((await save(h, `drf_${"0".repeat(32)}`)).res.status).toBe(404);
    expect((await save(h, "drf_nothex")).res.status).toBe(404);

    now += 10 * 60 * 1000;
    const late = await save(h, d.token);
    expect(late.res.status).toBe(409);
    expect(late.env.error.details.reason).toBe("draft_expired");
    expect(txnCount(h)).toBe(0);
  });

  it("drafts an edit with before and after, and saves it as a reversal plus a new version via Claude", async () => {
    const { h, goa } = world();
    const original = await add(h, goa, equal(320000, ANU, [ME, ANU, DEV, MEERA], { title: "Sunset cruise" }));
    const { res, env } = await draft(h, { action: "edit", expenseId: original.id, expense: equal(320000, ANU, [ME, ANU, MEERA], { title: "Sunset cruise" }) });
    expect(res.status).toBe(201);
    const d = env.data.draft;
    expect(d.before!.shares.map((s) => s.owedMinor)).toEqual([80000, 80000, 80000, 80000]);
    expect(d.shares.map((s) => s.owedMinor).sort()).toEqual([106666, 106667, 106667]);
    expect(txnCount(h)).toBe(1);

    const saved = await save(h, d.token);
    expect(saved.res.status).toBe(200);
    expect(saved.env.data.expense.viaAssistant).toBe("Claude");
    expect(txnCount(h)).toBe(3);
    const edited = (await activity(h, goa)).entries.find((e) => e.action === "edited")!;
    expect(edited).toMatchObject({ viaDelegation: DLG, viaAssistant: "Claude" });
    const rows = h.db.prepare("SELECT kind, via_client FROM kitchen_txns WHERE via_delegation IS NOT NULL ORDER BY rowid").all();
    expect(rows).toEqual([
      { kind: "expense", via_client: "Claude" },
      { kind: "reversal", via_client: "Claude" },
    ]);
  });

  it("refuses to draft an edit of Cookpool's row, or of a version changed since", async () => {
    const { h, flat, goa } = world();
    await h.kitchen("POST", `/v1/organizations/${flat.publicId}/kitchen/expenses`, {
      as: ANU,
      body: { title: "Vegetables", totalMinor: 900, mode: "equal", payers: [{ subjectId: ANU, amountMinor: 900 }], participants: [{ subjectId: ME }, { subjectId: ANU }, { subjectId: DEV }] },
      headers: { "idempotency-key": key() },
    });
    const cookpool = (await envelope<SplitecoSearchResponse>(await h.call("GET", "/v1/spliteco/me/search?q=vegetables", via()))).data.expenses[0]!;
    const owned = await draft(h, { action: "edit", expenseId: cookpool.id, expense: equal(900, ANU, [ME, ANU]) });
    expect(owned.env.error.details.reason).toBe("owned_by_cookpool");

    const e = await add(h, goa, equal(1000, ME, [ME, ANU]));
    const d = (await draft(h, { action: "edit", expenseId: e.id, expense: equal(1200, ME, [ME, ANU]) })).env.data.draft;
    // Someone edits it in the app meanwhile: the save is refused as the write would be.
    await h.call("PUT", `/v1/spliteco/expenses/${e.id}`, { as: ANU, body: equal(1100, ME, [ME, ANU]), headers: { "idempotency-key": key() } });
    const stale = await save(h, d.token);
    expect(stale.res.status).toBe(409);
    expect(stale.env.error.details.reason).toBe("not_current");
  });

  it("drafts a move (everyone must be a member there) and saves it", async () => {
    const { h, flat, goa } = world();
    const e = await add(h, goa, equal(1000, ME, [ME, ANU]));
    const withMeera = await add(h, goa, equal(1000, ME, [ME, MEERA]));
    const refused = await draft(h, { action: "move", expenseId: withMeera.id, toGroupId: flat.publicId });
    expect(refused.env.error.details.reason).toBe("not_members");
    const same = await draft(h, { action: "move", expenseId: e.id, toGroupId: goa.publicId });
    expect(same.env.error.details.reason).toBe("same_group");

    const d = (await draft(h, { action: "move", expenseId: e.id, toGroupId: flat.publicId })).env.data.draft;
    expect(d).toMatchObject({ action: "move", groupName: "Flat 4B", expenseId: e.id, before: { groupName: "Goa Trip" } });
    const before = txnCount(h);
    const saved = await save(h, d.token);
    expect(saved.res.status).toBe(201);
    expect(saved.env.data.expense).toMatchObject({ groupId: flat.publicId, viaAssistant: "Claude" });
    expect(txnCount(h)).toBe(before + 2);
    expect((await activity(h, flat)).entries[0]).toMatchObject({ action: "moved_in", viaAssistant: "Claude" });
  });
});

describe("what else an assistant may do", () => {
  it("deletes softly and restores, each row via Claude", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(1000, ME, [ME, ANU]));
    const del = await h.call("DELETE", `/v1/spliteco/expenses/${e.id}`, via(BOTH, { headers: { "idempotency-key": key() } }));
    expect(del.status).toBe(200);
    const restored = await h.call("POST", `/v1/spliteco/expenses/${e.id}/restore`, via(BOTH, { headers: { "idempotency-key": key() } }));
    expect(restored.status).toBe(201);
    const entries = (await activity(h, goa)).entries;
    expect(entries.filter((x) => x.viaAssistant === "Claude").map((x) => x.action).sort()).toEqual(["deleted", "restored"]);
  });

  it("comments, and reaches the reminder route (which says nobody owes here)", async () => {
    const { h, goa } = world();
    const e = await add(h, goa, equal(1000, ME, [ME, ANU]));
    const c = await h.call("POST", `/v1/spliteco/expenses/${e.id}/comments`, via(BOTH, { body: { body: "Dev skipped the cruise" } }));
    expect(c.status).toBe(201);
    const r = await h.call("POST", "/v1/spliteco/reminders", via(BOTH, { body: { to: DEV }, headers: { "idempotency-key": key() } }));
    expect(r.status).not.toBe(403);
  });

  it("searches current expenses by words, in every group or one", async () => {
    const { h, flat, goa } = world();
    await add(h, goa, equal(1000, ME, [ME, ANU], { title: "Airport cab", note: "late flight" }));
    await add(h, goa, equal(1000, ME, [ME, ANU], { title: "Dinner" }));
    await add(h, flat, equal(600, ME, [ME, DEV], { title: "Cab home" }));
    const search = async (q: string, extra = "") =>
      (await envelope<SplitecoSearchResponse>(await h.call("GET", `/v1/spliteco/me/search?q=${encodeURIComponent(q)}${extra}`, via(["money.read"])))).data;
    expect((await search("cab")).expenses.map((x) => x.title).sort()).toEqual(["Airport cab", "Cab home"]);
    expect((await search("cab", `&groupId=${flat.publicId}`)).expenses.map((x) => x.title)).toEqual(["Cab home"]);
    expect((await search("late flight")).expenses.map((x) => x.title)).toEqual(["Airport cab"]);
    const page = await search("", "&limit=2");
    expect([page.expenses.length, page.more]).toEqual([2, true]);
    expect((await h.call("GET", "/v1/spliteco/me/search?limit=0", { as: ME })).status).toBe(422);
  });

  it("shows an older assistant row (no name kept) as via an assistant", async () => {
    const { h, goa } = world();
    const d = (await draft(h, { action: "add", groupId: goa.publicId, expense: equal(1000, ME, [ME, ANU]) }, via(BOTH, {}, DLG, "\u0000"))).env.data.draft;
    expect((await save(h, d.token, via(BOTH, {}, DLG, "\u0000"))).res.status).toBe(201);
    expect((await activity(h, goa)).entries[0]).toMatchObject({ viaDelegation: DLG, viaAssistant: "an assistant" });
  });
});
