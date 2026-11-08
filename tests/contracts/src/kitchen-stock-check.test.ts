// The stock check in the contract (Cookpool PN-4, cookpool-pantry design §7):
// the answers to "where did it go", the names a move's `via` takes, the
// check's refusal reasons, and the shapes of the two routes.

import {
  KITCHEN_CHECK_ERROR_REASONS,
  KITCHEN_ERROR_REASONS,
  STOCK_CHECK_GONE,
  STOCK_MOVE_VIAS,
  type CheckGroupItemRequest,
  type CheckItemResponse,
  type CheckPersonalItemRequest,
  type KitchenStockMove,
  type StockCheckGone,
  type StockMoveVia,
} from "@saas/contracts/kitchen";

// Compile time: KitchenStockMove.via names exactly STOCK_MOVE_VIAS.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const viasMatch: Same<StockMoveVia, NonNullable<KitchenStockMove["via"]>> = true;

describe("contracts: the stock check (Cookpool PN-4)", () => {
  it("names the three answers, the two vias, and its own reasons beside the kitchen's", () => {
    expect(STOCK_CHECK_GONE).toEqual(["me", "split", "waste"]);
    expect(STOCK_MOVE_VIAS).toEqual(["check", "ask"]);
    expect(viasMatch).toBe(true);
    expect(KITCHEN_CHECK_ERROR_REASONS).toEqual({ UNCHANGED: "unchanged", MORE_THAN_BOUGHT: "more_than_bought" });
    // Its own reasons never shadow the kitchen's.
    const kitchen: readonly string[] = Object.values(KITCHEN_ERROR_REASONS);
    for (const reason of Object.values(KITCHEN_CHECK_ERROR_REASONS)) expect(kitchen).not.toContain(reason);
  });

  it("types the requests and the answer, with via on the move", () => {
    const group: CheckGroupItemRequest = { left: { quantity: "750", unit: "ml" }, gone: "split" };
    const personal: CheckPersonalItemRequest = { left: { quantity: 0 }, gone: "waste" };
    // @ts-expect-error A personal item is the caller's alone: no split.
    const split: CheckPersonalItemRequest = { left: { quantity: 1 }, gone: "split" };
    const gone: StockCheckGone = "me";
    const answer: CheckItemResponse = {
      item: {} as CheckItemResponse["item"],
      move: {
        id: "mov_1", itemId: "itm_1", kind: "adjust", qtyMilli: 300_000, quantity: 300, unit: "ml", costMinor: 0,
        actor: "usr_anu", consumers: null, txnId: null, reverses: null, at: "2026-11-08T08:00:00.000Z", undone: false,
        undoneBy: null, via: "check",
      },
      txn: null,
    };
    // A move logged directly carries no via at all.
    const direct: KitchenStockMove = {
      id: "mov_2", itemId: "itm_1", kind: "use", qtyMilli: 250_000, quantity: 250, unit: "ml", costMinor: 1500,
      actor: "usr_anu", consumers: ["usr_anu"], txnId: null, reverses: null, at: "2026-11-08T08:00:00.000Z", undone: false,
      undoneBy: null,
    };
    expect([group.gone, personal.gone, split.gone, gone]).toEqual(["split", "waste", "split", "me"]);
    expect(answer.move.via).toBe("check");
    expect(direct.via).toBeUndefined();
  });
});
