import { SWIPE_THRESHOLD, clampIndex, indexAfterRemove, itemHasProblem, swipeDirection } from "@/lib/carousel";
import type { ItemForm } from "@/lib/split-form";

const PEOPLE = ["usr_a", "usr_b"];
const item = (over: Partial<ItemForm> = {}): ItemForm => ({ key: "i", name: "Naan", qtyText: "1", unitText: "", totalText: "90", shares: {}, ...over });

describe("the Itemized carousel", () => {
  it("clamps the index to the items there are", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(4, 0)).toBe(0);
  });

  it("keeps the index in range after a remove", () => {
    expect(indexAfterRemove(2, 2, 2)).toBe(1); // the last item went: show the new last
    expect(indexAfterRemove(1, 1, 3)).toBe(1); // a middle one went: the next slides in
    expect(indexAfterRemove(3, 0, 3)).toBe(2); // one before it went: stay on the same item
    expect(indexAfterRemove(0, 0, 0)).toBe(0);
  });

  it("turns a swipe past the threshold into a direction", () => {
    expect(SWIPE_THRESHOLD).toBe(50);
    expect(swipeDirection(-60)).toBe(1);
    expect(swipeDirection(-50)).toBe(1);
    expect(swipeDirection(-49)).toBe(0);
    expect(swipeDirection(0)).toBe(0);
    expect(swipeDirection(49)).toBe(0);
    expect(swipeDirection(80)).toBe(-1);
  });

  it("flags an item that stops Save", () => {
    expect(itemHasProblem(item(), PEOPLE)).toBe(true); // nobody on it
    expect(itemHasProblem(item({ totalText: "" }), PEOPLE)).toBe(true); // no price
    expect(itemHasProblem(item({ shares: { usr_a: { mode: "exact", value: 5000 } } }), PEOPLE)).toBe(true); // ₹40 left
    expect(itemHasProblem(item({ shares: { usr_a: { mode: "portion", value: 1000 } } }), PEOPLE)).toBe(false);
    // Portions that differ from the bill's count are a warning, not a problem.
    expect(itemHasProblem(item({ qtyText: "4", totalText: "360", shares: { usr_a: { mode: "portion", value: 1000 } } }), PEOPLE)).toBe(false);
  });
});
