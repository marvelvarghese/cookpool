"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Refrigerator, Search } from "lucide-react";
import type { KitchenUsual, Pantry, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useProfile } from "@/components/kitchen/data";
import { IconBubble, KCard, K_BUTTON, K_INPUT } from "@/components/kitchen/kit";
import type { MemberNames } from "@/components/kitchen/members";
import { useMemberNames, useMyBalances } from "@/components/kitchen/people-data";
import { useLogUse, usePantries, usePantryItems, useUsuals } from "@/components/kitchen/pantry-data";
import { ItemTable, PantryListRowView } from "@/components/kitchen/pantry-ui";
import { ItemActionsSheet, type ItemMenuTarget } from "@/components/kitchen/item-actions-ui";
import { swipeUseLabel } from "@/components/kitchen/item-actions";
import type { SwipeAction } from "@/components/kitchen/row-gestures-ui";
import { rowUsual, usualFor } from "@/components/kitchen/quick-use";
import {
  ALL_PANTRIES,
  filterChips,
  itemRefOf,
  itemRowView,
  pantryChips,
  pantryKey,
  pantryListRow,
  pantryRows,
  pantrySummary,
  parseFilterParam,
  parsePantryParam,
  type ItemFilter,
  type PantrySummary,
} from "@/components/kitchen/pantry";

/** Rows the desktop table shows before "Show all N items". */
const TABLE_ROWS = 12;

/**
 * Pantry — all pantries (CP-12; on a phone, SM-10 as the canvas's "Simpler —
 * Pantry" draws it). On a phone: one row of chips — All · Soon · Expired,
 * then each pantry (tap one to see just it, again for all) — and one list,
 * soonest use-by first, each item one row: its name, what is left, one chip
 * when it is due soon or past its date, and its pantry's chip on All. The
 * row opens the item; Use logs your usual amount of it at once (with Undo),
 * or opens Use when you have none. From 900px (SM-15) the same row of chips
 * and a search, then one table (its worth and price per row); the picker and
 * "16 items · worth …" with its sentence are gone. `?pantry=` and `?filter=`
 * keep the choice in the address.
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
    <div className="space-y-4 min-[900px]:space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight min-[900px]:text-[30px]">Pantry</h1>
        <Link
          href={addHref}
          aria-label="Add an item"
          className="grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-[900px]:hidden"
        >
          <Plus className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden />
        </Link>
        <Button asChild className={cn(K_BUTTON, "hidden min-[900px]:inline-flex")}>
          <Link href={addHref}>
            <Plus aria-hidden />
            Add item
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
  addHref: string;
  onPantry: (key: string) => void;
  onFilter: (filter: ItemFilter) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  const loaded = items.data?.items ?? null;
  const usuals = useUsuals();

  // The phone's one list, soonest use-by first, every pantry together on All.
  const phoneRows = React.useMemo(
    () => (loaded ? pantryRows(loaded, { selected: scope, filter }) : []),
    [loaded, scope, filter],
  );
  const tableRows = React.useMemo(
    () => (loaded ? pantryRows(loaded, { selected: scope, filter, query }).map((i) => itemRowView(i, { meId, names })) : []),
    [loaded, scope, filter, query, meId, names],
  );
  const shownRows = showAll ? tableRows : tableRows.slice(0, TABLE_ROWS);
  const nothingAnywhere = summary.itemCount === 0 && scope === ALL_PANTRIES;
  const loading = items.loading || (!items.data && !items.error);
  const failed = !loading && (items.error || !loaded);
  const reload = (
    <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
      <p className="text-sm text-muted-foreground">Couldn&apos;t load the items. {items.error?.message ?? ""}</p>
      <Button variant="outline" className={K_BUTTON} onClick={items.reload}>
        Try again
      </Button>
    </KCard>
  );

  return (
    <>
      {/* ── Phones (SM-10): one row of chips, one list ── */}
      <div className="space-y-3 min-[900px]:hidden">
        {nothingAnywhere ? (
          <EmptyPantries />
        ) : (
          <>
            <PhoneChips
              filter={filter}
              summary={summary}
              pantries={pantryChips(list, recentSlugs)}
              scope={scope}
              onFilter={onFilter}
              onPantry={onPantry}
            />
            {loading ? (
              <div className="space-y-px overflow-hidden rounded-[20px] border bg-card" aria-hidden>
                <Skeleton className="h-16 w-full rounded-none" />
                <Skeleton className="h-16 w-full rounded-none" />
                <Skeleton className="h-16 w-full rounded-none" />
              </div>
            ) : failed ? (
              reload
            ) : phoneRows.length === 0 ? (
              <NothingShown filter={filter} pantry={scope === ALL_PANTRIES ? null : (list.find((p) => pantryKey(p) === scope) ?? null)} addHref={addHref} />
            ) : (
              <PhoneList rows={phoneRows} showPantry={scope === ALL_PANTRIES} usuals={usuals.data ?? null} meId={meId} names={names} />
            )}
          </>
        )}
      </div>

      {/* ── From 900px (SM-15): the phone's one row of chips and a search, then one table — no picker, no sentence ── */}
      <div className="hidden space-y-4 min-[900px]:block">
        {nothingAnywhere ? (
          <EmptyPantries />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <PhoneChips
                filter={filter}
                summary={summary}
                pantries={pantryChips(list, recentSlugs)}
                scope={scope}
                onFilter={(next) => {
                  setShowAll(false);
                  onFilter(next);
                }}
                onPantry={(key) => {
                  setShowAll(false);
                  onPantry(key);
                }}
              />
              <div className="relative min-w-60 flex-1">
                <label htmlFor="pantry-search" className="sr-only">
                  Search items
                </label>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="pantry-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search items"
                  autoComplete="off"
                  className={cn(K_INPUT, "bg-card pl-11")}
                />
              </div>
            </div>
            {loading ? (
              <div className="space-y-2" aria-hidden>
                <Skeleton className="h-14 w-full rounded-2xl" />
                <Skeleton className="h-14 w-full rounded-2xl" />
              </div>
            ) : failed ? (
              reload
            ) : tableRows.length === 0 ? (
              query.trim() ? (
                <KCard className="p-6 text-center text-sm text-muted-foreground">No items match &ldquo;{query.trim()}&rdquo;.</KCard>
              ) : (
                <NothingShown filter={filter} pantry={null} addHref={addHref} />
              )
            ) : (
              <div className="space-y-2">
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
              </div>
            )}
          </>
        )}
      </div>

      {items.data?.truncated ? <p className="text-[13px] text-muted-foreground">Showing the first 1,000 items.</p> : null}
    </>
  );
}

/**
 * The phone's one row of chips (SM-10): what to show — All · Soon · N ·
 * Expired · N — then the pantries, yours first; a pantry chip narrows the
 * list to it, and a second tap goes back to all of them. It scrolls sideways,
 * without a scrollbar.
 */
function PhoneChips({
  filter,
  summary,
  pantries,
  scope,
  onFilter,
  onPantry,
}: {
  filter: ItemFilter;
  summary: PantrySummary;
  pantries: readonly { key: string; label: string }[];
  scope: string;
  onFilter: (filter: ItemFilter) => void;
  onPantry: (key: string) => void;
}) {
  const chip = (on: boolean) =>
    cn(
      "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      on ? "border-foreground bg-foreground font-bold text-background" : "border-input bg-card font-semibold hover:bg-accent",
    );
  return (
    <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:overflow-visible min-[900px]:px-0">
      <div role="group" aria-label="Show" className="flex shrink-0 gap-2">
        {filterChips(summary).map((c) => (
          <button key={c.id} type="button" aria-pressed={c.id === filter} onClick={() => onFilter(c.id)} className={chip(c.id === filter)}>
            {c.label}
          </button>
        ))}
      </div>
      {pantries.length > 1 ? (
        <div role="group" aria-label="Pantry" className="flex shrink-0 gap-2 border-l pl-2">
          {pantries.map((p) => {
            const on = p.key === scope;
            return (
              <button key={p.key} type="button" aria-pressed={on} onClick={() => onPantry(on ? ALL_PANTRIES : p.key)} className={chip(on)}>
                {p.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The phone's list: one row per item; Use logs your usual of it for you, at
 * once, with Undo. PW-8: swiping a row left does exactly what its Use does
 * (logs the usual, or opens Use), and holding a row opens its menu.
 */
function PhoneList({
  rows,
  showPantry,
  usuals,
  meId,
  names,
}: {
  rows: readonly ReachableItem[];
  showPantry: boolean;
  usuals: readonly KitchenUsual[] | null;
  meId: string | null;
  names: MemberNames;
}) {
  const logUse = useLogUse();
  const router = useRouter();
  const [menu, setMenu] = React.useState<ItemMenuTarget | null>(null);
  return (
    <>
      <ul className="divide-y overflow-hidden rounded-[20px] border bg-card">
        {rows.map((item) => {
          // Your usual in its words ("2 onions"), logged in its measure (SM-15).
          const usual = rowUsual(usualFor(item.id, usuals), item);
          const row = pantryListRow(item, {
            showPantry,
            usualQtyMilli: usual?.qtyMilli ?? null,
            usualWords: usual?.words ?? null,
          });
          const use = row.use;
          const onLog =
            use?.kind === "log" && meId
              ? () =>
                  void logUse({
                    ref: itemRefOf(item),
                    item,
                    qtyMilli: use.qtyMilli,
                    consumers: [meId],
                    idempotencyKey: crypto.randomUUID(),
                    what: use.words,
                    measure: usual?.measure ?? null,
                    meId,
                    names,
                  })
              : null;
          // The swipe is the Use button's twin: the same write and Undo toast, or Use opened (no write).
          const swipe: SwipeAction | null =
            use?.kind === "log"
              ? onLog
                ? { label: swipeUseLabel(use.words), tone: "use", run: onLog }
                : null
              : use
                ? { label: swipeUseLabel(null), tone: "use", run: () => router.push(use.href) }
                : null;
          return (
            <PantryListRowView
              key={item.id}
              row={row}
              onLog={onLog}
              swipe={swipe}
              onLongPress={() =>
                setMenu({
                  name: item.name,
                  ref: itemRefOf(item),
                  item,
                  use: use?.kind === "log" && onLog ? { words: use.words, run: onLog } : null,
                })
              }
            />
          );
        })}
      </ul>
      <ItemActionsSheet target={menu} onClose={() => setMenu(null)} meId={meId} />
    </>
  );
}

function NothingShown({ filter, pantry, addHref }: { filter: ItemFilter; pantry: Pantry | null; addHref: string }) {
  if (filter === "all" && pantry && pantry.itemCount === 0) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-[15px] font-semibold">Nothing here yet</p>
        <Button asChild className={K_BUTTON}>
          <Link href={addHref}>
            <Plus aria-hidden />
            Add
          </Link>
        </Button>
      </KCard>
    );
  }
  const text = filter === "soon" ? "Nothing to use soon" : filter === "expired" ? "Nothing expired" : "Nothing here yet";
  return <KCard className="p-6 text-center text-[15px] font-semibold text-muted-foreground">{text}</KCard>;
}

function EmptyPantries() {
  return (
    <KCard className="flex flex-col items-center px-6 py-10 text-center">
      <IconBubble icon={Refrigerator} className="h-14 w-14" />
      <h2 className="mt-4 text-lg font-bold tracking-tight">Nothing in your pantries yet</h2>
      <Button asChild className={cn(K_BUTTON, "mt-4")}>
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
    <div className="space-y-3" aria-hidden>
      <Skeleton className="hidden h-14 w-80 rounded-2xl min-[900px]:block" />
      <div className="flex gap-2">
        <Skeleton className="h-11 w-16 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <Skeleton className="h-16 w-full rounded-[20px]" />
      <Skeleton className="h-16 w-full rounded-[20px]" />
    </div>
  );
}
