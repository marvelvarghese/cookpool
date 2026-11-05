"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Search, Utensils, X } from "lucide-react";
import type { KitchenItem, KitchenUsual, ReachableItem } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { qk } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfile } from "@/components/kitchen/data";
import { IconBubble, KCard, K_BUTTON } from "@/components/kitchen/kit";
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
import { itemRefParam, leftText, pantryLabel, parseItemRef, type ItemRef } from "@/components/kitchen/pantry";
import { amountCost, amountStep, costPerText, orderConsumers, parseAmount, shareBreakdown } from "@/components/kitchen/item-use";
import { formatMinor } from "@/components/kitchen/money";
import {
  amountPresets,
  defaultConsumers,
  defaultPreset,
  leftAndPayer,
  matchCard,
  matchesHeading,
  qtyText,
  quickLogLabel,
  usableMatches,
  usualCard,
  usualFor,
  usualRef,
  type PickCard,
} from "@/components/kitchen/quick-use";

/** Usuals in the "Recent and usual" strip (their items are read ahead, so a tap opens the card at once). */
const STRIP_USUALS = 8;

/**
 * Use something (CP-13) — "I used something" in two taps. A search across
 * every pantry you use from ("What did you use?"), and under it your recent
 * and usual items (or, while searching, the matches); choosing one shows the
 * item — how much is left and who paid, its pantry — then **How much?** as
 * four kitchen-sized presets with your usual amount marked and chosen,
 * **Who?** as the group's faces with the people of your last use chosen
 * (SM-7), and the Log button naming who it is for ("Log 1 glass · ₹17.00" /
 * "You + Anu · ₹8.50 each"), sticky above the tab bar on a phone. Logging ends in the ten-second Undo toast and a fresh screen for the
 * next thing. `/use?item=me:itm_…` (Use on a pantry row) opens with that item
 * chosen. Only items you may use are offered: a viewer's groups never appear.
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
  const heading = searching
    ? cards === null
      ? "Searching…"
      : matchesHeading(cards.length)
    : noUsuals
      ? "In your pantries"
      : "Recent and usual";
  const stripLoading = cards === null && (searching ? !search.error : !usuals.error && !fallback.error);
  const stripError = searching ? search.error : (usuals.error ?? fallback.error);

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
    <div className="space-y-5 min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,420px)] min-[900px]:items-start min-[900px]:gap-8 min-[900px]:space-y-0">
      <div className="min-w-0 space-y-5">
        <div>
          <button
            type="button"
            onClick={back}
            className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Use something</h1>
          <p className="mt-1 text-sm text-muted-foreground">From any pantry you use. Whoever paid for it is paid back.</p>
        </div>

        <div className="relative">
          <label htmlFor="use-search" className="sr-only">
            What did you use?
          </label>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="use-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What did you use?"
            autoComplete="off"
            enterKeyHint="search"
            autoFocus={!linked}
            className="h-14 rounded-2xl border-input bg-card pl-12 pr-4 text-base shadow-[0_1px_2px_rgba(23,32,27,0.04)] sm:h-14 sm:text-base"
          />
        </div>

        <section aria-labelledby="use-strip-heading" className="space-y-2.5">
          <h2 id="use-strip-heading" aria-live="polite" className="text-sm font-bold text-muted-foreground">
            {heading}
          </h2>
          {stripError && cards === null ? (
            <KCard className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p className="text-sm text-muted-foreground">Couldn&apos;t load your items. {stripError.message}</p>
              <Button variant="outline" className={K_BUTTON} onClick={searching ? search.reload : usuals.error ? usuals.reload : fallback.reload}>
                Try again
              </Button>
            </KCard>
          ) : stripLoading || cards === null ? (
            <div className="flex gap-3" aria-hidden>
              <Skeleton className="h-[104px] w-40 shrink-0 rounded-[18px]" />
              <Skeleton className="h-[104px] w-40 shrink-0 rounded-[18px]" />
              <Skeleton className="h-[104px] w-40 shrink-0 rounded-[18px]" />
            </div>
          ) : cards.length === 0 ? (
            searching ? (
              <KCard className="p-4">
                <p className="text-[15px] font-semibold">Nothing called &ldquo;{query.trim()}&rdquo; in a pantry you use from</p>
                <p className="mt-1 text-sm text-muted-foreground">Check the spelling, or add it if you just bought it.</p>
                <Button asChild variant="outline" className={cn(K_BUTTON, "mt-3")}>
                  <Link href="/pantry/new">
                    <Plus aria-hidden />
                    Add an item
                  </Link>
                </Button>
              </KCard>
            ) : (
              <KCard className="flex gap-4 p-5">
                <IconBubble icon={Utensils} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold tracking-tight">Nothing to use yet</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add what you buy — to your own pantry or a group&apos;s — and log what you use here.
                  </p>
                  <Button asChild className={cn(K_BUTTON, "mt-3")}>
                    <Link href="/pantry/new">
                      <Plus aria-hidden />
                      Add an item
                    </Link>
                  </Button>
                </div>
              </KCard>
            )
          ) : (
            <PickStrip cards={cards} selectedKey={selected?.itemId ?? null} onPick={pick} label={heading} />
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
        ) : (
          <KCard className="p-5">
            <h2 className="text-base font-bold tracking-tight">Pick what you used</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tap one of your usuals or search. Then choose how much and who had it — the cost is worked out as you go.
            </p>
          </KCard>
        )}
      </div>
    </div>
  );
}

/** The strip: a row of cards that scrolls sideways on a phone, a grid from 900px. */
function PickStrip({
  cards,
  selectedKey,
  onPick,
  label,
}: {
  cards: readonly PickCard[];
  selectedKey: string | null;
  onPick: (card: PickCard) => void;
  label: string;
}) {
  return (
    <ul
      aria-label={label}
      className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 min-[900px]:mx-0 min-[900px]:grid min-[900px]:grid-cols-3 min-[900px]:overflow-visible min-[900px]:px-0 min-[900px]:pb-0"
    >
      {cards.map((card) => {
        const on = card.key === selectedKey;
        return (
          <li key={card.key} className="w-40 shrink-0 snap-start min-[900px]:w-auto">
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onPick(card)}
              className={cn(
                "flex h-full min-h-[104px] w-full flex-col items-start gap-1 rounded-[18px] border bg-card p-3 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-primary bg-accent ring-1 ring-primary" : "hover:bg-accent",
              )}
            >
              <span className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                {card.pantry}
              </span>
              <span className="line-clamp-2 text-[15px] font-bold leading-snug">{card.name}</span>
              <span className="max-w-full truncate text-xs text-muted-foreground">{card.sub}</span>
              {card.meta ? <span className="max-w-full truncate text-xs text-muted-foreground">{card.meta}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
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
  if (item.error?.code === "not_found") {
    return (
      <PanelNote
        title="This item isn't in a pantry you can use"
        body="It may have been removed, used up, or moved to a group you're not in."
        onClear={onClear}
      />
    );
  }
  if (item.error || !item.data) {
    return (
      <KCard className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this item. {item.error?.message ?? ""}</p>
        <Button variant="outline" className={K_BUTTON} onClick={item.reload}>
          Try again
        </Button>
      </KCard>
    );
  }
  const data = item.data;
  if (orgId && roles.get(orgId) === "viewer") {
    return (
      <PanelNote
        title={`You view ${pantryLabel(data.pantry)}`}
        body="You see its pantry, but don't use from it. Pick something from a pantry you use."
        onClear={onClear}
      />
    );
  }
  if (data.state !== "active" || data.qtyLeftMilli <= 0) {
    return <PanelNote title={`Nothing left of ${data.name}`} body="Someone used the last of it. Pick something else." onClear={onClear} />;
  }
  return (
    <UseForm
      itemRef={itemRef}
      item={data}
      usual={usual}
      meId={meId}
      names={names}
      roster={orgId ? roster : null}
      waitingForRoster={orgId !== null && roster === null && !members.error}
      onClear={onClear}
      onLogged={onLogged}
    />
  );
}

function PanelNote({ title, body, onClear }: { title: string; body: string; onClear: () => void }) {
  return (
    <KCard className="p-5">
      <h2 className="text-base font-bold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Button variant="outline" className={cn(K_BUTTON, "mt-3")} onClick={onClear}>
        Pick something else
      </Button>
    </KCard>
  );
}

function UseForm({
  itemRef,
  item,
  usual,
  meId,
  names,
  roster,
  waitingForRoster,
  onClear,
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
  onClear: () => void;
  onLogged: () => void;
}) {
  const logUse = useLogUse();
  const personal = item.pantry.kind === "personal";
  const presets = amountPresets(item, usual?.lastQtyMilli ?? null);
  const [presetId, setPresetId] = React.useState<string | null>(() => defaultPreset(presets)?.id ?? null);
  const [typed, setTyped] = React.useState<string | null>(null);
  const [chosenState, setChosen] = React.useState<ReadonlySet<string> | null>(null);
  const otherRef = React.useRef<HTMLInputElement>(null);
  const step = amountStep(item);

  // A tile that no longer fits (someone used some meanwhile) falls back to the first that does.
  const preset = typed === null ? (presets.find((p) => p.id === presetId) ?? defaultPreset(presets)) : null;
  const parsed = typed === null ? null : parseAmount(typed, item);
  const qtyMilli = preset ? preset.qtyMilli : parsed?.ok ? parsed.milli : null;
  const words = preset ? preset.words : qtyMilli !== null ? qtyText(qtyMilli, item.dimension) : null;
  const chosen: ReadonlySet<string> = chosenState ?? new Set(defaultConsumers(usual, roster, meId));
  const consumers = personal ? [] : orderConsumers(chosen, roster ?? [], meId);
  const cost = qtyMilli !== null ? amountCost(item, qtyMilli) : null;
  const breakdown = !personal && qtyMilli !== null ? shareBreakdown({ item, qtyMilli, consumers, meId, names }) : null;
  const label = quickLogLabel({ words, costMinor: cost, currency: item.currency, consumers: personal ? null : consumers });
  const ready = qtyMilli !== null && words !== null && (personal || (!waitingForRoster && consumers.length > 0));

  const choose = (id: string) => {
    setTyped(null);
    setPresetId(id);
  };
  const toggle = (id: string) => setChosen((cur) => toggleFace(cur ?? chosen, id));
  // Named as the faces are ordered (you first); "each" is the engine's split of the cost.
  const who = personal
    ? null
    : whoLine({ ids: faceOrder(consumers, meId, names), meId, names, amounts: breakdown?.lines.map((l) => l.amountMinor) ?? null, currency: item.currency });

  // Logged at once (SM-5): what is left drops wherever the item is listed,
  // the Undo toast is up and the screen is fresh for the next thing before
  // the server answers. A refusal is put back and the toast says why.
  const submit = () => {
    if (!ready || qtyMilli === null || words === null) return;
    void logUse({
      ref: itemRef,
      item,
      qtyMilli,
      consumers,
      idempotencyKey: crypto.randomUUID(),
      what: words,
      inPantry: true,
      meId,
      names,
    });
    onLogged();
  };

  const headingId = "use-item-name";
  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-[22px] border-2 border-primary bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="break-words text-xl font-extrabold leading-tight tracking-tight">
            {item.name}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{leftAndPayer(item, meId, names)}</p>
        </div>
        <span className="mt-0.5 max-w-[45%] shrink-0 truncate rounded-full bg-muted px-2.5 py-1 text-xs font-bold">
          {pantryLabel(item.pantry)}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Pick something else"
          className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-bold">How much?</legend>
        <div className="grid grid-cols-2 gap-2.5">
          {presets.map((p) => {
            const on = typed === null && preset?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => choose(p.id)}
                className={cn(
                  "relative flex min-h-[76px] flex-col items-start justify-center rounded-[16px] border px-3.5 py-2.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "border-primary bg-accent ring-1 ring-primary" : "border-input bg-card hover:bg-accent/60",
                )}
              >
                {p.usual ? (
                  <span className="mb-0.5 rounded-full bg-primary px-2 py-px text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                    Your usual
                  </span>
                ) : null}
                <span className="text-[17px] font-extrabold leading-tight">{p.label}</span>
                <span className="text-[13px] tabular-nums text-muted-foreground">
                  {p.amount} · {formatMinor(amountCost(item, p.qtyMilli), item.currency)}
                </span>
              </button>
            );
          })}
        </div>
        {typed === null ? (
          <button
            type="button"
            onClick={() => {
              setTyped("");
              window.requestAnimationFrame(() => otherRef.current?.focus());
            }}
            className="mt-1.5 min-h-11 rounded-xl px-2 text-sm font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Another amount
          </button>
        ) : (
          <div className="mt-2.5 space-y-1">
            <label htmlFor="use-other" className="text-xs font-semibold text-muted-foreground">
              Another amount, in {step.unit}
            </label>
            <div className="flex items-center gap-2">
              <Input
                ref={otherRef}
                id="use-other"
                inputMode="decimal"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                }}
                aria-invalid={parsed !== null && !parsed.ok && typed.trim() !== ""}
                aria-describedby="use-other-note"
                placeholder={step.unit === "g" || step.unit === "ml" ? "300" : "2"}
                className="h-11 w-28 rounded-xl text-base sm:h-11 sm:text-base"
              />
              <span className="text-base font-bold text-muted-foreground">{step.unit}</span>
              <button
                type="button"
                onClick={() => setTyped(null)}
                className="ml-auto min-h-11 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Back to presets
              </button>
            </div>
            <p id="use-other-note" className="text-xs text-muted-foreground">
              {parsed && !parsed.ok && typed.trim() !== "" ? (
                <span className="font-medium text-destructive">{parsed.message}</span>
              ) : (
                `Up to ${leftText(item)}, what's left.`
              )}
            </p>
          </div>
        )}
      </fieldset>

      {personal ? (
        <p className="rounded-[14px] bg-background px-3.5 py-3 text-sm text-muted-foreground">
          It&apos;s your own pantry, so nobody owes anyone — this just keeps count.
          {cost !== null ? ` It cost you ${formatMinor(cost, item.currency)} (${costPerText(item)}).` : ""}
        </p>
      ) : (
        <FaceRow legend="Who?" people={roster} chosen={chosen} onToggle={toggle} meId={meId} names={names} />
      )}

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-30 min-[900px]:static">
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
