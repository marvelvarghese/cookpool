// Why Save is off, in words.

import type { SplitProblem } from "@saas/kitchen-engine/splits";
import type { FormProblem } from "./split-form";
import { formatMoney } from "./money";
import { nameOf, type Names } from "./people";

export function problemText(p: SplitProblem | FormProblem, names: Names, me: string | null, currency = "INR"): string {
  const who = (id: string) => nameOf(names, id, me);
  switch (p.kind) {
    case "no_title":
      return "Say what it was for";
    case "no_amount":
      return "Type the amount";
    case "no_one":
      return "Pick who shares it";
    case "duplicate_person":
      return `${who(p.subjectId)} is on it twice`;
    case "invalid_value":
      return `Check ${who(p.subjectId)}'s amount`;
    case "total_mismatch":
      return p.assignedMinor < p.totalMinor
        ? `${formatMoney(p.totalMinor - p.assignedMinor, currency)} left to assign`
        : `${formatMoney(p.assignedMinor - p.totalMinor, currency)} too much assigned`;
    case "pct_not_100":
      return `Percentages reach ${p.basisPoints / 100}% — they need 100%`;
    case "negative_share":
      return `${who(p.subjectId)} would owe less than nothing`;
    case "item_unassigned":
      return `Item ${p.item + 1}: ${formatMoney(p.amountMinor, currency)} still not assigned`;
    case "item_over":
      return `Item ${p.item + 1}: ${formatMoney(p.amountMinor, currency)} more than it costs`;
    case "item_empty":
      return `Item ${p.item + 1} needs a price`;
    case "payers_mismatch":
      return p.paidMinor < p.totalMinor
        ? `Who paid: ${formatMoney(p.totalMinor - p.paidMinor, currency)} not paid by anyone`
        : `Who paid: ${formatMoney(p.paidMinor - p.totalMinor, currency)} more than the total`;
  }
}
