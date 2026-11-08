"use client";

import * as React from "react";
import Link from "./link";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { Face } from "./faces-ui";
import { useMemberNames } from "./people-data";
import { useItemsByRef, useLogUse, useUsuals } from "./pantry-data";
import { doItAgainRows, usualRef, usualsThatFit, type DoItAgainRow } from "./quick-use";

// Home's "What did you use?" and the row of usuals (CP-13, SM-10). Moved here
// from the Home page unchanged by cookpool-recipes RC-2, so today's Home and
// the new frame's Home share it.

/** Usuals whose items are read for the row: a couple beyond the ones shown, so a usual that no longer fits is replaced. */
const USUAL_CHIPS = 6;

/**
 * "What did you use?" (CP-13), and under it the one row of your usuals
 * (SM-10: it was Home's use-soon cards, + Add's "Do it again" and Use's
 * strip — three places). Each chip says what and for whom — "Milk · 1 glass"
 * with the faces of who it is for when that is not just you — and logs it
 * again at once, with the Undo toast. Nothing shows until you have usuals.
 */
export function QuickUse({ meId }: { meId: string | null }) {
  const usuals = useUsuals();
  const names = useMemberNames();
  const logUse = useLogUse();
  const fit = React.useMemo(() => usualsThatFit(usuals.data ?? []).slice(0, USUAL_CHIPS + 2), [usuals.data]);
  const refs = React.useMemo(() => fit.map(usualRef), [fit]);
  const items = useItemsByRef(refs);
  const rows = doItAgainRows(fit, items, { meId, names, limit: USUAL_CHIPS });

  // Logged at once (SM-5): the Undo toast is up before the server answers; a refusal is put back and says why.
  const again = (row: DoItAgainRow) => {
    if (!row.item) return;
    void logUse({
      ref: row.ref,
      item: row.item,
      qtyMilli: row.qtyMilli,
      consumers: row.consumers,
      idempotencyKey: crypto.randomUUID(),
      what: row.words,
      measure: row.measure,
      meId,
      names,
    });
  };

  return (
    <section aria-label="Quick use" className="space-y-2">
      <Link
        href="/use"
        className="flex h-12 w-full items-center gap-2.5 rounded-2xl border border-input bg-card px-4 text-base text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="h-5 w-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">What did you use?</span>
      </Link>
      {usuals.loading ? (
        <div className="flex gap-2" aria-hidden>
          <Skeleton className="h-11 w-32 rounded-full" />
          <Skeleton className="h-11 w-28 rounded-full" />
          <Skeleton className="h-11 w-28 rounded-full" />
        </div>
      ) : rows.length > 0 ? (
        <ul aria-label="Your usuals" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:px-0">
          {rows.map((row) => {
            const others = row.consumers.length > 1 || (row.consumers.length === 1 && row.consumers[0] !== meId);
            return (
              <li key={row.key} className="shrink-0">
                <button
                  type="button"
                  aria-label={row.label}
                  aria-disabled={!row.item ? true : undefined}
                  onClick={() => again(row)}
                  className={cn(
                    "flex h-11 items-center gap-2 whitespace-nowrap rounded-full border bg-card pl-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    others ? "pr-1.5" : "pr-4",
                    row.item ? "hover:bg-accent" : "cursor-wait",
                  )}
                >
                  {row.title}
                  {others ? (
                    <span aria-hidden className="flex -space-x-1">
                      {row.consumers.slice(0, 3).map((id) => (
                        <Face key={id} subjectId={id} meId={meId} names={names} className="h-8 w-8 text-[10px] ring-2 ring-card" />
                      ))}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
