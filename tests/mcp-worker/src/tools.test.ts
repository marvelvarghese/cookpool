// /mcp: which tools are listed for which scopes, what each one asks
// api-edge, what it answers, and how refusals read (design §2).

import { DELEGATED, callTool, connect, dataOf, fail, listTools, ok, rpc, world, type World } from "./helpers.js";

const KITCHEN = ["pantry_list", "pantry_running_low", "what_can_i_cook", "recipe_get", "recipe_search", "shopping_list"];
const TIMERS = ["timer_start", "timer_list", "timer_cancel"];
const SPLITECO_READ = ["find_people", "list_groups", "get_balances", "search_expenses", "get_activity", "get_insights", "settle_up"];
const SPLITECO_WRITE = ["draft_expense", "save_expense", "edit_expense", "move_expense", "delete_expense", "restore_expense", "add_comment", "send_reminder"];
const ALL = ["kitchen.read", "money.read", "timers.write", "suggest.write", "money.write"];
const WRITES = ["timer_start", "timer_cancel", "save_expense", "delete_expense", "restore_expense", "add_comment", "send_reminder"];

async function connected(scopes: string[] = ALL): Promise<{ w: World; token: string }> {
  const w = world();
  const { accessToken } = await connect(w, scopes);
  return { w, token: accessToken };
}

describe("tools are listed only for the scopes allowed", () => {
  test.each([
    [["kitchen.read"], KITCHEN],
    [["money.read"], ["balances", ...SPLITECO_READ]],
    [["money.write"], SPLITECO_WRITE],
    [["money.read", "money.write"], ["balances", ...SPLITECO_READ, ...SPLITECO_WRITE]],
    [["timers.write"], TIMERS],
    [["kitchen.read", "timers.write"], [...KITCHEN, ...TIMERS]],
    [ALL, [...KITCHEN, "balances", ...TIMERS, ...SPLITECO_READ, ...SPLITECO_WRITE]],
  ])("%j lists %j", async (scopes, expected) => {
    const { w, token } = await connected(scopes);
    expect(await listTools(w, token)).toEqual(expected);
  });

  test("suggest.write lists nothing yet: suggest_use and suggest_purchase are MC-5's", async () => {
    const { w, token } = await connected(["suggest.write"]);
    expect(await listTools(w, token)).toEqual([]);
  });

  test("a tool outside the scopes can't be called, and api-edge is never asked", async () => {
    const { w, token } = await connected(["kitchen.read"]);
    const before = w.edge.calls.length;
    const res = await rpc(w, token, "tools/call", { name: "balances", arguments: {} });
    const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(w.edge.calls.length).toBe(before);
  });

  test("every tool has a title, a short description and an object input schema", async () => {
    const { w, token } = await connected();
    const res = await rpc(w, token, "tools/list");
    type Listed = { name: string; title: string; description: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } };
    const { tools } = ((await res.json()) as { result: { tools: Listed[] } }).result;
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description.length).toBeLessThan(260);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations.readOnlyHint).toBe(!WRITES.includes(tool.name));
    }
  });

  test("initialize names the server and its instructions say nothing moves money", async () => {
    const { w, token } = await connected();
    const res = await rpc(w, token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    const { result } = (await res.json()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(result.serverInfo.name).toBe("cookpool");
    expect(result.instructions).toContain("Nothing here moves money");
  });
});

// ── fixtures ───────────────────────────────────────────────

const personal = { kind: "personal", name: "Personal" };
const flat = { kind: "group", orgId: "org_11111111111111111111111111111111", slug: "flat", name: "Flat 4B" };

function item(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    pantry: personal,
    name,
    category: "dairy",
    displayUnit: "L",
    qtyLeft: 1.5,
    expiresOn: "2026-11-11",
    daysToUseBy: 2,
    canUse: true,
    ...extra,
  };
}

function last(extra: Record<string, unknown> = {}) {
  return { itemId: "itm_1", quantityMilli: 1_000_000, unit: "kg", priceMinor: 12000, currency: "INR", wastePolicy: null, expiresAfterDays: null, paidBy: "usr_1", ...extra };
}

const restock = {
  finished: [{ reason: "finished", name: "Eggs", nameKey: "eggs", category: "protein", pantry: personal, canAdd: true, last: last({ unit: "pcs", quantityMilli: 12_000 }), why: { finishedAt: "2026-11-08T10:00:00Z", how: "used_up", itemId: "itm_e" } }],
  runningLow: [{ reason: "running_low", name: "Rice", nameKey: "rice", category: "grains", pantry: flat, canAdd: true, last: last(), why: { leftQtyMilli: 150_000, boughtQtyMilli: 1_000_000, itemId: "itm_r" } }],
  usual: [{ reason: "usual", name: "Milk", nameKey: "milk", category: "dairy", pantry: personal, canAdd: true, last: last({ unit: "L" }), why: { everyDays: 3, lastBoughtAt: "2026-11-05", times: 6 } }],
};

function summary(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, ownerId: "usr_cookpool", ownerName: "Cookpool", name, servesHalf: 4, serves: 2, minutes: 30, kind: "main", visibility: "public", isSystem: true, mine: false, source: null, savedBy: 0, lineCount: 3, main: null, lastCookedAt: null, createdAt: "", updatedAt: "", ...extra };
}

function match(extra: Record<string, unknown> = {}) {
  return { lines: 3, have: 3, short: 0, missing: 0, always: 0, missingNames: [], maxFactorMilli: 1000, ...extra };
}

const timer = { id: "tmr_abc", label: "Rice", body: null, url: "/cook/session", endsAt: new Date(Date.now() + 12 * 60_000).toISOString(), createdAt: "", sentAt: null, canceledAt: null };

// ── each tool's call ───────────────────────────────────────

describe("each tool calls api-edge as the person, with the delegated token", () => {
  test("pantry_list → GET /v1/kitchen/me/items with pantry, soon, query and limit", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/items", () =>
      ok({ items: [item("itm_1", "Milk"), item("itm_2", "Rice", { pantry: flat, displayUnit: "kg", qtyLeft: 0.25, daysToUseBy: null, expiresOn: null })], nextCursor: null }),
    );
    const result = await callTool(w, token, "pantry_list", { pantry: "personal", soon: true, query: "mi", limit: 10 });
    const call = w.edge.last("/v1/kitchen/me/items");
    expect(call.method).toBe("GET");
    expect(call.headers.get("authorization")).toBe(`Bearer ${DELEGATED}`);
    expect(call.headers.get("idempotency-key")).toBeNull();
    expect(Object.fromEntries(call.search)).toEqual({ pantry: "personal", filter: "soon", q: "mi", limit: "10" });
    expect(result.content[0]!.text).toBe("2 items in 2 pantries, 1 to use within 3 days.");
    expect(dataOf(result)).toEqual({
      items: [
        { id: "itm_1", name: "Milk", pantry: "Your pantry", left: "1.5 L", useBy: "2026-11-11", daysToUseBy: 2, canUse: true },
        { id: "itm_2", name: "Rice", pantry: "Flat 4B", groupId: flat.orgId, left: "0.25 kg", useBy: null, daysToUseBy: null, canUse: true },
      ],
      more: false,
    });
  });

  test("pantry_list defaults to every pantry, 50 at most, and refuses a pantry that is not one", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/items", () => ok({ items: [], nextCursor: null }));
    const result = await callTool(w, token, "pantry_list");
    expect(Object.fromEntries(w.edge.last("/v1/kitchen/me/items").search)).toEqual({ pantry: "all", limit: "50" });
    expect(result.content[0]!.text).toBe("Nothing matches in the pantry.");
    const before = w.edge.calls.length;
    const bad = await callTool(w, token, "pantry_list", { pantry: "../admin" });
    expect(bad.isError).toBe(true);
    expect(w.edge.calls.length).toBe(before);
  });

  test("pantry_running_low → GET /v1/kitchen/me/restock, the running-low lines", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/restock", () => ok(restock));
    const result = await callTool(w, token, "pantry_running_low");
    expect(result.content[0]!.text).toBe("1 item running low: Rice.");
    expect(dataOf(result)).toEqual({ items: [{ name: "Rice", pantry: "Flat 4B", itemId: "itm_r", leftPercent: 15 }] });
  });

  test("shopping_list → GET /v1/kitchen/me/restock: finished, running low and usual, with last time's price in its currency", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/restock", () => ok(restock));
    const result = await callTool(w, token, "shopping_list");
    expect(result.content[0]!.text).toBe("Finished: 1 · running low: 1 · usually buy: 1.");
    const data = dataOf<Record<string, Array<Record<string, unknown>>>>(result);
    expect(data.finished![0]).toEqual({ name: "Eggs", pantry: "Your pantry", lastTime: "12 pcs for ₹120.00", canAdd: true, how: "used up" });
    expect(data.runningLow![0]).toMatchObject({ name: "Rice", lastTime: "1 kg for ₹120.00", leftPercent: 15 });
    expect(data.usual![0]).toMatchObject({ name: "Milk", everyDays: 3, lastBoughtOn: "2026-11-05" });
  });

  test("what_can_i_cook → GET /v1/kitchen/me/cook-now", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/cook-now", () =>
      ok({
        recipes: [
          { recipe: summary("rcp_a", "Dal"), match: match(), forPortionsHalf: 4 },
          { recipe: summary("rcp_b", "Raita"), match: match({ have: 1, missing: 2, missingNames: ["yogurt", "cucumber"], maxFactorMilli: null }), forPortionsHalf: null },
        ],
      }),
    );
    const result = await callTool(w, token, "what_can_i_cook");
    expect(result.content[0]!.text).toBe("1 recipe ready with what's at home: Dal.");
    expect(dataOf<{ recipes: unknown[] }>(result).recipes[1]).toEqual({
      id: "rcp_b",
      name: "Raita",
      serves: 2,
      minutes: 30,
      have: "1/3",
      missing: ["yogurt", "cucumber"],
      missingCount: 2,
      shortCount: 0,
      canServe: null,
    });
  });

  const recipe = {
    recipe: {
      ...summary("rcp_dal", "Toor dal"),
      lines: [
        { position: 0, foodKey: "toor_dal", name: "Toor dal", qtyMilli: 200_000, quantity: 200, unit: "g", dimension: "mass", toTaste: false, isMain: true },
        { position: 1, foodKey: null, name: "Water", qtyMilli: 720_000, quantity: 3, unit: "cup", dimension: "volume", toTaste: false, isMain: false },
        { position: 2, foodKey: "salt", name: "Salt", qtyMilli: null, quantity: null, unit: null, dimension: null, toTaste: true, isMain: false },
      ],
      steps: ["Rinse the dal", "Pressure cook 3 whistles"],
      linkCode: null,
      tools: ["Pressure cooker"],
    },
    lastCook: null,
  };

  test("recipe_get → GET /v1/kitchen/recipes/{id}, scaled to serves", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/recipes/rcp_dal", () => ok(recipe));
    const result = await callTool(w, token, "recipe_get", { recipeId: "rcp_dal", serves: 4 });
    expect(w.edge.last("/v1/kitchen/recipes/rcp_dal").search.get("f")).toBeNull();
    expect(result.content[0]!.text).toBe("Toor dal: serves 4, 3 ingredients, 2 steps.");
    expect(dataOf(result)).toEqual({
      id: "rcp_dal",
      name: "Toor dal",
      by: "Cookpool",
      serves: "4",
      factor: 2,
      minutes: 30,
      lines: [
        { name: "Toor dal", amount: "400 g" },
        { name: "Water", amount: "6 cup" },
        { name: "Salt", amount: "to taste" },
      ],
      steps: ["Rinse the dal", "Pressure cook 3 whistles"],
      tools: ["Pressure cooker"],
    });
  });

  test("recipe_get with a factor sends ?f= in thousandths; unscaled by default", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/recipes/rcp_dal", () => ok(recipe));
    const scaled = await callTool(w, token, "recipe_get", { recipeId: "rcp_dal", factor: 1.5 });
    expect(w.edge.last("/v1/kitchen/recipes/rcp_dal").search.get("f")).toBe("1500");
    expect(dataOf<{ lines: Array<{ amount: string }> }>(scaled).lines[0]!.amount).toBe("300 g");
    const plain = await callTool(w, token, "recipe_get", { recipeId: "rcp_dal" });
    expect(dataOf<{ factor: number; serves: string }>(plain)).toMatchObject({ factor: 1, serves: "2" });
    const bad = await callTool(w, token, "recipe_get", { recipeId: "../../v1/auth/delegations" });
    expect(bad.isError).toBe(true);
  });

  test("recipe_search → /v1/kitchen/me/recipes plus Explore's cookpool and groups, never public", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/recipes", () => ok({ recipes: [summary("rcp_m", "My dal", { isSystem: false, mine: true }), summary("rcp_x", "Pasta", { mine: true })] }));
    w.edge.on("GET /v1/kitchen/recipes", (req) =>
      ok({
        recipes:
          req.search.get("source") === "cookpool"
            ? [{ ...summary("rcp_c", "Dal tadka"), match: match({ missing: 1, missingNames: ["ghee"] }) }]
            : [{ ...summary("rcp_m", "My dal"), match: match() }, { ...summary("rcp_g", "Anu's dal", { isSystem: false, ownerName: "Anu" }), match: match() }],
      }),
    );
    const result = await callTool(w, token, "recipe_search", { query: "dal" });
    const explore = w.edge.calls.filter((c) => c.path === "/v1/kitchen/recipes").map((c) => Object.fromEntries(c.search));
    expect(explore).toEqual([
      { source: "cookpool", q: "dal" },
      { source: "groups", q: "dal" },
    ]);
    expect(result.content[0]!.text).toBe('3 recipes matching "dal".');
    expect(dataOf<{ recipes: Array<Record<string, unknown>> }>(result).recipes.map((r) => [r.id, r.by, r.have])).toEqual([
      ["rcp_m", "you", undefined],
      ["rcp_c", "Cookpool", "missing ghee"],
      ["rcp_g", "Anu", "everything"],
    ]);
  });

  test("recipe_search answers what came back when one source fails", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/recipes", () => ok({ recipes: [summary("rcp_m", "My dal")] }));
    w.edge.on("GET /v1/kitchen/recipes", () => fail(503, "internal_error"));
    const result = await callTool(w, token, "recipe_search");
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toBe("1 recipe.");
  });

  test("balances → GET /v1/kitchen/me/balances, money in each currency", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/balances", () =>
      ok({
        groups: [{ orgId: flat.orgId, slug: "flat", name: "Flat 4B", currency: "INR", balanceMinor: 90000, role: "builder", memberCount: 3 }],
        people: [
          { subjectId: "usr_anu", displayName: "Anu", groups: [{ orgId: flat.orgId, slug: "flat", name: "Flat 4B", currency: "INR", netMinor: 120000 }] },
          { subjectId: "usr_ravi", displayName: null, groups: [{ orgId: flat.orgId, slug: "flat", name: "Flat 4B", currency: "INR", netMinor: -30000 }] },
          { subjectId: "usr_zero", displayName: "Zed", groups: [{ orgId: flat.orgId, slug: "flat", name: "Flat 4B", currency: "INR", netMinor: 0 }] },
        ],
        totals: [{ currency: "INR", owedToYouMinor: 120000, youOweMinor: 30000, netMinor: 90000 }],
      }),
    );
    const result = await callTool(w, token, "balances");
    expect(result.content[0]!.text).toBe("You're owed ₹1,200.00 and you owe ₹300.00.");
    expect(dataOf(result)).toEqual({
      totals: [{ currency: "INR", owedToYou: "₹1,200.00", youOwe: "₹300.00", net: "₹900.00" }],
      groups: [{ id: flat.orgId, name: "Flat 4B", balance: "₹900.00", getsBack: true }],
      people: [
        { id: "usr_anu", name: "Anu", groups: [{ group: "Flat 4B", theyPayYou: true, amount: "₹1,200.00" }] },
        { id: "usr_ravi", name: "Someone", groups: [{ group: "Flat 4B", theyPayYou: false, amount: "₹300.00" }] },
      ],
    });
  });

  test("balances when settled", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/balances", () => ok({ groups: [], people: [], totals: [] }));
    expect((await callTool(w, token, "balances")).content[0]!.text).toBe("All settled: nothing owed either way.");
  });

  test("timer_start → POST /v1/kitchen/me/timers with an Idempotency-Key and endsAt minutes from now", async () => {
    const { w, token } = await connected();
    w.edge.on("POST /v1/kitchen/me/timers", (req) => ok({ timer: { ...timer, label: (req.body as { label: string }).label } }, 201));
    const before = Date.now();
    const result = await callTool(w, token, "timer_start", { label: "Rice", minutes: 12, note: "Turn off the gas" });
    const call = w.edge.last("/v1/kitchen/me/timers");
    expect(call.method).toBe("POST");
    expect(call.headers.get("authorization")).toBe(`Bearer ${DELEGATED}`);
    expect(call.headers.get("idempotency-key")).toMatch(/^mcp_[A-Za-z0-9_-]{20,}$/);
    const body = call.body as { label: string; body: string; endsAt: string };
    expect(body.label).toBe("Rice");
    expect(body.body).toBe("Turn off the gas");
    const ms = Date.parse(body.endsAt) - before;
    expect(ms).toBeGreaterThanOrEqual(12 * 60_000 - 1000);
    expect(ms).toBeLessThanOrEqual(12 * 60_000 + 5000);
    expect(result.content[0]!.text).toBe('Timer "Rice" set: it rings on the phone in 12 minutes.');
    expect(dataOf<{ timer: { id: string } }>(result).timer.id).toBe("tmr_abc");
  });

  test("timer_start takes 1 to 600 minutes, and asks nothing outside them", async () => {
    const { w, token } = await connected();
    const before = w.edge.calls.length;
    expect((await callTool(w, token, "timer_start", { label: "Soak", minutes: 601 })).isError).toBe(true);
    expect((await callTool(w, token, "timer_start", { label: "Soak", minutes: 0.2 })).isError).toBe(true);
    expect((await callTool(w, token, "timer_start", { label: "", minutes: 5 })).isError).toBe(true);
    expect(w.edge.calls.length).toBe(before);
  });

  test("a write api-edge could not answer is retried once with the same Idempotency-Key", async () => {
    const { w, token } = await connected();
    let n = 0;
    w.edge.on("POST /v1/kitchen/me/timers", () => (++n === 1 ? fail(503, "internal_error") : ok({ timer }, 201)));
    const result = await callTool(w, token, "timer_start", { label: "Rice", minutes: 12 });
    expect(result.isError).toBeFalsy();
    const keys = w.edge.calls.filter((c) => c.path === "/v1/kitchen/me/timers").map((c) => c.headers.get("idempotency-key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test("timer_list → GET /v1/kitchen/me/timers", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/timers", () => ok({ timers: [timer] }));
    const result = await callTool(w, token, "timer_list");
    expect(result.content[0]!.text).toBe("1 timer running: Rice (12 min).");
    expect(w.edge.last("/v1/kitchen/me/timers").headers.get("idempotency-key")).toBeNull();
  });

  test("timer_cancel → DELETE /v1/kitchen/me/timers/{id} with an Idempotency-Key", async () => {
    const { w, token } = await connected();
    w.edge.on("DELETE /v1/kitchen/me/timers/tmr_abc", () => ok({ timer: { ...timer, canceledAt: "now" } }));
    const result = await callTool(w, token, "timer_cancel", { timerId: "tmr_abc" });
    const call = w.edge.last("/v1/kitchen/me/timers/tmr_abc");
    expect(call.method).toBe("DELETE");
    expect(call.headers.get("idempotency-key")).toBeTruthy();
    expect(result.content[0]!.text).toBe('Cancelled "Rice".');
    expect((await callTool(w, token, "timer_cancel", { timerId: "tmr_abc/../../x" })).isError).toBe(true);
  });
});

// ── errors in plain words ──────────────────────────────────

describe("refusals become plain-words tool errors", () => {
  test.each([
    [fail(401, "unauthenticated"), /^Reconnect Cookpool/],
    [fail(403, "forbidden", { reason: "scope" }), /^Cookpool didn't allow this\. The person can allow it/],
    [fail(403, "forbidden"), /^Cookpool didn't allow this\.$/],
    [fail(404, "not_found"), /couldn't find that/],
    [fail(422, "validation_failed", { reason: "too_many_timers", max: 10 }), /already 10 timers running/],
    [fail(422, "validation_failed", { fields: { endsAt: ["Must be at most a day ahead"] } }), /couldn't accept that\. endsAt: Must be at most a day ahead/],
    [fail(429, "rate_limited"), /Try again in a minute/],
    [fail(500, "internal_error"), /isn't answering/],
  ])("%#: an edge answer maps to its words", async (answer, words) => {
    const { w, token } = await connected();
    const body = await answer.text();
    w.edge.on("POST /v1/kitchen/me/timers", () => new Response(body, { status: answer.status, headers: { "content-type": "application/json" } }));
    const result = await callTool(w, token, "timer_start", { label: "Rice", minutes: 5 });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.text).toMatch(words);
  });

  test("api-edge unreachable", async () => {
    const { w, token } = await connected();
    w.edge.on("GET /v1/kitchen/me/restock", () => {
      throw new Error("network");
    });
    const result = await callTool(w, token, "shopping_list");
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/isn't answering/);
  });

  test("revocation: once identity revokes the delegation, api-edge answers 401 and every tool says Reconnect", async () => {
    const { w, token } = await connected();
    let revoked = false;
    w.edge.on("GET /v1/kitchen/me/timers", (req) =>
      !revoked && req.headers.get("authorization") === `Bearer ${DELEGATED}` ? ok({ timers: [] }) : fail(401, "unauthenticated"),
    );
    expect((await callTool(w, token, "timer_list")).isError).toBeFalsy();
    revoked = true;
    const result = await callTool(w, token, "timer_list");
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^Reconnect Cookpool/);
  });
});
