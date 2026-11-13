"use client";

import * as React from "react";
import Link from "./link";
import { Bookmark, Compass, Search } from "lucide-react";
import type { ExploreSource } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { shareKey, sharePart } from "@/lib/transitions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KCard, K_BUTTON_QUIET } from "./kit";
import { recipeHref } from "./recipes";
import { RecipeTileView, Segmented } from "./cook-hub-views";
import { EXPLORE_EMPTY_TEXT, EXPLORE_HREF, EXPLORE_KINDS, EXPLORE_SOURCES, type ExploreKind, type ExploreRow } from "./explore";

/**
 * Explore's parts as they draw (cookpool-recipes RC-8, the canvas's
 * `Explore`), from what was read: no reads or writes, so each is rendered in
 * tests. `explore-ui.tsx` puts them together over the data.
 */

/** Explore, beside New recipe in the Cook hub's My recipes. */
export function ExploreButton() {
  return (
    <Link
      href={EXPLORE_HREF}
      className="flex min-h-12 items-center justify-center gap-2 rounded-[14px] bg-cp-accent-tint text-[15px] font-medium text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Compass className="h-[18px] w-[18px]" strokeWidth={2.2} aria-hidden />
      Explore
    </Link>
  );
}

/** The 44 px bookmark: Save (outline), or filled once you have your copy — then it opens it. */
export function BookmarkButton({ name, savedId, saving, onSave }: { name: string; savedId: string | null; saving: boolean; onSave: () => void }) {
  const box = "grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (savedId) {
    return (
      <Link href={recipeHref(savedId)} aria-label={`Saved: open your copy of ${name}`} className={cn(box, "text-primary")}>
        <Bookmark className="h-5 w-5 fill-current" strokeWidth={2} aria-hidden />
      </Link>
    );
  }
  if (saving) {
    return (
      <span role="status" aria-label={`Saving ${name}`} className={cn(box, "text-primary")}>
        <Bookmark className="h-5 w-5 fill-current" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <button type="button" aria-label={`Save ${name}`} aria-pressed={false} onClick={onSave} className={cn(box, "text-muted-foreground")}>
      <Bookmark className="h-5 w-5" strokeWidth={2} aria-hidden />
    </button>
  );
}

/** Explore as it draws, from what was read (no reads or writes, so tests render it). */
export function ExploreView({
  source,
  subtitle,
  query,
  kind,
  onlyCanMake,
  rows,
  loading,
  failed,
  onReload,
  onSource,
  onQuery,
  onKind,
  onOnlyCanMake,
  renderSave,
  back,
}: {
  source: ExploreSource;
  subtitle: string;
  query: string;
  kind: ExploreKind;
  onlyCanMake: boolean;
  /** Null until the first list is read. */
  rows: readonly ExploreRow[] | null;
  loading: boolean;
  failed: boolean;
  onReload?: (() => void) | undefined;
  onSource: (source: ExploreSource) => void;
  onQuery: (q: string) => void;
  onKind: (kind: ExploreKind) => void;
  onOnlyCanMake: (on: boolean) => void;
  /** Each row's bookmark (the screen's, over the copy write). */
  renderSave?: ((row: ExploreRow) => React.ReactNode) | undefined;
  /** The back control (the screen's). */
  back?: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-3.5">
      <header className="flex items-center gap-2">
        {back ?? null}
        <div className="flex min-w-0 flex-col">
          <h1 className="text-[26px] font-medium leading-tight tracking-[-0.02em]">Explore</h1>
          <p className="truncate text-[13px] font-normal tabular-nums text-muted-foreground">{subtitle}</p>
        </div>
      </header>

      <Segmented label="From" large value={source} onChange={onSource} options={EXPLORE_SOURCES} />

      <label className="flex min-h-[52px] items-center gap-2.5 rounded-2xl bg-card px-4 text-muted-foreground focus-within:ring-2 focus-within:ring-ring shadow-cp-card">
        <Search className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="sr-only">Search recipes</span>
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Dal, rice, eggs…"
          enterKeyHint="search"
          className="min-h-12 min-w-0 flex-1 bg-transparent text-base font-normal text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <button
        type="button"
        role="switch"
        aria-checked={onlyCanMake}
        onClick={() => onOnlyCanMake(!onlyCanMake)}
        className={cn(
          "flex min-h-16 items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          onlyCanMake ? "bg-cp-accent-tint" : "bg-card shadow-cp-card hover:bg-accent",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-medium">Only what I can make</span>
          <span className="text-[13px] font-normal text-muted-foreground">From every pantry you&apos;re in</span>
        </span>
        <span aria-hidden className={cn("relative h-8 w-[52px] shrink-0 rounded-full transition-colors", onlyCanMake ? "bg-primary" : "bg-muted-foreground/40")}>
          <span className={cn("absolute top-[3px] h-[26px] w-[26px] rounded-full bg-white shadow-sm transition-[left]", onlyCanMake ? "left-[23px]" : "left-[3px]")} />
        </span>
      </button>

      <div role="group" aria-label="Kind" className="-mx-[var(--cp-gutter,1rem)] flex gap-2 overflow-x-auto px-[var(--cp-gutter,1rem)] pb-0.5 [scrollbar-width:none] min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:px-0 [&::-webkit-scrollbar]:hidden">
        {EXPLORE_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kind === k.id}
            onClick={() => onKind(k.id)}
            className={cn(
              "min-h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              kind === k.id ? "bg-cp-accent-tint text-cp-accent-text" : "bg-muted text-foreground hover:bg-accent",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      {loading && !rows ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-[76px] w-full rounded-[18px]" />
          <Skeleton className="h-[76px] w-full rounded-[18px]" />
          <Skeleton className="h-[76px] w-full rounded-[18px]" />
        </div>
      ) : failed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-4">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load these recipes.</p>
          {onReload ? (
            <Button variant="ghost" className={K_BUTTON_QUIET} onClick={onReload}>
              Try again
            </Button>
          ) : null}
        </KCard>
      ) : !rows || rows.length === 0 ? (
        <p className="rounded-[18px] bg-card px-4 py-6 text-center text-[15px] font-normal text-muted-foreground shadow-cp-card">{EXPLORE_EMPTY_TEXT}</p>
      ) : (
        <ul aria-label="Recipes" className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} data-vt-card="" className="flex min-h-[72px] items-center gap-3 rounded-[18px] bg-card py-2.5 pl-3 pr-1.5 shadow-cp-card">
              <RecipeTileView tile={r.tile} className="h-12 w-12 rounded-[14px] text-[19px]" part={sharePart("tile")} />
              <Link
                href={r.href}
                share={shareKey("recipe", r.id)}
                className="flex min-h-11 min-w-0 flex-1 flex-col gap-0.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span {...sharePart("title")} className="truncate text-base font-medium">{r.name}</span>
                <span className="truncate text-[13px] font-normal tabular-nums text-muted-foreground">{r.meta}</span>
                <span className={cn("truncate text-[13px] font-medium", r.tone === "have" ? "text-cp-accent-text" : "text-cp-soon")}>{r.match}</span>
              </Link>
              {renderSave ? renderSave(r) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
