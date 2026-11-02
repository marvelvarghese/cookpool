import { formatMinor } from "@saas/kitchen-engine/money";
import { pricePerUnit } from "@saas/kitchen-engine/units";
import {
  ALL_PANTRIES,
  PERSONAL_PANTRY,
  expiryChip,
  expiryText,
  filterChips,
  itemHref,
  itemRefOf,
  itemRefParam,
  itemRowView,
  joinNames,
  leftOfBought,
  pantryChoice,
  pantryPickerList,
  pantryRows,
  pantrySections,
  pantrySummary,
  parseFilterParam,
  parseItemRef,
  parsePantryParam,
  soonStrip,
  stockMeta,
  worthText,
} from "@web-console-next/components/kitchen/pantry";
import {
  ANU,
  DEV,
  FLAT,
  LUNCH,
  ME,
  NAMES,
  PERSONAL_REF,
  TRIP,
  groupPantry,
  groupRef,
  makeItem,
  personalPantry,
} from "./kitchen-pantry-fixtures";

describe("the item page's address (/pantry/[itemRef])", () => {
  it("names your own item me:itm_… and a group's org:org_…:itm_…", () => {
    expect(itemRefParam({ kind: "personal", itemId: "itm_abc123" })).toBe("me:itm_abc123");
    expect(itemRefParam({ kind: "group", orgId: FLAT.orgId, itemId: "itm_abc123" })).toBe(`org:${FLAT.orgId}:itm_abc123`);
  });

  it("parses both forms back, also percent-encoded as a router may pass them", () => {
    expect(parseItemRef("me:itm_abc123")).toEqual({ kind: "personal", itemId: "itm_abc123" });
    expect(parseItemRef(`org:${FLAT.orgId}:itm_abc123`)).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: "itm_abc123" });
    expect(parseItemRef(`org%3A${FLAT.orgId}%3Aitm_abc123`)).toEqual({ kind: "group", orgId: FLAT.orgId, itemId: "itm_abc123" });
  });

  it("round-trips every item's ref through the URL", () => {
    for (const item of [makeItem({ pantry: PERSONAL_REF }), makeItem({ pantry: groupRef(FLAT) })]) {
      const ref = itemRefOf(item);
      expect(parseItemRef(itemRefParam(ref))).toEqual(ref);
      expect(itemHref(item)).toBe(`/pantry/${itemRefParam(ref)}`);
    }
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "",
      "itm_abc",
      "new",
      "me:org_abc",
      "me:itm_",
      "me:itm_abc:extra",
      "org:org_abc",
      "org:usr_abc:itm_def",
      "org:org_abc:mov_def",
      "you:itm_abc",
      "me:itm_ab-c",
      "%E0%A4%A",
    ]) {
      expect(parseItemRef(bad)).toBeNull();
    }
  });
});

describe("?pantry= and ?filter=", () => {
  it("reads all, personal or a group's org id; anything else is all", () => {
    expect(parsePantryParam("personal")).toBe(PERSONAL_PANTRY);
    expect(parsePantryParam(FLAT.orgId)).toBe(FLAT.orgId);
    expect(parsePantryParam("all")).toBe(ALL_PANTRIES);
    expect(parsePantryParam(null)).toBe(ALL_PANTRIES);
    expect(parsePantryParam("flat-4b")).toBe(ALL_PANTRIES);
    expect(parseFilterParam("soon")).toBe("soon");
    expect(parseFilterParam("expired")).toBe("expired");
    expect(parseFilterParam("later")).toBe("all");
  });
});

describe("the pantry picker", () => {
  const pantries = [
    personalPantry({ itemCount: 5, useSoonCount: 1, expiredCount: 1, worthMinor: 57040 }),
    groupPantry(FLAT, { itemCount: 6, useSoonCount: 2, worthMinor: 71805 }),
    groupPantry(LUNCH, { itemCount: 2, worthMinor: 30000, wastePolicy: "buyer_absorbs" }),
    groupPantry(TRIP),
  ];

  it("lists All pantries, Personal, then groups — the ones opened last first — each with its stock", () => {
    const list = pantryPickerList(pantries, { includeAll: true, recentSlugs: [LUNCH.slug] });
    expect(list.options.map((o) => o.label)).toEqual(["All pantries", "Personal", "Lunch club", "Flat 4B", "Goa trip"]);
    expect(list.options[0]!.meta).toBe("4 pantries · 13 items · 3 use soon · 1 expired");
    expect(list.options[1]!.meta).toBe("5 items · 1 use soon · 1 expired");
    expect(list.options[1]!.badge).toBe("Me");
    expect(list.options.find((o) => o.label === "Goa trip")!.meta).toBe("0 items");
    expect(list.heading).toBeNull();
  });

  it("shows five groups until a search finds the rest", () => {
    const many = [personalPantry(), ...Array.from({ length: 7 }, (_, i) => groupPantry({ orgId: `org_${i}`, slug: `g-${i}`, name: `Group ${i}` }))];
    const list = pantryPickerList(many, { includeAll: true });
    expect(list.options.filter((o) => o.kind === "group")).toHaveLength(5);
    expect(list.moreGroups).toBe(2);
    expect(list.heading).toBe("Recent · search to see all 7");
    const found = pantryPickerList(many, { includeAll: true, query: "group 6" });
    expect(found.options.map((o) => o.label)).toEqual(["Group 6"]);
    expect(found.heading).toBe("Matches");
  });

  it("matches every word in any order, and All pantries by its name", () => {
    expect(pantryPickerList(pantries, { query: "4b flat" }).options.map((o) => o.label)).toEqual(["Flat 4B"]);
    expect(pantryPickerList(pantries, { includeAll: true, query: "all" }).options.map((o) => o.label)).toEqual(["All pantries"]);
    expect(pantryPickerList(pantries, { query: "zzz" }).options).toEqual([]);
  });

  it("describes who a pantry is for on the add form", () => {
    const counts = new Map([[FLAT.orgId, 4]]);
    const list = pantryPickerList(pantries, { meta: "who", memberCounts: counts });
    expect(list.options.map((o) => [o.label, o.meta])).toEqual([
      ["Personal", "Only you"],
      ["Flat 4B", "4 people · waste split equally"],
      ["Goa trip", "waste split equally"],
      ["Lunch club", "buyer absorbs waste"],
    ]);
  });

  it("names the current choice even when it is not among the recent ones, and falls back to All", () => {
    expect(pantryChoice(pantries, TRIP.orgId).label).toBe("Goa trip");
    expect(pantryChoice(pantries, "org_gone").label).toBe("All pantries");
    expect(pantryChoice(pantries, PERSONAL_PANTRY).label).toBe("Personal");
  });
});

describe("the summary and filters", () => {
  const pantries = [
    personalPantry({ itemCount: 2, useSoonCount: 1, worthMinor: 28200 }),
    groupPantry(FLAT, { itemCount: 3, useSoonCount: 1, expiredCount: 1, worthMinor: 8400 }),
    groupPantry(TRIP, { itemCount: 1, worthMinor: 1200, currency: "USD" }),
  ];

  it("counts every pantry's items and adds worth per currency, never across", () => {
    const s = pantrySummary(pantries, ALL_PANTRIES);
    expect(s.headline).toBe(`6 items · worth ${formatMinor(36600, "INR")} and ${formatMinor(1200, "USD")}`);
    expect(s.useSoonCount).toBe(2);
    expect(s.expiredCount).toBe(1);
    expect(s.subline).toMatch(/what's left of what was paid/);
  });

  it("says whose a chosen pantry is", () => {
    expect(pantrySummary(pantries, PERSONAL_PANTRY).subline).toBe("Only you can see these. Cook with them for any group.");
    expect(pantrySummary(pantries, FLAT.orgId, new Map([[FLAT.orgId, 4]])).subline).toBe(
      "Everyone in Flat 4B sees these · 4 people · waste split equally",
    );
    expect(pantrySummary(pantries, FLAT.orgId).headline).toBe(`3 items · worth ${formatMinor(8400)}`);
  });

  it("offers Expired only when something has expired", () => {
    expect(filterChips({ useSoonCount: 2, expiredCount: 0 }).map((c) => c.label)).toEqual(["All items", "Use soon · 2"]);
    expect(filterChips({ useSoonCount: 2, expiredCount: 1 }).map((c) => c.label)).toEqual(["All items", "Use soon · 2", "Expired · 1"]);
  });

  it("states stock in words, leaving out the zeros", () => {
    expect(stockMeta({ itemCount: 1, useSoonCount: 0, expiredCount: 0 })).toBe("1 item");
    expect(stockMeta({ itemCount: 4, useSoonCount: 2, expiredCount: 1 })).toBe("4 items · 2 use soon · 1 expired");
    expect(worthText([])).toBe(formatMinor(0));
  });
});

describe("sections per pantry", () => {
  const butter = makeItem({ name: "Butter", pantry: PERSONAL_REF, unit: "g", bought: "500", left: "450", priceMinor: 28000, paidBy: ME });
  const cream = makeItem({ name: "Fresh cream", pantry: PERSONAL_REF, unit: "ml", bought: "200", left: "100", priceMinor: 6000, paidBy: ME, daysToUseBy: 2 });
  const milk = makeItem({ name: "Milk", pantry: groupRef(FLAT), unit: "L", bought: "1", priceMinor: 6800, daysToUseBy: 1 });
  const rice = makeItem({ name: "Rice", pantry: groupRef(FLAT), unit: "kg", bought: "5", left: "3.2", priceMinor: 62000 });
  const yogurt = makeItem({ name: "Yogurt", pantry: groupRef(FLAT), unit: "g", bought: "400", priceMinor: 12000, daysToUseBy: -1 });
  const flour = makeItem({ name: "Chapati flour", pantry: groupRef(LUNCH), unit: "kg", bought: "5", left: "2.5", priceMinor: 24000 });
  const items = [yogurt, milk, cream, flour, rice, butter];
  const pantries = [
    personalPantry({ itemCount: 2, useSoonCount: 1, worthMinor: 28200 }),
    groupPantry(FLAT, { itemCount: 3, useSoonCount: 1, expiredCount: 1, worthMinor: 58480 }),
    groupPantry(LUNCH, { itemCount: 1, worthMinor: 12000, wastePolicy: "buyer_absorbs" }),
    groupPantry(TRIP),
  ];

  it("groups the items by pantry — Personal, then groups recent first — in the order they came (soonest first)", () => {
    const { sections, emptyHidden } = pantrySections(pantries, items, { selected: ALL_PANTRIES, recentSlugs: [LUNCH.slug] });
    expect(sections.map((s) => s.label)).toEqual(["Personal", "Lunch club", "Flat 4B"]);
    expect(sections[0]!.items.map((i) => i.name)).toEqual(["Fresh cream", "Butter"]);
    expect(sections[2]!.items.map((i) => i.name)).toEqual(["Yogurt", "Milk", "Rice"]);
    expect(emptyHidden).toEqual(["Goa trip"]);
  });

  it("heads each section with its count, worth, what to use, its people and its rule", () => {
    const { sections } = pantrySections(pantries, items, { selected: ALL_PANTRIES, memberCounts: new Map([[FLAT.orgId, 4]]) });
    expect(sections.find((s) => s.label === "Flat 4B")!.meta).toBe(
      `3 items · ${formatMinor(58480)} · 1 use soon · 1 expired · 4 people · waste split equally`,
    );
    expect(sections.find((s) => s.label === "Personal")!.meta).toBe(`2 items · ${formatMinor(28200)} · 1 use soon · only you`);
    expect(sections.find((s) => s.label === "Lunch club")!.meta).toBe(`1 item · ${formatMinor(12000)} · buyer absorbs waste`);
  });

  it("filters to what to use soon, or what has expired, dropping sections left empty", () => {
    const soon = pantrySections(pantries, items, { selected: ALL_PANTRIES, filter: "soon" });
    expect(soon.sections.map((s) => [s.label, s.items.map((i) => i.name)])).toEqual([
      ["Personal", ["Fresh cream"]],
      ["Flat 4B", ["Milk"]],
    ]);
    expect(soon.emptyHidden).toEqual([]);
    const expired = pantrySections(pantries, items, { selected: ALL_PANTRIES, filter: "expired" });
    expect(expired.sections.map((s) => [s.label, s.items.map((i) => i.name)])).toEqual([["Flat 4B", ["Yogurt"]]]);
  });

  it("always shows one chosen pantry, even empty", () => {
    const { sections } = pantrySections(pantries, [], { selected: TRIP.orgId });
    expect(sections.map((s) => [s.label, s.items.length, s.startsOpen])).toEqual([["Goa trip", 0, true]]);
  });

  it("opens the first three sections, and any further one with something to use", () => {
    const groups = Array.from({ length: 5 }, (_, i) => ({ orgId: `org_g${i}`, slug: `g-${i}`, name: `G${i}` }));
    const ps = [personalPantry(), ...groups.map((g, i) => groupPantry(g, { itemCount: 1, useSoonCount: i === 4 ? 1 : 0 }))];
    const its = groups.map((g, i) => makeItem({ pantry: groupRef(g), daysToUseBy: i === 4 ? 1 : null }));
    const { sections } = pantrySections(ps, its, { selected: ALL_PANTRIES });
    expect(sections.map((s) => [s.label, s.startsOpen])).toEqual([
      ["G0", true],
      ["G1", true],
      ["G2", true],
      ["G3", false],
      ["G4", true],
    ]);
  });

  it("gives the desktop table every matching item in scope, by name search too", () => {
    expect(pantryRows(items, { selected: ALL_PANTRIES, query: "CREAM" }).map((i) => i.name)).toEqual(["Fresh cream"]);
    expect(pantryRows(items, { selected: FLAT.orgId, filter: "soon" }).map((i) => i.name)).toEqual(["Milk"]);
    expect(pantryRows(items, { selected: PERSONAL_PANTRY }).map((i) => i.name)).toEqual(["Fresh cream", "Butter"]);
    expect(pantryRows(items, { selected: ALL_PANTRIES, query: "flour chapati" }).map((i) => i.name)).toEqual(["Chapati flour"]);
  });
});

describe("an item row", () => {
  it("says how much is left of what was bought and who paid — by name, never an id", () => {
    const row = itemRowView(makeItem({ unit: "kg", bought: "1", left: "0.6", priceMinor: 4000, paidBy: ANU, daysToUseBy: 3 }), {
      meId: ME,
      names: NAMES,
    });
    expect(row.leftOfBought).toBe("600 g of 1 kg");
    expect(row.sub).toBe("600 g of 1 kg · Anu paid");
    expect(row.paidBy).toBe("Anu");
    expect(row.unitPrice).toBe(`${formatMinor(pricePerUnit(4000, 1_000_000, "kg"))}/kg`);
    expect(row.worth).toBe(formatMinor(2400));
    expect(row.percent).toBe(60);
    expect(row.bar).toBe("soon");
    expect(row.chip).toEqual({ label: "3 days", tone: "soon" });
    expect(row.useHref).toBe(`${row.href}#use`);
    expect(row.canUse).toBe(true);
  });

  it("says 'you paid' for your own purchase, and labels someone unnamed by their tag", () => {
    expect(itemRowView(makeItem({ paidBy: ME }), { meId: ME, names: NAMES }).sub).toMatch(/· you paid$/);
    const stranger = itemRowView(makeItem({ paidBy: "usr_00000000000000000000000000009e9e" }), { meId: ME, names: NAMES });
    expect(stranger.sub).toMatch(/· Member · 9e9e paid$/);
    for (const value of Object.values(stranger)) if (typeof value === "string") expect(value).not.toMatch(/usr_/);
  });

  it("prices grams per kg and millilitres per L, by the engine, and counts per piece", () => {
    const butter = makeItem({ unit: "g", bought: "500", left: "450", priceMinor: 28000 });
    expect(itemRowView(butter, { meId: ME }).unitPrice).toBe(`${formatMinor(pricePerUnit(28000, 500_000, "kg"))}/kg`);
    expect(itemRowView(butter, { meId: ME }).unitPrice).toBe("₹560.00/kg");
    expect(itemRowView(makeItem({ unit: "ml", bought: "200", priceMinor: 6000 }), { meId: ME }).unitPrice).toBe("₹300.00/L");
    expect(itemRowView(makeItem({ unit: "tbsp", bought: "10", priceMinor: 1500 }), { meId: ME }).unitPrice).toBe("₹100.00/L");
    expect(itemRowView(makeItem({ unit: "pcs", bought: "12", priceMinor: 8400 }), { meId: ME }).unitPrice).toBe("₹7.00/pc");
    expect(itemRowView(makeItem({ unit: "pack", bought: "6", priceMinor: 18000 }), { meId: ME }).unitPrice).toBe("₹30.00/pack");
    expect(itemRowView(makeItem({ unit: "dozen", bought: "2", priceMinor: 16800 }), { meId: ME }).unitPrice).toBe("₹84.00/dozen");
  });

  it("shows the category instead of a payer in your own pantry", () => {
    const row = itemRowView(makeItem({ pantry: PERSONAL_REF, unit: "g", bought: "500", left: "450", category: "dairy", paidBy: ME }), { meId: ME });
    expect(row.sub).toBe("450 g of 500 g · Dairy");
    expect(row.pantryLabel).toBe("Personal");
  });

  it("strikes an expired item through, greys its bar, and offers Use only to those who may use it", () => {
    const expired = itemRowView(makeItem({ daysToUseBy: -2, expiresOn: "2026-10-31" }), { meId: ME });
    expect(expired.struck).toBe(true);
    expect(expired.bar).toBe("expired");
    expect(expired.chip).toEqual({ label: "Expired", tone: "expired" });
    expect(itemRowView(makeItem({ canUse: false }), { meId: ME }).canUse).toBe(false);
    expect(itemRowView(makeItem({ left: "0" }), { meId: ME }).canUse).toBe(false);
  });

  it("reads 7 of 12 pcs for things you count, and keeps the unit on weights and volumes", () => {
    expect(leftOfBought(makeItem({ unit: "pcs", bought: "12", left: "7" }))).toBe("7 of 12 pcs");
    expect(leftOfBought(makeItem({ unit: "pcs", bought: "12", left: "1" }))).toBe("1 of 12 pcs");
    expect(leftOfBought(makeItem({ unit: "pack", bought: "6", left: "3" }))).toBe("3 of 6 packs");
    expect(leftOfBought(makeItem({ unit: "dozen", bought: "1", left: "0.5" }))).toBe("6 of 12 pcs");
    expect(leftOfBought(makeItem({ unit: "kg", bought: "2", left: "1.6" }))).toBe("1.6 kg of 2 kg");
    expect(leftOfBought(makeItem({ unit: "L", bought: "1", left: "0.4" }))).toBe("400 ml of 1 L");
    expect(leftOfBought(makeItem({ unit: "g", bought: "500", left: "450" }))).toBe("450 g of 500 g");
  });
});

describe("use-by chips", () => {
  const chip = (d: number | null, expiresOn = "2026-11-04") => expiryChip({ daysToUseBy: d, expiresOn: d === null ? null : expiresOn });

  it("is red when expired, amber up to three days, grey after, a date beyond a month", () => {
    expect(chip(-1)).toEqual({ label: "Expired", tone: "expired" });
    expect(chip(0)).toEqual({ label: "Today", tone: "soon" });
    expect(chip(1)).toEqual({ label: "Tomorrow", tone: "soon" });
    expect(chip(3)).toEqual({ label: "3 days", tone: "soon" });
    expect(chip(4)).toEqual({ label: "4 days", tone: "later" });
    expect(chip(45, "2026-12-17")).toEqual({ label: "17 Dec", tone: "later" });
    expect(chip(null)).toBeNull();
  });

  it("spells it out on the item page", () => {
    expect(expiryText({ daysToUseBy: 3, expiresOn: "2026-11-04" })).toBe("Use by 4 Nov · 3 days");
    expect(expiryText({ daysToUseBy: -1, expiresOn: "2026-11-01" })).toBe("Expired 1 Nov");
    expect(expiryText({ daysToUseBy: 45, expiresOn: "2026-12-17" })).toBe("Use by 17 Dec");
    expect(expiryText({ daysToUseBy: null, expiresOn: null })).toBeNull();
  });
});

describe("Home's use-soon strip", () => {
  it("shows the soonest to use first, then what has expired, four at most, each once", () => {
    const a = makeItem({ name: "Curd", daysToUseBy: 1 });
    const b = makeItem({ name: "Cream", daysToUseBy: 0 });
    const c = makeItem({ name: "Tomatoes", daysToUseBy: 3 });
    const x = makeItem({ name: "Yogurt", daysToUseBy: -1 });
    const y = makeItem({ name: "Paneer", daysToUseBy: -4 });
    expect(soonStrip([a, b, c], [x, y]).map((i) => i.name)).toEqual(["Cream", "Curd", "Tomatoes", "Yogurt"]);
    expect(soonStrip([a], [a, x]).map((i) => i.name)).toEqual(["Curd", "Yogurt"]);
    expect(soonStrip([], [])).toEqual([]);
  });
});

describe("names in a sentence", () => {
  it("joins up to three, then counts the rest", () => {
    expect(joinNames(["you"])).toBe("you");
    expect(joinNames(["you", "Dev"])).toBe("you and Dev");
    expect(joinNames(["you", "Anu", "Dev"])).toBe("you, Anu and Dev");
    expect(joinNames(["you", "Anu", "Dev", "Meera"])).toBe("you, Anu and 2 others");
    expect(joinNames([DEV].map(() => "Dev"))).toBe("Dev");
  });
});
