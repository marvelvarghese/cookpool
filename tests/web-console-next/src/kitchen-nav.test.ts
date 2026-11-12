import {
  ADD_TILES,
  KITCHEN_NAV_LINKS,
  KITCHEN_SIDEBAR_LINKS,
  KITCHEN_TABS,
  activeKitchenTab,
  groupActionHref,
  isKitchenTabActive,
  isSidebarLinkActive,
} from "@web-console-next/components/kitchen/nav";
import { KITCHEN_ICONS } from "@web-console-next/components/kitchen/icons";

describe("Cookpool tabs (CP-5)", () => {
  it("are Home · Pantry · + Add · Groups · People, with Add in the centre as an action", () => {
    expect(KITCHEN_TABS.map((t) => t.label)).toEqual(["Home", "Kitchen", "Add", "Groups", "People"]);
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

  it("treats Settle up as part of People (SM-11: one screen)", () => {
    expect(activeKitchenTab("/settle")).toBe("people");
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

describe("the + Add sheet (SM-10: the four things that happen, and nothing else)", () => {
  it("offers the four tiles, each a word or two, each linking to its route", () => {
    expect(ADD_TILES.map((t) => [t.label, t.href])).toEqual([
      ["Used", "/use"],
      ["Cooked", "/cook"],
      ["Bought", "/pantry/new"],
      ["Paid a bill", "/groups/[slug]/expense"],
    ]);
    for (const t of ADD_TILES) expect(KITCHEN_ICONS[t.icon]).toBeDefined();
  });

  it("asks for a group before Add expense, then goes to that group's", () => {
    const bill = ADD_TILES.find((t) => t.id === "bill")!;
    expect(bill.pickGroup).toBe(true);
    expect(ADD_TILES.filter((t) => t.pickGroup).map((t) => t.id)).toEqual(["bill"]);
    expect(groupActionHref(bill, "flat-4b-k3x9")).toBe("/groups/flat-4b-k3x9/expense");
  });

  it("has no captions under the tiles and no second list (Do it again, Record a payment, Invite)", () => {
    for (const t of ADD_TILES) expect(Object.keys(t).sort()).toEqual(t.pickGroup ? ["href", "icon", "id", "label", "pickGroup"] : ["href", "icon", "id", "label"]);
    expect(ADD_TILES).toHaveLength(4);
  });
});

describe("the sidebar's Me (Cookpool SI-6)", () => {
  it("lists the tabs' links, then Me, which opens You", () => {
    expect(KITCHEN_SIDEBAR_LINKS.map((l) => [l.label, l.href])).toEqual([
      ["Home", "/home"],
      ["Kitchen", "/pantry"],
      ["Groups", "/groups"],
      ["People", "/people"],
      ["Me", "/you"],
    ]);
    for (const l of KITCHEN_SIDEBAR_LINKS) expect(KITCHEN_ICONS[l.icon]).toBeDefined();
  });

  it("leaves the phone tab bar as it was", () => {
    expect(KITCHEN_TABS.map((t) => t.label)).toEqual(["Home", "Kitchen", "Add", "Groups", "People"]);
    expect(activeKitchenTab("/you")).toBeNull();
  });

  it("marks Me on /you only, and the rest as their tabs", () => {
    expect(isSidebarLinkActive("you", "/you")).toBe(true);
    expect(isSidebarLinkActive("you", "/you/")).toBe(true);
    expect(isSidebarLinkActive("you", "/young")).toBe(false);
    expect(isSidebarLinkActive("you", "/home")).toBe(false);
    expect(isSidebarLinkActive("you", null)).toBe(false);
    expect(isSidebarLinkActive("home", "/home")).toBe(true);
    expect(isSidebarLinkActive("groups", "/join/KTCH2345")).toBe(true);
    expect(isSidebarLinkActive("home", "/you")).toBe(false);
  });
});
