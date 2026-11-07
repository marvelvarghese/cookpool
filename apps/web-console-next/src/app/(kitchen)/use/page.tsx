"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, Search } from "lucide-react";
import type { KitchenItem, KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/components/kitchen/data";
import { KCard, K_BUTTON } from "@/components/kitchen/kit";
import type { MemberNames } from "@/components/kitchen/members";
import { useMemberNames, useMyRoles } from "@/components/kitchen/people-data";
import {
  useItemSearch,
  useItemsByRef,
  useKitchenItem,
  useLogUse,
  useMembersOf,
  useUsableItems,
  useUsuals,
} from "@/components/kitchen/pantry-data";
import { FaceRow, MAIN_BUTTON, MainButtonLabel } from "@/components/kitchen/faces-ui";
import { faceOrder, toggleFace, whoLine } from "@/components/kitchen/faces";
import { itemRefParam, pantryLabel, parseItemRef, type ItemRef } from "@/components/kitchen/pantry";
import { amountCost, amountInput, orderConsumers, shareBreakdown } from "@/components/kitchen/item-use";
import { askable, countInLabel, countText, firstAsk } from "@/components/kitchen/measures";
import { MeasureSheet, UnitSwitch, type MeasureSheetMode } from "@/components/kitchen/measures-ui";
import {
  defaultConsumers,
  defaultTile,
  leftWithMeasure,
  matchCard,
  matchesHeading,
  otherAmount,
  otherHint,
  otherLine,
  otherSides,
  otherStart,
  otherStep,
  otherSwitch,
  parseOther,
  qtyText,
  quickLogLabel,
  usableMatches,
  useTiles,
  usualCard,
  usualFor,
  usualRef,
  type OtherAmount,
  type PickCard,
  type UseTile,
} from "@/components/kitchen/quick-use";

/** Usuals in the item row (their items are read ahead, so a tap opens the item at once). */
const STRIP_USUALS = 8;

/**
 * Use something (CP-13, rebuilt in SM-14 under the seven rules). A search
 * ("What did you use?") beside Back, and under it your recent and usual
 * items as one row of pills (while searching, the matches); choosing one
 * shows it — its name, its pantry, what is left ("600 g left · ≈ 4 onions")
 * — then **how much** as a 2×2 of tiles: your usual, the item's own measure
 * ("1 onion · ≈ 150 g · ₹6.00", "2 onions"), plain amounts in its unit and
 * "The rest"; with no measure yet, a dashed "Count in onions" tile asks one
 * question once (the sheet) and the tiles switch to onions at once. Another
 * amount steps in the measure or the unit ([onions | g]), with the other side
 * under it ("≈ 450 g · ₹18.00"). **Who?** is the group's faces, and the one
 * main button names amount, price and people ("Log 2 onions · ₹12.00" / "You
 * + Anu · ₹6.00 each"). Logging ends in the one-line Undo toast and a fresh
 * screen. `/use?item=me:itm_…` (the item page's "Use some", a pantry row's
 * Use) opens with that item chosen. Only items you may use are offered.
 */
export default function UsePage() {
  const searchParams = useSearchParams();
  const linked = parseItemRef(searchParams?.get("item"));
  return <QuickUse key={linked ? itemRefParam(linked) : "search"} linked={linked} />;
}

function useDebounced<T>(value: T, ms: number): T {
  const [current, setCurrent] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return current;
}

/** Pill words: the name, and its pantry when two pills share a name. */
function pillLabels(cards: readonly PickCard[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.name.toLowerCase(), (counts.get(c.name.toLowerCase()) ?? 0) + 1);
  return new Map(cards.map((c) => [c.key, (counts.get(c.name.toLowerCase()) ?? 0) > 1 ? `${c.name} · ${c.pantry}` : c.name] as const));
}

function QuickUse({ linked }: { linked: ItemRef | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const profile = useProfile();
  const meId = profile.data?.id ?? null;
  const names = useMemberNames();
  const usuals = useUsuals();
  const [query, setQuery] = React.useState("");
  const term = useDebounced(query.trim(), 200);
  const search = useItemSearch(term);
  const [selected, setSelected] = React.useState<ItemRef | null>(linked);
  const [round, setRound] = React.useState(0);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // While a new search runs, the last matches stay on screen.
  const [shownMatches, setShownMatches] = React.useState<ReachableItem[] | null>(null);
  React.useEffect(() => {
    if (search.data) setShownMatches(search.data);
  }, [search.data]);

  const usualList = usuals.data;
  const noUsuals = usualList !== null && usualList.length === 0;
  const fallback = useUsableItems(noUsuals);
  const stripUsuals = React.useMemo(() => (usualList ?? []).slice(0, STRIP_USUALS), [usualList]);
  const stripRefs = React.useMemo(() => stripUsuals.map(usualRef), [stripUsuals]);
  useItemsByRef(stripRefs);

  const searching = query.trim() !== "";
  const matches = searching ? (term === query.trim() ? (search.data ?? shownMatches) : shownMatches) : null;
  const ctx = { meId, names };
  const cards: PickCard[] | null = searching
    ? matches
      ? usableMatches(matches).map((m) => matchCard(m, ctx))
      : null
    : usualList === null
      ? null
      : usualList.length > 0
        ? stripUsuals.map(usualCard).filter((c): c is PickCard => c !== null)
        : fallback.data
          ? usableMatches(fallback.data).map((m) => matchCard(m, ctx))
          : null;
  const heading = searching ? (cards === null ? "Searching…" : matchesHeading(cards.length)) : noUsuals ? "In your pantries" : "Recent and usual";
  const stripLoading = cards === null && (searching ? !search.error : !usuals.error && !fallback.error);
  const stripError = searching ? search.error : (usuals.error ?? fallback.error);
  const labels = cards ? pillLabels(cards) : new Map<string, string>();

  const pick = (card: PickCard) => {
    if (card.item) qc.setQueryData(qk.kitchenItem(itemRefParam(card.ref)), card.item);
    setSelected(card.ref);
    setQuery("");
    window.requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const clear = () => {
    setSelected(null);
    if (linked) router.replace("/use");
  };
  // After a log: a fresh screen for the next thing (the Undo toast stays).
  const logged = () => {
    if (linked) {
      router.replace("/use");
      return;
    }
    setSelected(null);
    setQuery("");
    setRound((r) => r + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push("/home");
  };

  return (
    <div className="space-y-[18px] min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,420px)] min-[900px]:items-start min-[900px]:gap-8 min-[900px]:space-y-0">
      <div className="min-w-0 space-y-[18px]">
        <h1 className="sr-only">Use something</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-[22px] w-[22px]" aria-hidden />
          </button>
          <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border border-input bg-card px-3.5 focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">What did you use?</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What did you use?"
              autoComplete="off"
              enterKeyHint="search"
              autoFocus={!linked}
              className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <section aria-labelledby="use-strip-heading">
          <h2 id="use-strip-heading" aria-live="polite" className="sr-only">
            {heading}
          </h2>
          {stripError && cards === null ? (
            <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load your items.</p>
              <Button variant="outline" className={K_BUTTON} onClick={searching ? search.reload : usuals.error ? usuals.reload : fallback.reload}>
                Try again
              </Button>
            </KCard>
          ) : stripLoading || cards === null ? (
            <div className="flex gap-2" aria-hidden>
              <Skeleton className="h-11 w-24 shrink-0 rounded-full" />
              <Skeleton className="h-11 w-28 shrink-0 rounded-full" />
              <Skeleton className="h-11 w-20 shrink-0 rounded-full" />
            </div>
          ) : cards.length === 0 ? (
            <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="min-w-0 text-[15px] font-semibold">{searching ? `Nothing called “${query.trim()}”` : "Nothing to use yet"}</p>
              <Button asChild variant="outline" className={K_BUTTON}>
                <Link href="/pantry/new">
                  <Plus aria-hidden />
                  Add an item
                </Link>
              </Button>
            </KCard>
          ) : (
            <ul aria-label={heading} className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:px-0">
              {cards.map((card) => {
                const on = card.key === selected?.itemId;
                return (
                  <li key={card.key} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => pick(card)}
                      className={cn(
                        "min-h-11 whitespace-nowrap rounded-full border px-4 text-[15px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-foreground bg-foreground text-background" : "border-input bg-card hover:bg-accent",
                      )}
                    >
                      {labels.get(card.key) ?? card.name}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div ref={panelRef} className="min-w-0 scroll-mt-6 min-[900px]:sticky min-[900px]:top-10">
        {selected ? (
          <ItemPanel
            key={`${itemRefParam(selected)}#${round}`}
            itemRef={selected}
            usual={usualFor(selected.itemId, usualList)}
            meId={meId}
            onClear={clear}
            onLogged={logged}
          />
        ) : cards && cards.length > 0 ? (
          <p className="text-[15px] font-semibold text-muted-foreground">Pick what you used.</p>
        ) : null}
      </div>
    </div>
  );
}

// ── The chosen item ────────────────────────────────────────────────

function ItemPanel({
  itemRef,
  usual,
  meId,
  onClear,
  onLogged,
}: {
  itemRef: ItemRef;
  usual: KitchenUsual | null;
  meId: string | null;
  onClear: () => void;
  onLogged: () => void;
}) {
  const item = useKitchenItem(itemRef);
  const { roles } = useMyRoles();
  const orgId = itemRef.kind === "group" ? itemRef.orgId : null;
  const members = useMembersOf(orgId);
  const names = useMemberNames(members.data);
  const roster = React.useMemo(() => (orgId && members.data ? members.data.map((m) => m.subjectId) : null), [orgId, members.data]);

  if (item.loading) return <Skeleton className="h-[420px] w-full rounded-[22px]" aria-hidden />;
  if (item.error?.code === "not_found") return <PanelNote title="Not in a pantry you can use" onClear={onClear} />;
  if (item.error || !item.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this item.</p>
        <Button variant="outline" className={K_BUTTON} onClick={item.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  const data = item.data;
  if (orgId && roles.get(orgId) === "viewer") return <PanelNote title={`You only view ${pantryLabel(data.pantry)}`} onClear={onClear} />;
  if (data.state !== "active" || data.qtyLeftMilli <= 0) return <PanelNote title={`Nothing left of ${data.name}`} onClear={onClear} />;
  return (
    <UseForm
      itemRef={itemRef}
      item={data}
      usual={usual}
      meId={meId}
      names={names}
      roster={orgId ? roster : null}
      waitingForRoster={orgId !== null && roster === null && !members.error}
      onLogged={onLogged}
    />
  );
}

function PanelNote({ title, onClear }: { title: string; onClear: () => void }) {
  return (
    <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="min-w-0 text-[15px] font-semibold">{title}</p>
      <Button variant="outline" className={K_BUTTON} onClick={onClear}>
        Pick another
      </Button>
    </KCard>
  );
}

const TILE =
  "flex min-h-[84px] flex-col items-start justify-center gap-0.5 rounded-[18px] px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const STEP =
  "grid h-12 w-12 shrink-0 place-items-center rounded-[14px] border border-input bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

function UseForm({
  itemRef,
  item,
  usual,
  meId,
  names,
  roster,
  waitingForRoster,
  onLogged,
}: {
  itemRef: ItemRef;
  item: KitchenItem;
  usual: KitchenUsual | null;
  meId: string | null;
  names: MemberNames;
  /** The group's members in its order; null for your own item, or while they load. */
  roster: readonly string[] | null;
  waitingForRoster: boolean;
  onLogged: () => void;
}) {
  const logUse = useLogUse();
  const personal = item.pantry.kind === "personal";
  const tiles = useTiles(item, usual);
  const [tileId, setTileId] = React.useState<string | null>(null);
  const [other, setOther] = React.useState<OtherAmount | null>(null);
  const [typed, setTyped] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<MeasureSheetMode | null>(null);
  const [chosenState, setChosen] = React.useState<ReadonlySet<string> | null>(null);
  const ask = askable(item) ? firstAsk(item) : null;

  // A tile that no longer fits (someone used some meanwhile, a measure changed) falls back to the first.
  const tile: UseTile | null = other ? null : (tiles.find((t) => t.id === tileId) ?? defaultTile(tiles));
  const parsedOther = other && typed !== null ? parseOther(item, other.side, typed) : null;
  const otherNow = parsedOther?.ok ? parsedOther.state : other;
  const amount = tile ? tile.amount : otherNow && !(parsedOther && !parsedOther.ok) ? otherAmount(item, otherNow) : null;
  const words = tile ? tile.words : amount ? (amount.kind === "measure" ? amount.label : qtyText(amount.qtyMilli, item.dimension)) : null;
  const chosen: ReadonlySet<string> = chosenState ?? new Set(defaultConsumers(usual, roster, meId));
  const consumers = personal ? [] : orderConsumers(chosen, roster ?? [], meId);
  const cost = amount ? amountCost(item, amount.qtyMilli) : null;
  const breakdown = !personal && amount ? shareBreakdown({ item, qtyMilli: amount.qtyMilli, consumers, meId, names }) : null;
  const label = quickLogLabel({ words, costMinor: cost, currency: item.currency, consumers: personal ? null : consumers });
  const ready = amount !== null && words !== null && (personal || (!waitingForRoster && consumers.length > 0));
  // Named as the faces are ordered (you first); "each" is the engine's split of the cost.
  const who = personal
    ? null
    : whoLine({ ids: faceOrder(consumers, meId, names), meId, names, amounts: breakdown?.lines.map((l) => l.amountMinor) ?? null, currency: item.currency });
  const sides = otherSides(item);

  const choose = (id: string) => {
    setOther(null);
    setTyped(null);
    setTileId(id);
  };
  const toggleOther = () => {
    setTyped(null);
    setOther((cur) => (cur ? null : otherStart(item, tile?.amount ?? null)));
  };
  const stepOther = (delta: 1 | -1) => {
    if (!other) return;
    setTyped(null);
    setOther(otherStep(item, otherNow ?? other, delta));
  };
  const toggle = (id: string) => setChosen((cur) => toggleFace(cur ?? chosen, id));

  // Logged at once (SM-5): what is left drops wherever the item is listed,
  // the Undo toast is up and the screen is fresh for the next thing before
  // the server answers. A refusal is put back and the toast says why.
  const submit = () => {
    if (!ready || !amount || words === null) return;
    void logUse({
      ref: itemRef,
      item,
      qtyMilli: amount.qtyMilli,
      consumers,
      idempotencyKey: crypto.randomUUID(),
      what: words,
      measure: amount.kind === "measure" ? { measure: amount.measure, quantity: amount.quantity } : null,
      meId,
      names,
    });
    onLogged();
  };

  const headingId = "use-item-name";
  return (
    <section aria-labelledby={headingId} className="space-y-[18px]">
      <div className="space-y-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 id={headingId} className="min-w-0 break-words text-[28px] font-extrabold leading-tight tracking-tight">
            {item.name}
          </h2>
          <span className="max-w-[45%] shrink-0 truncate rounded-full bg-cp-owed-tint px-2.5 py-1 text-[13px] font-bold text-cp-owed">{pantryLabel(item.pantry)}</span>
        </div>
        <p className="text-sm font-semibold text-muted-foreground">{leftWithMeasure(item)}</p>
      </div>

      <div role="group" aria-label="How much" className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => {
          const on = tile?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => choose(t.id)}
              className={cn(TILE, on ? "border-2 border-primary bg-accent" : "border border-input bg-card hover:bg-accent/60")}
            >
              {t.usual ? (
                <span className="rounded-full bg-primary px-2 py-px text-[11px] font-extrabold uppercase tracking-wide text-primary-foreground">Usual</span>
              ) : null}
              <span className="text-lg font-extrabold leading-tight">{t.label}</span>
              <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">{t.sub}</span>
            </button>
          );
        })}
        {ask ? (
          <button
            type="button"
            onClick={() => setSheet({ kind: "first" })}
            className={cn(TILE, "flex-row items-center justify-start gap-2.5 border-2 border-dashed border-[#9DB8A8] bg-transparent text-primary hover:bg-accent/60")}
          >
            <Plus className="h-[22px] w-[22px] shrink-0" aria-hidden />
            <span className="text-[15px] font-extrabold leading-tight">{countInLabel(ask.many)}</span>
          </button>
        ) : null}
      </div>
      <MeasureSheet
        item={item}
        mode={sheet}
        onOpenChange={(open) => !open && setSheet(null)}
        onSaved={() => {
          // The tiles are in the measure now: start from its first.
          setOther(null);
          setTyped(null);
          setTileId(null);
        }}
      />

      <section aria-label="Another amount" className={cn("rounded-[18px] bg-card px-3.5", other ? "border-2 border-primary pb-3" : "border border-input")}>
        <button
          type="button"
          aria-expanded={other !== null}
          onClick={toggleOther}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-[15px] font-extrabold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>Another amount</span>
          {other ? null : <span className="text-sm font-bold text-muted-foreground">{otherHint(item)}</span>}
        </button>
        {other ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <button type="button" aria-label="Less" className={STEP} onClick={() => stepOther(-1)}>
                <Minus className="h-5 w-5" aria-hidden />
              </button>
              <label className="sr-only" htmlFor="use-other">
                How much, in {other.side === "measure" && sides.measure ? sides.measure.many : sides.unit}
              </label>
              <input
                id="use-other"
                inputMode="decimal"
                autoComplete="off"
                value={typed ?? (other.side === "measure" ? countText(other.quantity) : amountInput(other.qtyMilli))}
                onChange={(e) => setTyped(e.target.value)}
                onBlur={() => {
                  if (parsedOther?.ok) {
                    setOther(parsedOther.state);
                    setTyped(null);
                  }
                }}
                aria-invalid={parsedOther !== null && !parsedOther.ok}
                aria-describedby="use-other-line"
                className="h-12 w-[4.5rem] min-w-0 rounded-xl bg-background text-center text-2xl font-extrabold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:text-destructive"
              />
              <button type="button" aria-label="More" className={STEP} onClick={() => stepOther(1)}>
                <Plus className="h-5 w-5" aria-hidden />
              </button>
              {sides.measure ? (
                <UnitSwitch
                  className="ml-auto"
                  options={[
                    { key: "measure", label: sides.measure.many, on: other.side === "measure" },
                    { key: "unit", label: sides.unit, on: other.side === "unit" },
                  ]}
                  onPick={(key) => {
                    setTyped(null);
                    setOther(otherSwitch(item, otherNow ?? other, key === "measure" ? "measure" : "unit"));
                  }}
                />
              ) : (
                <span className="ml-1 text-base font-bold text-muted-foreground">{sides.unit}</span>
              )}
            </div>
            <p id="use-other-line" role="status" className="text-sm font-bold text-foreground/80">
              {parsedOther && !parsedOther.ok ? <span className="text-destructive">{parsedOther.message}</span> : otherLine(item, amount)}
            </p>
          </div>
        ) : null}
      </section>

      {personal ? null : <FaceRow legend="Who?" people={roster} chosen={chosen} onToggle={toggle} meId={meId} names={names} />}

      <div data-toast-above="" className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 min-[900px]:static">
        <Button
          type="button"
          className={cn(MAIN_BUTTON, "shadow-[0_8px_24px_rgba(23,32,27,0.18)] min-[900px]:shadow-none")}
          disabled={!ready}
          onClick={submit}
        >
          <MainButtonLabel title={label} who={ready ? who : null} />
        </Button>
      </div>
    </section>
  );
}
