// How the Group page (V2Group, spliteco-calm SL3) reads a bill and what a
// bill offers: kept pure, so the rules are tested in node.

import type { SplitecoExpenseSummary, SplitecoGroupResponse } from "@saas/contracts/spliteco";
import { formatShort } from "./money";
import { nameOf, type Names } from "./people";
import { signedShort, type Tone } from "./home";
import { DelayedSends } from "./delayed";

type Bill = Pick<SplitecoExpenseSummary, "app" | "locked" | "kind">;

/**
 * Whether this bill can be changed here: Cookpool's rows (`app = 'cookpool'`)
 * and payments are `locked`, and a viewer changes nothing. Only these offer
 * Delete (the swipe), Edit and Move.
 */
export function billWritable(e: Bill, canWrite: boolean): boolean {
  return canWrite && !e.locked && e.app !== "cookpool" && e.kind !== "settlement";
}

export type HoldTile = "edit" | "move" | "comment" | "open";

/** The hold sheet's tiles: Edit · Move · Comment for a bill you can change; Open · Comment otherwise (Cookpool's, payments, viewers). */
export function holdTiles(e: Bill, canWrite: boolean): HoldTile[] {
  return billWritable(e, canWrite) ? ["edit", "move", "comment"] : ["open", "comment"];
}

/** Where each tile goes. Comment opens the bill with its comment box focused. */
export function holdHref(tile: HoldTile, expenseId: string): string {
  const id = encodeURIComponent(expenseId);
  switch (tile) {
    case "edit":
      return `/add?edit=${id}`;
    case "move":
      return `/move?id=${id}`;
    case "comment":
      return `/expense?id=${id}&comment=1`;
    case "open":
      return `/expense?id=${id}`;
  }
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Bills under month headers, newest first: "November" this year, "November 2025" before it. */
export function billMonths<T extends { occurredAt: string }>(rows: readonly T[], now: Date = new Date()): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const d = new Date(r.occurredAt);
    const key = d.getFullYear() === now.getFullYear() ? MONTHS[d.getMonth()]! : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    (out.get(key) ?? out.set(key, []).get(key)!).push(r);
  }
  return [...out.entries()];
}

/** The bill's one meta line: "Dev paid · ₹4,960", "You and Anu paid · ₹2,960", a payment "Meera paid Dev". */
export function billMeta(e: Pick<SplitecoExpenseSummary, "kind" | "payers" | "splits" | "totalMinor" | "currency">, names: Names, me: string | null): string {
  if (e.kind === "settlement") {
    const to = e.splits.find((s) => s.owedMinor > 0);
    const from = e.payers[0];
    return `${from ? nameOf(names, from.subjectId, me) : "Someone"} paid ${to ? nameOf(names, to.subjectId, me) : "someone"}`;
  }
  const payers = e.payers.map((p) => nameOf(names, p.subjectId, me));
  const who = payers.length === 0 ? "Nobody" : payers.length <= 2 ? payers.join(" and ") : `${payers.length} people`;
  return `${who} paid · ${formatShort(e.totalMinor, e.currency)}`;
}

/** Your side of a bill, signed: `+₹1,800` you lent, `−₹1,240` you borrowed, "not involved" dim. */
export function billShare(e: Pick<SplitecoExpenseSummary, "myNetMinor" | "splits" | "currency">, me: string | null): { text: string; tone: Tone; label: string } {
  const n = e.myNetMinor;
  if (n > 0) return { ...signedShort(n, e.currency), label: "you lent" };
  if (n < 0) return { ...signedShort(n, e.currency), label: "you borrowed" };
  const involved = me != null && e.splits.some((s) => s.subjectId === me && (s.paidMinor > 0 || s.owedMinor > 0));
  return involved ? { ...signedShort(0, e.currency), label: "settled" } : { text: "not involved", tone: "even", label: "not involved" };
}

/** The Balances page's heading: the plan the group uses. */
export function planTitle(simplify: boolean): string {
  return simplify ? "Fewest payments" : "Pair by pair";
}

/** The Balances page's rows: who pays whom, "You" for the caller, largest first. */
export function planRows(
  data: Pick<SplitecoGroupResponse, "plan">,
  names: Names,
  me: string | null,
): { from: string; to: string; fromId: string; toId: string; amountMinor: number }[] {
  return [...data.plan]
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .map((p) => ({ from: nameOf(names, p.fromSubjectId, me), to: nameOf(names, p.toSubjectId, me), fromId: p.fromSubjectId, toId: p.toSubjectId, amountMinor: p.amountMinor }));
}

/**
 * A swiped Delete with an Undo that is real (design §2 "Delete shows Undo"):
 * the row hides at once and the request waits UNDO_MS behind the toast
 * (`DelayedSends`), so Undo inside the window means nothing was sent. When
 * the server refuses (409 `owned_by_cookpool`, a viewer, a stale version),
 * the row comes back and `failed` says why. Leaving the page (`flush`)
 * sends what is waiting: the person did ask for it.
 */
export class BillDeletes {
  private readonly hidden = new Set<string>();

  constructor(
    private readonly send: (id: string) => Promise<unknown>,
    private readonly on: {
      change: (hidden: ReadonlySet<string>) => void;
      deleted?: (id: string) => void;
      failed: (id: string, err: unknown) => void;
    },
    private readonly sends: DelayedSends = new DelayedSends(),
  ) {}

  /** Hide the row and schedule its delete. False when it is already on its way. */
  remove(id: string): boolean {
    if (this.hidden.has(id)) return false;
    this.hidden.add(id);
    this.on.change(new Set(this.hidden));
    this.sends.schedule(id, () => {
      this.send(id).then(
        () => this.on.deleted?.(id),
        (err: unknown) => {
          this.hidden.delete(id);
          this.on.change(new Set(this.hidden));
          this.on.failed(id, err);
        },
      );
    });
    return true;
  }

  /** Undo inside the window: no request is made and the row comes back. False once it has gone. */
  undo(id: string): boolean {
    if (!this.sends.undo(id)) return false;
    this.hidden.delete(id);
    this.on.change(new Set(this.hidden));
    return true;
  }

  flush(): void {
    this.sends.flush();
  }

  isHidden(id: string): boolean {
    return this.hidden.has(id);
  }
}
