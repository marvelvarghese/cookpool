// Undoing an approved ask's use (Cookpool PN-8, cookpool-pantry design §8.3,
// migration 420_kitchen_asks): statement builders only, for the batches that
// put a move back — a transaction's reversal (ledger.ts) and a move's undo
// (stock.ts). No runtime imports, so both can take it without a cycle.
//
// An approval posts one `use` move with via = 'ask'. Putting that move back
// also undoes the answer, in the same batch:
//   * the asker's allowed row goes again when this approval added it
//     ("Always let Dev"), so Undo leaves the item as it was;
//   * the ask returns to pending — the card is back on the answerer's Home —
//     unless the asker undid it themselves, which cancels it (they asked,
//     then said they didn't need it after all).
// Both match the approved ask by its item, state and move, through the
// (item_id, state) index; a move no approved ask names changes nothing.

import type { SqlStatement } from "../d1/executor.js";
import type { KitchenStockMoveRecord } from "./types.js";

/** The statements that undo the answer whose use `move` was; none for a move an ask did not write. */
export function askUndoneStatements(move: Pick<KitchenStockMoveRecord, "id" | "itemId" | "via">, actor: string, now: Date): SqlStatement[] {
  if (move.via !== "ask") return [];
  return [
    {
      text: `DELETE FROM kitchen_item_allowed
             WHERE item_id = $1
               AND member_id IN (SELECT a.asker_id FROM kitchen_asks a
                                 WHERE a.item_id = $1 AND a.state = 'approved' AND a.move_id = $2 AND a.granted = 1)`,
      params: [move.itemId, move.id],
    },
    {
      text: `UPDATE kitchen_asks SET
               state = CASE WHEN asker_id = $3 THEN 'canceled' ELSE 'pending' END,
               answered_at = CASE WHEN asker_id = $3 THEN $4 ELSE NULL END,
               answered_by = CASE WHEN asker_id = $3 THEN $3 ELSE NULL END,
               move_id = NULL,
               txn_id = NULL,
               granted = 0
             WHERE item_id = $1 AND state = 'approved' AND move_id = $2`,
      params: [move.itemId, move.id, actor, now],
    },
  ];
}
