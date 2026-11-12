"use client";

import { cn } from "@/lib/cn";
import { K_CARD } from "./kit";
import type { AdjustCard, ReceiptAdjustChoice } from "./receipt-adjust";

/**
 * The one short card after a scan with taxes, charges or discounts
 * (cookpool-ai AI-14): "Include taxes and charges in item prices? ₹38" and
 * "Apply discounts? −₹50", each a switch, on to start with, with its effect
 * in one line, and what the items will cost ("Items cost ₹412 in total,
 * what you paid"). The new look's tokens only; no card without adjustments.
 * AI-15 can reuse it with its own `adjustCard` view-model.
 */
export function ReceiptAdjustCard({ card, onToggle }: { card: AdjustCard; onToggle: (key: keyof ReceiptAdjustChoice) => void }) {
  return (
    <section aria-label="Taxes, charges and discounts" className={cn(K_CARD, "overflow-hidden")}>
      <div role="group" aria-label="Item prices" className="divide-y divide-cp-line">
        {card.rows.map((r) => (
          <button
            key={r.key}
            type="button"
            role="switch"
            aria-checked={r.on}
            onClick={() => onToggle(r.key)}
            className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-medium leading-snug">
                {r.question} <span className="tabular-nums text-muted-foreground">({r.amount})</span>
              </span>
              <span className="text-[13px] font-normal text-muted-foreground">{r.effect}</span>
            </span>
            <span aria-hidden className={cn("flex h-7 w-12 shrink-0 rounded-full p-[3px] transition-colors", r.on ? "justify-end bg-primary" : "justify-start bg-input")}>
              <span className="h-[22px] w-[22px] rounded-full bg-cp-card" />
            </span>
          </button>
        ))}
      </div>
      <p className="border-t border-cp-line bg-cp-accent-tint px-4 py-2.5 text-[13px] font-medium tabular-nums text-cp-accent-text" aria-live="polite">
        {card.total}
      </p>
    </section>
  );
}
