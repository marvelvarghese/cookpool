"use client";

import * as React from "react";
import Link from "./link";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { Face } from "./faces-ui";
import { useMemberNames } from "./people-data";
import { useItemsByRef, useLogUse, useUsuals } from "./pantry-data";
import { doItAgainRows, usualRef, usualsThatFit, type DoItAgainRow } from "./quick-use";
import { boughtHref, quickUseFieldHref } from "./pantry-list";
import { newFrame } from "@/lib/features";
import { useSayItShows } from "./say-it-data";
import { SayItSheet, SayItSparkle } from "./say-it-ui";
import { useKitchenRouter } from "./transition-ui";

// Home's "What did you use?" and the row of usuals (CP-13, SM-10). Moved here
// from the Home page unchanged by cookpool-recipes RC-2, so today's Home and
// the new frame's Home share it. In the new frame (cookpool-pantry PN-5) the
// field opens the Pantry with its search ready; the usual chips stay. Beside
// it, the new frame's + Bought opens the shopping run (PN-6).

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

  const isNew = newFrame();
  // Say what you used (cookpool-ai AI-7): a ✨ beside the field opens its sheet; the field itself is unchanged.
  const sayShows = useSayItShows();
  const [sayOpen, setSayOpen] = React.useState(false);
  const router = useKitchenRouter();
  const field = (
    <Link
      href={quickUseFieldHref(isNew)}
      className={cn(
        "flex h-12 w-full items-center gap-2.5 rounded-2xl border border-input bg-card px-4 text-base text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        sayShows && isNew && "pr-14",
      )}
    >
      <Search className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">What did you use?</span>
    </Link>
  );
  return (
    <section aria-label="Quick use" className="space-y-2">
      {isNew ? (
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            {field}
            {sayShows ? <SayItSparkle onOpen={() => setSayOpen(true)} className="absolute right-0.5 top-0.5" /> : null}
          </div>
          <Link
            href={boughtHref()}
            className="flex h-12 shrink-0 items-center gap-1 rounded-2xl border border-input bg-card px-3.5 text-[15px] font-extrabold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
            Bought
          </Link>
        </div>
      ) : (
        field
      )}
      {/* Kept while open, so a refusal that hides the entry (no key, the budget) is still read. */}
      {sayShows || sayOpen ? (
        <SayItSheet
          open={sayOpen}
          onClose={() => setSayOpen(false)}
          meId={meId}
          onByHand={() => {
            setSayOpen(false);
            router.push(quickUseFieldHref(true));
          }}
        />
      ) : null}
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

/**
 * The revamped Home's "What did you use?" (cookpool-revamp RV-15, the
 * canvas's `HomeRevamp`): the field alone, opening the Kitchen with its
 * search ready. No usuals under it and no Say it in it (owner decision 2):
 * Say it lives in the Kitchen.
 */
export function HomeUseField() {
  return (
    <Link
      href={quickUseFieldHref(true)}
      className="flex min-h-[54px] w-full items-center gap-2.5 rounded-[18px] bg-card px-4 text-base font-normal text-muted-foreground shadow-cp-card transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Search className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">What did you use?</span>
    </Link>
  );
}
