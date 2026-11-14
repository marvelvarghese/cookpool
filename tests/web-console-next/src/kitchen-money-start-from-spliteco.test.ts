// money-native MY-10: Start from Spliteco — the picker, the mapping from a
// picked Spliteco group to Add group's fields, and the create payload.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SplitecoGroupResponse, SplitecoGroupSummary } from "@saas/contracts/spliteco";
import { LookScope } from "@saas/spliteco-ui/look";
import {
  createGroupPlan,
  currencyChoices,
  isAdded,
  mainCurrency,
  peopleCount,
  pickableGroups,
  recencyOrder,
  searchGroups,
  startFromSpliteco,
} from "@web-console-next/components/kitchen/money-start-from-spliteco";
import { SplitecoGroupPicker, StartFromSplitecoRow } from "@web-console-next/components/kitchen/money-start-from-spliteco-ui";

const g = (id: string, name: string, over: Partial<SplitecoGroupSummary> = {}): SplitecoGroupSummary => ({
  id, name, kind: "trip", madeIn: "spliteco", role: "owner", currency: "INR", memberCount: 3, myBalanceMinor: 0, myPlan: [], myBuckets: null, ...over,
});

const goa = g("org_goa", "Goa trip", { memberCount: 4, myBalanceMinor: 120000 });
const flat = g("org_flat", "Flat 4B", { madeIn: "cookpool", kind: "kitchen" });
const lunch = g("org_lunch", "Lunch Club", { myBalanceMinor: -5000 });
const direct = g("org_dir", "Outside groups", { kind: "direct" });

const detail = (currencies: string[], ledger = "INR"): SplitecoGroupResponse =>
  ({
    group: g("org_goa", "Goa trip", { currency: ledger }),
    members: [
      { subjectId: "usr_me", name: "Me", role: "owner" },
      { subjectId: "usr_a", name: "Asha", role: "builder" },
      { subjectId: "usr_b", name: null, role: "builder" },
    ],
    expenses: currencies.map((currency, i) => ({ id: `txn_${i}`, currency })),
  }) as unknown as SplitecoGroupResponse;

describe("the list", () => {
  it("never offers the hidden direct groups", () => {
    expect(pickableGroups([goa, direct]).map((x) => x.id)).toEqual(["org_goa"]);
  });

  it("searches by name, ignoring case and accents", () => {
    const list = [g("1", "Café Crew"), goa, lunch];
    expect(searchGroups(list, "cafe").map((x) => x.id)).toEqual(["1"]);
    expect(searchGroups(list, "  TRIP").map((x) => x.id)).toEqual(["org_goa"]);
    expect(searchGroups(list, "goa").map((x) => x.id)).toEqual(["org_goa"]);
    expect(searchGroups(list, "").length).toBe(3);
  });

  it("lists recent first, then the rest by name", () => {
    const recent = recencyOrder([
      { groupId: "org_lunch", at: "2026-11-10T00:00:00Z" },
      { groupId: "org_goa", at: "2026-11-12T00:00:00Z" },
      { groupId: "org_lunch", at: "2026-11-01T00:00:00Z" },
    ]);
    expect(recent).toEqual(["org_goa", "org_lunch"]);
    const quiet = g("org_a", "Aardvark");
    expect(searchGroups([quiet, lunch, goa], "", recent).map((x) => x.id)).toEqual(["org_goa", "org_lunch", "org_a"]);
  });

  it("marks Cookpool-made and already-brought groups as Added", () => {
    expect(isAdded(flat, [])).toBe(true);
    expect(isAdded(goa, [])).toBe(false);
    expect(isAdded(goa, ["org_goa"])).toBe(true);
    expect(isAdded(goa, new Set(["org_goa"]))).toBe(true);
  });

  it("renders people count and balance, and Added rows are shown but not selectable", () => {
    const html = renderToStaticMarkup(
      createElement(LookScope, { theme: "cookpool" }, createElement(SplitecoGroupPicker, {
        groups: [goa, flat], recent: [], addedIds: [], onPick: () => {}, onClose: () => {},
      })),
    );
    expect(html).toContain("4 people");
    expect(html).toContain("₹1,200");
    const added = html.match(/<button[^>]*data-group="org_flat"[^>]*>/)?.[0] ?? "";
    expect(added).toMatch(/ disabled=/);
    expect(added).toContain('data-added="true"');
    expect(html).toContain("Added");
    expect(html.match(/<button[^>]*data-group="org_goa"[^>]*>/)?.[0]).not.toMatch(/ disabled=/);
  });

  it("the row reads Start from Spliteco, then names the pick", () => {
    expect(renderToStaticMarkup(createElement(StartFromSplitecoRow, { picked: null, onOpen: () => {} }))).toContain("Start from Spliteco");
    expect(renderToStaticMarkup(createElement(StartFromSplitecoRow, { picked: { name: "Goa trip", people: 1 }, onOpen: () => {} }))).toContain("1 person");
    expect(peopleCount(2)).toBe("2 people");
  });
});

describe("a pick fills Add group", () => {
  it("takes the name, the main currency and the people (not me)", () => {
    const s = startFromSpliteco(detail(["INR", "INR"]), "usr_me");
    expect(s).toMatchObject({ fromGroupId: "org_goa", name: "Goa trip", currency: "INR", multiCurrency: false });
    expect(s.people.map((p) => p.subjectId)).toEqual(["usr_a", "usr_b"]);
  });

  it("a Spliteco group with several currencies still gives one: the main, with the rest selectable", () => {
    const s = startFromSpliteco(detail(["USD", "USD", "USD", "INR"], "INR"), "usr_me");
    expect(s.currency).toBe("USD");
    expect(s.currencies).toEqual(["USD", "INR"]);
    expect(s.multiCurrency).toBe(true);
  });

  it("ties go to the group's ledger currency; an empty group uses it too", () => {
    expect(mainCurrency({ currency: "EUR" }, ["USD", "EUR"])).toBe("EUR");
    expect(mainCurrency({ currency: "EUR" }, [])).toBe("EUR");
  });

  it("nothing is greyed out: every currency, the group's own included, is a choice", () => {
    const std = [{ code: "INR", label: "Indian rupee (INR)" }];
    expect(currencyChoices(std, ["JPY", "INR"])).toEqual([...std, { code: "JPY", label: "JPY" }]);
  });
});

describe("name stays editable and Create group brings the people", () => {
  const from = startFromSpliteco(detail(["INR"]), "usr_me");

  it("renaming changes only the Cookpool payload; the source group is untouched", () => {
    const before = JSON.stringify(from);
    const plan = createGroupPlan({ name: "  Goa 2026 ", currency: from.currency, wastePolicy: "split_equally" as never, from });
    expect(plan.name).toBe("Goa 2026");
    expect(plan.fromSplitecoGroupId).toBe("org_goa");
    expect(JSON.stringify(from)).toBe(before);
  });

  it("carries the one chosen currency, the food rule and the people", () => {
    const plan = createGroupPlan({ name: "Goa", currency: "USD", wastePolicy: "buyer_absorbs" as never, from });
    expect(plan).toMatchObject({ currency: "USD", wastePolicy: "buyer_absorbs", bringSubjectIds: ["usr_a", "usr_b"] });
  });

  it("by hand brings nobody", () => {
    expect(createGroupPlan({ name: "Flat", currency: "INR", wastePolicy: "split_equally" as never, from: null })).toMatchObject({ fromSplitecoGroupId: null, bringSubjectIds: [] });
  });
});
