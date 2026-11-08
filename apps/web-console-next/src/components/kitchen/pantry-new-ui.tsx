"use client";

import * as React from "react";
import Link from "./link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, Refrigerator, Search } from "lucide-react";
import type { KitchenItem, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { useFoldedSections } from "@/lib/pantry-device";
import { useProfile } from "./data";
import { IconBubble, KCard, K_BUTTON } from "./kit";
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
  useSoonCard,
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
  const card = useSoonCard(rows, { show, query });
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
    <div className="space-y-3 min-[900px]:max-w-[760px] min-[900px]:space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] min-[900px]:text-[30px]">Pantry</h1>
        <Link
          href={boughtHref()}
          className="flex min-h-11 items-center gap-1.5 rounded-[14px] bg-primary px-3.5 text-[15px] font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
          Bought
        </Link>
      </header>

      <div className="flex items-center gap-2">
        <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border border-[#D5DAD2] bg-card px-3.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-5 w-5 shrink-0" aria-hidden />
          <span className="sr-only">Find in your pantries</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenId(null);
            }}
            placeholder="Find in your pantries"
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 min-w-0 flex-1 bg-transparent text-base font-semibold text-foreground outline-none placeholder:font-semibold placeholder:text-muted-foreground"
          />
        </label>
        {rows.length > 0 ? (
          <button
            type="button"
            aria-pressed={several}
            onClick={toggleSeveral}
            className={cn(
              "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              several ? "border-foreground bg-foreground text-background" : "border-[#D5DAD2] bg-card text-foreground hover:bg-accent",
            )}
          >
            Log several
          </button>
        ) : null}
      </div>

      {loading ? (
        <PantrySkeleton />
      ) : failed ? (
        <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your pantries. {(pantries.error ?? items.error)?.message ?? ""}</p>
          <Button
            variant="outline"
            className={K_BUTTON}
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
                  "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-extrabold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  c.on ? "border-foreground bg-foreground text-background" : "border-[#D5DAD2] bg-card text-foreground hover:bg-accent",
                )}
              >
                {c.dot ? <span aria-hidden className={cn("h-2 w-2 rounded-full", c.dot === "soon" ? "bg-[#D97706]" : "bg-[#C2410C]")} /> : null}
                {c.label}
                <span className="font-bold opacity-70">{c.count}</span>
              </button>
            ))}
          </div>

          {card ? (
            <Link
              href={card.href}
              className="flex items-center gap-3 rounded-[18px] border border-[#F0D9A0] bg-[#FDF1D6] px-3.5 py-3 text-[#4A3200] transition-colors hover:bg-[#FBE9C0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-extrabold">{card.title}</span>
                <span className="text-[13px] font-bold text-[#6B4600]">{card.sub}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
            </Link>
          ) : null}

          {sections.length === 0 ? (
            <NothingShown show={show} query={query} />
          ) : (
            sections.map((s) => {
              const holdsOpen = openId !== null && s.rows.some((r) => r.id === openId);
              const open = sectionOpen(s.kind, { folded, searching, holdsOpenRow: holdsOpen });
              const headingId = `pantry-kind-${s.kind}`;
              return (
                <section key={s.kind} aria-labelledby={headingId} className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setFolded(toggleFold(folded, s.kind))}
                    className="flex min-h-11 items-center gap-2 rounded-lg px-0.5 text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span id={headingId} className="flex-1 text-left text-xs font-extrabold uppercase tracking-[0.06em]">
                      {s.label}
                    </span>
                    <span className="text-xs font-extrabold tabular-nums">{s.count}</span>
                    <ChevronDown className={cn("h-[18px] w-[18px] transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden />
                  </button>
                  {open ? (
                    <ul className="divide-y divide-[#ECEEE9] overflow-hidden rounded-[20px] border border-[#E3E6E0] bg-card">
                      {s.rows.map((r) => (
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
                  ) : null}
                </section>
              );
            })
          )}

          {/* Finished this week (PN-6, design §6.1), just above Always have. */}
          {finishedSection}

          {items.data?.truncated ? <p className="text-[13px] text-muted-foreground">Showing the first 1,000 items.</p> : null}
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
      <p className="min-w-0 text-[15px] font-semibold text-muted-foreground">{text}</p>
      {q || show.kind === "pantry" ? (
        <Button asChild variant="outline" className={K_BUTTON}>
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
      <h2 className="mt-4 text-lg font-bold tracking-tight">Nothing in your pantries yet</h2>
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
      <Skeleton className="h-40 w-full rounded-[20px]" />
    </div>
  );
}
