/* eslint-disable @typescript-eslint/no-explicit-any -- loose reads of JSON envelopes in tests */
// Groups, friends outside groups, insights and export (SE-2 doneWhen 1 and 5),
// with membership-worker's own router behind the binding.

import { authorize } from "@saas/policy-engine";
import { SPLITECO_ACTIONS, type SplitecoExport, type SplitecoGroupsResponse, type SplitecoInsightsResponse } from "@saas/contracts/spliteco";
import { WRITE_ROLES } from "@spliteco-worker/membership";
import { ANU, DEV, ME, MEERA, OUTSIDER, add, envelope, equal, key, usr, world } from "./helpers.js";

const groups = async (h: ReturnType<typeof world>["h"], as = ME) =>
  (await envelope<SplitecoGroupsResponse>(await h.call("GET", "/v1/spliteco/me/groups", { as }))).data;

describe("groups", () => {
  it("lists every group you're in, kitchens included, tagged by where it was made", async () => {
    const { h } = world();
    const list = await groups(h);
    expect(list.groups.map((g) => [g.name, g.madeIn, g.kind, g.memberCount])).toEqual([
      ["Flat 4B", "cookpool", "kitchen", 3],
      ["Goa Trip", "spliteco", "trip", 4],
    ]);
    expect(list.friends.map((f) => f.name).sort()).toEqual(["Anu", "Dev", "Meera"]);
  });

  it("makes a group in Spliteco: made_in spliteco, the caller its owner", async () => {
    const { h } = world();
    const res = await h.call("POST", "/v1/spliteco/groups", { as: ME, body: { name: "Weekend trek", kind: "trip" }, headers: { "idempotency-key": key() } });
    expect(res.status).toBe(201);
    const made = (await envelope<any>(res)).data.group;
    expect(made).toMatchObject({ name: "Weekend trek", kind: "trip", madeIn: "spliteco", role: "owner" });
    const row = h.db.prepare("SELECT made_in, kind FROM membership_organizations WHERE name = 'Weekend trek'").get();
    expect(row).toEqual({ made_in: "spliteco", kind: "trip" });
    expect((await groups(h)).groups.map((g) => g.name)).toContain("Weekend trek");
    const bad = await h.call("POST", "/v1/spliteco/groups", { as: ME, body: { name: "x", kind: "direct" } });
    expect(bad.status).toBe(422);
  });
});

describe("friends outside groups", () => {
  it("makes the hidden two-person group once, only with someone you share a group with", async () => {
    const { h } = world();
    const first = await h.call("POST", `/v1/spliteco/me/friends/${MEERA}/direct`, { as: ME });
    expect(first.status).toBe(201);
    const direct = (await envelope<any>(first)).data.group;
    expect(direct).toMatchObject({ kind: "direct", madeIn: "spliteco", name: "Outside groups", memberCount: 2 });
    const again = await h.call("POST", `/v1/spliteco/me/friends/${ME}/direct`, { as: MEERA });
    expect(again.status).toBe(200);
    expect((await envelope<any>(again)).data.group.id).toBe(direct.id);

    const stranger = await h.call("POST", `/v1/spliteco/me/friends/${OUTSIDER}/direct`, { as: ME });
    expect(stranger.status).toBe(403);
    expect((await envelope(stranger)).error.details.reason).toBe("no_shared_group");

    // An expense between the two, then the friend view and Home.
    await add(h, { id: null as never, publicId: direct.id, name: "" }, equal(64000, ME, [ME, MEERA], { title: "Movie night" }));
    const friend = (await envelope<any>(await h.call("GET", `/v1/spliteco/me/friends/${MEERA}`, { as: ME }))).data;
    expect(friend.directGroupId).toBe(direct.id);
    expect(friend.byGroup.find((b: any) => b.kind === "direct")).toMatchObject({ groupName: "Outside groups", amountMinor: 32000 });
    const list = await groups(h);
    expect(list.groups.map((g) => g.kind)).not.toContain("direct");
    expect(list.friends.find((f) => f.subjectId === MEERA)).toMatchObject({ outsideGroups: true, balances: [{ currency: "INR", amountMinor: 32000 }] });
  });

  it("never lists, joins by code or caps on a direct group in membership-worker", async () => {
    const { h } = world();
    await h.call("POST", `/v1/spliteco/me/friends/${MEERA}/direct`, { as: ME });
    const listed = (await envelope<any>(await h.membership("GET", "/v1/organizations", { as: ME }))).data.organizations;
    expect(listed.map((o: any) => o.kind)).not.toContain("direct");
    const internal = (await envelope<any>(await h.membership("GET", `/v1/internal/membership/subjects/${ME}/organizations`, { as: null }))).data.organizations;
    expect(internal.map((o: any) => o.kind)).not.toContain("direct");
    const view = (await envelope<any>(await h.membership("GET", `/v1/internal/membership/subjects/${ME}/organizations?view=spliteco`, { as: null }))).data.organizations;
    expect(view.find((o: any) => o.kind === "direct").members.map((m: any) => m.subjectId).sort()).toEqual([ME, MEERA].sort());
    // A public create can neither make a direct group nor take a direct- slug.
    expect((await h.membership("POST", "/v1/organizations", { as: ME, body: { name: "x", kind: "direct" } })).status).toBe(422);
    expect((await h.membership("POST", "/v1/organizations", { as: ME, body: { name: "x", slug: "direct-abc" } })).status).toBe(422);
  });

  it("does not count direct groups toward the 50-group cap", async () => {
    const { h } = world();
    // Me in 49 ordinary groups (two from the world) plus direct groups with three friends.
    for (let i = 0; i < 47; i++) h.grant(ME, h.group(`G${i}`), "builder");
    for (const friend of [ANU, DEV, MEERA]) await h.call("POST", `/v1/spliteco/me/friends/${friend}/direct`, { as: ME });
    const fiftieth = await h.membership("POST", "/v1/organizations", { as: ME, body: { name: "Fiftieth" } });
    expect(fiftieth.status).toBe(201);
    const fiftyFirst = await h.membership("POST", "/v1/organizations", { as: ME, body: { name: "One too many" } });
    expect(fiftyFirst.status).toBe(412);
  });
});

describe("insights and export", () => {
  it("charts a month by category and by payer, and six months of your share", async () => {
    let clock = new Date("2026-10-15T10:00:00.000Z");
    const { h, goa, flat } = world({ deps: { now: () => clock } });
    await add(h, goa, equal(12000, ME, [ME, ANU, DEV], { category: "transport", occurredAt: "2026-10-10T10:00:00.000Z" }));
    clock = new Date("2026-11-15T10:00:00.000Z");
    await add(h, goa, equal(18000, MEERA, [ME, ANU, DEV, MEERA], { category: "stay", occurredAt: "2026-11-08T10:00:00.000Z" }));
    await add(h, flat, equal(3000, ANU, [ME, ANU, DEV], { category: "food", occurredAt: "2026-11-09T10:00:00.000Z" }));
    const all = (await envelope<SplitecoInsightsResponse>(await h.call("GET", "/v1/spliteco/insights?month=2026-11", { as: ME }))).data;
    expect(all.byCategory).toEqual([
      { category: "stay", amountMinor: 4500 },
      { category: "food", amountMinor: 1000 },
    ]);
    expect(all.byPayer).toEqual([
      { subjectId: MEERA, amountMinor: 18000 },
      { subjectId: ANU, amountMinor: 3000 },
    ]);
    expect(all.byMonth.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(all.byMonth.slice(-2).map((m) => m.amountMinor)).toEqual([4000, 5500]);
    expect(all).toMatchObject({ myShareMinor: 5500, myPaidMinor: 0, expenseCount: 2, previousMonthShareMinor: 4000, currency: "INR" });
    const one = (await envelope<SplitecoInsightsResponse>(await h.call("GET", `/v1/spliteco/insights?groupId=${goa.publicId}&month=2026-11`, { as: ME }))).data;
    expect(one.byPayer).toEqual([{ subjectId: MEERA, amountMinor: 18000 }]);
    expect((await h.call("GET", `/v1/spliteco/insights?groupId=${goa.publicId}`, { as: OUTSIDER })).status).toBe(404);
    expect((await h.call("GET", "/v1/spliteco/insights?month=2026-13", { as: ME })).status).toBe(422);
  });

  it("exports a group as CSV and as JSON", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(30000, ME, [ME, ANU, DEV], { title: "=HYPERLINK(\"x\")", category: "stay" }));
    const csv = await h.call("GET", `/v1/spliteco/groups/${goa.publicId}/export.csv`, { as: ME });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(csv.headers.get("content-disposition")).toMatch(/attachment; filename="spliteco-goa-trip-.*\.csv"/);
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toBe("Date,Title,Category,Kind,Total,Currency,You,Anu,Dev,Meera");
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},"'=HYPERLINK\(""x""\)",stay,expense,300\.00,INR,200\.00,-100\.00,-100\.00,0\.00$/);
    expect(lines[2]).toBe(",Total balance,,,,INR,200.00,-100.00,-100.00,0.00");
    const json = (await envelope<SplitecoExport>(await h.call("GET", `/v1/spliteco/groups/${goa.publicId}/export.json`, { as: ME }))).data;
    expect(json.group).toMatchObject({ name: "Goa Trip", madeIn: "spliteco", currency: "INR" });
    expect(json.expenses).toHaveLength(1);
    expect(json.balances.find((b) => b.subjectId === ME)!.balanceMinor).toBe(20000);
    expect((await h.call("GET", `/v1/spliteco/groups/${goa.publicId}/export.csv`, { as: OUTSIDER })).status).toBe(404);
  });
});

describe("grants", () => {
  it("WRITE_ROLES is exactly the roles the policy engine grants spliteco.expense.write", () => {
    const orgId = "00000000-0000-4000-8000-000000000001";
    for (const role of ["owner", "admin", "builder", "viewer", "billing_admin"]) {
      const decide = (action: string) =>
        authorize({
          subject: { type: "user", id: usr(1) },
          action,
          resource: { kind: "organization", orgId },
          context: { memberships: [{ kind: "role_assignment", role: role as never, scope: { kind: "organization", orgId } }] },
        }).allow;
      expect(decide("spliteco.expense.write")).toBe(WRITE_ROLES.has(role));
      expect(decide("spliteco.ledger.read")).toBe(role !== "billing_admin");
    }
    expect(SPLITECO_ACTIONS).toEqual(["spliteco.ledger.read", "spliteco.expense.write"]);
  });
});
