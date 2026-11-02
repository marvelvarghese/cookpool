import {
  ADD_SECONDARY,
  ADD_TILES,
  KITCHEN_NAV_LINKS,
  KITCHEN_TABS,
  activeKitchenTab,
  groupActionHref,
  isKitchenTabActive,
} from "@web-console-next/components/kitchen/nav";

describe("Cookpool tabs (CP-5)", () => {
  it("are Home · Pantry · + Add · Groups · People, with Add in the centre as an action", () => {
    expect(KITCHEN_TABS.map((t) => t.label)).toEqual(["Home", "Pantry", "Add", "Groups", "People"]);
    const add = KITCHEN_TABS[2]!;
    expect(add.kind).toBe("action");
    expect("href" in add).toBe(false);
  });

  it("link to the kitchen routes", () => {
    expect(KITCHEN_NAV_LINKS.map((l) => l.href)).toEqual(["/home", "/pantry", "/groups", "/people"]);
  });

  it("name an icon for every item", () => {
    for (const t of KITCHEN_TABS) expect(t.icon).toMatch(/^[A-Z][A-Za-z]+$/);
  });
});

describe("activeKitchenTab", () => {
  it("matches a tab's own path", () => {
    expect(activeKitchenTab("/home")).toBe("home");
    expect(activeKitchenTab("/pantry")).toBe("pantry");
    expect(activeKitchenTab("/groups")).toBe("groups");
    expect(activeKitchenTab("/people")).toBe("people");
  });

  it("keeps the tab active on nested routes", () => {
    expect(activeKitchenTab("/groups/flat-4b")).toBe("groups");
    expect(activeKitchenTab("/groups/flat-4b/settle")).toBe("groups");
    expect(activeKitchenTab("/pantry/new")).toBe("pantry");
    expect(activeKitchenTab("/pantry/itm_123")).toBe("pantry");
    expect(activeKitchenTab("/people/usr_9")).toBe("people");
  });

  it("treats a join link as part of Groups", () => {
    expect(activeKitchenTab("/join/KTCH2345")).toBe("groups");
  });

  it("treats Settle up as part of Groups (CP-8)", () => {
    expect(activeKitchenTab("/settle")).toBe("groups");
    expect(activeKitchenTab("/settlement")).toBeNull();
  });

  it("ignores a trailing slash", () => {
    expect(activeKitchenTab("/groups/")).toBe("groups");
    expect(activeKitchenTab("/home/")).toBe("home");
  });

  it("does not match sibling prefixes", () => {
    expect(activeKitchenTab("/groupsx")).toBeNull();
    expect(activeKitchenTab("/homepage")).toBeNull();
    expect(activeKitchenTab("/joined")).toBeNull();
  });

  it("leaves pages reached from the Add sheet, the admin console and nothing unmatched", () => {
    expect(activeKitchenTab("/use")).toBeNull();
    expect(activeKitchenTab("/cook")).toBeNull();
    expect(activeKitchenTab("/orgs/acme/settings")).toBeNull();
    expect(activeKitchenTab("/")).toBeNull();
    expect(activeKitchenTab(null)).toBeNull();
    expect(activeKitchenTab("")).toBeNull();
  });
});

describe("isKitchenTabActive", () => {
  it("is true only for the matching tab, never for Add", () => {
    expect(isKitchenTabActive("groups", "/groups/flat-4b")).toBe(true);
    expect(isKitchenTabActive("home", "/groups/flat-4b")).toBe(false);
    expect(isKitchenTabActive("add", "/groups")).toBe(false);
    expect(isKitchenTabActive("home", null)).toBe(false);
  });
});

describe("the + Add sheet", () => {
  it("offers the four tiles, each linking to its route", () => {
    expect(ADD_TILES.map((t) => [t.label, t.href])).toEqual([
      ["I used something", "/use"],
      ["I cooked", "/cook"],
      ["I bought food", "/pantry/new"],
      ["I paid a bill", "/groups/[slug]/expense"],
    ]);
  });

  it("has every tile live: I used something (CP-13), I cooked (CP-15), I bought food (CP-12), I paid a bill (CP-8)", () => {
    expect(ADD_TILES.filter((t) => t.live).map((t) => t.id)).toEqual(["use", "cook", "buy", "bill"]);
    expect(ADD_TILES.filter((t) => !t.live)).toEqual([]);
  });

  it("asks for a group before Add expense, then goes to that group's", () => {
    const bill = ADD_TILES.find((t) => t.id === "bill")!;
    expect(bill.pickGroup).toBe(true);
    expect(ADD_TILES.filter((t) => t.pickGroup).map((t) => t.id)).toEqual(["bill"]);
    expect(groupActionHref(bill, "flat-4b-k3x9")).toBe("/groups/flat-4b-k3x9/expense");
  });

  it("has Record a payment (live, to /settle) and Invite to a group (live, to /groups)", () => {
    const payment = ADD_SECONDARY.find((a) => a.id === "payment")!;
    const invite = ADD_SECONDARY.find((a) => a.id === "invite")!;
    expect(payment.label).toBe("Record a payment");
    expect(payment.live).toBe(true);
    expect(payment.href).toBe("/settle");
    expect(invite.label).toBe("Invite to a group");
    expect(invite.live).toBe(true);
    expect(invite.href).toBe("/groups");
  });
});
