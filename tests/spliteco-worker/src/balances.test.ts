// GET /v1/spliteco/me/balances (MY-15): everyone you share a group with, once,
// with the net per currency and the groups behind it.

import type { SplitecoBalancesResponse, SplitecoSettlementResponse } from "@saas/contracts/spliteco";
import { ANU, DEV, ME, MEERA, OUTSIDER, add, envelope, equal, key, world } from "./helpers.js";

const read = async (h: ReturnType<typeof world>["h"], as = ME) => {
  const res = await h.call("GET", "/v1/spliteco/me/balances", { as });
  expect(res.status).toBe(200);
  return (await envelope<SplitecoBalancesResponse>(res)).data;
};

describe("GET /v1/spliteco/me/balances", () => {
  it("is empty ledgers: everyone you share a group with is listed once, settled", async () => {
    const { h } = world();
    const r = await read(h);
    expect(r.me).toMatchObject({ subjectId: ME, name: "You" });
    expect(r.people.map((p) => p.name)).toEqual(["Anu", "Dev", "Meera"]);
    expect(r.people.every((p) => p.settled && p.balances.length === 0 && p.plans.length === 0)).toBe(true);
    const anu = r.people.find((p) => p.subjectId === ANU)!;
    expect(anu.groups.map((g) => [g.groupName, g.amountMinor])).toEqual([["Flat 4B", 0], ["Goa Trip", 0]]);
    expect(r.people.find((p) => p.subjectId === MEERA)!.groups.map((g) => g.groupName)).toEqual(["Goa Trip"]);
  });

  it("nets across groups: the net is the sum of the group rows, Kitchen first, the plan beside it", async () => {
    const { h, flat, goa } = world();
    await add(h, flat, equal(300_00, ME, [ME, ANU, DEV])); // Anu owes me 100
    await add(h, goa, equal(400_00, ANU, [ME, ANU, DEV, MEERA])); // I owe Anu 100
    await add(h, goa, equal(200_00, ME, [ME, ANU]), ME); // Anu owes me 100 more
    const r = await read(h);
    const anu = r.people.find((p) => p.subjectId === ANU)!;
    expect(anu.groups.map((g) => [g.groupName, g.madeIn, g.amountMinor])).toEqual([
      ["Flat 4B", "cookpool", 100_00],
      ["Goa Trip", "spliteco", 0],
    ]);
    expect(anu.balances).toEqual([{ currency: "INR", amountMinor: 100_00 }]);
    expect(anu.settled).toBe(false);
    for (const p of r.people) {
      const sum = new Map<string, number>();
      for (const g of p.groups) sum.set(g.currency, (sum.get(g.currency) ?? 0) + g.amountMinor);
      expect(p.balances).toEqual([...sum].filter(([, v]) => v !== 0).map(([currency, amountMinor]) => ({ currency, amountMinor })));
      for (const g of p.groups) if (g.buckets) expect(g.buckets.kitchen + g.buckets.other).toBe(g.amountMinor);
    }
    expect(anu.groups[0]!.buckets).toEqual({ kitchen: 0, other: 100_00 });
    // A person's page needs the payments: Anu pays me in Flat 4B.
    expect(anu.plans).toContainEqual({ groupId: expect.any(String), groupName: "Flat 4B", currency: "INR", fromSubjectId: ANU, toSubjectId: ME, amountMinor: 100_00 });
    // Largest first; Meera owes me nothing and is last, settled.
    expect(r.people.at(-1)!.settled).toBe(true);
  });

  it("keeps currencies apart: INR and USD in different groups are two balances, never summed", async () => {
    const { h, flat, goa } = world();
    await add(h, flat, equal(200_00, ME, [ME, ANU])); // Anu owes me 100 INR
    // A group counts in the currency its settings say: Goa Trip is in dollars.
    h.db.prepare("INSERT INTO kitchen_group_settings (org_id, currency) VALUES (?, 'USD') ON CONFLICT (org_id) DO UPDATE SET currency = 'USD'").run(goa.id);
    await add(h, goa, equal(60_00, ANU, [ME, ANU], { currency: "USD" })); // I owe Anu 30 USD
    const anu = (await read(h)).people.find((p) => p.subjectId === ANU)!;
    expect(anu.balances).toEqual(expect.arrayContaining([{ currency: "INR", amountMinor: 100_00 }, { currency: "USD", amountMinor: -30_00 }]));
    expect(anu.balances).toHaveLength(2);
    expect(anu.groups.map((g) => [g.groupName, g.currency, g.amountMinor])).toEqual([
      ["Flat 4B", "INR", 100_00],
      ["Goa Trip", "USD", -30_00],
    ]);
  });

  it("lists a person who settled up as settled, still with their groups", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(200_00, ME, [ME, ANU]));
    const paid = await h.call("POST", `/v1/spliteco/groups/${goa.publicId}/settlements`, {
      as: ANU,
      body: { toSubjectId: ME, amountMinor: 100_00, method: "cash" },
      headers: { "idempotency-key": key() },
    });
    expect(paid.status).toBe(201);
    expect((await envelope<SplitecoSettlementResponse>(paid)).data.payment.amountMinor).toBe(100_00);
    const anu = (await read(h)).people.find((p) => p.subjectId === ANU)!;
    expect(anu).toMatchObject({ settled: true, balances: [], plans: [] });
    expect(anu.groups.find((g) => g.groupName === "Goa Trip")).toMatchObject({ amountMinor: 0 });
  });

  it("is each caller's own view, and a stranger sees nobody", async () => {
    const { h, goa } = world();
    await add(h, goa, equal(300_00, ME, [ME, ANU, DEV]));
    const anu = await read(h, ANU);
    expect(anu.people.find((p) => p.subjectId === ME)!.balances).toEqual([{ currency: "INR", amountMinor: -100_00 }]);
    expect(await read(h, OUTSIDER)).toMatchObject({ people: [] });
    const unauth = await h.call("GET", "/v1/spliteco/me/balances", { as: null });
    expect(unauth.status).toBe(401);
  });
});
