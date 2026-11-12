/**
 * Tick to pick, Log once (cookpool-revamp RV-13, the canvas's RvKitchen and
 * its "Tick to log — the rules" 3): in the Kitchen a tick only picks the row
 * — it turns green, and its amount and unit can still change — and nothing
 * is written until the one Log button above the tab bar ("Log 2 items",
 * "Milk 1 glass · Eggs 2"). One tap logs every picked row (each its own use,
 * through Log several's path), with ONE toast whose Undo undoes them all;
 * a logged row's line reads "Logged 1 glass · just now" until reload.
 *
 * The pure half: picking, the button's words, the toast's words, what stays
 * picked when some are refused, and the logged line. Dependency-free (contract
 * types only), so it is unit-testable.
 */

import type { LadderStep } from "./pantry-set";
import type { TickAmount, TickMeta } from "./tick-row";
import { tickWrite } from "./tick-row";
import type { PickItem } from "./amount-picker";

// ── Picking ───────────────────────────────────────────────────────

/** Tick a row: picked if it wasn't, unpicked if it was. Keeps the order things were picked in. Never mutates `picked`. */
export function togglePick(picked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** `picked` with `ids` taken out (logged) or put back (refused, undone), in order. Never mutates `picked`. */
export function withoutPicks(picked: ReadonlySet<string>, ids: Iterable<string>): Set<string> {
  const next = new Set(picked);
  for (const id of ids) next.delete(id);
  return next;
}

export function withPicks(picked: ReadonlySet<string>, ids: Iterable<string>): Set<string> {
  const next = new Set(picked);
  for (const id of ids) next.add(id);
  return next;
}

/** "2 items", "1 item". */
export function itemsWord(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"}`;
}

// ── The Log button ────────────────────────────────────────────────

/** One picked row as the button lists it: its name and what its box would log. */
export interface PickLine {
  id: string;
  name: string;
  /** The box's number and its unit word ("1", "glass"). */
  number: string;
  word: string;
}

/**
 * A picked row, briefly: "Milk 1 glass"; just the number when the unit's
 * word is the thing itself ("Eggs 2", not "Eggs 2 eggs").
 */
export function pickWords(line: Pick<PickLine, "name" | "number" | "word">): string {
  const head = line.name.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const word = line.word.trim().toLowerCase();
  const same = head.length >= 3 && word.length >= 3 && word.slice(0, 3) === head.slice(0, 3);
  return same || !word ? `${line.name} ${line.number}` : `${line.name} ${line.number} ${line.word}`;
}

/** The floating button: "Log 2 items" over "Milk 1 glass · Eggs 2"; null with nothing picked. */
export function logBar(lines: readonly PickLine[]): { title: string; sub: string; label: string } | null {
  if (lines.length === 0) return null;
  const sub = lines.map(pickWords).join(" · ");
  return { title: `Log ${itemsWord(lines.length)}`, sub, label: `Log ${itemsWord(lines.length)}: ${sub}` };
}

// ── What is written ───────────────────────────────────────────────

/** A picked row's box as Log several's step: a count of a measure, else an amount in the base unit (what a tick logged before RV-13). */
export function pickStep(item: PickItem, amount: Pick<TickAmount, "pick" | "words">): LadderStep {
  const w = tickWrite(item, amount);
  return {
    key: "tick",
    amount: w.measure ? { kind: "measure", measure: w.measure.measure, quantity: w.measure.quantity, qtyMilli: w.qtyMilli, label: w.what } : { kind: "unit", qtyMilli: w.qtyMilli },
    qtyMilli: w.qtyMilli,
    words: amount.words,
    rest: false,
  };
}

/** The one toast: "Logged 2 items"; "Logged 1 of 2 items" with which were refused when some were. */
export function pickToast(total: readonly { name: string }[], refused: readonly { name: string }[] = []): { title: string; description?: string } {
  if (refused.length === 0) return { title: `Logged ${itemsWord(total.length)}` };
  return {
    title: `Logged ${total.length - refused.length} of ${itemsWord(total.length)}`,
    description: `Couldn't log ${refused.map((r) => r.name).join(", ")}. Still ticked.`,
  };
}

// ── The logged line ───────────────────────────────────────────────

/** Under the name once logged from here, until reload: "Logged 1 glass · just now", in the accent text. */
export function loggedMeta(words: string): TickMeta {
  return { text: `Logged ${words} · just now`, tone: "logged" };
}
