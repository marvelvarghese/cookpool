"use client";

import * as React from "react";
import { Check, ChevronDown, Minus, Plus, Search, ShoppingBasket, X } from "lucide-react";
import type { KitchenItem, MyGroupBalance } from "@saas/contracts/kitchen";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentGroupSlugs } from "@/lib/recent-groups";
import { GroupAvatar, K_BUTTON, K_INPUT } from "./kit";
import { Money } from "./ledger-ui";
import { PantryBadge } from "./pantry-ui";
import { MAIN_UNITS, MORE_UNITS } from "./item-form";
import { amountInput, parseAmount } from "./item-use";
import { currencyPrefix, formatMinor } from "./money";
import type { MemberNames } from "./members";
import { pantryBadge } from "./pantry";
import { useItemSearch } from "./pantry-data";
import { useCookableItems } from "./dish-maker-data";
import {
  JUST_ME,
  emptyNewItem,
  oweLabel,
  pantryResults,
  perPortionText,
  portionsText,
  previewNewItem,
  shareOptions,
  type DishTotals,
  type EaterView,
  type LineView,
  type NewItemDraft,
  type NewItemField,
  type NewLine,
  type PantryResult,
  type ShareOption,
  type SplitModeOption,
} from "./dish-maker";

/**
 * The dish maker's visual pieces (Cookpool CP-15): an ingredient as a phone
 * card and as a desktop table row, the amount stepper, the extras and
 * portions steppers, the dark cost card, "Take from any pantry" (a search over
 * every pantry you cook from, with the "Bought it just now?" form), the "Share
 * it with" picker, the two ways to split and who ate what. Colors come from
 * the `.cookpool` tokens; the cost card is the canvas's ink card.
 */

const STEP_BUTTON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-input bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

// ── The amount stepper ────────────────────────────────────────────

/**
 * "− 300 g +": a step down from the smallest amount takes the ingredient
 * out; the amount can be typed (in the stepper's unit, never more than is
 * left) and applies on Enter or when the field loses focus.
 */
export function AmountStepper({
  view,
  onChange,
  id,
  compact = false,
}: {
  view: LineView;
  onChange: (qtyMilli: number, delta?: 1 | -1) => void;
  id: string;
  compact?: boolean;
}) {
  const [typed, setTyped] = React.useState<string | null>(null);
  const parsed = typed === null ? null : parseAmount(typed, { dimension: view.dimension, qtyLeftMilli: view.max, displayUnit: view.step.unit });
  const commit = () => {
    if (parsed?.ok) onChange(parsed.milli);
    setTyped(null);
  };
  return (
    <div className={cn("flex items-center", compact ? "gap-1.5" : "gap-2")}>
      <button type="button" className={cn(STEP_BUTTON, compact && "h-9 w-9 rounded-[10px]")} aria-label={view.lessLabel} onClick={() => onChange(view.qtyMilli, -1)}>
        <Minus className="h-4 w-4" aria-hidden />
      </button>
      <span className="flex items-baseline gap-1">
        <label htmlFor={id} className="sr-only">
          How much {view.name}, in {view.step.unit}
        </label>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={typed ?? amountInput(view.qtyMilli)}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") setTyped(null);
          }}
          aria-invalid={parsed !== null && !parsed.ok}
          title={parsed && !parsed.ok ? parsed.message : undefined}
          className={cn(
            "rounded-lg border border-transparent bg-background text-center text-[15px] font-bold tabular-nums",
            "focus-visible:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "aria-[invalid=true]:border-destructive aria-[invalid=true]:text-destructive",
            compact ? "h-9 w-12" : "h-10 w-16",
          )}
        />
        <span className="text-sm font-semibold text-muted-foreground">{view.step.unit}</span>
      </span>
      <button
        type="button"
        className={cn(STEP_BUTTON, compact && "h-9 w-9 rounded-[10px]")}
        aria-label={view.moreLabel}
        disabled={view.qtyMilli >= view.max}
        onClick={() => onChange(view.qtyMilli, 1)}
      >
        <Plus className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function SourcePill({ view, className }: { view: LineView; className?: string }) {
  return (
    <span
      title={view.chip.label}
      className={cn(
        "inline-block max-w-full rounded-full px-2.5 py-0.5 text-xs font-bold",
        view.chip.tone === "mine" ? "bg-cp-herb-tint text-primary" : "bg-cp-owed-tint text-cp-owed",
        className,
      )}
    >
      {view.chip.label}
    </span>
  );
}

/** An ingredient on a phone: name and source, cost and who you owe, the stepper and what is left. */
export function LineCard({
  view,
  currency,
  onChange,
}: {
  view: LineView;
  currency: string;
  onChange: (qtyMilli: number, delta?: 1 | -1) => void;
}) {
  return (
    <li className="space-y-2.5 rounded-[18px] border bg-card py-3 pl-3.5 pr-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <span className="max-w-full break-words text-[15px] font-bold leading-snug">{view.name}</span>
          <SourcePill view={view} className="truncate" />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <Money minor={view.costMinor} currency={currency} className="text-[15px] font-bold" />
          <span className={cn("text-xs font-semibold", view.mine ? "text-muted-foreground" : "text-cp-owe")}>{view.owe}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AmountStepper view={view} onChange={onChange} id={`dish-line-${view.key}`} />
        <span className="ml-auto text-[13px] text-muted-foreground">{view.leftNote}</span>
      </div>
    </li>
  );
}

/** Every ingredient as one table, from 900px: Ingredient · From · Amount · Cost · You owe. */
export function LineTable({
  views,
  currency,
  heading,
  onChange,
}: {
  views: readonly LineView[];
  currency: string;
  heading: React.ReactNode;
  onChange: (key: string, qtyMilli: number, delta?: 1 | -1) => void;
}) {
  const th = "border-b px-3 pb-2 pt-1 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <caption className="px-[18px] pb-2 pt-4 text-left text-base font-extrabold">{heading}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(th, "pl-[18px]")}>
              Ingredient
            </th>
            <th scope="col" className={th}>
              From
            </th>
            <th scope="col" className={th}>
              Amount
            </th>
            <th scope="col" className={cn(th, "text-right")}>
              Cost
            </th>
            <th scope="col" className={cn(th, "min-w-[5.5rem] whitespace-nowrap pr-[18px] text-right")}>
              You owe
            </th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr key={v.key} className="border-b last:border-b-0">
              <td className="py-2 pl-[18px] pr-3 align-middle">
                <span className="block font-bold">{v.name}</span>
                <span className="block text-xs text-muted-foreground">{v.leftNote}</span>
              </td>
              <td className="px-3 py-2">
                <SourcePill view={v} className="max-w-[9.5rem] rounded-xl leading-snug" />
              </td>
              <td className="px-3 py-2">
                <AmountStepper view={v} onChange={(q, d) => onChange(v.key, q, d)} id={`dish-row-${v.key}`} compact />
              </td>
              <td className="px-3 py-2 text-right font-bold">
                <Money minor={v.costMinor} currency={currency} />
              </td>
              <td className={cn("py-2 pl-3 pr-[18px] text-right font-bold", v.mine ? "text-muted-foreground" : "text-cp-owe")}>
                {v.mine ? (
                  "—"
                ) : (
                  <>
                    <span className="block">{v.payer}</span>
                    <Money minor={v.costMinor} currency={currency} className="block whitespace-nowrap" />
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Extras and portions ───────────────────────────────────────────

/** A labelled − value + stepper (extras in ₹5, portions one at a time). */
export function ValueStepper({
  label,
  hint,
  value,
  lessLabel,
  moreLabel,
  canLess,
  canMore,
  onLess,
  onMore,
  className,
}: {
  label: string;
  hint?: string;
  value: string;
  lessLabel: string;
  moreLabel: string;
  canLess: boolean;
  canMore: boolean;
  onLess: () => void;
  onMore: () => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-col gap-2 rounded-[18px] border bg-card px-3.5 py-3", className)}>
      <span className="text-[13px] font-bold">
        {label}
        {hint ? <span className="font-medium text-muted-foreground"> {hint}</span> : null}
      </span>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={STEP_BUTTON} aria-label={lessLabel} disabled={!canLess} onClick={onLess}>
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <span aria-live="polite" className="text-base font-extrabold tabular-nums">
          {value}
        </span>
        <button type="button" className={STEP_BUTTON} aria-label={moreLabel} disabled={!canMore} onClick={onMore}>
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ── The cost card ─────────────────────────────────────────────────

/**
 * The dark card: the dish total and each portion, what came from your own
 * pantry, the extras you paid, and — for items from group pantries — what you
 * take on, buyer by buyer and group by group.
 */
export function CostCard({ totals, meId, names }: { totals: DishTotals; meId: string; names?: MemberNames | null }) {
  const money = (minor: number) => formatMinor(minor, totals.currency);
  const portions = portionsText(totals.portionsHalf);
  return (
    <section aria-labelledby="dish-cost-heading" className="space-y-3.5 rounded-[22px] bg-[#17201B] p-[18px] text-white">
      <h2 id="dish-cost-heading" className="sr-only">
        What it costs
      </h2>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[#C9D2CB]">Dish total</p>
          <p className="text-[30px] font-extrabold leading-tight tracking-tight tabular-nums">{money(totals.totalMinor)}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[13px] font-semibold text-[#C9D2CB]">Each portion</p>
          <p className="text-[22px] font-extrabold leading-tight tabular-nums text-[#8FD3AE]">{perPortionText(totals)}</p>
          <p className="text-xs text-[#C9D2CB]">
            ÷ {portions} {portions === "1" ? "portion" : "portions"}
          </p>
        </div>
      </div>
      <div aria-hidden className="h-px bg-[#33403A]" />
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-[#C9D2CB]">{totals.mineIsPantry ? "From your own pantry" : "Paid for by you"}</dt>
          <dd className="font-bold tabular-nums">{money(totals.fromMineMinor)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[#C9D2CB]">Extras you paid</dt>
          <dd className="font-bold tabular-nums">{money(totals.extrasMinor)}</dd>
        </div>
      </dl>
      <div className="space-y-2">
        <p className="text-[13px] font-bold text-[#C9D2CB]">You take on, for items from group pantries</p>
        {totals.owes.length === 0 ? (
          <p className="text-sm text-[#C9D2CB]">Nothing: no one else paid for anything in it.</p>
        ) : (
          <ul className="space-y-2">
            {totals.owes.map((o) => (
              <li key={`${o.orgId}:${o.buyerId}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 text-[#C9D2CB]">{oweLabel(o, meId, names)}</span>
                <span className="shrink-0 font-extrabold tabular-nums text-[#F7B48A]">{money(o.amountMinor)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Take from any pantry ──────────────────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [current, setCurrent] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return current;
}

/** How many items the list shows before a search. */
const BROWSE_LIMIT = 30;

/**
 * "Take from any pantry": a search over every pantry you cook from (quick
 * use's search, `usable=1`), and before you type, your items soonest use-by
 * first. Each row says where it is, who paid and what is left, with Add.
 * Nothing matching offers "Bought it just now?" — a small form that adds it
 * to your pantry and the dish in the same write.
 */
export function PantryPanel({
  idPrefix,
  dishLines,
  currency,
  dishCurrency,
  full,
  meId,
  names,
  onAdd,
  onAddNew,
  newKey,
  onClose,
  autoFocus,
  className,
}: {
  idPrefix: string;
  dishLines: Parameters<typeof pantryResults>[1]["lines"];
  /** The currency every new ingredient must count in, or null while nothing decides. */
  currency: string | null;
  /** The dish's currency (for what is just bought). */
  dishCurrency: string;
  full: boolean;
  meId: string;
  names?: MemberNames | null;
  onAdd: (item: KitchenItem) => void;
  onAddNew: (line: NewLine) => void;
  newKey: () => string;
  /** Phones: close the panel. */
  onClose?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [buying, setBuying] = React.useState<NewItemDraft | null>(null);
  const [said, setSaid] = React.useState("");
  const term = useDebounced(query.trim(), 200);
  const search = useItemSearch(term);
  const browse = useCookableItems();
  const searching = query.trim() !== "";
  const ctx = { lines: dishLines, currency, meId, names: names ?? null };
  const source = searching ? (term === query.trim() ? search.data : null) : browse.data;
  const results: PantryResult[] | null = source ? pantryResults(source, searching ? ctx : { ...ctx, limit: BROWSE_LIMIT }) : null;
  const error = searching ? search.error : browse.error;
  const headingId = `${idPrefix}-heading`;

  const add = (r: PantryResult) => {
    onAdd(r.item);
    setSaid(`Added ${r.name}.`);
    setQuery("");
  };

  return (
    <section aria-labelledby={headingId} className={cn("space-y-3 rounded-[22px] border bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-extrabold">
          Take from any pantry
        </h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the pantry search"
            className="-mr-2 -mt-1 grid h-11 w-11 place-items-center rounded-full min-[900px]:hidden text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="relative">
        <label htmlFor={`${idPrefix}-search`} className="sr-only">
          Search every pantry
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id={`${idPrefix}-search`}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setBuying(null);
          }}
          placeholder="Search every pantry"
          autoComplete="off"
          enterKeyHint="search"
          autoFocus={autoFocus}
          className={cn(K_INPUT, "border-transparent bg-background pl-10")}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {full ? <p className="text-[13px] text-muted-foreground">The dish has 30 ingredients, the most one dish takes.</p> : null}

      {buying ? (
        <NewItemForm
          idPrefix={`${idPrefix}-new`}
          draft={buying}
          onDraft={setBuying}
          currency={dishCurrency}
          disabled={full}
          onCancel={() => setBuying(null)}
          onAdd={(draft) => {
            const preview = previewNewItem(draft, newKey(), dishCurrency);
            if (!preview.line) return false;
            onAddNew(preview.line);
            setSaid(`Added ${preview.line.name}, just bought.`);
            setBuying(null);
            setQuery("");
            return true;
          }}
        />
      ) : error && results === null ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load your pantries. {error.message}</p>
      ) : results === null ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      ) : results.length === 0 ? (
        searching ? (
          <div className="space-y-2.5 px-1 py-1">
            <p className="text-sm text-muted-foreground">Not in any pantry. Bought it just now?</p>
            <Button type="button" className={cn(K_BUTTON, "w-full bg-foreground text-background hover:bg-foreground/90")} onClick={() => setBuying(emptyNewItem(query.trim()))}>
              Add &ldquo;{query.trim()}&rdquo; to your pantry and use it
            </Button>
          </div>
        ) : (
          <p className="px-1 text-sm text-muted-foreground">Nothing in your pantries to cook with yet. Bought something? Add it below.</p>
        )
      ) : (
        <>
          <p className="px-1 text-xs font-bold text-muted-foreground">{searching ? `Matches across your pantries` : "In your pantries · use soonest first"}</p>
          <ul aria-label="Items to cook with" className="-mx-1 max-h-[420px] overflow-y-auto min-[900px]:max-h-[min(560px,calc(100dvh-20rem))]">
            {results.map((r) => (
              <ResultRow key={r.key} result={r} full={full} onAdd={() => add(r)} />
            ))}
          </ul>
        </>
      )}

      {buying || (searching && results !== null && results.length === 0) ? null : (
        <button
          type="button"
          onClick={() => setBuying(emptyNewItem(query.trim()))}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShoppingBasket className="h-4 w-4" aria-hidden />
          Bought something just now?
        </button>
      )}
    </section>
  );
}

function ResultRow({ result, full, onAdd }: { result: PantryResult; full: boolean; onAdd: () => void }) {
  const kind = result.item.pantry.kind === "personal" ? "personal" : "group";
  const blocked = result.disabledReason !== null;
  return (
    <li className="flex items-center gap-2.5 rounded-xl px-1 py-2">
      <PantryBadge kind={kind} label={result.pantry} badge={pantryBadge(result.item.pantry)} className="h-8 w-8 rounded-[9px] text-[11px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">{result.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {result.meta}
          {blocked ? ` · ${result.disabledReason}` : ""}
        </span>
      </span>
      {result.added ? (
        <span className="inline-flex min-h-10 items-center gap-1 px-2 text-sm font-bold text-primary">
          <Check className="h-4 w-4" aria-hidden />
          Added
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={blocked || full}
          aria-label={`Add ${result.name} from ${result.pantry}`}
          className="min-h-11 shrink-0 rounded-[10px] border border-primary bg-card px-3.5 text-sm font-bold text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-input disabled:text-muted-foreground"
        >
          Add
        </button>
      )}
    </li>
  );
}

/** "Bought it just now?": name, how much and in what, what you paid. */
function NewItemForm({
  idPrefix,
  draft,
  onDraft,
  currency,
  disabled,
  onCancel,
  onAdd,
}: {
  idPrefix: string;
  draft: NewItemDraft;
  onDraft: (draft: NewItemDraft) => void;
  currency: string;
  disabled: boolean;
  onCancel: () => void;
  /** False when the form still has an error. */
  onAdd: (draft: NewItemDraft) => boolean;
}) {
  const [tried, setTried] = React.useState(false);
  const preview = previewNewItem(draft, "preview", currency);
  const show = (f: NewItemField) => (tried ? preview.errors[f] : undefined);
  const set = (patch: Partial<NewItemDraft>) => onDraft({ ...draft, ...patch });
  const nameRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    nameRef.current?.focus();
    if (draft.name) document.getElementById(`${idPrefix}-qty`)?.focus();
    // Focus once, when the form opens.
  }, []);
  const field = "space-y-1";
  const err = (f: NewItemField) =>
    show(f) ? (
      <p id={`${idPrefix}-${f}-error`} className="text-xs font-medium text-destructive">
        {show(f)}
      </p>
    ) : null;
  return (
    <form
      noValidate
      aria-label="Bought it just now"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (!onAdd(draft)) {
          const first = (["name", "quantity", "price"] as const).find((f) => preview.errors[f]);
          if (first) document.getElementById(`${idPrefix}-${first === "quantity" ? "qty" : first}`)?.focus();
        }
      }}
      className="space-y-3 rounded-[18px] bg-background p-3.5"
    >
      <div>
        <p className="text-[15px] font-bold">Bought it just now?</p>
        <p className="text-xs text-muted-foreground">It goes into your pantry, paid by you. What the dish doesn&apos;t use stays there.</p>
      </div>
      <div className={field}>
        <label htmlFor={`${idPrefix}-name`} className="text-xs font-semibold text-muted-foreground">
          What
        </label>
        <Input
          ref={nameRef}
          id={`${idPrefix}-name`}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Coriander"
          autoComplete="off"
          aria-invalid={!!show("name")}
          aria-describedby={show("name") ? `${idPrefix}-name-error` : undefined}
          className={cn(K_INPUT, "bg-card")}
        />
        {err("name")}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
        <div className={field}>
          <label htmlFor={`${idPrefix}-qty`} className="text-xs font-semibold text-muted-foreground">
            How much
          </label>
          <div className="flex gap-1.5">
            <Input
              id={`${idPrefix}-qty`}
              inputMode="decimal"
              value={draft.quantity}
              onChange={(e) => set({ quantity: e.target.value })}
              placeholder="250"
              autoComplete="off"
              aria-invalid={!!show("quantity")}
              aria-describedby={show("quantity") ? `${idPrefix}-quantity-error` : undefined}
              className={cn(K_INPUT, "min-w-0 bg-card")}
            />
            <label htmlFor={`${idPrefix}-unit`} className="sr-only">
              Unit
            </label>
            <select
              id={`${idPrefix}-unit`}
              value={draft.unit}
              onChange={(e) => set({ unit: e.target.value as NewItemDraft["unit"] })}
              className="h-11 shrink-0 rounded-xl border border-input bg-card px-2 text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {[...MAIN_UNITS, ...MORE_UNITS].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          {err("quantity")}
        </div>
        <div className={field}>
          <label htmlFor={`${idPrefix}-price`} className="text-xs font-semibold text-muted-foreground">
            You paid
          </label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-muted-foreground">
              {currencyPrefix(currency)}
            </span>
            <Input
              id={`${idPrefix}-price`}
              inputMode="decimal"
              value={draft.price}
              onChange={(e) => set({ price: e.target.value })}
              placeholder="40"
              autoComplete="off"
              aria-invalid={!!show("price")}
              aria-describedby={show("price") ? `${idPrefix}-price-error` : undefined}
              className={cn(K_INPUT, "bg-card pl-8")}
            />
          </div>
          {err("price")}
        </div>
      </div>
      {preview.perUnit ? <p className="text-xs tabular-nums text-muted-foreground">{preview.perUnit}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className={cn(K_BUTTON, "flex-1")} disabled={disabled}>
          Add to the dish
        </Button>
        <Button type="button" variant="outline" className={K_BUTTON} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Share it with ─────────────────────────────────────────────────

function ShareBadge({ option }: { option: Pick<ShareOption, "kind" | "name"> }) {
  return option.kind === "me" ? <PantryBadge kind="personal" label="Just me" badge="Me" /> : <GroupAvatar name={option.name} size="sm" />;
}

/**
 * "Share it with": the choice, and under it a searchable list — Just me
 * (don't split), then your groups, the ones opened last first. Groups you
 * only view are not offered; one counting in another currency than the
 * ingredients is shown, but can't be picked.
 */
export function SharePicker({
  groups,
  value,
  choice,
  currency,
  loading,
  onChange,
}: {
  groups: readonly MyGroupBalance[];
  value: string;
  choice: { name: string; meta: string };
  currency: string | null;
  loading: boolean;
  onChange: (share: string) => void;
}) {
  const recentSlugs = useRecentGroupSlugs();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const list = shareOptions(groups, { query, recentSlugs, currency });
  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) buttonRef.current?.focus();
  };
  return (
    <div className="space-y-2">
      <h2 className="text-[17px] font-extrabold">Share it with</h2>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="dish-share-panel"
        onClick={() => (open ? close(false) : setOpen(true))}
        className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-input bg-card px-3.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ShareBadge option={{ kind: value === JUST_ME ? "me" : "group", name: choice.name }} />
        <span className="min-w-0 flex-1">
          <span className="sr-only">Share it with: </span>
          <span className="block truncate text-base font-extrabold">{choice.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{choice.meta}</span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div
          id="dish-share-panel"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close(true);
            }
          }}
          className="space-y-1.5 rounded-[18px] border border-input bg-card p-2.5 shadow-[0_12px_32px_rgba(23,32,27,0.14)]"
        >
          <div className="relative">
            <label htmlFor="dish-share-search" className="sr-only">
              Search your groups
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="dish-share-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your groups"
              autoComplete="off"
              autoFocus
              className={cn(K_INPUT, "border-transparent bg-background pl-10")}
            />
          </div>
          {list.heading ? <p className="px-2 pt-1.5 text-xs font-bold text-muted-foreground">{list.heading}</p> : null}
          {loading ? (
            <div className="space-y-1.5 p-1" aria-hidden>
              <Skeleton className="h-11 w-full rounded-xl" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ) : null}
          <ul aria-label="Share with" className="max-h-[360px] overflow-y-auto">
            {list.options.map((o) => {
              const selected = o.key === value;
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={o.disabledReason !== null}
                    onClick={() => {
                      onChange(o.key);
                      close(true);
                    }}
                    className={cn(
                      "flex min-h-[54px] w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-accent",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
                      selected && "bg-accent",
                    )}
                  >
                    <ShareBadge option={o} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{o.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{o.meta}</span>
                    </span>
                    {selected ? <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {list.options.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">No group matches &ldquo;{query.trim()}&rdquo;.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Who ate? ──────────────────────────────────────────────────────

/** Claims or assign, as two radio cards. */
export function SplitModeCards({
  modes,
  value,
  onChange,
}: {
  modes: readonly SplitModeOption[];
  value: string;
  onChange: (id: SplitModeOption["id"]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-[17px] font-extrabold">Who ate?</legend>
      {modes.map((m) => {
        const on = m.id === value;
        return (
          <label
            key={m.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-2xl p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              on ? "border-2 border-primary bg-accent" : "border border-input bg-card hover:bg-accent/50",
            )}
          >
            <input
              type="radio"
              name="dish-split-mode"
              value={m.id}
              checked={on}
              onChange={() => onChange(m.id)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--primary))] focus-visible:outline-none"
            />
            <span className="min-w-0">
              <span className="block text-[15px] font-bold">{m.label}</span>
              <span className="block text-[13px] text-muted-foreground">{m.help}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** How many people the list shows before "Show everyone". */
const EATERS_SHOWN = 6;

/** Who ate what, in half portions, each with what they owe — live. */
export function EaterList({
  view,
  currency,
  loading,
  onStep,
}: {
  view: EaterView;
  currency: string;
  loading: boolean;
  onStep: (subjectId: string, delta: 1 | -1) => void;
}) {
  const [all, setAll] = React.useState(false);
  if (loading) {
    return (
      <div className="space-y-1.5" aria-hidden>
        <Skeleton className="h-14 w-full rounded-[18px]" />
        <Skeleton className="h-14 w-full rounded-[18px]" />
      </div>
    );
  }
  const shown = all ? view.rows : view.rows.filter((r, i) => i < EATERS_SHOWN || r.half > 0);
  const hidden = view.rows.length - shown.length;
  const btn =
    "grid h-11 w-10 shrink-0 place-items-center rounded-[10px] border border-input bg-card transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="space-y-2">
      <ul aria-label="Who ate what" className="divide-y rounded-[18px] border bg-card">
        {shown.map((r) => (
          <li key={r.subjectId} className="flex items-center gap-1.5 py-2 pl-3.5 pr-3">
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{r.label}</span>
            <button type="button" className={btn} aria-label={`Half a portion less for ${r.label}`} disabled={!r.canLess} onClick={() => onStep(r.subjectId, -1)}>
              <Minus className="h-4 w-4" aria-hidden />
            </button>
            <span className="min-w-[2.25rem] text-center text-[15px] font-extrabold tabular-nums" aria-label={`${r.portions} portions`}>
              {r.portions}
            </span>
            <button type="button" className={btn} aria-label={`Half a portion more for ${r.label}`} disabled={!r.canMore} onClick={() => onStep(r.subjectId, 1)}>
              <Plus className="h-4 w-4" aria-hidden />
            </button>
            <Money minor={r.amountMinor} currency={currency} className={cn("min-w-[4.75rem] text-right text-sm font-bold", r.half === 0 && "text-muted-foreground")} />
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 rounded-xl px-2 text-sm font-semibold text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Show everyone ({view.rows.length})
        </button>
      ) : null}
      {view.unclaimedHalf > 0 ? (
        <p className="px-1 text-[13px] text-muted-foreground">
          Nobody&apos;s down for {portionsText(view.unclaimedHalf)} {view.unclaimedHalf === 2 ? "portion" : "portions"} yet (
          {formatMinor(view.unclaimedMinor, currency)}). They fall to you, and become leftovers in your pantry once you finalize.
        </p>
      ) : null}
    </div>
  );
}

/** The green note: what nets against what (or, just for you, what you still owe). */
export function ShareNoteCard({ note }: { note: { tone: "net" | "plain"; text: string } }) {
  return (
    <p
      className={cn(
        "rounded-2xl px-4 py-3.5 text-sm",
        note.tone === "net" ? "bg-cp-herb-tint text-[#165C3A]" : "border bg-card text-muted-foreground",
      )}
    >
      {note.text}
    </p>
  );
}
