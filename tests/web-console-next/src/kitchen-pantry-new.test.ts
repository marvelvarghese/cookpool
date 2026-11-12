import type { KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import {
  LEVEL_COLORS,
  PANTRY_KINDS,
  addItemHref,
  boughtHref,
  MINE_LABEL,
  kindOf,
  pantryHrefFromUse,
  pantryRow,
  parseShow,
  pantrySections,
  quickUseFieldHref,
  showChips,
  showParams,
  useByDay,
  useSoonCard,
  type PantryShow,
} from "@web-console-next/components/kitchen/pantry-list";
import { sectionRows } from "@web-console-next/components/kitchen/pantry-look";
import { readFileSync } from "node:fs";
import { cwd } from "node:process";
import { ANU, DEV, FLAT, LUNCH, ME, NAMES, PERSONAL_REF, groupPantry, groupRef, makeItem, makeUsual as usual, morningUsual as morning, personalPantry } from "./kitchen-pantry-fixtures";

// cookpool-pantry PN-5 (design §1, §2.3, §4): the new Pantry's list — sections
// (by pantry since RV-13), the chips and their counts, each row's tag, level and suggestion
// chip — and where Home's field and /use lead in each frame.

const milk = (o: Parameters<typeof makeItem>[0] = {}) => makeItem({ name: "Milk", category: "dairy", unit: "L", bought: "1", priceMinor: 6800, ...o });
const row = (item: ReachableItem, u: KitchenUsual | null = null, showPantry = true) => ({ ...pantryRow(item, { usual: u, showPantry, meId: ME, names: NAMES }), item });

describe("sections by pantry (RV-13, the board's one flat list)", () => {
  const flat = groupRef(FLAT);
  const lunch = groupRef(LUNCH);

  it("are one per pantry — each group by its name in the chips' order, then yours as Mine — with counts, empty ones left out", () => {
    const items = [
      makeItem({ name: "Atta", category: "grains", pantry: PERSONAL_REF }),
      makeItem({ name: "Milk", category: "dairy", pantry: flat }),
      makeItem({ name: "Rice", category: "grains", pantry: lunch }),
      makeItem({ name: "Onions", category: "veg", pantry: flat }),
    ].map((i) => row(i));
    const sections = pantrySections(items, { show: { kind: "all" }, order: ["personal", LUNCH.orgId, FLAT.orgId] });
    expect(MINE_LABEL).toBe("Mine");
    expect(sections.map((s) => [s.key, s.label, s.count])).toEqual([
      [LUNCH.orgId, "Lunch club", 1],
      [FLAT.orgId, "Flat 4B", 2],
      ["personal", "Mine", 1],
    ]);
    // Never by kind: dairy and veg share Flat 4B's section.
    expect(sections[1]!.rows.map((r) => r.name)).toEqual(["Milk", "Onions"]);
  });

  it("keep a kind only for naming a typed category on the row", () => {
    expect(PANTRY_KINDS.map((k) => k.label)).toEqual(["Dairy", "Veg", "Fruit", "Grains", "Protein", "Spices", "Leftovers", "Other"]);
    expect(kindOf("Snacks")).toBe("other");
    expect(kindOf(" VEG ")).toBe("veg");
    expect(kindOf("leftovers")).toBe("leftovers");
    expect(row(makeItem({ name: "Chips", category: "snacks", bought: "1", unit: "kg" })).levelText).toContain("Snacks");
    expect(row(makeItem({ name: "Foil", category: "other" })).levelText).not.toContain("Other");
  });

  it("list use soon first (expired, then soonest), then running low, then by name", () => {
    const items = [
      makeItem({ name: "Zucchini", category: "veg" }),
      makeItem({ name: "beans", category: "fruit" }),
      makeItem({ name: "Tomatoes", category: "veg", daysToUseBy: 2 }),
      makeItem({ name: "Spinach", category: "dairy", daysToUseBy: -1 }),
      makeItem({ name: "Peas", category: "veg", daysToUseBy: 0 }),
      makeItem({ name: "Carrots", category: "veg", bought: "1", left: "0.1" }),
    ].map((i) => row(i));
    const sections = pantrySections(items, { show: { kind: "all" } });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.rows.map((r) => r.name)).toEqual(["Spinach", "Peas", "Tomatoes", "Carrots", "beans", "Zucchini"]);
  });

  it("show only what the chip and the search let through; a search shows every match", () => {
    const items = [
      makeItem({ name: "Toor dal", category: "grains" }),
      makeItem({ name: "Milk", category: "dairy", daysToUseBy: 1 }),
      makeItem({ name: "Paneer", category: "dairy", pantry: PERSONAL_REF }),
      ...["Moong dal", "Chana dal", "Urad dal"].map((name) => makeItem({ name, category: "grains" })),
    ].map((i) => row(i));
    const names = (show: PantryShow, query = "") => pantrySections(items, { show, query }).flatMap((s) => s.rows.map((r) => r.name));
    expect(names({ kind: "soon" })).toEqual(["Milk"]);
    expect(names({ kind: "pantry", key: "personal" })).toEqual(["Paneer"]);
    expect(names({ kind: "all" }, "dal toor")).toEqual(["Toor dal"]);
    expect(pantrySections(items, { show: { kind: "all" }, query: "rice" })).toEqual([]);
    // Four dals match: the section shows them all, with no See all.
    const dals = pantrySections(items, { show: { kind: "all" }, query: "dal" })[0]!;
    expect(sectionRows(dals.rows, { all: false, searching: true, openId: null })).toMatchObject({ more: false });
    expect(sectionRows(dals.rows, { all: false, searching: true, openId: null }).rows).toHaveLength(4);
  });

  it("show three rows then See all, and leave out what Usual now lists", () => {
    const items = ["Atta", "Bread", "Curd", "Dal", "Eggs"].map((name) => row(makeItem({ name })));
    const [flatSection] = pantrySections(items, { show: { kind: "all" }, exclude: new Set([items[0]!.id]) });
    expect(flatSection!.rows.map((r) => r.name)).toEqual(["Bread", "Curd", "Dal", "Eggs"]);
    expect(sectionRows(flatSection!.rows, { all: false, searching: false, openId: null })).toMatchObject({ more: true, label: "See all 4" });
    expect(sectionRows(flatSection!.rows, { all: false, searching: false, openId: null }).rows).toHaveLength(3);
  });

  it("have no fold: the Kitchen draws no fold chevron and no kind sections", () => {
    const ui = readFileSync(`${cwd()}/../../apps/web-console-next/src/components/kitchen/pantry-new-ui.tsx`, "utf8");
    expect(ui).not.toMatch(/ChevronDown|kindSections|toggleFold|sectionOpen/);
    expect(ui).toContain("pantrySections(");
  });
});

describe("the chips and their counts (design §1.4)", () => {
  const items = [
    makeItem({ name: "Milk", daysToUseBy: 1 }),
    makeItem({ name: "Yogurt", daysToUseBy: -2 }),
    makeItem({ name: "Atta", bought: "5", left: "0.6" }),
    makeItem({ name: "Rice", pantry: PERSONAL_REF }),
  ];
  const rows = items.map((i) => row(i));
  const statuses = new Map(rows.map((r) => [r.id, r.status] as const));
  const pantries = [personalPantry({ itemCount: 1 }), groupPantry(FLAT, { itemCount: 3 })];
  const chips = (show: PantryShow, list = items) => showChips({ items: list, statuses, pantries, show }).map((c) => `${c.label} ${c.count}${c.on ? "*" : ""}`);

  it("read All · Use soon N (with what expired) · Running low N · a chip per pantry", () => {
    expect(chips({ kind: "all" })).toEqual(["All 4*", "Use soon 2", "Running low 1", "Me 1", "Flat 4B 3"]);
  });

  it("hide a count of 0, except All and the one chosen", () => {
    const fresh = [items[3]!];
    expect(chips({ kind: "all" }, fresh)).toEqual(["All 1*", "Me 1"]);
    expect(chips({ kind: "low" }, fresh)).toEqual(["All 1", "Running low 0*", "Me 1"]);
  });

  it("show no pantry chips with a single pantry", () => {
    expect(showChips({ items, statuses, pantries: [personalPantry()], show: { kind: "all" } }).map((c) => c.id)).toEqual(["all", "soon", "low"]);
  });

  it("are mirrored in ?filter= and ?pantry=, one choice at a time", () => {
    expect(parseShow("soon", null)).toEqual({ kind: "soon" });
    expect(parseShow("expired", null)).toEqual({ kind: "soon" });
    expect(parseShow("low", null)).toEqual({ kind: "low" });
    expect(parseShow("nonsense", null)).toEqual({ kind: "all" });
    expect(parseShow("soon", FLAT.orgId)).toEqual({ kind: "pantry", key: FLAT.orgId });
    expect(parseShow(null, "personal")).toEqual({ kind: "pantry", key: "personal" });
    expect(showParams({ kind: "low" }, new URLSearchParams("pantry=personal&q=milk")).toString()).toBe("q=milk&filter=low");
    expect(showParams({ kind: "all" }, new URLSearchParams("filter=soon")).toString()).toBe("");
  });

  it("open the list's shopping run from + Groceries (RV-24), and add one item in the chosen pantry from the empty pantry's + Groceries", () => {
    expect(boughtHref()).toBe("/pantry/run?from=list");
    expect(addItemHref({ kind: "all" })).toBe("/pantry/new");
    expect(addItemHref({ kind: "pantry", key: FLAT.orgId })).toBe(`/pantry/new?pantry=${FLAT.orgId}`);
  });

  it("offer the use-soon card on All with no search, linking to Cook now", () => {
    const soon = [makeItem({ name: "Paneer", daysToUseBy: 1 }), makeItem({ name: "Milk", daysToUseBy: 2 }), makeItem({ name: "Tomatoes", daysToUseBy: 0 }), makeItem({ name: "Curd", daysToUseBy: 3 })].map((i) => row(i));
    expect(useSoonCard(soon, { show: { kind: "all" } })).toEqual({ title: "4 things to use soon", sub: "Paneer, milk, tomatoes and 1 more · Cook with them", href: "/cook" });
    expect(useSoonCard(soon.slice(0, 2), { show: { kind: "all" } })?.sub).toBe("Paneer and milk · Cook with them");
    expect(useSoonCard(soon, { show: { kind: "soon" } })).toBeNull();
    expect(useSoonCard(soon, { show: { kind: "all" }, query: "milk" })).toBeNull();
    expect(useSoonCard([row(makeItem({ name: "Yogurt", daysToUseBy: -1 }))], { show: { kind: "all" } })).toBeNull();
  });
});

describe("a row (design §1, §2.3)", () => {
  it("tags the pantry on All, else Use soon · day, Expired or Running low", () => {
    expect(row(milk()).tag).toEqual({ label: "Flat 4B", tone: "pantry" });
    expect(row(milk(), null, false).tag).toBeNull();
    expect(row(milk({ daysToUseBy: 1 })).tag).toEqual({ label: "Use soon · tomorrow", tone: "soon" });
    expect(row(milk({ daysToUseBy: 0 })).tag?.label).toBe("Use soon · today");
    // 2026-11-04 (fixtures' today + 2) is a Wednesday.
    expect(row(milk({ daysToUseBy: 2 })).tag?.label).toBe("Use soon · Wed");
    expect(row(milk({ daysToUseBy: -1 })).tag).toEqual({ label: "Expired", tone: "expired" });
    expect(row(milk({ left: "0.1" })).tag).toEqual({ label: "Running low", tone: "low" });
    expect(useByDay({ daysToUseBy: 3, expiresOn: "2026-11-05" })).toBe("Thu");
  });

  it("says the pantry beside the level when the tag says something else", () => {
    expect(row(milk({ left: "0.5" })).levelText).toBe("500 ml of 1 L");
    expect(row(milk({ left: "0.5", daysToUseBy: 1 })).levelText).toBe("500 ml of 1 L · Flat 4B");
    expect(row(milk({ left: "0.5", daysToUseBy: 1 }), null, false).levelText).toBe("500 ml of 1 L");
  });

  it("colours the level green, amber when running low or use soon, red once expired", () => {
    expect(LEVEL_COLORS).toEqual({ ok: "hsl(var(--primary))", low: "hsl(var(--cp-soon))", expired: "hsl(var(--cp-expired))" });
    expect(row(milk()).level).toBe("ok");
    expect(row(milk({ daysToUseBy: 2 })).level).toBe("low");
    expect(row(milk({ left: "0.15" })).level).toBe("low");
    expect(row(milk({ daysToUseBy: -1 })).level).toBe("expired");
    expect(row(milk({ daysToUseBy: -1 })).struck).toBe(true);
    // Under one usual amount is running low too.
    expect(row(milk({ left: "0.3" }), usual(milk(), { lastQtyMilli: 500_000 })).level).toBe("low");
  });

  it("ends in the suggestion chip: its amount, logged for the people from last time", () => {
    const item = milk({ left: "1" });
    const r = row(item, usual(item, { consumers: [ME, ANU] }));
    expect(r.chip).toEqual({ kind: "log", words: "1 glass", label: "Log 1 glass of Milk for you and Anu", consumers: [ME, ANU] });
    const now = row(item, usual(item, { lastQtyMilli: 500_000, now: morning(250_000, 3, [ME, DEV]) }));
    expect(now.chip).toMatchObject({ words: "1 glass", consumers: [ME, DEV] });
    expect(now.ladder.suggestion?.why).toBe("Morning usual");
  });

  it("logs for just you without a usual, names nobody for your own pantry, and offers nothing to a viewer", () => {
    expect(row(milk()).chip).toMatchObject({ kind: "log", consumers: [ME], label: "Log 1 glass of Milk for you" });
    const own = milk({ pantry: PERSONAL_REF });
    expect(row(own, usual(own)).chip).toEqual({ kind: "log", words: "1 glass", label: "Log 1 glass of Milk", consumers: [] });
    expect(row(milk({ canUse: false })).chip).toBeNull();
    expect(row(milk({ left: "0" })).chip).toBeNull();
  });

  it("is the plain variant until PN-9 tags who to ask", () => {
    expect(row(milk()).variant).toBe("use");
    const asked = { ...pantryRow(milk(), { usual: null, showPantry: true, meId: ME, askName: "Meera" }) };
    expect(asked.variant).toBe("ask");
    expect(asked.tag).toEqual({ label: "Ask Meera", tone: "ask" });
    expect(asked.chip).toBeNull();
  });
});

describe("where Home's field and /use lead (design §4)", () => {
  it("is the Pantry with its search ready in the new frame, and /use in today's", () => {
    expect(quickUseFieldHref(true)).toBe("/pantry?focus=1");
    expect(quickUseFieldHref(false)).toBe("/use");
  });

  it("maps /use?item= to the Pantry with that row open", () => {
    expect(pantryHrefFromUse(null)).toBe("/pantry?focus=1");
    expect(pantryHrefFromUse("")).toBe("/pantry?focus=1");
    expect(pantryHrefFromUse("me:itm_0001")).toBe("/pantry?open=me:itm_0001");
    expect(pantryHrefFromUse(`org%3A${FLAT.orgId}%3Aitm_0002`)).toBe(`/pantry?open=org:${FLAT.orgId}:itm_0002`);
    expect(pantryHrefFromUse("junk")).toBe("/pantry?focus=1");
  });
});
