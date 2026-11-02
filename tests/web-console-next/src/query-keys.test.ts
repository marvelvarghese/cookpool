import { qk } from "@web-console-next/lib/query-keys";

describe("query cache keys (qk)", () => {
  it("produces a stable, equal key for the same resource+scope", () => {
    expect(qk.projects("org_1")).toEqual(qk.projects("org_1"));
    expect(qk.environments("org_1", "prj_1")).toEqual(qk.environments("org_1", "prj_1"));
    expect(qk.orgs()).toEqual(qk.orgs());
  });

  it("scopes keys by id so different scopes don't share a cache entry", () => {
    expect(qk.projects("org_1")).not.toEqual(qk.projects("org_2"));
    expect(qk.environments("org_1", "prj_1")).not.toEqual(qk.environments("org_1", "prj_2"));
  });

  it("never collides across resources sharing the same scope id", () => {
    const org = "org_1";
    const keys = [
      qk.projects(org),
      qk.members(org),
      qk.invitations(org),
      qk.apiKeys(org),
      qk.webhooks(org),
      qk.billingSummary(org),
      qk.entitlements(org),
      qk.invoices(org),
      qk.kitchenSettings(org),
      qk.joinCode(org),
    ].map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("Cookpool keys: kitchen settings and the join code per group, the preview per code (CP-5)", () => {
    expect(qk.kitchenSettings("org_1")).toEqual(["kitchenSettings", "org_1"]);
    expect(qk.joinCode("org_1")).toEqual(["joinCode", "org_1"]);
    expect(qk.joinPreview("KTCH2345")).toEqual(["joinPreview", "KTCH2345"]);
    expect(qk.joinCode("org_1")).not.toEqual(qk.joinCode("org_2"));
  });

  it("Cookpool ledger keys share one per-group prefix, so one invalidation refreshes them all (CP-8)", () => {
    const prefix = qk.kitchenLedger("org_1");
    const keys = [
      qk.kitchenActivity("org_1"),
      qk.kitchenActivityAll("org_1"),
      qk.kitchenBalances("org_1"),
      qk.kitchenSettlePlan("org_1"),
    ];
    for (const k of keys) expect(k.slice(0, prefix.length)).toEqual([...prefix]);
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
    expect(qk.kitchenBalances("org_1")).not.toEqual(qk.kitchenBalances("org_2"));
    expect(qk.kitchenLedger("org_1")).not.toEqual(qk.kitchenSettings("org_1"));
  });

  it("Cookpool pantry keys share one prefix, so one invalidation after a stock write refreshes them all (CP-12)", () => {
    const prefix = qk.kitchenPantry();
    const keys = [
      qk.kitchenPantries(),
      qk.kitchenPantryItems("all"),
      qk.kitchenPantryItems("personal"),
      qk.kitchenPantryItems("org_1"),
      qk.kitchenUseSoon(),
      qk.kitchenItem("me:itm_1"),
      qk.kitchenItemMoves("me:itm_1"),
      // Quick use (CP-13): a use refreshes the usuals, a search and the usable items too.
      qk.kitchenUsuals(),
      qk.kitchenSearch("milk"),
      qk.kitchenUsable(),
      // The dish maker (CP-15): cooking takes stock, so it refreshes what can be cooked with too.
      qk.kitchenCookable(),
    ];
    for (const k of keys) expect(k.slice(0, prefix.length)).toEqual([...prefix]);
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
    expect(qk.kitchenItem("me:itm_1")).not.toEqual(qk.kitchenItem("org:org_1:itm_1"));
    expect(qk.kitchenSearch("milk")).not.toEqual(qk.kitchenSearch("rice"));
    expect(qk.kitchenPantry()).not.toEqual(qk.kitchenMe());
    expect(qk.kitchenPantry()).not.toEqual(qk.kitchenLedger("org_1"));
  });

  it("Cookpool dish reads share their own prefix (CP-15), apart from the pantry's and the ledger's", () => {
    expect(qk.kitchenDishes()).toEqual(["kitchenDishes"]);
    expect(qk.kitchenDishes()[0]).not.toBe(qk.kitchenPantry()[0]);
    expect(qk.kitchenDishes()[0]).not.toBe(qk.kitchenLedger("org_1")[0]);
    expect(qk.kitchenDishes()[0]).not.toBe(qk.kitchenMe()[0]);
  });

  it("each key starts with a distinct resource tag", () => {
    expect(qk.orgs()[0]).toBe("orgs");
    expect(qk.projects("o")[0]).toBe("projects");
    expect(qk.environments("o", "p")[0]).toBe("environments");
    expect(qk.webhookEndpoint("o", "e")[0]).toBe("webhookEndpoint");
    expect(qk.billingSummary("o")[0]).toBe("billingSummary");
  });

  it("webhook endpoint key carries both org and endpoint id", () => {
    expect(qk.webhookEndpoint("org_1", "ep_9")).toEqual(["webhookEndpoint", "org_1", "ep_9"]);
  });

  it("Cookpool people keys share the kitchenMe prefix, so a ledger write refreshes them together (CP-9)", () => {
    const prefix = qk.kitchenMe();
    for (const k of [qk.kitchenMyBalances(), qk.kitchenPerson("usr_dev")]) expect(k.slice(0, prefix.length)).toEqual([...prefix]);
    expect(qk.kitchenPerson("usr_dev")).not.toEqual(qk.kitchenPerson("usr_anu"));
    expect(qk.kitchenMembers("org_1")).toEqual(["kitchenMembers", "org_1"]);
    expect(qk.kitchenMembers("org_1")).not.toEqual(qk.members("org_1"));
  });

  it("Cookpool dish keys share the kitchenDishes prefix, so one invalidation after a dish write refreshes them all (CP-17)", () => {
    const prefix = qk.kitchenDishes();
    const keys = [qk.kitchenDish("dsh_1"), qk.kitchenGroupDishes("org_1")];
    for (const k of keys) expect(k.slice(0, prefix.length)).toEqual([...prefix]);
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(keys.length);
    expect(qk.kitchenDish("dsh_1")).not.toEqual(qk.kitchenDish("dsh_2"));
    expect(qk.kitchenGroupDishes("org_1")).not.toEqual(qk.kitchenGroupDishes("org_2"));
    expect(qk.kitchenDishes()).not.toEqual(qk.kitchenPantry());
    expect(qk.kitchenDishes()).not.toEqual(qk.kitchenLedger("org_1"));
  });
});
