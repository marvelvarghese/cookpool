"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Plus, Refrigerator, Search } from "lucide-react";
import type { Pantry, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useProfile } from "@/components/kitchen/data";
import { IconBubble, KCard, K_BUTTON, K_INPUT } from "@/components/kitchen/kit";
import type { MemberNames } from "@/components/kitchen/members";
import { useMemberNames, useMyBalances } from "@/components/kitchen/people-data";
import { usePantries, usePantryItems } from "@/components/kitchen/pantry-data";
import { FilterChips, ItemCard, ItemTable, PantryBadge, PantryPicker } from "@/components/kitchen/pantry-ui";
import {
  ALL_PANTRIES,
  filterChips,
  itemRowView,
  pantryKey,
  pantryRows,
  pantrySections,
  pantrySummary,
  parseFilterParam,
  parsePantryParam,
  type ItemFilter,
  type PantrySection,
  type PantrySummary,
} from "@/components/kitchen/pantry";

/** Rows the desktop table shows before "Show all N items". */
const TABLE_ROWS = 12;

/**
 * Pantry — all pantries (CP-12). One screen for every pantry you can reach:
 * a searchable picker (All pantries, Personal, then groups — no per-group
 * tabs), what it all holds and is worth, filters (All items · Use soon ·
 * Expired), and the items — on a phone in a folding section per pantry, from
 * 900px in one table, soonest use-by first. Every row opens the item; Use
 * (when you may) opens its Use section. `?pantry=` and `?filter=` keep the
 * choice in the address.
 */
export default function PantryPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const pantries = usePantries();
  const balances = useMyBalances();
  const names = useMemberNames();
  const recentSlugs = useRecentGroupSlugs();

  const pantryParam = parsePantryParam(searchParams?.get("pantry"));
  const filterParam = parseFilterParam(searchParams?.get("filter"));
  const [selected, setSelected] = React.useState(pantryParam);
  const [filter, setFilter] = React.useState<ItemFilter>(filterParam);
  React.useEffect(() => setSelected(pantryParam), [pantryParam]);
  React.useEffect(() => setFilter(filterParam), [filterParam]);

  // The choice switches at once and is mirrored into the address without a
  // navigation, so a reload or a shared link opens it again.
  const mirror = (pantry: string, nextFilter: ItemFilter) => {
    const params = new URLSearchParams(window.location.search);
    if (pantry === ALL_PANTRIES) params.delete("pantry");
    else params.set("pantry", pantry);
    if (nextFilter === "all") params.delete("filter");
    else params.set("filter", nextFilter);
    const qs = params.toString();
    window.history.replaceState(null, "", `${pathname ?? "/pantry"}${qs ? `?${qs}` : ""}`);
  };

  // A pantry you can no longer reach (a group you left) reads as All pantries.
  // Its items are read beside the pantry list, not after it (SM-5): a pantry
  // that turns out unreachable only costs that one read.
  const list = pantries.data;
  const scope = list && selected !== ALL_PANTRIES && !list.some((p) => pantryKey(p) === selected) ? ALL_PANTRIES : selected;
  const items = usePantryItems(scope);

  const memberCounts = React.useMemo(
    () => new Map((balances.data?.groups ?? []).map((g) => [g.orgId, g.memberCount] as const)),
    [balances.data],
  );
  const summary = list ? pantrySummary(list, scope, memberCounts) : null;
  const addHref = scope === ALL_PANTRIES ? "/pantry/new" : `/pantry/new?pantry=${encodeURIComponent(scope)}`;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight min-[900px]:text-[30px]">Pantry</h1>
        <Button asChild className={K_BUTTON}>
          <Link href={addHref}>
            <Plus aria-hidden />
            Add<span className="hidden min-[900px]:inline"> item</span>
          </Link>
        </Button>
      </header>

      {pantries.loading ? (
        <PantrySkeleton />
      ) : pantries.error || !list || !summary ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your pantries. {pantries.error?.message ?? ""}</p>
          <Button variant="outline" className={K_BUTTON} onClick={pantries.reload}>
            Try again
          </Button>
        </KCard>
      ) : (
        <PantryBody
          list={list}
          scope={scope}
          filter={filter}
          summary={summary}
          items={items}
          meId={meId}
          names={names}
          recentSlugs={recentSlugs}
          memberCounts={memberCounts}
          addHref={addHref}
          onPantry={(key) => {
            setSelected(key);
            mirror(key, filter);
          }}
          onFilter={(next) => {
            setFilter(next);
            mirror(selected, next);
          }}
        />
      )}
    </div>
  );
}

function PantryBody({
  list,
  scope,
  filter,
  summary,
  items,
  meId,
  names,
  recentSlugs,
  memberCounts,
  addHref,
  onPantry,
  onFilter,
}: {
  list: readonly Pantry[];
  scope: string;
  filter: ItemFilter;
  summary: PantrySummary;
  items: ReturnType<typeof usePantryItems>;
  meId: string | null;
  names: MemberNames;
  recentSlugs: readonly string[];
  memberCounts: ReadonlyMap<string, number>;
  addHref: string;
  onPantry: (key: string) => void;
  onFilter: (filter: ItemFilter) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  const [openOverride, setOpenOverride] = React.useState<Record<string, boolean>>({});
  const loaded = items.data?.items ?? null;

  const sections = React.useMemo(
    () => (loaded ? pantrySections(list, loaded, { selected: scope, filter, recentSlugs, memberCounts }) : null),
    [loaded, list, scope, filter, recentSlugs, memberCounts],
  );
  const tableRows = React.useMemo(
    () => (loaded ? pantryRows(loaded, { selected: scope, filter, query }).map((i) => itemRowView(i, { meId, names })) : []),
    [loaded, scope, filter, query, meId, names],
  );
  const shownRows = showAll ? tableRows : tableRows.slice(0, TABLE_ROWS);
  const nothingAnywhere = summary.itemCount === 0 && scope === ALL_PANTRIES;

  return (
    <>
      <div className="flex flex-col gap-3 min-[900px]:flex-row min-[900px]:items-start">
        <PantryPicker
          pantries={list}
          value={scope}
          onChange={(key) => {
            setShowAll(false);
            onPantry(key);
          }}
          label="Showing"
          idPrefix="pantry-picker"
          includeAll
          className="min-[900px]:w-80 min-[900px]:shrink-0"
        />
        {nothingAnywhere ? null : (
          <div className="relative hidden min-[900px]:block min-[900px]:flex-1">
            <label htmlFor="pantry-search" className="sr-only">
              Search items
            </label>
            <Search className="pointer-events-none absolute left-3.5 top-7 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="pantry-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items"
              autoComplete="off"
              className={cn(K_INPUT, "h-14 rounded-2xl bg-card pl-11 sm:h-14")}
            />
          </div>
        )}
      </div>

      <div>
        <p className="text-[15px] font-bold tabular-nums">{summary.headline}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{summary.subline}</p>
      </div>

      {nothingAnywhere ? (
        <EmptyPantries />
      ) : (
        <>
          <FilterChips chips={filterChips(summary)} value={filter} onChange={onFilter} />

          {items.loading || (!items.data && !items.error) ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : items.error || !sections ? (
            <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load the items. {items.error?.message ?? ""}</p>
              <Button variant="outline" className={K_BUTTON} onClick={items.reload}>
                Try again
              </Button>
            </KCard>
          ) : (
            <>
              {/* Phones: a folding section per pantry. */}
              <div className="space-y-5 min-[900px]:hidden">
                {sections.sections.length === 0 ? (
                  <NothingShown filter={filter} />
                ) : (
                  sections.sections.map((s) => (
                    <SectionView
                      key={s.key}
                      section={s}
                      open={openOverride[s.key] ?? s.startsOpen}
                      onToggle={() => setOpenOverride((o) => ({ ...o, [s.key]: !(o[s.key] ?? s.startsOpen) }))}
                      meId={meId}
                      names={names}
                      single={scope !== ALL_PANTRIES}
                      addHref={addHref}
                    />
                  ))
                )}
              </div>

              {/* From 900px: one table, soonest use-by first. */}
              <div className="hidden space-y-2 min-[900px]:block">
                {tableRows.length === 0 ? (
                  query.trim() ? (
                    <KCard className="p-6 text-center text-sm text-muted-foreground">No items match &ldquo;{query.trim()}&rdquo;.</KCard>
                  ) : (
                    <NothingShown filter={filter} />
                  )
                ) : (
                  <>
                    <ItemTable rows={shownRows} showPantry={scope === ALL_PANTRIES} />
                    {tableRows.length > shownRows.length ? (
                      <button
                        type="button"
                        onClick={() => setShowAll(true)}
                        className="min-h-11 rounded-xl px-3 text-sm font-bold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Show all {tableRows.length} items
                      </button>
                    ) : null}
                  </>
                )}
              </div>

              {sections.emptyHidden.length > 0 ? (
                <p className="text-[13px] text-muted-foreground">Empty pantries hidden: {sections.emptyHidden.join(", ")}.</p>
              ) : null}
              {items.data?.truncated ? (
                <p className="text-[13px] text-muted-foreground">Showing the first 1,000 items to use.</p>
              ) : null}
            </>
          )}
        </>
      )}
    </>
  );
}

function SectionView({
  section,
  open,
  onToggle,
  meId,
  names,
  single,
  addHref,
}: {
  section: PantrySection<ReachableItem>;
  open: boolean;
  onToggle: () => void;
  meId: string | null;
  names: MemberNames;
  single: boolean;
  addHref: string;
}) {
  const id = `pantry-section-${section.key}`;
  return (
    <section aria-labelledby={`${id}-name`} className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PantryBadge kind={section.pantry.kind} label={section.label} badge={section.badge} />
        <span className="min-w-0 flex-1">
          <span id={`${id}-name`} className="block truncate text-base font-extrabold">
            {section.label}
          </span>
          <span className="block text-xs text-muted-foreground">{section.meta}</span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        section.items.length === 0 ? (
          <KCard id={id} className="p-5 text-sm text-muted-foreground">
            {single && section.pantry.itemCount === 0 ? (
              <>
                Nothing in {section.pantry.kind === "personal" ? "your pantry" : `${section.label}'s pantry`} yet.{" "}
                <Link href={addHref} className="font-semibold text-primary underline-offset-2 hover:underline">
                  Add something
                </Link>
              </>
            ) : (
              "Nothing here matches."
            )}
          </KCard>
        ) : (
          <ul id={id} className="space-y-2">
            {section.items.map((item) => (
              <ItemCard key={item.id} row={itemRowView(item, { meId, names })} />
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

function NothingShown({ filter }: { filter: ItemFilter }) {
  const text =
    filter === "soon"
      ? "Nothing to use in the next few days."
      : filter === "expired"
        ? "Nothing is past its use-by date."
        : "Nothing here yet.";
  return <KCard className="p-6 text-center text-sm text-muted-foreground">{text}</KCard>;
}

function EmptyPantries() {
  return (
    <KCard className="flex flex-col items-center px-6 py-12 text-center">
      <IconBubble icon={Refrigerator} className="h-14 w-14" />
      <h2 className="mt-4 text-lg font-bold tracking-tight">Nothing in your pantries yet</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Add what you buy — to your own pantry or a group&apos;s — and see what to use first. Nobody is charged until
        someone uses it.
      </p>
      <Button asChild className={cn(K_BUTTON, "mt-5")}>
        <Link href="/pantry/new">
          <Plus aria-hidden />
          Add an item
        </Link>
      </Button>
    </KCard>
  );
}

function PantrySkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-14 w-full rounded-2xl min-[900px]:w-80" />
      <Skeleton className="h-10 w-64" />
      <div className="flex gap-2">
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}
