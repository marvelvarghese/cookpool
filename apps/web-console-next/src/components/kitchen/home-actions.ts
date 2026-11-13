/**
 * The calm Home's quick actions (cookpool-home HM-2, the canvas's `Main`),
 * as data: one tile each, in the board's order — Scan bill, Log use, Cook,
 * Groceries — and where each goes. Scan bill shows only while receipt scan
 * does (`receiptScanShows`): a tile that opens a refusal is worse than none.
 *
 * Unit-testable: the hrefs come from the modules that own them.
 */

import { boughtHref, quickUseFieldHref } from "./pantry-list";
import { RECEIPT_SCAN_HREF } from "./receipt-run";

export type HomeActionKey = "scan" | "use" | "cook" | "groceries";

export interface HomeAction {
  key: HomeActionKey;
  label: string;
  href: string;
}

/** The tiles Home shows, in order: four with receipt scan, three without. */
export function homeQuickActions(scanShows: boolean): HomeAction[] {
  const all: HomeAction[] = [
    { key: "scan", label: "Scan bill", href: RECEIPT_SCAN_HREF },
    { key: "use", label: "Log use", href: quickUseFieldHref(true) },
    { key: "cook", label: "Cook", href: "/cook" },
    { key: "groceries", label: "Groceries", href: boughtHref() },
  ];
  return scanShows ? all : all.filter((a) => a.key !== "scan");
}
