import { formatMinor } from "@saas/kitchen-engine/money";
import { pricePerUnit, toMilli } from "@saas/kitchen-engine/units";
import {
  FILLED_FROM_BEFORE,
  ITEM_CATEGORIES,
  ITEM_FIELDS,
  MAIN_UNITS,
  MORE_UNITS,
  USE_BY_CHOICES,
  addMainLabel,
  boughtSections,
  chipWindow,
  firstItemError,
  initialItemForm,
  localIsoDay,
  normalizeQuantity,
  parseQuantity,
  perUnitLine,
  previewItemForm,
  useByChoice,
  useByFor,
  wasteOptions,
  wastePick,
  wasteShown,
  type ItemForm,
} from "@web-console-next/components/kitchen/item-form";
import { ANU, DEV, FLAT, KIRAN, ME, MEERA, NAMES } from "./kitchen-pantry-fixtures";

const TODAY = "2026-11-02";

function form(patch: Partial<ItemForm> = {}): ItemForm {
  return {
    ...initialItemForm({ today: TODAY, meId: ME }),
    name: "Tomatoes",
    category: "veg",
    quantity: "1",
    unit: "kg",
    price: "40",
    ...patch,
  };
}

describe("the add-item form's choices", () => {
  it("offers the seven categories, the everyday units and the cooking measures behind more", () => {
    expect(ITEM_CATEGORIES.map((c) => c.label)).toEqual(["Veg", "Fruit", "Dairy", "Grains", "Protein", "Spices", "Other"]);
    expect(MAIN_UNITS).toEqual(["pcs", "g", "kg", "ml", "L", "dozen", "pack"]);
    expect(MORE_UNITS).toEqual(["tsp", "tbsp", "cup"]);
  });

  it("starts in your own pantry, bought today, paid by you, following the group's waste rule", () => {
    const f = initialItemForm({ today: TODAY, meId: ME });
    expect(f).toMatchObject({ pantry: "personal", boughtOn: TODAY, expiresOn: "", paidBy: ME, waste: "group", category: "" });
    expect(initialItemForm({ today: TODAY, meId: ME, pantry: FLAT.orgId }).pantry).toBe(FLAT.orgId);
  });

  it("knows today's date where the person is", () => {
    expect(localIsoDay(new Date(2026, 10, 2, 23, 30))).toBe("2026-11-02");
    expect(localIsoDay(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });
});

describe("the request for your own pantry", () => {
  it("sends the name, category, quantity in its unit, the price in paise and the pantry's currency", () => {
    const p = previewItemForm(form({ name: "  Basmati   rice ", quantity: "1.5", unit: "kg", price: "₹ 1,249.50" }), {
      today: TODAY,
      currency: "INR",
      meId: ME,
    });
    expect(p.errors).toEqual({});
    expect(p.request).toEqual({
      kind: "personal",
      body: {
        name: "Basmati rice",
        category: "veg",
        quantity: "1.5",
        unit: "kg",
        priceMinor: 124950,
        boughtOn: TODAY,
        currency: "INR",
      },
    });
  });

  it("turns the quantity into thousandths with the engine, exactly as the server will", () => {
    for (const [quantity, unit] of [
      ["1.5", "kg"],
      ["250", "g"],
      ["0.75", "L"],
      ["2", "dozen"],
      ["3", "tbsp"],
      ["1", "cup"],
      ["0.333", "kg"],
    ] as const) {
      const p = previewItemForm(form({ quantity, unit }), { today: TODAY, meId: ME });
      expect(p.qtyMilli).toBe(toMilli(quantity, unit));
      expect(p.request && "body" in p.request ? toMilli(p.request.body.quantity, p.request.body.unit) : null).toBe(p.qtyMilli);
    }
  });

  it("reads a quantity like a person types it, and says what is wrong", () => {
    expect(normalizeQuantity(".5")).toBe("0.5");
    expect(normalizeQuantity("2.")).toBe("2");
    expect(normalizeQuantity(" 3 ")).toBe("3");
    expect(normalizeQuantity("1,5")).toBeNull();
    expect(parseQuantity("", "kg")).toEqual({ ok: false, message: "Enter how much you bought" });
    expect(parseQuantity("0", "kg")).toEqual({ ok: false, message: "Enter more than zero" });
    expect(parseQuantity("1,5", "kg")).toEqual({ ok: false, message: "Enter a number like 1 or 1.5" });
    expect(parseQuantity("-1", "kg")).toEqual({ ok: false, message: "Enter a number like 1 or 1.5" });
    expect(parseQuantity(".5", "kg")).toEqual({ ok: true, text: "0.5", milli: 500_000 });
  });

  it("parses the price by its digits", () => {
    const price = (input: string) => previewItemForm(form({ price: input }), { today: TODAY, meId: ME });
    expect(price("249.5").priceMinor).toBe(24950);
    expect(price("0.1").priceMinor).toBe(10);
    expect(price("0").priceMinor).toBe(0);
    expect(price("0").errors.price).toBeUndefined();
    expect(price("").errors.price).toBe("Enter what you paid");
    expect(price("12.345").errors.price).toBe("Use at most two decimal places");
    expect(price("abc").errors.price).toBe("Enter an amount like 250 or 249.50");
  });

  it("sends a use-by date only when there is one", () => {
    const p = previewItemForm(form({ expiresOn: "2026-11-05" }), { today: TODAY, meId: ME });
    expect(p.request?.body.expiresOn).toBe("2026-11-05");
    expect(previewItemForm(form(), { today: TODAY, meId: ME }).request?.body).not.toHaveProperty("expiresOn");
  });
});

describe("validation, inline", () => {
  it("asks for a name and a category", () => {
    const p = previewItemForm(form({ name: "  ", category: "" }), { today: TODAY, meId: ME });
    expect(p.errors).toMatchObject({ name: "Say what you bought", category: "Pick a category" });
    expect(p.request).toBeNull();
    expect(firstItemError(p.errors)).toBe("name");
  });

  it("keeps the name within the server's limit", () => {
    expect(previewItemForm(form({ name: "x".repeat(121) }), { today: TODAY, meId: ME }).errors.name).toBe("Keep it under 120 characters");
  });

  it("refuses a purchase in the future, and a use-by before the purchase", () => {
    expect(previewItemForm(form({ boughtOn: "2026-11-03" }), { today: TODAY, meId: ME }).errors.boughtOn).toBe("That's in the future");
    expect(previewItemForm(form({ boughtOn: "2026-02-30" }), { today: TODAY, meId: ME }).errors.boughtOn).toBe("Pick the day you bought it");
    expect(previewItemForm(form({ expiresOn: "2026-11-01" }), { today: TODAY, meId: ME }).errors.expiresOn).toBe(
      "Use-by can't be before the day you bought it",
    );
    expect(previewItemForm(form({ expiresOn: "2026-11-02" }), { today: TODAY, meId: ME }).errors.expiresOn).toBeUndefined();
  });

  it("points at the first problem in the form's order", () => {
    const p = previewItemForm(form({ quantity: "", price: "" }), { today: TODAY, meId: ME });
    expect(firstItemError(p.errors)).toBe("quantity");
  });
});

describe("the live price per unit", () => {
  it("prices weights per kg and per 100 g, volumes per L and per 100 ml, by the engine", () => {
    const qty = toMilli("500", "g");
    expect(perUnitLine(2800, qty, "g")).toBe(
      `${formatMinor(pricePerUnit(2800, qty, "kg"))} per kg · ${formatMinor(pricePerUnit(280000, qty, "g"))} per 100 g`,
    );
    expect(perUnitLine(2800, qty, "g")).toBe("₹56.00 per kg · ₹5.60 per 100 g");
    expect(perUnitLine(6800, toMilli("1", "L"), "L")).toBe("₹68.00 per L · ₹6.80 per 100 ml");
  });

  it("prices counts per piece (and per dozen) and packs per pack", () => {
    expect(perUnitLine(8400, toMilli("1", "dozen"), "dozen")).toBe("₹84.00 per dozen · ₹7.00 per piece");
    expect(perUnitLine(8400, toMilli("12", "pcs"), "pcs")).toBe("₹7.00 per piece");
    expect(perUnitLine(18000, toMilli("6", "pack"), "pack")).toBe("₹30.00 per pack");
    expect(perUnitLine(1200, toMilli("1", "kg"), "kg", "USD")).toBe("$12.00 per kg · $1.20 per 100 g");
  });

  it("shows on the form once quantity and price read", () => {
    expect(previewItemForm(form(), { today: TODAY, meId: ME }).perUnit).toBe("₹40.00 per kg · ₹4.00 per 100 g");
    expect(previewItemForm(form({ price: "" }), { today: TODAY, meId: ME }).perUnit).toBeNull();
  });
});

describe("the request for a group's pantry", () => {
  it("names the group and who paid, sends no currency (the group's applies), and follows the group's rule", () => {
    const p = previewItemForm(form({ pantry: FLAT.orgId, paidBy: ANU }), { today: TODAY, currency: "INR", meId: ME });
    expect(p.request).toEqual({
      kind: "group",
      orgId: FLAT.orgId,
      body: { name: "Tomatoes", category: "veg", quantity: "1", unit: "kg", priceMinor: 4000, boughtOn: TODAY, paidBy: ANU },
    });
  });

  it("sends the item's own waste rule only when it overrides the group's", () => {
    const own = previewItemForm(form({ pantry: FLAT.orgId, waste: "buyer_absorbs" }), { today: TODAY, meId: ME });
    expect(own.request?.kind === "group" ? own.request.body.wastePolicy : null).toBe("buyer_absorbs");
    const split = previewItemForm(form({ pantry: FLAT.orgId, waste: "split_equally" }), { today: TODAY, meId: ME });
    expect(split.request?.kind === "group" ? split.request.body.wastePolicy : null).toBe("split_equally");
  });

  it("keeps who paid and the waste rule out of your own pantry's request", () => {
    const p = previewItemForm(form({ paidBy: ANU, waste: "buyer_absorbs" }), { today: TODAY, meId: ME });
    expect(p.request?.body).not.toHaveProperty("paidBy");
    expect(p.request?.body).not.toHaveProperty("wastePolicy");
  });

  it("needs someone to have paid", () => {
    expect(previewItemForm(form({ pantry: FLAT.orgId, paidBy: null }), { today: TODAY, meId: ME }).errors.paidBy).toBe("Pick who paid");
  });
});

describe("Who paid?", () => {
  const roster = [MEERA, ANU, ME, DEV, KIRAN, "usr_00000000000000000000000000000f0f", "usr_00000000000000000000000000000e0e"];

  it("shows five people, you first, then 'N more'", () => {
    const w = chipWindow(roster, { meId: ME, names: NAMES, max: 5 });
    expect(w.shown[0]).toBe(ME);
    expect(w.shown).toHaveLength(5);
    expect(w.more).toBe(2);
  });

  it("keeps the chosen payer visible even past the first five", () => {
    const hidden = chipWindow(roster, { meId: ME, names: NAMES, max: 5 }).shown;
    const beyond = roster.find((id) => !hidden.includes(id))!;
    const w = chipWindow(roster, { meId: ME, names: NAMES, chosen: [beyond], max: 5 });
    expect(w.shown).toContain(beyond);
    expect(w.more).toBe(1);
    expect(chipWindow(roster, { meId: ME, names: NAMES, expanded: true, max: 5 }).shown).toHaveLength(7);
  });
});

describe("Bought, in order (SM-15)", () => {
  it("asks where it goes first — it changes the form — and a group's two questions after the category", () => {
    expect(boughtSections(false)).toEqual(["pantry", "name", "amount", "category", "useBy"]);
    expect(boughtSections(true)).toEqual(["pantry", "name", "amount", "category", "paidBy", "waste", "useBy"]);
    expect(boughtSections(true)[0]).toBe("pantry");
  });

  it("focuses the first problem in the order the form shows it", () => {
    expect(ITEM_FIELDS).toEqual(["name", "quantity", "price", "category", "paidBy", "expiresOn", "boughtOn", "note"]);
    const p = previewItemForm(form({ category: "", expiresOn: "2026-11-01" }), { today: TODAY, meId: ME });
    expect(firstItemError(p.errors)).toBe("category");
  });
});

describe("If it goes to waste: two choices, not three (SM-15)", () => {
  it("offers split equally or the payer absorbs it — no \"Use the group rule\", which was one of the two again", () => {
    expect(wasteOptions({ paidBy: ANU, meId: ME, names: NAMES })).toEqual([
      { id: "split_equally", label: "Split equally" },
      { id: "buyer_absorbs", label: "Anu absorbs it" },
    ]);
    expect(wasteOptions({ paidBy: ME, meId: ME, names: NAMES })[1]!.label).toBe("I absorb it");
    expect(wasteOptions({ paidBy: null, meId: ME })[1]!.label).toBe("The buyer absorbs it");
  });

  it("starts on the group's own rule", () => {
    expect(wasteShown("group", "split_equally")).toBe("split_equally");
    expect(wasteShown("group", "buyer_absorbs")).toBe("buyer_absorbs");
    expect(wasteShown("buyer_absorbs", "split_equally")).toBe("buyer_absorbs");
  });

  it("follows the group when its rule is picked, and sends the other only as the item's own", () => {
    expect(wastePick("split_equally", "split_equally")).toBe("group");
    expect(wastePick("buyer_absorbs", "split_equally")).toBe("buyer_absorbs");
    const follows = previewItemForm(form({ pantry: FLAT.orgId, waste: wastePick("split_equally", "split_equally") }), { today: TODAY, meId: ME });
    expect(follows.request?.body).not.toHaveProperty("wastePolicy");
    const own = previewItemForm(form({ pantry: FLAT.orgId, waste: wastePick("buyer_absorbs", "split_equally") }), { today: TODAY, meId: ME });
    expect(own.request?.kind === "group" ? own.request.body.wastePolicy : null).toBe("buyer_absorbs");
  });
});

describe("Use by: quick picks (SM-15, the canvas)", () => {
  it("offers 3 days · 5 days · 2 wks · None · a date", () => {
    expect(USE_BY_CHOICES.map((c) => c.label)).toEqual(["3 days", "5 days", "2 wks", "None", "Date"]);
  });

  it("counts a pick from the day it was bought, and reads a use-by back as its pick", () => {
    const f = form({ boughtOn: "2026-10-30" });
    expect(useByFor("3d", f)).toBe("2026-11-02");
    expect(useByFor("14d", f)).toBe("2026-11-13");
    expect(useByFor("none", f)).toBe("");
    expect(useByFor("date", { ...f, expiresOn: "2026-12-01" })).toBe("2026-12-01");
    expect(useByChoice({ boughtOn: "2026-10-30", expiresOn: "" })).toBe("none");
    expect(useByChoice({ boughtOn: "2026-10-30", expiresOn: "2026-11-04" })).toBe("5d");
    expect(useByChoice({ boughtOn: "2026-10-30", expiresOn: "2026-11-05" })).toBe("date");
  });
});

describe("the one main button, named (SM-15)", () => {
  it("names what it adds and what it cost, and where it goes", () => {
    expect(addMainLabel({ name: " Milk ", priceMinor: 6800, currency: "INR", pantryName: "Flat 4B" })).toEqual({
      title: "Add Milk · ₹68.00",
      who: "to Flat 4B",
    });
    expect(addMainLabel({ name: "Eggs", priceMinor: null, currency: "INR", pantryName: null })).toEqual({ title: "Add Eggs", who: "to your pantry" });
    expect(addMainLabel({ name: "", priceMinor: null, currency: "INR", pantryName: null }).title).toBe("Add");
    expect(addMainLabel({ name: "x".repeat(40), priceMinor: 100, currency: "USD", pantryName: null }).title).toBe(`Add ${"x".repeat(27)}… · $1.00`);
  });

  it("says once that the form was filled from last time", () => {
    expect(FILLED_FROM_BEFORE).toBe("Filled from last time · change anything");
  });
});
