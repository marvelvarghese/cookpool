import type {
  CreateGroupItemRequest,
  CreatePersonalItemRequest,
  KitchenItem,
  ReachableItem,
  UpdateGroupItemRequest,
  UpdatePersonalItemRequest,
} from "@saas/contracts/kitchen";
import { ITEM_NOTE_MAX, itemNoteLength, normalizeItemNote } from "@saas/contracts/kitchen";

// Item notes (Cookpool RC-3): one line about an item, "For Sunday's curry".
// The add and the edit take it, every item read carries it, and the server
// and the app agree on what is stored (trimmed, never blank) and how long it
// may be (80 characters, counted as the database counts them).

describe("contracts: item notes (Cookpool RC-3)", () => {
  it("allows 80 characters", () => {
    expect(ITEM_NOTE_MAX).toBe(80);
  });

  it("types the note on the adds, the edits and the item", () => {
    const personal: CreatePersonalItemRequest = {
      name: "Paneer", category: "dairy", quantity: "200", unit: "g", priceMinor: 9000, note: "For Sunday's curry",
    };
    const shared: CreateGroupItemRequest = { ...personal, paidBy: "usr_anu", note: null };
    const edit: UpdatePersonalItemRequest = { note: "Half for Anu", version: 2 };
    const clear: UpdateGroupItemRequest = { note: null };
    const item: Pick<KitchenItem, "note"> = { note: "For Sunday's curry" };
    const none: Pick<ReachableItem, "note" | "canUse"> = { note: null, canUse: true };
    expect([personal.note, shared.note, edit.note, clear.note]).toEqual(["For Sunday's curry", null, "Half for Anu", null]);
    expect([item.note, none.note]).toEqual(["For Sunday's curry", null]);
  });

  it("stores a note trimmed, and nothing for an empty one", () => {
    expect(normalizeItemNote("  For Sunday's curry \n")).toBe("For Sunday's curry");
    expect(normalizeItemNote("Top shelf")).toBe("Top shelf");
    expect(normalizeItemNote("")).toBeNull();
    expect(normalizeItemNote("   \t\n ")).toBeNull();
    expect(normalizeItemNote(null)).toBeNull();
    expect(normalizeItemNote(undefined)).toBeNull();
    // Inside, it is kept as written.
    expect(normalizeItemNote(" two  spaces ")).toBe("two  spaces");
  });

  it("counts characters, not UTF-16 units: an emoji or an accent is one", () => {
    expect(itemNoteLength("For Sunday's curry")).toBe(18);
    expect(itemNoteLength("é".repeat(80))).toBe(80);
    expect(itemNoteLength("🍛".repeat(80))).toBe(80);
    expect("🍛".repeat(80).length).toBe(160);
    expect(itemNoteLength("")).toBe(0);
  });
});
