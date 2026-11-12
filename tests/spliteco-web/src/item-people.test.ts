import { addEveryone, peopleLine, peopleOn, pickable, sameAsLast, sharesToShow } from "@/lib/item-people";
import type { ItemForm } from "@/lib/split-form";

const GROUP = ["usr_a", "usr_b", "usr_c", "usr_d"];
const NAMES: Record<string, string> = { usr_a: "You", usr_b: "Anu", usr_c: "Dev", usr_d: "Meera" };
const nameOf = (id: string) => NAMES[id]!;
const item = (shares: ItemForm["shares"] = {}, key = "i"): ItemForm => ({ key, name: "Naan", qtyText: "1", unitText: "", totalText: "90", shares });

describe("who is on an item", () => {
  it("lists only the people on it, in the group's order", () => {
    expect(peopleOn(item({ usr_d: { mode: "portion", value: 1000 }, usr_b: { mode: "pct", value: 5000 } }), GROUP)).toEqual(["usr_b", "usr_d"]);
  });

  it("searches the rest of the group by name", () => {
    const it = item({ usr_b: { mode: "portion", value: 1000 } });
    expect(pickable(it, GROUP, nameOf, "")).toEqual(["usr_a", "usr_c", "usr_d"]);
    expect(pickable(it, GROUP, nameOf, "  ME ")).toEqual(["usr_d"]);
    expect(pickable(it, GROUP, nameOf, "an")).toEqual([]); // Anu is already on it
  });

  it("Everyone adds the rest at one portion and keeps existing shares", () => {
    const it = addEveryone(item({ usr_b: { mode: "pct", value: 5000 } }), GROUP);
    expect(it.shares).toEqual({
      usr_b: { mode: "pct", value: 5000 },
      usr_a: { mode: "portion", value: 1000 },
      usr_c: { mode: "portion", value: 1000 },
      usr_d: { mode: "portion", value: 1000 },
    });
  });

  it("Same as last item copies the previous item's people and shares", () => {
    const items = [item({ usr_a: { mode: "exact", value: 2000 }, usr_c: { mode: "portion", value: 500 } }, "x"), item({ usr_d: { mode: "portion", value: 1000 } }, "y")];
    const copied = sameAsLast(items, 1, GROUP)!;
    expect(copied.key).toBe("y");
    expect(copied.shares).toEqual({ usr_a: { mode: "exact", value: 2000 }, usr_c: { mode: "portion", value: 500 } });
    copied.shares["usr_a"]!.value = 1; // a copy, not the same objects
    expect(items[0]!.shares["usr_a"]!.value).toBe(2000);
    expect(sameAsLast(items, 0, GROUP)).toBeNull();
  });

  it("says how many are on it", () => {
    expect(peopleLine(0, 12)).toBe("No one yet — tap Add");
    expect(peopleLine(3, 12)).toBe("3 of 12 people in the group");
    expect(peopleLine(1, 1)).toBe("1 of 1 person in the group");
  });

  it("lists only shares above ₹0", () => {
    const lines = [
      { subjectId: "usr_a", itemsMinor: 100, adjustmentsMinor: 5, owedMinor: 105 },
      { subjectId: "usr_b", itemsMinor: 0, adjustmentsMinor: 0, owedMinor: 0 },
    ];
    expect(sharesToShow(lines).map((l) => l.subjectId)).toEqual(["usr_a"]);
  });
});
