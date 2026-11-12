"use client";

import * as React from "react";
import Link from "./link";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus, Refrigerator, Search } from "lucide-react";
import type { PantryRef, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useProfile } from "./data";
import { IconBubble, KCard, K_BUTTON, K_BUTTON_QUIET, K_ROWS, K_SECTION } from "./kit";
import { RING, SeeAllButton } from "./new-home-parts-ui";
import { sectionRows, usualNowRows } from "./pantry-look";
import { useMemberNames, useMyRoles } from "./people-data";
import { usePantries, usePantryItems, useUsualBucket, useUsuals } from "./pantry-data";
import { USUAL_BUCKET_LABELS } from "@saas/contracts/kitchen-usuals";
import { usualFor } from "./quick-use";
import { PERSONAL_PANTRY, pantryChips, pantryKey } from "./pantry";
import { addItemHref, boughtHref, pantrySections, parseOpenParam, parseShow, pantryRow, showParams, type PantryRow, type PantryShow } from "./pantry-list";
import { tickPickedText } from "./tick-row";
import { KitchenLogBar, KitchenTickRow, kitchenTickAmount, pickable, useKitchenTicks, useLogPicks } from "./kitchen-tick-ui";
import type { PickLine } from "./kitchen-picks";
import { useCookSession } from "@/lib/cook-session-store";
import { sessionBarShows } from "./cook-session";
import { useMinWidth } from "./use-min-width";
import { useAsks, useMinuteNow } from "./ask-data";
import { askName, askStatus } from "./ask-before-use";
import { useRestock } from "./restock-data";
import { finishedRows, nameKeyOf, type FinishedRow } from "./restock";
import { useSayItShows } from "./say-it-data";
// The title switcher, Say it in the search, Always have per pantry and the shopping list (RV-21).
import { ALL_VIEW, KITCHEN_VIEW_KEY, kitchenTitle, parseView, shoppingCount, staplePantryOf, switcherOptions, viewShow } from "./kitchen-staples";
import { useStapleActions, useStaples } from "./kitchen-staples-data";
import { FinishedToList, PantrySwitcher, ShoppingListLink, StaplesCard } from "./kitchen-staples-ui";
import { useSayIntoTicks } from "./kitchen-say-ui";

type Row = PantryRow & { item: ReachableItem };

/**
 * The Pantry in the new frame (cookpool-pantry PN-5, design §1, §3, the
 * canvas's PantryNew). Top to bottom: "Pantry" with + Groceries; the search,
 * on phones too (`?q=` fills it, `?focus=1` focuses it);
 * the Now strip; the chips with their counts (`?filter=`, `?pantry=`); the
 * use-soon card; the sections; Finished this week (Add to list, then Undo);
 * and Always have. + Groceries opens the shopping run from the list (RV-24).
 *
 * Since RV-10 (the canvas's RvKitchen "Tick to log") every row is a tick
 * row: the name with its last use, the usual amount in grey with its unit,
 * and a tick. "Usual now · Morning" takes the Now strip's place. `?open=`
 * still shows (and scrolls to) the row it names.
 *
 * Since RV-13 (the board's "Tick to pick, Log once"): a tick only picks the
 * row, and one Log button above the tab bar logs every picked row with one
 * Undo. The list is flat — Usual now, then one section per pantry (each
 * group by its name, then yours as "Mine"), three rows and See all, with the
 * picked count on the right — never folding and never by kind.
 *
 * Since RV-21 (the board RvKitchenB): the title is the switcher — "Kitchen ▾"
 * (All) or "<pantry> ▾" opens a sheet of All kitchens and each pantry, kept
 * on the device. All is Usual now, then each pantry (three rows, and See all
 * switches to it) with its Always have; one pantry is all its rows ("Items")
 * and its Always have. The header has the shopping list with its count and
 * + Groceries (the shopping run). Say what you used is the ✦ inside the
 * search: Enter reads the sentence and ticks the rows it names. Use soon sits
 * in the rows (first, amber or red) with a stock bar under each name; the
 * filter chips and the Use soon strip are gone. Finished this week's button
 * adds the item to its pantry's shopping list.
 */
export function NewPantry() {
  const pathname = usePathname();
  const params = useSearchParams();
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const names = useMemberNames();
  const pantries = usePantries();
  // Say what you used (cookpool-ai AI-7): since RV-21 the ✦ inside the search, when AI is available and the switch is on.
  const sayShows = useSayItShows();
  const items = usePantryItems("all");
  const usuals = useUsuals();
  const bucket = useUsualBucket();
  const recentSlugs = useRecentGroupSlugs();
  const ticks = useKitchenTicks();
  const logPicks = useLogPicks(ticks, { meId, names });
  // The cooking bar (RC-6) sits where the Log button would: the button goes above it while it shows.
  const cookSession = useCookSession(meId);
  const wide = useMinWidth(900);
  const sessionUp = !wide && sessionBarShows(pathname, cookSession);
  // Ask before use (cookpool-pantry PN-9): your asks, for the rows that must ask.
  const asks = useAsks();
  const mine = asks.data?.mine ?? null;
  const askNow = useMinuteNow();
  const restock = useRestock();
  const staples = useStaples();
  const stapleActions = useStapleActions();
  const { roles } = useMyRoles();
  const [now] = React.useState(() => new Date());

  const list = pantries.data;
  // The title's choice (RV-21): `?pantry=` on arrival, else what this device kept; `?filter=` still narrows All.
  const linked = parseShow(params?.get("filter"), params?.get("pantry"));
  const [kept, keep] = useKitchenView();
  const view = parseView(linked.kind === "pantry" ? linked.key : kept, list);
  const show: PantryShow = view === ALL_VIEW && linked.kind !== "pantry" ? linked : viewShow(view);
  const [query, setQuery] = React.useState(() => params?.get("q") ?? "");
  const [sayMode, setSayMode] = React.useState(false);
  const [said, setSaid] = React.useState("");
  const openItemId = parseOpenParam(params?.get("open"))?.itemId ?? null;
  const [openId, setOpenId] = React.useState<string | null>(openItemId);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const focus = params?.get("focus") === "1";

  // `?focus=1` and `?open=` are for arriving (Home's field, /use): used once, then dropped from the address.
  const dropParam = React.useCallback((name: string) => {
    const at = new URLSearchParams(window.location.search);
    if (!at.has(name)) return;
    at.delete(name);
    const qs = at.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);
  React.useEffect(() => {
    if (!focus) return;
    searchRef.current?.focus();
    dropParam("focus");
  }, [focus, dropParam]);
  React.useEffect(() => {
    if (openItemId) setOpenId(openItemId);
  }, [openItemId]);

  // Picking a pantry switches at once, is kept on the device and drops `?pantry=` / `?filter=` from the address.
  const choose = (next: string) => {
    keep(next);
    setOpenId(null);
    const qs = showParams({ kind: "all" }, new URLSearchParams(window.location.search)).toString();
    window.history.replaceState(window.history.state, "", `${pathname ?? "/pantry"}${qs ? `?${qs}` : ""}`);
    window.scrollTo({ top: 0 });
  };

  const loaded = items.data?.items ?? null;
  const usualList = usuals.data;
  const showPantry = (list?.length ?? 0) > 1 && show.kind !== "pantry";
  const rows: Row[] = React.useMemo(
    () => (loaded ?? []).map((item) => ({ ...pantryRow(item, { usual: usualFor(item.id, usualList), showPantry, meId, names, askName: askName(item, { names }) }), item })),
    [loaded, usualList, showPantry, meId, names],
  );
  const searching = !sayMode && query.trim() !== "";
  const q = sayMode ? "" : query;
  // Usual now (RV-10): on All only.
  const usualNow = bucket ? usualNowRows(rows, usualList, { show, query: q }) : [];
  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const order = React.useMemo(() => (list ? pantryChips(list, recentSlugs).map((p) => p.key) : []), [list, recentSlugs]);
  const sections = pantrySections(rows, { show, query: q, order, exclude: new Set(usualNow.map((r) => r.id)) });
  const options = list ? switcherOptions({ pantries: list, rows, staples: staples.data, view, order }) : [];
  const title = kitchenTitle(view, list);
  // What the Log button logs: the picked rows, in the order they were picked.
  const pickedRows = [...ticks.picked].flatMap((id) => {
    const r = byId.get(id);
    return r && pickable(r, kitchenTickAmount(r, ticks)) ? [r] : [];
  });
  const pickLines: PickLine[] = pickedRows.map((r) => {
    const a = kitchenTickAmount(r, ticks)!;
    return { id: r.id, name: r.name, number: a.number, word: a.word };
  });
  const pickedIn = (of: readonly Row[]) => tickPickedText(of.filter((r) => ticks.picked.has(r.id)).length);

  // Say what you used (RV-21): the read ticks the rows it names, with the amounts said.
  const sayRows = React.useMemo(() => new Map(rows.map((r) => [r.id, { item: r.item, pickable: pickable(r, kitchenTickAmount(r, ticks)) }] as const)), [rows, ticks]);
  const say = useSayIntoTicks({ rows: sayRows, setBox: ticks.setBox, setPicked: ticks.setPicked });

  // Finished this week (PN-6): "Add to list" puts the name on its pantry's shopping list (RV-21).
  const finished = finishedRows(restock.data, { show, query: q, now });
  const listedName = (pantry: PantryRef, name: string) => {
    const p = staplePantryOf(staples.data, pantryKey(pantry));
    const key = nameKeyOf(name);
    return !!p && (p.items.some((i) => nameKeyOf(i.name) === key) || p.staples.some((s) => s.status !== "ok" && nameKeyOf(s.name) === key));
  };
  const finishedSection =
    view === ALL_VIEW && !searching ? (
      <FinishedToList
        rows={finished}
        listed={(f: FinishedRow) => listedName(f.line.pantry, f.name)}
        onAdd={(f: FinishedRow) => {
          const p = staplePantryOf(staples.data, pantryKey(f.line.pantry));
          if (p) void stapleActions.addToList(p, f.name);
        }}
        onUndo={(f: FinishedRow) => {
          const p = staplePantryOf(staples.data, pantryKey(f.line.pantry));
          const key = nameKeyOf(f.name);
          const item = p?.items.find((i) => nameKeyOf(i.name) === key && !i.id.startsWith("pending:"));
          return p && item ? () => void stapleActions.removeFromList(p, item) : null;
        }}
      />
    ) : null;

  // The row `?open=` names, scrolled to once it is listed.
  const scrolled = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!openItemId || scrolled.current === openItemId || !byId.has(openItemId)) return;
    scrolled.current = openItemId;
    window.requestAnimationFrame(() => document.querySelector(`[data-row-id="${openItemId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    dropParam("open");
  }, [openItemId, byId, dropParam]);

  const rowFor = (r: Row) => (
    <KitchenTickRow
      key={r.id}
      row={r}
      usual={usualFor(r.id, usualList)}
      ticks={ticks}
      meId={meId}
      names={names}
      now={now}
      askName={askName(r.item, { names })}
      askStatus={askStatus(r.id, mine, { now: askNow, names })}
    />
  );
  // A pantry's Always have, under its rows; not while searching.
  const staplesFor = (key: string) => {
    if (searching) return null;
    const p = staplePantryOf(staples.data, key);
    if (!p) return null;
    const canEdit = p.owner.kind === "personal" || roles.get(p.owner.orgId) !== "viewer";
    return <StaplesCard pantry={p} meId={meId} names={names} canEdit={canEdit} />;
  };

  const loading = pantries.loading || items.loading || (!items.data && !items.error);
  const failed = !loading && (pantries.error || items.error || !list || !loaded);
  const nothingAnywhere = !loading && !failed && rows.length === 0 && view === ALL_VIEW;
  // The pantries' sections: on All every pantry (its rows, three then See all, which switches to it, then its
  // staples); on one pantry, "Items" with all its rows, then its staples. A pantry with no rows still shows its staples.
  const keys = view === ALL_VIEW ? (show.kind === "all" ? orderedKeys(order) : sections.map((s) => s.key)) : [view];
  const listCount = shoppingCount(staples.data);

  return (
    <div className="space-y-5 min-[900px]:max-w-[760px]">
      <header className="flex items-center gap-2">
        <PantrySwitcher title={title} options={options} onPick={choose} />
        <ShoppingListLink count={listCount} />
        <Link
          href={boughtHref()}
          className={cn("flex min-h-11 shrink-0 items-center gap-1.5 rounded-[14px] bg-primary pl-3 pr-3.5 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90", RING)}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
          Groceries
        </Link>
      </header>

      <div className={cn("flex min-h-[52px] items-center gap-2.5 rounded-[18px] pr-1 shadow-cp-card focus-within:ring-2 focus-within:ring-ring", sayMode ? "bg-cp-accent-tint pl-4" : "bg-card pl-3.5")}>
        {sayMode ? null : <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
        <label htmlFor="kitchen-field" className="sr-only">
          {sayMode ? "Say what you used, Cookpool AI" : "Find in your kitchen"}
        </label>
        <input
          id="kitchen-field"
          ref={searchRef}
          type={sayMode ? "text" : "search"}
          value={sayMode ? said : query}
          onChange={(e) => {
            if (sayMode) setSaid(e.target.value);
            else {
              setQuery(e.target.value);
              setOpenId(null);
            }
          }}
          onKeyDown={(e) => {
            if (!sayMode) return;
            if (e.key === "Enter" && !say.reading) void say.go(said).then((ok) => ok && setSaid(""));
            if (e.key === "Escape") {
              setSayMode(false);
              setSaid("");
            }
          }}
          placeholder={sayMode ? "Say what you used" : "Find an item"}
          aria-busy={say.reading || undefined}
          autoComplete="off"
          enterKeyHint={sayMode ? "go" : "search"}
          className={cn("h-11 min-w-0 flex-1 bg-transparent text-base font-normal text-foreground outline-none", sayMode ? "placeholder:text-cp-accent-text" : "placeholder:text-muted-foreground")}
        />
        {sayShows ? (
          <button
            type="button"
            aria-pressed={sayMode}
            aria-label="Say what you used"
            onClick={() => {
              setSayMode((m) => !m);
              setSaid("");
              setQuery("");
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
            className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-[14px]", sayMode ? "bg-primary text-primary-foreground" : "text-cp-accent-text", RING)}
          >
            <Sparkle on={sayMode} />
          </button>
        ) : null}
      </div>

      {loading ? (
        <PantrySkeleton />
      ) : failed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm font-normal text-muted-foreground">Couldn&apos;t load your kitchen. {(pantries.error ?? items.error)?.message ?? ""}</p>
          <Button
            variant="outline"
            className={K_BUTTON_QUIET}
            onClick={() => {
              pantries.reload();
              items.reload();
            }}
          >
            Try again
          </Button>
        </KCard>
      ) : nothingAnywhere ? (
        <>
          <EmptyPantries />
          {finishedSection}
        </>
      ) : (
        <>
          {bucket && usualNow.length > 0 ? (
            <section aria-labelledby="pantry-usual-now" className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="pantry-usual-now" className={K_SECTION}>
                  Usual now <span className="font-normal text-muted-foreground">· {USUAL_BUCKET_LABELS[bucket]}</span>
                </h2>
                <span className="text-[13px] font-normal text-muted-foreground">{pickedIn(usualNow)}</span>
              </div>
              <div className={K_ROWS}>
                <ul className="divide-y divide-cp-line">{usualNow.map((r) => rowFor(r))}</ul>
              </div>
            </section>
          ) : null}

          {(searching || show.kind === "soon" || show.kind === "low") && sections.length === 0 ? (
            <NothingShown show={show} query={query} where={view === ALL_VIEW ? null : title} />
          ) : (
            keys.map((key) => {
              const s = sections.find((x) => x.key === key) ?? null;
              const card = staplesFor(key);
              if (!s && !card) return null;
              const all = view !== ALL_VIEW;
              const label = all ? "Items" : (s?.label ?? kitchenTitle(key, list));
              const headingId = `pantry-section-${key}`;
              const shownRows = s ? (all ? { rows: s.rows, more: false, label: "" } : sectionRows(s.rows, { all: false, searching, openId })) : null;
              return (
                <section key={key} aria-labelledby={headingId} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 id={headingId} className={cn(K_SECTION, "min-w-0 truncate")}>
                      {label} <span className="font-normal tabular-nums text-muted-foreground">· {s?.count ?? 0}</span>
                    </h2>
                    <span className="shrink-0 text-[13px] font-normal text-muted-foreground">{s ? pickedIn(s.rows) : ""}</span>
                  </div>
                  {s && shownRows && shownRows.rows.length > 0 ? (
                    <div className={K_ROWS}>
                      <ul className="divide-y divide-cp-line">{shownRows.rows.map((r) => rowFor(r))}</ul>
                      {shownRows.more ? <SeeAllButton label={`See all ${s.count}`} all={false} onToggle={() => choose(key)} /> : null}
                    </div>
                  ) : null}
                  {card}
                </section>
              );
            })
          )}

          {/* Finished this week (PN-6), on All. */}
          {finishedSection}

          {items.data?.truncated ? <p className="text-[13px] font-normal text-muted-foreground">Showing the first 1,000 items.</p> : null}
        </>
      )}

      <KitchenLogBar lines={pickLines} onLog={() => logPicks(pickedRows)} aboveSessionBar={sessionUp} />
    </div>
  );
}

/** Every pantry's key in the sections' order: the groups as `order` has them, then yours ("Mine") last. */
function orderedKeys(order: readonly string[]): string[] {
  return [...order.filter((k) => k !== PERSONAL_PANTRY), ...(order.includes(PERSONAL_PANTRY) ? [PERSONAL_PANTRY] : [])];
}

/** The board's sparkle, filled while Say what you used is on. */
function Sparkle({ on }: { on: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

/** The device's kept choice of pantry (RV-21), "all" until one is picked. */
function useKitchenView(): [string, (next: string) => void] {
  const [value, setValue] = React.useState<string>(ALL_VIEW);
  React.useEffect(() => {
    try {
      const kept = window.localStorage.getItem(KITCHEN_VIEW_KEY);
      if (kept) setValue(kept);
    } catch {
      // Storage blocked: All.
    }
  }, []);
  const keep = React.useCallback((next: string) => {
    setValue(next);
    try {
      window.localStorage.setItem(KITCHEN_VIEW_KEY, next);
    } catch {
      // Storage blocked: kept for this visit only.
    }
  }, []);
  return [value, keep];
}

function NothingShown({ show, query, where = null }: { show: PantryShow; query: string; where?: string | null }) {
  const q = query.trim();
  const text = q
    ? `Nothing called “${q}”${where ? ` in ${where}` : ""}`
    : show.kind === "soon"
      ? "Nothing to use soon"
      : show.kind === "low"
        ? "Nothing running low"
        : "Nothing here yet";
  // The board's no match: one centred muted line. An empty pantry keeps a quiet way to fill it.
  if (q) {
    return (
      <p role="status" className="px-1 py-[18px] text-center text-[15px] font-normal text-muted-foreground">
        {text}
      </p>
    );
  }
  return (
    <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="min-w-0 text-[15px] font-normal text-muted-foreground">{text}</p>
      {show.kind === "pantry" ? (
        <Button asChild variant="ghost" className={K_BUTTON_QUIET}>
          <Link href={addItemHref(show)}>
            <Plus aria-hidden />
            Groceries
          </Link>
        </Button>
      ) : null}
    </KCard>
  );
}

function EmptyPantries() {
  return (
    <KCard className="flex flex-col items-center px-6 py-10 text-center">
      <IconBubble icon={Refrigerator} className="h-14 w-14" />
      <h2 className={cn(K_SECTION, "mt-4")}>Nothing in your kitchen yet</h2>
      <Button asChild className={cn(K_BUTTON, "mt-4")}>
        <Link href="/pantry/new">
          <Plus aria-hidden />
          Add groceries
        </Link>
      </Button>
    </KCard>
  );
}

function PantrySkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex gap-2">
        <Skeleton className="h-[76px] w-28 rounded-2xl" />
        <Skeleton className="h-[76px] w-28 rounded-2xl" />
        <Skeleton className="h-[76px] w-28 rounded-2xl" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-11 w-16 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <Skeleton className="h-40 w-full rounded-cp-card" />
    </div>
  );
}
