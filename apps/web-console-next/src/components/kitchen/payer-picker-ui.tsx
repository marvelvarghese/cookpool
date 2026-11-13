"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { CLOSE_44 } from "./kit";
import { RING } from "./new-home-parts-ui";
import { Face } from "./faces-ui";
import { memberLabel, type MemberNames } from "./members";
import { payerMatches } from "./payer-picker";

/**
 * Paid by (cookpool-kitchen-calm KC-6, the canvas's `AddItem` and `PaidBy`):
 * one row — the payer's face and name, ▾ — however big the group, opening
 * Who paid?: a search over the group, then everyone, the payer ticked.
 * Picking closes it.
 */
export function PayerPicker({
  roster,
  paidBy,
  onPick,
  meId,
  names,
  groupName,
}: {
  roster: readonly string[];
  paidBy: string | null;
  onPick: (id: string) => void;
  meId: string | null;
  names: MemberNames;
  groupName: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const label = (id: string) => memberLabel(id, meId, names);
  const shown = payerMatches(roster, query, label);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Paid by ${paidBy ? label(paidBy) : "nobody yet"}, change`}
        onClick={() => setOpen(true)}
        className={cn("flex min-h-[52px] w-full items-center gap-2.5 rounded-2xl bg-card pl-2.5 pr-3 text-left text-base font-medium text-foreground shadow-cp-card", RING)}
      >
        {paidBy ? <Face subjectId={paidBy} meId={meId} names={names} className="h-8 w-8 text-[13px] font-medium" /> : null}
        <span className="min-w-0 flex-1 truncate">{paidBy ? label(paidBy) : "Pick who paid"}</span>
        <ChevronDown className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={2.2} aria-hidden />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className={cn(
            "mx-auto max-h-[92dvh] max-w-xl gap-0 overflow-y-auto rounded-t-[28px] border-x-0 bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-2.5 shadow-2xl focus:outline-none min-[900px]:bottom-6 min-[900px]:rounded-[24px] min-[900px]:border",
            CLOSE_44,
          )}
        >
          <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-border min-[900px]:hidden" />
          <SheetTitle className="mb-3.5 text-lg font-medium">Who paid?</SheetTitle>
          {roster.length > 6 ? (
            <label className="mb-3.5 flex h-11 items-center gap-2 rounded-[14px] bg-background px-3.5 focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">Search {groupName}</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${groupName}`}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
            </label>
          ) : null}
          <div className="divide-y divide-border overflow-hidden rounded-[18px] bg-background">
            {shown.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">Nobody by that name</p> : null}
            {shown.map((id) => {
              const on = id === paidBy;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setOpen(false);
                    onPick(id);
                  }}
                  className={cn("flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-foreground", RING)}
                >
                  <Face subjectId={id} meId={meId} names={names} className="h-8 w-8 text-[13px] font-medium" />
                  <span className="min-w-0 flex-1 truncate">{label(id)}</span>
                  {on ? <Check className="h-5 w-5 shrink-0 text-cp-accent-text" strokeWidth={2.4} aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
