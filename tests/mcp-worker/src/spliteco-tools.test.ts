// Spliteco's tools (cookpool-spliteco SE-6): what each one asks api-edge,
// what it answers, how refusals read, and the two rules — nothing saves
// without a draft, and no tool records a payment (settle_up only links).

import { splitecoOrigin } from "@mcp-worker/tools/spliteco";
import { DELEGATED, callTool, connect, dataOf, fail, listTools, ok, world, type World } from "./helpers.js";

const ORG = "org_0123456789abcdef0123456789abcdef";
const ORG2 = "org_fedcba9876543210fedcba9876543210";
const TXN = "txn_0123456789abcdef0123456789abcdef";
const DRF = "drf_0123456789abcdef0123456789abcdef";
const ME = "usr_me";
const ANU = "usr_anu";
const DEV = "usr_dev";

async function connected(scopes = ["money.read", "money.write"]): Promise<{ w: World; token: string }> {
  const w = world();
  const { accessToken } = await connect(w, scopes);
  return { w, token: accessToken };
}

const summary = (over: Record<string, unknown> = {}) => ({
  id: TXN,
  groupId: ORG,
  groupName: "Goa Trip",
  kind: "expense",
  app: "spliteco",
  bucket: "other",
  title: "Sunset cruise",
  category: "entertainment",
  method: "equal",
  totalMinor: 320000,
  currency: "INR",
  occurredAt: "2026-11-12T10:00:00.000Z",
  createdAt: "2026-11-12T10:00:00.000Z",
  createdBy: ME,
  payers: [{ subjectId: ANU, paidMinor: 320000 }],
  splits: [
    { subjectId: ANU, paidMinor: 320000, owedMinor: 160000 },
    { subjectId: ME, paidMinor: 0, owedMinor: 160000 },
  ],
  myNetMinor: -160000,
  locked: false,
  viaDelegation: "dlg_1",
  viaAssistant: "Claude",
  paymentMethod: null,
  ...over,
});

const draft = (over: Record<string, unknown> = {}) => ({
  token: DRF,
  action: "add",
  expiresAt: "2026-11-12T10:10:00.000Z",
  groupId: ORG,
  groupName: "Goa Trip",
  expenseId: null,
  title: "Sunset cruise",
  totalMinor: 320000,
  currency: "INR",
  category: "entertainment",
  method: "equal",
  shares: [
    { subjectId: ANU, name: "Anu", paidMinor: 320000, owedMinor: 160000 },
    { subjectId: ME, name: "You", paidMinor: 0, owedMinor: 160000 },
  ],
  itemCount: 0,
  before: null,
  ...over,
});

const EXPENSE = {
  title: "Sunset cruise",
  totalMinor: 320000,
  payers: [{ subjectId: ANU, amountMinor: 320000 }],
  split: { method: "equal", participants: [ME, ANU] },
};

/** Every path a payment, a payment's undo or a payment's setting goes to. */
const PAYMENT_PATH = /settlements|not-received|settle-plan|profile|\/live|\/groups\/[^/]+\/expenses$|\/move$/;

describe("which Spliteco tools are listed", () => {
  test("Look only lists the reads and settle_up; Add & edit adds the drafts and saves", async () => {
    const look = await connected(["money.read"]);
    expect(await listTools(look.w, look.token)).toEqual(["balances", "find_people", "list_groups", "get_balances", "search_expenses", "get_activity", "get_insights", "settle_up"]);
    const kitchen = await connected(["kitchen.read"]);
    expect((await listTools(kitchen.w, kitchen.token)).filter((t) => t.includes("expense"))).toEqual([]);
  });
});

describe("the reads", () => {
  test("find_people: you and everyone you share a group with, or one group's members", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/spliteco/me/home", () => ok({ me: { subjectId: ME, name: "Ravi" }, totals: [], people: [] }));
    w.edge.on("GET /v1/spliteco/me/groups", () => ok({ groups: [], friends: [{ subjectId: ANU, name: "Anu", balances: [], groupNames: ["Goa Trip"], outsideGroups: false }, { subjectId: DEV, name: "Dev", balances: [], groupNames: [], outsideGroups: true }] }));
    w.edge.on(`GET /v1/spliteco/groups/${ORG}`, () => ok({ members: [{ subjectId: ME, name: "Ravi", role: "owner" }, { subjectId: DEV, name: "Dev", role: "builder" }] }));
    const all = await callTool(w, token, "find_people", { query: "an" });
    expect(dataOf(all)).toEqual({ you: { id: ME, name: "Ravi", you: true }, people: [{ id: ANU, name: "Anu", groups: ["Goa Trip"] }] });
    const members = await callTool(w, token, "find_people", { groupId: ORG });
    expect(dataOf<{ people: unknown[] }>(members).people).toEqual([{ id: DEV, name: "Dev", role: "builder" }]);
    const spliteco = w.edge.calls.filter((c) => c.path.startsWith("/v1/spliteco"));
    expect(spliteco.length).toBe(4);
    expect(spliteco.every((c) => c.method === "GET" && c.headers.get("authorization") === `Bearer ${DELEGATED}`)).toBe(true);
  });

  test("list_groups, get_balances (all, one group, one person), search_expenses, get_activity, get_insights: GETs only", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/spliteco/me/groups", () => ok({ groups: [{ id: ORG, name: "Goa Trip", kind: "trip", madeIn: "spliteco", role: "owner", currency: "INR", memberCount: 4, myBalanceMinor: -62000, myPlan: [], myBuckets: null }], friends: [] }));
    w.edge.on("GET /v1/spliteco/me/home", () => ok({ me: { subjectId: ME, name: "Ravi" }, totals: [{ currency: "INR", owedToYouMinor: 0, youOweMinor: 62000, netMinor: -62000 }], people: [{ subjectId: DEV, name: "Dev", balances: [{ currency: "INR", amountMinor: -62000 }], groupNames: [], outsideGroups: false }] }));
    w.edge.on(`GET /v1/spliteco/groups/${ORG}`, () =>
      ok({
        group: { id: ORG, name: "Goa Trip", currency: "INR", myBalanceMinor: -62000 },
        members: [{ subjectId: ME, name: "Ravi", role: "owner" }, { subjectId: DEV, name: "Dev", role: "builder" }],
        people: [],
        balances: [{ subjectId: DEV, balanceMinor: 62000 }, { subjectId: ME, balanceMinor: -62000 }],
        plan: [{ fromSubjectId: ME, toSubjectId: DEV, amountMinor: 62000 }],
      }),
    );
    w.edge.on(`GET /v1/spliteco/me/friends/${DEV}`, () => ok({ friend: { subjectId: DEV, name: "Dev" }, balances: [{ currency: "INR", amountMinor: -62000 }], byGroup: [{ groupId: ORG, groupName: "Goa Trip", kind: "trip", currency: "INR", amountMinor: -62000 }] }));
    w.edge.on("GET /v1/spliteco/me/search", () => ok({ expenses: [summary()], people: [{ subjectId: ANU, name: "Anu" }], more: false }));
    w.edge.on("GET /v1/spliteco/me/activity", () => ok({ entries: [{ txnId: TXN, expenseId: TXN, action: "edited", at: "2026-11-12T10:00:00.000Z", actorId: ME, groupId: ORG, groupName: "Goa Trip", title: "Airport cab", totalMinor: 240000, currency: "INR", previousTotalMinor: 200000, otherGroupId: null, otherGroupName: null, myEffectMinor: -60000, viaDelegation: "dlg_1", viaAssistant: "Gemini" }], people: [{ subjectId: ME, name: "Ravi" }] }));
    w.edge.on("GET /v1/spliteco/insights", () => ok({ groupId: null, month: "2026-11", currency: "INR", currencies: ["INR"], byCategory: [{ category: "food", amountMinor: 1000 }], byPayer: [], byMonth: [], myShareMinor: 1000, myPaidMinor: 0, expenseCount: 1, previousMonthShareMinor: 0, biggest: [], people: [] }));

    expect((await callTool(w, token, "list_groups")).content[0]!.text).toBe("1 group: Goa Trip.");
    expect((await callTool(w, token, "get_balances")).content[0]!.text).toBe("You owe ₹620.00.");
    const group = await callTool(w, token, "get_balances", { groupId: ORG });
    expect(group.content[0]!.text).toBe("Goa Trip: you owe ₹620.00; 1 payment would settle it.");
    expect(dataOf<{ plan: unknown[] }>(group).plan).toEqual([{ from: "Ravi", to: "Dev", amount: "₹620.00" }]);
    expect((await callTool(w, token, "get_balances", { personId: DEV })).content[0]!.text).toBe("you owe Dev ₹620.00.");
    const found = await callTool(w, token, "search_expenses", { query: "cruise", groupId: ORG });
    expect(w.edge.last("/v1/spliteco/me/search").search.get("q")).toBe("cruise");
    expect(w.edge.last("/v1/spliteco/me/search").search.get("groupId")).toBe(ORG);
    expect(dataOf<{ expenses: Array<Record<string, unknown>> }>(found).expenses[0]).toMatchObject({ id: TXN, total: "₹3,200.00", paidBy: ["Anu"], via: "Claude" });
    const act = await callTool(w, token, "get_activity");
    expect(dataOf<{ entries: unknown[] }>(act).entries[0]).toMatchObject({ action: "edited", by: "Ravi", via: "Gemini", before: "₹2,000.00", forYou: "you owe ₹600.00" });
    expect((await callTool(w, token, "get_insights", { month: "2026-11" })).content[0]!.text).toContain("your share ₹10.00");
    expect(w.edge.calls.filter((c) => c.path.startsWith("/v1/spliteco")).every((c) => c.method === "GET")).toBe(true);
  });
});

describe("settle_up never touches a payment route", () => {
  test.each([
    [{ groupId: ORG, personId: DEV }, `/settle?group=${ORG}&to=${DEV}`],
    [{ groupId: ORG }, `/settle?group=${ORG}`],
    [{ personId: DEV }, `/friend?id=${DEV}`],
    [{}, "/settle"],
  ])("%j answers a link into the app (%s) and calls nothing", async (args, path) => {
    const { w, token } = await connected(["money.read"]);
    (w.env as { SPLITECO_ORIGIN?: string }).SPLITECO_ORIGIN = "https://spliteco.test";
    const before = w.edge.calls.length;
    const result = await callTool(w, token, "settle_up", args);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toMatch(/^Settling up happens in the Spliteco app/);
    expect(result.content[0]!.text).toContain("I can't record payments");
    expect(dataOf(result)).toEqual({ url: `https://spliteco.test${path}`, recordsPayment: false });
    expect(w.edge.calls.length).toBe(before);
  });

  test("the app's host is derived from the MCP server's when it is not set", () => {
    expect(splitecoOrigin({ MCP_PUBLIC_ORIGIN: "https://cookpool-mcp-worker-stage.cookpool.workers.dev" })).toBe("https://cookpool-spliteco-web-stage.cookpool.workers.dev");
    expect(splitecoOrigin({ MCP_PUBLIC_ORIGIN: "https://cookpool-mcp-worker-prod.cookpool.workers.dev", SPLITECO_ORIGIN: "" })).toBe("https://cookpool-spliteco-web-prod.cookpool.workers.dev");
    expect(splitecoOrigin({ MCP_PUBLIC_ORIGIN: "https://mcp.test" })).toBeNull();
  });

  test("no tool, called with anything, reaches a payment route", async () => {
    const { w, token } = await connected();
    w.edge.fallback = () => ok({ draft: draft(), expense: summary(), comment: { id: "cmt_1" }, reminder: { id: "rmd_1", groupId: ORG, toSubjectId: DEV, amountMinor: 1, currency: "INR", sentAt: "x", nextAllowedAt: "y" }, delivered: true });
    const calls: [string, Record<string, unknown>][] = [
      ["draft_expense", { groupId: ORG, expense: EXPENSE }],
      ["edit_expense", { expenseId: TXN, expense: EXPENSE }],
      ["move_expense", { expenseId: TXN, toGroupId: ORG2 }],
      ["save_expense", { token: DRF }],
      ["delete_expense", { expenseId: TXN }],
      ["restore_expense", { expenseId: TXN }],
      ["add_comment", { expenseId: TXN, body: "hi" }],
      ["send_reminder", { personId: DEV }],
      ["settle_up", { groupId: ORG, personId: DEV }],
    ];
    for (const [name, args] of calls) await callTool(w, token, name, args);
    const paths = w.edge.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths.filter((p) => PAYMENT_PATH.test(p))).toEqual([]);
  });
});

describe("draft, then save", () => {
  test("draft_expense POSTs a draft and answers it as a DRAFT with the token; nothing else is called", async () => {
    const { w, token } = await connected();
    w.edge.on("POST /v1/spliteco/drafts", () => ok({ draft: draft() }, 201));
    const result = await callTool(w, token, "draft_expense", { groupId: ORG, expense: EXPENSE });
    const call = w.edge.last("/v1/spliteco/drafts");
    expect(call.body).toEqual({ action: "add", groupId: ORG, expense: EXPENSE });
    expect(call.headers.get("idempotency-key")).toMatch(/^mcp_/);
    expect(result.content[0]!.text).toMatch(/^DRAFT — nothing is saved yet\. Add "Sunset cruise" to Goa Trip: ₹3,200\.00, Anu paid, split equal\./);
    expect(result.content[0]!.text).toContain("call save_expense with the token only after they say yes");
    expect(dataOf(result)).toMatchObject({
      draft: true,
      token: DRF,
      total: "₹3,200.00",
      addsUpTo: "₹3,200.00",
      shares: [
        { name: "Anu", share: "₹1,600.00", paid: "₹3,200.00" },
        { name: "You", share: "₹1,600.00" },
      ],
    });
    expect(w.edge.calls.filter((c) => c.path.startsWith("/v1/spliteco")).map((c) => c.path)).toEqual(["/v1/spliteco/drafts"]);
  });

  test("every split method and several payers go through as the API takes them", async () => {
    const { w, token } = await connected();
    w.edge.on("POST /v1/spliteco/drafts", () => ok({ draft: draft() }, 201));
    const payers = [
      { subjectId: ANU, amountMinor: 6001 },
      { subjectId: DEV, amountMinor: 4000 },
    ];
    const splits = [
      { method: "equal", participants: [ME, ANU] },
      { method: "exact", participants: [{ subjectId: ME, amountMinor: 3000 }, { subjectId: ANU, amountMinor: 7001 }] },
      { method: "pct", participants: [{ subjectId: ME, basisPoints: 2500 }, { subjectId: ANU, basisPoints: 7500 }] },
      { method: "shares", participants: [{ subjectId: ME, shares: 1 }, { subjectId: ANU, shares: 3 }] },
      { method: "adjust", participants: [{ subjectId: ME, adjustMinor: -500 }, { subjectId: ANU, adjustMinor: 500 }] },
      {
        method: "items",
        items: [{ name: "Thali", qty: 2, unitMinor: 3000, totalMinor: 6000, shares: [{ subjectId: ME, mode: "portion", value: 1000 }, { subjectId: ANU, mode: "pct", value: 5000 }] }],
        adjustments: [{ kind: "tax", label: "GST", amountMinor: 300 }, { kind: "discount", label: "Happy hour", amountMinor: 100 }],
      },
    ];
    for (const split of splits) {
      const result = await callTool(w, token, "draft_expense", { groupId: ORG, expense: { title: "Lunch", totalMinor: 10001, payers, split } });
      expect([split.method, result.isError ?? false]).toEqual([split.method, false]);
      expect((w.edge.last("/v1/spliteco/drafts").body as { expense: { split: unknown; payers: unknown } }).expense).toMatchObject({ split, payers });
    }
  });

  test("a malformed expense is refused before api-edge is asked", async () => {
    const { w, token } = await connected();
    const before = w.edge.calls.length;
    const result = await callTool(w, token, "draft_expense", { groupId: ORG, expense: { ...EXPENSE, split: { method: "pay", to: DEV } } });
    expect(result.isError).toBe(true);
    expect(w.edge.calls.length).toBe(before);
  });

  test("edit_expense and move_expense draft too, with before and after", async () => {
    const { w, token } = await connected();
    w.edge.on("POST /v1/spliteco/drafts", (req) => {
      const body = req.body as { action: string };
      return ok({
        draft: draft({
          action: body.action,
          expenseId: TXN,
          groupName: body.action === "move" ? "Flat 4B" : "Goa Trip",
          before: { groupId: ORG, groupName: "Goa Trip", title: "Sunset cruise", totalMinor: 320000, shares: [{ subjectId: DEV, name: "Dev", paidMinor: 0, owedMinor: 80000 }] },
        }),
      }, 201);
    });
    const edit = await callTool(w, token, "edit_expense", { expenseId: TXN, expense: EXPENSE });
    expect(w.edge.last("/v1/spliteco/drafts").body).toEqual({ action: "edit", expenseId: TXN, expense: EXPENSE });
    expect(edit.content[0]!.text).toMatch(/^DRAFT — nothing is saved yet\. Change "Sunset cruise" in Goa Trip/);
    expect(dataOf<{ before: unknown }>(edit).before).toEqual({ group: "Goa Trip", title: "Sunset cruise", total: "₹3,200.00", shares: [{ name: "Dev", share: "₹800.00" }] });
    const move = await callTool(w, token, "move_expense", { expenseId: TXN, toGroupId: ORG2 });
    expect(w.edge.last("/v1/spliteco/drafts").body).toEqual({ action: "move", expenseId: TXN, toGroupId: ORG2 });
    expect(move.content[0]!.text).toMatch(/^DRAFT — nothing is saved yet\. Move "Sunset cruise" to Flat 4B/);
    expect(w.edge.calls.some((c) => c.path.endsWith("/save"))).toBe(false);
  });

  test("save_expense takes only a draft token, and posts to …/drafts/{drf}/save", async () => {
    const { w, token } = await connected();
    w.edge.on(`POST /v1/spliteco/drafts/${DRF}/save`, () => ok({ expense: summary() }, 201));
    (w.env as { SPLITECO_ORIGIN?: string }).SPLITECO_ORIGIN = "https://spliteco.test";
    const result = await callTool(w, token, "save_expense", { token: DRF });
    expect(w.edge.last(`/v1/spliteco/drafts/${DRF}/save`).method).toBe("POST");
    expect(result.content[0]!.text).toBe('Saved "Sunset cruise" in Goa Trip: ₹3,200.00. It shows as via this assistant in Spliteco\'s activity.');
    expect(dataOf(result)).toMatchObject({ saved: true, id: TXN, you: "borrowed ₹1,600.00", open: `https://spliteco.test/expense?id=${TXN}` });
    const before = w.edge.calls.length;
    for (const bad of [{ token: TXN }, { token: "drf_x" }, { expense: EXPENSE }, {}]) {
      expect((await callTool(w, token, "save_expense", bad)).isError).toBe(true);
    }
    expect(w.edge.calls.length).toBe(before);
  });

  test("delete_expense, restore_expense, add_comment and send_reminder", async () => {
    const { w, token } = await connected();
    w.edge.on(`DELETE /v1/spliteco/expenses/${TXN}`, () => ok({ expense: summary() }));
    w.edge.on(`POST /v1/spliteco/expenses/${TXN}/restore`, () => ok({ expense: summary() }, 201));
    w.edge.on(`POST /v1/spliteco/expenses/${TXN}/comments`, () => ok({ comment: { id: "cmt_1", txnId: TXN, subjectId: ME, body: "hi", createdAt: "x" } }, 201));
    w.edge.on("POST /v1/spliteco/reminders", () => ok({ reminder: { id: "rmd_1", groupId: ORG, toSubjectId: DEV, amountMinor: 62000, currency: "INR", sentAt: "a", nextAllowedAt: "2026-11-13T10:00:00.000Z" }, delivered: true }, 201));
    expect((await callTool(w, token, "delete_expense", { expenseId: TXN })).content[0]!.text).toBe('Deleted "Sunset cruise" (₹3,200.00) from Goa Trip. It can be restored for 30 days.');
    expect((await callTool(w, token, "restore_expense", { expenseId: TXN })).content[0]!.text).toBe('Restored "Sunset cruise" in Goa Trip.');
    await callTool(w, token, "add_comment", { expenseId: TXN, body: "Dev skipped it" });
    expect(w.edge.last(`/v1/spliteco/expenses/${TXN}/comments`).body).toEqual({ body: "Dev skipped it" });
    const r = await callTool(w, token, "send_reminder", { personId: DEV, groupId: ORG });
    expect(w.edge.last("/v1/spliteco/reminders").body).toEqual({ to: DEV, groupId: ORG });
    expect(r.content[0]!.text).toBe("Reminder sent for ₹620.00. The next one is possible after 2026-11-13T10:00:00.000Z.");
  });
});

describe("refusals read as plain words", () => {
  test.each([
    [fail(403, "forbidden", { reason: "scope" }), /You → AI assistants \(Add & edit\)/],
    [fail(403, "forbidden", { reason: "not_from_an_assistant" }), /^Payments are made in the Spliteco app, never by an assistant/],
    [fail(403, "forbidden", { reason: "draft_required" }), /^Draft it first/],
    [fail(409, "conflict", { reason: "draft_expired" }), /^That draft lapsed \(they last 10 minutes\)/],
    [fail(409, "conflict", { reason: "owned_by_cookpool" }), /^Cookpool posted this one/],
    [fail(409, "conflict", { reason: "not_current", currentId: "txn_new" }), /The current one is txn_new/],
    [fail(409, "conflict", { reason: "not_members" }), /can't move there/],
    [fail(409, "conflict", { reason: "restore_expired" }), /more than 30 days ago/],
    [fail(409, "conflict", { reason: "reminded_recently" }), /already reminded in the last 24 hours/],
    [fail(409, "conflict", { reason: "nothing_owed" }), /nothing to remind/],
    [fail(422, "validation_failed", { reason: "does_not_add_up", problems: ["payers_short"] }), /doesn't add up to the total: payers_short/],
    [fail(422, "validation_failed", { reason: "not_in_group" }), /isn't in that group/],
    [fail(422, "validation_failed", { reason: "currency_mismatch", currency: "USD" }), /counts in USD/],
    [fail(422, "validation_failed", { fields: { title: ["Required"] } }), /Cookpool couldn't accept that\. title: Required/],
    [fail(404, "not_found"), /couldn't find that/],
    [fail(401, "unauthenticated"), /^Reconnect Cookpool/],
  ])("%#: %s", async (response, text) => {
    const { w, token } = await connected();
    w.edge.on("POST /v1/spliteco/drafts", () => response.clone());
    w.edge.on(`POST /v1/spliteco/drafts/${DRF}/save`, () => response.clone());
    for (const [name, args] of [
      ["draft_expense", { groupId: ORG, expense: EXPENSE }],
      ["save_expense", { token: DRF }],
    ] as const) {
      const result = await callTool(w, token, name, args);
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(text);
    }
  });
});
