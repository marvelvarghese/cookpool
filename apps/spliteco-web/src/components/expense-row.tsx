"use client";

import Link from "next/link";
import type { SplitecoExpenseSummary } from "@saas/contracts/spliteco";
import { CategoryIcon } from "./ui";
import { Icon } from "./icons";
import { formatMoney } from "@/lib/money";
import { nameOf, type Names } from "@/lib/people";
import { expenseTags, myRowEffect } from "@/lib/view";
import { monthShort, shortDate } from "@/lib/activity-text";

/** "Anu paid ₹4,416.00", "You and Anu paid ₹2,960.00", "Meera paid Dev". */
export function whoPaid(e: SplitecoExpenseSummary, names: Names, me: string | null): string {
  if (e.kind === "settlement") {
    const to = e.splits.find((s) => s.owedMinor > 0);
    const from = e.payers[0];
    return `${from ? nameOf(names, from.subjectId, me) : "Someone"} paid ${to ? nameOf(names, to.subjectId, me) : "someone"}`;
  }
  const payers = e.payers.map((p) => nameOf(names, p.subjectId, me));
  const who = payers.length <= 2 ? payers.join(" and ") : `${payers.length} people`;
  return `${who} paid ${formatMoney(e.totalMinor, e.currency)}`;
}

export function ExpenseRow({ e, names, me, withDate, sub, kitchenGroup }: { e: SplitecoExpenseSummary; names: Names; me: string | null; withDate?: boolean; sub?: string; kitchenGroup?: boolean }) {
  const effect = myRowEffect(e);
  const tags = expenseTags(e, kitchenGroup);
  const d = new Date(e.occurredAt);
  return (
    <Link href={`/expense?id=${encodeURIComponent(e.id)}`} className="lrow">
      {withDate ? (
        <div className="datecol" aria-label={shortDate(e.occurredAt)}>
          <span className="m">{monthShort(e.occurredAt)}</span>
          <span className="d">{String(d.getDate()).padStart(2, "0")}</span>
        </div>
      ) : null}
      <CategoryIcon expense={e} />
      <div className="main">
        <div className="inline" style={{ gap: 6, flexWrap: "nowrap" }}>
          <span className="title ellipsis">{e.title}</span>
          {tags.slice(0, 2).map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
          {e.locked && e.kind !== "settlement" ? (
            <span aria-label="Read-only here" style={{ color: "var(--dim)", display: "inline-flex" }}>
              <Icon name="lock" size={13} />
            </span>
          ) : null}
        </div>
        <span className="sub ellipsis">{sub ?? whoPaid(e, names, me)}</span>
      </div>
      <div className="end">
        <span className="k">{effect.label}</span>
        <span className={`v ${effect.tone}`} style={{ fontSize: 14 }}>{effect.amount}</span>
      </div>
    </Link>
  );
}
