"use client";

import * as React from "react";
import Link from "./link";
import { usePathname, useSearchParams } from "next/navigation";
import { Camera, ChevronDown, Plus, Refrigerator, Search } from "lucide-react";
import type { KitchenItem, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useFoldedSections } from "@/lib/pantry-device";
import { useProfile } from "./data";
import { IconBubble, KCard, K_BUTTON, K_BUTTON_QUIET, K_ROWS, K_SECTION, K_TITLE } from "./kit";
import { RING, SeeAllButton, pillClass } from "./new-home-parts-ui";
import { sectionRows, useSoonTiles, type UseSoonTile } from "./pantry-look";
import { useMemberNames } from "./people-data";
import { useLogUse, usePantries, usePantryItems, useUsualBucket, useUsuals } from "./pantry-data";
import { useLogSeveral } from "./log-several-data";
import { AlwaysHaveCard } from "./always-have-ui";
import { usualFor } from "./quick-use";
import { itemRefOf } from "./pantry";
import {
  addItemHref,
  boughtHref,
  kindSections,
  parseOpenParam,
  parseShow,
  pantryRow,
  sectionOpen,
  showChips,
  showParams,
  toggleFold,
  type PantryRow,
  type PantryShow,
} from "./pantry-list";
import { inTray, nowStrip, toggleTray, type NowChip, type TrayEntry } from "./now-strip";
import { PantryRowView } from "./pantry-row-ui";
import { LogTray, NowStripView } from "./now-strip-ui";
import { UseSheet, type UseSheetTarget } from "./use-sheet-ui";
import { useAsks, useMinuteNow } from "./ask-data";
import { askName, askStatus } from "./ask-before-use";
import { localIsoDay } from "./item-form";
import { useRestock } from "./restock-data";
import { useBuyAgain } from "./buy-again-data";
import { boughtAgainItem, finishedOpen, finishedRows, itemRestockKey, restockKey, toggleFinishedFold, type BoughtAgainSource, type FinishedRow } from "./restock";
import { FinishedThisWeek } from "./finished-ui";
import { useReceiptScanShows } from "./receipt-data";
import { RECEIPT_SCAN_HREF } from "./receipt-run";
import { useSayItShows } from "./say-it-data";
import { SayItBox, SayItSheet } from "./say-it-ui";

type Row = PantryRow & { item: ReachableItem };

/**
 * The Pantry in the new frame (cookpool-pantry PN-5, design §1, §3, the
 * canvas's PantryNew). Top to bottom: "Pantry" with + Bought; the search,
 * on phones too (`?q=` fills it, `?focus=1` focuses it), with Log several;
 * the Now strip; the chips with their counts (`?filter=`, `?pantry=`); the
 * use-soon card; the sections by kind, each folding on a tap (remembered on
 * the device); Finished this week (PN-6: Bought again, like last time); and
 * Always have. A row opens in place (`?open=` opens one), one at a time; its
 * chip logs in one tap. + Bought opens the shopping run (PN-6).
 */
export function NewPantry() {
  const pathname = usePathname();
  const params = useSearchParams();
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const names = useMemberNames();
  const pantries = usePantries();
  // Scan a receipt (cookpool-ai AI-8): a camera beside + Bought, when AI is available and the switch is on.
  const scanShows = useReceiptScanShows();
  // Say what you used (cookpool-ai AI-7): the box at the top, when AI is available and the switch is on.
  const sayShows = useSayItShows();
  const [sayOpen, setSayOpen] = React.useState(false);
  const items = usePantryItems("all");
  const usuals = useUsuals();
  const bucket = useUsualBucket();
  const recentSlugs = useRecentGroupSlugs();
  const logUse = useLogUse();
  const logSeveral = useLogSeveral();
  const [folded, setFolded] = useFoldedSections();
  // Ask before use (cookpool-pantry PN-9): your asks, for the rows that must ask.
  const asks = useAsks();
  const mine = asks.data?.mine ?? null;
  const askNow = useMinuteNow();
  const restock = useRestock();
  const buyAgain = useBuyAgain();
  const [now] = React.useState(() => new Date());

  const showParam = parseShow(params?.get("filter"), params?.get("pantry"));
  const [show, setShow] = React.useState<PantryShow>(showParam);
  const showKey = JSON.stringify(showParam);
  React.useEffect(() => setShow(JSON.parse(showKey) as PantryShow), [showKey]);
  const [query, setQuery] = React.useState(() => params?.get("q") ?? "");
  const openItemId = parseOpenParam(params?.get("open"))?.itemId ?? null;
  const [openId, setOpenId] = React.useState<string | null>(openItemId);
  const [several, setSeveral] = React.useState(false);
  const [tray, setTray] = React.useState<TrayEntry[]>([]);
  const [sheet, setSheet] = React.useState<UseSheetTarget | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const focus = params?.get("focus") === "1";

  // `?focus=1` and `?open=` are for arriving (Home's field, /use): used once, then dropped from the address.
  const dropParam = React.useCallback((name: string) => {
    const now = new URLSearchParams(window.location.search);
    if (!now.has(name)) return;
    now.delete(name);
    const qs = now.toString();
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

  // The choice switches at once and is mirrored into the address without a navigation.
  const choose = (next: PantryShow) => {
    setShow(next);
    setOpenId(null);
    const qs = showParams(next, new URLSearchParams(window.location.search)).toString();
    window.history.replaceState(window.history.state, "", `${pathname ?? "/pantry"}${qs ? `?${qs}` : ""}`);
  };

  const list = pantries.data;
  const loaded = items.data?.items ?? null;
  const usualList = usuals.data;
  const showPantry = (list?.length ?? 0) > 1 && show.kind !== "pantry";
  const rows: Row[] = React.useMemo(
    () => (loaded ?? []).map((item) => ({ ...pantryRow(item, { usual: usualFor(item.id, usualList), showPantry, meId, names, askName: askName(item, { names }) }), item })),
    [loaded, usualList, showPantry, meId, names],
  );
  const statuses = React.useMemo(() => new Map(rows.map((r) => [r.id, r.status] as const)), [rows]);
  const searching = query.trim() !== "";
  const sections = kindSections(rows, { show, query });
  const chips = list ? showChips({ items: rows.map((r) => r.item), statuses, pantries: list, recentSlugs, show }) : [];
  // Use soon (RV-3, the board's strip of three): past its date first, then the soonest.
  const soon = useSoonTiles(rows, { show, query });
  const [allIn, setAllIn] = React.useState<ReadonlySet<string>>(() => new Set());
  const strip = searching ? [] : nowStrip(rows, usualList);
  const byId = React.useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);
  const finished = finishedRows(restock.data, { show, query, now });
  const groupPolicy = (orgId: string) => {
    const p = (list ?? []).find((x) => x.kind === "group" && x.orgId === orgId);
    return p?.kind === "group" ? p.wastePolicy : null;
  };
  // Bought again is PN-7's one-line purchase (`useBuyAgain`), like the item given.
  const buyLike = (item: KitchenItem) => void buyAgain({ ref: itemRefOf(item), item, meId, today: localIsoDay(new Date()), idempotencyKey: crypto.randomUUID() });
  const lineItem = (line: BoughtAgainSource) =>
    boughtAgainItem(line, { today: localIsoDay(new Date()), groupWastePolicy: line.pantry.kind === "group" ? groupPolicy(line.pantry.orgId) : null });
  // A running-low row's More… sheet offers Bought again: like the restock read's latest purchase of it, else like the item itself.
  const buyAgainFor = (r: Row): KitchenItem | null => {
    if (!r.status.low || r.pending) return null;
    const key = itemRestockKey(r.item);
    const line = restock.data?.runningLow.find((l) => l.why.itemId === r.id) ?? restock.data?.runningLow.find((l) => restockKey(l) === key);
    if (line) return line.canAdd ? lineItem(line) : null;
    return r.canUse ? r.item : null;
  };
  const finishedSection = (
    <FinishedThisWeek
      rows={finished}
      open={finishedOpen(folded, searching)}
      onFold={() => setFolded(toggleFinishedFold(folded))}
      onBought={(f: FinishedRow) => buyLike(lineItem(f.line))}
    />
  );

  // The row `?open=` names, scrolled to once it is listed.
  const scrolled = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!openItemId || scrolled.current === openItemId || !byId.has(openItemId)) return;
    scrolled.current = openItemId;
    window.requestAnimationFrame(() => document.querySelector(`[data-row-id="${openItemId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    dropParam("open");
  }, [openItemId, byId, dropParam]);

  const entryOf = (r: Row): TrayEntry | null => (r.ladder.suggestion ? { itemId: r.id, ref: itemRefOf(r.item), item: r.item, name: r.name, step: r.ladder.suggestion.step } : null);
  const logChip = (r: Row) => {
    if (r.chip?.kind !== "log" || !r.ladder.suggestion) return;
    const entry = entryOf(r);
    if (several) {
      if (entry) setTray((t) => toggleTray(t, entry));
      return;
    }
    const step = r.ladder.suggestion.step;
    void logUse({
      ref: r.ref,
      item: r.item,
      qtyMilli: step.qtyMilli,
      consumers: r.chip.consumers,
      idempotencyKey: crypto.randomUUID(),
      what: step.words,
      measure: step.amount.kind === "measure" ? { measure: step.amount.measure, quantity: step.amount.quantity } : null,
      meId,
      names,
    });
  };
  const onStripChip = (c: NowChip) => {
    const r = byId.get(c.id);
    if (r) logChip(r);
  };
  const toggleSeveral = () => {
    setSeveral((on) => !on);
    setTray([]);
  };

  const loading = pantries.loading || items.loading || (!items.data && !items.error);
  const failed = !loading && (pantries.error || items.error || !list || !loaded);
  const nothingAnywhere = !loading && !failed && rows.length === 0;

  return (
    <div className="space-y-5 min-[900px]:max-w-[760px]">
      <header className="flex items-center justify-between gap-3">
        <h1 className={K_TITLE}>Kitchen</h1>
        <span className="flex items-center gap-2">
          {scanShows ? (
            <Link
              href={RECEIPT_SCAN_HREF}
              aria-label="Scan a receipt"
              className={cn("grid h-11 w-11 place-items-center rounded-[14px] bg-cp-accent-tint text-cp-accent-text transition-colors hover:bg-cp-accent-tint/80", RING)}
            >
              <Camera className="h-5 w-5" strokeWidth={2.2} aria-hidden />
            </Link>
          ) : null}
          <Link
            href={boughtHref()}
            className={cn("flex min-h-11 items-center gap-1.5 rounded-[14px] bg-primary px-4 text-[15px] font-medium text-primary-foreground transition-colors hover:bg-primary/90", RING)}
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
            Bought
          </Link>
        </span>
      </header>

      {sayShows ? <SayItBox onOpen={() => setSayOpen(true)} /> : null}
      {/* Kept while open, so a refusal that hides the entry (no key, the budget) is still read. */}
      {sayShows || sayOpen ? (
        <SayItSheet
          open={sayOpen}
          onClose={() => setSayOpen(false)}
          meId={meId}
          onByHand={() => {
            setSayOpen(false);
            window.setTimeout(() => searchRef.current?.focus(), 0);
          }}
        />
      ) : null}

      <div className="flex items-center gap-2">
        <label className="flex min-h-[54px] min-w-0 flex-1 items-center gap-2.5 rounded-[18px] bg-card px-4 text-muted-foreground shadow-cp-card focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-5 w-5 shrink-0" aria-hidden />
          <span className="sr-only">Find in your kitchen</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenId(null);
            }}
            placeholder="Find an item"
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 min-w-0 flex-1 bg-transparent text-base font-normal text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
        {rows.length > 0 ? (
          <button
            type="button"
            aria-pressed={several}
            onClick={toggleSeveral}
            className={cn(pillClass(several ? "main" : "quiet"), "min-h-11")}
          >
            Log several
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
          {bucket ? <NowStripView bucket={bucket} chips={strip} several={several} tray={tray} onChip={onStripChip} /> : null}

          <div role="group" aria-label="Show" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:px-0">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.on}
                onClick={() => choose(c.on && c.show.kind !== "all" ? { kind: "all" } : c.show)}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  c.on ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-cp-card hover:bg-muted/50",
                )}
              >
                {c.dot ? <span aria-hidden className={cn("h-2 w-2 rounded-full", c.dot === "soon" ? "bg-cp-soon" : "bg-cp-owe")} /> : null}
                {c.label}
                <span className="font-normal opacity-70">{c.count}</span>
              </button>
            ))}
          </div>

          {soon.length > 0 ? <UseSoonStrip tiles={soon} /> : null}

          {sections.length === 0 ? (
            <NothingShown show={show} query={query} />
          ) : (
            sections.map((s) => {
              const holdsOpen = openId !== null && s.rows.some((r) => r.id === openId);
              const open = sectionOpen(s.kind, { folded, searching, holdsOpenRow: holdsOpen });
              const headingId = `pantry-kind-${s.kind}`;
              // Three, then See all (RV-3); all of them while searching, or when the opened row is further down.
              const shownRows = sectionRows(s.rows, { all: allIn.has(s.kind), searching, openId });
              return (
                <section key={s.kind} aria-labelledby={headingId} className="flex flex-col gap-2">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setFolded(toggleFold(folded, s.kind))}
                    className="flex min-h-11 items-center gap-2 rounded-lg px-0.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span id={headingId} className={cn(K_SECTION, "flex-1 text-left")}>
                      {s.label} <span className="font-normal tabular-nums text-muted-foreground">· {s.count}</span>
                    </span>
                    <ChevronDown className={cn("h-[18px] w-[18px] text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden />
                  </button>
                  {open ? (
                    <div className={K_ROWS}>
                    <ul className="divide-y divide-cp-line">
                      {shownRows.rows.map((r) => (
                        <PantryRowView
                          key={r.id}
                          row={r}
                          item={r.item}
                          usual={usualFor(r.id, usualList)}
                          open={openId === r.id}
                          onToggle={() => setOpenId((id) => (id === r.id ? null : r.id))}
                          onChip={() => logChip(r)}
                          onMore={() => setSheet({ row: r, item: r.item, usual: usualFor(r.id, usualList), buyAgain: buyAgainFor(r) })}
                          several={several}
                          inTray={inTray(tray, r.id)}
                          meId={meId}
                          names={names}
                          onLogged={() => setOpenId(null)}
                          askName={askName(r.item, { names })}
                          askStatus={askStatus(r.id, mine, { now: askNow, names })}
                        />
                      ))}
                    </ul>
                    {shownRows.more ? (
                      <SeeAllButton
                        label={shownRows.label}
                        all={allIn.has(s.kind)}
                        onToggle={() =>
                          setAllIn((cur) => {
                            const next = new Set(cur);
                            if (next.has(s.kind) || shownRows.label === "Show less") next.delete(s.kind);
                            else next.add(s.kind);
                            return next;
                          })
                        }
                      />
                    ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}

          {/* Finished this week (PN-6, design §6.1), just above Always have. */}
          {finishedSection}

          {items.data?.truncated ? <p className="text-[13px] font-normal text-muted-foreground">Showing the first 1,000 items.</p> : null}
        </>
      )}

      <AlwaysHaveCard />

      {several ? (
        <LogTray
          tray={tray}
          onLog={() => {
            void logSeveral(tray, { meId, names });
            setTray([]);
            setSeveral(false);
          }}
        />
      ) : null}
      <UseSheet target={sheet} onClose={() => setSheet(null)} meId={meId} onLogged={() => setOpenId(null)} onBoughtAgain={buyLike} />
    </div>
  );
}

/** "Use soon" (the board's strip): three tiles, each the item's name and one fact, opening its page; Cook opens Cook now. */
function UseSoonStrip({ tiles }: { tiles: readonly UseSoonTile[] }) {
  return (
    <section aria-labelledby="pantry-use-soon" className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="pantry-use-soon" className={K_SECTION}>
          Use soon
        </h2>
        <Link href="/cook" className={cn("flex min-h-11 items-center rounded-lg px-1 text-sm font-medium text-cp-accent-text", RING)}>
          Cook
        </Link>
      </div>
      <ul className="grid grid-cols-3 gap-2.5">
        {tiles.map((t) => (
          <li key={t.id} className="min-w-0">
            <Link href={t.href} className={cn("flex min-h-[76px] flex-col justify-between gap-1.5 rounded-[18px] bg-card p-3 shadow-cp-card", RING)}>
              <span className="truncate text-[15px] font-medium">{t.name}</span>
              <span className={cn("truncate text-[13px] font-medium", t.tone === "expired" ? "text-cp-expired" : "text-foreground")}>{t.fact}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NothingShown({ show, query }: { show: PantryShow; query: string }) {
  const q = query.trim();
  const text = q
    ? `Nothing called “${q}”`
    : show.kind === "soon"
      ? "Nothing to use soon"
      : show.kind === "low"
        ? "Nothing running low"
        : "Nothing here yet";
  return (
    <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="min-w-0 text-[15px] font-normal text-muted-foreground">{text}</p>
      {q || show.kind === "pantry" ? (
        <Button asChild variant="outline" className={K_BUTTON_QUIET}>
          <Link href={addItemHref(show)}>
            <Plus aria-hidden />
            Bought it?
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
          Add what you bought
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
