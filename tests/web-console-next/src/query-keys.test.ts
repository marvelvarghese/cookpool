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
});
